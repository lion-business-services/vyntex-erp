-- Module tests, part 10: the seven-day trial (0064) and its repair (0065).
--   a trial request makes a company in onboarding, an owner invitation and nothing else; one trial per email; the trial
--   clock starts when the owner accepts and never restarts; an open trial works like any company, an ended trial is
--   closed to everyone in it, and its scheduled work waits; the edition's role matrix and the company's own role changes
--   keep counting during a trial; only a VYNTEX operator converts a trial into a paid plan.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('41. the seven-day trial') \g /dev/null

-- the request (what api/_lib/trial.js calls with the server key)
select public.trial_request_create('trial-sample', 'Trial Sample LLC', 'clean', 'Owner@Example.com ', 'Tina Trial',
  repeat('a', 64), repeat('b', 64)) as r1 \gset
select test.is(:'r1', 'created', 'a trial request makes a company') \g /dev/null
select test.ok((select status = 'onboarding' and plan_id = 'trial' and trial_started_at is null and trial_expires_at is null
                from public.tenants where slug = 'trial-sample'), 'in onboarding, on the trial plan, with no clock yet') \g /dev/null
select test.ok((select count(*) = 1 and bool_and(role = 'owner' and email = 'owner@example.com' and expires_at <= now() + interval '72 hours')
                from app.invitations where tenant_id = (select id from public.tenants where slug = 'trial-sample')),
  'and one owner invitation for the address, valid 72 hours') \g /dev/null
select test.is(public.trial_request_create('trial-other', 'Other LLC', 'clean', 'owner@example.com', 'Tina', repeat('a', 64), repeat('c', 64)),
  'accepted', 'the same email asking again gets the same answer and nothing new') \g /dev/null
select test.ok(not exists (select 1 from public.tenants where slug = 'trial-other'), 'no second company for that email') \g /dev/null
select test.is(public.trial_request_create('trial-sample', 'Copy LLC', 'clean', 'new@example.com', 'Nora', repeat('d', 64), repeat('e', 64)),
  'slug_taken', 'a taken address is refused') \g /dev/null
select test.is(public.trial_request_create('admin', 'Admin LLC', 'clean', 'x@example.com', 'X', repeat('f', 64), repeat('0', 64)),
  'bad_slug', 'a reserved address is refused') \g /dev/null
select test.is(public.trial_request_create('fine-name', 'Fine LLC', 'nope', 'y@example.com', 'Y', repeat('1', 64), repeat('2', 64)),
  'bad_industry', 'an unknown edition is refused') \g /dev/null
select test.is(test.as('a_owner', $q$select public.trial_request_create('a-b-c', 'X', 'clean', 'z@example.com', 'Z', repeat('3', 64), repeat('4', 64))$q$),
  'error:42501', 'nobody signed in can call it: the server key only') \g /dev/null

-- the clock starts when the owner accepts, once
insert into public.tenant_members (tenant_id, user_id, role, name, email)
  select id, test.new_user('tr_owner'), 'owner', 'Tina Trial', 'owner@example.com' from public.tenants where slug = 'trial-sample' \g /dev/null
select test.ok((select status = 'active' and trial_started_at is not null
                and trial_expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute'
                from public.tenants where slug = 'trial-sample'), 'accepting the invitation opens the company for seven days') \g /dev/null
select trial_expires_at as first_deadline from public.tenants where slug = 'trial-sample' \gset
insert into public.tenant_members (tenant_id, user_id, role, name, email)
  select id, test.new_user('tr_owner2'), 'owner', 'Second Owner', 'owner2@example.com' from public.tenants where slug = 'trial-sample' \g /dev/null
update public.tenant_members set role = 'owner' where user_id = test.id('tr_owner') \g /dev/null
select test.ok((select trial_expires_at = :'first_deadline'::timestamptz from public.tenants where slug = 'trial-sample'),
  'the clock never restarts') \g /dev/null

-- a company on a trial (company A, for this part). The company's own role changes keep counting: gateway.sql checks that.
update public.tenants set plan_id = 'trial', trial_started_at = now() - interval '1 day', trial_expires_at = now() + interval '6 days' where id = test.id('a') \g /dev/null
select test.ok(not test.blocked(test.as('a_owner', format('select 1 from public.clients where tenant_id = %L', test.id('a')))), 'an open trial works like any company') \g /dev/null
select test.ok(test.id('a') = any (test.value('a_owner', $q$select app.tenants_can('write')::text$q$)::uuid[]), 'the owner may write') \g /dev/null

-- an ended trial
update public.tenants set trial_expires_at = now() - interval '1 minute', trial_started_at = now() - interval '7 days 1 minute' where id = test.id('a') \g /dev/null
select test.ok(test.blocked(test.as('a_owner', format('select 1 from public.clients where tenant_id = %L', test.id('a')))), 'an ended trial is closed to its owner') \g /dev/null
select test.ok(test.blocked(test.as('a_staff', format($q$insert into public.tasks (tenant_id, title) values (%L, 'After the trial')$q$, test.id('a')))), 'nothing can be written') \g /dev/null
select test.is(test.value('a_owner', format('select coalesce(app.member_role(%L), %L)', test.id('a'), 'none')), 'none', 'no role in it') \g /dev/null
select test.is(test.value('a_owner', format('select cardinality(app.my_permissions(%L))::text', test.id('a'))), '0', 'no permissions') \g /dev/null
select test.ok(not (test.id('a') = any (test.value('a_owner', $q$select app.my_member_ids()::text$q$)::uuid[])), 'no membership counts') \g /dev/null
select test.ok(test.value('a_owner', $q$select public.auth_context()::text$q$)::jsonb -> 'memberships' @> jsonb_build_array(jsonb_build_object('slug', (select slug from public.tenants where id = test.id('a')), 'status', 'suspended')),
  'the sign-in still lists it, as paused, so the person is told why') \g /dev/null
select test.ok(not test.blocked(test.as('b_owner', format('select 1 from public.clients where tenant_id = %L', test.id('b')))), 'other companies are not affected') \g /dev/null

-- scheduled work of an ended trial waits
select public.job_enqueue('trial.check', '{}'::jsonb, '2000-01-01'::timestamptz, test.id('a'), 'trial-wait-1', 3) \g /dev/null
select public.job_enqueue('trial.check', '{}'::jsonb, '2000-01-01'::timestamptz, test.id('b'), 'trial-run-1', 3) \g /dev/null
select public.job_claim('test-runner', 50, 60) as claimed \gset
select test.ok(not (:'claimed'::jsonb @> jsonb_build_array(jsonb_build_object('tenant_id', test.id('a'), 'kind', 'trial.check'))), 'an ended trial''s job is not run') \g /dev/null
select test.ok(:'claimed'::jsonb @> jsonb_build_array(jsonb_build_object('tenant_id', test.id('b'), 'kind', 'trial.check')), 'other companies'' jobs run') \g /dev/null
select test.ok((select status = 'queued' from app.jobs where idem_key = 'trial-wait-1'), 'it waits in the queue') \g /dev/null

-- converting
select test.is(test.as('a_owner', format($q$select public.operator_convert_trial(%L, 'builder')$q$, test.id('a'))), 'error:42501', 'the owner cannot convert their own trial') \g /dev/null
select test.is(test.as('anon', format($q$select public.operator_convert_trial(%L, 'builder')$q$, test.id('a'))), 'error:42501', 'nor can anyone else') \g /dev/null
-- what the operator's call does, run as the database owner
update public.tenants set plan_id = 'builder', trial_expires_at = null where id = test.id('a') \g /dev/null
select test.ok(not test.blocked(test.as('a_owner', format('select 1 from public.clients where tenant_id = %L', test.id('a')))), 'a converted company opens again with every record') \g /dev/null
select public.job_claim('test-runner', 50, 60) as claimed2 \gset
select test.ok(:'claimed2'::jsonb @> jsonb_build_array(jsonb_build_object('tenant_id', test.id('a'), 'kind', 'trial.check')), 'and its waiting work runs') \g /dev/null

-- company A back as it was, for anything that runs after this file
update public.tenants set plan_id = 'builder', trial_started_at = null, trial_expires_at = null where id = test.id('a') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '41. the seven-day trial' group by section;
