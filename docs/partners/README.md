# VYNTEX Partner Portal: architecture, operation and runbook

The VYNTEX Partner Portal lives inside VYNTEX ERP at `https://erp.vyntexusa.com/partners`. It uses the same repository,
Vercel project, domain and Supabase project (`vyntex-erp-clients`), in its own private database schema.

* Phase A audit: `AUDIT.md`. Catalog and commercial mapping, conflicts and the approval list: `CATALOG-MAPPING.md`.
* Machine-readable import: `catalog-import.json` (amounts in integer cents, rates in basis points).
* Release status and test results: `RELEASE-REPORT.md`.

---

## 1. What a partner and VYNTEX can do

| Module | Partner | VYNTEX partner staff |
| --- | --- | --- |
| **Catalog & Offers** | Client View (safe to show a prospect), Partner View (own estimated pay), "Present" mode, compare up to 3, offer builder, client preview, private proposal link, email to client, record decision, duplicate and revise, turn an accepted offer into an order, resources | Same views, preview any partner's Partner View (read only, audited), approval queue for offers, catalog maintenance (draft, publish, retire, publish every approved-source item at once), commission policies (draft, approve, retire, assign negotiated versions) |
| **Client Orders** | Submit (from an accepted offer, or published items at published prices), follow up, answer information requests, own follow-up date, withdraw a draft or a just-submitted order | All orders, attribution conflicts, move through the state machine, internal notes vs partner-visible updates, assign to self, VYNTEX follow-up date, record verified payments |
| **Commissions & Payouts** | Statement: estimated / eligible / approved / payable / paid / held / reversed, each line with order, service, policy version, base, rate and written calculation, history; payouts with method, reference and dates; ask a question on a line | Liability by partner, approve, hold, release, reverse, reply, adjustments, payouts (draft, approve, sent with reference, settled with reconciliation reference, cancel), statement preview of any partner |
| Utilities | Language (EN/ES), sign out | **Partners**: create, invite people, compliance (W-9 and agreement state), suspend, reinstate, revoke |

There is no trial, no subscription, no public registration and no paywall. Partners come only by invitation.

---

## 2. Architecture

```
browser (React SPA, src/features/partners)           no Supabase URL or key in the browser
   |  /api/partners/*  (one Vercel function: api/partners.js, routed by vercel.json)
   |  /api/auth/partner-invite/check|accept  (api/auth.js)
   v
guard(): configured deployment, same origin + csrf for writes, sealed HttpOnly session, idle + absolute expiry, aal2
   |  userRpc(person's own token, allow-listed function)
   v
public.partner_* SECURITY DEFINER functions (search_path = '')  ->  schema "partner" (RLS forced, no grants, not exposed)
   |  partner.require_partner() / partner.require_staff() / app.require_stepup()  (the database decides)
   v
partner.notifications (outbox) -> job partner.notify (cron tick) -> Resend   |  job partner.daily (expiry, overdue, weekly)
```

* The browser never sends a partner id it may choose: the database takes the partner from the signed-in account.
* Offers and orders are **priced in the database** from the published catalog. Amounts sent by a browser are ignored.
* Commissions are calculated in the database from **verified payments** (recorded by an administrator with a fresh
  identity check) and the recorded go-live date. Never from an order status alone.
* ERP software prices (VYNTEX BUILD) are read only from `config/vyntex-build-pricing.json` via `src/lib/pricing.ts`.

### Files

| Area | Files |
| --- | --- |
| Database | `supabase/migrations/0070_partner_core.sql` (schema, roles, invitations, auth_context, reserved slugs, partners) · `0071_partner_catalog.sql` · `0072_partner_policies.sql` · `0073_partner_offers.sql` · `0074_partner_orders.sql` (+ outbox) · `0075_partner_commissions.sql` (ledger, payouts) · `0076_partner_catalog_seed.sql` (generated) |
| Seed generator | `scripts/partners/build-catalog-seed.mjs` (`--check` runs in `npm run check`) |
| Server | `api/partners.js`, `api/auth.js` (partner invitations, MFA for portal accounts), `api/_lib/partners/emails.js`, `api/_lib/partners/jobs.js`, `api/_lib/supabase.js` (passes our one-word refusal hints) |
| Screens | `src/features/partners/*` (`index.tsx` shell, `catalog.tsx`, `offers.tsx`, `orders.tsx`, `commissions.tsx`, `manage.tsx`, `proposal.tsx`, `i18n.ts`, `partners.css`), routes in `src/app/App.tsx` |
| Tests | `supabase/tests/modules/98_partners.test.sql`, `tests/server/e2e.partners.test.mjs`, `tests/server/unit.partners.test.mjs`, `tests/e2e/partners.e2e.test.mjs` |

### Routes

`/partners/signin` · `/partners/invite/<token>` · `/partners` (overview) · `/partners/catalog/{client|partner|offers|resources|manage|policies}` ·
`/partners/catalog/offers/{new|<id>}` · `/partners/orders` · `/partners/orders/{new|<id>}` · `/partners/commissions` · `/partners/manage` (staff) ·
`/proposal/<token>` (client, no account). `partners`, `partner` and `proposal` are reserved company addresses (database and `src/platform/mode.ts`).

---

## 3. Roles and access control (deny by default)

| Role | Where it lives | Can |
| --- | --- | --- |
| `partner_admin` | `partner.staff` row, added from the SQL Editor | everything, including policy approval, publishing, compliance, money, suspension (money, policy, publishing and status changes need a fresh identity check) |
| `partner_manager` | `partner.staff` | partners (create, edit, invite), offer approvals within the catalog and floors, order moves and notes (except go-live and refunds); never policy, price approval, below-floor discounts, quoted prices, publishing, compliance, payments or payouts |
| `partner_owner` / `partner_member` | `partner.users` row, created only by accepting a partner invitation | own partner's catalog views, offers, orders and statement |
| client | no account | one proposal, by a private expiring link |

Rules enforced in the database:
* Every portal function requires a live session that passed the second sign-in step (`aal2`).
* A partner account can never join a company workspace (trigger on `tenant_members`), and an ERP customer or staff account
  cannot be turned into a partner account by an invitation.
* No code compares an email address to grant anything. Roles are rows; nobody can add themselves (`partner.staff_add` is
  executable by the database owner only).
* Suspending or revoking a partner (or one of its people) writes a session revocation: every token issued before is
  refused at once.

### Access matrix (verified by `98_partners.test.sql` and `e2e.partners.test.mjs`)

| Action | anon | ERP customer | partner A | partner B | manager | admin |
| --- | --- | --- | --- | --- | --- | --- |
| any `partner_*` function | no | refused | own data | own data | yes | yes |
| read partner A's offer/order/statement | no | no | yes | **no (42501)** | yes | yes |
| approve offer | no | no | no | no | yes | yes |
| move order, notes | no | no | no | no | yes | yes |
| record payment / approve commission / payouts | no | no | no | no | **no** | yes + step-up |
| approve policy / publish catalog / compliance / suspend | no | no | no | no | **no** | yes + step-up |
| read a proposal | server only, by token hash | | | | | |

---

## 4. Admin bootstrap (info@vyntexusa.com)

IN: Supabase dashboard > project `vyntex-erp-clients` > SQL Editor.

**A. When `info@vyntexusa.com` already has an account** (for example, after accepting the vyntex-hq owner invitation):

```sql
select partner.staff_add('info@vyntexusa.com', 'partner_admin');
```

**B. When it has no account yet:**

```sql
select partner.staff_invite_bootstrap('info@vyntexusa.com', 'partner_admin');
```

It returns a token once. Open `https://erp.vyntexusa.com/partners/invite/<token>` (IN: your browser), set the password,
add the authenticator app (required), keep the recovery codes. Signing in at `https://erp.vyntexusa.com/partners/signin`
then opens the Partner Administrator experience.

More administrators or managers later: the same two calls with their address (`'partner_manager'` for a manager).
Remove one: `select partner.staff_remove('person@example.com');` (their sessions end at once).

---

## 5. First day after the migrations are applied

1. **Bootstrap the administrator** (section 4).
2. **Review and publish the catalog** (IN: Partner Portal > Catalog & Offers > Manage catalog). "Publish the N items whose
   prices come from an approved source" publishes the 28 items whose figures come from the approved price sheet. The other
   9 stay "Needs VYNTEX Approval": edit each (price, or "quote only"), then Publish.
3. **Decide the commission policies** (Catalog & Offers > Commission policies). Every imported policy is a draft. Approve
   only what VYNTEX confirms (CATALOG-MAPPING.md section 7). Until a policy is approved, partners see "Needs VYNTEX
   Approval" and no earning, and no commission is ever calculated.
4. **Publish the client terms** (they are imported as drafts; the bulk publish in step 2 publishes the approved-source
   terms). Spanish texts of the terms still need VYNTEX's own wording (they are English only today).
5. **Create the first partner** (Partners > New partner), set its arrangement (Referral or Revenue share), invite its owner.
6. When the partner's W-9 is verified and the agreement signed, record it (Partners > Compliance). Payouts are refused until then.

---

## 6. Catalog maintenance

* Every item has numbered versions: `draft` / `needs_approval` / `published` / `retired`. A published version is never
  edited; "Edit" makes a new draft (managers can draft; only an administrator approves a price or publishes).
* A price row has a status: `approved_source`, `approved`, `needs_approval`, `informational_estimate`. A version with a
  `needs_approval` price can be published only as "quote only" ("Request a quote", no figure).
* Optional price floors (lowest price without approval) live on the price rows. With no floor, any discount needs VYNTEX approval.
* Issued proposals are frozen snapshots: publishing a new price never changes an offer already sent.
* Resources (guides, scripts, disclosures, terms) are versioned the same way; `kind = terms` resources appear in every proposal.

---

## 7. Offer and order workflow

**Offer:** (only the client accepts on the proposal page; VYNTEX can record an acceptance given another way, with a reason) `draft` -> (submit) -> `approved` (within catalog and floors) or `pending_approval` -> `approved` / `changes_requested`
-> (share link) `sent` -> `viewed` -> `accepted` / `declined` -> `ordered`; also `withdrawn`, `expired` (daily, after `valid_until`).
Reasons for approval: discount below floor (one-time charges only; the monthly is never discounted), a quote-only line
(VYNTEX sets its price when approving). A missing approved partner policy is shown to the partner but does not block.

**Order** (`partner.order_move_allowed` is the single list):

```
draft -> submitted -> under_review <-> info_required -> approved -> awaiting_payment -> [scheduled] -> in_progress -> live -> completed
exceptions: rejected (from review), cancelled (partner: draft/submitted; VYNTEX: until completed), disputed (from live/completed), refunded
```

* Partners: submit, withdraw a draft or a just-submitted order, answer `info_required` (moves it back to `under_review`).
* Attribution: first submission of a client (same email, else same normalized name) wins for 90 days; a later submission by
  another partner is flagged `conflict` for VYNTEX (internal note), by the same partner `possible_duplicate`.
* Every move, message, note, payment and assignment is in `partner.order_events` (append only); internal notes are never
  sent to partners.

---

## 8. Commission engine (the written terms, not the legacy code)

Runs after every verified payment, go-live, cancellation or refund (`partner.evaluate_order`); safe to run again (each
ledger line has a unique dedupe key).

| Model | Earned when | Amount |
| --- | --- | --- |
| `referral_flat_fee` | order `live`/`completed` AND the money kept (payments minus refunds and chargebacks) is more than $0 and covers the setup + one-time charges | the highest approved fee among the order's items, once per client order |
| `revenue_share_setup` | same | rate x setup of each covered line |
| `revenue_share_one_time` | same, and the whole order's one-time total >= the policy minimum ($350 in the source) | rate x (setup + one-time) of each covered line |
| `revenue_share_recurring` | each `monthly` payment for a month from the go-live month on | rate x the line's share of the collected amount |

* The policy versions in force when the order was **submitted** are frozen on the order and used later.
* A suspended or revoked partner earns nothing new (reversals and clawbacks still apply).
* Go-live is recorded by an administrator; its date is today unless an earlier date is given with a reason (never in the future, never before the order or its first payment).
* Refund or chargeback: every earned line of the order is reduced in proportion to the money returned (new negative lines).
* Cancellation inside the clawback window (90 days from go-live in the source): the rest of the one-time pay is clawed back.
* Rounding: half up, to the cent (the legacy whole-dollar rounding is a pending VYNTEX decision).
* Statuses: `eligible` -> `approved` (admin) -> `payable` (in an approved payout) -> `paid` (payout settled with a
  reconciliation reference); `held` / `disputed` / `reversed` with a reason. Lines are never edited or deleted.

## 9. Payouts and reconciliation

Payouts are made outside the portal (ACH, Zelle, check). The portal records them:
1. Commissions & Payouts > Commissions: approve eligible lines (step-up).
2. Create payout for a partner (needs W-9 `verified` and agreement `signed`): every approved line, deductions included.
3. Approve (only lines still approved stay in it; lines held, disputed or reversed since the draft leave it; lines become payable) -> pay outside -> **Mark sent** with method and bank/Zelle reference -> **Mark settled**
   with the reconciliation reference (lines become paid). A commission can be in one live payout only.
4. A sent payout cannot be cancelled: correct with a reversal or adjustment line.

No tax IDs or bank numbers are stored in the portal. 1099 reporting is not automated.

---

## 10. Security threat model (summary)

| Threat | Control |
| --- | --- |
| IDOR / cross-partner reads | partner id taken from the session in SQL; every function checks ownership; tested A vs B |
| Privilege escalation | roles are rows added only by the database owner or an admin; no email checks; metadata not used |
| Password-only access | aal2 required in SQL and by `guard()`; MFA required for any portal account at sign-in (G1) |
| Stolen session after suspension | session revocation row; `app.session_live()` checked by every function |
| Client View leak | server-side projection (`partner.client_item`, `partner.offer_client_json`); tested for absent keys |
| Proposal token theft | 256-bit random token, only its SHA-256 stored, expires, revocable, read by the server only, rate limited, `no-store`, `no-referrer` |
| Price tampering | browser prices ignored; server prices from the published catalog; frozen snapshots |
| Replay / double submission | idempotency keys on orders, dedupe keys on ledger lines, unique payout per commission, unique month per order |
| Financial tampering | ledger, events, payments, order history and audit log are append only (triggers) |
| CSRF / origin | `guard()` same-origin + double-submit token on every write; public respond route checks same site |
| Enumeration | invitations answer the same for unknown, used, revoked and expired tokens |

---

## 11. Deployment and rollback

1. Review and merge the PR into `feature/saas-seven-day-trial` (IN: GitHub).
2. Apply the migrations to `vyntex-erp-clients` **in order** 0070 -> 0076, after the billing migration 0066
   (IN: Supabase SQL Editor, or the migration tool; remote names `init_0070_partner_core` ...). They are additive: new
   schema, new functions, and replacements of `app.reserved_slugs()` and `public.auth_context()` (both keep every previous field).
3. Promote the Vercel deployment (IN: Vercel > vyntex-erp > Deployments). `api/partners.js` is the 12th function
   (with `api/billing.js` from the billing branch): the Hobby limit is 12.
4. Bootstrap the administrator (section 4) and follow section 5.

Rollback: promote the previous deployment in Vercel. The database part is additive and can stay; to disable the portal
without a deploy, suspend partners (their sessions end) or remove staff rows. Do not drop the `partner` schema once
financial records exist.

## 12. Monitoring

* `partner.notifications`: rows stuck in `queued`/`failed` (`select status, count(*) from partner.notifications group by 1`).
* `partner.audit_log` and `app.security_events` (`partner.*` kinds) for administrative and sign-in events.
* Daily job `partner.daily`: overdue orders email to staff; Mondays the weekly summary.
* Vercel runtime logs of `api/partners.js` (`not_configured`, 5xx).

## 13. Outstanding dependencies

* VYNTEX decisions listed in `CATALOG-MAPPING.md` section 7 (policies, prices, rounding, tax rules, Spanish terms).
* Resend: already configured in production; a recipient-side test of the partner emails is still to be done after deploy.
* File attachments on orders and AI-assisted drafting are not built (see `RELEASE-REPORT.md`).
