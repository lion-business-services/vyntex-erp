// The "Request a demo" endpoint (api/demo-request.js) and its FormSubmit notification, with every outside call answered
// from memory: FormSubmit, Resend and the database. Nothing is sent anywhere.
// Owner decision: every valid request notifies VYNTEX through FormSubmit; it counts as delivered when FormSubmit OR
// Resend accepted it; honeypot submissions never notify; FORMSUBMIT_ENABLED=false turns FormSubmit off.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from './helpers.mjs';

setTestEnv();
const { POST } = await import('../../api/demo-request.js');
const { formSubmitTarget } = await import('../../api/_lib/formsubmit.js');
const health = await import('../../api/health.js');

const SETTINGS = ['FORMSUBMIT_EMAIL', 'FORMSUBMIT_ENABLED', 'RESEND_API_KEY', 'DEMO_REQUEST_TO', 'DEMO_REQUEST_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const DB = 'https://db.example.test';
const VALID = {
  name: 'Sample Person', business: 'Sample Barbershop', industry: 'barber', phone: '555-555-0100', email: 'Person@Example.com',
  language: 'es', contactMethod: 'whatsapp', teamSize: '2-5', message: 'Two chairs.\nWalk-ins mostly.', consent: true,
};

let calls; let answers; let ip = 0;
const realFetch = globalThis.fetch;
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  for (const k of SETTINGS) delete process.env[k];
  process.env.VX_DEPLOY = 'vyntex';
  calls = [];
  answers = { formsubmit: () => reply(200, { success: 'true', message: 'The form was submitted successfully.' }), resend: () => reply(200, { id: 'email_1' }), db: () => new Response(null, { status: 201 }) };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
    if (u.startsWith('https://formsubmit.co/')) return answers.formsubmit();
    if (u === 'https://api.resend.com/emails') return answers.resend();
    if (u.startsWith(DB + '/rest/v1/')) return answers.db();
    throw new Error('a test tried to reach an outside address: ' + u.slice(0, 60));
  };
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of SETTINGS) delete process.env[k]; });

async function submit(body) {
  ip += 1;
  const res = await POST(new Request('https://erp.vyntexusa.com/api/demo-request', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `198.51.100.${ip}`, 'user-agent': 'test' }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}
const toFormSubmit = () => calls.filter((c) => c.url.startsWith('https://formsubmit.co/'));
const toResend = () => calls.filter((c) => c.url === 'https://api.resend.com/emails');
const toDb = () => calls.filter((c) => c.url.startsWith(DB));

test('every valid request notifies FormSubmit with the agreed payload, by default to info@vyntexusa.com', async () => {
  const r = await submit(VALID);
  assert.deepEqual(r, { status: 200, json: { ok: true, delivered: true } });
  const [call, ...more] = toFormSubmit();
  assert.equal(more.length, 0, 'one notification');
  assert.equal(call.url, 'https://formsubmit.co/ajax/info@vyntexusa.com');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.accept, 'application/json');
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.ok(call.init.signal, 'the call has a time limit');
  const b = call.body;
  assert.equal(b._subject, 'New VYNTEX ERP demo request: Sample Barbershop (barber)');
  assert.equal(b._template, 'table');
  assert.equal(b._captcha, 'false');
  assert.equal(b._replyto, 'person@example.com');
  assert.equal(b.Name, 'Sample Person'); assert.equal(b.Business, 'Sample Barbershop'); assert.equal(b.Industry, 'barber');
  assert.equal(b.Phone, '+15555550100'); assert.equal(b.Email, 'person@example.com');
  assert.equal(b['Preferred language'], 'Spanish'); assert.equal(b['Contact by'], 'whatsapp'); assert.equal(b['Team size'], '2-5');
  assert.equal(b.Message, 'Two chairs.\nWalk-ins mostly.');
  assert.match(b.Consent, /I agree to be contacted by VYNTEX USA/);
  assert.equal(toResend().length, 0, 'Resend is not configured');
});

test('FORMSUBMIT_EMAIL picks the inbox; anything that is not a plain address falls back to the default', async () => {
  process.env.FORMSUBMIT_EMAIL = 'Sales@VyntexUSA.com';
  await submit(VALID);
  assert.equal(toFormSubmit()[0].url, 'https://formsubmit.co/ajax/sales@vyntexusa.com');
  assert.equal(formSubmitTarget({ FORMSUBMIT_EMAIL: '../../evil?x=@a.com' }), 'info@vyntexusa.com');
  assert.equal(formSubmitTarget({ FORMSUBMIT_ENABLED: 'false' }), '');
  assert.equal(formSubmitTarget({ VX_DEPLOY: 'lbs' }), '', 'the LBS deployment has no sales pages');
  assert.equal(formSubmitTarget({ VX_DEPLOY: 'lbs', FORMSUBMIT_ENABLED: 'true' }), 'info@vyntexusa.com');
});

test('delivered when only FormSubmit works (Resend fails), and the database copy says so', async () => {
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_123456', DEMO_REQUEST_TO: 'team@example.com', DEMO_REQUEST_FROM: 'VYNTEX <demo@mail.example.com>', SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' });
  answers.resend = () => reply(500, { message: 'internal' });
  const r = await submit(VALID);
  assert.deepEqual(r, { status: 200, json: { ok: true, delivered: true } });
  assert.equal(toResend().length, 1, 'Resend was tried');
  assert.equal(toFormSubmit().length, 1, 'FormSubmit was called too');
  const [row] = toDb();
  assert.equal(row.url, DB + '/rest/v1/demo_requests');
  assert.equal(row.body.email_delivered, true);
  assert.equal(row.body.business, 'Sample Barbershop');
});

test('delivered when only Resend works (FormSubmit says success "false"); failed when neither works, still stored', async () => {
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_123456', DEMO_REQUEST_TO: 'team@example.com', DEMO_REQUEST_FROM: 'VYNTEX <demo@mail.example.com>', SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' });
  answers.formsubmit = () => reply(200, { success: 'false', message: 'This form needs Activation.' });
  assert.deepEqual(await submit(VALID), { status: 200, json: { ok: true, delivered: true } });
  assert.equal(toDb()[0].body.email_delivered, true);

  calls = [];
  answers.resend = () => reply(500, { message: 'internal' });
  answers.formsubmit = () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await submit(VALID), { status: 502, json: { ok: false, error: 'delivery_failed' } });
  assert.equal(toDb().length, 1, 'the request is kept in the database');
  assert.equal(toDb()[0].body.email_delivered, false);
});

test('a FormSubmit answer that is not JSON, or not a 2xx, does not count as delivered', async () => {
  answers.formsubmit = () => new Response('<html>busy</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  assert.equal((await submit(VALID)).status, 502);
  answers.formsubmit = () => reply(500, { success: 'true' });
  assert.equal((await submit(VALID)).status, 502);
});

test('honeypot submissions never notify anyone and are never stored', async () => {
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_123456', DEMO_REQUEST_TO: 'team@example.com', DEMO_REQUEST_FROM: 'VYNTEX <demo@mail.example.com>', SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' });
  const r = await submit({ ...VALID, website: 'https://spam.example.com' });
  assert.deepEqual(r, { status: 200, json: { ok: true, delivered: false, reason: 'filtered' } });
  assert.equal(calls.length, 0, 'no FormSubmit, no Resend, no database');
});

test('invalid requests never notify', async () => {
  const r = await submit({ ...VALID, email: 'not-an-address' });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test('FORMSUBMIT_ENABLED=false skips FormSubmit: Resend alone, or not_configured when Resend is not set either', async () => {
  process.env.FORMSUBMIT_ENABLED = 'false';
  assert.deepEqual(await submit(VALID), { status: 200, json: { ok: true, delivered: false, reason: 'not_configured' } });
  assert.equal(calls.length, 0);
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_123456', DEMO_REQUEST_TO: 'team@example.com', DEMO_REQUEST_FROM: 'VYNTEX <demo@mail.example.com>' });
  assert.deepEqual(await submit(VALID), { status: 200, json: { ok: true, delivered: true } });
  assert.equal(toFormSubmit().length, 0, 'FormSubmit stays off');
  assert.equal(toResend().length, 1);
});

test('with no notification channel at all the request is still kept in the database, marked not delivered', async () => {
  Object.assign(process.env, { FORMSUBMIT_ENABLED: 'false', SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests' });
  assert.deepEqual(await submit(VALID), { status: 200, json: { ok: true, delivered: false, reason: 'not_configured' } });
  assert.equal(toFormSubmit().length + toResend().length, 0);
  assert.equal(toDb().length, 1);
  assert.equal(toDb()[0].body.email_delivered, false);
});

test('health reports the demo request notification as configured while FormSubmit is on', async () => {
  const on = await (await health.GET(new Request('https://erp.vyntexusa.com/api/health'))).json();
  assert.equal(on.configured.demoRequestEmail, true);
  process.env.FORMSUBMIT_ENABLED = 'false';
  const off = await (await health.GET(new Request('https://erp.vyntexusa.com/api/health'))).json();
  assert.equal(off.configured.demoRequestEmail, false);
  assert.ok(!JSON.stringify(on).includes('info@vyntexusa.com'), 'the inbox is never shown');
});
