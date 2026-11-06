-- 0079: every edition can start the public seven-day trial (owner decision of October 29, 2026).
-- 0078 kept quoted editions (professional services, barbershop) out of the self-serve trial because they have no
-- published prices. They now get the same 7 days; when the trial ends, VYNTEX sends their quote and a secure payment
-- link (the operator's payment link with typed amounts, docs/BILLING.md), and the Billing page says so (bill.quoted).
-- app.trial_editions() is kept equal to the editions of the product by scripts/check-pricing.mjs.
create or replace function app.trial_editions() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array['barber', 'build', 'clean', 'events', 'haul', 'landscape', 'practice', 'snow', 'turnover', 'wash']::text[]
$$;
revoke all on function app.trial_editions() from public, anon, authenticated, service_role;
