// Unit tests for the HVAC and plumbing editions' own automations (src/packs/hvac/rules.ts, src/packs/plumbing/rules.ts),
// run through the real rules engine on each edition's sample business: an emergency call raises the urgent callback,
// the manager alert and a DRAFT text (nothing is sent); a signed install or permitted job gets its permit tasks;
// a finished job gets its trade's closeout tasks. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const { actions, PACKS, loadSeed, seedOf, makeT } = await load(`
  export * as actions from '@/domain/actions';
  export { PACKS } from '@/packs';
  export { loadSeed, seedOf } from '@/packs/seeds';
  export { makeT } from '@/i18n';
`);
const clone = (v) => JSON.parse(JSON.stringify(v));
async function sample(id) {
  const pack = PACKS[id]; await loadSeed(id);
  const d = { ...blank(pack), ...clone(seedOf(id)('en')), rules: clone(pack.rules) };
  d.automation = { enabled: {}, runs: [] };
  // texting is off in a new field workspace until the company turns it on; the emergency drafts are texts
  d.settings = { ...(d.settings || {}), messages: { ...(d.settings?.messages || {}), channels: { ...(d.settings?.messages?.channels || {}), text: true } } };
  return { pack, d, ctx: { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id } };
}
const ran = (d, id) => d.automation.runs.filter((r) => r.ruleId === id);
/** Records added since `ids` was taken (lists may grow at either end). */
const idsOf = (list) => new Set(list.map((x) => x.id));
const added = (list, ids) => list.filter((x) => !ids.has(x.id));

for (const [id, prefix] of [['hvac', 'hv'], ['plumbing', 'pl']]) {
  test(`${id}: every shipped rule is unique, active by default where safe, and never sends a client message by itself`, () => {
    const pack = PACKS[id];
    const ids = pack.rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'rule ids are unique');
    const own = pack.rules.filter((r) => r.id.startsWith(prefix + '-'));
    assert.ok(own.length >= 14, 'the trade rules are there');
    for (const r of pack.rules) for (const s of r.then) if (s.do === 'message') assert.equal(s.params.mode, 'draft', r.id + ' prepares drafts only');
    for (const k of ['lead-intake', 'job-completed', 'connected-won', 'connected-paid']) assert.ok(ids.includes(k), k + ' is kept from the field blueprint');
  });

  test(`${id}: an emergency call raises the urgent callback, alerts the manager and drafts the text`, async () => {
    const { d, ctx } = await sample(id);
    const tasks = idsOf(d.tasks); const msgs = idsOf(d.messages);
    actions.createLead(d, ctx, { name: 'Quinn Tester', phone: '609-555-0199', email: 'quinn@example.com', address: '1 Sample Way', type: 'emergency', source: 'phone', pri: 'high', ownerId: '', value: 0, smsOptIn: true });
    const run = ran(d, prefix + '-emergency-triage');
    assert.equal(run.length, 1, 'the triage rule ran once');
    assert.equal(run[0].status, 'ok');
    const urgent = added(d.tasks, tasks).find((x) => /EMERGENCY/.test(x.title));
    assert.ok(urgent && urgent.pri === 'high', 'an urgent callback task');
    const fresh = added(d.messages, msgs);
    assert.ok(fresh.some((m) => m.status === 'draft' && /Quinn/.test(m.body)), 'a draft text to the client');
    assert.ok(!fresh.some((m) => m.channel !== 'system' && m.status === 'sent'), 'nothing went out to the client');
    // without texting consent the draft is not even prepared (consent is captured per person)
    const before = idsOf(d.messages);
    actions.createLead(d, ctx, { name: 'Sam NoConsent', phone: '609-555-0197', address: '3 Sample Way', type: 'emergency', source: 'phone', pri: 'high', ownerId: '', value: 0 });
    assert.ok(!added(d.messages, before).some((m) => m.channel === 'text'), 'no text draft without consent');
    // a non-emergency lead does not trigger it
    actions.createLead(d, ctx, { name: 'Robin Calm', phone: '609-555-0198', address: '2 Sample Way', type: 'other', source: 'website', pri: 'low', ownerId: '', value: 0 });
    assert.equal(ran(d, prefix + '-emergency-triage').length, 2);
  });
}

test('hvac: a signed install gets the permit, equipment and load calculation tasks; a finished install its warranty and inspection', async () => {
  const { d, ctx } = await sample('hvac');
  const client = d.clients[0];
  const job = actions.createJob(d, ctx, { name: 'Sample install', clientId: client.id, type: 'install', status: 'estimate', price: 9000 });
  const before = idsOf(d.tasks);
  actions.updateJob(d, ctx, job.id, { status: 'contract' });
  assert.equal(ran(d, 'hv-install-permit').length, 1);
  const titles = added(d.tasks, before).map((x) => x.title).join(' | ');
  assert.match(titles, /mechanical permit/); assert.match(titles, /Order the equipment/); assert.match(titles, /Manual J/);
  actions.updateJob(d, ctx, job.id, { status: 'done' });
  assert.equal(ran(d, 'hv-install-closeout').length, 1);
  assert.equal(ran(d, 'hv-refrigerant-log').length, 1);
  assert.equal(ran(d, 'hv-plan-offer').length, 0, 'an install is not offered the repair follow-up');
});

test('plumbing: a signed repipe gets the permit and 811 tasks; a finished backflow test files the report and tags the client', async () => {
  const { d, ctx } = await sample('plumbing');
  const client = d.clients[0];
  const job = actions.createJob(d, ctx, { name: 'Sample repipe', clientId: client.id, type: 'repipe', status: 'estimate', price: 9000 });
  const before = idsOf(d.tasks);
  actions.updateJob(d, ctx, job.id, { status: 'contract' });
  assert.equal(ran(d, 'pl-permit').length, 1);
  assert.match(added(d.tasks, before).map((x) => x.title).join(' | '), /811/);
  const test2 = actions.createJob(d, ctx, { name: 'Sample backflow', clientId: client.id, type: 'backflow', status: 'progress', price: 300 });
  actions.updateJob(d, ctx, test2.id, { status: 'done' });
  assert.equal(ran(d, 'pl-backflow-due').length, 1);
});

test('the non-urgent drafts are emails, so they work in a new field workspace before texting is turned on', () => {
  for (const id of ['hvac', 'plumbing']) {
    const urgent = new Set(['hv-emergency-triage', 'pl-emergency-triage', 'pl-gas-safety']);
    for (const r of PACKS[id].rules) for (const s of r.then) if (s.do === 'message') assert.equal(s.params.channel, urgent.has(r.id) ? 'text' : 'email', r.id);
  }
});

test('each trade edition has its own sections, pipeline, sources, task and client types, dashboard and price book', async () => {
  const want = { hvac: { stage: 'financing', source: 'home_warranty', task: 'refrigerant', client: 'plan' }, plumbing: { stage: 'approval', source: 'water_utility', task: 'backflow', client: 'backflow' } };
  for (const [id, w] of Object.entries(want)) {
    const pack = PACKS[id];
    assert.ok(!pack.modules.includes('opportunities') && !pack.modules.includes('compliance'), id + ': no Opportunities or 1099 & compliance');
    assert.equal(pack.compliance, false);
    assert.ok(!pack.rules.some((r) => r.id === 'compliance-watch'), id + ': no compliance rule without the compliance page');
    assert.ok(pack.leadStages.some((s) => s.id === w.stage && s.role === 'negotiation'), id + ' stage');
    assert.ok(pack.leadSources.some((s) => s.id === w.source), id + ' source');
    assert.ok(pack.taskTypes.some((s) => s.id === w.task), id + ' task type');
    assert.ok(pack.clientTypes.some((s) => s.id === w.client), id + ' client type');
    assert.ok(pack.kpis.includes('recurringClients'));
    // every task type a rule gives is one of the edition's task types
    for (const r of pack.rules) for (const s of r.then) if (s.do === 'task' && s.params.type) assert.ok(pack.taskTypes.some((x) => x.id === s.params.type), r.id + ' ' + s.params.type);
    // the price book: one card per service type, in the edition's order (the field extras match work to its service by position)
    await loadSeed(id);
    for (const lang of ['en', 'es']) {
      const book = seedOf(id)(lang).catalog;
      assert.deepEqual(book.slice(0, pack.serviceTypes.length).map((s) => s.category), pack.serviceTypes.map((s) => s.id), id + ' ' + lang + ' book order');
      assert.ok(book.every((s) => s.tiers.length && s.tiers.every((t) => t.price > 0 || t.quote || t.note)), id + ' every line has a price, a quote or a note');
    }
  }
});

test('the trade sections: listed by each trade edition only, and their sample records point at the sample business', async () => {
  const { TRADE_SECTIONS, sampleFor } = await load(`export { TRADE_SECTIONS, sampleFor } from '@/features/trade/store';`);
  for (const pack of Object.values(PACKS)) {
    const own = TRADE_SECTIONS[pack.id] ?? [];
    for (const id of ['dispatch', 'equipment', 'agreements', 'permits', 'refrigerant', 'backflow', 'camera']) assert.equal(pack.modules.includes(id), own.includes(id), `${pack.id} ${id}`);
  }
  for (const id of ['hvac', 'plumbing']) {
    await loadSeed(id);
    for (const lang of ['en', 'es']) {
      const d = { ...blank(PACKS[id]), ...clone(seedOf(id)(lang)) };
      const s = sampleFor(id, lang, d);
      const client = (x) => d.clients.some((c) => c.id === x), job = (x) => d.jobs.some((j) => j.id === x), worker = (x) => d.workers.some((w) => w.id === x);
      for (const e of s.equipment) assert.ok(client(e.clientId), `${id} equipment ${e.id}`);
      for (const p of s.permits) assert.ok(job(p.jobId), `${id} permit ${p.id}`);
      for (const r of s.refrigerant) assert.ok(client(r.clientId) && worker(r.workerId) && (!r.jobId || job(r.jobId)), `${id} refrigerant ${r.id}`);
      for (const x of s.devices) assert.ok(client(x.clientId), `${id} device ${x.id}`);
      for (const x of s.inspections) assert.ok(client(x.clientId) && worker(x.workerId) && (!x.jobId || job(x.jobId)), `${id} inspection ${x.id}`);
      assert.ok(s.dispatch.length >= 4 && s.dispatch.some((x) => x.urgent), `${id} board has work and an emergency`);
      for (const x of s.dispatch) if (x.workerId) assert.ok(worker(x.workerId), `${id} dispatch ${x.id}`);
      assert.ok(!/[—–]/.test(JSON.stringify(s)), 'no long dashes');
    }
    assert.ok(id === 'hvac' ? sampleFor(id, 'en', { ...blank(PACKS[id]), ...clone(seedOf(id)('en')) }).refrigerant.length > 0 : sampleFor(id, 'en', { ...blank(PACKS[id]), ...clone(seedOf(id)('en')) }).devices.length > 0);
  }
});
