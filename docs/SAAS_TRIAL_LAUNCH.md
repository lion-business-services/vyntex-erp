# VYNTEX ERP: Seven-day SaaS trial launch guide

## Isolation and deployment
- Preserve the original Supabase project "VYNTEX ERP", which contains Master Command Center data.
- Dedicated shared client project **vyntex-erp-clients** has been created in Lion Business Services, ref `qizmryluifvykablwuxc`, region `us-east-1` (quoted $10/month). The legacy Master Command Center database remains untouched.
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

## Infrastructure verified on 21 October 2026
- New project status: ACTIVE_HEALTHY.
- Full migration sequence 0001–0064: 55 successful migration records. Ten industry rows seeded, 86 tables present.
- Database currently contains zero tenants, zero memberships, zero invitations and zero trial requests.
- Rolled-back verification passed for server-only trial RPC grants, rejection of reserved slugs, repeat-email suppression, and no trial clock before owner activation.
- Supabase security advisors flagged five pre-existing SECURITY DEFINER views requiring review before public launch; authenticated SECURITY DEFINER RPC warnings also need scope-by-scope review.
- Vercel production still runs commit fa7ad9c and has **no** configured core environment variables. Trial preview reports `available:false`.
- Outstanding: system email sender, required Supabase server secrets in Vercel, staging end-to-end invitation/MFA and cross-tenant tests, billing lifecycle, security advisor remediation. Do not enable `TRIAL_SIGNUP_ENABLED` yet.

## Controlled activation checklist
1. **Completed**: approve Supabase organization, region and $10/month project creation; vyntex-erp-clients created.
2. **Database initialized**: all 55 migration files through 0064 applied and ten industries seeded. Initial service-only RPC checks passed; end-to-end tenant RLS, privileged views, and security advisor review remain open.
3. Configure Vercel project vyntex-erp with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, APP_ORIGIN, SESSION_SECRET, TOKEN_ENC_KEY, IP_HASH_SALT, RESEND_API_KEY and SYSTEM_EMAIL_FROM. Secrets are never exposed in browser assets. Configure Auth confirmation redirects and MFA policy.
4. Test sign-in, MFA, owner invitation, token reuse, email failure rollback, expiry, cross-tenant RPC access, storage, public links and webhook isolation in staging.
5. Intentionally set TRIAL_SIGNUP_ENABLED=true ONLY after successful end-to-end tests. Deploy the reviewed SHA, verify production health and the full signup-email-invite-workspace sequence. Never enable ahead of the database and email setup.
6. Complete and approve subscription billing separately: signed webhooks, subscription lifecycle, invoices, retry logic, idempotency, cancellation, refunds, portal and expiry-to-paid conversion. No self-reported payment may unlock access.
7. Add tenant-aware dedicated database routing/migration only once implemented and security tested, retaining workspace URLs.

## Current boundaries
- New Supabase clients project does not exist in the linked account.
- Migration 0064 is applied to the NEW clients project only; it has not been deployed to any legacy Master Command Center or LBS database.
- Production sign-up must remain intentionally disabled until the dedicated clients project, SMTP/Resend, security testing and plan-billing policy are ready.
- Do not describe trial accounts, provider integrations, subscription billing or dedicated-database migration as live until each is tested end to end.

