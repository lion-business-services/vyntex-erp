# VYNTEX Partner Portal: Phase A audit and discovery

Date: 2026-10-22. Scope: directive sections 2, 13, 15 and 18 (Phase A). Nothing was built, and no database was written to.
Companion files: `CATALOG-MAPPING.md` (commercial data, conflicts, approval list) and `catalog-import.json` (a machine-readable draft).

Legend: **[C]** means confirmed, with the file and line or the query cited. **[A]** means an assumption or inference that still needs checking.

---

## 0. What was inspected

| Source | Version inspected | How |
| --- | --- | --- |
| Legacy Master Command repo `lion-business-services/lbs-vyntex-mastercommand` | `d306a48` (2026-10-19) | read-only clone at `/home/claude/mastercommand` |
| Legacy database (project `yzdyuyxfsqxfgkroykfr`) | live, 2026-10-22 | read-only SQL (counts, structure, `vx_settings`), security advisor |
| VYNTEX ERP repo | `0e07446` = **the current production commit** | worktree `/home/claude/wt-audit` |
| Website repo `vyntex-site` | `431f971` (the working tree has uncommitted edits in unrelated files) | read-only |
| Target Supabase `vyntex-erp-clients` (`qizmryluifvykablwuxc`) | live, 2026-10-22 | read-only SQL, security advisor |
| Vercel project `prj_WGtwa5nt6h6Wkl6VSru7PwuxnqNh` | production deployment list, env var **names** only | Vercel MCP |

**[C] Production has moved past the commit named in the directive.** The directive names `16f1c80`. The three most recent
production deployments are from `feature/saas-seven-day-trial`, and the newest is `0e07446` ("Merge pull request #15 … fix/trial-review"),
which adds `supabase/migrations/0065_trial_access_repair.sql`. The audit worktree was moved to `0e07446`. The partner branch
must start from `0e07446` or later.

---

## 1. Executive summary

1. **[C] The legacy database holds no partner business at all.** `partners` = 0, `payouts` = 0, `leads` = 0,
   `vx_partner_links` = 0, and `partner-docs` storage objects = 0. `vx_settings` has exactly one key, `vyntex_catalog`, which holds
   447 bytes of headline text patches for the VYNTEX BUILD catalog page and no prices. **Nothing needs migrating except reference
   commercial terms.** No partner identities exist to link, and there is no attribution history to preserve.
2. **[C] Because `vx_settings` has no `pricing` key and no `partner_portal` key, the effective legacy prices and partner rules are the
   hard-coded defaults** in `public/vyntex/index.html` (`PRICING`, lines 857-884, and `CATALOG`, lines 2383-2545) and the SQL fallbacks in
   `vx_partner_fee` (`sql/1-vyntex-setup.sql` lines 265-292, live hash confirmed to contain them). The legacy public partner page
   has never been published.
3. **[C] Three incompatible partner programs exist in the sources** (details in CATALOG-MAPPING §5):
   (a) the Master Command **Referral (flat $150/$200/$250)** and **Revenue Share (20% of setup, 3%/mo, 35% one-time, $350 minimum)**, in which VYNTEX bills the client.
   These match the rates the owner states are current.
   (b) The seller guide's **Authorized Reseller**: 20% of setup plus **10%**/mo, the reseller bills its own client, and the reseller buys at 35% off list.
   (c) The website's **wholesale reseller**: a 30% margin, a $199/yr activation fee and 4 resales a year, with different CRM prices.
   We recommend (a) as the approved model, with (b) and (c) kept only as superseded reference data, subject to VYNTEX approval.
4. **[C] The legacy payout engine does not implement its own written agreement.** It makes fees "payable" only after the 90-day
   clawback window, never checks that the balance was paid, and creates monthly shares for months that were never collected. Do not port the
   legacy logic. Port the agreement terms as versioned policy instead.
5. **[C] The ERP already has nearly every security primitive the portal needs**: sealed HttpOnly sessions, CSRF, TOTP MFA with recovery codes,
   step-up, rate limits and locks, idempotency, a job queue, Resend system mail, security events, hashed one-time tokens and an operator role
   pattern. Three things need extending, not replacing:
   **MFA enforcement is driven only by tenant memberships**, which partners will not have. **`/partners` is not a reserved slug.** And
   **invitations are hard-wired to tenants.**
6. **[C] The target database is clean.** It has 56 applied migrations (`init_0001` to `init_0065`), 1 tenant (`vyntex-hq`), **0 `auth.users`** and 0 operators.
   `info@vyntexusa.com` does not exist yet in this project, so the admin bootstrap must create the identity through the invitation flow.

---

## 2. Reusable functionality (VYNTEX ERP @ 0e07446)

| Need (directive) | Existing piece | Reuse verdict |
| --- | --- | --- |
| Sign-in, anti-enumeration, lockout | `api/auth.js` `signin` (l.174), `api/_lib/ratelimit.js` `signinGate/signinResult/failLock` (l.86-134), `0023_rate_limits.sql` | **Reuse as is.** The same `/api/auth/signin` serves partners. |
| HttpOnly session, idle and absolute expiry, refresh rotation | `api/_lib/session.js` (`__Host-vx`, AES-GCM sealed, idle from `auth_context`, `SESSION_MAX_HOURS`, default 12) | **Reuse.** Partner idle minutes come from a partner setting (see §9). |
| CSRF | `api/_lib/csrf.js`, enforced in `guard()` (`api/_lib/guard.js` l.31-38) | **Reuse.** |
| TOTP MFA plus recovery codes | `api/auth.js` `mfa/enroll|confirm|verify|recovery` (l.205-310), `0021_sessions_mfa.sql` (`app.mfa_recovery_codes`, `mfa_recovery_set/use/clear`) | **Reuse.** The trigger must be extended (gap G1). |
| Step-up (fresh identity check, 5 min) | `api/auth.js` `stepup` (l.316), `guard({stepUp:true})`, DB `app.require_stepup()` (`0021` l.152) | **Reuse** for payout, policy and role changes. |
| Session revocation, suspension | `app.session_revocations`, `public.session_revoke_user` (`0021` l.190), `app.session_live()` | **Reuse.** Suspending a partner must call `session_revoke_user`. |
| Password policy, reset | `api/_lib/password.js` (min 12, `passwordProblem`), `api/auth.js` `password/reset|update` (l.453-520) | **Reuse as is.** |
| Invitations (hashed, single-use, claim/release/complete, 72 h) | `0022_invitations.sql` + `api/auth.js` `inviteCheck/inviteAccept` (l.377-450) | **Pattern reuse.** `app.invitations.tenant_id` is NOT NULL with an FK to tenants, and `invite_complete` inserts `tenant_members` (l.192-229). We need a parallel `partner.invitations` and `partner_invite_*` RPCs, and to parameterise `inviteAccept` (gap G3). |
| System email via Resend | `api/_lib/mail.js` `sendSystemEmail` (l.15), templates `inviteEmail/ownerWelcomeEmail/resetEmail` | **Reuse.** Add `partnerInviteEmail`, order and commission notices (EN/ES). Vercel production has `RESEND_API_KEY` and `SYSTEM_EMAIL_FROM` set [C, names only]. |
| Security and audit events | `app.security_events` (tenant_id **nullable**, `0020` l.110), `api/_lib/audit.js` `securityEvent` | **Reuse** for auth events (tenant null). Add an append-only `partner.audit_log` for business and financial actions. |
| Idempotency | `0024_idempotency.sql` `idem_begin/finish/abort` | **Reuse** for order submission, payout batches and ledger posts. |
| Background jobs | `0025_job_queue.sql` (`app.jobs`, tenant nullable), `api/_lib/jobs.js` `register/enqueue/runDue`, `api/cron.js`, Vercel crons `*/5` tick and a daily run (`vercel.json`) | **Reuse.** Register `partner.*` kinds in `api/_lib/jobs/handlers.js`. |
| One-time public links (hashed token, expiry, revoke) | `0040_public_links.sql` `app.public_links`, `link_issue/peek/use/revoke`, `api/public.js` | **Pattern reuse** for client proposal shares (a new `partner.proposal_shares`, because `public_links` requires a tenant and a sign/review target). |
| Private files with one-minute signed reads | `0028_workspace_files.sql`, `api/ws.js` `file/upload|url|get` (l.1-20) | **Pattern reuse.** A new private bucket `partner-files`, reached only through the server. |
| Operator (platform admin) role | `0061_operator_console.sql` `app.operators`, `app.require_operator()` (aal2 enforced in the DB), `api/admin.js`, `src/features/admin` | **Pattern reuse** for `partner.staff` (Partner Administrator or Manager). Kept separate so operator rights and partner-admin rights do not leak into each other. |
| RPC allow-list gateway | `api/_lib/rpc-allowlist.js` + `api/ws.js` `rpc/<name>` | **Pattern reuse.** It is tenant-oriented (`tenantArg`), so the portal gets its own allow-list in `api/partners.js`. |
| Money | `src/lib/money.ts` formats **float dollars**. DB house rule 8: `numeric(12,2)` (`docs/DATABASE.md` §2) | **Do not reuse for ledger math.** See §9 (integer cents). |
| ERP software price book | `config/vyntex-build-pricing.json` + `src/lib/pricing.ts` (single gateway) | **Reuse as the read-only source** of ERP plan prices. It is identical to the Master Command `VXB_BASE` except for the `notes` string [C, compared programmatically]. |
| i18n | `src/i18n` + per-feature `i18n.ts` exporting `dict: Dict` with `en`/`es` (for example `src/features/commissions/i18n.ts`), `scripts/check-i18n.mjs` | **Reuse.** The portal needs full EN/ES parity. |
| Brand and design system | `src/config/brand.ts` (BRAND: VYNTEX ERP, info@vyntexusa.com, 609-780-3218, Northfield address), `src/brand/*`, `src/ui/theme.css`, `docs/CONVENTIONS.md` "Metallic Intelligence" | **Reuse.** |
| SPA routing | `src/app/App.tsx` l.95-120 top-level `route.parts[0]` switch; `src/app/router.tsx` | Add `top === 'partners'` (lazy `@/features/partners`) **before** the workspace resolution. See gap G2. |
| Existing "commissions" feature | `src/features/commissions` is **barber pay** (weekly chair or commission), not partner commissions | Not reusable beyond visual patterns. Avoid naming collisions (use `partner-commissions`). |

---

## 3. Catalog and pricing sources (summary; full mapping in CATALOG-MAPPING.md)

| # | Source | Content | Published? | Authority today |
| --- | --- | --- | --- | --- |
| S1 | `mastercommand/public/vyntex/index.html` `PRICING` l.857-884 | 13 priced tiers, referral fees, revenue-share rates, depositRate 0.5, termMonths 12 | internal (team-only app) | **Effective legacy defaults** (no DB override exists) |
| S2 | same file `CATALOG` l.2383-2545 | 17 services, bilingual name, line, best-for, includes, excludes, lead time | internal | Authoritative bilingual text and prices |
| S3 | same file, contract templates l.2656-2685 | service, referral, revenue-share agreements and proposal (EN/ES) | sent to clients and partners | Authoritative written partner terms |
| S4 | `sql/1-vyntex-setup.sql` `vx_partner_fee` l.265-292, triggers l.296-359 | server fee engine with hard-coded fallbacks | n/a | Effective in the live DB (function hash checked) |
| S5 | `public/vyntex/vx-upgrade.js` l.252-300 | partner-page rows (`shareCents`, `buildRows`, `PORTAL_DEFAULT` disclosure EN/ES) | would be public through a token link, but never published | Mirrors S1 |
| S6 | `public/vyntex/seller-guide.html` | the full price sheet "Prices approved 17 September 2026" (l.351), add-ons, hourly rates, usage, terms, a **different reseller model** | internal | Approved prices, but conflicting partner model |
| S7 | `public/vyntex/vyntex-catalog.html`, `VXB_BASE` (index.html l.3603) | VYNTEX BUILD plus 7 industry editions | client-facing | Same as S9 |
| S8 | `vyntex-site/lib/pricing.ts`, `pricing-reseller.ts` (server-only), `reseller-program.ts`, `services-catalog.ts` | legacy internal price book (**different CRM prices**), wholesale 30% margin, $199/yr, 4 resales; a public price-free bilingual catalog | services-catalog is public; pricing.ts is a "public module" by its own header; pricing-reseller.ts is confidential | services-catalog text = S2. Price book = legacy and conflicting |
| S9 | `vyntex-erp/config/vyntex-build-pricing.json` (version `2026-09-26h`) | ERP software plans and add-ons | **published** on the ERP pricing page | Authoritative for ERP software |

**Recommendation.** For services, packages and partner rules, use S2 + S1 + S3 (Master Command) as the base, corroborated by S6 where it agrees, with every
conflict routed to "Needs VYNTEX Approval". For ERP software, use S9 read-only (link to it, do not copy it into a second price table, or copy it with
a version pin and a parity test). Use S8 `services-catalog.ts` only to cross-check public wording.

---

## 4. Authentication and role model today

### Legacy (Master Command)
- **[C]** `team(id → auth.users, role in ('owner','staff'))`, `vx_is_team_member()` / `vx_is_owner()` (`sql/1-vyntex-setup.sql` l.31-53).
  Live: 5 team rows, 1 owner. Partners have **no login at all**. The "partner portal" is a token link (§7).
- **[C]** The view `vx_staff` (names and login emails of active team) is granted to `anon` (l.88-92) and flagged by the advisor as `security_definer_view` (ERROR).

### VYNTEX ERP
- **[C]** Identity = Supabase Auth. Authorization = `public.tenant_members(role in owner|manager|staff|readonly|worker)` plus capabilities
  (`0010`, `app.capabilities_of`), resolved in the DB. Platform staff = `app.operators` (`0061`), added only from the SQL editor
  (`app.operator_add`, revoked from every app role).
- **[C]** `public.auth_context()` (`0021` l.330-360) returns `aal`, `has_factor`, recovery-code count, step-up time and **memberships only**.
  `api/auth.js` l.61 `mfaRequired = memberships.some(m => m.mfa_required …)` and `mfaState()` l.64-68 return `'ok'` when no
  membership requires MFA and no factor is enrolled. **A partner with no tenant membership would pass sign-in with a password only**, unless
  this is extended (gap G1).
- **[C]** `guard()` blocks any route while `session.m !== 'ok'`. The DB repeats the check (`app.require_mfa(p_tenant)`, which is tenant-scoped),
  and `app.require_operator()` checks `aal2` itself. The partner portal needs a `partner.require_partner()` / `partner.require_staff()` that checks
  `aal2` and `session_live()` the same way.

---

## 5. Admin console capabilities (ERP)

**[C]** `/admin` (`api/admin.js`, `src/features/admin`, `0061`) lets an active operator with aal2:
list companies, create a company plus its first-owner invitation (link shown once and emailed), re-invite, suspend or activate, and convert a trial
(`operator_convert_trial`, seen in the advisor list). There are **no** partner, catalog, commission or payout functions. The operator pattern
(DB-side role table, SQL-editor bootstrap, aal2 required in the DB, link returned once with only its hash stored) is the model to copy for the
Partner Administrator.

---

## 6. Database and RLS patterns to follow (target project)

**[C]** `docs/DATABASE.md` §2 house rules, plus `0019_lockdown_check.sql`:
- `public` tables **must** have `tenant_id NOT NULL` with a leading index, unless they are in `platform_tables` (`industries`, `tenants`, `demo_requests`).
  `app.lockdown_check()` raises otherwise, and also revokes `anon` on every `public`/`app` function not listed in `app.anon_functions`.
- `app` schema tables: RLS forced, **no policy and no privilege for any app role**, reached only through `SECURITY DEFINER` functions with
  `set search_path = ''`.
- Policies use once-per-statement helpers (`tenant_id = any ((select app.tenants_can(...))::uuid[])`), never per-row `app.can()`.
- Every migration that adds a table or function ends with `select app.lockdown_check();`.
- **[C]** Default ACL for objects that `postgres` creates in `public`: functions executable only by `postgres` and `service_role`, and tables granted only to
  `postgres` and `service_role`. A new function is therefore closed until it is explicitly granted (a good default).
- Migration names on the remote are `init_00NN_<name>` (`supabase_migrations.schema_migrations`). The last is `20261022174557 init_0065_trial_access_repair`.
- **[C]** Advisor (target): 5 `security_definer_view` ERRORs (`my_jobs`, `my_worker_profile`, `job_assignments_basic`, `worker_directory`,
  `jobs_basic`; existing ERP views; `lockdown_check` requires security_barrier, so these are probably intentional), 32 INFO "RLS no policy" (intended for `app.*`),
  49 WARN "authenticated can execute SECURITY DEFINER" (intended RPC surface). **No anon-executable definer functions.** Do not add any. The partner
  proposal reader must be server-only (`service_role`), like `link_peek`.

**Consequence for the portal:** partner tables have no `tenant_id`, so they **cannot live in `public`** without changing `lockdown_check`.
Put them in a new schema `partner` (not exposed to PostgREST), with the `app`-schema rules (RLS forced, no grants) and access only through
`public.partner_*` `SECURITY DEFINER` RPCs that are granted to `authenticated` (partner and staff calls with the user's token) or `service_role`
(token-addressed proposal reads, job workers). Add `partner.lockdown_check()`, or extend `app.lockdown_check()` to scan the `partner` schema too.

---

## 7. Current commission and payout logic in the legacy system (and what is wrong with it)

**[C] Data model** (`sql/1-vyntex-setup.sql`): `partners(kind in referral|reseller, w9_on_file, w9_path, agreement_signed_at, active)`.
`payouts(partner_id, lead_id, amount numeric(10,2), kind in referral-fee|reseller-setup|reseller-monthly, status in pending|payable|paid|clawed-back, go_live_date, period, paid_at, paid_by)`.
Unique indexes give one fee per lead and kind, and one monthly share per lead and month (l.177-178).

**[C] Engine:**
- `vx_partner_fee(tier, partner_kind, setup, monthly)` (l.265-292). Referral: flat fee from `vx_settings.pricing.referralFees`, otherwise the hard-coded
  150/150/200/200/250/250/250. Reseller: one-time list (`web-basic, web-std, brand-logo, brand-bundle, brand-kit, social-mgmt`) earns 35% if setup ≥ 350,
  plus 3% of the monthly only for `social-mgmt`. Everything else earns 20% of setup + 3% of the monthly. Amounts are `round()`ed to **whole dollars**.
- Trigger `vx_lead_partner_fees` (l.296-327). When `leads.go_live_at` is set, it inserts a `pending` payout with the note "Clawback window closes go_live+90".
  On churn ≤ 90 days, pending and payable fees become `clawed-back`, and paid fees get a note "recover it from the partner".
- `vx_payouts_maintain()` (l.332-357), called by the app on every load. It flips `pending → payable` once `go_live + 90 ≤ today`, and inserts a `payable`
  `reseller-monthly` row for **every calendar month from the go-live month to last month** while the client is not churned.

**[C] Defects against the written terms (S3 and the seller guide):**
1. The agreement says the fee is payable at go-live **and balance paid**, and paid within 15 days. The code makes it payable only after 90 days and never checks payment.
2. The agreement says the monthly share is paid in arrears **for each month VYNTEX collects**. The code pays for every elapsed month, including the
   partial go-live month, with no link to any invoice or payment.
3. The $350 minimum is "measured on the whole order". The code looks at one `recommended_tier` per lead (`quoted_setup` only).
4. AI tools (`ai-simple`, `ai-standard`) are not in `PRICING` arrays. `partnerFeeFor` (`index.html` l.1586) returns null, and so does `vx_partner_fee` for a
   referral partner, so these sales would silently pay nothing. The revenue-share agreement §3 says AI tools earn 20% + 3%.
5. Statuses mix "estimated", "eligible" and "payable". There is no approved, held, disputed, reversed or batch state. `paid` is a flag set by any team member
   (RLS `vx team full access to payouts`, l.180-181), with no reconciliation reference.
6. The W-9 requirement is text only. Nothing blocks `paid` without `w9_on_file`.
7. Rounding to whole dollars is an undocumented policy (for example Growth 20% = $299.40, paid $299; 3% of $547 = $16.41, paid $16).
8. **Security:** `vx_partner_fee` and `vx_lead_partner_fees` are `SECURITY DEFINER` and **executable by `anon`** (live ACL `=X/postgres`). That lets anyone
   compute the internal partner rates with the published key through `/rest/v1/rpc/vx_partner_fee`. `vx_payouts_maintain` is granted to
   `authenticated` (any signed-up auth user of that project, not only team; the function returns early for non-team, so this is low risk).

**Do not port the legacy logic. Port the terms**, as versioned policies with explicit eligibility events (§9).

---

## 8. Security concerns

| # | Finding | Evidence | Severity | Recommendation |
| --- | --- | --- | --- | --- |
| L1 | Token-only partner page: `vx_partner_portal(p_token)` is `SECURITY DEFINER`, granted to **anon**, with no rate limit, no hashing (the token is stored in clear as the PK), optional expiry (`expires_at` nullable), a view counter only, and the token in the URL query (`?t=`) | `sql/4-master-upgrade.sql` l.247-283; `public/partners/index.html` l.70, 109-113 | High as a design (live impact nil: 0 links, no published content) | Do **not** reuse. The new portal uses authenticated partner accounts. Client proposal shares use hashed, expiring, revocable, rate-limited tokens read only by the server. Recommend VYNTEX disable the legacy page (requires approval to touch legacy, which is out of scope). |
| L2 | The legacy page renders **partner compensation to anyone holding the link**, with no identity binding. The `label` field could carry a partner name | same | Medium | The new model shows compensation only to authenticated partners, and never in Client View or proposals. |
| L3 | `anon` can execute `vx_partner_fee`, `vx_lead_partner_fees`, `vx_is_owner`, `vx_team_guard`, `mc_*_guard` | legacy advisor `anon_security_definer_function_executable` (9) | Medium (rate disclosure) | Report to the owner. The legacy DB must not be changed without approval (directive §1, §15.10). |
| L4 | `vx_staff` view (team names and login emails) granted to anon, SECURITY DEFINER view | `sql/1-vyntex-setup.sql` l.88-92; advisor ERROR | Medium (staff enumeration) | Same as L3. |
| L5 | `vx_settings` team-readable, owner-writable, plus team-writable for key `vyntex_catalog` | `sql/3-catalog-team-edit.sql` | Low | The new catalog needs draft/publish with admin approval and history. |
| L6 | Legacy publishable key and project URL are embedded in `public/partners/index.html` l.67 | file | Info (publishable by design) | Never copy into the ERP bundle. The ERP browser never sees a Supabase URL or key (`api/ws.js` header). |
| L7 | Website `lib/pricing.ts` says it is a "PUBLIC MODULE … ships to the browser" and contains the full legacy internal price book. `pricing-reseller.ts` is `server-only` | `vyntex-site/lib/pricing.ts` l.18-27 | Info | Never import either into the ERP. The portal must not publish partner-only figures. |
| L8 | Leaked-password protection disabled (legacy project) | legacy advisor | Low | Check the same setting on `qizmryluifvykablwuxc` (Auth settings are not visible through SQL) **[A]**. Enable it before partner launch. |
| T1 | Partners would bypass MFA (memberships-only rule) | `api/auth.js` l.61-68; `0021` l.330-360 | **High (design gap)** | G1 |
| T2 | `/partners` would be resolved as a company slug | `src/platform/mode.ts` l.32-45; `app.reserved_slugs()` (`0010` l.29-41) lacks `partners`; live `app.reserved_slugs() @> '{partners}'` = false; no tenant has slug `partners` | High (routing and security confusion) | G2 |
| T3 | Vercel env vars exist for **production only**. Preview deployments would lack `SUPABASE_*`, `SESSION_SECRET` and the rest, and `guard()` returns `503 not_configured` | Vercel env listing (names and targets) | Medium (blocks Phase G preview testing) | Add preview-scoped values that point at a **non-production** Supabase branch or project, never the production keys. |

---

## 9. Concrete implementation gaps

| ID | Gap | Proposed fix |
| --- | --- | --- |
| G1 | MFA is not enforced for users without memberships | New migration redefines `public.auth_context()` to add `partner: {kind:'partner'|'staff'|null, role, status, mfa_required:true, idle_minutes}`. Change `api/auth.js` `mfaRequired(ctx)` to `memberships.some(...) || ctx.partner?.mfa_required`, and `applyContext` idle to include the partner value. DB-side `partner.require_partner()` enforces `aal2` + `session_live()` + active status. |
| G2 | `partners` (and `partner`, `proposal`) are not reserved | Migration 0070 redefines `app.reserved_slugs()` adding `'partners','partner','proposal'`. Update `src/platform/mode.ts` `RESERVED_SLUGS` in the same PR (`supabase/tests/parity.mjs` compares them). Add an `App.tsx` branch before workspace resolution. **[C]** No existing tenant uses these slugs (1 tenant, `vyntex-hq`). |
| G3 | Invitations are tenant-bound | `partner.invitations` (email, partner_id or staff_role, token_hash, expires_at, claimed/used/revoked) plus `public.partner_invite_create/peek/claim/release/complete` (complete inserts `partner.users` or `partner.staff`, never `tenant_members`). Refactor `api/auth.js` `inviteAccept` into `acceptWith({claim, peek, release, complete})` and add `POST /api/auth/partner-invite/check|accept` routes (same password rules, same existing-account proof at l.411-417). |
| G4 | No partner schema or entities | Migrations 0070-0077 below. |
| G5 | No integer-cent money helpers | Add `src/lib/cents.ts` (+ server mirror) using bigint or integer cents and basis points, with a single rounding policy (half-up to the cent; the whole-dollar legacy rounding is a VYNTEX decision). DB: `bigint` `*_cents` columns in `partner.*` (house rule 8's `numeric(12,2)` targets tenant tables, so document the deviation, or use `numeric(12,2)` if the lead prefers parity). |
| G6 | No eligibility evidence source: the ERP has no record of VYNTEX's own client invoices or payments for these services (Stripe is configured only as an env var name `STRIPE_SECRET_KEY` in production [C]; no VYNTEX-services billing integration found **[A]**) | Phase 1: an admin-verified "financial event" (`partner.order_payment_events`: deposit received, balance received, monthly collected for period X, refund or chargeback) with reference and evidence. The commission engine reads only these events. A Stripe webhook can feed the same table later. |
| G7 | No catalog governance in the ERP | `partner.catalog_*` with draft/published versions, effective dates, `needs_approval` state and an approval audit. Seed from `catalog-import.json` with everything **unpublished**. |
| G8 | No partner-scoped storage | Private bucket `partner-files`, with path `partner/<partner_id>/<order_id>/...`, server-issued 60-second links. No storage policies for app roles. |
| G9 | Vercel function count | 10 `api/*.js` functions today. Add **one** `api/partners.js` with a `vxpath` router (plus a rewrite in `vercel.json`) instead of several files **[A: plan limits not checked]**. |
| G10 | Preview environment | T3 above. |
| G11 | Legacy partner page remains reachable | Out of scope to modify (legacy is read-only). Report to VYNTEX. |

---

## 10. Integration opportunities

- **Master Command (read-only):** nothing to synchronise (0 partners, leads, payouts). A one-time **import of reference terms** from
  `catalog-import.json` is enough. Do not build a cross-database link (directive §15.10).
- **Website (`vyntex-site`)** runs a separate legacy reseller portal (`app/portal/partner`, `lib/reseller.ts`: Supabase auth, statuses
  pending|approved|active|suspended|expired|terminated, Square activation payment, signed agreement v2.0 with a SHA-256 hash). **[A]** Its
  Supabase project and partner rows were not inspected (not in scope). If real resellers exist there, VYNTEX must decide whether they are invited to the
  new portal. The agreement hashing pattern (`lib/agreement-content.ts`) is worth copying for partner agreements.
- **ERP pricing page:** the portal Catalog can show ERP plans by reading `src/lib/pricing.ts` (published prices), with partner compensation for
  ERP plans marked "Needs VYNTEX Approval" (no source defines one).
- **Resend:** reuse `sendSystemEmail` with `idem` keys (`partner-invite:<id>`, `order-status:<order>:<seq>`).
- **Job queue:** `partner.commission_evaluate` (on a financial event), `partner.monthly_accrual` (daily; creates estimated lines for collected months only),
  `partner.notify`, `partner.proposal_expire`, `partner.clawback_window_close`.

---

## 11. Recommended architecture sketch (input to Phase B; not built)

### Routes (SPA, same domain)
`/partners/signin` (a partner-branded wrapper around the shared sign-in, with MFA flow reused) · `/partners/invite/<token>` · `/partners` (overview) ·
`/partners/catalog` (Client View / Partner View toggle; `/partners/catalog/offers/<id>`) · `/partners/orders` (`/partners/orders/<id>`) ·
`/partners/commissions` (`/statements`, `/payouts/<id>`) · utilities `/partners/account`, `/partners/security` · admin-only sub-views inside the same
three modules (`?scope=all`, approval queues) · `/proposal/<token>` (client proposal viewer, no account).

### API
`api/partners.js` (one function, `vxpath` router): every route = `guard()` (session, CSRF, MFA ok) + a per-route rate limit + a call to an allow-listed
`public.partner_*` RPC **with the user's own token** (`userRpc`). The DB resolves the partner from `auth.uid()`. The browser never sends a `partner_id` it can
choose. Admin routes require `stepUp` for policy, payout, role and suspension changes. Proposal reads use `serviceRpc('partner_proposal_peek', {p_token_hash})`
after a limiter, like `api/public.js`.

### Roles (DB-resolved, deny by default)
- `partner.staff(user_id pk → auth.users, role in ('partner_admin','partner_manager'), active, added_by, added_at)` is bootstrapped with an SQL-editor-only
  `partner.staff_add(email, role)` (revoked from all app roles), mirroring `app.operator_add`. **info@vyntexusa.com:** (1) issue a staff invitation from the SQL editor
  (`partner.staff_invite_bootstrap('info@vyntexusa.com','partner_admin')`, which returns the token once); (2) the owner accepts, sets a password and enrolls TOTP;
  (3) the role becomes effective only at aal2. No email-string checks anywhere in code.
- `partner.organizations(id, legal_name, display_name, kind in ('referral','revshare'), status in ('invited','active','suspended','revoked'), w9_status, agreement_status, payout_eligible, …)`.
- `partner.users(user_id pk → auth.users, partner_id → organizations, role in ('partner_owner','partner_member'), status)`. **This is the link from auth.users
  to a partner without creating any `tenant_members` row.** A trigger forbids one auth user being both `partner.users` and `partner.staff` **[recommendation]**.
  It also forbids a `tenant_members` insert for a partner-only user (or simply never offer one).
- Client Proposal Viewer = no account. Hashed token → one proposal snapshot. Client-safe fields only.

### Tables (schema `partner`; RLS forced; no direct grants)
`invitations` · `staff` · `organizations` · `users` · `agreements` (versioned text hash, signed_at, file) · `commission_policies` + `commission_policy_versions`
(model, rate_bps or amount_cents, applies_to, trigger, clawback_days, status draft|needs_approval|approved|retired, effective_from/to, approved_by) ·
`partner_policy_assignments` · `catalog_categories` · `catalog_items` · `catalog_item_versions` (bilingual text, inclusions and exclusions, client_facing,
status, effective dates) · `catalog_prices` (item_version, kind setup|recurring|one_time|deposit|hourly, amount_cents, period, quote_required) ·
`catalog_publications` · `resources` · `offer_templates` · `offers` · `offer_lines` (catalog snapshot) · `offer_revisions` · `offer_approvals` ·
`proposal_shares` · `prospects` (partner-scoped client contacts) · `attributions` (90-day, first-wins) · `orders` · `order_lines` (immutable snapshot) ·
`order_events` · `order_tasks` · `order_messages` (internal vs partner-visible) · `order_files` · `order_payment_events` (admin-verified financial evidence) ·
`commission_ledger` (append-only: estimated → eligible → approved → payable → paid, plus held/disputed/reversed, with entries never updated in place and reversals as new rows) ·
`commission_adjustments` · `payout_batches` · `payout_lines` · `payout_settlements` (method, reference, date, recorded_by) · `notifications` + `notification_attempts` ·
`audit_log` (append-only) · reuse `app.idempotency_keys`.

### Migration numbering (starting at 0070)
`0070_partner_core.sql` (schema, staff, organizations, users, invitations, reserved slugs, `auth_context` extension, helpers `partner.current_partner()`,
`partner.require_partner()`, `partner.require_staff(role)`) · `0071_partner_catalog.sql` · `0072_partner_offers.sql` · `0073_partner_orders.sql` (+ bucket) ·
`0074_partner_commissions.sql` · `0075_partner_payouts.sql` · `0076_partner_notifications_jobs.sql` · `0077_partner_lockdown.sql` (lockdown check covering
`partner`, plus pgTAP-style tests in `supabase/tests/modules/9x_partner_*.test.sql`) · `0078_partner_catalog_seed.sql` (reference import, all
`draft`/`needs_approval`, provenance in columns). Remote names follow `init_00NN_<name>`.

### Commission engine (server-authoritative)
Input = an approved order line snapshot + an admin-verified `order_payment_events` row + the partner's assigned **policy version**. Output = an idempotent
ledger insert keyed `(order_line_id, policy_version_id, event_id, kind)`. Never triggered by an order status alone. Eligibility gates: go-live recorded,
balance paid, W-9 on file, agreement active, and clawback windows tracked as dated conditions (reversal entries if a churn event falls inside the window).
Payout = an admin batch with step-up, then "sent" with a method and reference, then "settled". Nothing is shown as "paid" without a settlement record.

---

## 12. Confirmed facts vs assumptions (key items)

| Statement | Status |
| --- | --- |
| Legacy partners, payouts, leads and links tables are empty; only `vyntex_catalog` in `vx_settings` | **[C]** live SQL 2026-10-22 |
| Legacy effective prices = HTML defaults | **[C]** (no `pricing` key) |
| Owner-stated rates (150/200/250; 20% + 3%; 35%) match S1, S3 and S4 | **[C]** |
| Seller guide's 10% monthly is an older or alternative "Authorized Reseller" model | **[A]** (the guide claims to be the "VYNTEX standard", l.326; owner statement contradicts it) |
| No 2.9% service fee is applied to services anywhere | **[C]** search across all three repos; the only rule found is "No 2.9% service fee line on VYNTEX BUILD or any industry edition" (`config/vyntex-build-pricing.json` rules[6]; `index.html` l.3739) |
| ERP pricing JSON = Master Command `VXB_BASE` | **[C]** programmatic comparison (only `notes` differ) |
| `info@vyntexusa.com` has no auth user in the target project | **[C]** (0 auth users in total) |
| Website reseller portal has live partners | **[A]** not inspected |
| Vercel plan function limits | **[A]** not checked |
| Target project leaked-password protection state | **[A]** not visible through SQL |
| 1099-NEC threshold of $600 stated in legacy text may be outdated for 2026 payments | **[A]** have a tax advisor verify the current threshold before encoding it |
