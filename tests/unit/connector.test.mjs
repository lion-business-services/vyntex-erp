// Unit tests for the connector step and the connected-app rules (src/domain/rules/steps.ts, src/packs/connected-rules.ts),
// and for the field editions' extra sample records (src/packs/field-extras.ts).
// A connector step hands the record to an app only when Ctx.links says the app is connected (the sample workspace's
// simulated connections); otherwise it does nothing, says which app is missing, and a rule made only of such steps
// records no run. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export * as actions from '@/domain/actions';
  export * as steps from '@/domain/rules/steps';
  export { addFieldExtras } from '@/packs/field-extras';
  export { PACKS } from '@/packs';
  export { loadSeed, seedOf } from '@/packs/seeds';
  export { makeT } from '@/i18n';
`);
const { actions, steps, addFieldExtras, PACKS, loadSeed, seedOf, makeT } = m;

const clone = (v) => JSON.parse(JSON.stringify(v));
async function sample(id = 'build') {
  const pack = PACKS[id]; await loadSeed(id);
  const d = { ...blank(pack), ...clone(seedOf(id)('en')), rules: clone(pack.rules) };
  d.automation = { enabled: {}, runs: [] };
  return { pack, d };
}
const linksOf = (on) => { const log = []; return { log, links: { on: (p) => on.includes(p), record: (p, line) => log.push([p, line.key]) } }; };

test('a connector step does nothing and names the app when it is not connected', async () => {
  const { pack, d } = await sample();
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id };
  const job = d.jobs[0];
  const out = steps.runStep({ do: 'connector', params: { app: 'gcal' } }, { d, ctx, subject: { job, ref: { type: 'job', id: job.id } }, stamp: 's', ruleId: 'r' });
  assert.equal(out.did, false);
  assert.deepEqual(out.lines, [{ key: 'auto.skip.connector', params: { app: 'Google Calendar' } }]);
});

test('a connector step hands the record over and logs it on the app when it is connected', async () => {
  const { pack, d } = await sample();
  const { log, links } = linksOf(['gdrive']);
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id, links };
  const job = d.jobs[0]; const client = d.clients.find((c) => c.id === job.clientId);
  const out = steps.runStep({ do: 'connector', params: { app: 'gdrive' } }, { d, ctx, subject: { job, client, ref: { type: 'job', id: job.id } }, stamp: 's', ruleId: 'r' });
  assert.equal(out.did, true);
  assert.equal(out.lines[0].key, 'auto.step.connector.gdrive');
  assert.equal(out.lines[0].params.what, client.name, 'the Drive folder is the person\'s');
  assert.deepEqual(log, [['gdrive', 'auto.step.connector.gdrive']]);
});

test('an unknown app is refused, never guessed', async () => {
  const { pack, d } = await sample();
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id, links: linksOf(['x']).links };
  assert.throws(() => steps.runStep({ do: 'connector', params: { app: 'x' } }, { d, ctx, subject: {}, stamp: 's', ruleId: 'r' }));
});

test('winning a lead with nothing connected records no connected-app run; with the apps connected it runs all five steps', async () => {
  for (const on of [[], ['gcontacts', 'gdrive', 'gsheets', 'gcal', 'slack']]) {
    const { pack, d } = await sample();
    const { log, links } = linksOf(on);
    const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id, ...(on.length ? { links } : {}) };
    const lead = actions.createLead(d, ctx, { name: 'Quinn Tester', phone: '609-555-0199', email: 'quinn@example.com', address: '1 Sample Way', type: pack.serviceTypes[0].id, source: 'website', pri: 'medium', ownerId: '', value: 5000 });
    actions.convertLead(d, ctx, lead.id);
    const run = d.automation.runs.find((r) => r.ruleId === 'connected-won');
    if (!on.length) { assert.equal(run, undefined); assert.equal(log.length, 0); continue; }
    assert.ok(run, 'the rule ran'); assert.equal(run.status, 'ok');
    assert.deepEqual(run.steps.map((s) => s.key), ['gcontacts', 'gdrive', 'gsheets', 'gcal', 'slack'].map((a) => 'auto.step.connector.' + a));
    assert.equal(log.length, 5);
  }
});

test('the field samples get catalog, signature, review, social and opportunity records from their own work', async () => {
  for (const id of ['build', 'clean', 'landscape', 'wash', 'haul', 'snow', 'turnover', 'events']) {
    const { pack, d } = await sample(id);
    addFieldExtras(d, pack, 'en');
    assert.equal(d.catalog.length, pack.serviceTypes.length, id);
    assert.ok(d.envelopes.length >= 1 && d.envelopes.every((e) => e.demo === true && d.docs.some((x) => x.id === e.docId && x.envelopeId === e.id)), id + ' envelopes');
    assert.ok(d.reviews.every((r) => d.clients.some((c) => c.id === r.clientId) && d.jobs.some((j) => j.id === r.jobId && j.status === 'done')), id + ' reviews');
    assert.ok(d.posts.length === 3 && d.posts.every((p) => p.status !== 'published'), id + ' posts are never shown as really published');
    assert.ok(d.opportunities.every((o) => d.catalog.some((s) => s.id === o.serviceId) && d.clients.some((c) => c.id === o.clientId)), id + ' opportunities');
    // a second pass adds nothing
    const before = JSON.stringify([d.catalog, d.envelopes, d.reviews, d.posts, d.opportunities]);
    addFieldExtras(d, pack, 'en');
    assert.equal(JSON.stringify([d.catalog, d.envelopes, d.reviews, d.posts, d.opportunities]), before, id + ' idempotent');
  }
});

test('the practice sample is left as it is', async () => {
  const { pack, d } = await sample('practice');
  const before = JSON.stringify(d);
  addFieldExtras(d, pack, 'en');
  assert.equal(JSON.stringify(d), before);
});
