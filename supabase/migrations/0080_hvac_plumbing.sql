-- 0080: two new field editions, VYNTEX HVAC and VYNTEX PLUMBING (src/packs/hvac, src/packs/plumbing).
-- Both are field editions (app.edition_family returns 'field' for any id that is not practice or barber), priced on the
-- same Essential, Pro and Elite plans as the other field editions (config/vyntex-build-pricing.json). Reference rows
-- only: no customer data. Safe to repeat.
insert into public.industries (id, product_name, sort_order) values
  ('hvac',     'VYNTEX HVAC',     11),
  ('plumbing', 'VYNTEX PLUMBING', 12)
on conflict (id) do update
  set product_name = excluded.product_name,
      sort_order = excluded.sort_order;

-- The public seven-day trial covers every edition (0079), so the two new ones too.
-- app.trial_editions() is kept equal to the editions of the product by scripts/check-pricing.mjs.
create or replace function app.trial_editions() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array['barber', 'build', 'clean', 'events', 'haul', 'hvac', 'landscape', 'plumbing', 'practice', 'snow', 'turnover', 'wash']::text[]
$$;
revoke all on function app.trial_editions() from public, anon, authenticated, service_role;
