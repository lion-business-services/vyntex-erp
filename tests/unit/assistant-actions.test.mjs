// Unit tests for VYNTEX AI's catalog of actions (src/features/assistant/actions.ts, 0097): every entry is well formed,
// what reaches a client, moves money, deletes or publishes waits for Confirm, arguments are checked against real records,
// nothing touches security, and the entries really change the data through the same business actions as the screens.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export * as A from '@/features/assistant/actions';
  export * as asst from '@/features/assistant/engine';
  export { toProposal } from '@/features/assistant/context';
  export { PACKS } from '@/packs';
  export { loadSeed, seedOf } from '@/packs/seeds';
  export { makeT } from '@/i18n';
  export { permissionsOf } from '@/domain/config';
`);
const { A, asst, toProposal, PACKS, loadSeed, seedOf, makeT, permissionsOf } = m;
const clone = (v) => JSON.parse(JSON.stringify(v));
async function env(edition, lang = 'en', role = 'owner') {
  const pack = PACKS[edition];
  await loadSeed(edition);
  const data = { ...blank(pack), rules: clone(pack.rules), ...clone(seedOf(edition)(lang)) };
  data.automation = { enabled: {}, runs: [] };
  const t = makeT(lang, pack, data.config);
  const perms = permissionsOf(data, pack, role);
  const user = data.users.find((u) => u.role === role) ?? data.users[0];
  const e = { data, pack, lang, t, can: (p) => perms.includes(p), actor: user.id, date: (d) => d ?? '', day: (d) => d ?? '', time: (h) => h ?? '', user, perms };
  // the store's act(), on this data
  A.bindStore((fn, ...args) => fn(e.data, { pack, lang, t, actor: user.id }, ...args), () => e.data);
  return e;
}

test('every entry is well formed, named in both languages, and none touches security', () => {
  const ids = new Set();
  for (const x of A.SPECS) {
    assert.ok(/^[a-z_]{3,40}$/.test(x.id), x.id); assert.ok(!ids.has(x.id), 'unique: ' + x.id); ids.add(x.id);
    assert.ok(x.en && x.es && x.en !== x.es, 'both languages: ' + x.id);
    assert.ok(!/[—–]/.test(x.en + x.es), 'no dashes: ' + x.id);
    assert.ok(!/security|vault|role|member|tax|bank|rule|integration|password/.test(x.id + x.perm), 'never security: ' + x.id);
    for (const [k, p] of Object.entries(x.params)) if (p.t === 'ref') assert.ok(p.of in A.COLLECTIONS, `${x.id}.${k}`);
  }
  assert.ok(A.SPECS.length >= 55, String(A.SPECS.length));
});

test('what reaches a client, moves money, changes a price, deletes or publishes waits for Confirm', () => {
  for (const x of A.SPECS) {
    const sensitive = /(^|_)(delete|send|remind|void|publish|approve|schedule|cancel|merge|expense)(_|$)/.test(x.id);
    if (sensitive) assert.equal(A.isRiskyAction(x, {}), true, x.id);
  }
  const upd = A.SPEC_BY_ID.get('project_update');
  assert.equal(A.isRiskyAction(upd, { project: 'x', name: 'New name' }), false);
  assert.equal(A.isRiskyAction(upd, { project: 'x', price: 5000 }), true, 'a price change waits');
  assert.equal(A.isRiskyAction(A.SPEC_BY_ID.get('message_draft'), {}), false, 'a draft only waits in Messages');
  assert.equal(asst.needsConfirm({ kind: 'action', action: 'lead_delete', args: {} }), true);
  assert.equal(asst.needsConfirm({ kind: 'action', action: 'task_comment', args: {} }), false);
  assert.equal(asst.needsConfirm({ kind: 'action', action: 'no_such_thing', args: {} }), true, 'unknown waits');
});

for (const edition of ['build', 'clean', 'practice', 'barber']) for (const lang of ['en', 'es']) {
  test(`${edition}/${lang}: the index fits, follows the role, and every listed entry is usable`, async () => {
    const e = await env(edition, lang);
    const idx = A.actionIndex(e);
    assert.ok(idx.length > 500 && idx.length < 12000, String(idx.length));
    for (const x of A.specsFor(e)) assert.ok(idx.includes(x.id + '('));
    const w = await env(edition, lang, 'staff').catch(() => null);
    if (w) for (const x of A.specsFor(w)) assert.ok(w.can(x.perm), 'only what the role has: ' + x.id);
  });
}

test('arguments are checked: missing values, unknown records, values outside the list, bad dates', async () => {
  const e = await env('build');
  const lead = e.data.leads[0];
  const x = A.SPEC_BY_ID.get('lead_set_stage');
  assert.match(A.cleanArgs(x, {}, e), /Missing a value: lead/);
  assert.match(A.cleanArgs(x, { lead: 'nope', stage: 'won' }, e), /could not find/);
  assert.match(A.cleanArgs(x, { lead: lead.id, stage: 'banana' }, e), /must be one of/);
  assert.match(A.cleanArgs(A.SPEC_BY_ID.get('lead_next_action'), { lead: lead.id, text: 'Call', due: 'tomorrow' }, e), /not a valid date/);
  assert.match(A.cleanArgs(A.SPEC_BY_ID.get('client_merge'), { keep: e.data.clients[0].id, drop: e.data.clients[0].id }, e), /two different/);
  // from the model: JSON as a string, an unavailable entry, broken JSON
  const ok = toProposal('do_action', { action: 'task_comment', arguments: JSON.stringify({ task: e.data.tasks[0].id, text: 'Checked with the client' }) }, e);
  assert.equal(ok.kind, 'action'); assert.equal(ok.args.text, 'Checked with the client');
  assert.match(toProposal('do_action', { action: 'set_role_permissions', arguments: '{}' }, e), /not available/);
  assert.equal(typeof toProposal('do_action', { action: 'task_comment', arguments: '{oops' }, e), 'string');
  // Spanish
  const es = await env('build', 'es');
  assert.match(A.cleanArgs(x, {}, es), /Falta un dato/);
});

test('entries really change the data, and the card names the records', async () => {
  const e = await env('build');
  const lead = e.data.leads.find((l) => !['won', 'lost'].includes(l.status)) ?? e.data.leads[0];
  const task = e.data.tasks[0]; const job = e.data.jobs[0]; const client = e.data.clients[0];
  const run = (action, args) => { const x = A.SPEC_BY_ID.get(action); const a = A.cleanArgs(x, args, e); assert.equal(typeof a, 'object', `${action}: ${a}`); return A.runAction(x, a, e); };
  // next step on a lead
  assert.equal(run('lead_next_action', { lead: lead.id, text: 'Send the estimate', due: '2026-12-01' }).ok, true);
  // a comment on a task
  const before = (e.data.tasks[0].comments ?? []).length;
  assert.equal(run('task_comment', { task: task.id, text: 'Materials ordered' }).ok, true);
  assert.equal((e.data.tasks.find((t) => t.id === task.id).comments ?? []).length, before + 1);
  // a project's name and an expense
  assert.equal(run('project_update', { project: job.id, name: 'Kitchen remodel, phase 2' }).ok, true);
  assert.equal(e.data.jobs.find((j) => j.id === job.id).name, 'Kitchen remodel, phase 2');
  const ex = e.data.jobs.find((j) => j.id === job.id).expenses.length;
  assert.equal(run('project_expense', { project: job.id, amount: 125.5, vendor: 'Home Depot', description: 'Tile' }).ok, true);
  assert.equal(e.data.jobs.find((j) => j.id === job.id).expenses.length, ex + 1);
  // a deadline
  const dl = e.data.complianceItems.length;
  assert.equal(run('deadline_add', { title: 'Renew contractor license', kind: 'license', due: '2027-01-15', client: client.id }).ok, true);
  assert.equal(e.data.complianceItems.length, dl + 1);
  // a message draft (nothing leaves)
  const msgs = e.data.messages.length;
  assert.equal(run('message_draft', { client: client.id, channel: 'email', subject: 'Your project', body: 'Hi, a quick update, SSN 123-45-6789.' }).ok, true);
  assert.equal(e.data.messages.length, msgs + 1);
  assert.ok(!JSON.stringify(e.data.messages).includes('123-45-6789'), 'a tax ID never goes into a message');
  // a social draft
  assert.equal(run('post_create', { text: 'Spring openings available', channels: ['facebook', 'instagram'] }).ok, true);
  // a card names the records, formats money
  const card = asst.describe({ kind: 'action', action: 'project_expense', args: { project: job.id, amount: 125.5, vendor: 'Home Depot' } }, e);
  assert.equal(card.title, 'Add an expense to a project');
  assert.ok(card.rows.some(([, v]) => v.includes('Kitchen remodel')));
  assert.ok(card.rows.some(([, v]) => v.includes('125.50')));
  assert.match(card.note, /waits for your confirmation/);
  // a check that fails says why
  assert.match(asst.check({ kind: 'action', action: 'task_comment', args: { task: 'gone', text: 'x' } }, e), /could not find/);
});

test('find_records: matches by name, only what the role may see, never contact details', async () => {
  const e = await env('build');
  const c = e.data.clients[0];
  const r = A.findRecords(e, 'clients', c.name.split(' ')[0]);
  assert.ok(r.records.some((x) => x.id === c.id));
  assert.ok(!JSON.stringify(r).includes(c.email || '@@none@@') && !JSON.stringify(r).includes(c.phone || '@@none@@'), 'no phone or email');
  assert.equal(A.findRecords(e, 'vault', '').error, 'unknown collection');
  const w = await env('build', 'en', 'worker').catch(() => null);
  if (w && !w.can('clients')) assert.equal(A.findRecords(w, 'clients', '').error, 'not allowed');
});
