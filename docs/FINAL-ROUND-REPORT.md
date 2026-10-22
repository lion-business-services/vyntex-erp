# VYNTEX ERP: final review and enhancement round

Date: October 13, 2026. Scope: full audit of the `vyntex-erp-main` codebase and the public demo at erp.vyntexusa.com, then the fixes and enhancements needed to sell and demo the product.

## 1. What the audit found

| Area | Finding |
|---|---|
| Build, typecheck, wording, sample data | Clean before and after this round. |
| Unit tests | 291 of 291 before. 297 of 297 after (6 new tests for the connector step and the new sample records). |
| Page matrix (9 editions, English and Spanish, desktop and phone) | 1,772 pages, 0 issues before this round. |
| Workflow tests | 651 of 651 before this round. |
| Product name | Every screen still said "VYNTEX Command". |
| Integrations in the demo | Every card said "Not connected" and Connect did nothing, so a demo could not show what Gmail, Calendar or any other connection does. Google Drive, Sheets, Contacts, Forms and Alerts were not listed at all. |
| Field editions (BUILD, CLEAN, LANDSCAPE, WASH, HAUL, SNOW, TURNOVER, EVENTS) | Integrations, e-signature, reviews, service catalog, opportunities, social media, security and audit trail were switched off, so 8 of the 9 demos could not show them. |
| Automations | The rules ran correctly, but no rule used a connected app, so "hyper integrated" could not be shown. |
| Landing page | Working and animated. No section showed the connections, and the top menu cut off "Request a demo" between 1,100 and 1,240 pixels wide. |
| Live hosting (Vercel project `vyntex-erp`) | Deployed from Git `main`, serving erp.vyntexusa.com. The project has **no environment variables**: no Supabase, no Resend. See section 4. |

## 2. What changed

**Name.** VYNTEX ERP everywhere: lockup, page titles, emails, certificates, docs, tests. The hero now reads "Run your entire business from one AI-powered ERP." The internal VYNTEX Command Center app and the LBS Command product keep their names.

**Integrations, live in the demo.**
- 22 connections in 7 groups. New: Google Drive, Google Sheets, Google Contacts, Google Forms, Google Alerts, Microsoft 365 Outlook, Stripe, Slack, Zapier and webhooks. Each new one is labelled "On the roadmap" in the demo and on the landing page, because no server adapter exists for it yet.
- In the demo, Connect opens a consent screen that explains what the real connection asks for, then simulates it. "Connect Google Workspace" connects all 10 Google apps at once.
- A connected card shows a sample account on the reserved `.example` domain, what the connection does with the sample company's own records (every number is counted from those records), Test, Sync now, Disconnect and a live activity feed.
- A simulated connection is its own state, "Connected · demo". It is never shown as a real connection, nothing leaves the browser, and Reset clears it. A live workspace never reads it.

**Automations that use the apps.**
- New rule step: "Send to a connected app" (Google Calendar, Meet, Drive, Sheets, Contacts, QuickBooks, Slack, Zapier). It is available in the rule builder.
- Four new shipped rules in every edition, plus one more for editions with appointments:
  - Google Workspace: new client set up (lead won: Contacts, Drive folder, Sheets row, Calendar, Slack)
  - Google Calendar and Slack: new work scheduled
  - QuickBooks and Slack: payment received
  - Google Drive: file every document sent
  - Google Calendar and Meet: appointment booked
- A rule made only of app steps records nothing until one of its apps is connected, so the history stays clean, and in a live workspace it waits instead of failing.
- On the Automations page, "Try it" now goes further: add a sample lead, then "Win it now". The intake rule, the won-lead rule and the Google rule all run and show in "What ran", in order.

**All modules in every edition.** The eight field editions now include Services, Opportunities, Signatures, Reviews, Social media, Integrations, Security and Audit trail. Their samples get records built from each edition's own work: a priced service catalog, two signature requests (one waiting, one completed), review requests with star ratings, three social posts and cross-sell opportunities. No real person, company or opinion appears anywhere, and every screen labels the records as sample data.

**Landing page.** A new "Works with the tools you already use" section, with "Ready to connect" or "On the roadmap" on each app, and a link into the live demo. The automation showcase has a fourth tab for the Google Workspace rule. "Integrations" was added to the top and footer menus. The menu now folds into the button below 1,240 pixels, so nothing gets cut off. The guided tour has a new Integrations step.

## 3. Verification (final run)

| Suite | Result |
|---|---|
| Typecheck, pricing, wording and sample-data checks | Clean |
| Unit tests | 297 of 297 |
| Provider adapters | 208 of 208 |
| Security scripts | 101 of 101; secret, personal data and bundle scans clean for both deployments |
| Deployment split | 79 of 79 |
| Page matrix (9 editions, English and Spanish, desktop and phone) | 2,028 pages, 0 issues (up from 1,772: the field editions now have 52 screens each) |
| Workflow tests | 651 of 651 |
| Motion and keyboard | 29 of 29 (the theme switch now shows its focus ring on the button itself) |
| Module suites | Appointments 100 of 100, catalog 221 of 221, communications 93 of 93, operations 69 of 69, security 80 of 80 |

## 4. Still needed before clients can sign up on their own

1. **Supabase projects** (cost, your approval). The live workspace code, the database (55 tables, row-level security on every one) and sign-in are built and tested on a local stand-in, but no Supabase project exists, so no company workspace can be created yet. Today a new client starts with "Request a demo", and VYNTEX sets up the workspace for them.
2. **Environment variables on Vercel** (you set these outside Claude): at minimum `RESEND_API_KEY`, `DEMO_REQUEST_TO` and `DEMO_REQUEST_FROM`, so the Request a demo form emails you. Without them the form honestly tells the visitor it was not sent and offers phone, WhatsApp and email instead.
3. **Provider accounts** for the "Ready to connect" apps: Google Cloud project and OAuth verification (start early), Square, Intuit, Meta, WhatsApp, Dialpad, SMS sender, AI key.
4. **Server adapters** for the nine "On the roadmap" connections.
5. **Self-serve sign-up** is deliberately not built: accounts are by invitation only, which is the safer default. A self-serve onboarding flow with payment can be added once item 1 is approved.
