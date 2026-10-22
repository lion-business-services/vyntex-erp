# Billing: VYNTEX ERP subscriptions through Stripe

How a client company pays VYNTEX for its VYNTEX ERP plan, and how free trials are given.

## What the client sees

* **Settings, Billing** (owners and managers see it; only the owner pays). The plans of the company's edition, with
  monthly or yearly billing, the one-time setup fee and the first payment total, all read from
  `config/vyntex-build-pricing.json` through `src/lib/pricing.ts`. "Pay" opens Stripe Checkout. After paying, the page
  waits for Stripe's confirmation and shows the plan as active.
* **Manage billing** opens Stripe's customer portal: invoices, card or bank account, billing address, cancellation at
  the end of the period.
* A company paused for non-payment, or whose trial ended, can still sign in as far as the "paused" screen, which shows
  the same billing panel, so the owner can pay without help.
* Payment methods: card (Apple Pay and Google Pay come with it) and US bank account (ACH). Klarna, Afterpay and Affirm
  are off. No 2.9% service fee line. Stripe Tax is off until Daysi confirms the tax setup.

## What VYNTEX sees (operator console, /admin)

* A **Billing** column per company: trial days left, active, payment failed with the grace date, ended, and the total
  received. A "Paying by Stripe" count.
* **New client workspace, plan "7-day trial"**: the only way a trial exists. One trial per owner email, ever. The clock
  starts when the owner accepts the invitation.
* **Payment link**: makes a Stripe Checkout link valid 23 hours and emails it to the owner (English and Spanish). For
  priced editions choose plan and monthly or yearly; for quoted editions (professional services) type the agreed
  amounts.

## Automations

| When | What happens |
| --- | --- |
| Checkout paid | Subscription recorded, trial ended, plan set, company open. Welcome email to the owner, notice to VYNTEX. |
| Renewal paid | Invoice recorded, grace cleared. Notice to VYNTEX (the client gets Stripe's receipt). |
| Payment failed | 7-day grace period starts. Email to the owner and VYNTEX. Stripe retries by itself. |
| Grace period over | Company paused (records kept). Email to the owner and VYNTEX. Paying reopens it immediately. |
| Subscription ended or paused at Stripe | Company paused. Email to the owner and VYNTEX. |
| Refund or dispute | Recorded. Notice to VYNTEX. |
| Trial: 3 days left, last day, ended | One reminder each to the owner; VYNTEX is told when a trial ends without a plan. |

A company paused by an operator by hand is never reopened by a payment: only a pause for billing is lifted by paying.

Every webhook is checked against Stripe's signature, then the event is read back from Stripe's API by its id, so only
what Stripe actually has is acted on. Each event is recorded once; repeats change nothing. The daily run is the
`billing.daily` job (queued by the existing daily cron).

## Setup (one time)

1. **IN: Stripe Dashboard > Developers > API keys**: copy the secret key (start with the test key, `sk_test_...`).
2. **IN: Vercel > vyntex-erp project > Settings > Environment Variables**: add `STRIPE_SECRET_KEY` (Production).
3. **IN: Stripe Dashboard > Developers > Webhooks > Add endpoint**: URL `https://erp.vyntexusa.com/api/billing/webhook`,
   events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`,
   `charge.refunded`, `charge.dispute.created`. Copy its signing secret.
4. **IN: Vercel**: add `STRIPE_WEBHOOK_SECRET` (the `whsec_...` value), optionally `BILLING_NOTIFY_TO`, then redeploy.
5. **IN: Stripe Dashboard > Settings > Payment methods**: card and ACH Direct Debit on; Klarna, Afterpay, Affirm off.

Products and prices are created in Stripe automatically the first time each plan is bought, with lookup keys that
include the pricing version (`vx_<version>_<plan>_<monthly|yearly|setup>`). A price in Stripe is never changed: a new
pricing version makes new prices, and existing subscriptions keep theirs. If a price in Stripe ever differs from the
pricing file, checkout stops with `price_mismatch` and nothing is charged.

## Code

* `supabase/migrations/0066_billing_and_invite_trials.sql`: tables `app.billing_*`, server functions, operator functions,
  trials by invitation.
* `api/billing.js`: routes `status/<tenant>`, `checkout`, `portal`, `operator`, `operator/link`, `webhook`.
* `api/_lib/billing/`: `stripe.js` (REST client and signature check), `core.js` (quotes, checkout, portal, events,
  daily run), `emails.js` (bilingual emails), `deps.js`.
* `src/features/billing/`: the billing panel. `src/features/admin/`: billing column and payment link.
* Tests: `tests/server/unit.billing.test.mjs`, `supabase/tests/modules/97_billing.test.sql`.
