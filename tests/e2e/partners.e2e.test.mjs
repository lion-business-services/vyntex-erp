// The VYNTEX Partner Portal end to end, in a real browser:
//   VYNTEX partner staff is bootstrapped from SQL, accepts at /partners/invite/<token>, must add an authenticator, then
//   publishes the imported catalog and approves the revenue-share policies (each with a fresh identity check), creates a
//   partner and invites its owner. The partner accepts, adds an authenticator, presents the Client View (no partner pay
//   in it), sees its estimated pay in Partner View, builds an offer the server prices, shares the proposal link; a client
//   with no account opens it and accepts; the partner turns it into an order; VYNTEX moves the order. Desktop and phone.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs): a local PostgreSQL with every migration, the test double of
// the Supabase addresses and scripts/serve.mjs running the real handlers of api/. Nothing here ran on Supabase or Vercel.
//
//   node --test --test-concurrency=1 tests/e2e/partners.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, typeCode, shot } from './helpers.mjs';

const PW = { staff: 'Granite-harbor-seven-41', partner: 'Willow-copper-lane-62' };
let st; let browser;
const open = [];
const guy = async (origin, opts) => { const p = await person(browser, origin, opts); open.push(p); return p; };
const noErrors = (p, what) => assert.deepEqual(p.errors, [], `${what}: errors in the browser console`);

/** Accepts a partner-portal invitation in the page and goes through the authenticator setup. Returns its secret. */
async function accept(p, path, name, password) {
  await p.go(path);
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
  await p.page.waitForSelector('[data-testid=partners]');
  return secret;
}
/** Makes the last fresh identity check old, so the next protected action has to ask again. */
const ageStepUp = () => st.vyntex.sql(String.raw`update app.session_stamps set stepup_at = now() - interval '20 minutes'; select '@@R@@' || '1';`);
/** Answers the fresh identity check the page asks for. */
async function stepUp(p, secret) {
  await p.page.waitForSelector('[data-testid=auth-stepup]');
  await p.page.fill('[data-testid=auth-stepup-code]', st.vyntex.totp(secret));
  await p.page.waitForSelector('[data-testid=auth-stepup]', { state: 'detached' });
}
const confirm = (p, label) => p.page.locator('.modal').getByRole('button', { name: label, exact: true }).click();

let staff; let staffSecret; let partner; let partnerSecret; let proposalLink;

before(async () => {
  st = await startStack();
  browser = await launch();
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

test('the sign-in page fills the screen in the portal\'s dress, and an email VYNTEX never invited cannot get in', async () => {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const p = await guy(st.vyntex.origin, { width: w, height: h });
    await p.go('/partners/signin');
    await p.page.waitForSelector('[data-testid=auth-signin] form');
    // the brand frame is the page: nothing sits above it or beside it
    const box = await p.page.locator('.auth').boundingBox();
    assert.equal(Math.round(box.x), 0); assert.equal(Math.round(box.y), 0); assert.equal(Math.round(box.width), w);
    assert.ok(box.height >= h - 1, 'the frame is at least one screen tall');
    assert.match(await p.page.locator('.auth-eyebrow').innerText(), /partner portal/i);
    assert.match(await p.page.locator('[data-testid=auth-invite-only]').innerText(), /invited/);
    assert.equal(await p.page.getAttribute('[data-testid=pp-become]', 'href'), 'https://www.vyntexusa.com/partners');
    await p.page.fill('input[type=email]', 'not-invited@example.com');
    await p.page.fill('input[type=password]', 'Some-long-password-123');
    await p.page.click('[data-testid=auth-submit]');
    await p.page.waitForSelector('[data-testid=auth-error]');
    assert.equal(await p.page.locator('[data-testid=partners]').count(), 0);
    noErrors(p, 'sign-in ' + w);
  }
});

test('staff: bootstrapped in SQL, invited, the authenticator is required, the portal opens as administrator', async () => {
  const token = await st.vyntex.sql(String.raw`select '@@R@@' || to_jsonb(partner.staff_invite_bootstrap('partners@vyntex.example', 'partner_admin'))::text;`);
  staff = await guy(st.vyntex.origin);
  staffSecret = await accept(staff, '/partners/invite/' + token, 'Daysi Sample', PW.staff);
  await staff.page.getByText('Partner operations').waitFor();
  assert.ok(await staff.page.getByText('Partner administrator').isVisible());
  await shot(staff, 'partners-staff-home');
  noErrors(staff, 'staff home');
});

test('staff publishes the imported catalog and approves policies, each after a fresh identity check', async () => {
  await ageStepUp();
  await staff.go('/partners/catalog/manage');
  await staff.page.click('[data-testid=pp-publish-ready]');
  await confirm(staff, 'Publish');
  await stepUp(staff, staffSecret);
  await staff.page.getByText('28 items published.').waitFor();
  await staff.go('/partners/catalog/policies');
  for (const id of ['revshare-setup-20', 'revshare-monthly-3']) {
    await staff.page.click(`[data-testid=pp-approve-${id}]`);
    await confirm(staff, 'Approve');
    await staff.page.waitForSelector(`[data-testid=pp-approve-${id}]`, { state: 'detached' });
  }
  const n = await st.vyntex.sql(String.raw`select '@@R@@' || to_jsonb((select count(*) from partner.policy_versions where status = 'approved'))::text;`);
  assert.equal(n, 2);
  await shot(staff, 'partners-policies');
  noErrors(staff, 'catalog administration');
});

test('staff creates a partner and invites its owner; the partner accepts and must add an authenticator', async () => {
  await staff.go('/partners/manage');
  await staff.page.click('[data-testid=pp-partner-new]');
  await staff.page.fill('[data-testid=mp-name]', 'Coastline Growth');
  await staff.page.selectOption('#mp-k', 'revshare');
  await staff.page.fill('[data-testid=mp-email]', 'ops@coastline.example');
  await staff.page.click('[data-testid=mp-save]');
  await staff.page.getByRole('cell', { name: /Coastline Growth/ }).waitFor();
  await staff.page.getByRole('button', { name: 'Invite' }).first().click();
  await staff.page.fill('[data-testid=mi-email]', 'owner@coastline.example');
  await staff.page.click('[data-testid=mi-send]');
  const link = await staff.page.inputValue('#mi-l');
  assert.match(link, /\/partners\/invite\/[A-Za-z0-9_-]{43}$/);
  await shot(staff, 'partners-manage');
  partner = await guy(st.vyntex.origin);
  partnerSecret = await accept(partner, new URL(link).pathname, 'Rosa Coastline', PW.partner);
  await partner.page.getByText('Welcome, Coastline Growth').waitFor();
  // a partner has no staff utility, and the staff routes refuse it
  assert.equal(await partner.page.getByRole('link', { name: 'Partners' }).count(), 0);
  const r = await partner.api('GET', '/api/partners/admin/partners');
  assert.equal(r.status, 403);
  noErrors(partner, 'partner home');
});

test('Client View carries no partner pay; Partner View shows the estimate under the approved policy', async () => {
  await partner.go('/partners/catalog/client');
  await partner.page.waitForSelector('[data-testid=pp-item-starter]');
  const body = await partner.page.innerText('.pp-grid');
  assert.doesNotMatch(body, /estimated pay|Your estimated|\$299\.40/i);
  await partner.page.locator('[data-testid=pp-item-growth]').getByRole('button', { name: 'Present' }).click();
  await partner.page.waitForSelector('[data-testid=pp-present]');
  await shot(partner, 'partners-present');
  await partner.page.keyboard.press('Escape');
  await partner.go('/partners/catalog/partner');
  const earn = await partner.page.innerText('[data-testid=pp-earn-growth]');
  assert.match(earn, /\$299\.40/, '20% of the $1,497 setup');
  assert.match(earn, /\$16\.41/, '3% of $547 a month');
  await shot(partner, 'partners-partner-view');
  noErrors(partner, 'catalog');
});

test('the offer: priced by the server, approved within the catalog, shared, opened and accepted by the client', async () => {
  await partner.go('/partners/catalog/offers/new?items=growth');
  await partner.page.waitForSelector('[data-testid=pp-builder]');
  await partner.page.fill('[data-testid=ob-client]', 'Harbor Dental');
  await partner.page.fill('#ob-ce', 'frontdesk@harbor.example');
  await partner.page.click('[data-testid=ob-save]');
  await partner.page.waitForURL(/\/partners\/catalog\/offers\/[0-9a-f-]{36}$/);
  await partner.page.waitForSelector('[data-testid=ob-est]');
  assert.equal(await partner.page.innerText('[data-testid=ob-est]'), '$299.40');
  await shot(partner, 'partners-offer-builder');
  await partner.page.click('[data-testid=ob-submit]');
  await partner.page.waitForSelector('[data-testid=pp-offer]');
  await partner.page.click('[data-testid=ob-share]');
  proposalLink = await partner.page.inputValue('[data-testid=ob-link]');
  assert.match(proposalLink, /\/proposal\/[A-Za-z0-9_-]{43}$/);
  const client = await guy(st.vyntex.origin, { width: 390, height: 844 });
  await client.go(new URL(proposalLink).pathname);
  await client.page.waitForSelector('[data-testid=pp-proposal]');
  const doc = await client.page.innerText('[data-testid=pp-proposal]');
  assert.match(doc, /Harbor Dental/);
  assert.match(doc, /\$1,497\.00/);
  assert.doesNotMatch(doc, /299\.40|16\.41|Coastline|estimated pay|commission/i, 'no partner pay and no partner name in the proposal');
  await shot(client, 'partners-proposal-phone');
  await client.page.click('[data-testid=pp-accept]');
  await client.page.fill('#pp-sign', 'Dr. Lane');
  await client.page.getByRole('button', { name: /Confirm/ }).click();
  await client.page.getByText(/Accepted\. Thank you/).waitFor();
  noErrors(client, 'proposal');
});

test('the accepted offer becomes an order; VYNTEX moves it; the partner sees the change', async () => {
  await partner.page.reload();
  await partner.page.click('[data-testid=ob-order]');
  await partner.page.fill('[data-testid=oc-name]', 'Dr. Lane');
  await partner.page.check('[data-testid=oc-consent]');
  await partner.page.click('[data-testid=oo-submit]');
  await partner.page.waitForSelector('[data-testid=pp-order]');
  const url = partner.page.url();
  await staff.go(new URL(url).pathname);
  await staff.page.waitForSelector('[data-testid=pp-order]');
  await staff.page.click('[data-testid=om-move-under_review]');
  await staff.page.click('[data-testid=mv-go]');
  await staff.page.getByText('Under review').first().waitFor();
  await partner.page.reload();
  await partner.page.getByText('Under review').first().waitFor();
  await shot(partner, 'partners-order');
  // the phone layout of the portal
  await partner.page.setViewportSize({ width: 390, height: 844 });
  await partner.go('/partners/commissions');
  await partner.page.getByRole('heading', { name: 'Commission lines' }).waitFor();
  await shot(partner, 'partners-commissions-phone');
  noErrors(partner, 'order');
  noErrors(staff, 'staff order');
});
