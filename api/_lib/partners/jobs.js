// Partner Portal background work (VYNTEX ERP only):
//   partner.notify   every scheduled tick: sends the queued portal notifications (partner.notifications) through Resend.
//                    A notification is marked "sent" only with Resend's message id; a failure is retried up to 5 times.
//   partner.daily    once a day: expires offers past their validity, tells VYNTEX which orders need a follow-up,
//                    and on Mondays sends the weekly partner summary (counts only, no client names, no partner pay).
import { serviceRpc } from '../supabase.js';
import { sendSystemEmail, emailConfigured } from '../mail.js';
import { env, deployId } from '../env.js';
import { notificationEmail } from './emails.js';

const origin = () => (env('APP_ORIGIN') || 'https://erp.vyntexusa.com').replace(/\/+$/, '');
const absent = (r) => r.status === 404 || r.sqlstate === '42883' || r.sqlstate === 'PGRST202';

/** Sends what is queued. `send` and `rpc` are for tests. Returns { sent, failed, skipped }. */
export async function drainOutbox({ rpc = serviceRpc, send = sendSystemEmail, configured = emailConfigured, base = origin() } = {}) {
  const out = { sent: 0, failed: 0, skipped: 0 };
  const c = await rpc('partner_outbox_claim', { p_limit: 50 });
  if (!c.ok) { if (absent(c)) return out; throw Object.assign(new Error('outbox_unavailable'), { code: 'outbox_unavailable' }); }
  for (const n of Array.isArray(c.data) ? c.data : []) {
    const to = (Array.isArray(n.to) ? n.to : []).filter((x) => typeof x === 'string' && x.includes('@'));
    const mail = notificationEmail(n, base);
    if (!mail || !to.length) { await rpc('partner_outbox_mark', { p_id: n.id, p_status: 'skipped', p_error: !mail ? 'no_template' : 'no_recipient' }); out.skipped += 1; continue; }
    if (!configured()) { await rpc('partner_outbox_mark', { p_id: n.id, p_status: 'failed', p_error: 'email_not_configured' }); out.failed += 1; continue; }
    const r = await send({ to, subject: mail.subject, text: mail.text, idem: 'partner-note:' + n.id });
    if (r.delivered) { await rpc('partner_outbox_mark', { p_id: n.id, p_status: 'sent', p_provider_id: String(r.id || '') }); out.sent += 1; }
    else { await rpc('partner_outbox_mark', { p_id: n.id, p_status: 'failed', p_error: String(r.reason || 'send_failed') }); out.failed += 1; }
  }
  return out;
}

export async function partnerDaily({ rpc = serviceRpc, send = sendSystemEmail, now = new Date() } = {}) {
  const exp = await rpc('partner_offers_expire', {});
  if (!exp.ok && absent(exp)) return { skipped: true };
  const overdue = await rpc('partner_orders_overdue', {});
  const day = now.toISOString().slice(0, 10);
  const staff = await rpc('partner_summary', {});
  const list = overdue.ok && Array.isArray(overdue.data) ? overdue.data : [];
  const to = staffTo(staff.ok ? staff.data : null);
  if (list.length && to.length) {
    await send({ to, subject: `[VYNTEX Partners] ${list.length} order(s) need a follow-up`,
      text: [`${list.length} partner order(s) need a follow-up today:`, ...list.slice(0, 50).map((o) => `${o.ref}: ${o.status}${o.follow_up_at ? ', follow-up was due ' + o.follow_up_at : ''}`), '', `Open the Partner Portal: ${origin()}/partners/orders`, ''].join('\n'),
      idem: 'partner-overdue:' + day });
  }
  if (now.getUTCDay() === 1 && staff.ok && staff.data && to.length) {
    const s = staff.data;
    const usd = (c) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await send({ to, subject: '[VYNTEX Partners] Weekly summary',
      text: [`Offers waiting for approval: ${s.pending_offers}`, `New orders to review: ${s.new_orders}`, `Open orders: ${s.open_orders}`,
        `Commissions eligible, waiting for approval: ${usd(s.eligible_cents)}`, `Commissions approved, not yet in a payout: ${usd(s.approved_cents)}`,
        `Open payouts: ${s.open_payouts}`, '', `Open the Partner Portal: ${origin()}/partners`, ''].join('\n'),
      idem: 'partner-weekly:' + day });
  }
  return { expired: exp.ok ? exp.data : null, overdue: list.length };
}

/** Where VYNTEX's partner notices go: every active partner staff member (partner.staff), as the outbox does. */
export function staffTo(summary) {
  const list = summary && Array.isArray(summary.staff) ? summary.staff : [];
  return list.filter((x) => typeof x === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x)).slice(0, 20);
}

export function registerPartnerJobs({ register, hooks, JobError }) {
  register('partner.notify', async () => {
    try { await drainOutbox(); } catch { throw new JobError('outbox_unavailable'); }
  });
  register('partner.daily', async () => { await partnerDaily(); });
  hooks.tick.push(async ({ enqueue: q }) => {
    if (deployId() !== 'vyntex') return;
    await q('partner.notify', {}, { idem: 'partner-notify:' + Math.floor(Date.now() / 300000), maxAttempts: 3 });
  });
  hooks.daily.push(async ({ enqueue: q }) => {
    if (deployId() !== 'vyntex') return;
    await q('partner.daily', {}, { idem: 'partner-daily:' + new Date().toISOString().slice(0, 10), maxAttempts: 3 });
  });
}
