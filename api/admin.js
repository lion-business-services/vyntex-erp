// /api/admin/*: the operator console (erp.vyntexusa.com/admin). VYNTEX staff open a client company and invite its first
// owner here, instead of in the Supabase SQL Editor. VYNTEX ERP only: the LBS deployment has no such address.
//
//   GET   context                     am I an operator, and is my second sign-in step done       -> { operator, aal }
//   GET   companies                   every client company with its owner or open invitation       -> { companies }
//   POST  companies                   { name, slug, industry, plan, ownerEmail, ownerName?, lang? } -> { company, link, delivery }
//   POST  companies/<id>/invite       { ownerEmail, ownerName?, lang? }   a new invitation for the first owner
//   POST  companies/<id>/status       { status: 'active' | 'suspended' }
//
// Every call is made with the operator's own token, so the database decides (app.require_operator: an active operator
// whose session passed the second sign-in step). This file adds the session, the origin and csrf checks and the limits.
// The one-time invitation link is returned to the operator once, and emailed to the owner when system email is set up;
// the database keeps only its hash.
import { entry, ok, fail, readJson, methodNotAllowed, upstreamError, isUuid } from './_lib/respond.js';
import { appOrigin, deployId } from './_lib/env.js';
import { userRpc } from './_lib/supabase.js';
import { guard } from './_lib/guard.js';
import { limit, keyHash } from './_lib/ratelimit.js';
import { sendSystemEmail, ownerWelcomeEmail } from './_lib/mail.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const INDUSTRIES = ['build', 'clean', 'landscape', 'wash', 'haul', 'snow', 'turnover', 'events', 'practice'];
const PLAN = /^[a-z][a-z0-9_]{1,40}$/;
const HOURS = 72;
const uidKey = (uid) => keyHash('uid', uid);

/** The database refused: an operator check, or one of the named reasons of 0061_operator_console.sql. */
function refused(r, cookies) {
  const e = upstreamError(r);
  e.extra = { cookies };
  return e;
}

/** Sends the owner the link when system email is set up. Never throws: the operator has the link either way. */
async function deliver({ email, company, address, link, lang, tenant }) {
  const mail = ownerWelcomeEmail({ lang, company, link, hours: HOURS, address });
  const sent = await sendSystemEmail({ to: email, subject: mail.subject, text: mail.text, tenant, idem: 'owner-invite:' + tenant + ':' + link.slice(-12) });
  return sent.delivered ? 'sent' : sent.reason === 'not_configured' ? 'not_configured' : 'failed';
}

async function context(request) {
  const { session, cookies } = await guard(request);
  const r = await userRpc(session.at, 'operator_context', {});
  if (!r.ok) throw refused(r, cookies);
  return ok({ operator: !!r.data?.operator, aal: r.data?.aal === 'aal2' ? 'aal2' : 'aal1' }, { cookies });
}

async function companies(request) {
  const { session, cookies } = await guard(request);
  const r = await userRpc(session.at, 'operator_companies', {});
  if (!r.ok) throw refused(r, cookies);
  return ok({ companies: Array.isArray(r.data) ? r.data : [] }, { cookies });
}

async function create(request) {
  const { session, cookies } = await guard(request);
  await limit('admin.create', uidKey(session.uid), 60, 3600);
  const b = await readJson(request, 8 * 1024);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
  const email = typeof b.ownerEmail === 'string' ? b.ownerEmail.trim().toLowerCase() : '';
  const ownerName = typeof b.ownerName === 'string' ? b.ownerName.trim().slice(0, 200) : '';
  const lang = b.lang === 'es' ? 'es' : 'en';
  if (!name || name.length > 200) return fail(400, 'invalid', { reason: 'bad_name' }, { cookies });
  if (!SLUG.test(slug) || slug.length < 3 || slug.length > 40) return fail(400, 'invalid', { reason: 'bad_slug' }, { cookies });
  if (!INDUSTRIES.includes(b.industry)) return fail(400, 'invalid', { reason: 'bad_industry' }, { cookies });
  if (typeof b.plan !== 'string' || !PLAN.test(b.plan)) return fail(400, 'invalid', { reason: 'bad_plan' }, { cookies });
  if (!EMAIL.test(email) || email.length > 320) return fail(400, 'invalid', { reason: 'bad_email' }, { cookies });

  const r = await userRpc(session.at, 'operator_create_company', { p_slug: slug, p_name: name, p_industry: b.industry, p_plan: b.plan, p_owner_email: email, p_owner_name: ownerName });
  if (!r.ok) throw refused(r, cookies);
  const origin = appOrigin(request);
  const link = `${origin}/invite/${r.data.token}`; const address = `${origin}/${r.data.slug}`;
  const delivery = await deliver({ email, company: name, address, link, lang, tenant: r.data.tenant_id });
  return ok({ company: { id: r.data.tenant_id, slug: r.data.slug, name }, link, address, delivery, expiresInHours: HOURS }, { cookies });
}

async function reinvite(request, tenant) {
  const { session, cookies } = await guard(request);
  await limit('admin.invite', uidKey(session.uid), 60, 3600);
  const b = await readJson(request, 4 * 1024);
  const email = typeof b.ownerEmail === 'string' ? b.ownerEmail.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 320) return fail(400, 'invalid', { reason: 'bad_email' }, { cookies });
  const r = await userRpc(session.at, 'operator_reinvite', { p_tenant: tenant, p_owner_email: email, p_owner_name: typeof b.ownerName === 'string' ? b.ownerName.trim().slice(0, 200) : '' });
  if (!r.ok) throw refused(r, cookies);
  const origin = appOrigin(request);
  const link = `${origin}/invite/${r.data.token}`; const address = `${origin}/${r.data.slug}`;
  const delivery = await deliver({ email, company: r.data.name, address, link, lang: b.lang === 'es' ? 'es' : 'en', tenant });
  return ok({ link, address, delivery, expiresInHours: HOURS }, { cookies });
}

async function setStatus(request, tenant) {
  const { session, cookies } = await guard(request);
  const b = await readJson(request, 1024);
  if (b.status !== 'active' && b.status !== 'suspended') return fail(400, 'invalid', { reason: 'bad_status' }, { cookies });
  const r = await userRpc(session.at, 'operator_set_status', { p_tenant: tenant, p_status: b.status });
  if (!r.ok) throw refused(r, cookies);
  return ok({ status: b.status }, { cookies });
}

const handle = entry('admin', async (request, path) => {
  if (deployId() !== 'vyntex') return fail(404, 'not_found');
  const m = request.method;
  if (path === 'context') return m === 'GET' ? context(request) : methodNotAllowed('GET');
  if (path === 'companies') return m === 'GET' ? companies(request) : m === 'POST' ? create(request) : methodNotAllowed('GET, POST');
  const one = /^companies\/([0-9a-fA-F-]{36})\/(invite|status)$/.exec(path);
  if (one && isUuid(one[1])) {
    if (m !== 'POST') return methodNotAllowed('POST');
    return one[2] === 'invite' ? reinvite(request, one[1].toLowerCase()) : setStatus(request, one[1].toLowerCase());
  }
  return fail(404, 'not_found');
});

export const GET = handle;
export const POST = handle;
