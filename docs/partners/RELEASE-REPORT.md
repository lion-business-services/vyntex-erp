# VYNTEX Partner Portal: release report

Date: 2026-10-22. Branch `feature/partner-portal` (from `feature/saas-seven-day-trial` at `0e07446`, the production commit).
Status: **built and tested on local stand-ins. Not merged, not deployed, no migration applied to Supabase.** Nothing here
claims a live result.

## 1. Implementation

### What was built
* **Database** (schema `partner`, migrations 0070-0076): staff and partner roles as rows, partner organizations, partner
  invitations (hashed, single use, 72 h), an append-only audit log; the versioned catalog (items, versions, prices with
  status and provenance, resources); the versioned commission-policy engine (versions, approval, negotiated assignments,
  estimates); offers (server pricing, approval reasons, frozen client snapshots, proposal shares, append-only events);
  orders (state machine, attribution, append-only events, verified payments, outbox notifications); the commission
  ledger (append-only lines and status events, refunds, clawbacks, adjustments) and payouts (draft, approved, sent,
  settled, cancel; W-9 and agreement gate; one live payout per commission).
* **Authentication changes** (`api/auth.js`): a Partner Portal role now requires the authenticator app at sign-in even
  with no company membership (audit gap G1); portal accounts keep their session; partner invitations have their own
  routes (`/api/auth/partner-invite/check|accept`) and never create a company membership (G3). `partners`, `partner`,
  `proposal` are reserved addresses (G2).
* **API** `api/partners.js` (one function): partner routes, staff routes, the public proposal routes.
* **Screens** `src/features/partners`: overview; Catalog & Offers (Client View, Partner View, Present, Compare, offers,
  resources, catalog maintenance, policy approval); offer builder and offer page (client preview, private link, email to
  client, decision, duplicate, withdraw, order from offer, staff approval with pricing of quoted lines); Client Orders
  (list, new order, detail with timeline, messages, internal notes, moves, assignment, follow-ups, payments); Commissions
  & Payouts (statement, line detail, questions, liability, approvals, holds, reversals, adjustments, payouts); Partners
  (create, invite, compliance, suspend, reinstate, revoke). The client proposal page `/proposal/<token>` (printable).
  English and Spanish (usted), dark on every device.
* **Automation**: outbox notifications (offer approved, changes requested, viewed, accepted/declined, order received,
  status changes, VYNTEX updates, commission records, payouts; staff: pending approvals, new orders with attribution
  conflicts, partner messages, questions), sent by job `partner.notify` on every cron tick and marked "sent" only with
  Resend's id; job `partner.daily`: offer expiry, overdue orders email, Monday summary.

### Reused from VYNTEX ERP
Sessions, csrf, TOTP MFA and recovery codes, step-up, session revocation, rate limits, invitation pattern, system email
(Resend), job queue, security events, the auth pages (sign-in flow and invitation page, extended with a partner variant),
the UI kit and brand, the pricing library for ERP software.

### Imported from the Master Command source
37 service items (packages, CRM, web, AI, branding and social, add-ons, hourly rates) with English and Spanish text and
every price with its source line; 9 categories (7 imported, ERP software left to the pricing file); 19 commission
policies; client terms; third-party usage estimates. Everything is imported **unpublished**: 28 items whose figures
come from an approved source can be published in one administrator action; 9 stay "Needs VYNTEX Approval". **No policy is
approved by the import**: no partner earning is shown or calculated until VYNTEX approves a policy version.
Nothing was read from or written to the Master Command database by this work (the Phase A audit read it, read only).

## 2. Infrastructure

| Item | State |
| --- | --- |
| Branch / commits | `feature/partner-portal` (see the PR) |
| Pull request | into `feature/saas-seven-day-trial` (link in the PR list; not merged) |
| Vercel | no deployment made. `api/partners.js` is the 11th function on this base; with `api/billing.js` (billing branch) it is the 12th. Preview deployments of this project have no environment variables (audit T3), so a preview answers 503 until preview-scoped values exist |
| Live routes | none yet (not deployed) |
| Migrations | 0070-0076 written and applied only to throwaway local PostgreSQL databases. **Not applied to `vyntex-erp-clients`.** They assume 0066 (billing) or nothing between 0065 and 0070 |

## 3. Security (all on local stand-ins)

| Check | Result |
| --- | --- |
| Authentication and MFA | e2e: staff and partner invitations accepted, authenticator required before any portal call (`mfa_required`), password-only sign-in stops at "verify", used and expired invitations refused, ERP customer account refused as partner (`account_in_use`) |
| RBAC and isolation | DB module 98: partner B refused on partner A's offer, order, statement (by id and by list), manager refused on policy approval, payments, publishing; partner refused on approvals, payouts, ledger writes; anon refused on every `partner_*` function |
| Administrative permissions | publishing, policy approval, payments, commission approval, payouts and suspension need an administrator and a fresh identity check (VX403 without it) |
| Client View / proposals | no partner pay, floors, notes, policy or partner name in Client View or proposals (DB, server and browser tests) |
| Lockdown | `partner.lockdown_check()` and `app.lockdown_check()` pass after every migration |
| Supabase security advisor | not run (no migration applied to Supabase) |

## 4. Business workflows

| Workflow | Tested where | Result |
| --- | --- | --- |
| Catalog import, publish, Client/Partner View, estimates | DB 98, server e2e, browser e2e | pass |
| Offer pricing (server), discount below floor, approval queue, frozen proposal after a price change, share link, client acceptance, expiry | DB 98, server e2e, browser e2e | pass |
| Orders from offers and items, idempotency, attribution conflict, state machine, info request and answer, internal notes | DB 98, server e2e, browser e2e | pass |
| Commissions: nothing before balance paid; 20% setup share; 3% monthly share per collected month; duplicate month refused; re-run adds nothing; referral fee once per order; proportional reversal on refund; clawback on cancellation inside 90 days | DB 98 | pass |
| Payouts: W-9 gate, approved-only, no second payout of the same lines, sent needs a reference, paid only when settled, partner sees method/reference/date | DB 98 | pass |
| Notifications: outbox, sent only with provider id, no em dash, no partner pay in emails | server unit and e2e (Resend answered from memory) | pass |
| Suspension ends sessions, keeps records | DB 98, server e2e | pass |

### Test runs on this branch
* `npm run check` pass (adds the catalog seed parity check) · `npm run build` and `build:lbs` pass · `npm run test:unit` 311 pass ·
  `npm run test:split` 79 checks pass · `npm run security:bundle` clean (both builds) · `npm run security:headers` 20/20 ·
  `npm run test:security` 101 pass · local `tsc -p tsconfig.local.json`: no error in the new or changed files (2 existing
  errors in `src/features/floor` are unrelated).
* `npm run test:db`: all database checks pass (7298 assertions; 128 in the new partner module).
* `npm run test:server`: unit 126 pass; partner e2e 9 pass; public e2e 12 pass; the isolated e2e group passed in 3 of 5
  full runs. The failing case each time was the existing test "webhooks: a provider that checks the address first ..."
  (it got 429 instead of 503; it picks random client addresses for rate-limit buckets). It passes when its file is run
  alone (19/19) and passed in two runs on the base commit. Not caused by a known change here, but not proven unrelated either.
* `npm run test:e2e` (real Chromium, local stand-ins): all 6 steps pass, including the new partner portal walk-through
  (desktop and phone screenshots).
* `npm run typecheck` (full) was not run: this machine has no `@types/react`.

## 5. Release readiness

**Works now (on local stand-ins):** everything in section 4.

**Needs provider credentials or deployment work:** applying 0070-0076 to Supabase; promoting a deployment; a
recipient-side test of the partner emails through the production Resend; preview environment variables (T3).

**Financial rules awaiting VYNTEX confirmation** (`CATALOG-MAPPING.md` section 7): which partner programs are current;
3% vs 10% monthly share; social media structure; CRM prices; referral fees for web/AI/branding/social and custom builds;
AI tools revenue share; payout timing (go-live + balance, used by the engine, vs 90 days); rounding (the engine rounds to
the cent); the $350 whole-order minimum; revenue-share term/fee/minimum; CPA alternative and volume upgrade; W-9 gate and
1099 threshold; ERP software partner pay; the 2.9% fee question; quote-only items; hourly and rush rates; AI monthly
optional or not; Brand Logo; the legacy public partner page; effective dates.

**Known limitations (not built):**
* Order attachments (file upload) are not built.
* AI-assisted drafting is not built (no AI feature is wired to the portal; the portal works without it).
* No automated payout transfer: payouts are recorded manually (sent and settled with references).
* No tax reporting (1099) and no storage of tax IDs or bank details.
* Partner-authored package templates (saved bundles) are not built; duplication of offers covers revisions.
* Client-facing export to PDF is the browser's print (the proposal page has print styles), not a server-made PDF.
* Spanish versions of the imported client terms do not exist in the source; they show in English until VYNTEX writes them.
* Staff can assign an order only to themselves from the screen (the database accepts any active staff member).

**Critical blockers before opening real partner accounts:** apply the migrations to the right project and run the
partner module tests against it (`supabase/tests/modules/98_partners.test.sql` is written for the local harness);
bootstrap the administrator; approve at least the policies VYNTEX wants partners paid by; send and receive one real
invitation email; confirm leaked-password protection is on in Supabase Auth (audit L8, not visible from SQL).

**Post-launch monitoring:** outbox rows not sent; `partner.audit_log`; `app.security_events` with `partner.*`; Vercel
runtime errors on `api/partners.js`; the daily overdue email.
