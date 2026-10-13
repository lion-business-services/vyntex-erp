# VYNTEX ERP go-live: client workspaces at erp.vyntexusa.com/<business>

Decided by the owner on October 13, 2026: **one shared Supabase project for every client company** (each company kept apart by the database's row level security), with a **dedicated project only for a client who asks for one** (a paid upgrade). Every client keeps the address `erp.vyntexusa.com/<business>`, including a client moved to a dedicated database later.

## How a new client gets their workspace

1. The client buys a plan.
2. IN: browser, `https://erp.vyntexusa.com/admin`. Sign in as a VYNTEX operator, with the authenticator code.
3. Press **New client workspace**. Type the business name (the address word is suggested from it), choose the edition and the plan, type the owner's name and email, press **Create the workspace**.
4. The screen shows the workspace address and the owner's one-time invitation link. When system email is set up, the owner gets the link by email. Without email, press **Copy the message for the client** and send it by WhatsApp, text or email.
5. The owner opens the link, sets a password (12 characters or more, checked against common passwords), adds an authenticator app, saves the recovery codes and lands in the workspace.
6. The dashboard shows **Get <business> ready**: business details, sign-in protection, team, services, clients, connected apps, automation rules. Each step ticks itself off.
7. From then on the owner signs in at `erp.vyntexusa.com/<business>`, invites the team from Settings, Team, and connects Gmail, Google Calendar and the other apps from Integrations.

In the console, staff can also send a new owner invitation (while a company has no owner yet), and **Pause** or **Reactivate** a workspace (a paused workspace keeps every record; nobody in it can open it until it is reactivated). Every action is written to the security log.

## Security in place

| What | How |
|---|---|
| Accounts | Invitation only. There is no public sign-up. Invitation links work once, expire in 72 hours, and only their hash is stored. |
| Second step | Authenticator app (TOTP) with 10 recovery codes. Required for owners and managers of every company (set by `supabase/setup/go-live.sql`); a company can require it for more roles. Operators always need it. |
| Sessions | Sealed, HttpOnly cookies; idle timeout; 12-hour maximum; sign out everywhere; a fresh identity check before sensitive actions. |
| Company isolation | Row level security forced on every table, 6,472 automated database assertions, including deliberate-breakage checks. |
| Limits | Sign-in lockouts and rate limits kept in the database. |
| Operators | A separate list written only in SQL. Operators see company names, addresses, plans and owner emails, never a company's records. |

## Steps to switch it on

| # | Step | Who |
|---|---|---|
| 1 | Create the Supabase project `vyntex-erp-clients` (organization Lion Business Services, region East US; adds the cost of one more project on the Pro plan) | Owner approval; Claude or the owner |
| 2 | Apply every file of `supabase/migrations` in order, then `supabase/seed.sql`, then check with `supabase/tests/verify_remote.sql` | Claude (Supabase connector) |
| 3 | Run parts 1 to 3 of `supabase/setup/go-live.sql`; keep the token it returns | Claude |
| 4 | Supabase Dashboard, Authentication: **Allow new users to sign up** off; Multi-Factor: TOTP on; URL Configuration: Site URL `https://erp.vyntexusa.com` | Owner (dashboard switches) |
| 5 | Vercel project `vyntex-erp`, Environment Variables (Production): `VX_DEPLOY=vyntex`, `APP_ORIGIN=https://erp.vyntexusa.com`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`, `TOKEN_ENC_KEY`, `IP_HASH_SALT`, `CRON_SECRET` | Claude (no secret is shown in chat) |
| 6 | Vercel: `SUPABASE_SERVICE_ROLE_KEY` copied from Supabase, Project Settings, API Keys, straight into Vercel, ticked Sensitive | **Owner only** (a server key never passes through chat) |
| 7 | Merge the release branch into `main`; Vercel deploys erp.vyntexusa.com | Owner approval |
| 8 | Open `https://erp.vyntexusa.com/invite/<token from step 3>`, set the password, add the authenticator; then part 4 of `go-live.sql` makes that account an operator | Owner, then Claude |
| 9 | System email: Resend account, verify a sending subdomain of vyntexusa.com (DNS records in GoDaddy), then `RESEND_API_KEY`, `SYSTEM_EMAIL_FROM`, `DEMO_REQUEST_TO`, `DEMO_REQUEST_FROM` in Vercel. Until then, invitations are copied and sent by hand, and **password resets cannot be emailed** | Owner |

## A dedicated database for one client (later, on request)

Create a second Supabase project and Vercel project for that client, apply the same migrations, copy the client's records with the insert-only migration tool (`tools/migrate-nova`, dry run first), then route `erp.vyntexusa.com/<business>` on the main Vercel project to the dedicated deployment (a routing rule that is prepared and tested at that time). The client's address does not change.
