// End-to-end tests of team chat (0087, api/_lib/chat): rooms, messages, delivery to an AI employee, its reply, translation.
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
import { randomBytes, createHmac } from 'node:crypto';
import path from 'node:path';
import { setTestEnv, Browser, secrets, root, ORIGIN } from './helpers.mjs';

const PG = process.env.VX_PG_PUBLIC_DIR || '/tmp/vx-pg-public';
const PORT = 4773;
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
const PW = 'Quiet-harbor-lamp-41';
let S;
const mails = [];
const hooks = [];
const ai = [];
let hookStatus = 200;
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
    if (u.startsWith('https://bots.example.com/')) { hooks.push({ url: u, headers: init.headers, body: init.body }); return new Response('{}', { status: hookStatus }); }
    if (u.startsWith('https://api.anthropic.com/')) { ai.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Buenos días, @Parker. ¿Puede revisar el pipeline?' }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); }
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

async function botMcp(key, name, args) {
  const res = await S.api.public.POST(new Request(`${ORIGIN}/api/public/bot/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'x-forwarded-for': '198.51.100.8' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }));
  const j = await res.json();
  return JSON.parse(j.result.content[0].text);
}

test('team chat: a direct chat with Parker reaches Parker signed, Parker answers, translation is cached', async () => {
  const hq = await S.company('internal');
  const rpc = (co, name, args) => co.owner.post('/api/ws/rpc/' + name, { tenant: co.tenantId, args });
  assert.equal((await hq.owner.post('/api/auth/stepup', { password: PW })).status, 200);
  const bot = (await rpc(hq, 'bot_save', { p_bot: { slug: 'parker', name: 'Parker', title: 'Chief of Staff', access: { tasks: 'edit' } } })).json.result;
  const key = (await rpc(hq, 'bot_key_issue', { p_bot: bot })).json.result.key; secrets.add(key);

  // the owner gives Parker a chat address: the signing secret is shown once, kept only sealed
  assert.equal((await rpc(hq, 'bot_webhook_set', { p_bot: bot, p_url: 'http://bots.example.com/x' })).status, 400, 'https only');
  const hook = await rpc(hq, 'bot_webhook_set', { p_bot: bot, p_url: 'https://bots.example.com/parker' });
  assert.equal(hook.status, 200, hook.text);
  const secret = hook.json.result.secret; secrets.add(secret);
  assert.match(secret, /^vxw_[0-9a-f]{64}$/);
  const sealed = await S.sql(String.raw`select '@@R@@' || to_jsonb(webhook_secret_sealed)::text from app.bots where id = (select v from _in where k = 'b')::uuid;`, { b: bot });
  assert.ok(!String(sealed).includes(secret.slice(4)), 'the secret is stored sealed');

  // a direct chat with Parker; a message; the delivery job; a signed POST to Parker's address
  const room = (await rpc(hq, 'chat_room_open', { p_room: { kind: 'direct', with: { type: 'bot', id: bot } } })).json.result;
  const sent = await rpc(hq, 'chat_send', { p_room: room, p_body: 'Good morning @Parker, can you check the pipeline?' });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.json.result.botsNotified, 1);
  const jobs = await S.sql(String.raw`select '@@R@@' || coalesce(jsonb_agg(payload), '[]'::jsonb)::text from app.jobs where kind = 'chat.bot_deliver';`, {});
  assert.equal(jobs.length, 1);
  const { deliverToBot } = await import('../../api/_lib/chat/index.js');
  assert.deepEqual(await deliverToBot({ payload: jobs[0] }), { delivered: true });
  const h = hooks.at(-1);
  assert.equal(h.url, 'https://bots.example.com/parker');
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h.headers['x-vx-signature']);
  assert.ok(m, 'signed');
  assert.equal(createHmac('sha256', secret).update(`${m[1]}.${h.body}`).digest('hex'), m[2], 'the signature checks with the secret shown once');
  const payload = JSON.parse(h.body);
  assert.equal(payload.type, 'chat.message'); assert.equal(payload.room.id, room); assert.match(payload.message.body, /check the pipeline/);
  assert.deepEqual(payload.reply.args, { roomId: room, replyTo: payload.message.id });

  // a refusal that will not change is not tried again; anything else is
  hookStatus = 410;
  await assert.rejects(deliverToBot({ payload: jobs[0] }), (e) => e.permanent === true);
  hookStatus = 503;
  await assert.rejects(deliverToBot({ payload: jobs[0] }), (e) => e.permanent === false);
  hookStatus = 200;

  // Parker reads its inbox and answers in the chat
  const inbox = await botMcp(key, 'chat_inbox', {});
  assert.equal(inbox.length, 1); assert.equal(inbox[0].room.id, room);
  const reply = await botMcp(key, 'chat_send', { roomId: room, body: 'Good morning. Three leads need a follow-up today.', replyTo: inbox[0].message.id });
  assert.ok(reply.id);
  const sync = await rpc(hq, 'chat_sync', { p_room: room });
  const last = sync.json.result.messages.at(-1);
  assert.equal(last.author.name, 'Parker'); assert.equal(last.replyTo.id, inbox[0].message.id);
  assert.equal((await botMcp(key, 'chat_send', { roomId: '00000000-0000-4000-8000-000000000000', body: 'x' })).error, 'not_a_member');

  // translation: not configured, then configured (the answer is cached on the message)
  const msgId = sent.json.result.message.id;
  assert.equal((await rpc(hq, 'chat_translate', { p_message: msgId, p_lang: 'es' })).json.error, 'ai_not_configured');
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-' + 'x'.repeat(30); secrets.add(process.env.ANTHROPIC_API_KEY);
  const tr = await rpc(hq, 'chat_translate', { p_message: msgId, p_lang: 'es' });
  assert.equal(tr.status, 200, tr.text); assert.match(tr.json.result.text, /^Buenos días/);
  assert.match(ai.at(-1).system, /Spanish/);
  assert.equal((await rpc(hq, 'chat_translate', { p_message: msgId, p_lang: 'es' })).json.result.cached, true, 'cached');
  assert.equal(ai.length, 1, 'the model is asked once');
  delete process.env.ANTHROPIC_API_KEY;

  // another company reaches nothing
  const other = await S.company('builder');
  assert.notEqual((await other.owner.post('/api/ws/rpc/chat_sync', { tenant: hq.tenantId, args: { p_room: room } })).status, 200);
  assert.notEqual((await other.owner.post('/api/ws/rpc/chat_send', { tenant: hq.tenantId, args: { p_room: room, p_body: 'x' } })).status, 200);
});
