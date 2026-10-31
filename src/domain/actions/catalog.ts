// Service catalog and playbooks: what a company sells, at which prices, and the list of tasks that starts with each service.
// The catalog is company data, so every edition can keep one. A field edition with an empty catalog behaves as it always did.
//
// Ids of connected systems (`externalIds`) follow the owner's standing rule for the Square catalog: insert only, never
// upsert. A sync may add a service or a tier the other system does not have yet and write the new id here once
// (`linkExternalId`); it never replaces an id that is already there, and nothing in this file copies one to another record.
import type { CatalogService, CatalogServiceText, CatalogTier, CatalogTierKind, DemoState, Job, Lang, Playbook, PlaybookStep, Task, TeamUser } from '../types';
import { type Ctx, logActivity } from '../context';
import { addDaysFrom, today } from '@/lib/dates';
import { uid } from '@/lib/id';

/** Fields the catalog keeps that the shared model does not name yet. The database keeps unknown fields, so nothing is lost. */
export type Service = CatalogService & { /** Short code the business uses for the service. */ code?: string; /** For the team only; never shown to a client. */ internalNote?: string };
/** The welcome message of a playbook in other languages, next to `welcome`. */
export type PlaybookFull = Playbook & { welcomeI18n?: Partial<Record<Lang, string>> };

export const TIER_UNITS: CatalogTier['unit'][] = ['flat', 'hour', 'month', 'quarter', 'year'];
export const TIER_KINDS: CatalogTierKind[] = ['setup', 'recurring', 'hourly', 'one_time', 'per_unit'];

/* ---------- reading ---------- */
/** The name in the viewer's language when the business wrote one, otherwise the name as entered. */
export const serviceName = (s: CatalogService, lang: Lang): string => s.i18n?.[lang]?.name || s.name;
export const serviceDescription = (s: CatalogService, lang: Lang): string => s.i18n?.[lang]?.description || s.description || '';
/** "What's included" in the viewer's language, else the base list. */
export const serviceHighlights = (s: CatalogService, lang: Lang): string[] => (s.i18n?.[lang]?.highlights?.length ? s.i18n[lang]!.highlights! : s.highlights ?? []);
/** "Not included" in the viewer's language, else the base list. */
export const serviceExcludes = (s: CatalogService, lang: Lang): string[] => (s.i18n?.[lang]?.excludes?.length ? s.i18n[lang]!.excludes! : s.excludes ?? []);
export const serviceBestFor = (s: CatalogService, lang: Lang): string => s.i18n?.[lang]?.bestFor || s.bestFor || '';
/** How long the service takes to deliver, in the viewer's language when written, else the base language. */
export const serviceLeadTime = (s: CatalogService, lang: Lang): string => s.i18n?.[lang]?.leadTime || s.leadTime || '';
/** The book a service is listed in, trimmed; empty when it is in none. */
export const bookOf = (s: Pick<CatalogService, 'book'>): string => (typeof s.book === 'string' ? s.book.trim() : '');
/**
 * The price a tier puts on new work. A quoted tier puts nothing: the person types the agreed amount, so a quote never
 * lands on an engagement, an estimate or an opportunity as $0 or as its starting price.
 */
export const tierAmount = (tier: CatalogTier | undefined): number => (tier && !tier.quote ? tier.price : 0);
export const serviceOf = (d: Pick<DemoState, 'catalog'>, id: string | undefined): Service | undefined => (id ? (d.catalog ?? []).find((s) => s.id === id) : undefined);
/** The named tier, or the first one: the first tier is the price a service starts from. */
export const tierOf = (s: CatalogService | undefined, tierId?: string): CatalogTier | undefined => s?.tiers.find((x) => x.id === tierId) ?? s?.tiers[0];
export const playbookOf = (d: Pick<DemoState, 'playbooks'>, id: string | undefined): PlaybookFull | undefined => (id ? (d.playbooks ?? []).find((p) => p.id === id) : undefined);
/** Services that can be picked for new work. A retired service stays on the engagements it is already on. */
export const activeServices = (d: Pick<DemoState, 'catalog'>): Service[] => (d.catalog ?? []).filter((s) => s.active);
/** How many records point at a service: a service that is in use is retired, never deleted. */
export function serviceUse(d: DemoState, id: string) {
  return {
    jobs: d.jobs.filter((j) => j.serviceId === id).length,
    leads: d.leads.filter((l) => l.serviceIds?.includes(id)).length,
    rules: (d.crossSell ?? []).filter((r) => r.suggestServiceId === id || r.whenServiceIds.includes(id) || r.unlessServiceIds?.includes(id)).length,
    opportunities: (d.opportunities ?? []).filter((o) => o.serviceId === id).length,
  };
}

/* ---------- services ---------- */
export type TierInput = Omit<CatalogTier, 'id' | 'externalIds'> & { id?: string };
export type ServiceInput = Omit<Service, 'id' | 'tiers' | 'externalIds'> & { tiers: TierInput[] };

const clean = (s: string | undefined) => (s ?? '').trim();
const cents = (n: number) => Math.max(0, Math.round((Number(n) || 0) * 100) / 100);

/** A list of short lines without empty ones, or nothing. */
const lines = (l: unknown): string[] | undefined => { const out = Array.isArray(l) ? l.map((x) => clean(String(x ?? ''))).filter(Boolean) : []; return out.length ? out : undefined; };
/** One language's text without empty entries. Fields this file does not know are kept as they are. */
function tidyText(v: CatalogServiceText | undefined): CatalogServiceText | undefined {
  const { name: n, description: dsc, highlights: h, excludes: x, bestFor: b, ...rest } = v ?? {};
  const name = clean(n); const description = clean(dsc); const highlights = lines(h); const excludes = lines(x); const bestFor = clean(b);
  const out: CatalogServiceText = { ...rest, ...(name ? { name } : {}), ...(description ? { description } : {}), ...(highlights ? { highlights } : {}), ...(excludes ? { excludes } : {}), ...(bestFor ? { bestFor } : {}) };
  return Object.keys(out).length ? out : undefined;
}
/**
 * Text per language, without empty entries. With `cur`, what the input does not mention is kept from the saved service, so
 * a form that edits names and descriptions never drops a list written somewhere else.
 */
function tidyI18n(i18n: CatalogService['i18n'], cur?: CatalogService['i18n']): CatalogService['i18n'] {
  const out: NonNullable<CatalogService['i18n']> = {};
  const langs = new Set([...Object.keys(cur ?? {}), ...Object.keys(i18n ?? {})]) as Set<Lang>;
  for (const lang of langs) {
    const given = Object.fromEntries(Object.entries(i18n?.[lang] ?? {}).filter(([, v]) => v !== undefined));
    const v = tidyText({ ...(cur?.[lang] ?? {}), ...given });
    if (v) out[lang] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
/** A field of the input when it was given, else the saved value. Lets a caller leave out what it does not edit. */
const given = <T extends object, K extends keyof T>(input: T, cur: T | undefined, k: K): T[K] | undefined => (input[k] !== undefined ? input[k] : cur?.[k]);

/**
 * Adds a service or saves changes to one. Tiers keep their order as given (the first is the starting price). A tier that
 * already has an id in a connected system cannot be dropped here: it is kept, because the other system still sells it.
 * Returns null when there is no name or no tier.
 */
export function saveService(d: DemoState, ctx: Ctx, input: ServiceInput, id?: string): Service | null {
  const name = clean(input.name);
  const named = input.tiers.filter((t) => clean(t.name));
  if (!name || !named.length) return null;
  const cur = id ? serviceOf(d, id) : undefined;
  if (id && !cur) return null;
  const tiers: CatalogTier[] = named.map((t) => {
    const old = cur?.tiers.find((x) => x.id === t.id);
    // fields of the tier this file does not know stay as they were
    const { id: _i, name: _n, price: _p, unit: _u, note: _o, externalIds: _e, quote: _q, from: _f, per: _r, kind: _k, ...rest } = old ?? ({} as CatalogTier);
    const quote = given(t as CatalogTier, old, 'quote'); const from = given(t as CatalogTier, old, 'from'); const per = clean(given(t as CatalogTier, old, 'per'));
    const kind = given(t as CatalogTier, old, 'kind');
    return {
      ...rest, id: old?.id ?? uid('tr'), name: clean(t.name), price: cents(t.price), unit: TIER_UNITS.includes(t.unit) ? t.unit : 'flat', ...(clean(t.note) ? { note: clean(t.note) } : {}),
      ...(quote ? { quote: true } : {}), ...(from ? { from: true } : {}), ...(per ? { per } : {}), ...(kind && TIER_KINDS.includes(kind) ? { kind } : {}),
      ...(old?.externalIds ? { externalIds: old.externalIds } : {}),
    };
  });
  for (const old of cur?.tiers ?? []) if (old.externalIds && Object.keys(old.externalIds).length && !tiers.some((t) => t.id === old.id)) tiers.push(old);
  const body = {
    name, category: clean(input.category), active: input.active !== false, tiers,
    description: clean(input.description) || undefined, i18n: tidyI18n(input.i18n, cur?.i18n),
    repeat: input.repeat && input.repeat !== 'once' ? input.repeat : undefined,
    playbookId: input.playbookId || undefined, appointmentTypeId: input.appointmentTypeId || undefined,
    docKinds: input.docKinds?.length ? [...new Set(input.docKinds)] : undefined,
    code: clean(input.code) || undefined, internalNote: clean(input.internalNote) || undefined,
    // the book, the lists and the places in the order: a caller that leaves one out keeps what is saved
    ...(input.book !== undefined ? { book: clean(input.book) || undefined } : {}),
    ...(input.highlights !== undefined ? { highlights: lines(input.highlights) } : {}),
    ...(input.excludes !== undefined ? { excludes: lines(input.excludes) } : {}),
    ...(input.bestFor !== undefined ? { bestFor: clean(input.bestFor) || undefined } : {}),
    ...Object.fromEntries((['bookOrder', 'order', 'categoryOrder'] as const).filter((k) => input[k] !== undefined).map((k) => [k, Number.isFinite(input[k]) ? input[k] : undefined])),
  };
  if (cur) {
    Object.assign(cur, body);
    logActivity(d, ctx.actor, 'catalog.updated', { type: 'service', id: cur.id }, { service: cur.name });
    return cur;
  }
  const s: Service = { id: uid('sv'), ...body };
  d.catalog = [...(d.catalog ?? []), s];
  logActivity(d, ctx.actor, 'catalog.created', { type: 'service', id: s.id }, { service: s.name });
  return s;
}

/** A copy to start a similar service from. It is a new service everywhere: no id of a connected system comes along. */
export function duplicateService(d: DemoState, ctx: Ctx, id: string): Service | null {
  const src = serviceOf(d, id); if (!src) return null;
  const suffix = ' (' + ctx.t('catalog.copy') + ')';
  const { externalIds: _ids, ...rest } = src;
  const s: Service = {
    ...rest, id: uid('sv'), name: src.name + suffix, active: true, code: undefined,
    i18n: src.i18n ? Object.fromEntries(Object.entries(src.i18n).map(([l, v]) => [l, { ...v, ...(v?.name ? { name: v.name + suffix } : {}) }])) : undefined,
    tiers: src.tiers.map(({ externalIds: _t, ...t }) => ({ ...t, id: uid('tr') })),
    docKinds: src.docKinds ? [...src.docKinds] : undefined,
  };
  d.catalog = [...(d.catalog ?? []), s];
  logActivity(d, ctx.actor, 'catalog.created', { type: 'service', id: s.id }, { service: s.name });
  return s;
}

/** Retires a service (it can no longer be picked for new work) or puts it back. Engagements that use it are untouched. */
export function setServiceActive(d: DemoState, ctx: Ctx, id: string, active: boolean) {
  const s = serviceOf(d, id); if (!s || s.active === active) return;
  s.active = active; d.catalog = [...d.catalog];
  logActivity(d, ctx.actor, active ? 'catalog.restored' : 'catalog.retired', { type: 'service', id }, { service: s.name });
}

/** Removes a service nobody ever used. One that is on an engagement, a lead or a rule is refused: retire it instead. */
export function deleteService(d: DemoState, _ctx: Ctx, id: string): boolean {
  const use = serviceUse(d, id);
  if (use.jobs || use.leads || use.rules || use.opportunities) return false;
  d.catalog = (d.catalog ?? []).filter((s) => s.id !== id);
  return true;
}

/** Moves a tier up or down. The first tier is the price the service starts from. */
export function moveTier(d: DemoState, _ctx: Ctx, serviceId: string, tierId: string, by: -1 | 1) {
  const s = serviceOf(d, serviceId); if (!s) return;
  const at = s.tiers.findIndex((t) => t.id === tierId); const to = at + by;
  if (at < 0 || to < 0 || to >= s.tiers.length) return;
  const next = [...s.tiers]; [next[at], next[to]] = [next[to], next[at]];
  s.tiers = next; d.catalog = [...d.catalog];
}

/**
 * Records the id a connected system gave a service or one of its tiers. Insert only: an id that is already on file is
 * never replaced (the answer is false and nothing changes), so a sync can run again without rewriting what it made before.
 */
export function linkExternalId(d: DemoState, _ctx: Ctx, target: { serviceId: string; tierId?: string }, provider: string, externalId: string): boolean {
  const s = serviceOf(d, target.serviceId); if (!s || !provider || !externalId) return false;
  const holder: { externalIds?: Record<string, string> } | undefined = target.tierId ? s.tiers.find((t) => t.id === target.tierId) : s;
  if (!holder || holder.externalIds?.[provider]) return false;
  holder.externalIds = { ...(holder.externalIds ?? {}), [provider]: externalId };
  d.catalog = [...d.catalog];
  return true;
}

/* ---------- import from a spreadsheet ---------- */
/** One line of a catalog file: a service and one of its price tiers. */
export interface CatalogRow {
  category: string; service: string; serviceEs?: string; description?: string; descriptionEs?: string; code?: string;
  repeat?: string; active?: boolean; tier: string; price: number; unit: string; note?: string; /** The book a new service is listed in. */ book?: string;
}
export interface ImportPlan { newServices: number; newTiers: number; changedTiers: number; unchanged: number; skipped: { line: number; reason: 'name' | 'price' }[] }
const key = (s: string) => clean(s).toLowerCase();
const REPEATS = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/**
 * Brings services in from rows of a spreadsheet, or says what would happen (`apply` false) so a person can look before
 * anything changes. A row belongs to an existing service when the code matches, or else the name. An existing tier of
 * the same name gets the new price, unit and note; a new tier name is added after the others. Nothing is removed and no
 * id of a connected system is touched.
 */
export function importCatalog(d: DemoState, ctx: Ctx, rows: CatalogRow[], apply: boolean): ImportPlan {
  const plan: ImportPlan = { newServices: 0, newTiers: 0, changedTiers: 0, unchanged: 0, skipped: [] };
  // work on copies when only looking
  const catalog: Service[] = apply ? (d.catalog ?? []) : (d.catalog ?? []).map((s) => ({ ...s, tiers: s.tiers.map((t) => ({ ...t })) }));
  const added: Service[] = [];
  rows.forEach((r, i) => {
    const name = clean(r.service); const price = Number(r.price);
    if (!name) { plan.skipped.push({ line: i + 2, reason: 'name' }); return; }
    if (!isFinite(price) || price < 0) { plan.skipped.push({ line: i + 2, reason: 'price' }); return; }
    const all = [...catalog, ...added];
    let s = (clean(r.code) ? all.find((x) => key(x.code ?? '') === key(r.code!)) : undefined) ?? all.find((x) => key(x.name) === key(name) || key(x.i18n?.en?.name ?? '') === key(name));
    const unit = (TIER_UNITS as string[]).includes(key(r.unit)) ? (key(r.unit) as CatalogTier['unit']) : 'flat';
    const tierName = clean(r.tier) || ctx.t('catalog.tier.standard');
    if (!s) {
      const repeat = REPEATS.includes(key(r.repeat ?? '')) && key(r.repeat ?? '') !== 'once' ? (key(r.repeat!) as Service['repeat']) : undefined;
      s = {
        id: uid('sv'), name, category: clean(r.category), active: r.active !== false, tiers: [], repeat,
        description: clean(r.description) || undefined, code: clean(r.code) || undefined, ...(clean(r.book) ? { book: clean(r.book) } : {}),
        i18n: tidyI18n({ en: { name, description: clean(r.description) }, es: { name: clean(r.serviceEs), description: clean(r.descriptionEs) } }),
      };
      added.push(s); plan.newServices++;
    }
    const t = s.tiers.find((x) => key(x.name) === key(tierName));
    if (!t) { s.tiers.push({ id: uid('tr'), name: tierName, price: cents(price), unit, ...(clean(r.note) ? { note: clean(r.note) } : {}) }); plan.newTiers++; return; }
    if (t.price === cents(price) && t.unit === unit && clean(t.note) === clean(r.note)) { plan.unchanged++; return; }
    t.price = cents(price); t.unit = unit; t.note = clean(r.note) || undefined; plan.changedTiers++;
  });
  if (apply && (added.length || plan.newTiers || plan.changedTiers)) {
    d.catalog = [...catalog, ...added];
    logActivity(d, ctx.actor, 'catalog.imported', { type: 'user', id: ctx.actor }, { services: plan.newServices, tiers: plan.newTiers + plan.changedTiers });
  }
  return plan;
}

/* ---------- playbooks ---------- */
export type PlaybookInput = Omit<PlaybookFull, 'id' | 'steps'> & { steps: (Omit<PlaybookStep, 'id'> & { id?: string })[] };

export function savePlaybook(d: DemoState, ctx: Ctx, input: PlaybookInput, id?: string): PlaybookFull | null {
  const name = clean(input.name); if (!name) return null;
  const cur = id ? playbookOf(d, id) : undefined;
  if (id && !cur) return null;
  const steps: PlaybookStep[] = input.steps.filter((s) => clean(s.title.en) || clean(s.title.es)).map((s) => ({
    id: cur?.steps.find((x) => x.id === s.id)?.id ?? uid('ps'),
    // a step written in one language reads the same in the other until someone translates it
    title: { en: clean(s.title.en) || clean(s.title.es), es: clean(s.title.es) || clean(s.title.en), ...(clean(s.title.zh) ? { zh: clean(s.title.zh) } : {}) },
    dueIn: Math.max(0, Math.round(Number(s.dueIn) || 0)), for: s.for, ...(s.type ? { type: s.type } : {}), ...(s.pri && s.pri !== 'medium' ? { pri: s.pri } : {}),
  }));
  const more = Object.fromEntries(Object.entries(input.welcomeI18n ?? {}).filter(([, v]) => clean(v)).map(([l, v]) => [l, clean(v)]));
  const body = { name, steps, active: input.active !== false, welcome: clean(input.welcome) || undefined, welcomeI18n: Object.keys(more).length ? more : undefined };
  if (cur) { Object.assign(cur, body); d.playbooks = [...d.playbooks]; return cur; }
  const p: PlaybookFull = { id: uid('pb'), ...body };
  d.playbooks = [...(d.playbooks ?? []), p];
  logActivity(d, ctx.actor, 'catalog.playbookCreated', { type: 'user', id: ctx.actor }, { playbook: p.name });
  return p;
}

/** Removes a playbook and takes it off the services that started with it. Tasks it already created stay. */
export function deletePlaybook(d: DemoState, _ctx: Ctx, id: string) {
  d.playbooks = (d.playbooks ?? []).filter((p) => p.id !== id);
  for (const s of d.catalog ?? []) if (s.playbookId === id) s.playbookId = undefined;
  d.catalog = [...(d.catalog ?? [])];
}

/** The mark a playbook leaves on the tasks it creates: `playbook:<playbook>:<engagement>:<step>`. */
export const playbookStamp = (playbookId: string, jobId: string, stepId = '') => `playbook:${playbookId}:${jobId}:${stepId}`;
/** True once any playbook has run for the engagement. */
export const playbookRan = (d: Pick<DemoState, 'tasks'>, jobId: string): boolean => d.tasks.some((t) => t.jobId === jobId && !!t.auto && t.auto.startsWith('playbook:'));
/** Tasks a playbook created for an engagement. */
export const playbookTasks = (d: Pick<DemoState, 'tasks'>, jobId: string): Task[] => d.tasks.filter((t) => t.jobId === jobId && !!t.auto && t.auto.startsWith('playbook:'));

const active = (u: TeamUser) => u.active !== false;
/** Who a step is for: the owner of the company, a manager (of the engagement's office when there is one), or the person responsible for the engagement. */
function stepAssignee(d: DemoState, job: Job, who: PlaybookStep['for']): string {
  const owner = d.users.find((u) => u.role === 'owner' && active(u))?.id ?? d.users[0]?.id ?? job.managerId;
  if (who === 'assignee') return job.managerId || owner;
  if (who === 'owner') return owner;
  const managers = d.users.filter((u) => u.role === 'manager' && active(u));
  return (managers.find((u) => !!job.officeId && u.officeIds?.includes(job.officeId)) ?? managers[0])?.id ?? owner;
}

/**
 * Creates the tasks of the service's playbook for an engagement, once. Each task is due the stated number of days after
 * the engagement starts (today when it has no start date) and carries a mark that leads back to the playbook and the step.
 * Returns the tasks created: an empty list when the service has no active playbook or it already ran for this engagement.
 */
export function startPlaybook(d: DemoState, ctx: Ctx, jobId: string): Task[] {
  const job = d.jobs.find((j) => j.id === jobId); if (!job) return [];
  const pb = playbookOf(d, serviceOf(d, job.serviceId)?.playbookId);
  if (!pb || !pb.active || !pb.steps.length) return [];
  if (d.tasks.some((t) => !!t.auto && t.auto.startsWith(playbookStamp(pb.id, job.id)))) return [];
  const from = job.start || today();
  const made: Task[] = pb.steps.map((s) => ({
    id: uid('t'), title: s.title[ctx.lang] || s.title.en, jobId: job.id, clientId: job.clientId, assignee: 'u:' + stepAssignee(d, job, s.for),
    due: addDaysFrom(from, s.dueIn), status: 'todo', pri: s.pri ?? 'medium', created: today(), auto: playbookStamp(pb.id, job.id, s.id), ...(s.type ? { type: s.type } : {}),
  }));
  // newest first in the list, in the order of the playbook
  d.tasks.unshift(...made);
  logActivity(d, 'automation', 'catalog.playbook', { type: 'job', id: job.id }, { playbook: pb.name, n: made.length }, [{ type: 'client', id: job.clientId }]);
  return made;
}
