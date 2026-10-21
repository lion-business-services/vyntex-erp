# VYNTEX ERP: Seven-day SaaS trial launch guide

## Isolation and deployment
- Preserve the original Supabase project "VYNTEX ERP", which contains Master Command Center data.
- Launch new client database "vyntex-erp-clients" only after organization, region, cost and permission are confirmed.
- Keep Lion Business Services Command in its own environment.
- All customer workspaces share erp.vyntexusa.com/<business-slug> and carry a distinct immutable tenant ID.
- One shared database is the starting architecture; tenant-specific database routing/migration is a separate future workstream.

## Available source functionality
- Public /signup form in VYNTEX only (LBS excluded).
- GET /api/auth/trial/status and POST /api/auth/trial/request.
- CSRF, validation, address and email rate limits, privileged server-only database RPC, one-time 72-hour activation token, single trial per email.
- Owner email confirmation through current invitation acceptance; a 7-day trial starts only on successful activation.
- Central tenant access guards deny expired trials even if a scheduled job is delayed.
- Trial countdown and clear links to plans; onboarding is disabled if database or mail credentials are missing.
- No credit card/payment collected. Feature demos do not impersonate connected providers.

## Controlled activation checklist
1. Approve Supabase organization, region and project cost. Create vyntex-erp-clients.
2. On the NEW project only, run the complete pre-existing migrations 0001-0063 and new 0064 in order; seed industries; verify all RLS policies and service-only RPC grants; run database tests and security advisors.
3. Configure Vercel project vyntex-erp with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, APP_ORIGIN, SESSION_SECRET, TOKEN_ENC_KEY, IP_HASH_SALT, RESEND_API_KEY and SYSTEM_EMAIL_FROM. Secrets are never exposed in browser assets. Configure Auth confirmation redirects and MFA policy.
4. Test sign-in, MFA, owner invitation, token reuse, email failure rollback, expiry, cross-tenant RPC access, storage, public links and webhook isolation in staging.
5. Intentionally set TRIAL_SIGNUP_ENABLED=true ONLY after successful end-to-end tests. Deploy the reviewed SHA, verify production health and the full signup-email-invite-workspace sequence. Never enable ahead of the database and email setup.
6. Complete and approve subscription billing separately: signed webhooks, subscription lifecycle, invoices, retry logic, idempotency, cancellation, refunds, portal and expiry-to-paid conversion. No self-reported payment may unlock access.
7. Add tenant-aware dedicated database routing/migration only once implemented and security tested, retaining workspace URLs.

## Current boundaries
- New Supabase clients project does not exist in the linked account.
- Migration 0064 is committed only as a file; it has NOT been applied against a live database.
- Production sign-up must remain intentionally disabled until the dedicated clients project, SMTP/Resend, security testing and plan-billing policy are ready.
- Do not describe trial accounts, provider integrations, subscription billing or dedicated-database migration as live until each is tested end to end.

