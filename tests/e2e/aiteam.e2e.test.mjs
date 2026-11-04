// AI employees, end to end, in a real browser (0084, src/features/aiteam, api/_lib/public/bot.js): the owner of the
// VYNTEX USA workspace (plan internal) opens AI employees, adds a bot with its access, creates its key (fresh identity
// check, shown once); the bot, from outside, drafts an email and asks for approval over MCP with that key; the owner
// approves and sends it from the Approvals tab. Another company's owner has no such screen.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs): a local PostgreSQL with every migration, the test double of
// the Supabase addresses, scripts/serve.mjs running the real handlers of api/. Nothing here ran on Supabase or Vercel.
//
//   node --test --test-concurrency=1 tests/e2e/aiteam.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, shot } from './helpers.mjs';

const PW = 'Harbor-signal-copper-62';
let st; let browser;
const open = [];
const guy = async (origin, opts) => { const p = await person(browser, origin, opts); open.push(p); return p; };

before(async () => { st = await startStack(); browser = await launch(); });
after(async () => { for (const p of open) await p.close().catch(() => undefined); await browser?.close(); await st?.stop(); });

async function ownerOf(co, name) {
  const p = await guy(st.vyntex.origin);
  await p.go(new URL(co.inviteLink).pathname);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', name);
  await p.page.fill('[data-testid=auth-invite-password]', PW); await p.page.fill('[data-testid=auth-invite-again]', PW);
  await p.page.click('[data-testid=auth-submit]');
  await p.workspace();
  return p;
}
const bot = (key, body) => fetch(st.vyntex.origin + '/api/bot/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const tool = async (key, name, args) => { const r = await bot(key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); assert.equal(r.status, 200); return JSON.parse(r.json.result.content[0].text); };

test('the VYNTEX USA owner adds an AI employee, gives it a key, and approves what it asks', async () => {
  const hq = await st.vyntex.company({ industry: 'build', name: 'VYNTEX USA Sample', slug: 'vyntex-hq-sample', plan: 'internal' });
  const p = await ownerOf(hq, 'Daysi Sample');
  const base = '/' + hq.slug;
  await p.page.click('[data-nav=ai-employees]');
  await p.page.waitForSelector('[data-testid=aiteam]');
  assert.match(await p.page.innerText('[data-testid=aiteam]'), /Access is not approval/);

  // add Sterling with his access
  await p.page.getByRole('tab', { name: /AI employees/ }).click();
  await p.page.getByRole('button', { name: 'Add an AI employee' }).click();
  await p.page.fill('#ai-f-name', 'Sterling');
  await p.page.fill('#ai-f-title', 'Head of Sales & Partnerships');
  const set = async (section, level) => p.page.locator('.ai-grid-row', { hasText: section }).getByRole('button', { name: level, exact: true }).click();
  for (const s of ['Leads', 'Clients', 'Tasks', 'Messages']) await set(s, 'Edit');
  await set('Payments', 'View');
  await p.page.getByRole('button', { name: 'Save' }).click();
  // a fresh identity check first
  await p.page.waitForSelector('[data-testid=auth-stepup]');
  await p.page.fill('[data-testid=auth-stepup-password]', PW); await p.page.click('[data-testid=auth-stepup-submit]');
  await p.page.waitForSelector('[data-bot=sterling]');
  const card = await p.page.innerText('[data-bot=sterling]');
  assert.match(card, /Head of Sales/); assert.match(card, /No key yet/);

  // the key, once
  await p.page.click('[data-bot=sterling] [data-testid=ai-issue]');
  const key = await (await p.page.waitForSelector('[data-testid=ai-key]')).inputValue();
  assert.match(key, /^vxb_[0-9a-f]{64}$/);
  await shot(p, 'aiteam-key');
  await p.page.getByRole('button', { name: 'I have saved it' }).click();
  await p.page.waitForFunction(() => /ends in vxb_/.test(document.querySelector('[data-bot=sterling]')?.textContent || ''));
  assert.ok(!(await p.page.content()).includes(key), 'the key is not on the page any more');

  // the bot works from outside with its key alone
  const lead = await tool(key, 'leads_create', { name: 'Morgan Prospect', email: 'morgan@example.com', source: 'website', type: 'service' });
  const draft = await tool(key, 'messages_draft', { to: 'morgan@example.com', subject: 'Your VYNTEX demo', body: 'Thank you for your interest. Here is the link to book your demo.', leadId: lead.id });
  const asked = await tool(key, 'approvals_request', { kind: 'message.send', what: 'Send the demo email to Morgan Prospect', why: 'Asked for a demo on the website',
    riskIfWeDo: 'None', riskIfWeDont: 'The lead goes cold', recommendation: 'Send today', target: { type: 'message', id: draft.id } });
  assert.equal(asked.status, 'pending');
  assert.equal((await tool(key, 'payments_list', {})).error, undefined);
  assert.equal((await tool(key, 'team_list', {})).error, 'not_allowed');

  // the owner sees it and approves: the draft is sent from here
  await p.go(base + '/ai-employees'); await p.workspace();
  await p.page.waitForSelector('[data-approval]');
  const req = await p.page.innerText('[data-approval]');
  for (const s of ['Level 2', 'Send to a client', 'From Sterling', 'Send the demo email', 'Risk if we do it', 'The lead goes cold', 'Send today']) assert.ok(req.includes(s), s);
  await shot(p, 'aiteam-approvals');
  await p.page.waitForSelector('[data-testid=ai-approve]:has-text("Approve and send")', { timeout: 60000 });
  await p.page.click('[data-testid=ai-approve]');
  await p.page.waitForFunction(() => /Approved and sent|Approved/.test(document.body.innerText));
  await p.saved();
  for (let i = 0; i < 60; i += 1) {
    const s = await st.vyntex.sql(String.raw`select '@@R@@' || jsonb_build_object('m', (select status from public.messages where id = (select v from _in where k = 'm')::uuid),
      'a', (select status from app.approvals where id = (select v from _in where k = 'a')::uuid))::text;`, { m: draft.id, a: asked.id });
    if (s.m !== 'draft' && s.a === 'done') break;
    if (i === 59) assert.fail('the message was not sent, or the approval not marked done: ' + JSON.stringify(s) + ' ' + JSON.stringify(p.applies.slice(-3)) + ' ' + JSON.stringify(p.statuses));
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal((await tool(key, 'approvals_list', {}))[0].status, 'done', 'the bot sees the outcome');
  assert.deepEqual(p.errors, [], 'no errors in the browser console');

  // another company has no AI employees screen
  const other = await st.vyntex.company({ industry: 'build', name: 'Other Builders', slug: 'other-builders-ai', plan: 'quoted' });
  const o = await ownerOf(other, 'Oscar Sample');
  assert.equal(await o.page.locator('[data-nav=ai-employees]').count(), 0);
});
