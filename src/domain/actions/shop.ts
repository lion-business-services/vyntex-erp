// The shop floor of the barbershop edition: chairs, the walk-in queue, memberships, packages and gift cards, loyalty
// points, barber pay and the insights the owner reads in the morning.
//
// The queue works the way a busy shop does it at the front desk:
//   * each chair is free from the end of what it is doing now (a walk-in in the chair, or a booked appointment);
//   * a booked appointment keeps its time: a walk-in only goes into a chair when the service fits before the next booking;
//   * people are served in the order they arrived, except that someone who asked for a barber waits for that barber;
//   * the estimate of each person's wait is that plan, rounded up to five minutes, never promised to the minute.
// Barber pay follows the rules most commission shops write down: a share of what a shop client paid for the service, a
// higher share (usually all of it) for a client the barber brought, every tip to the barber and never part of the base,
// and a weekly chair rent instead of a share for a barber who rents. Money is added in whole cents.
//
// Plain functions over the workspace, like every other action: the sample workspace, the tests and the server run them.
// Nothing here charges a card. "Paid" records a payment a person took, with its method.
import type { Appointment, CatalogService, Chair, Client, DemoState, ISODate, ISODateTime, Pass, PassPlan, PayMethod, Payout, TeamUser, WalkIn } from '../types';
import { type Ctx, logActivity } from '../context';
import { emit } from '../rules/engine';
import { ev } from '../rules/fields';
import { addCashEntry } from './ops';
import { addDaysFrom, daysBetween, nowIso, parseDate, toISODate, today } from '@/lib/dates';
import { money2 } from '@/lib/money';
import { uid } from '@/lib/id';

export type ShopRefusal = 'invalid' | 'not_found' | 'not_allowed' | 'already' | 'empty' | 'expired' | 'not_active' | 'not_enough';
export type ShopResult<T> = { ok: true; value: T } | { ok: false; reason: ShopRefusal };
const yes = <T,>(value: T): ShopResult<T> => ({ ok: true, value });
const no = <T,>(reason: ShopRefusal): ShopResult<T> => ({ ok: false, reason });

/* =====================================================================================================================
   Money, exact
   ===================================================================================================================== */

const c = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100);
const d$ = (cents: number) => cents / 100;
/** An amount that may be zero but never negative or not a number. */
const amt = (v: unknown): number => { const x = c(Number(v)); return isFinite(x) && x > 0 ? d$(x) : 0; };
/** Percent of an amount, rounded half up to the cent. */
const share = (amount: number, pct: number) => d$(Math.round((c(amount) * pct) / 100));

/* =====================================================================================================================
   Settings
   ===================================================================================================================== */

export interface ShopSettings {
  /** Loyalty points earned per dollar spent on services (tips do not count). */
  pointsPerDollar: number;
  /** Points needed for a reward, and the reward's value (a store credit on a gift card). */
  rewardPoints: number;
  rewardValue: number;
  /** Days between visits assumed for a client with only one visit on file. */
  rebookDays: number;
  /** Minutes kept between two walk-ins in the same chair (sweeping, setting up). */
  buffer: number;
  /** Minutes of a service when the menu does not say. */
  defaultMinutes: number;
  /** A package with this many visits left, or a gift card with this much money, is "running low". */
  lowVisits: number;
  lowBalance: number;
  /** The queue accepts walk-ins (the front desk can pause it when the shop is full). */
  queueOpen: boolean;
  /** No-shows after which online booking asks for a deposit. */
  noShowLimit: number;
}
export const SHOP_DEFAULTS: ShopSettings = {
  pointsPerDollar: 1, rewardPoints: 250, rewardValue: 10, rebookDays: 28, buffer: 5, defaultMinutes: 30, lowVisits: 1, lowBalance: 10, queueOpen: true, noShowLimit: 2,
};
export const shopSettings = (d: Pick<DemoState, 'settings'>): ShopSettings => ({ ...SHOP_DEFAULTS, ...((d.settings?.shop as Partial<ShopSettings> | undefined) ?? {}) });
export function saveShopSettings(d: DemoState, _ctx: Ctx, patch: Partial<ShopSettings>): ShopResult<ShopSettings> {
  const next = { ...shopSettings(d), ...patch };
  const nums: (keyof ShopSettings)[] = ['pointsPerDollar', 'rewardPoints', 'rewardValue', 'rebookDays', 'buffer', 'defaultMinutes', 'lowVisits', 'lowBalance', 'noShowLimit'];
  for (const k of nums) { const v = Number(next[k]); if (!isFinite(v) || v < 0 || v > 100000) return no('invalid'); }
  if (next.rebookDays < 1 || next.defaultMinutes < 5) return no('invalid');
  d.settings = { ...d.settings, shop: next };
  return yes(next);
}

/* =====================================================================================================================
   The menu: what a service costs and how long it takes
   ===================================================================================================================== */

export const serviceOf = (d: Pick<DemoState, 'catalog'>, id: string | undefined): CatalogService | undefined => (id ? (d.catalog ?? []).find((s) => s.id === id) : undefined);
/** The menu price of a service: its first tier. */
export const priceOf = (d: Pick<DemoState, 'catalog'>, id: string | undefined): number => serviceOf(d, id)?.tiers[0]?.price ?? 0;
/** Minutes a service takes: its appointment type, or the shop's default. */
export function minutesFor(d: Pick<DemoState, 'catalog' | 'apptTypes' | 'settings'>, id: string | undefined): number {
  const s = serviceOf(d, id);
  const type = s?.appointmentTypeId ? (d.apptTypes ?? []).find((a) => a.id === s.appointmentTypeId) : undefined;
  return type?.minutes || shopSettings(d).defaultMinutes;
}
export const serviceName = (d: Pick<DemoState, 'catalog'>, id: string | undefined, lang: string): string => {
  const s = serviceOf(d, id); if (!s) return '';
  return s.i18n?.[lang as 'es']?.name || s.name;
};

/* =====================================================================================================================
   Chairs
   ===================================================================================================================== */

export const chairOf = (d: Pick<DemoState, 'chairs'>, staffId: string | undefined): Chair | undefined => (staffId ? (d.chairs ?? []).find((x) => x.staffId === staffId) : undefined);
export const barberOf = (d: Pick<DemoState, 'users'>, id: string | undefined): TeamUser | undefined => (id ? d.users.find((u) => u.id === id) : undefined);

export interface ChairInput { id?: string; label: string; staffId?: string; walkIns: boolean; pay: Chair['pay']; split: number; ownSplit: number; rent?: number; skipServiceIds?: string[] }
export function saveChair(d: DemoState, ctx: Ctx, input: ChairInput): ShopResult<Chair> {
  const label = input.label.trim();
  const pct = (v: number) => isFinite(v) && v >= 0 && v <= 100;
  if (!label || label.length > 60 || !pct(Number(input.split)) || !pct(Number(input.ownSplit)) || (input.pay !== 'commission' && input.pay !== 'rent')) return no('invalid');
  if (input.pay === 'rent' && !amt(input.rent)) return no('invalid');
  if (input.staffId && !d.users.some((u) => u.id === input.staffId && u.active !== false)) return no('invalid');
  // one chair per barber
  if (input.staffId && (d.chairs ?? []).some((x) => x.staffId === input.staffId && x.id !== input.id)) return no('already');
  const existing = input.id ? (d.chairs ?? []).find((x) => x.id === input.id) : undefined;
  if (input.id && !existing) return no('not_found');
  const row: Chair = {
    id: existing?.id ?? uid('ch'), label, staffId: input.staffId || undefined, status: existing?.status ?? 'off', walkIns: !!input.walkIns, pay: input.pay,
    split: Number(input.split), ownSplit: Number(input.ownSplit), rent: input.pay === 'rent' ? amt(input.rent) : undefined, skipServiceIds: input.skipServiceIds?.length ? [...input.skipServiceIds] : undefined,
    officeId: existing?.officeId, since: existing?.since,
  };
  if (existing) Object.assign(existing, row); else d.chairs = [...(d.chairs ?? []), row];
  logActivity(d, ctx.actor, existing ? 'shop.chair.edited' : 'shop.chair.added', { type: 'user', id: row.staffId ?? ctx.actor }, { chair: label });
  return yes(existing ?? row);
}
export function deleteChair(d: DemoState, ctx: Ctx, id: string): ShopResult<true> {
  const ch = (d.chairs ?? []).find((x) => x.id === id); if (!ch) return no('not_found');
  if ((d.walkins ?? []).some((w) => w.chairId === id && (w.status === 'called' || w.status === 'in_service'))) return no('not_allowed');
  d.chairs = d.chairs.filter((x) => x.id !== id);
  logActivity(d, ctx.actor, 'shop.chair.removed', { type: 'user', id: ch.staffId ?? ctx.actor }, { chair: ch.label });
  return yes(true);
}
export function setChairStatus(d: DemoState, ctx: Ctx, id: string, status: Chair['status']): ShopResult<Chair> {
  const ch = (d.chairs ?? []).find((x) => x.id === id); if (!ch) return no('not_found');
  if (!['open', 'busy', 'break', 'off'].includes(status)) return no('invalid');
  // a chair with someone in it is busy until that visit is finished
  if (status !== 'busy' && (d.walkins ?? []).some((w) => w.chairId === id && w.status === 'in_service')) return no('not_allowed');
  ch.status = status; ch.since = nowIso();
  logActivity(d, ctx.actor, 'shop.chair.status', { type: 'user', id: ch.staffId ?? ctx.actor }, { chair: ch.label, status });
  return yes(ch);
}

/* =====================================================================================================================
   The walk-in queue
   ===================================================================================================================== */

const dayOf = (iso: string | undefined) => (iso ? toISODate(new Date(iso)) : '');
/** Today's walk-ins, oldest first. */
export const walkinsOn = (d: Pick<DemoState, 'walkins'>, date: ISODate = today()): WalkIn[] =>
  (d.walkins ?? []).filter((w) => dayOf(w.joined) === date).sort((a, b) => a.joined.localeCompare(b.joined));
/** People still waiting or called to a chair, in the order they are served. */
export const inLine = (d: Pick<DemoState, 'walkins'>): WalkIn[] => walkinsOn(d).filter((w) => w.status === 'waiting' || w.status === 'called');
export const inChair = (d: Pick<DemoState, 'walkins'>): WalkIn[] => walkinsOn(d).filter((w) => w.status === 'in_service');

/** Chairs that take walk-ins right now: a barber in it, not off, not on a break. */
export const workingChairs = (d: Pick<DemoState, 'chairs' | 'users'>): Chair[] =>
  (d.chairs ?? []).filter((x) => x.staffId && x.walkIns && x.status !== 'off' && x.status !== 'break' && d.users.some((u) => u.id === x.staffId && u.active !== false));
const offers = (ch: Chair, serviceId: string | undefined) => !serviceId || !(ch.skipServiceIds ?? []).includes(serviceId);

const minutesSince = (iso: string | undefined, now: Date) => (iso ? (now.getTime() - new Date(iso).getTime()) / 60000 : 0);
const atTime = (date: ISODate, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const x = parseDate(date); x.setHours(h, m, 0, 0); return x; };
const BOOKED: Appointment['status'][] = ['scheduled', 'confirmed', 'awaiting_payment'];

/** Booked appointments of a barber today that have not finished: [start, end] in minutes from now. */
function bookingsAhead(d: Pick<DemoState, 'appointments'>, staffId: string, now: Date): [number, number][] {
  const td = toISODate(now);
  return (d.appointments ?? []).filter((a) => a.staffId === staffId && a.date === td && BOOKED.includes(a.status))
    .map((a): [number, number] => { const s = (atTime(a.date, a.time).getTime() - now.getTime()) / 60000; return [s, s + a.minutes]; })
    .filter(([, e]) => e > 0).sort((a, b) => a[0] - b[0]);
}

export interface PlanLine { walkinId: string; chairId?: string; staffId?: string; /** Minutes from now, rounded up to 5. */ wait: number; position: number; startsAt?: ISODateTime }
export interface QueuePlan { lines: PlanLine[]; /** Chair id → minutes from now when it is next free for a walk-in. */ free: Record<string, number>; open: boolean }

/**
 * Who goes to which chair, and roughly when. Pure: the same workspace and clock always give the same plan.
 * A person who asked for a barber waits for that barber; everyone else goes to the chair that frees up first.
 */
export function planQueue(d: Pick<DemoState, 'walkins' | 'chairs' | 'users' | 'appointments' | 'catalog' | 'apptTypes' | 'settings'>, now: Date = new Date()): QueuePlan {
  const s = shopSettings(d);
  const chairs = workingChairs(d);
  const free: Record<string, number> = {};
  for (const ch of chairs) {
    const current = inChair(d).find((w) => w.chairId === ch.id);
    let at = 0;
    if (current) at = Math.max(0, minutesFor(d, current.serviceId) - minutesSince(current.startedAt, now)) + s.buffer;
    // someone already called to this chair goes first
    for (const w of inLine(d).filter((x) => x.status === 'called' && x.chairId === ch.id)) at += minutesFor(d, w.serviceId) + s.buffer;
    free[ch.id] = at;
  }
  // a walk-in only goes in when the service fits before the barber's next booking
  const fit = (ch: Chair, from: number, minutes: number): number => {
    let t = from;
    for (const [bs, be] of bookingsAhead(d, ch.staffId!, now)) {
      if (t + minutes <= bs || t >= be) continue;
      t = be + s.buffer;
    }
    return t;
  };
  const lines: PlanLine[] = [];
  let position = 0;
  for (const w of inLine(d)) {
    position++;
    if (w.status === 'called') { lines.push({ walkinId: w.id, chairId: w.chairId, staffId: w.staffId, wait: 0, position }); continue; }
    const minutes = minutesFor(d, w.serviceId);
    const pool = chairs.filter((ch) => offers(ch, w.serviceId) && (!w.prefStaffId || ch.staffId === w.prefStaffId));
    let best: { ch: Chair; start: number } | null = null;
    for (const ch of pool) {
      const start = fit(ch, free[ch.id] ?? 0, minutes);
      if (!best || start < best.start) best = { ch, start };
    }
    if (!best) { lines.push({ walkinId: w.id, wait: -1, position }); continue; }
    free[best.ch.id] = best.start + minutes + s.buffer;
    const wait = Math.ceil(Math.max(0, best.start) / 5) * 5;
    lines.push({ walkinId: w.id, chairId: best.ch.id, staffId: best.ch.staffId, wait, position, startsAt: new Date(now.getTime() + wait * 60000).toISOString() });
  }
  return { lines, free, open: s.queueOpen };
}
/** The wait a new arrival would have now, for the kiosk and the front desk. -1: no barber is taking walk-ins. */
export function quoteWait(d: Parameters<typeof planQueue>[0], serviceId?: string, prefStaffId?: string, now: Date = new Date()): number {
  const probe: WalkIn = { id: '__probe', ticket: 0, name: '', serviceId, prefStaffId, joined: new Date(now.getTime() + 1000).toISOString(), status: 'waiting', source: 'desk', by: '' };
  const plan = planQueue({ ...d, walkins: [...(d.walkins ?? []), probe] }, now);
  return plan.lines.find((l) => l.walkinId === '__probe')?.wait ?? -1;
}
/** Next person the plan sends to a chair, if any. */
export function nextFor(d: Parameters<typeof planQueue>[0], chairId: string, now: Date = new Date()): WalkIn | undefined {
  const line = planQueue(d, now).lines.find((l) => l.chairId === chairId && l.wait >= 0 && (d.walkins ?? []).find((w) => w.id === l.walkinId)?.status === 'waiting');
  return line ? d.walkins.find((w) => w.id === line.walkinId) : undefined;
}

const digits = (v: string | undefined) => (v ?? '').replace(/\D/g, '').slice(-10);
/** A client on file with the same phone number, so a returning guest keeps one history. */
export const clientByPhone = (d: Pick<DemoState, 'clients'>, phone: string | undefined): Client | undefined => {
  const p = digits(phone); return p.length >= 7 ? d.clients.find((x) => digits(x.phone) === p || digits(x.whatsapp) === p) : undefined;
};

export interface WalkInInput { name: string; phone?: string; serviceId?: string; prefStaffId?: string; source: WalkIn['source']; textOk?: boolean; clientId?: string; note?: string }
/** Adds someone to the line. A guest with a phone number joins the client list (or is matched to their record). */
export function addWalkIn(d: DemoState, ctx: Ctx, input: WalkInInput, now: Date = new Date()): ShopResult<WalkIn> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) return no('invalid');
  if (!shopSettings(d).queueOpen) return no('not_allowed');
  if (input.serviceId && !serviceOf(d, input.serviceId)?.active) return no('invalid');
  if (input.prefStaffId && !chairOf(d, input.prefStaffId)) return no('invalid');
  const phone = input.phone?.trim() || undefined;
  if (phone && digits(phone).length < 7) return no('invalid');
  let client = input.clientId ? d.clients.find((x) => x.id === input.clientId) : clientByPhone(d, phone);
  if (!client && phone) {
    client = { id: uid('c'), name, phone, email: '', addresses: [], since: toISODate(now), notes: [], kind: 'individual', smsOptIn: !!input.textOk, lifecycle: 'active', tags: ['walk-in'] };
    d.clients = [client, ...d.clients];
    logActivity(d, ctx.actor, 'client.created', { type: 'client', id: client.id });
  } else if (client && input.textOk && !client.smsOptIn) client.smsOptIn = true;
  const ticket = walkinsOn(d, toISODate(now)).reduce((m, w) => Math.max(m, w.ticket), 0) + 1;
  const w: WalkIn = {
    id: uid('wi'), ticket, name, phone, clientId: client?.id, serviceId: input.serviceId || undefined, prefStaffId: input.prefStaffId || undefined,
    joined: now.toISOString(), status: 'waiting', source: input.source, textOk: !!input.textOk, note: input.note?.trim() || undefined, by: ctx.actor,
  };
  d.walkins = [...(d.walkins ?? []), w];
  const line = planQueue(d, now).lines.find((l) => l.walkinId === w.id);
  logActivity(d, ctx.actor, 'shop.walkin.joined', client ? { type: 'client', id: client.id } : { type: 'user', id: ctx.actor }, { name, ticket });
  emit(d, ctx, ev('walkin.joined'), { ref: client ? { type: 'client', id: client.id } : undefined, client, extra: { name, ticket, wait: line?.wait ?? -1, position: line?.position ?? 0, source: w.source, occasion: w.id } });
  return yes(w);
}
/** Calls the person to a chair (the front desk or the barber presses "next"). */
export function callWalkIn(d: DemoState, ctx: Ctx, id: string, chairId?: string, now: Date = new Date()): ShopResult<WalkIn> {
  const w = (d.walkins ?? []).find((x) => x.id === id); if (!w) return no('not_found');
  if (w.status !== 'waiting') return no('already');
  const target = chairId ?? planQueue(d, now).lines.find((l) => l.walkinId === id)?.chairId;
  const ch = (d.chairs ?? []).find((x) => x.id === target);
  if (!ch || !ch.staffId || ch.status === 'off') return no('not_allowed');
  if (!offers(ch, w.serviceId)) return no('not_allowed');
  Object.assign(w, { status: 'called', chairId: ch.id, staffId: ch.staffId, calledAt: now.toISOString() });
  const client = d.clients.find((x) => x.id === w.clientId);
  const barber = barberOf(d, ch.staffId)?.name ?? '';
  logActivity(d, ctx.actor, 'shop.walkin.called', client ? { type: 'client', id: client.id } : { type: 'user', id: ctx.actor }, { name: w.name, ticket: w.ticket, barber });
  emit(d, ctx, ev('walkin.called'), { ref: client ? { type: 'client', id: client.id } : undefined, client, extra: { name: w.name, ticket: w.ticket, barber, chair: ch.label, occasion: w.id } });
  return yes(w);
}
/** The guest sat down: the chair is busy. */
export function startWalkIn(d: DemoState, ctx: Ctx, id: string, now: Date = new Date()): ShopResult<WalkIn> {
  const w = (d.walkins ?? []).find((x) => x.id === id); if (!w) return no('not_found');
  if (w.status === 'waiting') { const r = callWalkIn(d, ctx, id, undefined, now); if (!r.ok) return r; }
  if (w.status !== 'called') return no('already');
  if (inChair(d).some((x) => x.chairId === w.chairId)) return no('not_allowed');
  Object.assign(w, { status: 'in_service', startedAt: now.toISOString() });
  const ch = (d.chairs ?? []).find((x) => x.id === w.chairId); if (ch) { ch.status = 'busy'; ch.since = now.toISOString(); }
  logActivity(d, ctx.actor, 'shop.walkin.started', w.clientId ? { type: 'client', id: w.clientId } : { type: 'user', id: ctx.actor }, { name: w.name, ticket: w.ticket });
  return yes(w);
}

export interface Checkout { amount: number; tip?: number; method: PayMethod | 'pass'; passId?: string }
/**
 * Finishes a walk-in visit and records what was paid. A visit paid with a membership, package or gift card uses it up by
 * one visit (or the amount) at the same moment. Cash goes into the drawer when the shop keeps one.
 */
export function finishWalkIn(d: DemoState, ctx: Ctx, id: string, pay: Checkout, now: Date = new Date()): ShopResult<WalkIn> {
  const w = (d.walkins ?? []).find((x) => x.id === id); if (!w) return no('not_found');
  if (w.status !== 'in_service') return no('already');
  const tip = amt(pay.tip);
  let amount = amt(pay.amount);
  if (pay.method === 'pass') {
    if (!pay.passId) return no('invalid');
    const r = redeemPass(d, ctx, pay.passId, { walkinId: w.id, amount: amount || priceOf(d, w.serviceId), serviceId: w.serviceId }, now);
    if (!r.ok) return r;
    amount = r.value.value;
  } else if (!['cash', 'card', 'check', 'transfer', 'zelle'].includes(pay.method)) return no('invalid');
  Object.assign(w, { status: 'done', doneAt: now.toISOString(), amount, tip, method: pay.method, passId: pay.method === 'pass' ? pay.passId : undefined });
  const ch = (d.chairs ?? []).find((x) => x.id === w.chairId); if (ch) { ch.status = 'open'; ch.since = now.toISOString(); }
  if (pay.method === 'cash' && c(amount + tip) > 0) addCashEntry(d, ctx, { date: toISODate(now), dir: 'in', amount: d$(c(amount) + c(tip)), category: 'client_payment', memo: `#${w.ticket} ${w.name}` });
  const client = d.clients.find((x) => x.id === w.clientId);
  logActivity(d, ctx.actor, 'shop.walkin.done', client ? { type: 'client', id: client.id } : { type: 'user', id: ctx.actor }, { name: w.name, amount: money2(amount), tip: money2(tip) });
  emit(d, ctx, ev('walkin.done'), { ref: client ? { type: 'client', id: client.id } : undefined, client, extra: { name: w.name, ticket: w.ticket, amount, tip, barber: barberOf(d, w.staffId)?.name ?? '', occasion: w.id } });
  return yes(w);
}
/** The guest left before being served, or never answered when called. */
export function dropWalkIn(d: DemoState, ctx: Ctx, id: string, why: 'left' | 'no_show', now: Date = new Date()): ShopResult<WalkIn> {
  const w = (d.walkins ?? []).find((x) => x.id === id); if (!w) return no('not_found');
  if (w.status !== 'waiting' && w.status !== 'called') return no('already');
  Object.assign(w, { status: why, doneAt: now.toISOString() });
  logActivity(d, ctx.actor, 'shop.walkin.' + why, w.clientId ? { type: 'client', id: w.clientId } : { type: 'user', id: ctx.actor }, { name: w.name, ticket: w.ticket });
  return yes(w);
}
/** Puts someone called back at their place in line (the barber was pulled away). */
export function requeueWalkIn(d: DemoState, ctx: Ctx, id: string): ShopResult<WalkIn> {
  const w = (d.walkins ?? []).find((x) => x.id === id); if (!w) return no('not_found');
  if (w.status !== 'called') return no('already');
  Object.assign(w, { status: 'waiting', chairId: undefined, staffId: undefined, calledAt: undefined });
  logActivity(d, ctx.actor, 'shop.walkin.requeued', w.clientId ? { type: 'client', id: w.clientId } : { type: 'user', id: ctx.actor }, { name: w.name, ticket: w.ticket });
  return yes(w);
}
/** Changes who the person is waiting for: a barber, or the first one available. */
export function setPreference(d: DemoState, ctx: Ctx, id: string, staffId: string | undefined): ShopResult<WalkIn> {
  const w = (d.walkins ?? []).find((x) => x.id === id); if (!w) return no('not_found');
  if (w.status !== 'waiting') return no('already');
  if (staffId && !chairOf(d, staffId)) return no('invalid');
  w.prefStaffId = staffId || undefined;
  logActivity(d, ctx.actor, 'shop.walkin.preference', w.clientId ? { type: 'client', id: w.clientId } : { type: 'user', id: ctx.actor }, { name: w.name, barber: barberOf(d, staffId)?.name ?? '' });
  return yes(w);
}
export function setQueueOpen(d: DemoState, ctx: Ctx, open: boolean): void {
  d.settings = { ...d.settings, shop: { ...shopSettings(d), queueOpen: open } };
  logActivity(d, ctx.actor, open ? 'shop.queue.opened' : 'shop.queue.paused', { type: 'user', id: ctx.actor });
}
/** What the display in the waiting area may show: a first name and an initial, never a phone or a full name. */
export function displayName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? '';
}

/* =====================================================================================================================
   Appointments at the chair: tip, own client, paid with a pass
   ===================================================================================================================== */

export interface VisitExtras { tip?: number; own?: boolean; passId?: string; addOns?: { name: string; price: number }[] }
/** What the checkout adds to a booked visit. The payment itself is recorded by the appointment's own (protected) operation. */
export function setVisitExtras(d: DemoState, ctx: Ctx, apptId: string, x: VisitExtras, now: Date = new Date()): ShopResult<Appointment> {
  const a = (d.appointments ?? []).find((y) => y.id === apptId); if (!a) return no('not_found');
  if (x.tip !== undefined) { if (Number(x.tip) < 0 || !isFinite(Number(x.tip))) return no('invalid'); a.tip = amt(x.tip) || undefined; }
  if (x.own !== undefined) a.own = x.own || undefined;
  if (x.addOns) a.addOns = x.addOns.filter((y) => y.name.trim() && amt(y.price)).map((y) => ({ name: y.name.trim(), price: amt(y.price) }));
  if (x.passId && x.passId !== a.passId) {
    const r = redeemPass(d, ctx, x.passId, { apptId: a.id, amount: a.fee }, now);
    if (!r.ok) return r;
    a.passId = x.passId;
  }
  logActivity(d, ctx.actor, 'shop.visit.checkout', { type: 'appointment', id: a.id }, { tip: money2(a.tip ?? 0) }, a.clientId ? [{ type: 'client', id: a.clientId }] : undefined);
  return yes(a);
}

/* =====================================================================================================================
   Memberships, packages, gift cards
   ===================================================================================================================== */

export interface PlanInput { id?: string; kind: PassPlan['kind']; name: string; price: number; visits?: number; serviceIds: string[]; discount?: number; validDays?: number; perks?: string; active: boolean }
export function savePassPlan(d: DemoState, ctx: Ctx, input: PlanInput): ShopResult<PassPlan> {
  const name = input.name.trim();
  if (!name || name.length > 120 || !['membership', 'package', 'gift_card'].includes(input.kind)) return no('invalid');
  if (input.kind !== 'gift_card' && !amt(input.price)) return no('invalid');
  if (input.kind === 'package' && !(Number(input.visits) >= 1)) return no('invalid');
  if (input.discount !== undefined && !(Number(input.discount) >= 0 && Number(input.discount) <= 100)) return no('invalid');
  const existing = input.id ? (d.passPlans ?? []).find((p) => p.id === input.id) : undefined;
  if (input.id && !existing) return no('not_found');
  const row: PassPlan = {
    id: existing?.id ?? uid('pp'), kind: input.kind, name, i18n: existing?.i18n, price: amt(input.price), visits: input.kind === 'gift_card' ? undefined : Math.max(0, Math.round(Number(input.visits) || 0)),
    interval: input.kind === 'membership' ? 'month' : undefined, serviceIds: (input.serviceIds ?? []).filter((id) => serviceOf(d, id)),
    discount: input.kind === 'membership' && input.discount ? Number(input.discount) : undefined, validDays: input.validDays ? Math.round(Number(input.validDays)) : undefined,
    perks: input.perks?.trim() || undefined, active: !!input.active,
  };
  if (existing) Object.assign(existing, row); else d.passPlans = [...(d.passPlans ?? []), row];
  logActivity(d, ctx.actor, existing ? 'shop.plan.edited' : 'shop.plan.added', { type: 'user', id: ctx.actor }, { plan: name });
  return yes(existing ?? row);
}
export const planOf = (d: Pick<DemoState, 'passPlans'>, id: string | undefined) => (id ? (d.passPlans ?? []).find((p) => p.id === id) : undefined);
export const passesOf = (d: Pick<DemoState, 'passes'>, clientId: string) => (d.passes ?? []).filter((p) => p.clientId === clientId);
/** Memberships, packages and gift cards a client can pay with today, for a service. */
export function usablePasses(d: Pick<DemoState, 'passes' | 'passPlans'>, clientId: string | undefined, serviceId?: string, on: ISODate = today()): Pass[] {
  if (!clientId) return [];
  return passesOf(d, clientId).filter((p) => {
    if (p.status !== 'active' || (p.expires && p.expires < on)) return false;
    if (p.kind === 'gift_card') return (p.balance ?? 0) > 0;
    const plan = planOf(d, p.planId);
    if (serviceId && plan?.serviceIds.length && !plan.serviceIds.includes(serviceId)) return false;
    return p.visitsLeft === undefined || p.visitsLeft > 0;
  });
}
const plusMonth = (date: ISODate) => { const x = parseDate(date); x.setMonth(x.getMonth() + 1); return toISODate(x); };
const giftCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
  const bytes = new Uint8Array(8); (globalThis.crypto ?? { getRandomValues: (b: Uint8Array) => b.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  for (const b of bytes) s += abc[b % abc.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

export interface SellInput { planId?: string; kind?: PassPlan['kind']; clientId?: string; holder?: string; amount?: number; method: PayMethod; note?: string }
/** Sells a membership, package or gift card. A gift card may be any amount; the others cost what the plan says. */
export function sellPass(d: DemoState, ctx: Ctx, input: SellInput, now: Date = new Date()): ShopResult<Pass> {
  const plan = planOf(d, input.planId);
  const kind = plan?.kind ?? input.kind;
  if (!kind || (plan && !plan.active)) return no('invalid');
  if (kind !== 'gift_card' && !plan) return no('invalid');
  const client = input.clientId ? d.clients.find((x) => x.id === input.clientId) : undefined;
  if (input.clientId && !client) return no('not_found');
  if (kind !== 'gift_card' && !client) return no('invalid');
  if (kind === 'gift_card' && !client && !input.holder?.trim()) return no('invalid');
  if (!['cash', 'card', 'check', 'transfer', 'zelle'].includes(input.method)) return no('invalid');
  if (kind === 'membership' && client && passesOf(d, client.id).some((p) => p.kind === 'membership' && (p.status === 'active' || p.status === 'paused' || p.status === 'past_due'))) return no('already');
  const price = kind === 'gift_card' ? amt(input.amount ?? plan?.price) : plan!.price;
  if (!price) return no('invalid');
  const start = toISODate(now);
  const pass: Pass = {
    id: uid('ps'), planId: plan?.id, kind, clientId: client?.id, holder: client ? undefined : input.holder?.trim(), status: 'active', start,
    sold: { at: now.toISOString(), amount: price, method: input.method, by: ctx.actor }, uses: [], note: input.note?.trim() || undefined,
    ...(kind === 'membership' ? { renews: plusMonth(start), visitsLeft: plan!.visits ? plan!.visits : undefined } : {}),
    ...(kind === 'package' ? { visitsLeft: plan!.visits } : {}),
    ...(kind === 'gift_card' ? { balance: price, code: giftCode() } : {}),
    ...(plan?.validDays ? { expires: addDaysFrom(start, plan.validDays) } : {}),
  };
  d.passes = [pass, ...(d.passes ?? [])];
  if (input.method === 'cash') addCashEntry(d, ctx, { date: start, dir: 'in', amount: price, category: 'client_payment', memo: plan?.name ?? 'Gift card' });
  logActivity(d, ctx.actor, 'shop.pass.sold.' + kind, client ? { type: 'client', id: client.id } : { type: 'user', id: ctx.actor }, { plan: plan?.name ?? '', amount: money2(price), who: client?.name ?? pass.holder ?? '' });
  return yes(pass);
}
/** What one visit paid with a pass is worth, for the reports and barber pay: a share of what the client paid for it. */
export function visitValue(d: Pick<DemoState, 'passPlans' | 'catalog'>, p: Pass, menuPrice: number): number {
  if (p.kind === 'gift_card') return menuPrice;
  const plan = planOf(d, p.planId);
  if (plan?.visits) return d$(Math.round(c(plan.price) / plan.visits));
  return menuPrice;
}
/** Uses one visit of a membership or package, or an amount of a gift card. */
export function redeemPass(d: DemoState, ctx: Ctx, passId: string, use: { apptId?: string; walkinId?: string; amount?: number; serviceId?: string }, now: Date = new Date()): ShopResult<{ pass: Pass; value: number }> {
  const p = (d.passes ?? []).find((x) => x.id === passId); if (!p) return no('not_found');
  if (p.status !== 'active') return no('not_active');
  if (p.expires && p.expires < toISODate(now)) return no('expired');
  if ((use.apptId && p.uses.some((u) => u.apptId === use.apptId)) || (use.walkinId && p.uses.some((u) => u.walkinId === use.walkinId))) return no('already');
  const plan = planOf(d, p.planId);
  if (p.kind !== 'gift_card' && use.serviceId && plan?.serviceIds.length && !plan.serviceIds.includes(use.serviceId)) return no('not_allowed');
  let value: number;
  if (p.kind === 'gift_card') {
    const want = amt(use.amount); if (!want) return no('invalid');
    if (c(want) > c(p.balance)) return no('not_enough');
    p.balance = d$(c(p.balance) - c(want)); value = want;
    if (c(p.balance) === 0) p.status = 'used_up';
  } else {
    if (p.visitsLeft !== undefined && p.visitsLeft <= 0) return no('empty');
    if (p.visitsLeft !== undefined) p.visitsLeft -= 1;
    value = visitValue(d, p, amt(use.amount));
    if (p.kind === 'package' && p.visitsLeft === 0) p.status = 'used_up';
  }
  p.uses = [...p.uses, { id: uid('pu'), at: now.toISOString(), amount: value, apptId: use.apptId, walkinId: use.walkinId, by: ctx.actor }];
  const client = d.clients.find((x) => x.id === p.clientId);
  logActivity(d, ctx.actor, 'shop.pass.used', client ? { type: 'client', id: client.id } : { type: 'user', id: ctx.actor }, { plan: plan?.name ?? '', amount: money2(value) });
  const s = shopSettings(d);
  const low = p.kind === 'gift_card' ? p.status === 'active' && c(p.balance) <= c(s.lowBalance) : p.visitsLeft !== undefined && p.visitsLeft <= s.lowVisits;
  if (low && client) emit(d, ctx, ev('pass.low'), { ref: { type: 'client', id: client.id }, client, extra: { passKind: p.kind, plan: plan?.name ?? '', left: p.kind === 'gift_card' ? p.balance ?? 0 : p.visitsLeft ?? 0, occasion: `${p.id}:${p.uses.length}` } });
  return yes({ pass: p, value });
}
export function setPassStatus(d: DemoState, ctx: Ctx, passId: string, status: 'active' | 'paused' | 'cancelled'): ShopResult<Pass> {
  const p = (d.passes ?? []).find((x) => x.id === passId); if (!p) return no('not_found');
  if (p.status === 'cancelled' || p.status === 'used_up' || p.status === 'expired') return no('already');
  if (status === 'paused' && p.kind !== 'membership') return no('invalid');
  p.status = status;
  logActivity(d, ctx.actor, 'shop.pass.' + status, p.clientId ? { type: 'client', id: p.clientId } : { type: 'user', id: ctx.actor }, { plan: planOf(d, p.planId)?.name ?? '' });
  return yes(p);
}
/** Records the month's payment of a membership: the next billing date moves a month and the visits start over. */
export function renewMembership(d: DemoState, ctx: Ctx, passId: string, method: PayMethod, now: Date = new Date()): ShopResult<Pass> {
  const p = (d.passes ?? []).find((x) => x.id === passId); if (!p || p.kind !== 'membership') return no('not_found');
  if (p.status === 'cancelled') return no('not_active');
  const plan = planOf(d, p.planId); if (!plan) return no('invalid');
  p.renews = plusMonth(p.renews && p.renews > toISODate(now) ? p.renews : toISODate(now));
  p.visitsLeft = plan.visits ? plan.visits : undefined;
  p.status = 'active';
  p.uses = [...p.uses, { id: uid('pu'), at: now.toISOString(), by: ctx.actor, note: 'renewal', amount: -plan.price }];
  if (method === 'cash') addCashEntry(d, ctx, { date: toISODate(now), dir: 'in', amount: plan.price, category: 'client_payment', memo: plan.name });
  logActivity(d, ctx.actor, 'shop.pass.renewed', p.clientId ? { type: 'client', id: p.clientId } : { type: 'user', id: ctx.actor }, { plan: plan.name, amount: money2(plan.price) });
  return yes(p);
}
/** Morning sweep: a membership whose billing date passed without a recorded payment is past due; expired cards and packages close. */
export function sweepPasses(d: DemoState, _ctx: Ctx, on: ISODate = today()): number {
  let n = 0;
  for (const p of d.passes ?? []) {
    if (p.status === 'active' && p.kind === 'membership' && p.renews && p.renews < on) { p.status = 'past_due'; n++; }
    if ((p.status === 'active' || p.status === 'paused') && p.kind !== 'membership' && p.expires && p.expires < on) { p.status = 'expired'; n++; }
  }
  return n;
}

/* =====================================================================================================================
   Visits: every finished service, booked or walked in, as one list
   ===================================================================================================================== */

export interface Visit {
  kind: 'appointment' | 'walkin';
  id: string;
  date: ISODate;
  staffId: string;
  clientId?: string;
  name: string;
  serviceId?: string;
  /** What the service brought in, without the tip. */
  amount: number;
  tip: number;
  own: boolean;
  passId?: string;
}
export function visits(d: Pick<DemoState, 'appointments' | 'walkins' | 'clients' | 'leads' | 'apptTypes' | 'catalog' | 'passes'>): Visit[] {
  const name = (id?: string) => (id ? d.clients.find((x) => x.id === id)?.name : undefined) ?? '';
  // a visit paid with a membership or package is worth what that visit's share of the pass was
  const passValue = (passId: string | undefined, key: 'apptId' | 'walkinId', id: string): number | undefined =>
    passId ? (d.passes ?? []).find((p) => p.id === passId)?.uses.find((u) => u[key] === id)?.amount : undefined;
  const appts = (d.appointments ?? []).filter((a) => a.status === 'completed').map((a): Visit => {
    const type = (d.apptTypes ?? []).find((t) => t.id === a.typeId);
    return { kind: 'appointment', id: a.id, date: a.date, staffId: a.staffId, clientId: a.clientId, name: name(a.clientId) || d.leads.find((l) => l.id === a.leadId)?.name || '',
      serviceId: type?.serviceId, amount: passValue(a.passId, 'apptId', a.id) ?? (a.paid && a.paid.method !== 'credit' ? a.paid.amount : a.fee), tip: a.tip ?? 0, own: !!a.own, passId: a.passId };
  });
  const walks = (d.walkins ?? []).filter((w) => w.status === 'done' && w.staffId).map((w): Visit => ({
    kind: 'walkin', id: w.id, date: dayOf(w.doneAt ?? w.joined), staffId: w.staffId!, clientId: w.clientId, name: w.name, serviceId: w.serviceId, amount: w.amount ?? 0, tip: w.tip ?? 0, own: false, passId: w.passId,
  }));
  return [...appts, ...walks].sort((a, b) => b.date.localeCompare(a.date));
}

/* =====================================================================================================================
   Barber pay: weekly statements
   ===================================================================================================================== */

/** Monday and Sunday of the week a date falls in. */
export function weekOf(date: ISODate): { from: ISODate; to: ISODate } {
  const dow = parseDate(date).getDay(); const back = (dow + 6) % 7;
  const from = addDaysFrom(date, -back); return { from, to: addDaysFrom(from, 6) };
}
export interface StatementLine extends Visit { rate: number; earned: number }
export interface Statement {
  staffId: string; from: ISODate; to: ISODate; pay: Chair['pay'];
  lines: StatementLine[]; visits: number; services: number; share: number; tips: number; rent: number; amount: number;
  /** Shop's part of the services (services minus the barbers' share). */
  shop: number;
  paid?: Payout;
}
/** One barber's week: every service, the rate that applied, the tips, the rent, and what is owed. */
export function statementFor(d: DemoState, staffId: string, from: ISODate): Statement {
  const { to } = weekOf(from);
  const ch = chairOf(d, staffId);
  const pay = ch?.pay ?? 'commission';
  const lines = visits(d).filter((v) => v.staffId === staffId && v.date >= from && v.date <= to).map((v): StatementLine => {
    const rate = pay === 'rent' ? 100 : v.own ? ch?.ownSplit ?? 100 : ch?.split ?? 0;
    return { ...v, rate, earned: share(v.amount, rate) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const sumC = (f: (l: StatementLine) => number) => lines.reduce((n, l) => n + c(f(l)), 0);
  const services = sumC((l) => l.amount), earned = sumC((l) => l.earned), tips = sumC((l) => l.tip);
  const rent = pay === 'rent' ? c(ch?.rent) : 0;
  const paid = (d.payouts ?? []).find((p) => p.staffId === staffId && p.from === from);
  return { staffId, from, to, pay, lines, visits: lines.length, services: d$(services), share: d$(earned), tips: d$(tips), rent: d$(rent), amount: d$(earned + tips - rent), shop: d$(services - earned), paid };
}
/** Pays a week. Only a week that is over can be paid, and only once; the figures are frozen on the payout. */
export function payStatement(d: DemoState, ctx: Ctx, staffId: string, from: ISODate, method: PayMethod, note?: string, now: Date = new Date()): ShopResult<Payout> {
  if (!barberOf(d, staffId)) return no('not_found');
  if (weekOf(from).from !== from) return no('invalid');
  if (weekOf(from).to >= toISODate(now)) return no('not_allowed');
  if ((d.payouts ?? []).some((p) => p.staffId === staffId && p.from === from)) return no('already');
  const s = statementFor(d, staffId, from);
  if (!s.visits && !s.rent) return no('empty');
  const p: Payout = { id: uid('po'), staffId, from, to: s.to, services: s.services, share: s.share, tips: s.tips, rent: s.rent, amount: s.amount, visits: s.visits, paidAt: now.toISOString(), method, by: ctx.actor, note: note?.trim() || undefined };
  d.payouts = [p, ...(d.payouts ?? [])];
  logActivity(d, ctx.actor, 'shop.payout', { type: 'user', id: staffId }, { name: barberOf(d, staffId)?.name ?? '', amount: money2(p.amount) });
  return yes(p);
}

/* =====================================================================================================================
   Loyalty points
   ===================================================================================================================== */

export interface Points { earned: number; spent: number; balance: number; visits: number; spentMoney: number }
export function pointsOf(d: DemoState, clientId: string): Points {
  const s = shopSettings(d);
  const mine = visits(d).filter((v) => v.clientId === clientId);
  const spentMoney = d$(mine.reduce((n, v) => n + c(v.amount), 0));
  const earned = Math.floor(spentMoney * s.pointsPerDollar);
  const spent = (d.passes ?? []).filter((p) => p.clientId === clientId && p.note?.startsWith('reward:')).reduce((n, p) => n + (Number(p.note!.slice(7)) || 0), 0);
  return { earned, spent, balance: Math.max(0, earned - spent), visits: mine.length, spentMoney };
}
/** Turns points into a reward: a gift card of the reward's value, in the client's name. */
export function redeemPoints(d: DemoState, ctx: Ctx, clientId: string, now: Date = new Date()): ShopResult<Pass> {
  const s = shopSettings(d); const client = d.clients.find((x) => x.id === clientId); if (!client) return no('not_found');
  if (pointsOf(d, clientId).balance < s.rewardPoints || !s.rewardValue) return no('not_enough');
  const pass: Pass = {
    id: uid('ps'), kind: 'gift_card', clientId, status: 'active', start: toISODate(now), balance: s.rewardValue, code: giftCode(),
    sold: { at: now.toISOString(), amount: 0, method: 'cash', by: ctx.actor }, uses: [], note: `reward:${s.rewardPoints}`,
  };
  d.passes = [pass, ...(d.passes ?? [])];
  logActivity(d, ctx.actor, 'shop.points.redeemed', { type: 'client', id: clientId }, { points: s.rewardPoints, amount: money2(s.rewardValue) });
  return yes(pass);
}

/* =====================================================================================================================
   Insights
   ===================================================================================================================== */

export interface DueClient { client: Client; last: ISODate; gap: number; overdue: number; staffId?: string; visits: number }
/**
 * Clients due for their next cut: the time since their last visit is past their own usual gap (or the shop's default for
 * someone with a single visit), and nothing is booked for them yet. The longest overdue first.
 */
export function dueForCut(d: DemoState, on: ISODate = today()): DueClient[] {
  const all = visits(d);
  const booked = new Set((d.appointments ?? []).filter((a) => a.date >= on && BOOKED.includes(a.status)).map((a) => a.clientId));
  const waiting = new Set(inLine(d).map((w) => w.clientId));
  const out: DueClient[] = [];
  for (const cl of d.clients) {
    if (cl.lifecycle === 'former' || booked.has(cl.id) || waiting.has(cl.id)) continue;
    const mine = all.filter((v) => v.clientId === cl.id).map((v) => v.date).sort();
    if (!mine.length) continue;
    const last = mine[mine.length - 1];
    let gap = shopSettings(d).rebookDays;
    if (mine.length >= 2) {
      const gaps = mine.slice(1).map((x, i) => daysBetween(mine[i], x)).filter((g) => g > 0);
      if (gaps.length) gap = Math.max(7, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
    }
    const overdue = daysBetween(last, on) - gap;
    if (overdue < 0) continue;
    const lastVisit = all.find((v) => v.clientId === cl.id && v.date === last);
    out.push({ client: cl, last, gap, overdue, staffId: lastVisit?.staffId, visits: mine.length });
  }
  return out.sort((a, b) => b.overdue - a.overdue);
}
/** No-shows per client, counted over every appointment on file. */
export function noShows(d: Pick<DemoState, 'appointments'>, clientId: string): number {
  return (d.appointments ?? []).filter((a) => a.clientId === clientId && a.status === 'no_show').length;
}
/** Upcoming appointments of clients who missed before: the front desk confirms these by phone. */
export function atRisk(d: DemoState, on: ISODate = today()): { appointment: Appointment; misses: number }[] {
  return (d.appointments ?? []).filter((a) => a.clientId && a.date >= on && BOOKED.includes(a.status))
    .map((a) => ({ appointment: a, misses: noShows(d, a.clientId!) })).filter((x) => x.misses > 0)
    .sort((a, b) => (a.appointment.date + a.appointment.time).localeCompare(b.appointment.date + b.appointment.time));
}
/** Visits and arrivals by weekday (0 Monday) and hour over the last weeks, for the busy-hours chart. */
export function busyHours(d: DemoState, weeks = 4, on: ISODate = today()): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const since = addDaysFrom(on, -weeks * 7);
  for (const a of d.appointments ?? []) {
    if (a.date < since || a.date > on || a.status.startsWith('cancelled')) continue;
    const dow = (parseDate(a.date).getDay() + 6) % 7; grid[dow][Number(a.time.slice(0, 2))]++;
  }
  for (const w of d.walkins ?? []) {
    const j = new Date(w.joined); const day = toISODate(j); if (day < since || day > on) continue;
    grid[(j.getDay() + 6) % 7][j.getHours()]++;
  }
  return grid;
}
/** Of the open hours today, how much of each barber's time is booked or in the chair. 0 to 1. */
export function chairLoad(d: DemoState, staffId: string, on: ISODate = today()): number {
  const hours = d.config?.hours; const open = hours ? minutesOfDay(hours.close) - minutesOfDay(hours.open) : 600;
  if (open <= 0) return 0;
  const booked = (d.appointments ?? []).filter((a) => a.staffId === staffId && a.date === on && !a.status.startsWith('cancelled') && a.status !== 'no_show').reduce((n, a) => n + a.minutes, 0);
  const walked = walkinsOn(d, on).filter((w) => w.staffId === staffId && (w.status === 'done' || w.status === 'in_service')).reduce((n, w) => n + minutesFor(d, w.serviceId), 0);
  return Math.min(1, (booked + walked) / open);
}
const minutesOfDay = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export interface DayNumbers { visits: number; services: number; tips: number; walkins: number; avgWait: number; served: number; left: number }
/** Today at a glance: what came in, the tips, the walk-ins served and how long they waited on average. */
export function dayNumbers(d: DemoState, on: ISODate = today()): DayNumbers {
  const v = visits(d).filter((x) => x.date === on);
  const w = walkinsOn(d, on);
  const served = w.filter((x) => x.startedAt);
  const waits = served.map((x) => (new Date(x.startedAt!).getTime() - new Date(x.joined).getTime()) / 60000);
  return {
    visits: v.length, services: d$(v.reduce((n, x) => n + c(x.amount), 0)), tips: d$(v.reduce((n, x) => n + c(x.tip), 0)),
    walkins: w.length, served: served.length, left: w.filter((x) => x.status === 'left' || x.status === 'no_show').length,
    avgWait: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
  };
}

/** Morning: memberships about to bill, clients due for a cut. The rule engine acts once per record and occasion. */
export function runShopTimed(d: DemoState, ctx: Ctx, on: ISODate = today()): void {
  if (!(d.chairs ?? []).length && !(d.passes ?? []).length) return;
  sweepPasses(d, ctx, on);
  for (const p of d.passes ?? []) {
    if (p.kind !== 'membership' || p.status !== 'active' || !p.renews) continue;
    const left = daysBetween(on, p.renews); if (left < 0 || left > 14) continue;
    const client = d.clients.find((x) => x.id === p.clientId); if (!client) continue;
    const plan = planOf(d, p.planId);
    emit(d, ctx, ev('pass.renews'), { ref: { type: 'client', id: client.id }, client, extra: { days: left, plan: plan?.name ?? '', amount: plan?.price ?? 0, occasion: p.renews } });
  }
  for (const due of dueForCut(d, on)) {
    emit(d, ctx, ev('client.due'), { ref: { type: 'client', id: due.client.id }, client: due.client, extra: { days: due.overdue, gap: due.gap, last: due.last, barber: barberOf(d, due.staffId)?.name ?? '', occasion: due.last } });
  }
}
