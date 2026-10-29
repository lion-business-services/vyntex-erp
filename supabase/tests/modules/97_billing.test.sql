-- Module tests, part 11: trials by invitation and Stripe billing (0066).
--   nobody can request a trial any more; an operator gives one (one per owner address, ever); the billing tables are
--   closed to every person; only the server key writes billing; the subscription opens, warns, pauses and reopens the
--   company; an operator's own pause is never lifted by a payment; reminders go once; billing events never change.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('42. trials by invitation and billing') \g /dev/null

-- an operator with the second sign-in step done
select test.new_user('bill_op') \g /dev/null
select app.operator_add('bill_op@example.com') \g /dev/null
create function pg_temp.op(q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', test.id('bill_op'), 'role', 'authenticated', 'aal', 'aal2')::text, false);
  perform set_config('role', 'authenticated', false);
  r := test.try(q);
  perform test.logout();
  return r;
exception when others then
  perform test.logout();
  raise;
end $$;
create function pg_temp.op_value(q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', test.id('bill_op'), 'role', 'authenticated', 'aal', 'aal2')::text, false);
  perform set_config('role', 'authenticated', false);
  execute q into r;
  perform test.logout();
  return r;
exception when others then
  perform test.logout();
  raise;
end $$;

-- the public request: a visitor can never call it (0078 gave it back to the server key only; 97b_public_trial checks that)
select test.is(test.as('anon', $q$select public.trial_request_create('pub-trial', 'Pub LLC', 'clean', 'pub@example.com', 'P', repeat('a', 64), repeat('b', 64))$q$),
  'error:42501', 'nor can a visitor') \g /dev/null

-- an operator gives a trial
select pg_temp.op_value($q$select public.operator_create_company('inv-trial', 'Invited Trial LLC', 'clean', 'trial', 'Invited@Example.com', 'Ivy')::text$q$) as made \gset
select test.ok((:'made'::jsonb ->> 'trial')::boolean, 'an operator opens a company on the trial plan') \g /dev/null
select test.ok((select status = 'onboarding' and plan_id = 'trial' and trial_expires_at is null from public.tenants where slug = 'inv-trial'),
  'it waits in onboarding, with no clock yet') \g /dev/null
select test.ok(exists (select 1 from app.trial_registrations r join public.tenants t on t.id = r.tenant_id where t.slug = 'inv-trial'),
  'the owner address is registered for its one trial') \g /dev/null
select test.is(pg_temp.op($q$select public.operator_create_company('inv-trial-2', 'Again LLC', 'clean', 'trial', 'invited@example.com', 'Ivy')$q$),
  'error:23505', 'the same owner address cannot get a second trial') \g /dev/null
select test.ok(not exists (select 1 from public.tenants where slug = 'inv-trial-2'), 'and no second company is made') \g /dev/null
select test.ok(pg_temp.op($q$select public.operator_create_company('inv-paid', 'Paid LLC', 'build', 'builder', 'invited@example.com', 'Ivy')$q$) like 'rows:%',
  'the same address can still be given a paid plan') \g /dev/null
select test.ok((select status = 'active' and plan_id = 'builder' from public.tenants where slug = 'inv-paid'), 'which opens active') \g /dev/null
select test.is(test.as('a_owner', $q$select public.operator_create_company('x-trial', 'X LLC', 'clean', 'trial', 'x@example.com', 'X')$q$),
  'error:42501', 'a company owner cannot give trials') \g /dev/null
insert into public.tenant_members (tenant_id, user_id, role, name, email)
  select id, test.new_user('inv_owner'), 'owner', 'Ivy', 'invited@example.com' from public.tenants where slug = 'inv-trial' \g /dev/null
select test.ok((select status = 'active' and trial_expires_at > now() + interval '6 days' from public.tenants where slug = 'inv-trial'),
  'the clock starts when the owner joins') \g /dev/null

-- the billing tables are closed to people, and the billing functions to everyone but the server
select test.ok(test.blocked(test.as('a_owner', 'select 1 from app.billing_accounts')), 'an owner cannot read billing accounts') \g /dev/null
select test.ok(test.blocked(test.as('a_owner', 'select 1 from app.billing_events')), 'nor billing events') \g /dev/null
select test.is(test.as('a_owner', format($q$select public.billing_sync(%L, 'cus_abcdef1', 'sub_abcdef1', 'active', 'builder', 'monthly', now(), false)$q$, test.id('a'))),
  'error:42501', 'an owner cannot mark their company paid') \g /dev/null
select test.is(test.as('anon', format($q$select public.billing_paid(%L)$q$, test.id('a'))), 'error:42501', 'nor can a visitor') \g /dev/null
select test.is(test.as('a_owner', 'select public.operator_billing()'), 'error:42501', 'an owner cannot see every company''s billing') \g /dev/null
select test.ok(pg_temp.op('select public.operator_billing()') = 'rows:1', 'an operator can') \g /dev/null
select test.ok(test.as('service', format($q$select public.billing_context(%L, %L)$q$, test.id('a_owner'), test.id('a'))) = 'rows:1', 'the server reads the context') \g /dev/null
select test.ok((select public.billing_context(test.id('a_staff'), test.id('a'))) is null, 'staff get no billing context') \g /dev/null
select test.ok((select public.billing_context(test.id('a_owner'), test.id('a')) ->> 'role') = 'owner', 'the owner does') \g /dev/null

-- one Stripe customer per company
select test.ok(public.billing_customer_set(test.id('b'), 'cus_bbbbbb1'), 'a company gets its customer') \g /dev/null
select test.ok(not public.billing_customer_set(test.id('b'), 'cus_other12'), 'and keeps it') \g /dev/null
select test.is(public.billing_tenant_of_customer('cus_bbbbbb1')::text, test.id('b')::text, 'a customer leads back to its company') \g /dev/null

-- the trial company subscribes
select public.billing_sync((select id from public.tenants where slug = 'inv-trial'), 'cus_trial01', 'sub_trial01', 'active', 'pro', 'monthly', now() + interval '30 days', false) \g /dev/null
select test.ok((select status = 'active' and plan_id = 'pro' and trial_expires_at is null from public.tenants where slug = 'inv-trial'),
  'paying ends the trial and sets the plan') \g /dev/null

-- a payment fails: grace, then a pause, then paying reopens
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb1', 'active', null, 'monthly', now() + interval '30 days', false) \g /dev/null
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb1', 'past_due', null, 'monthly', now() + interval '30 days', false) as late \gset
select test.ok((:'late'::jsonb ->> 'grace_until')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute',
  'a failed payment gives seven days') \g /dev/null
select test.ok((select status = 'active' from public.tenants where id = test.id('b')), 'the company stays open meanwhile') \g /dev/null
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb1', 'past_due', null, 'monthly', now() + interval '30 days', false) \g /dev/null
select test.ok((select grace_until < now() + interval '7 days 1 minute' from app.billing_accounts where tenant_id = test.id('b')), 'a repeated failure does not extend it') \g /dev/null
update app.billing_accounts set grace_until = now() - interval '1 minute' where tenant_id = test.id('b') \g /dev/null
select test.ok(public.billing_enforce_grace() @> jsonb_build_array(jsonb_build_object('tenant_id', test.id('b'))), 'after the grace period the company is paused') \g /dev/null
select test.ok((select status = 'suspended' from public.tenants where id = test.id('b')), 'and closed to its people, records kept') \g /dev/null
select test.ok(public.billing_enforce_grace() = '[]'::jsonb, 'once') \g /dev/null
select public.billing_paid(test.id('b')) \g /dev/null
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb1', 'active', null, 'monthly', now() + interval '30 days', false) \g /dev/null
select test.ok((select status = 'active' from public.tenants where id = test.id('b')), 'paying reopens it') \g /dev/null
select test.ok((select grace_until is null and last_payment_at is not null and not paused_by_billing from app.billing_accounts where tenant_id = test.id('b')), 'with the grace period cleared') \g /dev/null

-- an operator's own pause is never lifted by a payment
update public.tenants set status = 'suspended' where id = test.id('b') \g /dev/null
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb1', 'active', null, 'monthly', now() + interval '31 days', false) \g /dev/null
select test.ok((select status = 'suspended' from public.tenants where id = test.id('b')), 'a company paused by an operator stays paused when Stripe says active') \g /dev/null
update public.tenants set status = 'active' where id = test.id('b') \g /dev/null

-- the subscription ends
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb1', 'canceled', null, 'monthly', now(), false) \g /dev/null
select test.ok((select status = 'suspended' from public.tenants where id = test.id('b')), 'an ended subscription pauses the company') \g /dev/null
select public.billing_sync(test.id('b'), 'cus_bbbbbb1', 'sub_bbbbbb2', 'active', null, 'monthly', now() + interval '30 days', false) \g /dev/null
select test.ok((select status = 'active' from public.tenants where id = test.id('b')), 'a new subscription opens it again') \g /dev/null

-- events: once each, never changed
select test.ok(public.billing_event_add(test.id('b'), 'invoice.paid', 'in_test0001', 11900, 'USD', 'paid', '{}'), 'an event is kept') \g /dev/null
select test.ok(not public.billing_event_add(test.id('b'), 'invoice.paid', 'in_test0001', 11900, 'usd', 'paid', '{}'), 'the same event twice is kept once') \g /dev/null
select test.is(test.try($q$update app.billing_events set amount_cents = 1 where stripe_id = 'in_test0001'$q$), 'error:42501', 'an event is never changed') \g /dev/null
select test.is(test.as('service', $q$delete from app.billing_events where stripe_id = 'in_test0001'$q$), 'error:42501', 'nor removed by the server') \g /dev/null
select test.ok((select (e ->> 'paid_cents')::bigint = 11900 from jsonb_array_elements(pg_temp.op_value('select public.operator_billing()::text')::jsonb) e where (e ->> 'tenant_id')::uuid = test.id('b')),
  'the operator sees what was paid') \g /dev/null

-- reminders, once each
update public.tenants set trial_expires_at = now() + interval '2 days', plan_id = 'trial' where slug = 'inv-trial' \g /dev/null
select test.ok(public.billing_notices_due() @> jsonb_build_array(jsonb_build_object('kind', 'trial_3d', 'slug', 'inv-trial')), 'a trial ending in two days is reminded') \g /dev/null
select test.ok(public.billing_notice_mark((select id from public.tenants where slug = 'inv-trial'), 'trial_3d', to_char(now() + interval '2 days', 'YYYY-MM-DD')), 'the reminder is marked') \g /dev/null
select test.ok(not (public.billing_notices_due() @> jsonb_build_array(jsonb_build_object('kind', 'trial_3d', 'slug', 'inv-trial'))), 'and not listed again') \g /dev/null
select test.ok(not public.billing_notice_mark((select id from public.tenants where slug = 'inv-trial'), 'trial_3d', to_char(now() + interval '2 days', 'YYYY-MM-DD')), 'nor marked twice') \g /dev/null

-- company B back as it was, for anything that runs after this file
update public.tenants set status = 'active' where id = test.id('b') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '42. trials by invitation and billing' group by section;
