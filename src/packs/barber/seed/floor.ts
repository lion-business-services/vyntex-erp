// The shop floor of the sample shop, generated: ten weeks of visits for each regular on their own rhythm, the walk-ins of
// the last two weeks, today's floor as it is right now (people in chairs, someone called, a line waiting), the
// memberships, packages and gift cards those visits were paid with, and the weekly pay already handed out.
// A fixed random sequence makes every visitor see the same sample, in either language. Dates are relative to today and
// times to the current hour, so the floor always looks live. Amounts are made-up sample prices.
import type { Appointment, Chair, Client, ISODate, Lang, Pass, PassPlan, PassUse, Payout, WalkIn } from '@/domain/types';
import type { CatalogService, AppointmentType } from '@/domain/types';
import { HABITS } from './clients';
import { statementFor, weekOf } from '@/domain/actions/shop';
import { addDaysFrom, toISODate } from '@/lib/dates';
import { day, txFor } from '../../practice/seed/util';

/** A small, fixed pseudo-random sequence (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** A moment on a day (offset from today) at minutes past midnight, as an ISO timestamp. */
const momentAt = (off: number, minutes: number) => { const x = new Date(); x.setDate(x.getDate() + off); x.setHours(0, minutes, 0, 0); return x.toISOString(); };

const WALKIN_NAMES = ['Jayden M.', 'Carlos V.', 'Ahmed R.', 'Trevor B.', 'Kenji S.', 'Dominic P.', 'Elijah W.', 'Luca F.', 'Andre K.', 'Hector G.', 'Ryan D.', 'Miles J.', 'Pedro A.', 'Sean O.', 'Zion T.', 'Bryce L.'];

export interface FloorInput { catalog: CatalogService[]; apptTypes: AppointmentType[]; passPlans: PassPlan[]; clients: Client[]; chairs: Chair[] }
export function floor(lang: Lang, x: FloorInput): { appointments: Appointment[]; walkins: WalkIn[]; passes: Pass[]; payouts: Payout[] } {
  const tx = txFor(lang);
  const r = rng(20261015);
  const pick = <T,>(list: T[]): T => list[Math.floor(r() * list.length)];
  const price = (sv: string) => x.catalog.find((s) => s.id === sv)?.tiers[0]?.price ?? 0;
  const typeOf = (sv: string) => x.apptTypes.find((a) => a.serviceId === sv) ?? x.apptTypes[0];
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  // today's floor is drawn around the current time, kept inside today
  const center = Math.min(Math.max(nowMin, 120), 22 * 60);

  /* ---------- who is busy when ---------- */
  const busy = new Map<string, [number, number][]>();
  const free = (staff: string, off: number, start: number, minutes: number) => !(busy.get(`${staff}|${off}`) ?? []).some(([s, e]) => start < e + 5 && start + minutes + 5 > s);
  const take = (staff: string, off: number, start: number, minutes: number) => { const k = `${staff}|${off}`; busy.set(k, [...(busy.get(k) ?? []), [start, start + minutes]]); };
  /** A start time between 9:00 and 18:00 on the quarter hour that the barber has free, or -1. */
  const slot = (staff: string, off: number, minutes: number, from = 9 * 60, to = 18 * 60) => {
    for (let tries = 0; tries < 40; tries++) { const s = from + Math.floor(r() * ((to - from) / 15)) * 15; if (free(staff, off, s, minutes)) return s; }
    return -1;
  };

  /* ---------- memberships, packages and gift cards ---------- */
  const plan = (id: string) => x.passPlans.find((p) => p.id === id)!;
  const visitValue = (p: PassPlan, menu: number) => (p.visits ? Math.round((p.price / p.visits) * 100) / 100 : menu);
  const sold = (off: number, amount: number, method: Pass['sold']['method'], by = 'u6') => ({ at: momentAt(off, 11 * 60), amount, method, by });
  const passes: Pass[] = [
    { id: 'ps1', planId: 'pp-club', kind: 'membership', clientId: 'bc1', status: 'active', start: day(-40), renews: addDaysFrom(day(-40), 0), sold: sold(-40, 60, 'card'), uses: [] },
    { id: 'ps2', planId: 'pp-club', kind: 'membership', clientId: 'bc3', status: 'active', start: day(-66), renews: day(-66), sold: sold(-66, 60, 'card', 'u2'), uses: [] },
    { id: 'ps3', planId: 'pp-beard', kind: 'membership', clientId: 'bc5', status: 'active', start: day(-60), renews: day(-60), sold: sold(-60, 45, 'cash', 'u1'), uses: [] },
    { id: 'ps4', planId: 'pp-club', kind: 'membership', clientId: 'bc8', status: 'past_due', start: day(-70), renews: day(-70), sold: sold(-70, 60, 'card', 'u1'), uses: [] },
    { id: 'ps5', planId: 'pp-club', kind: 'membership', clientId: 'bc12', status: 'paused', start: day(-70), renews: day(-70), sold: sold(-70, 60, 'card', 'u4'), uses: [],
      note: tx('Paused while he is traveling for work.', 'En pausa mientras viaja por trabajo.') },
    { id: 'ps6', planId: 'pp-five', kind: 'package', clientId: 'bc6', status: 'active', start: day(-70), expires: addDaysFrom(day(-70), 180), visitsLeft: 5, sold: sold(-70, 160, 'card', 'u3'), uses: [] },
    { id: 'ps7', planId: 'pp-kids', kind: 'package', clientId: 'bc14', status: 'active', start: day(-45), expires: addDaysFrom(day(-45), 120), visitsLeft: 4, sold: sold(-45, 85, 'card'), uses: [] },
    // a gift card bought for someone who is not a client yet
    { id: 'ps8', planId: 'pp-gift', kind: 'gift_card', holder: tx('Gift for Daniel (from his sister)', 'Regalo para Daniel (de su hermana)'), code: 'NB7Q-K2M4', status: 'active', start: day(-12), expires: addDaysFrom(day(-12), 365), balance: 50, sold: sold(-12, 50, 'card'), uses: [] },
    // a gift card with a little left on it
    { id: 'ps9', planId: 'pp-gift', kind: 'gift_card', clientId: 'bc9', code: 'NB3H-P8W6', status: 'active', start: day(-30), expires: addDaysFrom(day(-30), 365), balance: 50, sold: sold(-30, 50, 'cash'), uses: [] },
  ];
  const memberPass = (clientId: string) => passes.find((p) => p.clientId === clientId && (p.kind === 'membership' || p.kind === 'package'));
  /** Pays a visit with the client's pass when it covers the service and has a visit left that month. Returns the pass. */
  const usePass = (clientId: string, sv: string, off: number, minutes: number, apptId: string): Pass | undefined => {
    const p = memberPass(clientId); if (!p) return undefined;
    const pl = plan(p.planId!);
    if (pl.serviceIds.length && !pl.serviceIds.includes(sv)) return undefined;
    if (day(off) < p.start || (p.expires && day(off) > p.expires)) return undefined;
    if (p.kind === 'membership') {
      // the billing month this visit falls in
      let start = p.start; let next = addMonth(start);
      while (next <= day(off)) { start = next; next = addMonth(start); }
      const inPeriod = p.uses.filter((u) => u.at.slice(0, 10) >= start && u.at.slice(0, 10) < next && u.apptId).length;
      if (pl.visits && inPeriod >= pl.visits) return undefined;
      if (p.status === 'paused' && day(off) > day(-10)) return undefined;
      if (p.status === 'past_due' && day(off) > day(-3)) return undefined;
    } else if ((p.visitsLeft ?? 0) <= 0) return undefined;
    const use: PassUse = { id: `${p.id}-u${p.uses.length + 1}`, at: momentAt(off, minutes), amount: visitValue(pl, price(sv)), apptId, by: 'u6' };
    p.uses.push(use);
    if (p.kind === 'package') { p.visitsLeft = (p.visitsLeft ?? 0) - 1; if (p.visitsLeft === 0) p.status = 'used_up'; }
    return p;
  };

  /* ---------- appointments: ten weeks of regulars, then the next two weeks ---------- */
  const appointments: Appointment[] = [];
  let an = 0;
  const book = (o: { clientId: string; staffId: string; sv: string; off: number; start: number; status: Appointment['status']; created?: number }): Appointment => {
    const type = typeOf(o.sv); const fee = price(o.sv);
    const a: Appointment = {
      id: `ba${++an}`, typeId: type.id, clientId: o.clientId, staffId: o.staffId, officeId: 'o1', date: day(o.off), time: hhmm(o.start), minutes: type.minutes, mode: 'office',
      status: o.status, fee, created: momentAt(o.created ?? o.off - 5, 10 * 60), createdBy: pick(['u6', 'u6', o.staffId, 'system']),
    };
    take(o.staffId, o.off, o.start, type.minutes);
    appointments.push(a);
    return a;
  };
  /** Records how a finished visit was paid: a pass, or card or cash with a tip. */
  const checkout = (a: Appointment, off: number, start: number, sv: string, own: boolean) => {
    const p = usePass(a.clientId!, sv, off, start + a.minutes, a.id);
    if (own) a.own = true;
    if (p) { a.passId = p.id; a.tip = r() < 0.7 ? pick([5, 5, 10, 8]) : undefined; return; }
    if (sv === 'sv-fade' && r() < 0.15) { a.addOns = [{ name: tx('Hair design', 'Diseño en el cabello'), price: 15 }]; a.fee += 15; }
    const method = r() < 0.7 ? 'card' : 'cash';
    a.paid = { at: momentAt(off, start + a.minutes), method, ref: method === 'card' ? `SAMPLE-${1000 + an}` : '', amount: a.fee };
    const tip = Math.round(a.fee * (0.12 + r() * 0.13));
    if (r() < 0.9) a.tip = tip;
  };

  for (const [clientId, h] of Object.entries(HABITS)) {
    if (h.walkIn) continue;
    const last = h.lastAgo ? -h.lastAgo : -1;
    let off = -h.since + Math.floor(r() * 3);
    let missed = 0;
    while (off <= last) {
      const staff = h.barber !== 'u4' && r() < 0.1 ? pick(['u1', 'u2', 'u3']) : h.barber;
      const type = typeOf(h.service);
      const start = slot(staff, off, type.minutes);
      if (start >= 0) {
        let status: Appointment['status'] = 'completed';
        if (h.noShows && missed < h.noShows && off > -45) { status = 'no_show'; missed++; }
        else if (r() < 0.04) status = 'cancelled_client';
        const a = book({ clientId, staffId: staff, sv: h.service, off, start, status, created: off - 3 - Math.floor(r() * 10) });
        if (status === 'completed') checkout(a, off, start, h.service, !!h.own && staff === h.barber);
        if (status === 'cancelled_client') a.cancelReason = tx('Called to cancel: work came up.', 'Llamó para cancelar: le salió trabajo.');
      }
      off += h.every + Math.floor(r() * 5) - 2;
    }
    // the next visit: most regulars already booked it; the lapsed ones did not
    if (h.lastAgo) continue;
    if (off <= 0) off = 1 + Math.floor(r() * 3);
    if (off <= 14 && r() < 0.8) {
      const type = typeOf(h.service);
      const start = slot(h.barber, off, type.minutes);
      if (start >= 0) book({ clientId, staffId: h.barber, sv: h.service, off, start, status: r() < 0.5 ? 'confirmed' : 'scheduled', created: -Math.floor(r() * 8) });
    }
  }

  /* ---------- today, around now ---------- */
  const today: { clientId: string; staff: string; sv: string; at: number; status: Appointment['status'] }[] = [
    { clientId: 'bc22', staff: 'u2', sv: 'sv-gray', at: center - 150, status: 'completed' },
    { clientId: 'bc18', staff: 'u1', sv: 'sv-shave', at: center - 120, status: 'completed' },
    { clientId: 'bc15', staff: 'u1', sv: 'sv-senior', at: center - 75, status: 'completed' },
    { clientId: 'bc4', staff: 'u3', sv: 'sv-cut', at: center - 90, status: 'completed' },
    { clientId: 'bc23', staff: 'u4', sv: 'sv-fade', at: center - 100, status: 'completed' },
    // in the chair right now
    { clientId: 'bc7', staff: 'u2', sv: 'sv-combo', at: center - 20, status: 'confirmed' },
    { clientId: 'bc11', staff: 'u4', sv: 'sv-fade', at: center - 10, status: 'confirmed' },
    // later today
    { clientId: 'bc16', staff: 'u3', sv: 'sv-fade', at: center + 60, status: 'confirmed' },
    { clientId: 'bc24', staff: 'u1', sv: 'sv-cut', at: center + 150, status: 'scheduled' },
    { clientId: 'bc17', staff: 'u2', sv: 'sv-cut', at: center + 90, status: 'confirmed' },
    { clientId: 'bc13', staff: 'u5', sv: 'sv-kids', at: center + 165, status: 'scheduled' },
  ];
  for (const t of today) {
    const at = Math.round(t.at / 15) * 15;
    if (at < 0 || at + typeOf(t.sv).minutes > 23 * 60 + 45) continue;
    // a regular already on the books for today keeps the generated one; this one is their visit
    const dup = appointments.findIndex((a) => a.clientId === t.clientId && a.date === day(0));
    if (dup >= 0) appointments.splice(dup, 1);
    const a = book({ clientId: t.clientId, staffId: t.staff, sv: t.sv, off: 0, start: at, status: t.status, created: -3 });
    if (t.status === 'completed') checkout(a, 0, at, t.sv, !!HABITS[t.clientId]?.own);
  }

  /* ---------- walk-ins: the last two weeks, then today's line ---------- */
  const walkins: WalkIn[] = [];
  let wn = 0;
  const walkSvcs = ['sv-cut', 'sv-cut', 'sv-fade', 'sv-fade', 'sv-beard', 'sv-kids', 'sv-combo'];
  const takers = ['u1', 'u2', 'u3', 'u3', 'u5', 'u5'];
  const walk = (off: number, joinedMin: number, o: Partial<WalkIn> & Pick<WalkIn, 'name' | 'status'>, ticket: number): WalkIn => {
    const w: WalkIn = { id: `bw${++wn}`, ticket, joined: momentAt(off, joinedMin), source: 'desk', by: 'u6', ...o };
    walkins.push(w); return w;
  };
  for (let off = -13; off <= -1; off++) {
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const joinedMin = 9 * 60 + 30 + Math.floor(r() * 8 * 60);
      const sv = pick(walkSvcs); const staff = pick(takers); const mins = typeOf(sv).minutes;
      const known = r() < 0.25 ? pick(['bc20', 'bc21', 'bc9', 'bc4']) : undefined;
      const name = known ? x.clients.find((c) => c.id === known)!.name : pick(WALKIN_NAMES);
      if (r() < 0.08) { walk(off, joinedMin, { name, serviceId: sv, status: 'left', doneAt: momentAt(off, joinedMin + 25), clientId: known, source: r() < 0.3 ? 'kiosk' : 'desk' }, i + 1); continue; }
      const wait = 5 + Math.floor(r() * 30);
      const start = joinedMin + wait;
      if (!free(staff, off, start, mins)) continue;
      take(staff, off, start, mins);
      const method = r() < 0.55 ? 'cash' : 'card';
      walk(off, joinedMin, {
        name, clientId: known, serviceId: sv, status: 'done', staffId: staff, chairId: x.chairs.find((c) => c.staffId === staff)?.id, calledAt: momentAt(off, start - 1), startedAt: momentAt(off, start),
        doneAt: momentAt(off, start + mins), amount: price(sv), tip: r() < 0.85 ? Math.round(price(sv) * (0.1 + r() * 0.15)) : 0, method, source: r() < 0.3 ? 'kiosk' : 'desk', textOk: r() < 0.6,
      }, i + 1);
    }
  }
  // today: done this morning, one who left, one in chair 1, one called to chair 3, and the line
  const t0 = Math.max(center - 200, 30);
  const doneToday: [number, string, string, string?][] = [[t0, 'sv-cut', 'u1'], [t0 + 20, 'sv-fade', 'u3', 'bc21'], [t0 + 45, 'sv-kids', 'u5'], [t0 + 70, 'sv-beard', 'u3']];
  let ticket = 0;
  for (const [joinedMin, sv, staff, known] of doneToday) {
    const start = joinedMin + 12; const mins = typeOf(sv).minutes;
    if (start + mins >= center) continue;
    take(staff, 0, start, mins);
    walk(0, joinedMin, {
      name: known ? x.clients.find((c) => c.id === known)!.name : pick(WALKIN_NAMES), clientId: known, serviceId: sv, status: 'done', staffId: staff, chairId: x.chairs.find((c) => c.staffId === staff)?.id,
      calledAt: momentAt(0, start - 1), startedAt: momentAt(0, start), doneAt: momentAt(0, start + mins), amount: price(sv), tip: Math.round(price(sv) * 0.18), method: ticket % 2 ? 'cash' : 'card', textOk: true,
    }, ++ticket);
  }
  const at = (m: number) => Math.max(1, center - m);
  walk(0, at(70), { name: 'Hector G.', serviceId: 'sv-fade', status: 'left', doneAt: momentAt(0, at(40)), source: 'kiosk', note: tx('Could not wait, will come back tomorrow.', 'No pudo esperar, regresa mañana.') }, ++ticket);
  walk(0, at(30), { name: 'Bryce L.', serviceId: 'sv-cut', status: 'in_service', staffId: 'u1', chairId: 'ch1', calledAt: momentAt(0, at(13)), startedAt: momentAt(0, at(12)), source: 'desk', textOk: true }, ++ticket);
  walk(0, at(22), { name: x.clients.find((c) => c.id === 'bc20')!.name, clientId: 'bc20', phone: '609-555-0730', serviceId: 'sv-cut', status: 'called', staffId: 'u3', chairId: 'ch3', calledAt: momentAt(0, at(2)), source: 'kiosk', textOk: true }, ++ticket);
  walk(0, at(16), { name: 'Elijah W.', serviceId: 'sv-fade', status: 'waiting', source: 'desk', textOk: true, phone: '609-555-0781' }, ++ticket);
  walk(0, at(11), { name: 'Kenji S.', serviceId: 'sv-combo', prefStaffId: 'u2', status: 'waiting', source: 'kiosk', textOk: true, phone: '609-555-0782', note: tx('Asked for Keisha.', 'Pidió a Keisha.') }, ++ticket);
  walk(0, at(7), { name: 'Luca F.', serviceId: 'sv-kids', status: 'waiting', source: 'online', textOk: true, phone: '609-555-0783', note: tx('Checked in from the website for his son.', 'Se registró desde el sitio web para su hijo.') }, ++ticket);
  walk(0, at(3), { name: 'Ryan D.', serviceId: 'sv-beard', status: 'waiting', source: 'desk' }, ++ticket);

  // the gift card with a little left: two walk-in visits paid with it
  const gc = passes.find((p) => p.id === 'ps9')!;
  const gcVisits = walkins.filter((w) => w.status === 'done' && w.clientId === 'bc9').slice(0, 1);
  for (const w of gcVisits) { const amount = Math.min(gc.balance ?? 0, w.amount ?? 0); gc.balance = Math.round(((gc.balance ?? 0) - amount) * 100) / 100; w.method = 'pass'; w.passId = gc.id; gc.uses.push({ id: `${gc.id}-u${gc.uses.length + 1}`, at: w.doneAt!, amount, walkinId: w.id, by: 'u6' }); }
  if (!gcVisits.length) { gc.balance = 12.5; gc.uses.push({ id: `${gc.id}-u1`, at: momentAt(-8, 15 * 60), amount: 37.5, by: 'u6', note: tx('Haircut and products', 'Corte y productos') }); }

  /* ---------- membership billing dates and visits left this month ---------- */
  for (const p of passes) {
    if (p.kind !== 'membership') continue;
    const pl = plan(p.planId!);
    let start = p.start; let next = addMonth(start);
    while (next <= day(0)) {
      // every month that came round was paid at the desk, except where the sample says otherwise
      if (!(p.status === 'past_due' && next >= day(-3))) p.uses.push({ id: `${p.id}-m${p.uses.length + 1}`, at: momentAt(daysFrom(next), 10 * 60), by: 'u6', note: 'renewal', amount: -pl.price });
      start = next; next = addMonth(start);
    }
    p.renews = p.status === 'past_due' ? start : next;
    const used = p.uses.filter((u) => u.apptId && u.at.slice(0, 10) >= start).length;
    p.visitsLeft = pl.visits ? Math.max(0, pl.visits - used) : undefined;
    p.uses.sort((a, b) => a.at.localeCompare(b.at));
  }
  // Jordan's billing date comes round in two days: the renewal reminder has something to show
  const jordan = passes.find((p) => p.id === 'ps1')!;
  jordan.renews = day(2);

  /* ---------- weekly pay: two weeks ago paid to everyone, last week only the chair rent so far ---------- */
  const lastWeek = weekOf(day(-7)).from, prevWeek = weekOf(day(-14)).from;
  const view = { appointments, walkins, passes, payouts: [] as Payout[], chairs: x.chairs, clients: x.clients, leads: [], apptTypes: x.apptTypes, catalog: x.catalog, users: [] } as unknown as Parameters<typeof statementFor>[0];
  const payouts: Payout[] = [];
  const pay = (staffId: string, from: ISODate, off: number, method: Payout['method']) => {
    const s = statementFor(view, staffId, from);
    if (!s.visits && !s.rent) return;
    payouts.push({ id: `bp-${staffId}-${from}`, staffId, from, to: s.to, services: s.services, share: s.share, tips: s.tips, rent: s.rent, amount: s.amount, visits: s.visits, paidAt: momentAt(off, 11 * 60), method, by: 'u1' });
  };
  const mondayAfter = (from: ISODate) => daysFrom(addDaysFrom(from, 7));
  for (const u of ['u2', 'u3', 'u4', 'u5']) pay(u, prevWeek, Math.min(-1, mondayAfter(prevWeek)), u === 'u4' ? 'zelle' : 'transfer');
  pay('u4', lastWeek, Math.min(0, mondayAfter(lastWeek)), 'zelle');

  return { appointments: appointments.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), walkins, passes, payouts };
}

const addMonth = (date: ISODate) => { const [y, m, d] = date.split('-').map(Number); return toISODate(new Date(y, m, d)); };
/** Day offset of a date from today. */
const daysFrom = (date: ISODate) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d).getTime() - t.getTime()) / 86400000); };
