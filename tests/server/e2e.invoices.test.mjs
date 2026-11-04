// End-to-end tests of invoices (0086, api/_lib/invoices.js), formerly the AI employees test's scaffolding.
// End-to-end tests of the AI employees (0084, api/_lib/public/bot.js, api/_lib/bots/tools.js, the bot_key_issue office
// operation): the owner adds a bot and issues its key in the workspace; the bot reaches its tools by MCP and by the plain
// route with that key alone; the database keeps it to its access map and its own company; a person decides approvals.
//   node --test tests/server/e2e.bots.test.mjs     (starts and stops its own PostgreSQL)
//   npm run test:server                             (tests/server/run.mjs starts the database with every migration)
// Local stand-ins only: a throwaway PostgreSQL with EVERY migration, the test double of the Supabase HTTP surface, the
// real handlers of api/. Nothing here reaches the internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTestEnv, Browser, secrets, root, ORIGIN } from './helpers.mjs';

const PG = process.env.VX_PG_PUBLIC_DIR || '/tmp/vx-pg-public';
const PORT = 4772;
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
const PW = 'Quiet-harbor-lamp-41';
let S;
const mails = [];
const stripeCalls = [];
let stripeFake = async () => new Response('{}', { status: 500 });
let startedPg = false;

async function startStack() {
  setTestEnv({ STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24), STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(24), RESEND_API_KEY: 're_test_' + randomBytes(16).toString('hex'), SYSTEM_EMAIL_FROM: 'VYNTEX ERP <system@mail.example.com>' });
  if (process.env.VX_PG_PUBLIC_READY !== '1') {
    const r = spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'start'], { env: pgEnv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('the local PostgreSQL did not start:\n' + r.stdout + r.stderr);
    startedPg = true;
  }
  const { startDevSupabase } = await import('../../scripts/dev-supabase.mjs');
  const sb = await startDevSupabase({ port: PORT, host: PG + '/sock' });
  Object.assign(process.env, { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey });
  for (const k of ['SESSION_SECRET', 'TOKEN_ENC_KEY', 'IP_HASH_SALT', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) secrets.add(process.env[k]);
  secrets.add(sb.jwtSecret);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/emails')) { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'email_' + randomBytes(6).toString('hex') }), { status: 200 }); }
    if (u.startsWith('https://api.stripe.com/')) return stripeFake(u, init);
    if (!u.startsWith(sb.url)) throw new Error('a test tried to reach an outside address: ' + u.slice(0, 60));
    return realFetch(url, init);
  };
  const api = { auth: await import('../../api/auth.js'), ws: await import('../../api/ws.js'), public: await import('../../api/public.js') };
  const sql = (text, data = {}) => sb.db.run('supabase_admin', [text], data);
  let n = 0;
  async function company(plan) {
    n += 1;
    const slug = `bot-${Date.now().toString(36)}-${n}`;
    const email = `owner-${slug}@example.com`;
    const made = await sql(String.raw`
      with t as (insert into public.tenants (slug, name, industry_id, plan_id, status)
                 values ((select v from _in where k = 'slug'), 'Sample Company ' || (select v from _in where k = 'slug'), 'build', (select v from _in where k = 'plan'), 'active') returning id)
      select '@@R@@' || jsonb_build_object('id', (select id from t))::text;`, { slug, plan });
    const boot = await sql(String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select v from _in where k = 'id')::uuid, (select v from _in where k = 'email')))::text;`, { id: made.id, email });
    const owner = new Browser(api);
    await owner.open();
    const accepted = await owner.post('/api/auth/invite/accept', { token: boot, password: PW, name: 'Sample Owner' });
    if (accepted.status !== 200 || !accepted.json.signedIn) throw new Error('could not create the owner: ' + accepted.text);
    return { tenantId: made.id, slug, owner };
  }
  return { api, sb, sql, company, async stop() { globalThis.fetch = realFetch; await sb.stop(); if (startedPg) spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'stop'], { env: pgEnv }); } };
}


test.before(async () => { S = await startStack(); });
test.after(async () => { if (S) await S.stop(); });

async function pay(path, headers = {}) {
  const res = await S.api.public.GET(new Request(`${ORIGIN}/api/public/${path}`, { headers: { 'x-forwarded-for': '198.51.100.9', ...headers } }));
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

test('an invoice: made from a project, emailed with its pay link, paid in Stripe, recorded once, its link closed', async () => {
  const hq = await S.company('internal');
  const rpc = (co, name, args) => co.owner.post('/api/ws/rpc/' + name, { tenant: co.tenantId, args });
  const made = await S.sql(String.raw`
    with c as (insert into public.clients (tenant_id, name, email, lang) values ((select v from _in where k = 't')::uuid, 'Morgan Client', 'morgan@example.com', 'es') returning id),
         j as (insert into public.jobs (tenant_id, number, name, client_id, type, status, price) select (select v from _in where k = 't')::uuid, 'P-1', 'Website build', c.id, 'other', 'progress', 3000 from c returning id, client_id)
    select '@@R@@' || jsonb_build_object('job', (select id from j), 'client', (select client_id from j))::text;`, { t: hq.tenantId });

  const saved = await rpc(hq, 'invoice_save', { p_invoice: { jobId: made.job, lang: 'es', feePct: 2.9, lines: [{ text: 'Depósito 50%', qty: 1, unitCents: 150000 }] } });
  assert.equal(saved.status, 200, saved.text);
  const inv = saved.json.result;
  assert.deepEqual([inv.number, inv.subtotalCents, inv.feeCents, inv.totalCents, inv.status], ['INV-0001', 150000, 4350, 154350, 'draft']);

  // sending: the client's email from the project, the email in Spanish, with a pay link; only its hash is kept
  const sent = await rpc(hq, 'invoice_send', { p_id: inv.id });
  assert.equal(sent.status, 200, sent.text);
  assert.deepEqual([sent.json.result.to, sent.json.result.online], ['morgan@example.com', true]);
  const mail = mails.at(-1);
  assert.deepEqual(mail.to, ['morgan@example.com']);
  assert.match(mail.subject, /^Factura INV-0001 de /);
  assert.match(mail.text, /Cargo por servicio \(2\.9%\)/);
  assert.ok(!/—|–/.test(mail.text), 'no dashes as punctuation');
  const token = /\/api\/pay\/([0-9a-f]{48})/.exec(mail.text)[1];
  secrets.add(token);
  const stored = await S.sql(String.raw`select '@@R@@' || to_jsonb(pay_token_hash)::text from public.invoices where id = (select v from _in where k = 'i')::uuid;`, { i: inv.id });
  assert.match(stored, /^[0-9a-f]{64}$/); assert.notEqual(stored, token);
  assert.equal((await rpc(hq, 'invoice_save', { p_invoice: { id: inv.id, jobId: made.job, lines: [{ text: 'x', qty: 1, unitCents: 1 }] } })).status >= 400, true, 'a sent invoice is not changed');

  // the pay link opens a Stripe Checkout page for the balance, on the invoice's metadata
  stripeFake = async (u, init) => {
    stripeCalls.push({ u, body: decodeURIComponent(init.body || ''), idem: init.headers['idempotency-key'] });
    return new Response(JSON.stringify({ id: 'cs_test_session0001', url: 'https://checkout.stripe.com/c/pay/cs_test_session0001' }), { status: 200 });
  };
  const opened = await pay('pay/' + token, { 'accept-language': 'es' });
  assert.equal(opened.status, 303, opened.text);
  assert.equal(opened.location, 'https://checkout.stripe.com/c/pay/cs_test_session0001');
  const call = stripeCalls.at(-1);
  assert.match(call.u, /\/v1\/checkout\/sessions$/);
  assert.match(call.body, /line_items\[0\]\[price_data\]\[unit_amount\]=154350/);
  assert.match(call.body, /metadata\[vx\]=erp-invoice/);
  assert.match(call.body, new RegExp(`metadata\\[invoice_id\\]=${inv.id}`));
  assert.equal((await pay('pay/' + 'f'.repeat(48))).status, 410, 'an unknown link');
  assert.equal((await pay('pay/not-a-token')).status, 410);
  assert.equal((await pay('pay/done')).status, 200);

  // Stripe's event, read back from Stripe: recorded once, the invoice paid, a receipt emailed
  const { handleEvent } = await import('../../api/_lib/billing/core.js');
  const { billingDeps } = await import('../../api/_lib/billing/deps.js');
  const session = { id: 'cs_test_session0001', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 154350, currency: 'usd', created: Math.floor(Date.now() / 1000),
    metadata: { vx: 'erp-invoice', tenant_id: hq.tenantId, invoice_id: inv.id, number: 'INV-0001' } };
  const deps = { ...billingDeps(null), stripe: async (m, p) => (p.startsWith('/events/') ? { id: 'evt_1', type: 'checkout.session.completed', data: { object: session } } : {}) };
  const first = await handleEvent(deps, 'evt_1');
  assert.equal(first.invoice.recorded, true); assert.equal(first.invoice.status, 'paid');
  assert.match(mails.at(-1).subject, /^Pago recibido: factura INV-0001/);
  const again = await handleEvent(deps, 'evt_1');
  assert.equal(again.invoice.recorded, false, 'the same payment is recorded once');
  const paid = await S.sql(String.raw`select '@@R@@' || jsonb_build_object('n', (select count(*) from public.client_payments where ref = 'stripe:cs_test_session0001'),
    'amount', (select sum(amount) from public.client_payments where ref = 'stripe:cs_test_session0001'))::text;`, {});
  assert.deepEqual([Number(paid.n), Number(paid.amount)], [1, 1543.5]);
  assert.equal((await pay('pay/' + token)).status, 410, 'a paid invoice\'s link stops working');
  const list = await rpc(hq, 'invoice_list', {});
  assert.equal(list.json.result[0].status, 'paid');

  // an unpaid event, another company's invoice id, a subscription checkout: none of them touch an invoice
  const none = await handleEvent({ ...deps, stripe: async () => ({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { ...session, id: 'cs_test_session0002', payment_status: 'unpaid' } } }) }, 'evt_2');
  assert.equal(none.ignored, true);

  // a company that is not VYNTEX USA: the invoice is sent without an online pay link
  const other = await S.company('builder');
  const ojob = await S.sql(String.raw`with c as (insert into public.clients (tenant_id, name, email) values ((select v from _in where k = 't')::uuid, 'Pat', 'pat@example.com') returning id)
    insert into public.jobs (tenant_id, number, name, client_id, type, status, price) select (select v from _in where k = 't')::uuid, 'P-1', 'Deck', c.id, 'other', 'progress', 100 from c returning '@@R@@' || to_jsonb(id)::text;`, { t: other.tenantId });
  const os = await rpc(other, 'invoice_save', { p_invoice: { jobId: ojob, lines: [{ text: 'Deck repair', qty: 1, unitCents: 10000 }] } });
  const osent = await rpc(other, 'invoice_send', { p_id: os.json.result.id });
  assert.equal(osent.status, 200, osent.text); assert.equal(osent.json.result.online, false);
  assert.ok(!/\/api\/pay\//.test(mails.at(-1).text), 'no pay link');
  // and nobody reaches another company's invoices
  assert.notEqual((await rpc(other, 'invoice_send', { p_id: inv.id })).status, 200);
  assert.equal((await other.owner.post('/api/ws/rpc/invoice_list', { tenant: hq.tenantId, args: {} })).status >= 400, true);
});
