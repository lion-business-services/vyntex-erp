// Sections with tabs (src/app/modules.ts: `under`, menuFor, sectionOf; src/app/App.tsx: SectionTabs), in a real browser:
//   Tasks | Deadlines, Appointments | Team calendar, Team (Profiles) | Client messages | AI employees
// A screen shown as a tab keeps its own address, permission and on/off switch; without its host section it is a menu
// entry as before. A company's own switches and wording (tenants.config: modules, terms) are applied, live.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs).
//   node --test --test-concurrency=1 tests/e2e/sections.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person } from './helpers.mjs';

let st; let browser;
const open = [];
before(async () => { st = await startStack(); browser = await launch(); });
after(async () => { for (const p of open) await p.close().catch(() => undefined); await browser?.close(); await st?.stop(); });

const navTexts = (p) => p.page.locator('nav.nav a').allInnerTexts().then((x) => x.map((s) => s.split('\n')[0].trim()));
const tabs = (p) => p.page.locator('[data-testid=section-tabs] a').allInnerTexts().then((x) => x.map((s) => s.split('\n')[0].trim()));

test('the sample practice: merged sections show as tabs, each tab keeps its address, the menu lights up for any of them', async () => {
  const p = await person(browser, st.vyntex.origin); open.push(p);
  for (const [path, want, current] of [
    ['tasks', ['Tasks', 'Deadlines'], 'tasks'], ['deadlines', ['Tasks', 'Deadlines'], 'deadlines'],
    ['appointments', ['Appointments', 'Team calendar'], 'appointments'], ['calendar', ['Appointments', 'Team calendar'], 'calendar'],
    ['team', ['Profiles', 'Client messages'], 'team'], ['messages', ['Profiles', 'Client messages'], 'messages'],
  ]) {
    await p.page.goto(`${st.vyntex.origin}/demo/${path}?industry=practice`);
    await p.page.waitForSelector('[data-testid=section-tabs]', { timeout: 20000 }).catch(async (e) => { await p.page.screenshot({ path: '/tmp/vx-e2e-shots/sections-fail.png' }); console.log('URL', p.page.url()); throw e; });
    assert.deepEqual(await tabs(p), want, path);
    assert.equal(await p.page.getAttribute('[data-testid=section-tabs] [aria-current=page]', 'data-tab'), current);
    assert.equal(await p.page.locator('nav.nav a[aria-current=page]').count(), 1, 'one menu entry lit for ' + path);
  }
  const nav = await navTexts(p);
  for (const gone of ['Deadlines', 'Calendar', 'Messages']) assert.ok(!nav.includes(gone), gone + ' is a tab, not a menu entry');
  for (const kept of ['Tasks', 'Appointments', 'Team']) assert.ok(nav.includes(kept), kept);
  // a tab is a link: clicking moves to that screen's own address
  await p.page.goto(`${st.vyntex.origin}/demo/tasks?industry=practice`);
  await p.page.click('[data-testid=section-tabs] [data-tab=deadlines]');
  await p.page.waitForURL(/\/demo\/deadlines/);
  assert.deepEqual(p.errors, []);
});

test('an edition without appointments keeps Calendar in the menu, with no tabs', async () => {
  const p = await person(browser, st.vyntex.origin); open.push(p);
  await p.page.goto(`${st.vyntex.origin}/demo/calendar?industry=build`);
  await p.page.waitForSelector('nav.nav');
  assert.ok((await navTexts(p)).includes('Calendar'));
  assert.equal(await p.page.locator('[data-testid=section-tabs]').count(), 0);
});

test('a live practice with Payroll, Bookkeeping, Licensing and Social media off and Engagements called Projects', async () => {
  const co = await st.vyntex.company({ industry: 'practice', name: 'Sections Sample', slug: 'sections-sample' });
  await st.vyntex.sql(String.raw`update public.tenants set config = '{"modules":{"payroll":false,"bookkeeping":false,"licensing":false,"social":false},"terms":{"en":{"projects":"Projects","project":"Project"}}}'::jsonb
    where id = (select v from _in where k = 'id')::uuid; select '@@R@@' || '1';`, { id: co.tenantId });
  const p = await person(browser, st.vyntex.origin); open.push(p);
  await p.go(new URL(co.inviteLink).pathname);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', 'Pat Sample');
  await p.page.fill('[data-testid=auth-invite-password]', 'Maple-orbit-signal-47'); await p.page.fill('[data-testid=auth-invite-again]', 'Maple-orbit-signal-47');
  await p.page.click('[data-testid=auth-submit]');
  await p.workspace();
  const nav = await navTexts(p);
  for (const gone of ['Payroll', 'Bookkeeping', 'Licensing', 'Social media', 'Engagements']) assert.ok(!nav.includes(gone), gone + ' is off');
  assert.ok(nav.includes('Projects'), 'Engagements are called Projects: ' + nav.join(', '));
  assert.ok(nav.includes('Services'), 'the price list keeps its name');
});
