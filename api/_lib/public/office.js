// Operations of this range that a signed-in member starts and the server finishes: sending a signature request,
// reminding its signers, sending a review request. Each one needs something a database function alone cannot do
// (make a link token, hand an email to a provider), which is why they are here and not plain entries of the allow-list.
//
// They are written to plug into /api/ws/rpc/<name> exactly like "member_invite" does (api/ws.js, spec.special):
//     envelope_send, envelope_remind, review_send:  { tenant, args: { p_envelope | p_review } }
// Until those lines are added to api/ws.js and api/_lib/rpc-allowlist.js (files of another engineer), api/public.js
// serves the same three under /api/public/office/<name>, behind the same checks as every /api/ws route: configured
// deployment, same origin and csrf, an open session, the second sign-in step. docs/SERVER.md section 17 has the lines.
import { ok, fail, readJson, HttpError, isUuid, isPlainObject, upstreamError } from '../respond.js';
import { guard } from '../guard.js';
import { userRpc } from '../supabase.js';
import { limit, keyHash } from '../ratelimit.js';
import { securityEvent } from '../audit.js';
import { envelopeSend, envelopeRemind } from '../esign/send.js';
import { reviewSend } from './reviews.js';
import { newBotKey } from './bot.js';
import { invoiceSend } from '../invoices.js';

/** name -> { run, stepUp }. The signature every special has: ({ request, session, cookies, tenant, args, idem }) => Response. */
/** A database function of this range called with the person's own token: the database decides, as for any allow-list entry. */
const direct = (name, argNames = []) => async ({ session, cookies, tenant, args }) => {
  const r = await userRpc(session.at, name, { p_tenant: tenant, ...Object.fromEntries(argNames.filter((k) => args[k] !== undefined).map((k) => [k, args[k]])) });
  if (!r.ok) { const e = upstreamError(r); e.extra = { cookies }; throw e; }
  return ok({ result: r.data ?? null }, { cookies });
};

export const SPECIALS = {
  // the website form key: shown once when it is made or replaced (fresh identity check), and its state
  intake_key_rotate: { run: direct('intake_key_rotate', ['p_active']), stepUp: true },
  intake_key_state: { run: direct('intake_key_state'), stepUp: false },
  envelope_send: { run: envelopeSend, stepUp: false },
  envelope_remind: { run: envelopeRemind, stepUp: false },
  review_send: { run: reviewSend, stepUp: false },
  // an AI employee's key (0084): made here, shown once, only its hash reaches the database (the owner, fresh identity check)
  bot_key_issue: { run: botKeyIssue, stepUp: true },
  // an invoice (0086): emailed with its pay link, then marked sent; sending a sent one again is a reminder
  invoice_send: { run: invoiceSendOp, stepUp: false },
};

async function invoiceSendOp(c) {
  let r;
  try { r = await invoiceSend(c, upstreamError); } catch (e) { if (e instanceof HttpError) e.extra = { cookies: c.cookies }; throw e; }
  return r.status === 200 ? ok({ result: r.result }, { cookies: c.cookies }) : fail(r.status, r.error, {}, { cookies: c.cookies });
}

async function botKeyIssue({ session, cookies, tenant, args }) {
  if (!isUuid(args.p_bot)) return fail(400, 'invalid_args', {}, { cookies });
  const k = newBotKey();
  const r = await userRpc(session.at, 'bot_key_set', { p_tenant: tenant, p_bot: args.p_bot.toLowerCase(), p_key_hash: k.hash, p_hint: k.hint });
  if (!r.ok) { const e = upstreamError(r); e.extra = { cookies }; throw e; }
  if (r.data !== true) return fail(404, 'not_found', {}, { cookies });
  return ok({ result: { key: k.key, hint: k.hint } }, { cookies, headers: { 'cache-control': 'no-store' } });
}

export async function office(request, name) {
  const spec = Object.hasOwn(SPECIALS, name) ? SPECIALS[name] : null;
  if (!spec) return fail(404, 'unknown_operation');
  const { session, cookies } = await guard(request, { stepUp: spec.stepUp });
  const b = await readJson(request, 16 * 1024);
  if (!isUuid(b.tenant)) throw new HttpError(400, 'tenant_required', {}, { cookies });
  const tenant = b.tenant.toLowerCase();
  const args = b.args === undefined ? {} : b.args;
  if (!isPlainObject(args) || Object.keys(args).length > 10) return fail(400, 'invalid_args', {}, { cookies });
  await limit('ws.rpc', keyHash('uid', session.uid), 240, 60);
  await limit('office.' + name, keyHash('uid', session.uid), 60, 600);
  // the database's own check for this company: member, live session, second step
  const g = await userRpc(session.at, 'vx_guard', { p_tenant: tenant, p_stepup: !!spec.stepUp });
  if (!g.ok) { const e = upstreamError(g); e.extra = { cookies }; throw e; }
  const res = await spec.run({ request, session, cookies, tenant, args, idem: b.idem });
  if (res.status >= 400) await securityEvent({ tenant, user: session.uid, kind: 'operation.refused', outcome: 'denied', request, meta: { name, status: res.status } });
  return res;
}
