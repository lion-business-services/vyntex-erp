// Team chat on the server (0087).
//   send        the office operation `chat_send`: the database stores the message (the person's own rights), then it is
//               sent at once to each AI employee it is meant for; one that does not go through becomes a retried job
//   deliver     the job `chat.bot_deliver`: POST to the AI employee's own HTTPS address, signed like Stripe signs its
//               events: header  X-VX-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the bot's secret>
//               The secret is made here when the owner sets the address, shown once, and kept only sealed with the
//               server's key. A failed delivery is tried again with a growing wait (api/_lib/jobs.js); the bot can also
//               read the same messages with its chat_inbox tool at any time
//   translate   the office operation `chat_translate`: VYNTEX AI writes the message in English or Spanish, cached on it
//   webhook     the office operation `bot_webhook_set` (owner, fresh identity check)
import { createHmac, randomBytes } from 'node:crypto';
import { userRpc, serviceRpc } from '../supabase.js';
import { sealToken, openToken } from '../crypto.js';
import { enqueue, JobError } from '../jobs.js';
import { has, env } from '../env.js';
import { log } from '../respond.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_OK = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/[^\s]*)?$/;
const AAD = 'vx-bot-webhook';
const AUTH_AAD = 'vx-bot-webhook-auth';
// an Authorization header value: printable, one line
const AUTH_OK = /^[\x21-\x7e][\x20-\x7e]{0,1998}[\x21-\x7e]$/;

export const sign = (secret, body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

// 0093: pushes are tried at once, then again after 2, 10 and 30 seconds on any non-2xx answer or timeout, and every
// push is logged (app.bot_webhook_deliveries, shown on the AI employee card). The retries keep running after the chat
// message was answered (Vercel's waitUntil); where that is not available the job runner takes over.
export const RETRY_WAITS = [2000, 10000, 30000];
const ATTEMPT_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requestContext = () => globalThis[Symbol.for('@vercel/request-context')]?.get?.();
/** True when work can go on after the response was sent (Vercel's waitUntil). */
export const canKeepRunning = () => typeof requestContext()?.waitUntil === 'function';
/** Keeps a promise running after the response was sent (Vercel), or returns false when that is not available here. */
export function keepRunning(promise) {
  const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
  if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(promise); return true; }
  return false;
}
// the start of a routine's answer, for the log: one line, no more than 200 characters
const snippet = (t) => String(t || '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 200);

/** What a push needs for this bot and message: address, sealed secret and header, the room and the message. */
async function target(bot, message) {
  const d = await serviceRpc('chat_bot_delivery', { p_bot: bot, p_message: message });
  if (!d.ok) return { error: 'store_unavailable' };
  return d.data ? { x: d.data } : { error: 'not_for_this_bot' };
}

/** The body of a push: the full message at the top (what a routine reads first), then the nested form of 0087. */
export function chatBody(x, bot, message) {
  const m = x.message || {};
  return JSON.stringify({ type: 'chat.message', id: `${message}:${bot}`, at: new Date().toISOString(),
    roomId: x.room.id, roomKind: x.room.kind, roomName: x.room.name, messageId: m.id, sentAt: m.at,
    sender: m.author ? { type: m.author.type, id: m.author.id, name: m.author.name } : null, body: m.body || '',
    mentions: m.mentions || [], replyToMessage: m.replyTo || null, files: m.files || [],
    to: x.bot, bot: x.bot, room: x.room, message: m,
    reply: { tool: 'chat_send', args: { roomId: x.room.id, replyTo: m.id } } });
}

/** One POST to the bot's address. Answers { status, error, ok } and never throws. */
export async function postOnce(x, body, { event = 'chat.message', timeoutMs = ATTEMPT_MS } = {}) {
  if (!x || !x.url) return { ok: false, status: null, error: 'no_address', final: true };
  if (!URL_OK.test(x.url)) return { ok: false, status: null, error: 'address_invalid', final: true };
  const secret = x.sealed ? openToken(x.sealed, AAD + ':' + x.bot.id) : null;
  if (!secret) return { ok: false, status: null, error: 'secret_unreadable', final: true };
  const auth = x.auth ? openToken(x.auth, AUTH_AAD + ':' + x.bot.id) : null;
  if (x.auth && !auth) return { ok: false, status: null, error: 'auth_unreadable', final: true };
  const headers = { 'content-type': 'application/json', 'user-agent': 'VYNTEX-ERP-Chat/1', 'x-vx-signature': sign(secret, body), 'x-vx-event': event };
  if (auth) headers.authorization = auth;
  let res;
  try { res = await fetch(x.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers, body }); }
  catch (e) { return { ok: false, status: null, error: e && e.name === 'TimeoutError' ? 'timeout' : 'unreachable' }; }
  let text = ''; try { text = await res.text(); } catch { /* no body */ }
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null };
  return { ok: false, status: res.status, error: snippet(text) || 'status_' + res.status };
}

/** Pushes one message to one bot: at once, then after 2, 10 and 30 seconds while it fails. Logs every attempt. */
export async function pushWithRetries(tenant, bot, message, { waits = RETRY_WAITS } = {}) {
  const t = await target(bot, message);
  if (t.error) { log('chat', 'push_skipped', { code: t.error }); return { ok: false, error: t.error }; }
  if (!t.x.url) return { ok: false, error: 'no_address' };
  const body = chatBody(t.x, bot, message);
  let id = null; let out;
  for (let attempt = 1; attempt <= waits.length + 1; attempt += 1) {
    out = await postOnce(t.x, body);
    const lg = await serviceRpc('bot_delivery_log', { p_id: id, p_tenant: tenant, p_bot: bot, p_message: message, p_kind: 'chat', p_status: out.status, p_error: out.error, p_attempts: attempt });
    if (lg.ok && lg.data) id = lg.data;
    if (out.ok) return { ok: true, status: out.status, attempts: attempt };
    log('chat', 'push_failed', { status: out.status ?? 0, attempt, code: String(out.error || '').slice(0, 60) });
    if (out.final || attempt > waits.length) break;
    await sleep(waits[attempt - 1]);
  }
  return { ok: false, status: out.status, error: out.error };
}

/**
 * Pushes a message to each AI employee it is meant for, in parallel, the moment it was saved. The chat message is
 * answered at once; the pushes and their retries go on in the background. Answers how many bots were pushed to.
 */
export async function queueBots(tenant, messageId, bots) {
  const list = [...new Set((Array.isArray(bots) ? bots : []).filter((b) => UUID.test(String(b))))].slice(0, 10);
  if (!UUID.test(String(messageId)) || !list.length) return 0;
  if (!canKeepRunning()) {
    // no background time here: the first attempt is made now and what failed goes to the job runner
    const first = await Promise.all(list.map(async (bot) => {
      const t = await target(bot, messageId);
      if (t.error || !t.x.url) return true;
      const r = await postOnce(t.x, chatBody(t.x, bot, messageId));
      await serviceRpc('bot_delivery_log', { p_id: null, p_tenant: tenant, p_bot: bot, p_message: messageId, p_kind: 'chat', p_status: r.status, p_error: r.error, p_attempts: 1 });
      if (!r.ok && !r.final) await enqueue('chat.bot_deliver', { bot, message: messageId }, { tenant, idem: `chat:${messageId}:${bot}`, maxAttempts: 4 });
      return true;
    }));
    return first.length;
  }
  keepRunning(Promise.all(list.map((bot) => pushWithRetries(tenant, bot, messageId).catch(() => ({ ok: false })))));
  return list.length;
}

/** The office operation `chat_send` ({ p_room, p_body, p_reply_to?, p_mentions?, p_files? }). */
export async function chatSend({ session, tenant, args }, upstreamError) {
  if (!UUID.test(String(args.p_room || ''))) return { status: 400, error: 'invalid_args' };
  const r = await userRpc(session.at, 'chat_send', { p_tenant: tenant, p_room: args.p_room, p_body: typeof args.p_body === 'string' ? args.p_body : '',
    p_reply_to: UUID.test(String(args.p_reply_to || '')) ? args.p_reply_to : null, p_mentions: Array.isArray(args.p_mentions) ? args.p_mentions.slice(0, 30) : [],
    p_files: Array.isArray(args.p_files) ? args.p_files.slice(0, 10) : [] });
  if (!r.ok) throw upstreamError(r);
  const out = r.data || {};
  const queued = await queueBots(tenant, out.message?.id, out.bots);
  return { status: 200, result: { message: out.message, botsNotified: queued } };
}

/** The job `chat.bot_deliver` ({ bot, message }): one more attempt by the job runner. */
export async function deliverToBot(job, { timeoutMs = 8000 } = {}) {
  const { bot, message } = job.payload || {};
  if (!UUID.test(String(bot)) || !UUID.test(String(message))) throw new JobError('payload_invalid', { permanent: true });
  const t = await target(bot, message);
  if (t.error === 'store_unavailable') throw new JobError('store_unavailable');
  if (t.error || !t.x.url) return { skipped: t.error || 'no_address' };
  const r = await postOnce(t.x, chatBody(t.x, bot, message), { timeoutMs });
  await serviceRpc('bot_delivery_log', { p_id: null, p_tenant: t.x.tenant, p_bot: bot, p_message: message, p_kind: 'chat', p_status: r.status, p_error: r.error, p_attempts: (job.attempts || 0) + 1 });
  if (r.ok) return { delivered: true };
  if (r.final) throw new JobError(r.error, { permanent: true });
  throw new JobError(r.status ? 'status_' + r.status : String(r.error));
}

/** A sample push to one bot, sent once (the AI employee card's "Send test push", and the job `bot.webhook_test`). */
export async function testPush(bot) {
  if (!UUID.test(String(bot))) return { ok: false, status: null, error: 'not_found' };
  const d = await serviceRpc('bot_webhook_target', { p_bot: bot });
  if (!d.ok || !d.data) return { ok: false, status: null, error: 'not_found' };
  const x = d.data;
  if (!x.url) return { ok: false, status: null, error: 'no_address' };
  const now = new Date().toISOString();
  const body = JSON.stringify({ type: 'chat.test', test: true, id: `test:${bot}:${Date.now()}`, at: now,
    roomId: null, roomKind: 'direct', roomName: '', messageId: null, sentAt: now,
    sender: { type: 'system', id: null, name: 'VYNTEX ERP' }, body: `Test push to ${x.bot.name} from VYNTEX ERP. No reply is needed.`,
    mentions: [], replyToMessage: null, files: [], to: x.bot, bot: x.bot });
  const started = Date.now();
  const r = await postOnce(x, body, { event: 'chat.test', timeoutMs: 8000 });
  await serviceRpc('bot_delivery_log', { p_id: null, p_tenant: x.tenant, p_bot: bot, p_message: null, p_kind: 'test', p_status: r.status, p_error: r.error, p_attempts: 1 });
  return { ok: r.ok, status: r.status, error: r.error, ms: Date.now() - started };
}

/** The office operation `bot_webhook_test` ({ p_bot }): owner or manager. */
export async function botWebhookTest({ session, tenant, args }, upstreamError) {
  if (!UUID.test(String(args.p_bot || ''))) return { status: 400, error: 'invalid_args' };
  const c = await userRpc(session.at, 'bot_webhook_test_check', { p_tenant: tenant, p_bot: args.p_bot });
  if (!c.ok) throw upstreamError(c);
  if (c.data !== true) return { status: 404, error: 'not_found' };
  return { status: 200, result: await testPush(args.p_bot.toLowerCase()) };
}

/**
 * The office operation `bot_webhook_set` ({ p_bot, p_url, p_auth? }): an empty address turns delivery off.
 * p_auth (0091): the Authorization header for the bot's routine. Left out: the saved one stays. '': none. Sealed here.
 */
export async function botWebhookSet({ session, tenant, args }, upstreamError) {
  if (!UUID.test(String(args.p_bot || ''))) return { status: 400, error: 'invalid_args' };
  const id = args.p_bot.toLowerCase();
  const url = String(args.p_url || '').trim();
  if (url && (!URL_OK.test(url) || url.length > 500)) return { status: 400, error: 'invalid_url' };
  let mode = 'keep'; let authSealed = null; let authHint = null;
  if (typeof args.p_auth === 'string') {
    const a = args.p_auth.trim();
    if (!a) mode = 'clear';
    else {
      if (!AUTH_OK.test(a)) return { status: 400, error: 'invalid_auth' };
      mode = 'set'; authSealed = sealToken(a, AUTH_AAD + ':' + id);
      authHint = a.replace(/[^A-Za-z0-9._~+/=-]/g, '').slice(-4) || null;
    }
  }
  const secret = url ? 'vxw_' + randomBytes(32).toString('hex') : null;
  const r = await userRpc(session.at, 'bot_webhook_set', { p_tenant: tenant, p_bot: id, p_url: url,
    p_sealed: secret ? sealToken(secret, AAD + ':' + id) : null, p_hint: secret ? 'vxw_' + secret.slice(-4) : null,
    p_auth_mode: mode, p_auth_sealed: authSealed, p_auth_hint: authHint });
  if (!r.ok) throw upstreamError(r);
  if (r.data !== true) return { status: 404, error: 'not_found' };
  return { status: 200, result: { secret, hint: secret ? 'vxw_' + secret.slice(-4) : null } };
}

const LANGS = { en: 'English', es: 'Spanish (Latin American, natural and professional, formal "usted" when addressing someone)' };
export const aiConfigured = () => has('ANTHROPIC_API_KEY');

/** The office operation `chat_translate` ({ p_message, p_lang }). */
export async function chatTranslate({ session, tenant, args }, upstreamError) {
  if (!UUID.test(String(args.p_message || '')) || !Object.hasOwn(LANGS, String(args.p_lang))) return { status: 400, error: 'invalid_args' };
  const m = await userRpc(session.at, 'chat_message_get', { p_tenant: tenant, p_message: args.p_message });
  if (!m.ok) throw upstreamError(m);
  const msg = m.data;
  if (!msg) return { status: 404, error: 'not_found' };
  if (msg.translations && typeof msg.translations[args.p_lang] === 'string') return { status: 200, result: { text: msg.translations[args.p_lang], cached: true } };
  if (!aiConfigured()) return { status: 503, error: 'ai_not_configured' };
  const ai = (await import('../integrations/providers/ai.js')).default;
  const ctx = { provider: 'ai', tenantId: tenant, env, fetch: (...a) => globalThis.fetch(...a), now: () => Date.now() };
  let text;
  try {
    const out = await ai.actions.complete(ctx, { maxTokens: 2000, temperature: 0,
      system: `You translate one chat message of a company's internal team chat into ${LANGS[args.p_lang]}. Write it the way a native speaker on the team would write it, not word for word. Keep names, @mentions, numbers, links, emoji and line breaks as they are. Answer with the translation only.`,
      messages: [{ role: 'user', content: msg.body }] });
    text = String(out.text || '').trim();
  } catch (e) { log('chat', 'translate_failed', { code: e && e.code ? String(e.code).slice(0, 40) : 'error' }); return { status: 502, error: 'translate_failed' }; }
  if (!text) return { status: 502, error: 'translate_failed' };
  await serviceRpc('chat_translation_set', { p_tenant: tenant, p_message: args.p_message, p_lang: args.p_lang, p_text: text });
  return { status: 200, result: { text, cached: false } };
}
