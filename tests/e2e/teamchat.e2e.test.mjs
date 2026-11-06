// Team chat in a real browser (src/features/teamchat, 0087): the owner opens Team > Chat, starts a direct chat with
// Parker, writes; Parker's answer (its chat_send tool) appears; the owner makes a group with a teammate and Parker,
// @mentions Parker with the suggestion list, reacts, and sees the teammate's reply arrive without reloading.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs). The bot's server is not reached: its answer is written with
// the same database call its chat_send tool makes.
//   node --test --test-concurrency=1 tests/e2e/teamchat.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, shot } from './helpers.mjs';

const PW = 'Signal-lantern-maple-73';
let st; let browser;
const open = [];
before(async () => { st = await startStack({ mail: true }); browser = await launch(); });
after(async () => { for (const p of open) await p.close().catch(() => undefined); await browser?.close(); await st?.stop(); });

const one = (sql, data) => st.vyntex.sql(`select '@@R@@' || coalesce(to_jsonb((${sql}))::text, 'null');`, data);

test('the owner chats with Parker and with the team, with mentions, reactions and live replies', async () => {
  const hq = await st.vyntex.company({ industry: 'practice', name: 'VYNTEX USA Sample', slug: 'vyntex-chat-sample', plan: 'internal' });
  const bot = await st.vyntex.sql(String.raw`insert into app.bots (tenant_id, slug, name, title, access) values ((select v from _in where k = 't')::uuid, 'parker', 'Parker', 'Executive Assistant & Chief of Staff', '{}');
    select '@@R@@' || to_jsonb(id)::text from app.bots where tenant_id = (select v from _in where k = 't')::uuid and slug = 'parker';`, { t: hq.tenantId });
  const p = await person(browser, st.vyntex.origin); open.push(p);
  await p.go(new URL(hq.inviteLink).pathname);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', 'Daysi Sample');
  await p.page.fill('[data-testid=auth-invite-password]', PW); await p.page.fill('[data-testid=auth-invite-again]', PW);
  await p.page.click('[data-testid=auth-submit]');
  await p.workspace();
  // a teammate
  const mate = await st.vyntex.sql(String.raw`insert into auth.users (email) values ('ana-chat@example.com');
    insert into public.tenant_members (tenant_id, user_id, role, name, email, title) select (select v from _in where k = 't')::uuid, u.id, 'staff', 'Ana Rivera', 'ana-chat@example.com', 'Account manager' from auth.users u where u.email = 'ana-chat@example.com';
    select '@@R@@' || to_jsonb(m.id)::text from public.tenant_members m where m.email = 'ana-chat@example.com';`, { t: hq.tenantId });

  await p.page.click('[data-nav=team]');
  await p.page.click('[data-testid=section-tabs] [data-tab=teamchat]');
  await p.page.waitForSelector('[data-testid=teamchat]');
  assert.deepEqual(await p.page.locator('[data-testid=section-tabs] a').allInnerTexts().then((x) => x.map((s) => s.split('\n')[0].trim())), ['Profiles', 'Chat', 'Client messages', 'AI employees']);

  // a direct chat with Parker
  await p.page.click('[data-testid=tc-new-chat]');
  await p.page.click('[data-pick="Parker"]');
  await p.page.waitForSelector('[data-testid=tc-input]');
  await p.page.fill('[data-testid=tc-input]', 'Good morning, what needs my attention today?');
  await p.page.keyboard.press('Enter');
  await p.page.waitForFunction(() => /what needs my attention/.test(document.querySelector('[data-testid=tc-messages]')?.textContent || ''));
  const room = await one(String.raw`(select r.id from public.chat_rooms r where r.tenant_id = (select v from _in where k = 't')::uuid and r.kind = 'direct')`, { t: hq.tenantId });
  await one(String.raw`(public.bot_call((select v from _in where k = 'b')::uuid, 'chat.send', jsonb_build_object('roomId', (select v from _in where k = 'r'), 'body', 'Good morning. Two invoices are due this week and one lead is waiting for a call back.')))`, { b: bot, r: room });
  await p.page.waitForFunction(() => /Two invoices are due this week/.test(document.querySelector('[data-testid=tc-messages]')?.textContent || ''), null, { timeout: 20000 });
  await shot(p, 'teamchat-parker');

  // a group with Ana and Parker, and an @mention picked from the list
  await p.page.click('[data-testid=tc-new-group]');
  await p.page.fill('[data-testid=tc-group-name]', 'Sales');
  await p.page.click('[data-pick="Ana Rivera"]'); await p.page.click('[data-pick="Parker"]');
  await p.page.click('[data-testid=tc-group-create]');
  await p.page.waitForSelector('.tc-head:has-text("Sales") >> xpath=.. >> [data-testid=tc-input]');
  await p.page.click('[data-testid=tc-input]');
  await p.page.keyboard.type('@Par');
  await p.page.waitForSelector('.tc-mention-list');
  await p.page.keyboard.press('Enter');
  await p.page.keyboard.type('please send me the pipeline summary');
  assert.equal(await p.page.inputValue('[data-testid=tc-input]'), '@Parker please send me the pipeline summary');
  await p.page.click('[data-testid=tc-send]');
  await p.page.waitForSelector('.tc-at');
  const msg = await one(String.raw`(select jsonb_build_object('mentions', x.mentions, 'id', x.id) from public.chat_messages x join public.chat_rooms r on r.id = x.room_id where r.name = 'Sales' order by x.created_at desc limit 1)`, {});
  assert.deepEqual(msg.mentions, [{ type: 'bot', id: bot }], 'the mention names Parker');

  // a reaction, and Ana's reply arriving without a reload
  await p.page.hover(`[data-msg="${msg.id}"] .tc-bubble`);
  await p.page.hover(`[data-msg="${msg.id}"] .tc-emoji-wrap`);
  await p.page.click(`[data-msg="${msg.id}"] .tc-emoji button[aria-label="👍"]`);
  await p.page.waitForSelector(`[data-msg="${msg.id}"] .tc-react.mine`);
  await st.vyntex.sql(String.raw`insert into public.chat_messages (tenant_id, room_id, author_member, body) select r.tenant_id, r.id, (select v from _in where k = 'm')::uuid, 'I will call the lead after lunch.' from public.chat_rooms r where r.name = 'Sales';
    select '@@R@@' || '1';`, { m: mate });
  await p.page.waitForFunction(() => /call the lead after lunch/.test(document.querySelector('[data-testid=tc-messages]')?.textContent || ''), null, { timeout: 20000 });
  await shot(p, 'teamchat-group');
  assert.deepEqual(p.errors, [], 'no errors in the browser console');
});
