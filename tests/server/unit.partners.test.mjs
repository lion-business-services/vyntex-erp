// Unit tests of the Partner Portal server pieces that need no database: the emails, the outbox sender, the daily run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from './helpers.mjs';

setTestEnv();
const { partnerInviteEmail, proposalEmail, notificationEmail } = await import('../../api/_lib/partners/emails.js');
const { drainOutbox, partnerDaily, staffTo } = await import('../../api/_lib/partners/jobs.js');

const DASH = /—/;

test('invitation and proposal emails: English and Spanish (usted), no em dash, only this site and the official phone', () => {
  for (const lang of ['en', 'es']) {
    const i = partnerInviteEmail({ lang, partner: 'Atlas', link: 'https://erp.vyntexusa.com/partners/invite/abc', hours: 72 });
    const p = proposalEmail({ lang, client: 'Harbor', link: 'https://erp.vyntexusa.com/proposal/xyz', expiresAt: '2026-11-01T00:00:00Z', ref: 'OF-2026-00001' });
    for (const m of [i, p]) {
      assert.doesNotMatch(m.subject + m.text, DASH);
      assert.match(m.text, /609-780-3218/);
      assert.doesNotMatch(m.text, /609-813-0633/);
      assert.deepEqual([...m.text.matchAll(/https?:\/\/[^\s]+/g)].map((x) => new URL(x[0]).host), ['erp.vyntexusa.com']);
    }
  }
  assert.match(partnerInviteEmail({ lang: 'es', partner: 'A', link: 'x', hours: 72 }).text, /Abra este enlace/);
  assert.match(proposalEmail({ lang: 'es', client: 'C', link: 'x', expiresAt: null, ref: 'R' }).subject, /Su propuesta/);
});

test('notification emails never carry partner pay, and unknown kinds send nothing', () => {
  const n = notificationEmail({ kind: 'commission.recorded', audience: 'partner', lang: 'en', payload: { ref: 'OR-1', client: 'Harbor', count: 2, amount_cents: 123456 } }, 'https://erp.vyntexusa.com');
  assert.doesNotMatch(n.text, /1,234|1234|\$/);
  assert.equal(notificationEmail({ kind: 'something.else', audience: 'partner', payload: {} }, 'x'), null);
  const s = notificationEmail({ kind: 'order.submitted', audience: 'staff', payload: { ref: 'OR-1', client: 'Harbor', conflict: true } }, 'https://erp.vyntexusa.com');
  assert.match(s.text, /Attribution conflict/);
  const es = notificationEmail({ kind: 'offer.approved', audience: 'partner', lang: 'es', payload: { ref: 'OF-1', client: 'Harbor' } }, 'https://erp.vyntexusa.com');
  assert.match(es.text, /VYNTEX aprobó la oferta OF-1/);
});

test('the outbox: sent only with the provider id; failures and missing setup are retried, not reported as sent', async () => {
  const marks = [];
  const rows = [
    { id: 1, kind: 'order.submitted', audience: 'staff', payload: { ref: 'OR-1', client: 'A' }, to: ['ops@vyntex.example'] },
    { id: 2, kind: 'offer.approved', audience: 'partner', lang: 'es', payload: { ref: 'OF-1', client: 'B' }, to: ['p@partner.example'] },
    { id: 3, kind: 'nothing.known', audience: 'partner', payload: {}, to: ['p@partner.example'] },
    { id: 4, kind: 'offer.viewed', audience: 'partner', payload: {}, to: [] },
  ];
  const rpc = async (fn, args) => { if (fn === 'partner_outbox_claim') return { ok: true, data: rows }; marks.push([fn, args]); return { ok: true, data: null }; };
  let calls = 0;
  const send = async () => { calls += 1; return calls === 1 ? { delivered: true, id: 'email_abc' } : { delivered: false, reason: 'http_500' }; };
  const out = await drainOutbox({ rpc, send, configured: () => true, base: 'https://erp.vyntexusa.com' });
  assert.deepEqual(out, { sent: 1, failed: 1, skipped: 2 });
  assert.deepEqual(marks.map(([, a]) => [a.p_id, a.p_status]), [[1, 'sent'], [2, 'failed'], [3, 'skipped'], [4, 'skipped']]);
  assert.equal(marks[0][1].p_provider_id, 'email_abc');
  const off = await drainOutbox({ rpc: async (fn, a) => (fn === 'partner_outbox_claim' ? { ok: true, data: rows.slice(0, 1) } : (marks.push([fn, a]), { ok: true })), send, configured: () => false });
  assert.deepEqual(off, { sent: 0, failed: 1, skipped: 0 }, 'email not set up: nothing is pretended');
});

test('the daily run: expires offers, lists overdue orders to staff only, weekly summary on Mondays with counts and no names', async () => {
  const sent = [];
  const data = { partner_offers_expire: 2, partner_orders_overdue: [{ ref: 'OR-9', status: 'submitted', client: 'Secret Client' }],
    partner_summary: { pending_offers: 1, new_orders: 2, open_orders: 3, eligible_cents: 1000, approved_cents: 0, open_payouts: 0, staff: ['a@vyntex.example', 'bad', 'b@vyntex.example'] } };
  const rpc = async (fn) => ({ ok: true, data: data[fn] });
  const out = await partnerDaily({ rpc, send: async (m) => { sent.push(m); return { delivered: true }; }, now: new Date('2026-10-26T12:00:00Z') });
  assert.deepEqual(out, { expired: 2, overdue: 1 });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].to, ['a@vyntex.example', 'b@vyntex.example']);
  for (const m of sent) assert.doesNotMatch(m.text, /Secret Client/);
  assert.deepEqual(staffTo(null), []);
});
