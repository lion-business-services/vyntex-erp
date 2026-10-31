// End-to-end tests of the public seven-day trial (api/auth.js trial/status and trial/request, api/_lib/trial.js) and of
// the seat limit on invitations (api/ws.js, public.seat_usage of 0078).
//   node --test tests/server/e2e.trial.test.mjs     (starts and stops its own PostgreSQL)
//   npm run test:server                              (tests/server/run.mjs starts the database with every migration)
// Local stand-ins only: a throwaway PostgreSQL with EVERY migration, the test double of the Supabase HTTP surface,
// the real handlers of api/. Emails "sent" through Resend are answered from memory. Nothing here reaches the internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { setTestEnv, Browser, secrets, assertNoLeak, root, ORIGIN } from './helpers.mjs';

const PG = process.env.VX_PG_PUBLIC_DIR || '/tmp/vx-pg-public';
const PORT = 4761;
const sha = (v) => createHash('sha256').update(v).digest('hex');
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
const PW = 'Quiet-harbor-lamp-41';
let S;
let startedPg = false;
let ip = 10;
/** A browser at its own network address, so the per-address limit of one test never counts another's requests. */
const visitor = () => { ip += 1; return new Browser(S.api, { address: `203.0.113.${ip}` }); };
const run = randomBytes(3).toString('hex');
const mailOf = (n) => `trial-${run}-${n}@example.com`;

async function startStack() {
  setTestEnv({ RESEND_API_KEY: 're_test_' + randomBytes(16).toString('hex'), SYSTEM_EMAIL_FROM: 'VYNTEX ERP <system@mail.example.com>' });
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
  const mail = { sent: [], status: 200 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/emails')) {
      if (mail.status !== 200) return new Response(JSON.stringify({ statusCode: mail.status, name: 'application_error', message: 'internal detail from the email provider that must not leak' }), { status: mail.status });
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
  const api = { auth: await import('../../api/auth.js'), ws: await import('../../api/ws.js') };
  const sql = (text, data = {}) => sb.db.run('supabase_admin', [text], data);
  const to = (email) => mail.sent.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(email));
  return { api, sb, mail, sql, to, async stop() { globalThis.fetch = realFetch; await sb.stop(); if (startedPg) spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'stop'], { env: pgEnv }); } };
}

const ask = async (b, body) => { await b.open(); return b.post('/api/auth/trial/request', body); };
const form = (email, more = {}) => ({ business: 'Sparkle Trial Cleaning', owner: 'Tina Trial', email, edition: 'clean', language: 'en', consent: true, website: '', ...more });
const tenantOf = (slug) => S.sql(String.raw`select '@@R@@' || coalesce((select jsonb_build_object('id', id, 'status', status, 'plan', plan_id, 'industry', industry_id, 'started', trial_started_at, 'expires', trial_expires_at,
    'days', extract(epoch from (trial_expires_at - trial_started_at)) / 86400)
  from public.tenants where slug = (select v from _in where k = 's')), 'null'::jsonb)::text;`, { s: slug });
const count = (q, data) => S.sql(`select '@@R@@' || (${q})::text;`, data).then(Number);

test.before(async () => { S = await startStack(); });
test.after(async () => { if (S) await S.stop(); });

test('trial/status: offered on VYNTEX ERP with the database and system email; the switch turns it off', async () => {
  const b = visitor();
  assert.deepEqual((await b.get('/api/auth/trial/status')).json, { ok: true, available: true });
  process.env.TRIAL_SIGNUP_DISABLED = 'true';
  try {
    assert.deepEqual((await b.get('/api/auth/trial/status')).json, { ok: true, available: false });
    const r = await ask(b, form(mailOf('off')));
    assert.deepEqual([r.status, r.json.error], [503, 'trial_unavailable']);
  } finally { delete process.env.TRIAL_SIGNUP_DISABLED; }
  const key = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  try { assert.equal((await b.get('/api/auth/trial/status')).json.available, false, 'no system email: not offered'); } finally { process.env.RESEND_API_KEY = key; }
  assert.equal((await b.post('/api/auth/trial/status', {})).status, 405);
});

let first;
test('a request makes the workspace in onboarding and emails the owner a one-time activation link; VYNTEX is told', async () => {
  const email = mailOf('first');
  const b = visitor();
  const r = await ask(b, form(email.toUpperCase()));
  assert.deepEqual([r.status, r.json], [200, { ok: true, sent: true }], r.text);
  const mine = S.to(email);
  assert.equal(mine.length, 1, 'one email to the owner');
  assert.equal(mine[0].subject, 'Activate your VYNTEX ERP 7-day trial');
  const link = /https?:\/\/\S+\/invite\/([A-Za-z0-9_-]{40,})/.exec(mine[0].text);
  assert.ok(link, 'the activation link is in the email');
  assert.ok(link[0].startsWith(ORIGIN + '/invite/'), 'it points at this site');
  assert.ok(mine[0].text.includes(`${ORIGIN}/sparkle-trial-cleaning`), 'and names the workspace address');
  const notice = S.mail.sent.find((m) => m.subject === `New self-serve trial: Sparkle Trial Cleaning (VYNTEX CLEAN), ${email}`);
  assert.ok(notice, 'VYNTEX gets its notice');
  assert.deepEqual(Array.isArray(notice.to) ? notice.to : [notice.to], ['info@vyntexusa.com']);
  const t = await tenantOf('sparkle-trial-cleaning');
  assert.deepEqual([t.status, t.plan, t.industry, t.started, t.expires], ['onboarding', 'trial', 'clean', null, null], 'no clock before activation');
  // only the token's hash is stored
  assert.equal(await count(`select count(*) from app.invitations where token_hash = (select v from _in where k = 'h')`, { h: sha(link[1]) }), 1);
  assert.equal(await count(`select count(*) from app.security_events where kind = 'trial.requested' and outcome = 'ok'`), 1);
  first = { email, token: link[1], slug: 'sparkle-trial-cleaning' };
});

test('the owner opens the link, sets a password and the 7 days start; the session shows the trial', async () => {
  const b = visitor();
  await b.open();
  const peek = await b.post('/api/auth/invite/check', { token: first.token });
  assert.equal(peek.status, 200, peek.text);
  assert.equal(peek.json.company, 'Sparkle Trial Cleaning');
  const acc = await b.post('/api/auth/invite/accept', { token: first.token, password: PW, name: 'Tina Trial' });
  assert.equal(acc.status, 200, acc.text);
  assert.equal(acc.json.slug, first.slug);
  const t = await tenantOf(first.slug);
  assert.equal(t.status, 'active');
  // exactly 168 hours, also across a daylight-saving change (0078)
  assert.ok(Math.abs(Number(t.days) - 7) < 0.0001, `seven days from activation (${t.days})`);
  if (acc.json.signedIn) {
    const s = await b.get('/api/auth/session');
    const m = s.json.memberships.find((x) => x.slug === first.slug);
    assert.deepEqual([m.plan, m.role, typeof m.trialExpiresAt], ['trial', 'owner', 'string']);
  }
  // the link works once
  const again = visitor(); await again.open();
  assert.equal((await again.post('/api/auth/invite/check', { token: first.token })).json.error, 'invite_invalid');
});

test('one trial per address, ever: a second request gets the same answer and no email', async () => {
  const before = S.mail.sent.length;
  const r = await ask(visitor(), form(first.email, { business: 'Another Name LLC', edition: 'build' }));
  assert.deepEqual([r.status, r.json], [200, { ok: true, sent: true }], 'the same answer as a new address');
  assert.equal(S.mail.sent.length, before, 'no email at all');
  assert.equal(await tenantOf('another-name-llc'), null, 'nothing is made');
});

test('a quoted edition starts a trial like any other: created, and the activation email is sent', async () => {
  for (const edition of ['practice', 'barber']) {
    const before = S.mail.sent.length;
    const r = await ask(visitor(), form(mailOf('quoted-' + edition), { business: 'Quoted ' + edition, edition }));
    assert.deepEqual([r.status, r.json], [200, { ok: true, sent: true }], edition);
    assert.ok(await tenantOf('quoted-' + edition), 'the workspace waits for its owner: ' + edition);
    assert.ok(S.mail.sent.length > before, 'the activation email went out: ' + edition);
  }
});

test('the hidden field: the usual answer, nothing made, nothing sent', async () => {
  const before = S.mail.sent.length;
  const r = await ask(visitor(), form(mailOf('bot'), { business: 'Bot Cleaning', website: 'https://spam.example' }));
  assert.deepEqual([r.status, r.json], [200, { ok: true, sent: true }]);
  assert.equal(S.mail.sent.length, before);
  assert.equal(await tenantOf('bot-cleaning'), null);
});

test('strict validation, and the same-origin and csrf checks of every public auth route', async () => {
  const b = visitor();
  const bad = await ask(b, { business: 'X', owner: '', email: 'nope', edition: 'Clean!', language: 'fr', consent: false });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ['business', 'consent', 'edition', 'email', 'language', 'owner']);
  const noCsrf = await b.post('/api/auth/trial/request', form(mailOf('csrf')), { csrf: false });
  assert.equal(noCsrf.status, 403);
  const otherSite = await b.post('/api/auth/trial/request', form(mailOf('origin')), { origin: 'https://evil.example' });
  assert.equal(otherSite.status, 403);
});

test('a taken address word gets a short ending', async () => {
  const r = await ask(visitor(), form(mailOf('copy'), { business: 'Sparkle Trial Cleaning' }));
  assert.equal(r.status, 200, r.text);
  const m = S.to(mailOf('copy'))[0];
  assert.match(m.text, new RegExp(`${ORIGIN}/sparkle-trial-cleaning-[0-9a-f]{4}\\b`));
});

test('an email that cannot be sent undoes the request: nothing stays reserved, and the visitor may try again', async () => {
  const email = mailOf('undeliverable');
  S.mail.status = 500;
  let r;
  try { r = await ask(visitor(), form(email, { business: 'Undeliverable Landscaping', edition: 'landscape' })); } finally { S.mail.status = 200; }
  assert.deepEqual([r.status, r.json.error], [503, 'email_failed']);
  assert.ok(!r.text.includes('internal detail'), 'the provider text never reaches the visitor');
  assert.equal(await tenantOf('undeliverable-landscaping'), null, 'the address word is free');
  assert.equal(await count(`select count(*) from app.trial_registrations where email_hash = (select v from _in where k = 'h')`, { h: sha(email) }), 0, 'the address is free');
  const again = await ask(visitor(), form(email, { business: 'Undeliverable Landscaping', edition: 'landscape' }));
  assert.equal(again.status, 200, again.text);
  assert.equal(S.to(email).length, 1, 'the second try sends the link');
  assert.equal((await tenantOf('undeliverable-landscaping')).status, 'onboarding');
});

test('limits: 5 requests per 15 minutes from one address, 3 per day for one email', async () => {
  const b = visitor();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await ask(b, form(mailOf('addr-' + i), { business: `Limit Address ${i}` }))).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  const email = mailOf('acct');
  const byEmail = [];
  for (let i = 0; i < 4; i++) byEmail.push((await ask(visitor(), form(email, { business: `Limit Email ${i}` }))).status);
  assert.deepEqual(byEmail, [200, 200, 200, 429], 'the fourth request of the day for one email is refused, whatever its address');
});

test('LBS Command has no trial route at all', async () => {
  process.env.VX_DEPLOY = 'lbs';
  try {
    const b = visitor();
    assert.equal((await b.get('/api/auth/trial/status')).status, 404);
    await b.open();
    assert.equal((await b.post('/api/auth/trial/request', form(mailOf('lbs')))).status, 404);
  } finally { process.env.VX_DEPLOY = 'vyntex'; }
});

// ---- seats ---------------------------------------------------------------------------------------------------------
async function company(plan, industry = 'build') {
  const slug = `seat-${plan.replace(/_/g, '-')}-${randomBytes(3).toString('hex')}`;
  const email = `owner-${slug}@example.com`;
  const made = await S.sql(String.raw`
    with t as (insert into public.tenants (slug, name, industry_id, plan_id, status)
               values ((select v from _in where k = 'slug'), 'Seat Company ' || (select v from _in where k = 'slug'), (select v from _in where k = 'industry'), (select v from _in where k = 'plan'), 'active') returning id)
    select '@@R@@' || jsonb_build_object('id', (select id from t))::text;`, { slug, industry, plan });
  const boot = await S.sql(String.raw`select '@@R@@' || to_jsonb(public.invite_bootstrap((select v from _in where k = 'id')::uuid, (select v from _in where k = 'email')))::text;`, { id: made.id, email });
  const owner = visitor();
  await owner.open();
  const accepted = await owner.post('/api/auth/invite/accept', { token: boot, password: PW, name: 'Seat Owner' });
  if (accepted.status !== 200 || !accepted.json.signedIn) throw new Error('could not create the owner: ' + accepted.text);
  await owner.post('/api/auth/stepup', { password: PW });
  return { tenantId: made.id, slug, owner };
}
const invite = (co, n, role = 'staff') => co.owner.post('/api/ws/rpc/member_invite', { tenant: co.tenantId, args: { email: `p${n}-${co.slug}@example.com`, role, name: 'Person ' + n } });

test('seats: the plan\'s users from the pricing file are enforced on invitation; existing members are never removed', async () => {
  const { pricing } = await import('../../api/_lib/domain.bundle.mjs');
  const [foundation, builder] = pricing.plansFor('build');
  assert.equal(foundation.users, 1); assert.equal(builder.users, 5);

  const one = await company(foundation.id);
  const usage = await one.owner.post('/api/ws/rpc/seat_usage', { tenant: one.tenantId, args: {} });
  assert.equal(usage.status, 200, usage.text);
  assert.deepEqual([usage.json.result.members, usage.json.result.invites, usage.json.result.plan], [1, 0, foundation.id]);
  const full = await invite(one, 1);
  assert.equal(full.status, 409, full.text);
  assert.deepEqual([full.json.error, full.json.limit, full.json.used, full.json.plan], ['seat_limit', 1, 1, foundation.id]);
  assert.equal(await count(`select count(*) from app.invitations where tenant_id = (select v from _in where k = 't')::uuid and role <> 'owner'`, { t: one.tenantId }), 0, 'nothing was made');

  const five = await company(builder.id);
  for (let i = 1; i <= 4; i++) assert.equal((await invite(five, i)).status, 200, 'invitation ' + i);
  const over = await invite(five, 5);
  assert.deepEqual([over.status, over.json.error, over.json.limit, over.json.used], [409, 'seat_limit', 5, 5], 'open invitations count');

  // moving down to the one-user plan never removes anyone: the members stay, only new invitations stop
  await S.sql(`update public.tenants set plan_id = (select v from _in where k = 'p') where id = (select v from _in where k = 't')::uuid; select '@@R@@' || '1';`, { p: foundation.id, t: five.tenantId });
  assert.equal(await count(`select count(*) from public.tenant_members where tenant_id = (select v from _in where k = 't')::uuid and status = 'active'`, { t: five.tenantId }), 1);
  assert.equal(await count(`select count(*) from app.invitations where tenant_id = (select v from _in where k = 't')::uuid and used_at is null and revoked_at is null and role <> 'owner'`, { t: five.tenantId }), 4, 'the open invitations stay');
  assert.equal((await invite(five, 6)).json.error, 'seat_limit');

  // the top plan, a trial (the edition's top plan) and a plan the pricing file does not have (quoted, internal) are unlimited
  for (const plan of [pricing.plansFor('build').at(-1).id, 'trial', 'internal']) {
    await S.sql(`update public.tenants set plan_id = (select v from _in where k = 'p') where id = (select v from _in where k = 't')::uuid; select '@@R@@' || '1';`, { p: plan, t: five.tenantId });
    assert.equal((await invite(five, 'u-' + plan)).status, 200, plan);
  }

  // another company cannot read the count
  const peek = await one.owner.post('/api/ws/rpc/seat_usage', { tenant: five.tenantId, args: {} });
  assert.equal(peek.status, 403);
});

test('nothing secret reached a browser', () => { assertNoLeak(assert); });
