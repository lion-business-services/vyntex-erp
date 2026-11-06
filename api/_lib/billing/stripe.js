// A small Stripe client for VYNTEX's own billing (subscriptions of client companies to VYNTEX ERP).
// No SDK: Stripe's REST API with form-encoded bodies, a pinned API version, idempotency keys on every write, a time
// limit, and errors that carry Stripe's short code only (never a key, never a full response).
//
// Settings (api/_lib/env.js): STRIPE_SECRET_KEY (sk_live_..., sk_test_... or a restricted rk_ key), STRIPE_WEBHOOK_SECRET
// (whsec_...). Nothing here is ever sent to a browser.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

export const API_VERSION = '2024-06-20';
const BASE = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(code, status = 0, type = '') { super(code); this.code = code; this.status = status; this.type = type; }
}

export const stripeConfigured = () => /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(env('STRIPE_SECRET_KEY'));
export const webhookConfigured = () => /^whsec_[A-Za-z0-9+/=]{10,}$/.test(env('STRIPE_WEBHOOK_SECRET'));
/** "test" or "live", from the key itself, so the screens can say which one is in use. */
export const stripeMode = () => (/_test_/.test(env('STRIPE_SECRET_KEY')) ? 'test' : 'live');

/** Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0]=v / a[0][k]=v. Undefined and null are left out. */
export function encodeForm(params, prefix = '', out = []) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encodeForm(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      encodeForm(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))}`);
    }
  }
  return out.join('&');
}

/**
 * One call to Stripe. `idem` is required for writes: a retried request with the same key is answered with the first
 * result by Stripe itself. `fetchFn` is for tests.
 */
export async function stripe(method, path, params = {}, { idem = null, fetchFn = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!stripeConfigured()) throw new StripeError('not_configured');
  if (method !== 'GET' && !idem) throw new StripeError('idempotency_key_required');
  const body = encodeForm(params);
  const url = method === 'GET' && body ? `${BASE}${path}?${body}` : `${BASE}${path}`;
  const headers = {
    authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'),
    'stripe-version': API_VERSION,
    accept: 'application/json',
  };
  if (method !== 'GET') { headers['content-type'] = 'application/x-www-form-urlencoded'; headers['idempotency-key'] = String(idem).slice(0, 255); }
  let res;
  try {
    res = await fetchFn(url, { method, headers, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new StripeError('stripe_unreachable', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    const code = /^[a-z0-9_]{1,60}$/.test(String(e.code || '')) ? e.code : /^[a-z_]{1,40}$/.test(String(e.type || '')) ? e.type : 'stripe_error';
    throw new StripeError(code, res.status, String(e.type || ''));
  }
  return data;
}

/**
 * Checks the Stripe-Signature header against the raw body (https://docs.stripe.com/webhooks#verify-manually):
 * t=<seconds>,v1=<hex hmac-sha256 of "t.body">. A time stamp older or newer than `toleranceSeconds` is refused.
 * Returns { ok: true, event } or { ok: false, reason }.
 */
export function verifySignature(rawBody, header, secret, { now = Date.now(), toleranceSeconds = 300 } = {}) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (typeof header !== 'string' || header.length > 4096) return { ok: false, reason: 'bad_signature' };
  let t = null; const v1 = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || !v1.length) return { ok: false, reason: 'bad_signature' };
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return { ok: false, reason: 'stale' };
  const text = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${text}`, 'utf8').digest('hex'), 'utf8');
  const match = v1.some((s) => { const b = Buffer.from(s, 'utf8'); return b.length === expected.length && timingSafeEqual(b, expected); });
  if (!match) return { ok: false, reason: 'bad_signature' };
  let event;
  try { event = JSON.parse(text); } catch { return { ok: false, reason: 'bad_request' }; }
  if (!event || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9]{6,80}$/.test(event.id) || typeof event.type !== 'string') return { ok: false, reason: 'bad_request' };
  return { ok: true, event };
}
