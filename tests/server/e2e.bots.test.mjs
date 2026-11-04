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
const PORT = 4771;
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
const PW = 'Quiet-harbor-lamp-41';
let S;
let startedPg = false;

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
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/emails')) return new Response(JSON.stringify({ id: 'email_' + randomBytes(6).toString('hex') }), { status: 200 });
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

/** A bot's request: no cookie, no origin, its key in the Authorization header. */
async function botPost(route, body, key, headers = {}) {
  const res = await S.api.public.POST(new Request(`${ORIGIN}/api/public/bot/${route}`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...(key ? { authorization: 'Bearer ' + key } : {}), ...headers },
  }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, text, json, headers: res.headers };
}
const mcp = (key, method, params, id = 1) => botPost('mcp', { jsonrpc: '2.0', id, method, params }, key);
const toolCall = async (key, name, args = {}) => {
  const r = await mcp(key, 'tools/call', { name, arguments: args });
  assert.equal(r.status, 200, r.text);
  return { data: JSON.parse(r.json.result.content[0].text), isError: r.json.result.isError };
};

test.before(async () => { S = await startStack(); });
test.after(async () => { if (S) await S.stop(); });

test('the owner adds an AI employee, issues its key once, and the bot works within its access map only', async () => {
  const hq = await S.company('internal');
  const other = await S.company('builder');
  const rpc = (co, name, args) => co.owner.post('/api/ws/rpc/' + name, { tenant: co.tenantId, args });
  const sterlingDef = { slug: 'sterling', name: 'Sterling', title: 'Head of Sales & Partnerships',
    access: { leads: 'edit', clients: 'edit', jobs: 'view', tasks: 'edit', calendar: 'edit', documents: 'edit', messages: 'edit', payments: 'view', catalog: 'view', reports: 'edit', automations: 'view', team: 'none' } };

  // adding a bot and its key need a fresh identity check
  const noStep = await rpc(hq, 'bot_save', { p_bot: sterlingDef });
  assert.deepEqual([noStep.status, noStep.json.error], [403, 'stepup_required'], noStep.text);
  assert.equal((await hq.owner.post('/api/auth/stepup', { password: PW })).status, 200);
  const saved = await rpc(hq, 'bot_save', { p_bot: sterlingDef });
  assert.equal(saved.status, 200, saved.text);
  const botId = saved.json.result;

  // another company (not the VYNTEX USA workspace) cannot have AI employees, nor touch these
  assert.equal((await other.owner.post('/api/auth/stepup', { password: PW })).status, 200);
  assert.notEqual((await rpc(other, 'bot_save', { p_bot: { slug: 'x1', name: 'X' } })).status, 200);
  assert.notEqual((await other.owner.post('/api/ws/rpc/bot_key_issue', { tenant: hq.tenantId, args: { p_bot: botId } })).status, 200);

  const issued = await rpc(hq, 'bot_key_issue', { p_bot: botId });
  assert.equal(issued.status, 200, issued.text);
  const key = issued.json.result.key;
  assert.match(key, /^vxb_[0-9a-f]{64}$/);
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  secrets.add(key);
  const listed = await rpc(hq, 'bot_list', {});
  assert.equal(listed.status, 200, listed.text);
  assert.ok(!listed.text.includes(key) && !listed.text.includes(key.slice(4)), 'the key is never shown again');
  assert.equal(listed.json.result[0].keyHint, 'vxb_' + key.slice(-4));
  const stored = await S.sql(String.raw`select '@@R@@' || to_jsonb(key_hash)::text from app.bots where id = (select v from _in where k = 'b')::uuid;`, { b: botId });
  assert.match(String(stored), /^[0-9a-f]{64}$/); assert.ok(!String(stored).includes(key.slice(4)), 'only a keyed hash is stored');

  // no key, a wrong key, a browser
  for (const k of [null, 'vxb_' + '0'.repeat(64), 'not-a-key', key.toUpperCase()]) {
    const r = await mcp(k, 'tools/list', {});
    assert.equal(r.status, 401, `refused: ${String(k).slice(0, 8)}`);
    assert.match(r.headers.get('www-authenticate') || '', /^Bearer/);
  }
  const fromPage = await botPost('mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, key, { origin: 'https://evil.example' });
  assert.equal(fromPage.status, 403);
  assert.equal(fromPage.headers.get('access-control-allow-origin'), null);
  assert.equal((await botPost('nope', {}, key)).status, 404);

  // MCP: initialize, the tools of this access map, a notice
  const init = await mcp(key, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } });
  assert.equal(init.status, 200, init.text);
  assert.equal(init.json.result.serverInfo.name, 'vyntex-erp');
  assert.match(init.json.result.instructions, /Sterling/);
  assert.equal((await botPost('mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, key)).status, 202);
  const tools = (await mcp(key, 'tools/list', {})).json.result.tools.map((t) => t.name);
  assert.ok(tools.includes('leads_create') && tools.includes('messages_draft') && tools.includes('approvals_request'));
  assert.ok(!tools.includes('team_list'), 'no team access, no team tool');
  assert.ok(!tools.filter((t) => t !== 'chat_send').some((t) => /_(send|delete|remove|pay|charge|refund|publish|post|price|sign)$/.test(t)), 'no tool sends, deletes, pays, publishes or prices (chat_send is the internal team chat, never a client)');
  assert.equal((await mcp(key, 'resources/list', {})).json.error.code, -32601);

  // the tools, on this company only
  const lead = await toolCall(key, 'leads_create', { name: 'Grok Prospect', email: 'gp@example.com', source: 'website', type: 'service' });
  assert.ok(!lead.isError, JSON.stringify(lead.data));
  const leadRow = await S.sql(String.raw`select '@@R@@' || jsonb_build_object('t', tenant_id, 'ticket', ticket)::text from public.leads where id = (select v from _in where k = 'l')::uuid;`, { l: lead.data.id });
  assert.equal(leadRow.t, hq.tenantId); assert.match(leadRow.ticket, /^AI-/);
  const win = await toolCall(key, 'leads_update', { id: lead.data.id, status: 'won' });
  assert.deepEqual([win.isError, win.data.error], [true, 'needs_approval']);
  assert.deepEqual((await toolCall(key, 'team_list')).data.error, 'not_allowed');
  assert.ok(Array.isArray((await toolCall(key, 'leads_list')).data));

  const draft = await toolCall(key, 'messages_draft', { to: 'gp@example.com', subject: 'Welcome', body: 'Thank you for reaching out.', leadId: lead.data.id });
  assert.equal(draft.data.status, 'draft');
  const ask = await toolCall(key, 'approvals_request', { kind: 'message.send', what: 'Send the welcome email to Grok Prospect', why: 'They asked for pricing',
    riskIfWeDo: 'None', riskIfWeDont: 'They go cold', recommendation: 'Send today', target: { type: 'message', id: draft.data.id } });
  assert.equal(ask.data.status, 'pending');

  // the plain route answers the same, with plain status codes
  const plain = await botPost('call', { tool: 'reports_summary' }, key);
  assert.equal(plain.status, 200, plain.text); assert.equal(plain.json.result.pendingApprovals, 1);
  assert.equal((await botPost('call', { tool: 'team_list' }, key)).status, 403);
  assert.equal((await botPost('call', { tool: 'leads_delete', args: {} }, key)).status, 400);

  // a person decides; the bot sees the outcome
  const apps = await rpc(hq, 'approvals_list', { p_status: 'pending' });
  assert.equal(apps.json.result.length, 1); assert.equal(apps.json.result[0].bot, 'Sterling');
  assert.deepEqual((await rpc(hq, 'approval_decide', { p_id: apps.json.result[0].id, p_decision: 'approved', p_note: 'Go' })).json.result, { decided: true, queued: true });
  assert.equal((await toolCall(key, 'approvals_list')).data[0].status, 'done');

  // pausing and revoking stop the key at once
  assert.equal((await rpc(hq, 'bot_set_status', { p_bot: botId, p_status: 'paused' })).json.result, true);
  const paused = await mcp(key, 'tools/list', {});
  assert.deepEqual([paused.status, paused.json.error], [403, 'paused']);
  assert.equal((await rpc(hq, 'bot_set_status', { p_bot: botId, p_status: 'active' })).json.result, true);
  assert.equal((await mcp(key, 'ping', {})).status, 200);
  assert.equal((await rpc(hq, 'bot_key_revoke', { p_bot: botId })).json.result, true);
  assert.equal((await mcp(key, 'ping', {})).status, 401);

  const log = await rpc(hq, 'bot_activity_list', {});
  assert.ok(log.json.result.length >= 8, log.text);
  assert.ok(log.json.result.some((x) => x.outcome === 'denied'));
});
