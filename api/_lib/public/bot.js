// /api/bot/*: the door for VYNTEX USA's AI employees (the Grok bots) into the company's own VYNTEX ERP workspace.
// vercel.json sends /api/bot/<x> to /api/public (bot/<x>), so no new serverless function is needed.
//
//   POST /api/bot/mcp    Model Context Protocol over HTTP (JSON-RPC 2.0): initialize, tools/list, tools/call, ping
//   POST /api/bot/call   the same tools without MCP: { "tool": "leads_list", "args": { ... } }
//
// Every request carries its own key:  Authorization: Bearer vxb_<64 hex characters>
//   * the key is made by the server when the owner asks for it in VYNTEX ERP (AI employees, fresh identity check), and
//     shown once; only a keyed hash of it is stored (app.bots.key_hash)
//   * no cookie and no browser session is read here, and no cross-origin permission is given: this is for servers
//   * limited per network address before the key is checked, and per bot after
//   * the database decides everything else: the bot is active, its company is open, the tool is in its access map, the
//     records belong to its company (public.bot_auth, public.bot_call). Every call is kept in app.bot_activity
// Nothing here sends to a client, moves money, changes a price, deletes or publishes: there is no such tool.
import { json, fail, readJson, methodNotAllowed, HttpError, isPlainObject } from '../respond.js';
import { serviceRpc } from '../supabase.js';
import { limit, keyHash, addressKey } from '../ratelimit.js';
import { randomBytes } from 'node:crypto';
import { TOOLS, toolsFor, dbName } from '../bots/tools.js';

export const BOT_KEY = /^vxb_[0-9a-f]{64}$/;
export const PROTOCOL = '2025-06-18';
const NO_STORE = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };

/** A new key: 256 random bits. The server keeps only botKeyHash(key). */
export function newBotKey() {
  const key = 'vxb_' + randomBytes(32).toString('hex');
  return { key, hash: botKeyHash(key), hint: 'vxb_' + key.slice(-4) };
}
export const botKeyHash = (key) => keyHash('botkey', key);

const answer = (status, body) => json(status, body, { headers: NO_STORE });
const unauthorized = (reason = 'invalid_key') =>
  json(401, { ok: false, error: reason }, { headers: { ...NO_STORE, 'www-authenticate': 'Bearer realm="vyntex-erp"' } });

/** The bot behind the key, or a Response that refuses. */
async function authenticate(request) {
  await limit('bot.addr', addressKey(request), 600, 60);
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m || !BOT_KEY.test(m[1])) return unauthorized();
  const r = await serviceRpc('bot_auth', { p_key_hash: botKeyHash(m[1]) });
  if (!r.ok) throw new HttpError(503, 'upstream_unavailable');
  const bot = r.data;
  if (!isPlainObject(bot)) return unauthorized();
  if (bot.refused) return answer(403, { ok: false, error: bot.refused });
  await limit('bot.calls', keyHash('bot', bot.bot), 120, 60);
  return bot;
}

/** One tool, run by the database for this bot. */
async function run(bot, tool, args) {
  if (typeof tool !== 'string' || !Object.hasOwn(TOOLS, tool)) return { error: 'unknown_tool' };
  if (args !== undefined && !isPlainObject(args)) return { error: 'invalid_arguments' };
  const r = await serviceRpc('bot_call', { p_bot: bot.bot, p_tool: dbName(tool), p_args: args || {} });
  if (!r.ok) throw new HttpError(503, 'upstream_unavailable');
  // a bot's chat message that @mentions another AI employee reaches that one too
  if (tool === 'chat_send' && r.data && Array.isArray(r.data.bots) && r.data.bots.length) {
    const { queueBots } = await import('../chat/index.js');
    await queueBots(bot.tenant, r.data.id, r.data.bots);
  }
  return r.data;
}

const isError = (data) => isPlainObject(data) && typeof data.error === 'string';

// ---------------------------------------------------------------------------------------------------------------------
// MCP: JSON-RPC 2.0 over one POST, answered as application/json (no server-sent stream is needed: every tool answers once)
// ---------------------------------------------------------------------------------------------------------------------
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function mcpOne(bot, msg) {
  if (!isPlainObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const isNotice = msg.id === undefined;
  const params = isPlainObject(msg.params) ? msg.params : {};
  switch (msg.method) {
    case 'initialize':
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'vyntex-erp', title: 'VYNTEX ERP', version: '1.0.0' },
        instructions: `You are ${bot.name}${bot.title ? ', ' + bot.title : ''}, working in the VYNTEX USA workspace of VYNTEX ERP. `
          + 'Access is not approval: sending anything to a client, payments, price changes, deletions and publishing are asked for with '
          + 'approvals_request and decided by Daysi or Abdul. Never invent figures, testimonials or records.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return isNotice ? null : rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolsFor(bot.access) });
    case 'tools/call': {
      const data = await run(bot, params.name, params.arguments);
      return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: isPlainObject(data) ? data : { items: data }, isError: isError(data) });
    }
    default:
      return isNotice ? null : rpcError(msg.id, -32601, 'Method not found');
  }
}

async function mcp(request, bot) {
  let body;
  try { body = await readJson(request, 64 * 1024); } catch (e) { if (e instanceof HttpError && e.status === 413) throw e; return answer(400, rpcError(null, -32700, 'Parse error')); }
  if (Array.isArray(body)) {
    if (!body.length || body.length > 20) return answer(400, rpcError(null, -32600, 'Invalid request'));
    const out = [];
    for (const m of body) { const r = await mcpOne(bot, m); if (r) out.push(r); }
    return out.length ? answer(200, out) : new Response(null, { status: 202, headers: NO_STORE });
  }
  const r = await mcpOne(bot, body);
  return r ? answer(200, r) : new Response(null, { status: 202, headers: NO_STORE });
}

export async function botRoute(request, action) {
  if (action !== 'mcp' && action !== 'call') return fail(404, 'not_found');
  if (request.method === 'GET' && action === 'mcp') return methodNotAllowed('POST'); // no server-to-client stream
  if (request.method !== 'POST') return methodNotAllowed('POST');
  // a browser page of any site is not a bot
  if (request.headers.get('origin') || request.headers.get('cookie')) return answer(403, { ok: false, error: 'not_for_browsers' });
  const bot = await authenticate(request);
  if (bot instanceof Response) return bot;
  if (action === 'mcp') return mcp(request, bot);
  const b = await readJson(request, 64 * 1024);
  const data = await run(bot, b.tool, b.args);
  return answer(isError(data) ? (data.error === 'not_allowed' || data.error === 'needs_approval' ? 403 : 400) : 200, isError(data) ? { ok: false, ...data } : { ok: true, result: data });
}
