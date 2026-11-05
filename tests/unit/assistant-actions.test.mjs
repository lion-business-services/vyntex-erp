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
    assert.ok(!/security|vault|role|(^|_)members?(_|$)|tax|bank|rule|integration|password/.test(x.id + ' ' + x.perm), 'never security: ' + x.id);
    for (const [k, p] of Object.entries(x.params)) if (p.t === 'ref') assert.ok(p.of in A.COLLECTIONS, `${x.id}.${k}`);
  }
  assert.ok(A.SPECS.length >= 72, String(A.SPECS.length));
});

test('what reaches a client, moves money, changes a price, deletes or publishes waits for Confirm', () => {
  for (const x of A.SPECS) {
    const sensitive = /(^|_)(delete|send|remind|void|publish|approve|schedule|cancel|merge|expense|paid|pay|price|cash|checkout|sell|renew|assign_worker|remove)(_|$)/.test(x.id) || x.id === 'service_add';
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
  const run = async (action, args) => { const x = A.SPEC_BY_ID.get(action); const a = A.cleanArgs(x, args, e); assert.equal(typeof a, 'object', `${action}: ${a}`); return A.runAction(x, a, e); };
  // next step on a lead
  assert.equal((await run('lead_next_action', { lead: lead.id, text: 'Send the estimate', due: '2026-12-01' })).ok, true);
  // a comment on a task
  const before = (e.data.tasks[0].comments ?? []).length;
  assert.equal((await run('task_comment', { task: task.id, text: 'Materials ordered' })).ok, true);
  assert.equal((e.data.tasks.find((t) => t.id === task.id).comments ?? []).length, before + 1);
  // a project's name and an expense
  assert.equal((await run('project_update', { project: job.id, name: 'Kitchen remodel, phase 2' })).ok, true);
  assert.equal(e.data.jobs.find((j) => j.id === job.id).name, 'Kitchen remodel, phase 2');
  const ex = e.data.jobs.find((j) => j.id === job.id).expenses.length;
  assert.equal((await run('project_expense', { project: job.id, amount: 125.5, vendor: 'Home Depot', description: 'Tile' })).ok, true);
  assert.equal(e.data.jobs.find((j) => j.id === job.id).expenses.length, ex + 1);
  // a deadline
  const dl = e.data.complianceItems.length;
  assert.equal((await run('deadline_add', { title: 'Renew contractor license', kind: 'license', due: '2027-01-15', client: client.id })).ok, true);
  assert.equal(e.data.complianceItems.length, dl + 1);
  // a message draft (nothing leaves)
  const msgs = e.data.messages.length;
  assert.equal((await run('message_draft', { client: client.id, channel: 'email', subject: 'Your project', body: 'Hi, a quick update, SSN 123-45-6789.' })).ok, true);
  assert.equal(e.data.messages.length, msgs + 1);
  assert.ok(!JSON.stringify(e.data.messages).includes('123-45-6789'), 'a tax ID never goes into a message');
  // a social draft
  assert.equal((await run('post_create', { text: 'Spring openings available', channels: ['facebook', 'instagram'] })).ok, true);
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

test('the rest of the screens: crew, mistakes, petty cash, workers, prices, appointment types, files', async () => {
  const e = await env('build');
  const run = async (action, args) => { const x = A.SPEC_BY_ID.get(action); const a = A.cleanArgs(x, args, e); assert.equal(typeof a, 'object', `${action}: ${a}`); return A.runAction(x, a, e); };
  const job = e.data.jobs[0]; const worker = e.data.workers[0];
  // a crew on a project
  const n0 = e.data.jobs[0].assign.length;
  assert.equal((await run('project_assign_worker', { project: job.id, worker: worker.id, scope: 'Framing', price: 4200 })).ok, true);
  assert.equal(e.data.jobs[0].assign.length, n0 + 1);
  // an expense made by mistake, found by its amount
  assert.equal((await run('project_expense', { project: job.id, amount: 77.77, vendor: 'Lowe\'s' })).ok, true);
  const ex = e.data.jobs[0].expenses.length;
  assert.equal((await run('project_remove_entry', { project: job.id, kind: 'expense', amount: 77.77 })).ok, true);
  assert.equal(e.data.jobs[0].expenses.length, ex - 1);
  const miss = await run('project_remove_entry', { project: job.id, kind: 'expense', amount: 1.23 });
  assert.equal(miss.ok, false); assert.match(miss.why, /No entry matches/);
  // a new worker, and a payment to them (never an account number as the reference)
  const w0 = e.data.workers.length;
  assert.equal((await run('worker_add', { name: 'Luis Ortega', trade: 'Electrician', pay_type: 'hourly', rate: 45 })).ok, true);
  assert.equal(e.data.workers.length, w0 + 1);
  assert.equal(A.isRiskyAction(A.SPEC_BY_ID.get('worker_add'), { rate: 45 }), true, 'a pay rate waits');
  const p0 = e.data.workerPays.length;
  assert.equal((await run('worker_pay', { worker: worker.id, amount: 800, method: 'zelle', project: job.id })).ok, true);
  assert.equal(e.data.workerPays.length, p0 + 1);
  assert.match((await run('worker_pay', { worker: worker.id, amount: 1, method: 'check', reference: '021000021123456' })).why, /never an account number/);
  // a service price
  const sv = e.data.catalog.find((x) => x.tiers?.length);
  if (sv) { assert.equal((await run('service_price', { service: sv.id, price: 1999 })).ok, true); assert.equal(e.data.catalog.find((x) => x.id === sv.id).tiers[0].price, 1999); }
  // an appointment type, in both languages
  const t0 = (e.data.apptTypes ?? []).length;
  assert.equal((await run('appt_type_save', { name_en: 'Site visit', name_es: 'Visita al sitio', minutes: 45, fee: 0, mode: 'office' })).ok, true);
  assert.equal(e.data.apptTypes.length, t0 + 1); assert.equal(e.data.apptTypes.at(-1)?.name?.es ?? e.data.apptTypes[0].name.es, e.data.apptTypes.find((x) => x.name.en === 'Site visit').name.es);
  // petty cash, by a category the workspace has
  const cats = A.SPEC_BY_ID.get('cash_entry').params.category.of(e);
  if (cats.length && e.can('cash')) { const c0 = e.data.cash.length; assert.equal((await run('cash_entry', { direction: 'out', amount: 25, category: cats[0], memo: 'Coffee for the crew' })).ok, true); assert.equal(e.data.cash.length, c0 + 1); }
  // a file attached to the chat, saved as a document on a client
  A.setTurnFiles([{ name: 'permit.txt', mime: 'text/plain', text: 'Permit 2026-114 approved' }]);
  const d0 = e.data.docs.length;
  assert.equal((await run('document_save_attachment', { file_name: 'permit.txt', client: e.data.clients[0].id, title: 'Building permit' })).ok, true);
  assert.equal(e.data.docs.length, d0 + 1);
  assert.match((await run('document_save_attachment', { file_name: 'permit.txt' })).why, /which client, project or lead/);
  // invoices and signatures are the server's: in the sample they say so
  assert.match((await run('invoice_send', { invoice: 'INV-0001' })).why ?? '', /invoice|company workspace/);
});

test('barber editions: check out a walk-in, sell a gift card', async () => {
  const e = await env('barber');
  const run = async (action, args) => { const x = A.SPEC_BY_ID.get(action); const a = A.cleanArgs(x, args, e); assert.equal(typeof a, 'object', `${action}: ${a}`); return A.runAction(x, a, e); };
  if (!(e.data.chairs?.length)) return;
  const open = e.data.walkins.find((w) => w.status === 'in_service');
  if (open) assert.equal((await run('walkin_checkout', { walkin: open.id, amount: 35, tip: 5, method: 'cash' })).ok, true);
  if (A.specsFor(e).some((x) => x.id === 'pass_sell')) assert.equal((await run('pass_sell', { holder: 'Maria Lopez', amount: 50, method: 'card' })).ok, true);
});
