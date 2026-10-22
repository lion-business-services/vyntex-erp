// /api/billing/*: subscriptions of client companies to VYNTEX ERP, paid through Stripe. VYNTEX ERP only.
//
//   GET   status/<tenant>          an owner or manager: the company's plan, trial and subscription        -> { billing }
//   POST  checkout                 { tenant, plan, billing }  an owner: a Stripe Checkout link            -> { url }
//   POST  portal                   { tenant }  an owner: Stripe's billing portal (card, invoices, cancel)  -> { url }
//   GET   operator                 an operator: billing state of every company                            -> { companies }
//   POST  operator/link            { tenant, plan, billing } or { tenant, custom: { recurringCents, interval, setupCents, label } }
//                                  an operator: a payment link for the owner, emailed to them               -> { url, delivery }
//   POST  webhook                  Stripe's events (signature checked; the event is then read back from Stripe's API)
//
// Who may do what is decided by the database: billing_context() lists the people of a company with their role (owners
// buy, managers look), operator_* functions require an operator whose session passed the second sign-in step. No price
// comes from the browser: plans are priced from config/vyntex-build-pricing.json, custom amounts only by an operator.
import { entry, ok, fail, readJson, readRaw, methodNotAllowed, upstreamError, isUuid, log } from './_lib/respond.js';
import { appOrigin, deployId, env } from './_lib/env.js';
import { userRpc, serviceRpc } from './_lib/supabase.js';
import { guard, assertConfigured } from './_lib/guard.js';
import { limit, keyHash, hit, addressKey, ipHash } from './_lib/ratelimit.js';
import { sendSystemEmail } from './_lib/mail.js';
import { enqueue } from './_lib/jobs.js';
import { payloadHash } from './_lib/integrations/webhook.js';
import { StripeError, stripeConfigured, webhookConfigured, stripeMode, verifySignature } from './_lib/billing/stripe.js';
import { billingDeps } from './_lib/billing/deps.js';
import { createCheckout, createPortal, handleEvent, BillingError } from './_lib/billing/core.js';

const uidKey = (uid) => keyHash('uid', uid);

function asFail(e, cookies) {
  if (e instanceof BillingError) return fail(e.status, e.code, {}, { cookies });
  if (e instanceof StripeError) {
    log('billing', 'stripe_refused', { code: e.code, status: e.status });
    return fail(e.code === 'not_configured' ? 503 : 502, e.code === 'not_configured' ? 'billing_not_configured' : 'stripe_error', { stripe: e.code }, { cookies });
  }
  throw e;
}

/** The company as this person may see it, or a refusal. */
async function contextFor(session, tenant, cookies) {
  if (!isUuid(tenant)) throw Object.assign(new Error('bad'), { response: fail(400, 'invalid', { reason: 'bad_tenant' }, { cookies }) });
  const r = await serviceRpc('billing_context', { p_user: session.uid, p_tenant: tenant.toLowerCase() });
  if (!r.ok) throw upstreamError(r);
  if (!r.data) throw Object.assign(new Error('denied'), { response: fail(403, 'forbidden', {}, { cookies }) });
  return r.data;
}

function view(c) {
  const a = c.account || {};
  return {
    tenant: c.tenant_id, slug: c.slug, name: c.name, industry: c.industry, plan: c.plan, status: c.status, role: c.role,
    trialStartedAt: c.trial_started_at || null, trialExpiresAt: c.trial_expires_at || null,
    subscription: a.subscription_id ? {
      status: a.status, plan: a.plan_id || null, billing: a.billing || null, currentPeriodEnd: a.current_period_end || null,
      cancelAtPeriodEnd: !!a.cancel_at_period_end, graceUntil: a.grace_until || null, lastPaymentAt: a.last_payment_at || null,
    } : null,
    hasCustomer: !!a.customer_id,
    available: stripeConfigured(), mode: stripeConfigured() ? stripeMode() : null,
  };
}

async function status(request, tenant) {
  const { session, cookies } = await guard(request);
  try {
    const c = await contextFor(session, tenant, cookies);
    return ok({ billing: view(c) }, { cookies });
  } catch (e) { if (e.response) return e.response; throw e; }
}

async function checkout(request) {
  const { session, cookies } = await guard(request);
  await limit('billing.checkout', uidKey(session.uid), 20, 3600);
  const b = await readJson(request, 4 * 1024);
  try {
    const c = await contextFor(session, b.tenant, cookies);
    if (c.role !== 'owner') return fail(403, 'owner_only', {}, { cookies });
    if (!stripeConfigured()) return fail(503, 'billing_not_configured', {}, { cookies });
    const out = await createCheckout(billingDeps(request), { company: c, email: c.email, origin: appOrigin(request), by: session.uid, source: 'owner', kind: 'plan', planId: String(b.plan || ''), billing: String(b.billing || ''), lang: b.lang === 'es' ? 'es' : 'en' });
    return ok({ url: out.url, expiresAt: out.expiresAt, amounts: out.amounts }, { cookies });
  } catch (e) { if (e.response) return e.response; return asFail(e, cookies); }
}

async function portal(request) {
  const { session, cookies } = await guard(request);
  await limit('billing.portal', uidKey(session.uid), 30, 3600);
  const b = await readJson(request, 1024);
  try {
    const c = await contextFor(session, b.tenant, cookies);
    if (c.role !== 'owner') return fail(403, 'owner_only', {}, { cookies });
    if (!stripeConfigured()) return fail(503, 'billing_not_configured', {}, { cookies });
    const out = await createPortal(billingDeps(request), { company: c, origin: appOrigin(request) });
    return ok({ url: out.url }, { cookies });
  } catch (e) { if (e.response) return e.response; return asFail(e, cookies); }
}

async function operatorList(request) {
  const { session, cookies } = await guard(request);
  const r = await userRpc(session.at, 'operator_billing', {});
  if (!r.ok) throw upstreamError(r);
  return ok({ companies: Array.isArray(r.data) ? r.data : [], available: stripeConfigured(), mode: stripeConfigured() ? stripeMode() : null, webhook: webhookConfigured() }, { cookies });
}

async function operatorLink(request) {
  const { session, cookies } = await guard(request);
  await limit('billing.operator', uidKey(session.uid), 60, 3600);
  const b = await readJson(request, 4 * 1024);
  if (!isUuid(b.tenant)) return fail(400, 'invalid', { reason: 'bad_tenant' }, { cookies });
  const tenant = b.tenant.toLowerCase();
  const allowed = await userRpc(session.at, 'operator_billing_allowed', { p_tenant: tenant });
  if (!allowed.ok) throw upstreamError(allowed);
  if (allowed.data !== true) return fail(404, 'not_found', {}, { cookies });
  if (!stripeConfigured()) return fail(503, 'billing_not_configured', {}, { cookies });
  const comp = await serviceRpc('billing_company', { p_tenant: tenant });
  if (!comp.ok || !comp.data) return fail(404, 'not_found', {}, { cookies });
  const company = comp.data;
  if (!company.owner_email) return fail(409, 'no_owner', {}, { cookies });
  const deps = billingDeps(request);
  try {
    const custom = b.custom && typeof b.custom === 'object' ? b.custom : null;
    const out = await createCheckout(deps, { company, email: company.owner_email, origin: appOrigin(request), by: session.uid, source: 'operator', kind: custom ? 'custom' : 'plan', planId: String(b.plan || ''), billing: String(b.billing || ''), custom, lang: b.lang === 'es' ? 'es' : 'en' });
    const amount = (c) => `$${(c / 100).toFixed(2)}`;
    const yearly = out.amounts.billing === 'yearly' || (custom && custom.interval === 'year');
    const lines = `${amount(out.amounts.recurringCents)} ${yearly ? 'per year' : 'per month'}`;
    const linesEs = `${amount(out.amounts.recurringCents)} ${yearly ? 'al año' : 'al mes'}`;
    const sent = await sendSystemEmail({
      to: [company.owner_email],
      subject: `Your VYNTEX ERP subscription for ${company.name} / Su suscripción de VYNTEX ERP`,
      text: [
        'Hello,', '', `Here is the secure Stripe payment page for the ${company.name} subscription: ${lines}${out.amounts.setupCents ? `, plus a one-time setup fee of ${amount(out.amounts.setupCents)}` : ''}.`,
        out.url, '', 'The link is valid for 23 hours. Card, Apple Pay, Google Pay and bank account (ACH) are accepted.', 'Questions? Call or WhatsApp 609-780-3218, or write to info@vyntexusa.com.', '', '---', '',
        'Hola:', '', `Esta es la página segura de pago de Stripe para la suscripción de ${company.name}: ${linesEs}${out.amounts.setupCents ? `, más una instalación única de ${amount(out.amounts.setupCents)}` : ''}.`,
        out.url, '', 'El enlace es válido por 23 horas. Se aceptan tarjeta, Apple Pay, Google Pay y cuenta bancaria (ACH).', '¿Preguntas? Llame o escriba por WhatsApp al 609-780-3218, o escriba a info@vyntexusa.com.', '',
      ].join('\n'),
      tenant, idem: 'bill:link:' + out.id,
    });
    return ok({ url: out.url, expiresAt: out.expiresAt, amounts: out.amounts, delivery: sent.delivered ? 'sent' : sent.reason === 'not_configured' ? 'not_configured' : 'failed' }, { cookies });
  } catch (e) { return asFail(e, cookies); }
}

/** Stripe's webhook. The signature is the authentication; the event itself is then read back from Stripe. */
async function webhook(request) {
  assertConfigured();
  const addr = addressKey(request);
  const flood = await hit('webhook.addr', addr, 1200, 60);
  if (!flood.allowed) return fail(429, 'rate_limited');
  let raw;
  try { raw = await readRaw(request, 512 * 1024); } catch { return fail(400, 'invalid_body'); }
  if (raw === null) return fail(413, 'too_large');
  const hash = payloadHash(raw);
  const v = verifySignature(raw, request.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'));
  if (!v.ok) {
    const room = await hit('webhook.reject', addr, 20, 60);
    if (room.allowed) await serviceRpc('webhook_reject', { p_provider: 'stripe_billing', p_payload_hash: hash, p_error: v.reason, p_ip_hash: ipHash(request) });
    return fail(v.reason === 'not_configured' ? 503 : v.reason === 'stale' ? 400 : 401, v.reason === 'not_configured' ? 'not_configured' : v.reason === 'stale' ? 'stale' : 'bad_signature');
  }
  const rec = await serviceRpc('webhook_receive', { p_provider: 'stripe_billing', p_event_id: v.event.id, p_tenant: null, p_payload_hash: hash, p_redacted: { type: String(v.event.type).slice(0, 80), livemode: !!v.event.livemode } });
  if (!rec.ok) return fail(503, 'unavailable');
  if (!rec.data.fresh) return ok({ duplicate: true });
  // Acted on right away (a person may be waiting on the success page); if that fails, the job queue tries again.
  try {
    const out = await handleEvent(billingDeps(request), v.event.id);
    await serviceRpc('webhook_mark', { p_id: rec.data.id, p_status: out && out.ignored ? 'ignored' : 'processed', p_error: null, p_job: null });
    return ok({ received: true });
  } catch (e) {
    log('billing', 'event_failed', { type: v.event.type, code: e && e.code ? String(e.code) : 'error' });
    const job = await enqueue('billing.event', { event: rec.data.id, stripe: v.event.id }, { idem: 'stripe:' + v.event.id, maxAttempts: 8 });
    await serviceRpc('webhook_mark', { p_id: rec.data.id, p_status: job ? 'queued' : 'failed', p_error: e && e.code ? String(e.code).slice(0, 60) : 'processing_failed', p_job: job });
    return ok({ received: true, queued: !!job });
  }
}

const handle = entry('billing', async (request, path) => {
  if (deployId() !== 'vyntex') return fail(404, 'not_found');
  const m = request.method;
  if (path === 'webhook') return m === 'POST' ? webhook(request) : methodNotAllowed('POST');
  if (path === 'checkout') return m === 'POST' ? checkout(request) : methodNotAllowed('POST');
  if (path === 'portal') return m === 'POST' ? portal(request) : methodNotAllowed('POST');
  if (path === 'operator') return m === 'GET' ? operatorList(request) : methodNotAllowed('GET');
  if (path === 'operator/link') return m === 'POST' ? operatorLink(request) : methodNotAllowed('POST');
  const s = /^status\/([0-9a-fA-F-]{36})$/.exec(path);
  if (s) return m === 'GET' ? status(request, s[1]) : methodNotAllowed('GET');
  return fail(404, 'not_found');
});

export const GET = handle;
export const POST = handle;
