// Invoices (0086): sending, the pay link, the Stripe payment, the reminders.
//   send       an office operation (api/_lib/public/office.js, `invoice_send`): the person's own rights are checked by the
//              database (invoice_send_check), the email goes out, then the invoice is marked sent. A new pay link token is
//              made at each send; only its keyed hash is stored, so an older email's link stops working
//   pay        GET /api/pay/<token> (vercel.json, through api/public.js): each click opens a fresh Stripe Checkout page for
//              what is still owed, on VYNTEX's own Stripe account (VYNTEX USA's workspace only). The page is Stripe's:
//              no card field exists on this platform
//   paid       Stripe's checkout.session.completed / async_payment_succeeded, read back from Stripe (billing/core.js):
//              the payment is recorded once (client_payments, by the session) and the invoice marked paid
//   reminders  the daily pass: 3 days before the due date, on it, then 7 and 14 days after
import { randomBytes } from 'node:crypto';
import { keyHash } from './ratelimit.js';
import { serviceRpc, userRpc } from './supabase.js';
import { sendSystemEmail } from './mail.js';
import { stripe, stripeConfigured } from './billing/stripe.js';
import { appOrigin, env } from './env.js';
import { log } from './respond.js';

export const PAY_TOKEN = /^[0-9a-f]{48}$/;
export const payTokenHash = (token) => keyHash('invoice-pay', token);
export const newPayToken = () => { const token = randomBytes(24).toString('hex'); return { token, hash: payTokenHash(token) }; };
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/;

const usd = (cents, lang) => new Intl.NumberFormat(lang === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
const day = (iso, lang) => new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The invoice email, in the invoice's language. Plain text, no dashes used as punctuation. */
export function invoiceEmail(inv, { link, reminder = false, company }) {
  const es = inv.lang === 'es';
  const name = company?.name || inv.companyName || 'VYNTEX USA';
  const balance = Number(inv.totalCents) - Number(inv.paidCents || 0);
  const late = reminder && String(inv.dueDate) < new Date().toISOString().slice(0, 10);
  const subject = es
    ? `${reminder ? (late ? 'Factura vencida' : 'Recordatorio de factura') : 'Factura'} ${inv.number} de ${name}`
    : `${reminder ? (late ? 'Past due invoice' : 'Invoice reminder') : 'Invoice'} ${inv.number} from ${name}`;
  const lines = (inv.lines || []).map((l) => `  ${l.text}  ${Number(l.qty)} x ${usd(l.unitCents, inv.lang)}  =  ${usd(Math.round(Number(l.qty) * Number(l.unitCents)), inv.lang)}`);
  const fee = Number(inv.feeCents) > 0 ? [`  ${es ? 'Cargo por servicio' : 'Service fee'} (${Number(inv.feePct)}%)  =  ${usd(inv.feeCents, inv.lang)}`] : [];
  const text = [
    es ? `Hola${inv.client ? ', ' + inv.client : ''}:` : `Hello${inv.client ? ' ' + inv.client : ''},`,
    '',
    reminder
      ? (es ? (late ? `La factura ${inv.number} venció el ${day(inv.dueDate, 'es')}. Le agradecemos realizar el pago a la brevedad.` : `Le recordamos que la factura ${inv.number} vence el ${day(inv.dueDate, 'es')}.`)
            : (late ? `Invoice ${inv.number} was due on ${day(inv.dueDate, 'en')}. Please make the payment at your earliest convenience.` : `This is a friendly reminder that invoice ${inv.number} is due on ${day(inv.dueDate, 'en')}.`))
      : (es ? `A continuación encontrará los detalles de la factura ${inv.number}${inv.project ? ' del proyecto ' + inv.project : ''}.` : `Here are the details of invoice ${inv.number}${inv.project ? ' for ' + inv.project : ''}.`),
    '',
    ...lines, ...fee,
    `  ${es ? 'Total' : 'Total'}  =  ${usd(inv.totalCents, inv.lang)}`,
    ...(Number(inv.paidCents) > 0 ? [`  ${es ? 'Pagado' : 'Paid'}  =  ${usd(inv.paidCents, inv.lang)}`] : []),
    `  ${es ? 'Saldo' : 'Balance due'}  =  ${usd(balance, inv.lang)}`,
    `  ${es ? 'Vence' : 'Due'}: ${day(inv.dueDate, inv.lang)}`,
    '',
    ...(link ? [es ? 'Pague en línea de forma segura:' : 'Pay online securely:', link, ''] : []),
    ...(inv.notes ? [inv.notes, ''] : []),
    es ? 'Gracias,' : 'Thank you,',
    name,
  ].join('\n');
  return { subject, text };
}

export function paidEmail({ lang, number, companyName, cents, balanceCents }) {
  const es = lang === 'es';
  return {
    subject: es ? `Pago recibido: factura ${number}` : `Payment received: invoice ${number}`,
    text: [es ? 'Hola:' : 'Hello,', '',
      es ? `Recibimos su pago de ${usd(cents, 'es')} para la factura ${number}.` : `We received your payment of ${usd(cents, 'en')} for invoice ${number}.`,
      Number(balanceCents) > 0 ? (es ? `Saldo pendiente: ${usd(balanceCents, 'es')}.` : `Remaining balance: ${usd(balanceCents, 'en')}.`) : (es ? 'La factura está pagada por completo.' : 'The invoice is paid in full.'),
      '', es ? 'Gracias,' : 'Thank you,', companyName || 'VYNTEX USA'].join('\n'),
  };
}

const origin = (request) => (request ? appOrigin(request) : (env('APP_ORIGIN') || 'https://erp.vyntexusa.com')).replace(/\/+$/, '');

/** Sends (or reminds about) one invoice. `inv` comes from invoice_send_check or invoice_for_server. */
async function deliver(inv, { to, reminder, request, tenant }) {
  const online = !!inv.online && stripeConfigured();
  const t = online ? newPayToken() : null;
  const link = t ? `${origin(request)}/api/pay/${t.token}` : null;
  const mail = invoiceEmail(inv, { link, reminder, company: inv.company });
  const sent = await sendSystemEmail({ to: [to], subject: mail.subject, text: mail.text, tenant, idem: `invoice:${inv.id}:${reminder ? 'r' + (Number(inv.reminders) + 1) : 's' + Date.now()}` });
  if (!sent.delivered) return { ok: false, reason: sent.reason || 'send_failed' };
  const marked = await serviceRpc('invoice_mark_sent', { p_tenant: tenant, p_id: inv.id, p_to: to, p_token_hash: t ? t.hash : null, p_reminder: !!reminder });
  if (!marked.ok || marked.data !== true) return { ok: false, reason: 'not_saved' };
  return { ok: true, online };
}

/** The office operation `invoice_send` ({ p_id, p_to? }): answers { status, result } or { status, error }, or throws the database's refusal. */
export async function invoiceSend({ session, tenant, args, request }, upstreamError) {
  if (!/^[0-9a-f-]{36}$/i.test(String(args.p_id || ''))) return { status: 400, error: 'invalid_args' };
  const chk = await userRpc(session.at, 'invoice_send_check', { p_tenant: tenant, p_id: args.p_id });
  if (!chk.ok) throw upstreamError(chk);
  const inv = chk.data;
  if (!inv) return { status: 404, error: 'not_found' };
  const to = String(args.p_to || inv.sendTo || inv.clientEmail || '').trim().toLowerCase();
  if (!EMAIL.test(to)) return { status: 400, error: 'no_email' };
  const r = await deliver(inv, { to, reminder: inv.status === 'sent', request, tenant });
  return r.ok ? { status: 200, result: { sent: true, to, online: r.online } } : { status: 502, error: r.reason };
}

/** The daily pass. */
export async function invoiceReminders() {
  const due = await serviceRpc('invoice_reminders_due', {});
  let sent = 0;
  for (const d of due.ok ? due.data || [] : []) {
    const inv = await serviceRpc('invoice_for_server', { p_tenant: d.tenantId, p_id: d.id });
    if (!inv.ok || !inv.data) continue;
    const r = await deliver(inv.data, { to: inv.data.sendTo, reminder: true, request: null, tenant: d.tenantId });
    if (r.ok) sent += 1; else log('invoices', 'reminder_failed', { reason: r.reason });
  }
  return { reminders: sent };
}

const page = (status, lang, title, body) => new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05070b;color:#e8edf3;font:16px/1.5 system-ui,sans-serif}
main{max-width:440px;margin:24px;padding:28px;border:1px solid #1d2a38;border-radius:14px;background:#0b111a}h1{font-size:20px;margin:0 0 8px}p{color:#a3a6ae;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });

/** GET /api/pay/<token> and /api/pay/done */
export async function payRoute(request, action, more) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  const lang = /^es\b/i.test(request.headers.get('accept-language') || '') ? 'es' : 'en';
  if (action === 'done') {
    return page(200, lang, lang === 'es' ? 'Gracias por su pago' : 'Thank you for your payment', lang === 'es' ? 'Recibirá una confirmación por correo en unos minutos.' : 'You will receive a confirmation by email in a few minutes.');
  }
  const gone = () => page(410, lang, lang === 'es' ? 'Este enlace ya no está activo' : 'This link is no longer active', lang === 'es' ? 'La factura ya está pagada o fue reemplazada. Revise el correo más reciente o comuníquese con nosotros.' : 'The invoice is already paid or was replaced. Check the most recent email or contact us.');
  if (more !== undefined || !PAY_TOKEN.test(String(action || ''))) return gone();
  const hash = payTokenHash(action);
  const r = await serviceRpc('invoice_by_token', { p_token_hash: hash });
  const inv = r.ok ? r.data : null;
  if (!inv) return gone();
  if (!inv.online || !stripeConfigured()) return page(200, inv.lang, inv.lang === 'es' ? 'Pago en línea no disponible' : 'Online payment is not available', inv.lang === 'es' ? 'Siga las instrucciones de pago de la factura.' : 'Please follow the payment instructions on the invoice.');
  const o = origin(request);
  // one Checkout page per invoice, balance and ten minutes: a double click opens the same page, never a second charge
  const bucket = Math.floor(Date.now() / 600000);
  try {
    const s = await stripe('POST', '/checkout/sessions', {
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: inv.balanceCents, product_data: { name: `${inv.lang === 'es' ? 'Factura' : 'Invoice'} ${inv.number} · ${inv.companyName}`, metadata: { vx: 'erp-invoice' } } } }],
      customer_email: inv.sendTo || undefined,
      locale: inv.lang === 'es' ? 'es' : 'en',
      metadata: { vx: 'erp-invoice', tenant_id: inv.tenantId, invoice_id: inv.id, number: inv.number },
      payment_intent_data: { metadata: { vx: 'erp-invoice', tenant_id: inv.tenantId, invoice_id: inv.id, number: inv.number }, description: `${inv.companyName} invoice ${inv.number}` },
      success_url: `${o}/api/pay/done`,
      cancel_url: `${o}/api/pay/${action}`,
    }, { idem: `invoice-pay:${inv.id}:${inv.balanceCents}:${bucket}` });
    if (!s || typeof s.url !== 'string' || !s.url.startsWith('https://checkout.stripe.com/')) throw new Error('no_url');
    return new Response(null, { status: 303, headers: { location: s.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  } catch (e) {
    log('invoices', 'checkout_failed', { code: e && e.code ? String(e.code).slice(0, 40) : 'error' });
    return page(503, inv.lang, inv.lang === 'es' ? 'Inténtelo de nuevo en un momento' : 'Please try again in a moment', inv.lang === 'es' ? 'No se pudo abrir la página de pago.' : 'The payment page could not be opened.');
  }
}

/** Stripe's Checkout session for an invoice, read back from Stripe by billing/core.js handleEvent. */
export async function invoiceSessionPaid(deps, obj) {
  const m = obj.metadata || {};
  if (obj.payment_status !== 'paid') return { ignored: true, reason: 'not_paid' };
  if (!/^[0-9a-f-]{36}$/i.test(String(m.tenant_id || '')) || !/^[0-9a-f-]{36}$/i.test(String(m.invoice_id || ''))) return { ignored: true, reason: 'no_invoice' };
  if (String(obj.currency || 'usd').toLowerCase() !== 'usd') return { ignored: true, reason: 'currency' };
  const r = await deps.rpc('invoice_paid', { p_tenant: m.tenant_id, p_id: m.invoice_id, p_session: obj.id, p_cents: Number(obj.amount_total), p_paid_at: new Date((Number(obj.created) || Date.now() / 1000) * 1000).toISOString() });
  if (!r.ok) throw Object.assign(new Error('invoice_record_failed'), { status: 503 });
  const d = r.data || {};
  if (d.recorded && d.sendTo) {
    const mail = paidEmail({ lang: d.lang, number: d.number, companyName: d.companyName, cents: obj.amount_total, balanceCents: d.balanceCents });
    await deps.mail({ to: [d.sendTo], subject: mail.subject, text: mail.text, tenant: m.tenant_id, idem: `invoice-paid:${obj.id}` });
  }
  return { invoice: d };
}
