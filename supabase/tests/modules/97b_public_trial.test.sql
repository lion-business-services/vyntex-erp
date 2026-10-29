-- Module tests, part 11b: the public seven-day trial and seat counts (0078).
--   only the server key can request a trial; a visitor or a signed-in person cannot; one trial per address, ever, across
--   the public and the operator path, with the same answer for a known address; quoted editions are refused; the
--   address word is checked (reserved words included); an undeliverable request is undone and leaves nothing; the clock
--   starts when the owner accepts; seat_usage counts office members and open office invitations for members only.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('42b. the public seven-day trial and seats') \g /dev/null

-- who may call it
select test.ok(has_function_privilege('service_role', 'public.trial_request_create(text,text,text,text,text,text,text)', 'execute'), 'the server key may request a trial') \g /dev/null
select test.ok(has_function_privilege('service_role', 'public.trial_request_cancel(text)', 'execute'), 'and undo one') \g /dev/null
select test.ok(not has_function_privilege('anon', 'public.trial_request_create(text,text,text,text,text,text,text)', 'execute'), 'a visitor may not') \g /dev/null
select test.ok(not has_function_privilege('authenticated', 'public.trial_request_create(text,text,text,text,text,text,text)', 'execute'), 'nor a signed-in person') \g /dev/null
select test.ok(not has_function_privilege('anon', 'public.trial_request_cancel(text)', 'execute') and not has_function_privilege('authenticated', 'public.trial_request_cancel(text)', 'execute'),
  'nobody but the server may undo one') \g /dev/null
select test.is(test.as('anon', $q$select public.trial_request_create('pt-anon', 'Anon LLC', 'clean', 'anon-pt@example.com', 'A', repeat('a', 64), repeat('b', 64))$q$),
  'error:42501', 'called as a visitor: refused') \g /dev/null
select test.is(test.as('a_owner', $q$select public.trial_request_create('pt-auth', 'Auth LLC', 'clean', 'auth-pt@example.com', 'A', repeat('a', 64), repeat('b', 64))$q$),
  'error:42501', 'called as a signed-in person: refused') \g /dev/null

-- a request through the server key
select test.as('service', $q$select public.trial_request_create('pt-sparkle', 'Sparkle Public LLC', 'clean', ' Pat@Example.com', 'Pat Public', repeat('1', 64), repeat('2', 64))$q$) as made \gset
select test.is(:'made', 'rows:1', 'the server key makes a request') \g /dev/null
select test.ok((select status = 'onboarding' and plan_id = 'trial' and industry_id = 'clean' and trial_started_at is null and trial_expires_at is null
                from public.tenants where slug = 'pt-sparkle'), 'a company in onboarding, on the trial plan, no clock yet') \g /dev/null
select test.ok((select r.email_hash = encode(extensions.digest('pat@example.com', 'sha256'), 'hex') and r.started_at is null
                from app.trial_registrations r join public.tenants t on t.id = r.tenant_id where t.slug = 'pt-sparkle'),
  'the address is registered by its own hash, whatever the caller sent') \g /dev/null
select test.ok((select count(*) = 1 and bool_and(role = 'owner' and email = 'pat@example.com' and token_hash = repeat('2', 64) and expires_at <= now() + interval '72 hours')
                from app.invitations where tenant_id = (select id from public.tenants where slug = 'pt-sparkle')), 'one owner invitation, 72 hours') \g /dev/null
select test.ok(exists (select 1 from app.security_events where kind = 'trial.requested' and meta ->> 'slug' = 'pt-sparkle'),
  'the request is in the security log') \g /dev/null

-- one trial per address, ever, with the same answer
select test.is(public.trial_request_create('pt-sparkle-2', 'Copy LLC', 'build', 'PAT@example.com', 'Pat', repeat('3', 64), repeat('4', 64)),
  'accepted', 'the same address again: the same answer as a new one') \g /dev/null
select test.ok(not exists (select 1 from public.tenants where slug = 'pt-sparkle-2'), 'and nothing new is made') \g /dev/null
select test.ok(not exists (select 1 from app.invitations where token_hash = repeat('4', 64)), 'no second invitation') \g /dev/null
select test.is(public.trial_request_create('pt-ivy', 'Ivy Again LLC', 'clean', 'invited@example.com', 'Ivy', repeat('5', 64), repeat('6', 64)),
  'accepted', 'an address that had an operator''s trial cannot start a public one') \g /dev/null
select test.ok(not exists (select 1 from public.tenants where slug = 'pt-ivy'), 'nothing is made for it') \g /dev/null

-- what is refused
select test.is(public.trial_request_create('pt-practice', 'Tax Office LLC', 'practice', 'tax-pt@example.com', 'T', repeat('7', 64), repeat('8', 64)),
  'quoted_edition', 'a quoted edition (professional services) is refused') \g /dev/null
select test.is(public.trial_request_create('pt-barber', 'Shop LLC', 'barber', 'shop-pt@example.com', 'S', repeat('7', 64), repeat('8', 64)),
  'quoted_edition', 'and so is the barbershop edition') \g /dev/null
select test.ok(not exists (select 1 from public.tenants where slug in ('pt-practice', 'pt-barber')), 'nothing is made for them') \g /dev/null
select test.is(public.trial_request_create('pt-nope', 'Nope LLC', 'nope', 'nope-pt@example.com', 'N', repeat('7', 64), repeat('8', 64)),
  'bad_industry', 'an unknown edition is refused') \g /dev/null
select test.is(public.trial_request_create('start-trial', 'Start LLC', 'clean', 'start-pt@example.com', 'S', repeat('7', 64), repeat('8', 64)),
  'bad_slug', 'the address of the trial page itself is reserved') \g /dev/null
select test.is(public.trial_request_create('pt-sparkle', 'Other LLC', 'clean', 'other-pt@example.com', 'O', repeat('7', 64), repeat('8', 64)),
  'slug_taken', 'a taken address word is refused (the server tries another)') \g /dev/null
select test.is(public.trial_request_create('pt-short', 'X', 'clean', 'x-pt@example.com', 'X', repeat('7', 64), repeat('8', 64)), 'bad_name', 'a one-letter name is refused') \g /dev/null
select test.is(public.trial_request_create('pt-mail', 'Mail LLC', 'clean', 'not-an-email', 'M', repeat('7', 64), repeat('8', 64)), 'bad_email', 'a wrong address is refused') \g /dev/null
select test.is(public.trial_request_create('pt-hash', 'Hash LLC', 'clean', 'hash-pt@example.com', 'H', 'xyz', repeat('8', 64)), 'invalid', 'a malformed hash is refused') \g /dev/null
select test.ok(not has_function_privilege('authenticated', 'app.trial_editions()', 'execute'), 'the edition list is internal') \g /dev/null
select test.ok(app.trial_editions() @> array['build', 'clean'] and not (app.trial_editions() && array['practice', 'barber']), 'it lists priced editions only') \g /dev/null

-- an undeliverable request is undone and leaves nothing behind; the address may then try again
select public.trial_request_create('pt-undone', 'Undone LLC', 'landscape', 'undone-pt@example.com', 'U', repeat('9', 64), repeat('c', 64)) as undone_made \gset
select test.is(:'undone_made', 'created', 'a second address makes its own request') \g /dev/null
select test.is(test.as('service', $q$select public.trial_request_cancel(repeat('c', 64))$q$), 'rows:1', 'the server undoes it') \g /dev/null
select test.ok(not exists (select 1 from public.tenants where slug = 'pt-undone'), 'its address word is free again') \g /dev/null
select test.ok(exists (select 1 from public.tenants where name = 'Undone LLC' and status = 'closed' and slug like 'released-%'),
  'the company is closed (never opened) and kept for the audit trail') \g /dev/null
select test.is(public.trial_request_cancel(repeat('c', 64))::text, 'false', 'undoing it twice changes nothing') \g /dev/null
select test.ok(not exists (select 1 from app.invitations where token_hash = repeat('c', 64)), 'the invitation is gone') \g /dev/null
select test.ok(not exists (select 1 from app.trial_registrations where email_hash = encode(extensions.digest('undone-pt@example.com', 'sha256'), 'hex')), 'the address is free again') \g /dev/null
select test.is(public.trial_request_create('pt-undone', 'Undone LLC', 'landscape', 'undone-pt@example.com', 'U', repeat('9', 64), repeat('d', 64)),
  'created', 'so the same request can be made again') \g /dev/null

-- the clock starts when the owner accepts, and the request can no longer be undone
insert into public.tenant_members (tenant_id, user_id, role, name, email)
  select id, test.new_user('pt_owner'), 'owner', 'Pat Public', 'pat@example.com' from public.tenants where slug = 'pt-sparkle' \g /dev/null
update app.invitations set used_at = now() where token_hash = repeat('2', 64) \g /dev/null
select test.ok((select status = 'active' and trial_expires_at between now() + interval '168 hours' - interval '1 minute' and now() + interval '168 hours' + interval '1 minute'
                from public.tenants where slug = 'pt-sparkle'), 'accepting the invitation opens the company for seven days') \g /dev/null
select test.ok((select started_at is not null from app.trial_registrations r join public.tenants t on t.id = r.tenant_id where t.slug = 'pt-sparkle'), 'the registration records the start') \g /dev/null
select test.is(public.trial_request_cancel(repeat('2', 64))::text, 'false', 'an activated trial can never be undone') \g /dev/null
select test.ok(exists (select 1 from public.tenants where slug = 'pt-sparkle'), 'it is still there') \g /dev/null

-- seats
select id as pt_tenant from public.tenants where slug = 'pt-sparkle' \gset
insert into public.tenant_members (tenant_id, user_id, role, name, email) values
  (:'pt_tenant', test.new_user('pt_staff'), 'staff', 'Sam Staff', 'sam-pt@example.com') \g /dev/null
insert into app.invitations (tenant_id, email, name, role, token_hash, invited_by, created_at, expires_at) values
  (:'pt_tenant', 'mia-pt@example.com', 'Mia', 'manager', repeat('e', 64), null, now(), now() + interval '72 hours'),
  (:'pt_tenant', 'old-pt@example.com', 'Old', 'staff', repeat('f', 63) || '0', null, now() - interval '4 days', now() - interval '1 hour') \g /dev/null
select test.value('pt_owner', format('select public.seat_usage(%L)::text', :'pt_tenant')) as usage \gset
select test.ok((:'usage'::jsonb ->> 'members')::int = 2 and (:'usage'::jsonb ->> 'invites')::int = 1
                and :'usage'::jsonb ->> 'plan' = 'trial' and :'usage'::jsonb ->> 'industry' = 'clean',
  'seat_usage: two office members, one open invitation (the expired one does not count), the plan and the edition') \g /dev/null
select test.is(test.as('a_owner', format('select public.seat_usage(%L)', :'pt_tenant')), 'error:42501', 'another company''s owner cannot read it') \g /dev/null
select test.is(test.as('anon', format('select public.seat_usage(%L)', :'pt_tenant')), 'error:42501', 'nor can a visitor') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '42b. the public seven-day trial and seats' group by section;
