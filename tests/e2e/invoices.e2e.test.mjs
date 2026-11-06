// Invoices in a real browser (src/features/invoices, 0086): the owner of the VYNTEX USA workspace opens Payments >
// Invoices, makes an invoice from a project with a line from scratch and the 2.9% service fee, saves and sends it; the
// email carries the pay link; the list shows it sent, then paid once Stripe's payment is recorded.
//
// PROVED AGAINST LOCAL STAND-INS ONLY (tests/e2e/stack.mjs). Stripe itself is not reached: the payment is recorded with
// the same database call the Stripe event makes.
//   node --test --test-concurrency=1 tests/e2e/invoices.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, shot } from './helpers.mjs';

const PW = 'Ledger-harbor-copper-58';
let st; let browser;
const open = [];
// a Stripe key of the test shape, so the pay link is offered (Stripe itself is never called in this test)
before(async () => { process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'z'.repeat(24); process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'y'.repeat(24); st = await startStack({ mail: true }); browser = await launch(); });
after(async () => { for (const p of open) await p.close().catch(() => undefined); await browser?.close(); await st?.stop(); });

test('the VYNTEX USA owner invoices a project, sends it with a pay link, and sees it paid', async () => {
  const hq = await st.vyntex.company({ industry: 'practice', name: 'VYNTEX USA Sample', slug: 'vyntex-invoice-sample', plan: 'internal' });
  await st.vyntex.sql(String.raw`with c as (insert into public.clients (tenant_id, name, email, lang) values ((select v from _in where k = 't')::uuid, 'Morgan Client', 'morgan@example.com', 'en') returning id)
    insert into public.jobs (tenant_id, number, name, client_id, type, status, price) select (select v from _in where k = 't')::uuid, 'P-1', 'Website build', c.id, 'other', 'progress', 3000 from c returning '@@R@@' || '1';`, { t: hq.tenantId });
  const p = await person(browser, st.vyntex.origin); open.push(p);
  await p.go(new URL(hq.inviteLink).pathname);
  await p.page.waitForSelector('[data-testid=auth-invite-form]');
  await p.page.fill('[data-testid=auth-invite-name]', 'Daysi Sample');
  await p.page.fill('[data-testid=auth-invite-password]', PW); await p.page.fill('[data-testid=auth-invite-again]', PW);
  await p.page.click('[data-testid=auth-submit]');
  await p.workspace();

  await p.page.click('[data-nav=payments]');
  await p.page.click('[data-testid=section-tabs] [data-tab=invoices]');
  await p.page.waitForSelector('[data-testid=invoices]');
  await p.page.click('[data-testid=inv-new]');
  await p.page.selectOption('[data-testid=inv-job]', { label: 'Website build · Morgan Client' });
  await p.page.waitForFunction(() => document.querySelector('[data-testid=inv-to]')?.value === 'morgan@example.com');
  await p.page.click('[data-testid=inv-add-line]');
  await p.page.fill('[data-testid=inv-line-text]', 'Deposit 50%');
  await p.page.fill('[data-testid=inv-line-price]', '1500');
  await p.page.getByLabel('Add the 2.9% card service fee').check();
  assert.equal(await p.page.innerText('[data-testid=inv-total]'), '$1,543.50');
  await shot(p, 'invoice-new');
  await p.page.click('[data-testid=inv-save-send]');
  await p.page.waitForSelector('[data-invoice="INV-0001"]');
  await p.page.waitForFunction(() => /Sent/.test(document.querySelector('[data-invoice="INV-0001"]')?.textContent || ''));
  const mail = st.vyntex.mails().find((m) => /Invoice INV-0001/.test(m.subject));
  assert.ok(mail, 'the invoice email');
  assert.match(mail.text, /\/api\/pay\/[0-9a-f]{48}/);
  assert.match(mail.text, /Service fee \(2\.9%\)  =  \$43\.50/);
  await shot(p, 'invoice-sent');

  // Stripe's payment, recorded the way the Stripe event records it
  await st.vyntex.sql(String.raw`select '@@R@@' || public.invoice_paid((select v from _in where k = 't')::uuid, (select id from public.invoices where tenant_id = (select v from _in where k = 't')::uuid and number = 'INV-0001'), 'cs_test_browser0001', 154350, now())::text;`, { t: hq.tenantId });
  await p.page.reload(); await p.workspace();
  await p.page.waitForFunction(() => /Paid/.test(document.querySelector('[data-invoice="INV-0001"]')?.textContent || ''), null, { timeout: 30000 });
  assert.deepEqual(p.errors, [], 'no errors in the browser console');
});
