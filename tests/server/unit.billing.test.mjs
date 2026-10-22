// VYNTEX's own Stripe billing: the REST client, the webhook signature check and the billing logic with a fake Stripe,
// a fake database and a fake mailbox. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setTestEnv } from './helpers.mjs';

setTestEnv({ STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24), STRIPE_WEBHOOK_SECRET: 'whsec_' + 'b'.repeat(24) });
const S = await import('../../api/_lib/billing/stripe.js');
const B = await import('../../api/_lib/billing/core.js');
const { billingEmail } = await import('../../api/_lib/billing/emails.js');

const TENANT = '11111111-2222-4333-8444-555555555555';
const company = (extra = {}) => ({ tenant_id: TENANT, slug: 'acme-build', name: 'Acme Build', industry: 'build', plan: 'trial', status: 'active', owner_email: 'owner@acme.test', account: null, ...extra });

/* ---------- the REST client ---------- */

test('form encoding nests objects and arrays the way Stripe reads them, and leaves out empty values', () => {
  const s = S.encodeForm({ a: 1, b: { c: 'x y', d: null }, e: ['p', { q: true }], f: undefined, g: false });
  assert.equal(decodeURIComponent(s), 'a=1&b[c]=x y&e[0]=p&e[1][q]=true&g=false');
});

test('writes need an idempotency key, and the call carries the pinned version and the key', async () => {
  await assert.rejects(S.stripe('POST', '/customers', { email: 'x@y.z' }), (e) => e.code === 'idempotency_key_required');
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ id: 'cus_123' }) }; };
  const r = await S.stripe('POST', '/customers', { email: 'x@y.z' }, { idem: 'customer:1', fetchFn });
  assert.equal(r.id, 'cus_123');
  assert.equal(seen.url, 'https://api.stripe.com/v1/customers');
  assert.equal(seen.init.headers['stripe-version'], S.API_VERSION);
  assert.equal(seen.init.headers['idempotency-key'], 'customer:1');
  assert.equal(seen.init.body, 'email=x%40y.z');
});

test('a Stripe error carries only its short code, never the response text', async () => {
  const fetchFn = async () => ({ ok: false, status: 402, json: async () => ({ error: { code: 'card_declined', type: 'card_error', message: 'secret detail sk_test_zzz' } }) });
  await assert.rejects(S.stripe('GET', '/x', {}, { fetchFn }), (e) => e.code === 'card_declined' && e.status === 402 && !String(e.message).includes('sk_'));
  const down = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(S.stripe('GET', '/x', {}, { fetchFn: down }), (e) => e.code === 'stripe_unreachable');
});

test('the key decides test or live mode', () => {
  assert.equal(S.stripeConfigured(), true);
  assert.equal(S.webhookConfigured(), true);
  assert.equal(S.stripeMode(), 'test');
});

/* ---------- webhook signatures ---------- */

const SECRET = 'whsec_' + 'b'.repeat(24);
const sign = (body, t, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const BODY = JSON.stringify({ id: 'evt_1234567890', type: 'invoice.paid', data: { object: {} } });

test('a correctly signed, fresh event is accepted', () => {
  const now = 1_800_000_000_000; const t = now / 1000;
  const r = S.verifySignature(BODY, sign(BODY, t), SECRET, { now });
  assert.equal(r.ok, true);
  assert.equal(r.event.id, 'evt_1234567890');
});

test('a wrong secret, a changed body, an old time stamp or a malformed header is refused', () => {
  const now = 1_800_000_000_000; const t = now / 1000;
  assert.equal(S.verifySignature(BODY, sign(BODY, t, 'whsec_other'), SECRET, { now }).reason, 'bad_signature');
  assert.equal(S.verifySignature(BODY.replace('invoice', 'invoicX'), sign(BODY, t), SECRET, { now }).reason, 'bad_signature');
  assert.equal(S.verifySignature(BODY, sign(BODY, t - 301), SECRET, { now }).reason, 'stale');
  assert.equal(S.verifySignature(BODY, 'garbage', SECRET, { now }).reason, 'bad_signature');
  assert.equal(S.verifySignature(BODY, sign(BODY, t), '', { now }).reason, 'not_configured');
  const bad = JSON.stringify({ id: 'not-an-event', type: 'x' });
  assert.equal(S.verifySignature(bad, sign(bad, t), SECRET, { now }).reason, 'bad_request');
});

test('any one of several v1 signatures may match (Stripe sends two while a secret is rolled)', () => {
  const now = 1_800_000_000_000; const t = now / 1000;
  const good = sign(BODY, t).split(',')[1];
  assert.equal(S.verifySignature(BODY, `t=${t},v1=${'0'.repeat(64)},${good}`, SECRET, { now }).ok, true);
});

/* ---------- prices ---------- */

test('a quote comes from the pricing file: monthly, yearly and the setup fee, in cents', () => {
  const m = B.quote('build', 'builder', 'monthly');
  assert.equal(m.recurringCents, 11900);
  assert.equal(m.setupCents, 49900);
  assert.equal(m.interval, 'month');
  const y = B.quote('build', 'builder', 'yearly');
  assert.equal(y.recurringCents, 130900);
  assert.equal(y.interval, 'year');
  assert.match(y.recurringKey, /^vx_[a-z0-9_]+_builder_yearly$/);
  assert.throws(() => B.quote('practice', 'x', 'monthly'), (e) => e.code === 'quoted_edition');
  assert.throws(() => B.quote('build', 'nope', 'monthly'), (e) => e.code === 'bad_plan');
  assert.throws(() => B.quote('build', 'builder', 'weekly'), (e) => e.code === 'bad_billing');
});

/* ---------- a fake outside world ---------- */

function world({ prices = {}, subs = {}, events = {}, charges = {}, rpcData = {} } = {}) {
  const calls = { stripe: [], rpc: [], mail: [] };
  const added = new Set();
  const stripe = async (method, path, params = {}, opts = {}) => {
    calls.stripe.push({ method, path, params, idem: opts.idem });
    if (method === 'GET' && path.startsWith('/products/')) { const e = new S.StripeError('resource_missing', 404); throw e; }
    if (method === 'POST' && path === '/products') return { id: params.id };
    if (method === 'GET' && path === '/prices') { const key = params['lookup_keys[]']; return { data: prices[key] ? [prices[key]] : [] }; }
    if (method === 'POST' && path === '/prices') return { id: 'price_' + params.lookup_key };
    if (method === 'POST' && path === '/customers') return { id: 'cus_new123' };
    if (method === 'POST' && path === '/checkout/sessions') return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: params.expires_at };
    if (method === 'GET' && path.startsWith('/subscriptions/')) return subs[path.split('/')[2]];
    if (method === 'GET' && path.startsWith('/events/')) return events[path.split('/')[2]];
    if (method === 'GET' && path.startsWith('/charges/')) return charges[path.split('/')[2]];
    throw new Error('unexpected Stripe call ' + method + ' ' + path);
  };
  const rpc = async (fn, args) => {
    calls.rpc.push({ fn, args });
    if (fn === 'billing_event_add') { const k = args.p_kind + ':' + args.p_stripe_id; const fresh = !added.has(k); added.add(k); return { ok: true, data: fresh }; }
    if (fn === 'billing_company') return { ok: true, data: company() };
    if (fn === 'billing_customer_set') return { ok: true, data: true };
    if (fn === 'billing_sync') return { ok: true, data: rpcData.sync ?? { before: 'active', after: 'active', grace_until: null } };
    if (fn === 'billing_tenant_of_customer') return { ok: true, data: args.p_customer === 'cus_known' ? TENANT : null };
    if (fn in rpcData) return { ok: true, data: rpcData[fn] };
    return { ok: true, data: true };
  };
  const mail = async (m) => { calls.mail.push(m); return { delivered: true }; };
  return { deps: { stripe, rpc, mail, now: () => 1_800_000_000_000, notifyTo: 'info@vyntexusa.com', origin: 'https://erp.vyntexusa.com' }, calls };
}

/* ---------- checkout ---------- */

test('a plan checkout uses lookup-key prices, adds the setup fee once, card and ACH only, no fee line', async () => {
  const { deps, calls } = world();
  const out = await B.createCheckout(deps, { company: company(), email: 'owner@acme.test', origin: 'https://erp.vyntexusa.com', by: null, source: 'owner', planId: 'builder', billing: 'monthly' });
  assert.equal(out.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  const cs = calls.stripe.find((c) => c.path === '/checkout/sessions');
  assert.equal(cs.params.mode, 'subscription');
  assert.deepEqual(cs.params.payment_method_types, ['card', 'us_bank_account']);
  assert.equal(cs.params.line_items.length, 2);
  assert.equal(cs.params.metadata.tenant_id, TENANT);
  assert.equal(cs.params.metadata.plan_id, 'builder');
  assert.ok(!JSON.stringify(cs.params).includes('automatic_tax'), 'Stripe Tax stays off');
  const created = calls.stripe.filter((c) => c.path === '/prices' && c.method === 'POST').map((c) => c.params.unit_amount).sort();
  assert.deepEqual(created, [11900, 49900]);
  assert.ok(calls.stripe.filter((c) => c.method === 'POST').every((c) => c.idem), 'every write has an idempotency key');
  assert.ok(calls.rpc.some((c) => c.fn === 'billing_checkout_add'));
  assert.ok(cs.params.success_url.startsWith('https://erp.vyntexusa.com/acme-build/settings/billing'));
});

test('an existing price with a different amount stops the checkout (prices are never changed in place)', async () => {
  const q = B.quote('build', 'builder', 'monthly');
  const { deps } = world({ prices: { [q.recurringKey]: { id: 'price_old', lookup_key: q.recurringKey, unit_amount: 9900, currency: 'usd' } } });
  await assert.rejects(B.createCheckout(deps, { company: company(), email: 'o@a.test', origin: 'x', source: 'owner', planId: 'builder', billing: 'monthly' }), (e) => e.code === 'price_mismatch');
});

test('a company that already pays cannot start a second subscription', async () => {
  const { deps } = world();
  const c = company({ account: { customer_id: 'cus_known', subscription_id: 'sub_1', status: 'active' } });
  await assert.rejects(B.createCheckout(deps, { company: c, email: 'o@a.test', origin: 'x', source: 'owner', planId: 'builder', billing: 'monthly' }), (e) => e.code === 'already_subscribed');
});

test('a custom checkout for a quoted edition checks the amounts', async () => {
  const { deps, calls } = world();
  const c = company({ industry: 'practice' });
  await assert.rejects(B.createCheckout(deps, { company: c, email: 'o@a.test', origin: 'x', source: 'operator', kind: 'custom', custom: { recurringCents: 50, interval: 'month' } }), (e) => e.code === 'bad_amount');
  await assert.rejects(B.createCheckout(deps, { company: c, email: 'o@a.test', origin: 'x', source: 'operator', kind: 'custom', custom: { recurringCents: 50000, interval: 'week' } }), (e) => e.code === 'bad_billing');
  const out = await B.createCheckout(deps, { company: c, email: 'o@a.test', origin: 'x', source: 'operator', kind: 'custom', custom: { recurringCents: 50000, interval: 'month', setupCents: 100000 } });
  assert.equal(out.amounts.recurringCents, 50000);
  const cs = calls.stripe.find((x) => x.path === '/checkout/sessions');
  assert.equal(cs.params.line_items.length, 2);
  assert.ok(cs.params.expires_at - 1_800_000_000 >= 22 * 3600, 'operator links last most of a day');
});

/* ---------- events ---------- */

const SUB = { id: 'sub_1', customer: 'cus_known', status: 'active', current_period_end: 1_802_000_000, cancel_at_period_end: false, metadata: { tenant_id: TENANT, plan_id: 'builder', billing: 'monthly' } };

test('a completed checkout syncs the subscription and tells the owner and VYNTEX once, even when Stripe repeats it', async () => {
  const ev = { id: 'evt_a', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', amount_total: 61800, currency: 'usd', payment_status: 'paid', metadata: { tenant_id: TENANT, plan_id: 'builder', billing: 'monthly', source: 'owner' } } } };
  const { deps, calls } = world({ subs: { sub_1: SUB }, events: { evt_a: ev } });
  await B.handleEvent(deps, 'evt_a');
  await B.handleEvent(deps, 'evt_a');
  const sync = calls.rpc.filter((c) => c.fn === 'billing_sync');
  assert.equal(sync.length, 2, 'state is synced each time (safe)');
  assert.equal(sync[0].args.p_status, 'active');
  assert.equal(sync[0].args.p_plan, 'builder');
  assert.equal(calls.mail.length, 2, 'one email to the owner, one to VYNTEX, never repeated');
  assert.deepEqual(calls.mail.map((m) => m.to[0]).sort(), ['info@vyntexusa.com', 'owner@acme.test']);
  assert.match(calls.mail.find((m) => m.to[0] === 'owner@acme.test').text, /\$618\.00/);
});

test('a failed payment starts the grace period and warns both sides', async () => {
  const ev = { id: 'evt_f', type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1', customer: 'cus_known', amount_due: 11900, currency: 'usd', attempt_count: 1 } } };
  const { deps, calls } = world({ subs: { sub_1: { ...SUB, status: 'past_due' } }, events: { evt_f: ev }, rpcData: { sync: { before: 'active', after: 'past_due', grace_until: '2027-01-08T00:00:00Z' } } });
  await B.handleEvent(deps, 'evt_f');
  assert.equal(calls.rpc.find((c) => c.fn === 'billing_sync').args.p_status, 'past_due');
  assert.equal(calls.mail.length, 2);
  assert.match(calls.mail[0].subject, /did not go through/);
});

test('a renewal payment records the invoice and sends VYNTEX a note, not the client', async () => {
  const ev = { id: 'evt_p', type: 'invoice.paid', data: { object: { id: 'in_2', subscription: 'sub_1', customer: 'cus_known', amount_paid: 11900, currency: 'usd', billing_reason: 'subscription_cycle' } } };
  const { deps, calls } = world({ subs: { sub_1: SUB }, events: { evt_p: ev } });
  await B.handleEvent(deps, 'evt_p');
  assert.ok(calls.rpc.some((c) => c.fn === 'billing_paid'));
  assert.deepEqual(calls.mail.map((m) => m.to[0]), ['info@vyntexusa.com']);
});

test('a dispute is matched to the company through its charge', async () => {
  const ev = { id: 'evt_d', type: 'charge.dispute.created', data: { object: { id: 'dp_1', charge: 'ch_1', amount: 11900, currency: 'usd', status: 'needs_response' } } };
  const { deps, calls } = world({ events: { evt_d: ev }, charges: { ch_1: { id: 'ch_1', customer: 'cus_known' } } });
  await B.handleEvent(deps, 'evt_d');
  assert.equal(calls.rpc.find((c) => c.fn === 'billing_event_add').args.p_tenant, TENANT);
  assert.match(calls.mail[0].subject, /disputed/);
});

test('an event about a company we do not know changes nothing', async () => {
  const ev = { id: 'evt_u', type: 'customer.subscription.updated', data: { object: { id: 'sub_x' } } };
  const { deps, calls } = world({ subs: { sub_x: { id: 'sub_x', customer: 'cus_other', status: 'active', metadata: {} } }, events: { evt_u: ev } });
  const r = await B.handleEvent(deps, 'evt_u');
  assert.equal(r.ignored, true);
  assert.equal(calls.rpc.filter((c) => c.fn === 'billing_sync').length, 0);
  assert.equal(calls.mail.length, 0);
});

/* ---------- the daily run ---------- */

test('the daily run pauses companies past their grace period and sends each reminder once', async () => {
  const { deps, calls } = world({ rpcData: { billing_enforce_grace: [{ tenant_id: TENANT }], billing_notices_due: [{ tenant_id: TENANT, kind: 'trial_3d', period: '2027-01-01', at: '2027-01-04T00:00:00Z' }] } });
  const r = await B.daily(deps);
  assert.equal(r.paused, 1);
  assert.equal(r.sent, 1);
  assert.equal(calls.mail.length, 3, 'paused: owner + VYNTEX, trial reminder: owner');
});

/* ---------- emails ---------- */

test('every owner email is bilingual, uses the official phone only, and has no long dashes', () => {
  for (const kind of ['subscribed', 'payment_failed', 'paused', 'ended', 'trial_3d', 'trial_1d', 'trial_ended']) {
    const m = billingEmail(kind, { audience: 'owner', company: company(), origin: 'https://erp.vyntexusa.com', total: 61800, amount: 11900, at: '2027-01-04T00:00:00Z' });
    assert.ok(m, kind);
    assert.match(m.text, /Hello,[\s\S]*Hola:/);
    assert.match(m.text, /609-780-3218/);
    assert.ok(!/609-813-0633/.test(m.text));
    assert.ok(!/[—–]/.test(m.text + m.subject), kind + ' has a long dash');
    assert.match(m.text, /https:\/\/erp\.vyntexusa\.com\/acme-build\/settings\/billing/);
  }
});
