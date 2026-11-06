// The public seven-day trial (routes trial/status and trial/request of api/auth.js). VYNTEX ERP only: LBS Command has no
// such route at all. Owner decision of October 29, 2026; the database side is supabase/migrations/0078_public_trials.sql.
//
// trial/request, in order:
//   1. the deployment can do it (VYNTEX, core settings, database, system email, not switched off with TRIAL_SIGNUP_DISABLED)
//   2. same origin and the double-submit csrf value, as every public auth route
//   3. limits: 5 per 15 minutes per network address, 3 per day per email, and a ceiling for the whole site
//   4. the hidden field (honeypot): filled in, the request gets the usual answer and nothing is made or sent
//   5. strict validation. Every edition can start a trial (owner decision, Oct 29 2026); a quoted edition pays through
//      a payment link VYNTEX sends after the trial (src/features/billing, bill.quoted)
//   6. the address word is made here from the business name (the database checks it again: app.is_valid_slug and the
//      reserved words); a taken or reserved word gets a short random ending, a few times
//   7. a one-time token (same format and SHA-256 hash as every invitation): only its hash goes to the database, through
//      public.trial_request_create with the server key
//   8. the owner is emailed the activation link /invite/<token>; when that email cannot be sent the request is undone
//      (public.trial_request_cancel), so nothing stays reserved, and the page says so
//   9. VYNTEX is told (BILLING_NOTIFY_TO, the address of the billing notices)
// The answer is the same { ok: true, sent: true } whether or not the address already had a trial (one trial per address,
// ever), and no second email goes out for an address that had one: nobody can learn from here which addresses are known.
import { ok, fail, readJson, upstreamError, log } from './respond.js';
import { appOrigin, deployId, envBool, problems } from './env.js';
import { serviceRpc, configured } from './supabase.js';
import { assertCsrf } from './csrf.js';
import { assertConfigured } from './guard.js';
import { limit, addressKey, accountKey, keyHash } from './ratelimit.js';
import { securityEvent } from './audit.js';
import { sha256Hex, randomToken } from './crypto.js';
import { sendSystemEmail, emailConfigured, trialActivationEmail, trialNoticeEmail } from './mail.js';
import { notifyTo } from './billing/deps.js';
import { randomBytes } from 'node:crypto';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EDITION = /^[a-z][a-z0-9_]{1,30}$/;
const HOURS = 72;
const SLUG_TRIES = 5;

/** Is the public trial offered on this deployment right now? */
export const trialAvailable = () => deployId() === 'vyntex' && !envBool('TRIAL_SIGNUP_DISABLED')
  && problems().length === 0 && configured() && emailConfigured();

/** One line of text: control characters out, spaces collapsed. */
const oneLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

/**
 * The address word from the business name: lowercase letters and digits, single hyphens, 3 to 40 characters.
 * "Peña's Cleaning & Co." -> "penas-cleaning-co". A name with nothing usable gets "workspace".
 */
export function slugFrom(name) {
  let s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 40) s = s.slice(0, 40).replace(/-[^-]*$/, '') || s.slice(0, 40);
  s = s.replace(/-+$/g, '');
  if (s.length < 3) s = s ? `${s}-co` : 'workspace';
  return s;
}
/** The same word with a short random ending, still within 40 characters. */
export function slugWithEnding(base) {
  const end = randomBytes(3).toString('hex').slice(0, 4);
  return `${base.slice(0, 35).replace(/-+$/g, '')}-${end}`;
}

function validate(body) {
  const fields = {};
  const business = oneLine(body.business);
  const owner = oneLine(body.owner);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const edition = typeof body.edition === 'string' ? body.edition.trim().toLowerCase() : '';
  if (business.length < 2) fields.business = 'required'; else if (business.length > 120) fields.business = 'too_long';
  if (owner.length < 2) fields.owner = 'required'; else if (owner.length > 100) fields.owner = 'too_long';
  if (!EMAIL.test(email) || email.length > 254) fields.email = 'invalid';
  if (!EDITION.test(edition)) fields.edition = 'invalid';
  if (body.language !== 'en' && body.language !== 'es') fields.language = 'invalid';
  if (body.consent !== true) fields.consent = 'required';
  return Object.keys(fields).length ? { fields } : { value: { business, owner, email, edition, lang: body.language } };
}

export async function trialStatus() {
  return ok({ available: trialAvailable() });
}

export async function trialRequest(request) {
  assertConfigured();
  if (!trialAvailable()) return fail(503, 'trial_unavailable');
  assertCsrf(request, null);
  await limit('trial.addr', addressKey(request), 5, 900);
  // a ceiling for the whole site, so a spread-out flood cannot open thousands of empty workspaces
  await limit('trial.site', keyHash('site', 'all'), 300, 86400);
  const body = await readJson(request, 4096);
  const sent = () => ok({ sent: true });

  // The hidden field: people never see it, scripts fill it in. The usual answer, and nothing happens.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    await securityEvent({ kind: 'trial.refused', outcome: 'denied', request, meta: { reason: 'honeypot' } });
    return sent();
  }
  const checked = validate(body);
  if (checked.fields) return fail(400, 'invalid', { fields: checked.fields });
  const { business, owner, email, edition, lang } = checked.value;

  await limit('trial.acct', accountKey(email), 3, 86400);

  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const base = slugFrom(business);
  let slug = base;
  let result = '';
  for (let i = 0; i < SLUG_TRIES; i++) {
    const r = await serviceRpc('trial_request_create', {
      p_slug: slug, p_name: business, p_industry: edition, p_email: email, p_owner_name: owner,
      p_email_hash: sha256Hex(email), p_token_hash: tokenHash,
    });
    if (!r.ok) throw upstreamError(r);
    result = String(r.data || '');
    if (result !== 'slug_taken' && result !== 'bad_slug') break;
    slug = slugWithEnding(base);
  }

  if (result === 'accepted') {
    // already had a trial: the same answer, no email, nothing new
    await securityEvent({ kind: 'trial.repeat', outcome: 'info', request, subject: accountKey(email), meta: { edition } });
    return sent();
  }
  if (result === 'quoted_edition') return fail(400, 'quoted_edition');
  if (result === 'bad_industry') return fail(400, 'invalid', { fields: { edition: 'invalid' } });
  if (result === 'bad_email') return fail(400, 'invalid', { fields: { email: 'invalid' } });
  if (result === 'bad_name') return fail(400, 'invalid', { fields: { business: 'invalid' } });
  if (result !== 'created') {
    log('trial', 'not_created', { result: /^[a-z_]{2,30}$/.test(result) ? result : 'other' });
    return fail(503, 'trial_try_again');
  }

  const origin = appOrigin(request);
  const address = `${origin}/${slug}`;
  const mail = trialActivationEmail({ lang, company: business, link: `${origin}/invite/${token}`, hours: HOURS, address });
  const delivered = await sendSystemEmail({ to: email, subject: mail.subject, text: mail.text, idem: 'trial:' + tokenHash.slice(0, 32) });
  if (!delivered.delivered) {
    // nothing may stay reserved for an email that never arrived
    const undone = await serviceRpc('trial_request_cancel', { p_token_hash: tokenHash });
    if (!undone.ok || undone.data !== true) log('trial', 'cancel_failed', { status: undone.status });
    await securityEvent({ kind: 'trial.email_failed', outcome: 'failed', request, subject: accountKey(email), meta: { edition, reason: String(delivered.reason || '').slice(0, 40) } });
    return fail(503, 'email_failed');
  }
  await securityEvent({ kind: 'trial.requested', outcome: 'ok', request, subject: accountKey(email), meta: { edition, slug } });
  const notice = trialNoticeEmail({ company: business, edition: `VYNTEX ${edition.toUpperCase()}`, email, owner, lang, address });
  await sendSystemEmail({ to: notifyTo(), subject: notice.subject, text: notice.text, idem: 'trial-notice:' + tokenHash.slice(0, 32) });
  return sent();
}
