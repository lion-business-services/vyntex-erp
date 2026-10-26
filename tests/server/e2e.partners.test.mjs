// End-to-end tests of the VYNTEX Partner Portal through the real handlers (api/auth.js, api/partners.js, api/cron.js):
// staff and partner invitations, the second sign-in step required for every portal account (gap G1), the Client View
// redaction, offers priced by the server, the public proposal, orders, money that needs a fresh identity check,
// isolation between partners and from ERP customers, suspension, and the email outbox.
//   node --test tests/server/e2e.partners.test.mjs     (starts and stops its own PostgreSQL with every migration)
//   npm run test:server                                 (tests/server/run.mjs runs it on the "every migration" database)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTestEnv, Browser, secrets, assertNoLeak, root, ORIGIN } from './helpers.mjs';

const PG = '/tmp/vx-pg-public';
const PORT = 4751;
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
let S;
let startedPg = false;

async function startStack() {
  setTestEnv({ RESEND_API_KEY: 're_test_' + randomBytes(16).toString('hex'), SYSTEM_EMAIL_FROM: 'VYNTEX ERP <system@mail.example.com>' });
  if (process.env.VX_PG_PUBLIC_READY !== '1') {
    const r = spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'start'], { env: pgEnv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('the local PostgreSQL did not start:\n' + r.stdout + r.stderr);
    startedPg = true;
  }
  const { startDevSupabase, totp } = await import('../../scripts/dev-supabase.mjs');
  const sb = await startDevSupabase({ port: PORT, host: PG + '/sock' });
  Object.assign(process.env, { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey });
  for (const k of ['SESSION_SECRET', 'TOKEN_ENC_KEY', 'IP_HASH_SALT', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) secrets.add(process.env[k]);
  secrets.add(sb.jwtSecret);
  const mail = { sent: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/emails')) {
      const body = JSON.parse(init.body);
      const key = init.headers['idempotency-key'];
      const dup = key && mail.sent.find((m) => m.idem === key);
      if (dup) return new Response(JSON.stringify({ id: dup.id }), { status: 200 });
      const id = 'email_' + randomBytes(6).toString('hex');
      mail.sent.push({ id, idem: key || null, ...body });
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    if (!u.startsWith(sb.url)) throw new Error('a test tried to reach an outside address: ' + u.slice(0, 60));
    return realFetch(url, init);
  };
  const api = { auth: await import('../../api/auth.js'), partners: await import('../../api/partners.js'), cron: await import('../../api/cron.js') };
  const sql = (text, data = {}) => sb.db.run('supabase_admin', [text], data);
  const linkFor = (email) => {
    const m = [...mail.sent].reverse().find((x) => x.to.includes(email));
    if (!m) throw new Error('no email was sent to ' + email);
    return /https?:\/\/\S+/.exec(m.text)[0];
  };
  const cron = (job) => api.cron.GET(new Request(`${ORIGIN}/api/cron/${job}`, { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } })).then((r) => r.json());
  return { api, sb, mail, sql, linkFor, totp, cron, browser: (address) => new Browser(api, { address }),
    async stop() { globalThis.fetch = realFetch; await sb.stop(); if (startedPg) spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'stop'], { env: pgEnv }); } };
}

test.before(async () => { S = await startStack(); });
test.after(async () => { if (S) await S.stop(); });

const PASSWORD = 'Copper-lantern-grove-73';
const people = {};

/** Accepts a partner-portal invitation in a new browser, then enrols the authenticator. */
async function accept(token, email) {
  const b = S.browser();
  await b.open();
  const check = await b.post('/api/auth/partner-invite/check', { token });
  assert.equal(check.status, 200);
  const acc = await b.post('/api/auth/partner-invite/accept', { token, password: PASSWORD, name: 'Test ' + email.split('@')[0] });
  assert.equal(acc.status, 200, acc.text);
  assert.equal(acc.json.signedIn, true);
  assert.equal(acc.json.mfa, 'enroll', 'a portal account must add an authenticator before anything else (G1)');
  const blocked = await b.get('/api/partners/context');
  assert.deepEqual([blocked.status, blocked.json.error], [403, 'mfa_required']);
  const start = await b.post('/api/auth/mfa/enroll', {});
  secrets.delete(start.json.secret);
  const done = await b.post('/api/auth/mfa/confirm', { factorId: start.json.factorId, code: S.totp(start.json.secret) });
  assert.equal(done.status, 200);
  return { b, email, secret: start.json.secret };
}
const stepUp = (p) => p.b.post('/api/auth/stepup', { code: S.totp(p.secret) });

test('staff: bootstrapped from SQL, with the authenticator required; the portal says who they are', async () => {
  const token = await S.sql(String.raw`select '@@R@@' || to_jsonb(partner.staff_invite_bootstrap('partners-admin@example.com', 'partner_admin'))::text;`);
  people.admin = await accept(token, 'partners-admin@example.com');
  const ctx = await people.admin.b.get('/api/partners/context');
  assert.equal(ctx.status, 200);
  assert.deepEqual([ctx.json.context.kind, ctx.json.context.role], ['staff', 'partner_admin']);
  const s = (await people.admin.b.get('/api/auth/session')).json;
  assert.deepEqual([s.signedIn, s.partner, s.memberships.length], [true, { kind: 'staff', role: 'partner_admin' }, 0], 'signed in with no company membership');
});

test('partners: created and invited by staff; the invitation is emailed and only its hash is stored', async () => {
  const a = await people.admin.b.post('/api/partners/admin/partners', { name: 'Atlas Growth', kind: 'revshare', contact_email: 'ops@atlas.example' });
  const b = await people.admin.b.post('/api/partners/admin/partners', { name: 'Beacon Referrals', kind: 'referral', contact_email: 'hi@beacon.example', lang: 'es' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  people.pa = a.json.partner.id; people.pb = b.json.partner.id;
  const inv = await people.admin.b.post(`/api/partners/admin/partners/${people.pa}/invite`, { email: 'owner@atlas.example', name: 'Ana' });
  assert.equal(inv.json.delivery, 'sent');
  const link = S.linkFor('owner@atlas.example');
  assert.match(link, /\/partners\/invite\/[A-Za-z0-9_-]{43}$/);
  const token = link.split('/').pop();
  const stored = await S.sql(String.raw`select '@@R@@' || to_jsonb((select count(*) from partner.invitations where token_hash = (select v from _in where k = 't')))::text;`, { t: token });
  assert.equal(stored, 0, 'the token itself is not stored');
  people.a = await accept(token, 'owner@atlas.example');
  await people.admin.b.post(`/api/partners/admin/partners/${people.pb}/invite`, { email: 'owner@beacon.example', name: 'Beto' });
  const tb = S.linkFor('owner@beacon.example').split('/').pop();
  people.b = await accept(tb, 'owner@beacon.example');
  // a used link is gone
  const again = S.browser(); await again.open();
  assert.equal((await again.post('/api/auth/partner-invite/check', { token })).json.error, 'invite_invalid');
  // a password alone is no longer enough
  const pw = S.browser(); await pw.open();
  const r = await pw.post('/api/auth/signin', { email: 'owner@atlas.example', password: PASSWORD });
  assert.equal(r.json.mfa, 'verify');
  assert.equal((await pw.get('/api/partners/catalog')).json.error, 'mfa_required');
});

test('a partner cannot reach staff functions; an ERP customer cannot reach the portal', async () => {
  const r = await people.a.b.get('/api/partners/admin/partners');
  assert.deepEqual([r.status, r.json.error], [403, 'forbidden']);
  assert.equal((await people.a.b.post('/api/partners/admin/catalog/publish-ready', {})).status, 403);
  // an ERP customer: a company owner signed in normally
  const slug = 'partner-e2e-' + Date.now().toString(36);
  const made = await S.sql(String.raw`with t as (insert into public.tenants (slug, name, industry_id, plan_id, status) values ((select v from _in where k = 's'), 'Customer Co', 'build', 'builder', 'active') returning id)
    select '@@R@@' || jsonb_build_object('id', (select id from t))::text;`, { s: slug });
  const boot = await S.sql(String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select v from _in where k = 'id')::uuid, 'customer@example.com'))::text;`, { id: made.id });
  const cust = S.browser(); await cust.open();
  const acc = await cust.post('/api/auth/invite/accept', { token: boot, password: PASSWORD, name: 'Customer' });
  assert.equal(acc.json.signedIn, true);
  assert.equal((await cust.get('/api/partners/context')).json.context.kind, null);
  assert.deepEqual([(await cust.get('/api/partners/catalog')).status, (await cust.get('/api/partners/orders')).status], [403, 403]);
  // and a customer account cannot be turned into a partner account by an invitation
  await people.admin.b.post(`/api/partners/admin/partners/${people.pa}/invite`, { email: 'customer@example.com', name: 'C' });
  const t = S.linkFor('customer@example.com').split('/').pop();
  const try2 = S.browser(); await try2.open();
  assert.equal((await try2.post('/api/auth/partner-invite/accept', { token: t, password: PASSWORD })).json.error, 'account_in_use');
});

test('catalog: publishing needs a fresh identity check; the Client View is redacted on the server', async () => {
  await S.sql(String.raw`update app.session_stamps set stepup_at = now() - interval '20 minutes'; select '@@R@@' || '1';`);
  const no = await people.admin.b.post('/api/partners/admin/catalog/publish-ready', {});
  assert.deepEqual([no.status, no.json.error], [403, 'stepup_required']);
  await stepUp(people.admin);
  const yes = await people.admin.b.post('/api/partners/admin/catalog/publish-ready', {});
  assert.equal(yes.json.published.items, 28);
  const client = await people.a.b.get('/api/partners/catalog?view=client');
  assert.ok(client.json.catalog.items.length >= 20);
  assert.doesNotMatch(client.text, /compensation|floors|partner_notes|provenance|rate_bps|approved_source/);
  const pv = await people.a.b.get('/api/partners/catalog?view=partner');
  const starter = pv.json.catalog.items.find((x) => x.id === 'starter');
  assert.equal(starter.compensation.status, 'needs_approval', 'no earning shown before VYNTEX approves a policy');
  assert.equal((await people.a.b.get(`/api/partners/catalog?view=partner&as=${people.pb}`)).status, 403, 'a partner cannot preview another partner');
});

test('offers and the public proposal: prices from the server, a private link, the client accepts', async () => {
  const saved = await people.a.b.post('/api/partners/offers', { client_name: 'Harbor Dental', client_email: 'frontdesk@harbor.example', lang: 'en',
    lines: [{ item: 'growth', quantity: 1, setup_cents: 1 }], setup_cents: 1, recurring_cents: 1 });
  assert.equal(saved.status, 200, saved.text);
  const offer = saved.json.offer;
  assert.deepEqual([offer.setup_cents, offer.recurring_cents, offer.needs_approval], [149700, 54700, false]);
  assert.equal((await people.b.b.get('/api/partners/offers/' + offer.id)).status, 403, 'another partner cannot read it');
  assert.equal((await people.a.b.post(`/api/partners/offers/${offer.id}/submit`, {})).json.offer.status, 'approved', 'within the catalog: approved at once');
  const share = await people.a.b.post(`/api/partners/offers/${offer.id}/share`, { email: true, days: 10 });
  assert.equal(share.json.delivery, 'sent');
  const token = share.json.link.split('/').pop();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const visitor = S.browser('203.0.113.9');
  const p = await visitor.get('/api/partners/proposal/' + token);
  assert.equal(p.status, 200);
  assert.equal(p.headers.get('cache-control'), 'no-store');
  assert.deepEqual([p.json.proposal.client_name, p.json.proposal.setup_cents, p.json.proposal.status], ['Harbor Dental', 149700, 'sent'], 'reading changes nothing');
  assert.deepEqual((await visitor.post(`/api/partners/proposal/${token}/viewed`, {})).json, { ok: true, recorded: true }, 'the page reports the view');
  assert.equal((await people.a.b.get('/api/partners/offers/' + offer.id)).json.offer.status, 'viewed');
  assert.doesNotMatch(p.text, /est_once|estimate|partner|policy|discount_bps/);
  assert.equal((await visitor.get('/api/partners/proposal/' + 'x'.repeat(43))).json.error, 'cannot_be_opened');
  const other = await visitor.post(`/api/partners/proposal/${token}/respond`, { decision: 'accepted', name: 'Dr. Lane' }, { origin: 'https://evil.example' });
  assert.equal(other.status, 403, 'another site cannot accept for the client');
  const acc = await visitor.post(`/api/partners/proposal/${token}/respond`, { decision: 'accepted', name: 'Dr. Lane' });
  assert.deepEqual(acc.json, { ok: true, status: 'accepted' });
  people.offer = offer.id;
});

test('orders: from the accepted offer, idempotent; VYNTEX moves it; money needs a fresh identity check', async () => {
  const body = { offer_id: people.offer, contact_name: 'Dr. Lane', contact_email: 'frontdesk@harbor.example', consent: true, idem_key: 'e2e-order-0001', submit: true };
  const o = await people.a.b.post('/api/partners/orders', body);
  assert.equal(o.status, 200, o.text);
  assert.equal(o.json.order.status, 'submitted', o.text);
  assert.equal((await people.a.b.post('/api/partners/orders', body)).json.order.id, o.json.order.id, 'a retried submission returns the same order');
  assert.equal((await people.b.b.get('/api/partners/orders/' + o.json.order.id)).status, 403);
  assert.equal((await people.a.b.post(`/api/partners/admin/orders/${o.json.order.id}/move`, { to: 'approved' })).status, 403, 'a partner cannot approve');
  for (const to of ['under_review', 'approved', 'awaiting_payment', 'in_progress']) {
    const r = await people.admin.b.post(`/api/partners/admin/orders/${o.json.order.id}/move`, { to });
    assert.equal(r.status, 200, r.text);
  }
  const sessionAged = await S.sql(String.raw`update app.session_stamps set stepup_at = now() - interval '20 minutes'; select '@@R@@' || '1';`);
  assert.equal(sessionAged, 1);
  const pay = await people.admin.b.post(`/api/partners/admin/orders/${o.json.order.id}/payment`, { kind: 'deposit', amount_cents: 74900, reference: 'INV-E2E-1' });
  assert.deepEqual([pay.status, pay.json.error], [403, 'stepup_required']);
  await stepUp(people.admin);
  assert.equal((await people.admin.b.post(`/api/partners/admin/orders/${o.json.order.id}/payment`, { kind: 'deposit', amount_cents: 74900, reference: 'INV-E2E-1' })).status, 200);
  const stmt = await people.a.b.get('/api/partners/commissions');
  assert.equal(stmt.json.statement.lines.length, 0, 'no approved policy and no go-live: nothing earned');
  assert.equal((await people.b.b.get(`/api/partners/commissions?as=${people.pa}`)).status, 403);
});

test('notifications go out through the outbox, and are marked sent only with the provider id', async () => {
  const before = S.mail.sent.length;
  // the scheduled tick queues partner.notify once per five minutes; another test file on this database may already have
  // used this window, so the job's own work (api/_lib/partners/jobs.js) is run directly here
  await S.cron('tick');
  const { drainOutbox } = await import('../../api/_lib/partners/jobs.js');
  await drainOutbox();
  const rows = await S.sql(String.raw`select '@@R@@' || jsonb_build_object('sent', (select count(*) from partner.notifications where status = 'sent' and provider_id like 'email_%'),
    'queued', (select count(*) from partner.notifications where status in ('queued', 'sending')))::text;`);
  assert.ok(rows.sent >= 3, JSON.stringify(rows));
  assert.ok(S.mail.sent.length > before);
  assert.ok(S.mail.sent.some((m) => m.to.includes('partners-admin@example.com') && /New partner order/.test(m.subject)), 'staff were told about the new order');
  assert.ok(S.mail.sent.every((m) => !/—/.test(m.text)), 'no em dash in any email');
});

test('suspension ends the partner\'s sessions at once and keeps the records', async () => {
  await stepUp(people.admin);
  const r = await people.admin.b.post(`/api/partners/admin/partners/${people.pb}/status`, { status: 'suspended', reason: 'Agreement under review' });
  assert.equal(r.status, 200, r.text);
  const s = await people.b.b.get('/api/auth/session');
  assert.equal(s.json.signedIn, false);
  assert.equal((await people.b.b.get('/api/partners/orders')).status, 401);
});

test('nothing sent to a browser here contains a secret, a token, a stack trace or database text', () => {
  assertNoLeak(assert);
});
