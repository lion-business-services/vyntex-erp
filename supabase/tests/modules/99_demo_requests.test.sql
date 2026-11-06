-- Module tests, part 13: demo requests in the operator console (0077).
--   only an operator with the second sign-in step done reads the requests; anyone else (a visitor, a signed-in owner,
--   the server key, an operator with a password alone) is refused; the latest 100, newest first; each tells which
--   workspace was already made for that email (an active owner, an open or used owner invitation, never a revoked one);
--   the network address hash, the browser signature and the consent evidence are never returned.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('44. demo requests in the operator console') \g /dev/null

-- an operator; with the second step (op), with a password only (op_aal1)
select test.new_user('demo_op') \g /dev/null
select app.operator_add('demo_op@example.com') \g /dev/null
create function pg_temp.op_value(q text, aal text default 'aal2') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', test.id('demo_op'), 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
  begin
    execute q into r;
  exception when others then
    r := 'error:' || sqlstate;
  end;
  perform test.logout();
  return r;
end $$;

-- the requests, as api/demo-request.js stores them with the server key
insert into public.demo_requests (created_at, name, business, industry, phone, email, language, contact_method, team_size, message,
                                  consent, consent_text, consent_at, email_delivered, source_ip_hash, user_agent)
values
  (now() - interval '3 hours', 'Nadia Nobody', 'Nobody Cleaning', 'clean', '+15555550101', 'nadia@nobody.example', 'es', 'whatsapp', '2-5', 'Two vans.',
   true, 'I agree to be contacted by VYNTEX USA about this request.', now(), true, repeat('f', 64), 'Sample Browser/1.0'),
  (now() - interval '2 hours', 'Olga Owner', 'Owner Build LLC', 'build', '+15555550102', 'Demo_Owner@Example.com', 'en', 'phone', '6-15', null,
   true, 'I agree to be contacted by VYNTEX USA about this request.', now(), true, repeat('e', 64), 'Sample Browser/1.0'),
  (now() - interval '1 hour', 'Ivan Invited', 'Invited Wash', 'wash', '+15555550103', 'ivan@invited.example', 'en', 'email', '1', 'Gutters too.',
   true, 'I agree to be contacted by VYNTEX USA about this request.', now(), false, null, null),
  (now() - interval '30 minutes', 'Rita Revoked', 'Revoked Haul', 'haul', '+15555550104', 'rita@revoked.example', 'en', 'phone', '16+', null,
   true, 'I agree to be contacted by VYNTEX USA about this request.', now(), true, null, null) \g /dev/null

-- who is refused
select test.is(test.as('anon', 'select public.operator_demo_requests()'), 'error:42501', 'a visitor cannot read the demo requests') \g /dev/null
select test.is(test.as('service', 'select public.operator_demo_requests()'), 'error:42501', 'nor can the server key, through this function') \g /dev/null
select test.is(test.as('a_owner', 'select public.operator_demo_requests()'), 'error:42501', 'nor a signed-in client owner') \g /dev/null
select test.is(pg_temp.op_value('select public.operator_demo_requests()::text', 'aal1'), 'error:42501', 'nor an operator with a password alone') \g /dev/null
select app.operator_remove('demo_op@example.com') \g /dev/null
select test.is(pg_temp.op_value('select public.operator_demo_requests()::text'), 'error:42501', 'nor a removed operator') \g /dev/null
select app.operator_add('demo_op@example.com') \g /dev/null

-- what the operator sees
select pg_temp.op_value('select public.operator_demo_requests()::text') as seen \gset
select test.ok(jsonb_typeof(:'seen'::jsonb) = 'array' and jsonb_array_length(:'seen'::jsonb) >= 4, 'an operator sees the requests') \g /dev/null
create function pg_temp.newest_first(p jsonb) returns boolean language sql as
$$ select coalesce(bool_and(a.at >= b.at), true) from (select (e ->> 'created_at')::timestamptz as at, o from jsonb_array_elements(p) with ordinality x(e, o)) a
   join (select (e ->> 'created_at')::timestamptz as at, o from jsonb_array_elements(p) with ordinality x(e, o)) b on b.o = a.o + 1 $$;
create function pg_temp.pos(p jsonb, p_name text) returns bigint language sql as
$$ select o from jsonb_array_elements(p) with ordinality x(e, o) where e ->> 'name' = p_name $$;
select test.ok(pg_temp.newest_first(:'seen'::jsonb) and pg_temp.pos(:'seen'::jsonb, 'Rita Revoked') < pg_temp.pos(:'seen'::jsonb, 'Ivan Invited')
               and pg_temp.pos(:'seen'::jsonb, 'Ivan Invited') < pg_temp.pos(:'seen'::jsonb, 'Olga Owner')
               and pg_temp.pos(:'seen'::jsonb, 'Olga Owner') < pg_temp.pos(:'seen'::jsonb, 'Nadia Nobody'), 'newest first') \g /dev/null
select test.ok((select bool_and(e ->> 'workspace' is null) from jsonb_array_elements(:'seen'::jsonb) e
                where e ->> 'name' in ('Nadia Nobody', 'Olga Owner', 'Ivan Invited', 'Rita Revoked')), 'no workspace for anyone yet') \g /dev/null
select test.ok((select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k)
                 = array['business', 'contact_method', 'created_at', 'email', 'id', 'industry', 'language', 'message', 'name', 'phone', 'team_size', 'workspace'])
                from jsonb_array_elements(:'seen'::jsonb) e), 'exactly the contact fields and the workspace, nothing else') \g /dev/null
select test.ok(:'seen' not like '%ffffffffff%' and :'seen' not like '%Sample Browser%' and :'seen' not like '%I agree to be contacted%',
  'never the address hash, the browser signature or the consent evidence') \g /dev/null
select test.ok((select e ->> 'email' = 'nadia@nobody.example' and e ->> 'phone' = '+15555550101' and e ->> 'language' = 'es'
                       and e ->> 'contact_method' = 'whatsapp' and e ->> 'team_size' = '2-5' and e ->> 'message' = 'Two vans.' and e ->> 'industry' = 'clean'
                from jsonb_array_elements(:'seen'::jsonb) e where e ->> 'name' = 'Nadia Nobody'), 'with what the person typed') \g /dev/null

-- the workspace of each request
-- an active owner with the same email (any letter case)
insert into public.tenants (slug, name, industry_id, plan_id, status) values ('demo-owner-build', 'Owner Build LLC', 'build', 'builder', 'active') \g /dev/null
insert into public.tenant_members (tenant_id, user_id, role, name, email)
  select id, test.new_user('demo_owner'), 'owner', 'Olga Owner', 'demo_owner@example.com' from public.tenants where slug = 'demo-owner-build' \g /dev/null
-- an open owner invitation, made the way the console makes it
select pg_temp.op_value($q$select public.operator_create_company('invited-wash', 'Invited Wash', 'wash', 'trial', 'Ivan@Invited.example', 'Ivan Invited')::text$q$) \g /dev/null
-- an invitation that was replaced by one for someone else no longer counts
select pg_temp.op_value($q$select public.operator_create_company('revoked-haul', 'Revoked Haul', 'haul', 'trial', 'rita@revoked.example', 'Rita')::text$q$) \g /dev/null
select pg_temp.op_value(format($q$select public.operator_reinvite(%L, 'someone@else.example', 'Someone')::text$q$, (select id from public.tenants where slug = 'revoked-haul'))) \g /dev/null

select pg_temp.op_value('select public.operator_demo_requests()::text') as seen2 \gset
create function pg_temp.ws(p_name text, p_seen jsonb) returns text language sql as
$$ select coalesce((select e ->> 'workspace' from jsonb_array_elements(p_seen) e where e ->> 'name' = p_name), 'none') $$;
select test.is(pg_temp.ws('Olga Owner', :'seen2'), 'demo-owner-build', 'an active owner with the same email: that workspace') \g /dev/null
select test.is(pg_temp.ws('Ivan Invited', :'seen2'), 'invited-wash', 'an open owner invitation with the same email: that workspace') \g /dev/null
select test.is(pg_temp.ws('Rita Revoked', :'seen2'), 'none', 'a revoked invitation does not count') \g /dev/null
select test.is(pg_temp.ws('Nadia Nobody', :'seen2'), 'none', 'nobody with that email: no workspace') \g /dev/null
-- a used invitation keeps counting after the owner joined
update app.invitations set used_at = now() where email = 'ivan@invited.example' \g /dev/null
select test.is(pg_temp.ws('Ivan Invited', pg_temp.op_value('select public.operator_demo_requests()::text')::jsonb), 'invited-wash', 'a used owner invitation: that workspace') \g /dev/null
-- a closed company does not count
update public.tenants set status = 'closed' where slug = 'demo-owner-build' \g /dev/null
select test.is(pg_temp.ws('Olga Owner', pg_temp.op_value('select public.operator_demo_requests()::text')::jsonb), 'none', 'a closed company does not count') \g /dev/null

-- the latest 100 only
insert into public.demo_requests (created_at, name, email, language)
  select now() - interval '30 days' - n * interval '1 minute', 'Old Request ' || n, 'old' || n || '@example.com', 'en' from generate_series(1, 110) n \g /dev/null
select pg_temp.op_value('select public.operator_demo_requests()::text') as seen3 \gset
select test.is(jsonb_array_length(:'seen3'::jsonb)::text, '100', 'the latest 100 requests, no more') \g /dev/null
select test.ok(pg_temp.newest_first(:'seen3'::jsonb) and pg_temp.pos(:'seen3'::jsonb, 'Rita Revoked') is not null and pg_temp.pos(:'seen3'::jsonb, 'Old Request 110') is null,
  'still newest first: the oldest ones are left out') \g /dev/null

-- the function never changes anything and the table stays closed
select test.is(test.as('demo_op', 'select 1 from public.demo_requests'), 'error:42501', 'the operator still cannot read the table itself') \g /dev/null
select test.ok((select p.provolatile = 's' and p.prosecdef and 'search_path=""' = any (p.proconfig)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'operator_demo_requests'),
  'a read-only function with an empty search path') \g /dev/null

-- back as it was, for anything that runs after this file
delete from public.demo_requests where name like 'Old Request %' \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '44. demo requests in the operator console' group by section;
