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

/**
 * Sends a message to each AI employee it is meant for, at once (a few seconds at most, in parallel). A delivery that
 * does not go through now is queued and tried again by the job runner with a growing wait.
 */
export async function queueBots(tenant, messageId, bots) {
  const list = (Array.isArray(bots) ? bots : []).filter((b) => UUID.test(String(b))).slice(0, 10);
  if (!UUID.test(String(messageId)) || !list.length) return 0;
  const done = await Promise.all(list.map(async (bot) => {
    try { await deliverToBot({ payload: { bot, message: messageId } }, { timeoutMs: 4000 }); return true; } catch (e) {
      if (e instanceof JobError && e.permanent) { log('chat', 'delivery_refused', { code: e.code }); return true; }
      return !!(await enqueue('chat.bot_deliver', { bot, message: messageId }, { tenant, idem: `chat:${messageId}:${bot}`, maxAttempts: 6 }));
    }
  }));
  return done.filter(Boolean).length;
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

/** The job `chat.bot_deliver` ({ bot, message }). */
export async function deliverToBot(job, { timeoutMs = 8000 } = {}) {
  const { bot, message } = job.payload || {};
  if (!UUID.test(String(bot)) || !UUID.test(String(message))) throw new JobError('payload_invalid', { permanent: true });
  const d = await serviceRpc('chat_bot_delivery', { p_bot: bot, p_message: message });
  if (!d.ok) throw new JobError('store_unavailable');
  const x = d.data;
  // no address set: the bot reads its inbox with chat_inbox instead; nothing to retry
  if (!x || !x.url) return { skipped: 'no_address' };
  if (!URL_OK.test(x.url)) throw new JobError('address_invalid', { permanent: true });
  const secret = x.sealed ? openToken(x.sealed, AAD + ':' + x.bot.id) : null;
  if (!secret) throw new JobError('secret_unreadable', { permanent: true });
  // 0091: the Authorization header the bot's routine expects, kept sealed
  const auth = x.auth ? openToken(x.auth, AUTH_AAD + ':' + x.bot.id) : null;
  if (x.auth && !auth) throw new JobError('auth_unreadable', { permanent: true });
  const m = x.message || {};
  // the full message at the top (what a routine reads first), then the same in the nested form of 0087
  const body = JSON.stringify({ type: 'chat.message', id: `${message}:${bot}`, at: new Date().toISOString(),
    roomId: x.room.id, roomKind: x.room.kind, roomName: x.room.name, messageId: m.id, sentAt: m.at,
    sender: m.author ? { type: m.author.type, id: m.author.id, name: m.author.name } : null, body: m.body || '',
    mentions: m.mentions || [], replyToMessage: m.replyTo || null, files: m.files || [],
    to: x.bot, bot: x.bot, room: x.room, message: m,
    reply: { tool: 'chat_send', args: { roomId: x.room.id, replyTo: m.id } } });
  const headers = { 'content-type': 'application/json', 'user-agent': 'VYNTEX-ERP-Chat/1', 'x-vx-signature': sign(secret, body), 'x-vx-event': 'chat.message' };
  if (auth) headers.authorization = auth;
  let res;
  try {
    res = await fetch(x.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers, body });
  } catch { throw new JobError('unreachable'); }
  if (res.status >= 200 && res.status < 300) return { delivered: true };
  // a refusal that will not change (wrong address, not allowed) is not tried again
  if ([400, 401, 403, 404, 410, 422].includes(res.status)) throw new JobError('refused_' + res.status, { permanent: true });
  throw new JobError('status_' + res.status);
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
