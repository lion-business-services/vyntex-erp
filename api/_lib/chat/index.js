// Team chat on the server (0087).
//   send        the office operation `chat_send`: the database stores the message (the person's own rights), then each AI
//               employee it is meant for gets a delivery job
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

export const sign = (secret, body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

/** Queues one delivery per AI employee a message is meant for. */
export async function queueBots(tenant, messageId, bots) {
  let n = 0;
  for (const bot of Array.isArray(bots) ? bots : []) {
    if (!UUID.test(String(bot)) || !UUID.test(String(messageId))) continue;
    if (await enqueue('chat.bot_deliver', { bot, message: messageId }, { tenant, idem: `chat:${messageId}:${bot}`, maxAttempts: 6 })) n += 1;
  }
  return n;
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
export async function deliverToBot(job) {
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
  const body = JSON.stringify({ type: 'chat.message', id: `${message}:${bot}`, at: new Date().toISOString(), bot: x.bot, room: x.room, message: x.message,
    reply: { tool: 'chat_send', args: { roomId: x.room.id, replyTo: x.message.id } } });
  let res;
  try {
    res = await fetch(x.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', 'user-agent': 'VYNTEX-ERP-Chat/1', 'x-vx-signature': sign(secret, body), 'x-vx-event': 'chat.message' }, body });
  } catch { throw new JobError('unreachable'); }
  if (res.status >= 200 && res.status < 300) return { delivered: true };
  // a refusal that will not change (wrong address, not allowed) is not tried again
  if ([400, 401, 403, 404, 410, 422].includes(res.status)) throw new JobError('refused_' + res.status, { permanent: true });
  throw new JobError('status_' + res.status);
}

/** The office operation `bot_webhook_set` ({ p_bot, p_url }): an empty address turns delivery off. */
export async function botWebhookSet({ session, tenant, args }, upstreamError) {
  if (!UUID.test(String(args.p_bot || ''))) return { status: 400, error: 'invalid_args' };
  const url = String(args.p_url || '').trim();
  if (url && (!URL_OK.test(url) || url.length > 500)) return { status: 400, error: 'invalid_url' };
  const secret = url ? 'vxw_' + randomBytes(32).toString('hex') : null;
  const r = await userRpc(session.at, 'bot_webhook_set', { p_tenant: tenant, p_bot: args.p_bot.toLowerCase(), p_url: url,
    p_sealed: secret ? sealToken(secret, AAD + ':' + args.p_bot.toLowerCase()) : null, p_hint: secret ? 'vxw_' + secret.slice(-4) : null });
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
