// /api/partners/*: the VYNTEX Partner Portal (erp.vyntexusa.com/partners). VYNTEX ERP only.
//
// Every signed-in route goes through guard() (deployment configured, same origin and csrf for writes, an open session
// that passed the second sign-in step) and then calls ONE allow-listed database function with the person's own token.
// The database decides who may do what (partner.require_partner / partner.require_staff, aal2, the step-up stamp for
// money and policy) and which partner's records they see. The browser never names the partner it acts for: the database
// takes it from the person's account. Amounts sent by a browser are never read: offers and orders are priced in the
// database from the published catalog.
//
//   GET   context                                 who am I in the portal
//   GET   catalog?view=client|partner&as=<id>     the catalog (Client View is server-redacted); staff may preview a partner
//   GET   offers[?status=]  POST offers           list; save a draft { id?, ...fields, lines: [{ item, quantity }] }
//   GET   offers/<id>       POST offers/<id>/<submit|duplicate|withdraw|decision|share|share-revoke>
//   GET   orders[?status=&partner=]  POST orders  list; create { offer_id? | lines, contact..., consent, idem_key, submit? }
//   GET   orders/<id>       POST orders/<id>/<submit|message|cancel|follow-up>
//   GET   commissions[?as=] POST commissions/<id>/inquiry
//   staff (partner_admin / partner_manager; the database refuses everyone else):
//   GET   admin/partners    POST admin/partners  (create or update)   POST admin/partners/<id>/<compliance|status|invite>
//   POST  admin/invitations/<id>/revoke    POST admin/users/<user id>/status
//   GET   admin/catalog     POST admin/catalog/publish-ready   POST admin/catalog/items/<item>/<draft|retire>
//   POST  admin/catalog/versions/<id>/publish    POST admin/resources/<slug>
//   GET   admin/policies    POST admin/policies/<policy>/draft   POST admin/policy-versions/<id>/<approve|retire|assign>
//   POST  admin/offers/<id>/decide          POST admin/orders/<id>/<move|note|plan|payment>
//   GET   admin/commissions POST admin/commissions/<id>/set   POST admin/commissions/adjust
//   POST  admin/payouts     POST admin/payouts/<id>/<approve|sent|settled|cancel>
//   public (no account; a client opening a proposal link):
//   GET   proposal/<token> (reads only)  POST proposal/<token>/viewed  POST proposal/<token>/respond  { decision: accepted|declined, name }
//   POST  admin/offers/<id>/accept  { name, reason }   VYNTEX records an acceptance received outside the proposal page
import { entry, ok, fail, readJson, methodNotAllowed, upstreamError, isUuid, isPlainObject, HttpError } from './_lib/respond.js';
import { appOrigin, deployId } from './_lib/env.js';
import { userRpc, serviceRpc } from './_lib/supabase.js';
import { guard, assertConfigured } from './_lib/guard.js';
import { limit, keyHash, ipHash } from './_lib/ratelimit.js';
import { sendSystemEmail, emailConfigured } from './_lib/mail.js';
import { randomToken, sha256Hex } from './_lib/crypto.js';
import { publicLimits, assertSameSite } from './_lib/public/core.js';
import { partnerInviteEmail, proposalEmail } from './_lib/partners/emails.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ITEM = /^[a-z][a-z0-9_-]{1,60}$/;
const SLUG = /^[a-z][a-z0-9_-]{1,60}$/;
const PROPOSAL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const uidKey = (uid) => keyHash('uid', uid);
const NO_STORE = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

/** The database's refusal, with the one-word reason our own functions give (never upstream text). */
function refused(r, cookies) {
  const e = upstreamError(r);
  if (r.hint) e.more = { ...(e.more || {}), reason: r.hint };
  e.extra = { cookies };
  return e;
}

/** Calls one database function as the signed-in person and answers with its result under `key`. */
async function call(request, fn, args, { key = 'data', write = false, bucket = null, max = 120 } = {}) {
  const { session, cookies } = await guard(request, { write });
  if (bucket) await limit(bucket, uidKey(session.uid), max, 3600);
  const r = await userRpc(session.at, fn, args);
  if (!r.ok) throw refused(r, cookies);
  return { session, cookies, data: r.data, answer: () => ok({ [key]: r.data }, { cookies, headers: NO_STORE }) };
}
const read = async (request, fn, args, key) => (await call(request, fn, args, { key })).answer();
const write = async (request, fn, args, key = 'data', bucket = 'partners.write', max = 300) =>
  (await call(request, fn, args, { key, write: true, bucket, max })).answer();

const body = async (request, max = 64 * 1024) => {
  const b = await readJson(request, max);
  if (!isPlainObject(b)) throw new HttpError(400, 'invalid_body');
  return b;
};
const uuidOrNull = (v) => (isUuid(v) ? v.toLowerCase() : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const intOr = (v, d) => (Number.isInteger(v) ? v : d);
const dateOrNull = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Only the fields a partner may set on an offer. Prices are never taken from the browser. */
function offerFields(b) {
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 30).map((l) => ({ item: ITEM.test(String(l?.item || '')) ? l.item : '', quantity: intOr(l?.quantity, 1) })) : [];
  return {
    title: text(b.title, 200), summary: text(b.summary, 4000), client_name: text(b.client_name, 200), client_contact: text(b.client_contact, 200),
    client_email: text(b.client_email, 320), client_phone: text(b.client_phone, 40), industry: text(b.industry, 80), requirements: text(b.requirements, 4000),
    lang: b.lang === 'es' ? 'es' : 'en', valid_days: intOr(b.valid_days, 30), discount_bps: intOr(b.discount_bps, 0), lines,
  };
}
function orderFields(b) {
  const out = {
    client_name: text(b.client_name, 200), contact_name: text(b.contact_name, 200), contact_email: text(b.contact_email, 320), contact_phone: text(b.contact_phone, 40),
    industry: text(b.industry, 80), lead_source: text(b.lead_source, 200), timeline: text(b.timeline, 400), requirements: text(b.requirements, 4000),
    consent: b.consent === true, consent_note: text(b.consent_note, 400), submit: b.submit === true,
    idem_key: typeof b.idem_key === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(b.idem_key) ? b.idem_key : null,
  };
  if (isUuid(b.offer_id)) out.offer_id = b.offer_id.toLowerCase();
  else out.lines = Array.isArray(b.lines) ? b.lines.slice(0, 30).map((l) => ({ item: ITEM.test(String(l?.item || '')) ? l.item : '', quantity: intOr(l?.quantity, 1) })) : [];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Partner routes
// ---------------------------------------------------------------------------------------------------------------------
async function offerAction(request, id, action) {
  const b = await body(request, 8 * 1024);
  if (action === 'submit') return write(request, 'partner_offer_submit', { p_id: id }, 'offer');
  if (action === 'duplicate') return write(request, 'partner_offer_duplicate', { p_id: id }, 'offer');
  if (action === 'withdraw') return write(request, 'partner_offer_withdraw', { p_id: id }, 'offer');
  if (action === 'decision') {
    if (b.decision !== 'accepted' && b.decision !== 'declined') return fail(400, 'invalid', { reason: 'bad_decision' });
    return write(request, 'partner_offer_decision', { p_id: id, p_decision: b.decision, p_name: text(b.name, 200) }, 'offer');
  }
  if (action === 'share-revoke') {
    if (!isUuid(b.share)) return fail(400, 'invalid');
    return write(request, 'partner_offer_share_revoke', { p_id: id, p_share: b.share.toLowerCase() }, 'revoked');
  }
  if (action === 'share') {
    // The token is made here; the database keeps only its hash. The link is shown to the partner once.
    // The share function is the server's (service role): the database is first asked, with the person's own token, whether
    // this session is a live partner session past the second step; then the server makes the token and keeps only its hash.
    const { session, cookies } = await guard(request, { write: true });
    await limit('partners.share', uidKey(session.uid), 60, 3600);
    const who = await userRpc(session.at, 'partner_context', {});
    if (!who.ok) throw refused(who, cookies);
    if (who.data.kind !== 'partner' || who.data.aal !== 'aal2' || !who.data.live) return fail(403, 'forbidden', {}, { cookies });
    const token = randomToken(32);
    const r = await serviceRpc('partner_offer_share', { p_user: session.uid, p_id: id, p_token_hash: sha256Hex(token), p_days: intOr(b.days, 30) });
    if (!r.ok) throw refused(r, cookies);
    const c = { data: r.data, cookies };
    const link = `${appOrigin(request)}/proposal/${token}`;
    let delivery = 'not_sent';
    if (b.email === true && c.data.client_email) {
      if (!emailConfigured()) delivery = 'not_configured';
      else {
        const mail = proposalEmail({ lang: c.data.lang, client: c.data.client_name, link, expiresAt: c.data.expires_at, ref: c.data.ref });
        const sent = await sendSystemEmail({ to: c.data.client_email, subject: mail.subject, text: mail.text, idem: 'proposal:' + sha256Hex(token).slice(0, 32) });
        delivery = sent.delivered ? 'sent' : 'failed';
      }
    }
    return ok({ link, expiresAt: c.data.expires_at, delivery }, { cookies: c.cookies, headers: NO_STORE });
  }
  return fail(404, 'not_found');
}

async function orderAction(request, id, action) {
  const b = await body(request, 8 * 1024);
  if (action === 'submit') return write(request, 'partner_order_submit', { p_id: id }, 'order');
  if (action === 'message') return write(request, 'partner_order_message', { p_id: id, p_body: text(b.body, 4000) }, 'order');
  if (action === 'cancel') return write(request, 'partner_order_cancel', { p_id: id, p_reason: text(b.reason, 400) }, 'order');
  if (action === 'follow-up') return write(request, 'partner_order_follow_up', { p_id: id, p_date: dateOrNull(b.date) }, 'order');
  return fail(404, 'not_found');
}

// ---------------------------------------------------------------------------------------------------------------------
// Staff routes
// ---------------------------------------------------------------------------------------------------------------------
async function adminInvite(request, partnerId) {
  const b = await body(request, 4 * 1024);
  const email = text(b.email, 320).trim().toLowerCase();
  if (!EMAIL.test(email)) return fail(400, 'invalid', { reason: 'bad_email' });
  const role = b.role === 'partner_member' ? 'partner_member' : 'partner_owner';
  const token = randomToken(32);
  const c = await call(request, 'partner_admin_invite', { p_partner: partnerId, p_email: email, p_name: text(b.name, 200), p_role: role, p_token_hash: sha256Hex(token) },
    { write: true, bucket: 'partners.invite', max: 60 });
  const link = `${appOrigin(request)}/partners/invite/${token}`;
  let delivery = 'not_configured';
  if (emailConfigured()) {
    const lang = b.lang === 'es' || b.lang === 'en' ? b.lang : c.data.lang;
    const mail = partnerInviteEmail({ lang, partner: c.data.partner, link, hours: 72 });
    const sent = await sendSystemEmail({ to: email, subject: mail.subject, text: mail.text, idem: 'partner-invite:' + c.data.id });
    delivery = sent.delivered ? 'sent' : 'failed';
  }
  return ok({ link, delivery, expiresAt: c.data.expires_at }, { cookies: c.cookies, headers: NO_STORE });
}

async function admin(request, parts) {
  const m = request.method;
  const [area, a, b, c] = parts;
  const P = (fn, args, key) => write(request, fn, args, key, 'partners.admin', 600);
  if (area === 'partners') {
    if (a === undefined) {
      if (m === 'GET') return read(request, 'partner_admin_partners', {}, 'partners');
      if (m !== 'POST') return methodNotAllowed('GET, POST');
      const x = await body(request, 16 * 1024);
      return P('partner_admin_partner_save', { p_id: uuidOrNull(x.id), p: {
        name: text(x.name, 200), legal_name: text(x.legal_name, 200), kind: x.kind === 'revshare' ? 'revshare' : x.kind === 'referral' ? 'referral' : '',
        contact_name: text(x.contact_name, 200), contact_email: text(x.contact_email, 320), contact_phone: text(x.contact_phone, 40), lang: x.lang === 'es' ? 'es' : 'en',
        ...(typeof x.internal_notes === 'string' ? { internal_notes: x.internal_notes.slice(0, 4000) } : {}) } }, 'partner');
    }
    if (!isUuid(a) || m !== 'POST') return m !== 'POST' ? methodNotAllowed('POST') : fail(404, 'not_found');
    if (b === 'invite') return adminInvite(request, a.toLowerCase());
    const x = await body(request, 4 * 1024);
    if (b === 'compliance') return P('partner_admin_partner_compliance', { p_id: a.toLowerCase(), p_w9: text(x.w9, 20), p_agreement: text(x.agreement, 20), p_agreement_version: typeof x.version === 'string' ? x.version.slice(0, 60) : null }, 'partner');
    if (b === 'status') return P('partner_admin_partner_status', { p_id: a.toLowerCase(), p_status: text(x.status, 20), p_reason: text(x.reason, 400) }, 'partner');
    return fail(404, 'not_found');
  }
  if (m === 'GET') {
    if (area === 'catalog' && a === undefined) return read(request, 'partner_admin_catalog', {}, 'catalog');
    if (area === 'policies' && a === undefined) return read(request, 'partner_admin_policies', {}, 'policies');
    if (area === 'commissions' && a === undefined) {
      const q = new URL(request.url).searchParams;
      return read(request, 'partner_admin_commissions', { p_partner: uuidOrNull(q.get('partner')), p_status: q.get('status') && /^[a-z]{3,20}$/.test(q.get('status')) ? q.get('status') : null }, 'commissions');
    }
    return fail(404, 'not_found');
  }
  if (m !== 'POST') return methodNotAllowed('GET, POST');
  const x = await body(request, 64 * 1024);
  if (area === 'invitations' && isUuid(a) && b === 'revoke') return P('partner_admin_invite_revoke', { p_invitation: a.toLowerCase() }, 'revoked');
  if (area === 'users' && isUuid(a) && b === 'status') return P('partner_admin_user_status', { p_user: a.toLowerCase(), p_status: text(x.status, 20) }, 'changed');
  if (area === 'catalog') {
    if (a === 'publish-ready' && b === undefined) return P('partner_admin_catalog_publish_ready', {}, 'published');
    if (a === 'items' && ITEM.test(b || '') && c === 'draft') return P('partner_admin_catalog_draft', { p_item: b, p: isPlainObject(x.version) ? x.version : {} }, 'version');
    if (a === 'items' && ITEM.test(b || '') && c === 'retire') return P('partner_admin_catalog_retire', { p_item: b }, 'retired');
    if (a === 'versions' && isUuid(b) && c === 'publish') return P('partner_admin_catalog_publish', { p_version: b.toLowerCase() }, 'published');
  }
  if (area === 'resources' && SLUG.test(a || '') && b === undefined) return P('partner_admin_resource_save', { p_slug: a, p: isPlainObject(x.resource) ? x.resource : {}, p_publish: x.publish === true }, 'resource');
  if (area === 'policies' && /^[a-z][a-z0-9_-]{1,60}$/.test(a || '') && b === 'draft') return P('partner_admin_policy_draft', { p_policy: a, p: isPlainObject(x.changes) ? x.changes : {} }, 'version');
  if (area === 'policy-versions' && isUuid(a)) {
    if (b === 'approve') return P('partner_admin_policy_approve', { p_version: a.toLowerCase(), p_effective: dateOrNull(x.effective) }, 'approved');
    if (b === 'retire') return P('partner_admin_policy_retire', { p_version: a.toLowerCase() }, 'retired');
    if (b === 'assign' && isUuid(x.partner)) return P('partner_admin_policy_assign', { p_partner: x.partner.toLowerCase(), p_version: a.toLowerCase(), p_assign: x.assign !== false, p_note: text(x.note, 1000) }, 'assigned');
  }
  if (area === 'offers' && isUuid(a) && b === 'accept') return P('partner_admin_offer_accept', { p_id: a.toLowerCase(), p_name: text(x.name, 200), p_reason: text(x.reason, 2000) }, 'offer');
  if (area === 'offers' && isUuid(a) && b === 'decide') {
    if (x.decision !== 'approve' && x.decision !== 'changes') return fail(400, 'invalid', { reason: 'bad_decision' });
    return P('partner_admin_offer_decide', { p_id: a.toLowerCase(), p_decision: x.decision, p_note: text(x.note, 2000), p_prices: isPlainObject(x.prices) ? x.prices : null }, 'offer');
  }
  if (area === 'orders' && isUuid(a)) {
    const id = a.toLowerCase();
    if (b === 'move') return P('partner_admin_order_move', { p_id: id, p_to: text(x.to, 30), p_note: text(x.note, 4000), p_live_on: dateOrNull(x.live_on) }, 'order');
    if (b === 'note') return P('partner_admin_order_note', { p_id: id, p_body: text(x.body, 4000), p_internal: x.internal !== false }, 'order');
    if (b === 'plan') {
      const plan = {};
      if ('assigned_to' in x) plan.assigned_to = uuidOrNull(x.assigned_to) ?? '';
      if ('next_action' in x) plan.next_action = text(x.next_action, 400);
      if ('follow_up_at' in x) plan.follow_up_at = dateOrNull(x.follow_up_at) ?? '';
      if (typeof x.attribution === 'string') plan.attribution = x.attribution;
      return P('partner_admin_order_plan', { p_id: id, p: plan }, 'order');
    }
    if (b === 'payment') {
      return P('partner_admin_order_payment', { p_id: id, p: { kind: text(x.kind, 20), amount_cents: Number.isSafeInteger(x.amount_cents) ? x.amount_cents : 0,
        period: dateOrNull(x.period), received_on: dateOrNull(x.received_on), method: text(x.method, 60), reference: text(x.reference, 200), note: text(x.note, 1000) } }, 'order');
    }
  }
  if (area === 'commissions') {
    if (a === 'adjust') return P('partner_admin_commission_adjust', { p_partner: uuidOrNull(x.partner), p_order: uuidOrNull(x.order), p_amount_cents: Number.isSafeInteger(x.amount_cents) ? x.amount_cents : 0, p_reason: text(x.reason, 1000) }, 'adjusted');
    if (isUuid(a) && b === 'set') return P('partner_admin_commission_set', { p_id: a.toLowerCase(), p_action: text(x.action, 20), p_note: text(x.note, 2000) }, 'commission');
  }
  if (area === 'payouts') {
    if (a === undefined) return P('partner_admin_payout_create', { p_partner: uuidOrNull(x.partner), p_note: text(x.note, 1000) }, 'payout');
    if (isUuid(a) && ['approve', 'sent', 'settled', 'cancel'].includes(b)) {
      return P('partner_admin_payout_step', { p_id: a.toLowerCase(), p_step: b, p: { method: text(x.method, 60), reference: text(x.reference, 200), date: dateOrNull(x.date) ?? '', reason: text(x.reason, 400) } }, 'payout');
    }
  }
  return fail(404, 'not_found');
}

// ---------------------------------------------------------------------------------------------------------------------
// The client proposal (no account)
// ---------------------------------------------------------------------------------------------------------------------
async function proposal(request, token, action) {
  assertConfigured();
  const m = request.method;
  if (action === undefined) {
    if (m !== 'GET') return methodNotAllowed('GET');
    await publicLimits(request, 'proposal', token, { perAddress: 60, perToken: 30 });
    if (!PROPOSAL_TOKEN.test(token)) return fail(404, 'cannot_be_opened', { reason: 'unavailable' });
    const r = await serviceRpc('partner_proposal_peek', { p_token_hash: sha256Hex(token) });
    if (!r.ok) return fail(503, 'store_unavailable');
    if (!r.data) return fail(404, 'cannot_be_opened', { reason: 'unavailable' });
    return ok({ proposal: r.data }, { headers: NO_STORE });
  }
  if (action === 'viewed') {
    // sent by the page's script once the proposal is drawn: a link scanner that only fetches the page records nothing
    if (m !== 'POST') return methodNotAllowed('POST');
    assertSameSite(request);
    await publicLimits(request, 'proposal.viewed', token, { perAddress: 60, perToken: 20 });
    if (!PROPOSAL_TOKEN.test(token)) return fail(404, 'cannot_be_opened', { reason: 'unavailable' });
    const r = await serviceRpc('partner_proposal_viewed', { p_token_hash: sha256Hex(token) });
    if (!r.ok) return fail(503, 'store_unavailable');
    return ok({ recorded: r.data === true }, { headers: NO_STORE });
  }
  if (action !== 'respond') return fail(404, 'not_found');
  if (m !== 'POST') return methodNotAllowed('POST');
  assertSameSite(request);
  await publicLimits(request, 'proposal.respond', token, { perAddress: 20, perToken: 6 });
  if (!PROPOSAL_TOKEN.test(token)) return fail(404, 'cannot_be_opened', { reason: 'unavailable' });
  const b = await body(request, 2048);
  if (b.decision !== 'accepted' && b.decision !== 'declined') return fail(400, 'invalid', { reason: 'bad_decision' });
  const r = await serviceRpc('partner_proposal_respond', { p_token_hash: sha256Hex(token), p_decision: b.decision, p_name: text(b.name, 200), p_ip_hash: ipHash(request) });
  if (!r.ok) return fail(r.sqlstate === '22023' ? 400 : 503, r.sqlstate === '22023' ? 'invalid' : 'store_unavailable', r.hint ? { reason: r.hint } : {});
  if (!r.data) return fail(404, 'cannot_be_opened', { reason: 'unavailable' });
  return ok({ status: r.data.status }, { headers: NO_STORE });
}

const handle = entry('partners', async (request, path) => {
  if (deployId() !== 'vyntex') return fail(404, 'not_found');
  const m = request.method;
  if (m === 'OPTIONS') return methodNotAllowed('GET, POST');
  const parts = path.split('/').filter(Boolean);
  if (parts.length > 5) return fail(404, 'not_found');
  const [top, id, action] = parts;
  const q = new URL(request.url).searchParams;
  if (top === 'proposal' && id) return proposal(request, id, action);
  if (top === 'admin') return admin(request, parts.slice(1));
  if (top === 'context' && !id) return m === 'GET' ? read(request, 'partner_context', {}, 'context') : methodNotAllowed('GET');
  if (top === 'catalog' && !id) {
    if (m !== 'GET') return methodNotAllowed('GET');
    return read(request, 'partner_catalog', { p_view: q.get('view') === 'partner' ? 'partner' : 'client', p_as: uuidOrNull(q.get('as')) }, 'catalog');
  }
  if (top === 'offers') {
    if (!id) {
      if (m === 'GET') return read(request, 'partner_offers', { p_status: q.get('status') && /^[a-z_]{3,30}$/.test(q.get('status')) ? q.get('status') : null }, 'offers');
      if (m !== 'POST') return methodNotAllowed('GET, POST');
      const b = await body(request);
      return write(request, 'partner_offer_save', { p_id: uuidOrNull(b.id), p: offerFields(b) }, 'offer');
    }
    if (!isUuid(id)) return fail(404, 'not_found');
    if (!action) return m === 'GET' ? read(request, 'partner_offer', { p_id: id.toLowerCase() }, 'offer') : methodNotAllowed('GET');
    return m === 'POST' ? offerAction(request, id.toLowerCase(), action) : methodNotAllowed('POST');
  }
  if (top === 'orders') {
    if (!id) {
      if (m === 'GET') return read(request, 'partner_orders', { p_status: q.get('status') && /^[a-z_]{3,30}$/.test(q.get('status')) ? q.get('status') : null, p_partner: uuidOrNull(q.get('partner')) }, 'orders');
      if (m !== 'POST') return methodNotAllowed('GET, POST');
      const b = await body(request);
      return write(request, 'partner_order_create', { p: orderFields(b) }, 'order', 'partners.order', 120);
    }
    if (!isUuid(id)) return fail(404, 'not_found');
    if (!action) return m === 'GET' ? read(request, 'partner_order', { p_id: id.toLowerCase() }, 'order') : methodNotAllowed('GET');
    return m === 'POST' ? orderAction(request, id.toLowerCase(), action) : methodNotAllowed('POST');
  }
  if (top === 'commissions') {
    if (!id) return m === 'GET' ? read(request, 'partner_commissions', { p_as: uuidOrNull(q.get('as')) }, 'statement') : methodNotAllowed('GET');
    if (isUuid(id) && action === 'inquiry' && m === 'POST') {
      const b = await body(request, 4096);
      return write(request, 'partner_commission_inquiry', { p_id: id.toLowerCase(), p_note: text(b.note, 2000) }, 'commission');
    }
    return fail(404, 'not_found');
  }
  return fail(404, 'not_found');
});

export const GET = handle;
export const POST = handle;
