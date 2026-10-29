// The public 7-day trial, end to end, in a real browser: a visitor opens /start-trial, sends the form, sees "check your
// email", opens the link from the email, sets a password, adds an authenticator, saves the recovery codes and lands in
// the new workspace with the trial banner (7 days, "Choose a plan" to Settings, Billing). Then the plan's users: on a
// one-user plan the Team page says the plan is full and how to upgrade, and an invitation is refused with that message.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs, `mail: true`): a local PostgreSQL with every migration, the
// test double of the Supabase addresses, scripts/serve.mjs running the real handlers of api/ and writing system email to
// a file. Nothing here ran on Supabase, Resend or Vercel.
//
//   node --test --test-concurrency=1 tests/e2e/trial.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, typeCode, shot } from './helpers.mjs';

const PW = 'Harbor-signal-copper-62';
let st; let browser;
const open = [];
const guy = async (origin, opts) => { const p = await person(browser, origin, opts); open.push(p); return p; };
const noErrors = (p, what) => assert.deepEqual(p.errors, [], `${what}: errors in the browser console`);

before(async () => {
  st = await startStack({ mail: true });
  browser = await launch();
  // the production setting of VYNTEX ERP: owners and managers of every company use an authenticator
  await st.vyntex.sql(`update app.server_settings set value = '{"mfaRoles": ["owner", "manager"]}'::jsonb where key = 'security.required'; select '@@R@@' || '1';`);
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

const EMAIL = 'hana@harborwash.example';
let owner; let secret;

test('a visitor starts a trial from /start-trial and is told to check their email', async () => {
  const p = await guy(st.vyntex.origin);
  await p.go('/start-trial');
  await p.page.waitForSelector('[data-testid=tr-form]');
  // offered on this site (database and system email set up)
  const status = await p.api('GET', '/api/auth/trial/status');
  assert.deepEqual(status.json, { ok: true, available: true });
  // a quoted edition starts the trial like any other: the button is there, and a note says how its plan is paid
  await p.page.selectOption('[data-testid=tr-edition]', 'practice');
  await p.page.waitForSelector('[data-testid=tr-quoted]');
  assert.equal(await p.page.locator('[data-testid=tr-submit]').count(), 1, 'the trial button is there for a quoted edition');

  await p.page.selectOption('[data-testid=tr-edition]', 'wash');
  // nothing filled in: the page says what is missing, and sends nothing
  await p.page.click('[data-testid=tr-submit]');
  await p.page.waitForSelector('[data-testid=tr-errors]');
  for (const k of ['business', 'owner', 'email', 'consent']) assert.equal(await p.page.locator(`[data-testid=tr-error-${k}]`).count(), 1, k);

  await p.page.fill('[data-testid=tr-business]', 'Harbor Wash Co');
  assert.match(await p.page.innerText('[data-testid=tr-slug]'), /\/harbor-wash-co$/, 'the address word is shown as it is typed');
  await p.page.fill('[data-testid=tr-owner]', 'Hana Harbor');
  await p.page.fill('[data-testid=tr-email]', EMAIL);
  assert.equal(await p.page.getAttribute('[data-testid=tr-terms]', 'href'), 'https://www.vyntexusa.com/terms');
  assert.equal(await p.page.getAttribute('[data-testid=tr-privacy]', 'href'), 'https://www.vyntexusa.com/privacy');
  await p.page.check('[data-testid=tr-consent]');
  await p.page.click('[data-testid=tr-submit]');
  await p.page.waitForSelector('[data-testid=tr-done]');
  assert.match(await p.page.innerText('[data-testid=tr-done-email]'), new RegExp(EMAIL.replace(/\./g, '\\.')));
  await shot(p, 'trial-check-email');
  noErrors(p, 'start trial');
});

test('the link from the email: password, authenticator, recovery codes, and the workspace opens with 7 days left', async () => {
  const mail = st.vyntex.mails().filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(EMAIL));
  assert.equal(mail.length, 1, 'one email to the owner');
  assert.equal(mail[0].subject, 'Activate your VYNTEX ERP 7-day trial');
  const link = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{40,}/.exec(mail[0].text)[0];
  assert.ok(link.startsWith(st.vyntex.origin + '/invite/'));
  assert.ok(st.vyntex.mails().some((m) => m.subject === `New self-serve trial: Harbor Wash Co (VYNTEX WASH), ${EMAIL}`), 'VYNTEX is told');

  owner = await guy(st.vyntex.origin);
  await owner.go(link.replace(st.vyntex.origin, ''));
  await owner.page.waitForSelector('[data-testid=auth-invite-form]');
  await owner.page.fill('[data-testid=auth-invite-name]', 'Hana Harbor');
  await owner.page.fill('[data-testid=auth-invite-password]', PW); await owner.page.fill('[data-testid=auth-invite-again]', PW);
  await owner.page.click('[data-testid=auth-submit]');
  await owner.page.waitForSelector('[data-testid=auth-enroll]');
  secret = await owner.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  await typeCode(owner, st.vyntex.totp(secret));
  await owner.page.waitForSelector('[data-testid=auth-codes]');
  await owner.page.check('[data-testid=auth-codes-kept]');
  await owner.page.click('[data-testid=auth-codes-continue]');
  await owner.workspace();
  assert.equal(new URL(owner.page.url()).pathname.split('/')[1], 'harbor-wash-co');
  const banner = await owner.page.innerText('.vx-trial-banner');
  assert.match(banner, /7 days left in your free trial/);
  assert.equal(await owner.page.getAttribute('[data-testid=trial-choose-plan]', 'href'), '/harbor-wash-co/settings/billing');
  const row = await st.vyntex.sql(`select '@@R@@' || jsonb_build_object('status', status, 'plan', plan_id)::text from public.tenants where slug = 'harbor-wash-co';`);
  assert.deepEqual(row, { status: 'active', plan: 'trial' });
  noErrors(owner, 'activation');
});

test('seats: on a one-user plan the Team page shows the plan is full, and an invitation explains how to upgrade', async () => {
  // the trial has the top plan (unlimited users); a paid one-user plan, as the billing webhook would set it
  await st.vyntex.sql(`update public.tenants set plan_id = 'essential', trial_expires_at = null where slug = 'harbor-wash-co'; select '@@R@@' || '1';`);
  await owner.go('/harbor-wash-co/settings/team');
  await owner.page.waitForSelector('[data-testid=settings-seats]');
  assert.equal(await owner.page.getAttribute('[data-testid=settings-seats]', 'data-used'), '1');
  assert.equal(await owner.page.getAttribute('[data-testid=settings-seats]', 'data-limit'), '1');
  assert.match(await owner.page.innerText('[data-testid=settings-seats]'), /1 of 1 users on your plan/);
  assert.equal(await owner.page.getAttribute('[data-testid=settings-seats-upgrade]', 'href'), '/harbor-wash-co/settings/billing');

  await owner.page.click('[data-testid=settings-user-add]');
  await owner.page.fill('[data-testid=security-invite-name]', 'Sam Staff');
  await owner.page.fill('[data-testid=security-invite-email]', 'sam@harborwash.example');
  await owner.page.click('[data-testid=security-invite-send]');
  // inviting is protected: a fresh identity check when the last one is older than five minutes (the authenticator was
  // just added, which counts as one), then the server refuses past the plan's users
  await owner.page.waitForSelector('[data-testid=auth-stepup], [data-testid=security-invite-seats]');
  if (await owner.page.locator('[data-testid=auth-stepup]').count()) await typeCode(owner, st.vyntex.totp(secret), '[data-testid=auth-stepup-code]');
  await owner.page.waitForSelector('[data-testid=security-invite-seats]');
  assert.match(await owner.page.innerText('[data-testid=security-invite-seats]'), /Your plan includes 1 user, and that seat is in use/);
  assert.equal(await owner.page.getAttribute('[data-testid=security-invite-upgrade]', 'href'), '/harbor-wash-co/settings/billing');
  const made = await st.vyntex.sql(`select '@@R@@' || count(*)::text from app.invitations where email = 'sam@harborwash.example';`);
  assert.equal(Number(made), 0, 'no invitation was made');
  await shot(owner, 'trial-seat-limit');
});
