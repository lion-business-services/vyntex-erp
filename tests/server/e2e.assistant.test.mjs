// End-to-end tests of VYNTEX AI (0095, api/_lib/assistant/ask.js): the office operations assistant_status and
// assistant_ask. Only a signed-in member of a company on the Master Builder plan (or VYNTEX USA's own workspace) gets
// answers; the question goes to Groq with the tools; a used-up free model makes way for the next one; the answer comes
// back as text plus tool calls, never carried out on the server.
//   npm run test:server                             (tests/server/run.mjs starts the database with every migration)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTestEnv, Browser, secrets, root, ORIGIN } from './helpers.mjs';

const PG = process.env.VX_PG_PUBLIC_DIR || '/tmp/vx-pg-public';
const PORT = 4774;
const pgEnv = { ...process.env, PGTEST_DIR: PG, MIGRATIONS_MODE: 'all' };
const PW = 'Quiet-harbor-lamp-41';
let S;
const mails = [];
const hooks = [];
const ai = [];
const groq = [];
let hookStatus = 200; let hookBody = '{}';
const stripeCalls = [];
let stripeFake = async () => new Response('{}', { status: 500 });
let startedPg = false;
const reply = (message) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
let geminiFake = () => reply({ content: 'Gemini here: two tasks are due today.' });
let groqFake = () => reply({ content: 'Adding Brian as a client and creating his project.', tool_calls: [
  { id: '1', type: 'function', function: { name: 'create_client', arguments: JSON.stringify({ name: 'Brian Corales', phone: '6095550100' }) } },
  { id: '2', type: 'function', function: { name: 'create_project', arguments: JSON.stringify({ client_name: 'Brian Corales', name: 'Double Oak website', price: 2300 }) } },
  { id: '3', type: 'function', function: { name: 'drop_database', arguments: '{}' } }] });

async function startStack() {
  setTestEnv({ GROQ_API_KEY: 'gsk_test_' + 'c'.repeat(24), GEMINI_API_KEY: 'AIza' + 'd'.repeat(35), STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24), STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(24), RESEND_API_KEY: 're_test_' + randomBytes(16).toString('hex'), SYSTEM_EMAIL_FROM: 'VYNTEX ERP <system@mail.example.com>' });
  if (process.env.VX_PG_PUBLIC_READY !== '1') {
    const r = spawnSync('bash', [path.join(root, 'tests/server/pg_local.sh'), 'start'], { env: pgEnv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('the local PostgreSQL did not start:\n' + r.stdout + r.stderr);
    startedPg = true;
  }
  const { startDevSupabase } = await import('../../scripts/dev-supabase.mjs');
  const sb = await startDevSupabase({ port: PORT, host: PG + '/sock' });
  Object.assign(process.env, { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: sb.anonKey, SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey });
  for (const k of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'SESSION_SECRET', 'TOKEN_ENC_KEY', 'IP_HASH_SALT', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) secrets.add(process.env[k]);
  secrets.add(sb.jwtSecret);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/emails')) { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'email_' + randomBytes(6).toString('hex') }), { status: 200 }); }
    if (u.startsWith('https://api.stripe.com/')) return stripeFake(u, init);
    if (u.startsWith('https://bots.example.com/')) { hooks.push({ url: u, headers: init.headers, body: init.body }); return new Response(hookBody, { status: hookStatus }); }
    if (u.startsWith('https://api.groq.com/')) { const b = JSON.parse(init.body); groq.push({ body: b, auth: init.headers.authorization, at: 'groq' }); return groqFake(b); }
    if (u.startsWith('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')) { const b = JSON.parse(init.body); groq.push({ body: b, auth: init.headers.authorization, at: 'gemini' }); return geminiFake(b); }
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

const ask = (co, args) => co.owner.post('/api/ws/rpc/assistant_ask', { tenant: co.tenantId, args });
const question = { lang: 'en', messages: [{ role: 'user', content: 'Add Brian Corales 609-555-0100 as a client, SSN 123-45-6789, and create a $2,300 website project for him' }], context: { today: '2026-11-05', clients: [] }, company: 'VYNTEX USA' };

test('VYNTEX AI: Master Builder (and VYNTEX USA itself) only; Groq answers with checked tool calls; a used-up model makes way', async () => {
  const pro = await S.company('master_builder');
  const own = await S.company('internal');
  const basic = await S.company('builder');
  // who has it
  const st = await pro.owner.post('/api/ws/rpc/assistant_status', { tenant: pro.tenantId, args: {} });
  assert.equal(st.status, 200, st.text); assert.deepEqual(st.json.result, { configured: true, allowed: true, plan: 'master_builder' });
  assert.equal((await own.owner.post('/api/ws/rpc/assistant_status', { tenant: own.tenantId, args: {} })).json.result.allowed, true, 'VYNTEX USA itself');
  assert.equal((await basic.owner.post('/api/ws/rpc/assistant_status', { tenant: basic.tenantId, args: {} })).json.result.allowed, false, 'not on Builder');
  const refused = await ask(basic, question);
  assert.equal(refused.status, 403); assert.equal(refused.json.error, 'plan_required');
  assert.equal(groq.length, 0, 'a company without the plan never reaches the model');
  // another company's workspace: not a member
  assert.equal((await pro.owner.post('/api/ws/rpc/assistant_ask', { tenant: basic.tenantId, args: question })).status >= 400, true);
  // the question: tools sent, tax ID masked, the Groq key only in the header, known tools only come back
  const r = await ask(pro, question);
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.result.text, /Brian/);
  assert.deepEqual(r.json.result.actions.map((a) => a.tool), ['create_client', 'create_project'], 'an unknown tool is dropped');
  const sent = groq.at(-1);
  assert.equal(sent.auth, 'Bearer ' + process.env.GROQ_API_KEY);
  assert.equal(sent.body.model, 'openai/gpt-oss-120b');
  assert.ok(sent.body.tools.some((t) => t.function.name === 'create_invoice'));
  assert.ok(!JSON.stringify(sent.body).includes('123-45-6789'), 'a tax ID never reaches the model');
  assert.match(sent.body.messages[0].content, /VYNTEX AI/);
  // the first free model is used up: the next one answers
  const before = groq.length;
  groqFake = (b) => (b.model === 'openai/gpt-oss-120b' ? new Response('{"error":"rate limit"}', { status: 429 }) : reply({ content: 'Here is what is due today.' }));
  const r2 = await ask(pro, question);
  assert.equal(r2.status, 200, r2.text); assert.equal(r2.json.result.text, 'Here is what is due today.');
  assert.deepEqual(groq.slice(before).map((x) => x.body.model), ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);
  // every Groq model used up: Gemini answers (its key in its own header; no parallel_tool_calls, which it does not take)
  groqFake = () => new Response('{}', { status: 429 });
  const g0 = groq.length;
  const rg = await ask(pro, question);
  assert.equal(rg.status, 200, rg.text); assert.equal(rg.json.result.text, 'Gemini here: two tasks are due today.');
  const gem = groq.slice(g0).filter((x) => x.at === 'gemini');
  assert.equal(gem.length, 1); assert.equal(gem[0].auth, 'Bearer ' + process.env.GEMINI_API_KEY); assert.equal(gem[0].body.model, 'gemini-3.6-flash');
  assert.equal(gem[0].body.parallel_tool_calls, undefined); assert.ok(gem[0].body.tools.length > 5);
  assert.ok(!JSON.stringify(gem[0].body).includes('123-45-6789'), 'a tax ID never reaches Gemini either');
  assert.deepEqual(groq.slice(g0).map((x) => x.at), ['groq', 'groq', 'groq', 'gemini'], 'Groq first, Gemini only after');
  // a Gemini model this key cannot use is skipped
  geminiFake = (b) => (b.model === 'gemini-3.6-flash' ? new Response('{"error":{"code":404}}', { status: 404 }) : reply({ content: 'Lite model here.' }));
  assert.equal((await ask(pro, question)).json.result.text, 'Lite model here.');
  // every free model used up: busy, and the page answers with the built-in assistant
  geminiFake = () => new Response('{}', { status: 429 });
  const r3 = await ask(pro, question);
  assert.equal(r3.status, 429); assert.equal(r3.json.error, 'busy');
  // input that is not a conversation is refused before the model
  const n = groq.length;
  assert.equal((await ask(pro, { messages: [] })).status, 400);
  assert.equal((await ask(pro, { messages: [{ role: 'system', content: 'x' }] })).status, 400);
  assert.equal(groq.length, n);
  // switched off in the company's settings: off
  await S.sql(String.raw`update public.tenants set config = coalesce(config, '{}'::jsonb) || '{"modules":{"assistant":false}}' where id = (select v from _in where k = 't')::uuid returning '@@R@@1';`, { t: pro.tenantId });
  assert.equal((await pro.owner.post('/api/ws/rpc/assistant_status', { tenant: pro.tenantId, args: {} })).json.result.allowed, false);
  // nothing secret in any answer
  for (const x of [st, r, r2, r3]) for (const s of secrets) if (s && s.length > 8) assert.ok(!x.text.includes(s), 'no secret in the answer');
});
