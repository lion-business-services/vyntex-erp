// The operator console and a new client's first day, end to end, in a real browser:
//   VYNTEX staff (an operator) signs in with the second step, opens /admin, creates a client workspace at
//   /<business>, and gets the owner's one-time link; the owner accepts it, must add an authenticator, lands in their own
//   workspace with the setup steps; the operator pauses and reactivates the workspace; nobody else reaches the console.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs): a local PostgreSQL with every migration, the test double of
// the Supabase addresses and scripts/serve.mjs running the real handlers of api/. Nothing here ran on Supabase or Vercel.
//
//   node --test --test-concurrency=1 tests/e2e/admin.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, fillSignIn, typeCode, shot } from './helpers.mjs';

const PW = { op: 'Silver-anchor-north-73', owner: 'Cedar-lantern-brook-58' };
let st; let browser;
const open = [];
const guy = async (origin, opts) => { const p = await person(browser, origin, opts); open.push(p); return p; };
const one = (dep, text, data) => dep.sql(`select '@@R@@' || coalesce(to_jsonb((${text}))::text, 'null');`, data);
const noErrors = (p, what) => assert.deepEqual(p.errors, [], `${what}: errors in the browser console`);

/** Accepts an invitation through the page and goes through the authenticator setup. Returns the authenticator secret. */
async function accept(p, link, name, password) {
  await p.go(link);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', name);
  await p.page.fill('[data-testid=auth-invite-password]', password); await p.page.fill('[data-testid=auth-invite-again]', password);
  await p.page.click('[data-testid=auth-submit]');
  await p.page.waitForSelector('[data-testid=auth-enroll]');
  const secret = await p.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  await typeCode(p, st.vyntex.totp(secret));
  await p.page.waitForSelector('[data-testid=auth-codes]');
  await p.page.check('[data-testid=auth-codes-kept]');
  await p.page.click('[data-testid=auth-codes-continue]');
  return secret;
}

let op; let opEmail; let opSecret;
let owner; let client; let ownerSecret;

before(async () => {
  st = await startStack();
  browser = await launch();
  // the production setting of VYNTEX ERP: owners and managers of every company use an authenticator
  await st.vyntex.sql(`update app.server_settings set value = '{"mfaRoles": ["owner", "manager"]}'::jsonb where key = 'security.required'; select '@@R@@' || '1';`);
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

test('the operator: own company first, then added to the operator list in SQL, and the console opens only after the second step', async () => {
  const hq = await st.vyntex.company({ industry: 'build', name: 'VYNTEX USA', slug: 'vyntex-hq', plan: 'master_builder' });
  opEmail = hq.ownerEmail;
  op = await guy(st.vyntex.origin);
  // before anyone is an operator, the console is not there for a stranger either
  await op.go('/signin');
  const anon = await op.api('GET', '/api/admin/context');
  assert.equal(anon.status, 401, 'no session, no console');
  opSecret = await accept(op, hq.inviteLink.replace(st.vyntex.origin, ''), 'Daysi Sample', PW.op);
  await op.workspace();
  // signed in with the second step, but not an operator yet
  await op.go('/admin');
  await op.page.waitForSelector('[data-testid=admin-denied]');
  // the database owner adds the operator (Supabase SQL Editor)
  const uid = await one(st.vyntex, `app.operator_add((select v from _in where k = 'e'))`, { e: opEmail });
  assert.match(String(uid), /^[0-9a-f-]{36}$/);
  await op.go('/admin');
  await op.page.waitForSelector('[data-testid=admin-table]');
  assert.equal(await op.page.locator('[data-testid=admin-row]').count(), 1, 'the operator\'s own company is listed');
  assert.equal(await op.page.innerText('[data-testid=admin-who]'), opEmail);
  await shot(op, 'admin-console');
  noErrors(op, 'console');
});

test('a password alone never opens the console: the database refuses an operator session without the second step', async () => {
  const r = await st.vyntex.sql(String.raw`
    do $$ begin
      perform set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', (select o.user_id from app.operators o limit 1), 'aal', 'aal1')::text, true);
      set local role authenticated;
      begin
        perform public.operator_companies();
        raise exception 'NOT REFUSED';
      exception when insufficient_privilege then null;
      end;
    end $$;
    select '@@R@@' || '"refused"';`);
  assert.equal(r, 'refused');
});

test('the operator creates a client workspace; the address is checked; the owner link is handed back once', async () => {
  const p = op.page;
  await p.click('[data-testid=admin-new]');
  await p.waitForSelector('[data-testid=admin-form]');
  await p.fill('[data-testid=admin-f-name]', 'Greenline Sample Landscaping LLC');
  assert.equal(await p.inputValue('[data-testid=admin-f-slug]'), 'greenline-sample-landscaping', 'the address word comes from the name');
  // a word the site keeps for itself, then one that is taken
  await p.fill('[data-testid=admin-f-slug]', 'admin');
  await p.waitForFunction(() => /used by the site/.test(document.querySelector('[data-testid=admin-f-slug-hint]')?.textContent || ''));
  await p.fill('[data-testid=admin-f-slug]', 'vyntex-hq');
  await p.waitForFunction(() => /already has that address/.test(document.querySelector('[data-testid=admin-f-slug-hint]')?.textContent || ''));
  await p.fill('[data-testid=admin-f-slug]', 'greenline');
  await p.selectOption('[data-testid=admin-f-industry]', 'landscape');
  const plans = await p.locator('[data-testid=admin-f-plan] option').evaluateAll((els) => els.map((e) => e.value));
  assert.ok(plans.length === 4 && plans[3] === 'trial', 'a priced edition offers its three plans and the invitation-only trial: ' + plans.join());
  await p.selectOption('[data-testid=admin-f-plan]', 'trial');
  await p.waitForSelector('[data-testid=admin-f-trial-note]');
  await p.selectOption('[data-testid=admin-f-plan]', plans[1]);
  await p.fill('[data-testid=admin-f-owner-name]', 'Gina Sample');
  await p.fill('[data-testid=admin-f-owner-email]', 'gina@greenline.example');
  await p.click('[data-testid=admin-f-submit]');
  await p.waitForSelector('[data-testid=admin-result]');
  assert.equal(await p.getAttribute('[data-testid=admin-result-delivery]', 'data-delivery'), 'not_configured', 'no email provider here: the operator is told to send it');
  const address = await p.inputValue('[data-testid=admin-result-address]');
  assert.equal(address, st.vyntex.origin + '/greenline');
  const link = await p.inputValue('[data-testid=admin-result-link]');
  assert.match(link, /\/invite\/[A-Za-z0-9_-]{40,}$/);
  client = { slug: 'greenline', link: link.replace(st.vyntex.origin, '') };
  await shot(op, 'admin-created');
  await p.click('text=Done');
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=admin-row]').length === 2);
  const row = p.locator('[data-testid=admin-row][data-slug=greenline]');
  assert.match(await row.innerText(), /Waiting for owner/);
  assert.match(await row.innerText(), /gina@greenline\.example/);
  // the database keeps the hash only, never the token
  const stored = await one(st.vyntex, `(select i.token_hash from app.invitations i join public.tenants t on t.id = i.tenant_id where t.slug = 'greenline')`);
  assert.match(String(stored), /^[0-9a-f]{64}$/);
  assert.ok(!link.includes(String(stored)));
  // the same address cannot be taken twice, even by a request made by hand
  const again = await op.api('POST', '/api/admin/companies', { name: 'Copy', slug: 'greenline', industry: 'landscape', plan: plans[0], ownerEmail: 'x@example.com' });
  assert.equal(again.status, 409);
  noErrors(op, 'create');
});

test('the owner accepts, must add an authenticator, and lands in their own workspace with the setup steps', async () => {
  owner = await guy(st.vyntex.origin);
  ownerSecret = await accept(owner, client.link, 'Gina Sample', PW.owner);
  await owner.workspace();
  assert.equal(new URL(owner.page.url()).pathname, '/greenline');
  assert.match(await owner.page.innerText('.side-brand'), /Greenline Sample Landscaping LLC/);
  await owner.page.waitForSelector('[data-testid=dash-setup]');
  assert.equal(await owner.page.getAttribute('[data-step=security]', 'data-done'), 'yes', 'the sign-in is protected already');
  assert.equal(await owner.page.getAttribute('[data-step=business]', 'data-done'), 'no');
  await shot(owner, 'owner-first-day');
  // the link worked once
  const reuse = await guy(st.vyntex.origin);
  await reuse.go(client.link);
  await reuse.page.waitForSelector('[data-testid=auth-invite-invalid]');
  // the console is not the owner's
  await owner.go('/admin');
  await owner.page.waitForSelector('[data-testid=admin-denied]');
  const tries = await owner.api('GET', '/api/admin/companies');
  assert.equal(tries.status, 403, 'a client owner cannot list the companies');
  const make = await owner.api('POST', '/api/admin/companies', { name: 'Mine', slug: 'mine-now', industry: 'build', plan: 'foundation', ownerEmail: 'me@example.com' });
  assert.equal(make.status, 403, 'nor create one');
  noErrors(owner, 'owner');
});

test('the console lists the owner; a paused workspace says so and keeps its records; reactivating opens it again', async () => {
  await op.go('/admin');
  const row = op.page.locator('[data-testid=admin-row][data-slug=greenline]');
  await row.waitFor();
  assert.match(await row.innerText(), /Live/);
  assert.match(await row.innerText(), /Gina Sample/);
  await row.locator('[data-testid=admin-pause]').click();
  await op.page.click('.modal [data-autofocus]');
  await op.page.waitForFunction(() => /Paused/.test(document.querySelector('[data-testid=admin-row][data-slug=greenline]')?.textContent || ''));
  // the owner, next time the workspace is opened
  await owner.go('/greenline');
  await owner.page.waitForSelector('[data-testid=auth-paused]');
  const tenant = await one(st.vyntex, `(select id from public.tenants where slug = 'greenline')`);
  const blocked = await owner.api('GET', '/api/ws/load?tenant=' + tenant);
  assert.ok(blocked.status === 403 || blocked.status === 401, 'the server refuses the paused workspace: ' + blocked.status);
  await op.page.locator('[data-testid=admin-row][data-slug=greenline] [data-testid=admin-resume]').click();
  await op.page.waitForFunction(() => /Live/.test(document.querySelector('[data-testid=admin-row][data-slug=greenline]')?.textContent || ''));
  await owner.go('/greenline');
  await owner.workspace();
  await owner.page.waitForSelector('[data-testid=dash-setup]');
  // every step of the console was written to the security log
  const kinds = await one(st.vyntex, `(select jsonb_agg(kind order by id) from app.security_events where kind like 'operator.%')`);
  for (const k of ['operator.added', 'operator.company_created', 'operator.status']) assert.ok(kinds.includes(k), k + ' logged: ' + JSON.stringify(kinds));
  noErrors(op, 'pause');
});

test('signing in again later: the owner at their own address, password then the authenticator code', async () => {
  const later = await guy(st.vyntex.origin);
  await later.go('/greenline');
  await fillSignIn(later, 'gina@greenline.example', PW.owner);
  await typeCode(later, st.vyntex.totp(ownerSecret));
  await later.workspace();
  assert.equal(new URL(later.page.url()).pathname, '/greenline');
  noErrors(later, 'sign in again');
});
