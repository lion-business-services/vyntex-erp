-- 0065: repairs the access functions that 0064 rewrote, and stops background work for closed workspaces.
--
-- 0064 added the trial deadline to five access functions but rewrote them from their 0003 versions instead of their
-- 0061 versions. That undid two things the platform relies on:
--   * tenants_can() went back to app.role_permissions(role) instead of app.permissions_for(industry, config, role), so
--     an edition's own role matrix and a company's role changes (Settings, Roles) stopped counting in every policy that
--     asks "which companies may this person do X in" (leads, clients, jobs, documents, payments...).
--   * member_role(), tenants_can(), tenants_with_role(), my_member_ids() and my_worker_ids() asked for status 'active'
--     only, while the rest of the access functions (current_member, my_permissions, session_tenants...) still accept
--     'onboarding' and never look at the trial deadline. The two halves disagreed.
-- This file puts every access function back on its 0061 body, with ONE rule added to all of them alike:
--     a company is open when its status is not closed or suspended AND, if it is on a trial, the trial has not ended.
-- The trial deadline is checked at the moment of every request, so an expired trial closes even if no job runs.
--
-- Converting: 0064's check on the trial dates refused a converted company (start time kept, no deadline); fixed here,
-- with public.operator_convert_trial() for the operator.
--
-- Background work: scheduled jobs (messages, posts, reminders, syncs) of a company that is closed, paused or whose trial
-- ended stay in the queue untouched instead of running. Reactivating the company (or converting the trial) lets them run.

-- 0064's check made a trial impossible to convert: it required a deadline whenever a start time exists, but a converted
-- company keeps its start time (history) and has no deadline any more. A deadline still needs a start before it.
alter table public.tenants drop constraint if exists tenants_trial_window_chk;
alter table public.tenants add constraint tenants_trial_window_chk check
  (trial_expires_at is null or (trial_started_at is not null and trial_expires_at > trial_started_at));

create or replace function app.tenant_open(p_status text, p_trial_expires_at timestamptz) returns boolean
language sql stable
set search_path = ''
as $$
  select p_status not in ('closed', 'suspended')
     and (p_trial_expires_at is null or p_trial_expires_at > pg_catalog.now())
$$;
revoke all on function app.tenant_open(text, timestamptz) from public, anon;
grant execute on function app.tenant_open(text, timestamptz) to authenticated, service_role;

create or replace function app.member_role(p_tenant uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select m.role
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and app.tenant_open(t.status, t.trial_expires_at)
$$;

create or replace function app.current_member(p_tenant uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active'
    and app.tenant_open(t.status, t.trial_expires_at)
$$;

create or replace function app.current_worker(p_tenant uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.worker_id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'worker'
    and app.tenant_open(t.status, t.trial_expires_at)
$$;

create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and app.tenant_open(t.status, t.trial_expires_at)
    and p_permissions <@ app.permissions_for(t.industry_id, t.config, m.role)
$$;

create or replace function app.tenants_with_role(variadic p_roles text[]) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and app.tenant_open(t.status, t.trial_expires_at)
    and m.role = any (p_roles)
$$;

create or replace function app.my_member_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and app.tenant_open(t.status, t.trial_expires_at)
$$;

create or replace function app.my_worker_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.worker_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'worker'
    and app.tenant_open(t.status, t.trial_expires_at)
$$;

create or replace function app.my_permissions(p_tenant uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select app.permissions_for(t.industry_id, t.config, m.role)
     from public.tenant_members m
     join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active'
       and app.tenant_open(t.status, t.trial_expires_at)),
    array[]::text[])
$$;

create or replace function app.my_office_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(distinct o.office_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  cross join lateral pg_catalog.unnest(m.office_ids) as o(office_id)
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
    and app.tenant_open(t.status, t.trial_expires_at)
$$;

create or replace function app.hidden_clients() returns setof uuid
language sql stable security definer rows 100
set search_path = ''
as $$
  select c.id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  join public.clients c on c.tenant_id = m.tenant_id and c.office_id is not null
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
    and app.tenant_open(t.status, t.trial_expires_at)
    and not ('allClients' = any (app.permissions_for(t.industry_id, t.config, m.role)))
    and not (c.office_id = any (m.office_ids))
    and not (c.id = any (app.granted_client_ids()))
$$;

create or replace function app.session_tenants() returns uuid[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_out uuid[];
begin
  if not app.session_live() then return '{}'::uuid[]; end if;
  select coalesce(pg_catalog.array_agg(m.tenant_id), '{}'::uuid[]) into v_out
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and app.tenant_open(t.status, t.trial_expires_at)
    and (app.session_aal() = 'aal2' or not app.mfa_needed(m.tenant_id));
  return v_out;
end
$$;

-- Background jobs: claim only work of companies that are open (or platform work that belongs to no company).
create or replace function app.job_claim(p_worker text, p_limit integer default 10, p_lock_seconds integer default 120) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  update app.jobs j set status = 'dead', finished_at = pg_catalog.now(), last_error = 'lock_expired', locked_by = null, locked_until = null
   where j.status = 'running' and j.locked_until < pg_catalog.now() and j.attempts >= j.max_attempts;

  with due as (
    select j.id from app.jobs j
    where ((j.status = 'queued' and j.run_at <= pg_catalog.now())
        or (j.status = 'running' and j.locked_until < pg_catalog.now()))
      and (j.tenant_id is null or exists (
            select 1 from public.tenants t where t.id = j.tenant_id and app.tenant_open(t.status, t.trial_expires_at)))
    order by j.run_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update of j skip locked
  ), taken as (
    update app.jobs j
       set status = 'running', attempts = j.attempts + 1, locked_by = pg_catalog.left(p_worker, 80),
           locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(5, least(coalesce(p_lock_seconds, 120), 900)))
      from due where j.id = due.id
    returning j.id, j.tenant_id, j.kind, j.payload, j.attempts, j.max_attempts, j.run_at
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.run_at), '[]'::jsonb) into v_out from taken t;
  return v_out;
end
$$;

-- Converting a trial into a paid plan, by a VYNTEX operator only (the operator console or the SQL Editor), after the
-- payment is confirmed. Clears the deadline and sets the plan. A person in the company can never do this themselves.
create or replace function public.operator_convert_trial(p_tenant uuid, p_plan text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app.is_operator() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(p_plan, '') !~ '^[a-z][a-z0-9_]{1,40}$' or p_plan = 'trial' then raise exception 'bad_plan' using errcode = '22023'; end if;
  update public.tenants t set plan_id = p_plan, trial_expires_at = null, status = 'active'
   where t.id = p_tenant and t.plan_id = 'trial' and t.status <> 'closed';
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'operator.trial_converted', 'ok', null,
    pg_catalog.jsonb_build_object('plan', p_plan));
  return true;
end
$$;
revoke all on function public.operator_convert_trial(uuid, text) from public, anon, service_role;
grant execute on function public.operator_convert_trial(uuid, text) to authenticated;
