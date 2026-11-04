// VYNTEX's own billing: a client company pays for its VYNTEX ERP plan through Stripe.
//
//   quote()            what a plan costs, read from config/vyntex-build-pricing.json (through the server domain bundle)
//   ensurePrices()     the Stripe product and prices for a plan, found by lookup key or created once (insert only:
//                      a price in Stripe is never changed; a new pricing version gets new prices, old subscriptions keep theirs)
//   createCheckout()   a Stripe Checkout link: the plan (monthly or yearly) plus the one-time setup fee on the first invoice.
//                      With trial: true (a company waiting for its card, 0082): the 7-day trial with the card on file:
//                      a subscription with a Stripe trial for a priced edition ($0 today), a saved card for a quoted one
//   createPortal()     Stripe's customer portal: card, bank account, invoices, cancellation at the end of the period
//   handleEvent()      acts on one Stripe event, read back from Stripe's API by its id (a webhook body is never trusted)
//   daily()            pauses companies whose grace period ended, sends the trial and payment reminders once each
//
// Every function takes its outside world as `deps` ({ stripe, rpc, mail, now, notifyTo }) so the tests run it with fakes.
// Pricing rules that come from the pricing file and the owner: no service fee line (VYNTEX absorbs processing fees), card,
// Apple Pay / Google Pay (part of card) and ACH bank debit only (Klarna, Afterpay, Affirm stay off), Stripe Tax off.
import * as bundle from '../domain.bundle.mjs';
import { billingEmail } from './emails.js';

const { pricing } = bundle;
export const BILLINGS = ['monthly', 'yearly'];
const PAYMENT_METHODS = ['card', 'us_bank_account'];
/** The free trial takes a card (Apple Pay and Google Pay are cards): a bank debit cannot be verified on the spot. */
const TRIAL_METHODS = ['card'];
export const TRIAL_DAYS = 7;
const OPEN_STATES = ['active', 'trialing'];

export class BillingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/** The plan as the pricing file has it, for this edition. Throws for a quoted edition or an unknown plan. */
export function quote(industry, planId, billing) {
  if (!BILLINGS.includes(billing)) throw new BillingError('bad_billing');
  if (!pricing.isPriced(industry)) throw new BillingError('quoted_edition');
  const plan = pricing.plansFor(industry).find((p) => p.id === planId);
  if (!plan) throw new BillingError('bad_plan');
  const recurringCents = Math.round((billing === 'yearly' ? plan.yearly : plan.monthly) * 100);
  const setupCents = Math.round(plan.setup * 100);
  if (!(recurringCents > 0) || setupCents < 0) throw new BillingError('bad_price', 500);
  const version = String(pricing.PRICING_VERSION || 'v1').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return {
    plan, planId: plan.id, billing, recurringCents, setupCents, interval: billing === 'yearly' ? 'year' : 'month',
    productId: `vx_plan_${plan.id}`, setupProductId: `vx_setup_${plan.id}`,
    recurringKey: `vx_${version}_${plan.id}_${billing}`, setupKey: `vx_${version}_${plan.id}_setup`,
    name: `VYNTEX ERP ${plan.name}`, version: pricing.PRICING_VERSION,
  };
}

async function ensureProduct(deps, id, name, metadata) {
  try {
    const p = await deps.stripe('GET', `/products/${id}`);
    if (p && p.id === id) return p.id;
  } catch (e) {
    if (e.status !== 404 && e.code !== 'resource_missing') throw e;
  }
  const made = await deps.stripe('POST', '/products', { id, name, metadata }, { idem: `product:${id}` });
  return made.id;
}

async function ensurePrice(deps, { key, product, unitAmount, interval, nickname, metadata }) {
  const found = await deps.stripe('GET', '/prices', { 'lookup_keys[]': key, active: 'true', limit: 1 });
  const hit = found && Array.isArray(found.data) ? found.data.find((p) => p.lookup_key === key) : null;
  if (hit) {
    if (hit.unit_amount !== unitAmount || hit.currency !== 'usd') throw new BillingError('price_mismatch', 500);
    return hit.id;
  }
  const made = await deps.stripe('POST', '/prices', {
    product, currency: 'usd', unit_amount: unitAmount, lookup_key: key, nickname, metadata,
    ...(interval ? { recurring: { interval } } : {}), tax_behavior: 'exclusive',
  }, { idem: `price:${key}:${unitAmount}` });
  return made.id;
}

/** The two Stripe prices of a plan: the recurring one and the setup fee. */
export async function ensurePrices(deps, q) {
  const meta = { vx: 'erp', plan_id: q.planId, pricing_version: String(q.version || '') };
  const product = await ensureProduct(deps, q.productId, q.name, meta);
  const recurring = await ensurePrice(deps, { key: q.recurringKey, product, unitAmount: q.recurringCents, interval: q.interval, nickname: `${q.name} (${q.billing})`, metadata: meta });
  let setup = null;
  if (q.setupCents > 0) {
    const setupProduct = await ensureProduct(deps, q.setupProductId, `${q.name}: one-time setup`, meta);
    setup = await ensurePrice(deps, { key: q.setupKey, product: setupProduct, unitAmount: q.setupCents, interval: null, nickname: `${q.name} setup`, metadata: meta });
  }
  return { recurring, setup };
}

/** The company's Stripe customer, made once and remembered. */
export async function ensureCustomer(deps, company, email) {
  const known = company.account && company.account.customer_id;
  if (known) return known;
  const c = await deps.stripe('POST', '/customers', {
    email: email || undefined, name: company.name,
    metadata: { vx: 'erp', tenant_id: company.tenant_id, slug: company.slug },
  }, { idem: `customer:${company.tenant_id}` });
  const r = await deps.rpc('billing_customer_set', { p_tenant: company.tenant_id, p_customer: c.id });
  if (!r.ok || r.data !== true) throw new BillingError('customer_conflict', 409);
  return c.id;
}

/**
 * A Checkout link for a company.
 *   kind 'plan'    plan + billing from the pricing file (owner or operator)
 *   kind 'custom'  amounts an operator typed for a quoted edition: recurringCents, interval, setupCents, label
 */
export async function createCheckout(deps, { company, email, origin, by, source, kind = 'plan', planId, billing, custom, lang = 'en', trial = false }) {
  // VYNTEX's own workspace is free for good (src/config/plans.ts): nothing to pay, from any screen
  if (company.plan === 'internal') throw new BillingError('internal_workspace', 409);
  // the free trial is decided here, never by the browser: only a company waiting for its card gets one, from its owner
  if (trial) {
    if (company.status !== 'awaiting_card' || company.plan !== 'trial') throw new BillingError('trial_not_available', 409);
    if (source !== 'owner' || kind !== 'plan') throw new BillingError('trial_not_available', 409);
    if (!pricing.isPriced(company.industry)) return saveCardCheckout(deps, { company, email, origin, lang });
  }
  const acct = company.account || {};
  if (acct.subscription_id && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(acct.status)) throw new BillingError('already_subscribed', 409);
  const customer = await ensureCustomer(deps, company, email);
  const now = deps.now();
  const expiresAt = Math.floor(now / 1000) + (source === 'operator' ? 23 * 3600 : 3600);
  let lineItems; let record;
  const metadata = { vx: 'erp', tenant_id: company.tenant_id, source };
  if (kind === 'custom') {
    const c = custom || {};
    const rec = Number(c.recurringCents); const setup = Number(c.setupCents || 0);
    if (!Number.isInteger(rec) || rec < 100 || rec > 100000000) throw new BillingError('bad_amount');
    if (!Number.isInteger(setup) || setup < 0 || setup > 100000000) throw new BillingError('bad_amount');
    if (!['month', 'year'].includes(c.interval)) throw new BillingError('bad_billing');
    const label = String(c.label || `VYNTEX ERP for ${company.name}`).slice(0, 120);
    lineItems = [{ price_data: { currency: 'usd', unit_amount: rec, recurring: { interval: c.interval }, product_data: { name: label, metadata: { vx: 'erp', custom: 'true' } }, tax_behavior: 'exclusive' }, quantity: 1 }];
    if (setup > 0) lineItems.push({ price_data: { currency: 'usd', unit_amount: setup, product_data: { name: `${label}: one-time setup` }, tax_behavior: 'exclusive' }, quantity: 1 });
    Object.assign(metadata, { billing: 'custom' });
    record = { plan: null, billing: 'custom', setup, recurring: rec };
  } else {
    const q = quote(company.industry, planId, billing);
    const prices = await ensurePrices(deps, q);
    lineItems = [{ price: prices.recurring, quantity: 1 }];
    // a trial charges nothing today: no one-time line on the trial's checkout
    if (prices.setup && !trial) lineItems.push({ price: prices.setup, quantity: 1 });
    Object.assign(metadata, { plan_id: q.planId, billing: q.billing, pricing_version: String(q.version || '') }, trial ? { trial: `${TRIAL_DAYS}d` } : {});
    record = { plan: q.planId, billing: q.billing, setup: trial ? 0 : q.setupCents, recurring: q.recurringCents };
  }
  // a trial comes back to the sign-in page of the workspace, which opens it as soon as Stripe confirms
  const back = trial ? `${origin}/${company.slug}` : `${origin}/${company.slug}/settings/billing`;
  const session = await deps.stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: company.tenant_id,
    line_items: lineItems,
    payment_method_types: trial ? TRIAL_METHODS : PAYMENT_METHODS,
    metadata,
    subscription_data: {
      metadata, description: `VYNTEX ERP: ${company.name}`,
      // the trial: no charge today; Stripe cancels a trial that ends with no card, it never bills one
      ...(trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
    },
    ...(trial ? { payment_method_collection: 'always' } : {}),
    customer_update: { name: 'auto', address: 'auto' },
    billing_address_collection: 'auto',
    allow_promotion_codes: 'false',
    locale: lang === 'es' ? 'es' : 'auto',
    expires_at: expiresAt,
    success_url: `${back}?billing=success`,
    cancel_url: `${back}?billing=cancelled`,
  }, { idem: `checkout:${company.tenant_id}:${record.plan || 'custom'}:${record.billing}:${record.recurring}:${record.setup}:${source}:${trial ? 'trial' : 'buy'}:${Math.floor(now / 60000)}` });
  await deps.rpc('billing_checkout_add', {
    p_session: session.id, p_tenant: company.tenant_id, p_by: by || null, p_source: source, p_plan: record.plan, p_billing: record.billing,
    p_setup: record.setup, p_recurring: record.recurring, p_expires: new Date(expiresAt * 1000).toISOString(),
  });
  return { url: session.url, id: session.id, expiresAt: new Date(expiresAt * 1000).toISOString(), trial: !!trial, amounts: { setupCents: record.setup, recurringCents: record.recurring, billing: record.billing, plan: record.plan } };
}

/** A quoted edition's trial: Stripe saves the card (setup mode), nothing is charged; VYNTEX sends the quote. */
async function saveCardCheckout(deps, { company, email, origin, lang }) {
  const customer = await ensureCustomer(deps, company, email);
  const now = deps.now();
  const expiresAt = Math.floor(now / 1000) + 3600;
  const metadata = { vx: 'erp', tenant_id: company.tenant_id, source: 'owner', trial: 'card' };
  const back = `${origin}/${company.slug}`;
  const session = await deps.stripe('POST', '/checkout/sessions', {
    mode: 'setup', customer, client_reference_id: company.tenant_id, payment_method_types: TRIAL_METHODS, currency: 'usd',
    metadata, setup_intent_data: { metadata, description: `VYNTEX ERP trial: ${company.name}` },
    locale: lang === 'es' ? 'es' : 'auto', expires_at: expiresAt,
    success_url: `${back}?billing=success`, cancel_url: `${back}?billing=cancelled`,
  }, { idem: `trial-card:${company.tenant_id}:${Math.floor(now / 60000)}` });
  return { url: session.url, id: session.id, expiresAt: new Date(expiresAt * 1000).toISOString(), trial: true, amounts: { setupCents: 0, recurringCents: 0, billing: null, plan: null } };
}

/** Stripe's fingerprint of a card (the same card gives the same value at any company), or null. */
async function cardFingerprint(deps, paymentMethod) {
  const id = idOf(paymentMethod);
  if (!id) return null;
  const pm = typeof paymentMethod === 'object' && paymentMethod.card ? paymentMethod : await deps.stripe('GET', `/payment_methods/${id}`);
  return pm && pm.card && typeof pm.card.fingerprint === 'string' ? pm.card.fingerprint : null;
}

/**
 * The card that started a trial: one free trial per card. The fingerprint is kept only as a keyed hash (deps.cardHash).
 * Answers 'new' | 'same' | 'reused' | 'unknown' (no card to check: the trial goes on, the event is logged).
 */
async function checkTrialCard(deps, tenant, paymentMethod) {
  const fp = await cardFingerprint(deps, paymentMethod);
  if (!fp || !deps.cardHash) return 'unknown';
  const r = await deps.rpc('billing_trial_card', { p_tenant: tenant, p_card_hash: deps.cardHash(fp) });
  return r.ok && typeof r.data === 'string' ? r.data : 'unknown';
}

let portalConfig = null;
/** Stripe's customer portal. The configuration is found (by our metadata) or made once: invoices, payment methods, address, cancel at period end. */
export async function createPortal(deps, { company, origin }) {
  const customer = company.account && company.account.customer_id;
  if (!customer) throw new BillingError('no_customer', 409);
  if (!portalConfig) {
    const list = await deps.stripe('GET', '/billing_portal/configurations', { active: 'true', limit: 100 });
    const mine = list && Array.isArray(list.data) ? list.data.find((c) => c.metadata && c.metadata.vx === 'erp') : null;
    portalConfig = mine ? mine.id : (await deps.stripe('POST', '/billing_portal/configurations', {
      business_profile: { headline: 'VYNTEX ERP billing' },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
        subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] } },
      },
      metadata: { vx: 'erp' },
    }, { idem: 'portal-config:vx-erp:v1' })).id;
  }
  const s = await deps.stripe('POST', '/billing_portal/sessions', { customer, configuration: portalConfig, return_url: `${origin}/${company.slug}/settings/billing` }, { idem: `portal:${company.tenant_id}:${Math.floor(deps.now() / 30000)}` });
  return { url: s.url };
}

const idOf = (v) => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);

/** Which company an object belongs to: its metadata, else the customer we know. */
async function tenantOf(deps, obj) {
  const m = (obj && obj.metadata) || {};
  if (typeof m.tenant_id === 'string' && /^[0-9a-f-]{36}$/i.test(m.tenant_id)) return m.tenant_id.toLowerCase();
  const customer = idOf(obj && obj.customer);
  if (!customer) return null;
  const r = await deps.rpc('billing_tenant_of_customer', { p_customer: customer });
  return r.ok && typeof r.data === 'string' ? r.data : null;
}

/** Reads the subscription from Stripe and applies it to the company. */
async function syncSubscription(deps, subscriptionId, fallbackTenant = null) {
  const sub = await deps.stripe('GET', `/subscriptions/${subscriptionId}`);
  const tenant = (await tenantOf(deps, sub)) || fallbackTenant;
  if (!tenant) return { tenant: null, sub, result: null };
  const m = sub.metadata || {};
  const billing = ['monthly', 'yearly', 'custom'].includes(m.billing) ? m.billing : null;
  const r = await deps.rpc('billing_sync', {
    p_tenant: tenant, p_customer: idOf(sub.customer), p_subscription: sub.id, p_status: sub.status,
    p_plan: typeof m.plan_id === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(m.plan_id) ? m.plan_id : null, p_billing: billing,
    p_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    p_cancel_at_end: !!sub.cancel_at_period_end,
  });
  if (!r.ok) throw new BillingError('sync_failed', 503);
  return { tenant, sub, result: r.data };
}

async function companyOf(deps, tenant) {
  const r = await deps.rpc('billing_company', { p_tenant: tenant });
  return r.ok ? r.data : null;
}

async function tell(deps, { tenant, kind, to, facts, idem }) {
  const company = facts.company || (tenant ? await companyOf(deps, tenant) : null);
  const recipients = to === 'owner' ? (company && company.owner_email ? [company.owner_email] : []) : [deps.notifyTo];
  if (!recipients.length) return { delivered: false, reason: 'no_recipient' };
  const mail = billingEmail(kind, { ...facts, company, audience: to, origin: deps.origin });
  if (!mail) return { delivered: false, reason: 'no_template' };
  return deps.mail({ to: recipients, subject: mail.subject, text: mail.text, tenant, idem });
}

/**
 * Acts on one Stripe event. The event is read from Stripe's API by its id, so what is acted on is what Stripe has, not
 * what someone posted. Safe to run twice: every write is either a sync to Stripe's current state or a record kept once.
 */
export async function handleEvent(deps, eventId) {
  const ev = await deps.stripe('GET', `/events/${eventId}`);
  const obj = ev && ev.data && ev.data.object ? ev.data.object : {};
  const type = String(ev.type || '');
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.mode === 'setup' && (obj.metadata || {}).trial === 'card') return trialCardSaved(deps, obj);
      if (obj.mode !== 'subscription' || !obj.subscription) return { ignored: true };
      const done = await deps.rpc('billing_checkout_done', { p_session: obj.id, p_status: 'complete' });
      const { tenant, sub } = await syncSubscription(deps, idOf(obj.subscription), await tenantOf(deps, obj));
      if (!tenant) return { ignored: true, reason: 'unknown_company' };
      if ((obj.metadata || {}).trial && sub && sub.status === 'trialing') return trialSubscribed(deps, { tenant, sub, session: obj, done });
      const fresh = await deps.rpc('billing_event_add', { p_tenant: tenant, p_kind: 'checkout.completed', p_stripe_id: obj.id, p_amount: obj.amount_total ?? null, p_currency: obj.currency || 'usd', p_status: obj.payment_status || null, p_facts: { source: (obj.metadata || {}).source || null } });
      if (fresh.ok && fresh.data === true) {
        const amounts = { total: obj.amount_total, plan: (obj.metadata || {}).plan_id || null, billing: (obj.metadata || {}).billing || null };
        await tell(deps, { tenant, kind: 'subscribed', to: 'owner', facts: amounts, idem: `bill:subscribed:${obj.id}` });
        await tell(deps, { tenant, kind: 'subscribed', to: 'vyntex', facts: amounts, idem: `bill:subscribed:vx:${obj.id}` });
      }
      return { done: true, checkout: done.ok ? done.data : null };
    }
    case 'checkout.session.expired':
      await deps.rpc('billing_checkout_done', { p_session: obj.id, p_status: 'expired' });
      return { done: true };
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const { tenant, result, sub } = await syncSubscription(deps, obj.id);
      if (!tenant) return { ignored: true, reason: 'unknown_company' };
      if (type === 'customer.subscription.deleted') {
        const fresh = await deps.rpc('billing_event_add', { p_tenant: tenant, p_kind: 'subscription.ended', p_stripe_id: sub.id, p_amount: null, p_currency: null, p_status: sub.status, p_facts: {} });
        if (fresh.ok && fresh.data === true) {
          await tell(deps, { tenant, kind: 'ended', to: 'owner', facts: {}, idem: `bill:ended:${sub.id}` });
          await tell(deps, { tenant, kind: 'ended', to: 'vyntex', facts: {}, idem: `bill:ended:vx:${sub.id}` });
        }
      } else if (result && result.before && result.before !== result.after && sub.cancel_at_period_end) {
        await tell(deps, { tenant, kind: 'cancel_scheduled', to: 'vyntex', facts: { until: sub.current_period_end }, idem: `bill:cancel:${sub.id}:${sub.current_period_end}` });
      }
      return { done: true };
    }
    case 'invoice.paid': {
      const tenant = await tenantOf(deps, obj) || (obj.subscription ? (await syncSubscription(deps, idOf(obj.subscription))).tenant : null);
      if (!tenant) return { ignored: true, reason: 'unknown_company' };
      const fresh = await deps.rpc('billing_event_add', { p_tenant: tenant, p_kind: 'invoice.paid', p_stripe_id: obj.id, p_amount: obj.amount_paid ?? 0, p_currency: obj.currency || 'usd', p_status: 'paid', p_facts: { number: obj.number || null, reason: obj.billing_reason || null } });
      await deps.rpc('billing_paid', { p_tenant: tenant });
      if (obj.subscription) await syncSubscription(deps, idOf(obj.subscription), tenant);
      if (fresh.ok && fresh.data === true && obj.billing_reason !== 'subscription_create') {
        // renewals: a short note to VYNTEX only; the client gets Stripe's own receipt
        await tell(deps, { tenant, kind: 'renewed', to: 'vyntex', facts: { amount: obj.amount_paid }, idem: `bill:paid:${obj.id}` });
      }
      return { done: true };
    }
    case 'invoice.payment_failed': {
      const tenant = await tenantOf(deps, obj);
      let grace = null;
      if (obj.subscription) { const s = await syncSubscription(deps, idOf(obj.subscription), tenant); grace = s.result && s.result.grace_until; }
      const t = tenant || null;
      if (!t) return { ignored: true, reason: 'unknown_company' };
      const fresh = await deps.rpc('billing_event_add', { p_tenant: t, p_kind: 'invoice.payment_failed', p_stripe_id: `${obj.id}:${obj.attempt_count || 1}`, p_amount: obj.amount_due ?? null, p_currency: obj.currency || 'usd', p_status: 'failed', p_facts: { attempt: obj.attempt_count || 1 } });
      if (fresh.ok && fresh.data === true) {
        await tell(deps, { tenant: t, kind: 'payment_failed', to: 'owner', facts: { amount: obj.amount_due, grace }, idem: `bill:failed:${obj.id}:${obj.attempt_count || 1}` });
        await tell(deps, { tenant: t, kind: 'payment_failed', to: 'vyntex', facts: { amount: obj.amount_due, grace }, idem: `bill:failed:vx:${obj.id}:${obj.attempt_count || 1}` });
      }
      return { done: true };
    }
    case 'charge.refunded':
    case 'charge.dispute.created': {
      // a dispute names its charge, not the customer: read the charge to find the company
      const tenant = (await tenantOf(deps, obj)) || (type === 'charge.dispute.created' && obj.charge ? await tenantOf(deps, await deps.stripe('GET', `/charges/${idOf(obj.charge)}`)) : null);
      const kind = type === 'charge.refunded' ? 'charge.refunded' : 'charge.disputed';
      const amount = type === 'charge.refunded' ? obj.amount_refunded : obj.amount;
      const fresh = await deps.rpc('billing_event_add', { p_tenant: tenant, p_kind: kind, p_stripe_id: obj.id, p_amount: amount ?? null, p_currency: obj.currency || 'usd', p_status: obj.status || null, p_facts: {} });
      if (fresh.ok && fresh.data === true) await tell(deps, { tenant, kind: type === 'charge.refunded' ? 'refunded' : 'disputed', to: 'vyntex', facts: { amount }, idem: `bill:${kind}:${obj.id}` });
      return { done: true };
    }
    default:
      return { ignored: true };
  }
}

/** A trial subscription has started ($0 today). One trial per card: a card that already had one starts the plan now. */
async function trialSubscribed(deps, { tenant, sub, session, done }) {
  const card = await checkTrialCard(deps, tenant, sub.default_payment_method);
  let current = sub;
  if (card === 'reused') {
    current = await deps.stripe('POST', `/subscriptions/${sub.id}`, { trial_end: 'now', proration_behavior: 'none' }, { idem: `trial-end-now:${sub.id}` });
    await syncSubscription(deps, sub.id, tenant);
  }
  const until = current.trial_end ? new Date(current.trial_end * 1000).toISOString() : null;
  await deps.rpc('billing_trial_started', { p_tenant: tenant, p_until: until, p_clock: false });
  const m = session.metadata || {};
  const amounts = { plan: m.plan_id || null, billing: m.billing || null, at: card === 'reused' ? null : until, ...(await planInfo(deps, tenant, m)) };
  const fresh = await deps.rpc('billing_event_add', { p_tenant: tenant, p_kind: card === 'reused' ? 'trial.card_reused' : 'trial.started', p_stripe_id: session.id, p_amount: 0, p_currency: 'usd', p_status: current.status || null, p_facts: { card } });
  if (fresh.ok && fresh.data === true) {
    const kind = card === 'reused' ? 'trial_skipped' : 'trial_started';
    await tell(deps, { tenant, kind, to: 'owner', facts: amounts, idem: `bill:${kind}:${session.id}` });
    await tell(deps, { tenant, kind, to: 'vyntex', facts: amounts, idem: `bill:${kind}:vx:${session.id}` });
  }
  return { done: true, trial: card === 'reused' ? 'skipped' : 'started', checkout: done && done.ok ? done.data : null };
}

/** A quoted edition's trial: the card is saved. It becomes the default card; the 7 days start (or not, for a reused card). */
async function trialCardSaved(deps, session) {
  const tenant = await tenantOf(deps, session);
  if (!tenant) return { ignored: true, reason: 'unknown_company' };
  const si = session.setup_intent ? await deps.stripe('GET', `/setup_intents/${idOf(session.setup_intent)}`) : null;
  const pm = si ? si.payment_method : null;
  if (!pm || (si && si.status !== 'succeeded')) return { ignored: true, reason: 'no_card' };
  const customer = idOf(session.customer);
  if (customer) await deps.stripe('POST', `/customers/${customer}`, { invoice_settings: { default_payment_method: idOf(pm) } }, { idem: `default-card:${customer}:${idOf(pm)}` });
  const card = await checkTrialCard(deps, tenant, pm);
  const fresh = await deps.rpc('billing_event_add', { p_tenant: tenant, p_kind: card === 'reused' ? 'trial.card_reused' : 'trial.card_saved', p_stripe_id: session.id, p_amount: 0, p_currency: 'usd', p_status: 'saved', p_facts: { card } });
  if (card === 'reused') {
    if (fresh.ok && fresh.data === true) {
      await tell(deps, { tenant, kind: 'trial_card_reused', to: 'owner', facts: {}, idem: `bill:trial_card_reused:${session.id}` });
      await tell(deps, { tenant, kind: 'trial_card_reused', to: 'vyntex', facts: {}, idem: `bill:trial_card_reused:vx:${session.id}` });
    }
    return { done: true, trial: 'refused' };
  }
  const until = new Date(deps.now() + TRIAL_DAYS * 86400000).toISOString();
  await deps.rpc('billing_trial_started', { p_tenant: tenant, p_until: until, p_clock: true });
  if (fresh.ok && fresh.data === true) {
    await tell(deps, { tenant, kind: 'trial_started', to: 'owner', facts: { at: until, quoted: true }, idem: `bill:trial_started:${session.id}` });
    await tell(deps, { tenant, kind: 'trial_started', to: 'vyntex', facts: { at: until, quoted: true }, idem: `bill:trial_started:vx:${session.id}` });
  }
  return { done: true, trial: 'started' };
}

/** What the plan will charge, in cents, and its name, from the pricing file (never from an event). */
async function planInfo(deps, tenant, m) {
  try {
    const company = await companyOf(deps, tenant);
    if (!company) return { amount: null, planName: null };
    const q = quote(company.industry, m.plan_id, m.billing);
    return { amount: q.recurringCents, planName: q.name };
  } catch { return { amount: null, planName: null }; }
}

/** Once a day: pause companies whose grace period ended, then send the reminders that are due (each once). */
export async function daily(deps) {
  let paused = 0; let sent = 0;
  const g = await deps.rpc('billing_enforce_grace', {});
  for (const c of g.ok && Array.isArray(g.data) ? g.data : []) {
    paused += 1;
    await deps.rpc('billing_notice_mark', { p_tenant: c.tenant_id, p_kind: 'paused', p_period: new Date(deps.now()).toISOString().slice(0, 10) });
    await tell(deps, { tenant: c.tenant_id, kind: 'paused', to: 'owner', facts: {}, idem: `bill:paused:${c.tenant_id}:${new Date(deps.now()).toISOString().slice(0, 10)}` });
    await tell(deps, { tenant: c.tenant_id, kind: 'paused', to: 'vyntex', facts: {}, idem: `bill:paused:vx:${c.tenant_id}:${new Date(deps.now()).toISOString().slice(0, 10)}` });
  }
  const due = await deps.rpc('billing_notices_due', {});
  for (const n of due.ok && Array.isArray(due.data) ? due.data : []) {
    const mark = await deps.rpc('billing_notice_mark', { p_tenant: n.tenant_id, p_kind: n.kind, p_period: n.period });
    if (!mark.ok || mark.data !== true) continue;
    let facts = { at: n.at };
    if (n.kind === 'charge_3d' || n.kind === 'charge_1d') {
      const company = await companyOf(deps, n.tenant_id);
      const a = (company && company.account) || {};
      facts = { at: n.at, plan: a.plan_id || null, billing: a.billing || null, ...(await planInfo(deps, n.tenant_id, { plan_id: a.plan_id, billing: a.billing })) };
    }
    const r = await tell(deps, { tenant: n.tenant_id, kind: n.kind, to: 'owner', facts, idem: `bill:${n.kind}:${n.tenant_id}:${n.period}` });
    if (n.kind === 'trial_ended') await tell(deps, { tenant: n.tenant_id, kind: 'trial_ended', to: 'vyntex', facts: { at: n.at }, idem: `bill:${n.kind}:vx:${n.tenant_id}:${n.period}` });
    if (r.delivered) sent += 1;
  }
  return { paused, sent };
}

export const isOpen = (status) => OPEN_STATES.includes(status);
