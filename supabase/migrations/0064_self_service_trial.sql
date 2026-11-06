-- 0064: Self-service, email-verified seven-day trials. Run ONLY on the new vyntex-erp-clients project.
-- Existing VYNTEX ERP (Master Command Center) and LBS databases are not migration targets.
-- Trial requests are server-only. Do not expose anonymous table privileges, tokens or privileged functions.
alter table public.tenants
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_expires_at timestamptz;
alter table public.tenants
  add constraint tenants_trial_window_chk check
   (trial_started_at is null or (trial_expires_at is not null and trial_expires_at > trial_started_at));

create table app.trial_registrations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  email_hash text not null unique check(email_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);
alter table app.trial_registrations enable row level security;
alter table app.trial_registrations force row level security;
revoke all on app.trial_registrations from public, anon, authenticated, service_role;

-- A caller needs the server's privileged key to invoke this. Email and slug are validated
-- a second time inside the transaction; the caller only sends an opaque SHA-256 token hash.
create or replace function public.trial_request_create(
  p_slug text, p_name text, p_industry text, p_email text,
  p_owner_name text, p_email_hash text, p_token_hash text
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug,'')));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
  v_tenant uuid;
begin
  if not app.is_valid_slug(v_slug) then return 'bad_slug'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name,''))) not between 2 and 200 then return 'bad_name'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or pg_catalog.length(v_email) > 320
    then return 'bad_email'; end if;
  if coalesce(p_email_hash,'') !~ '^[0-9a-f]{64}$' or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'
    then return 'invalid'; end if;
  if not exists(select 1 from public.industries i where i.id = p_industry and i.active)
    then return 'bad_industry'; end if;
  -- One trial per email. Never reveal to the requester whether an account already exists.
  if exists(select 1 from app.trial_registrations r where r.email_hash = p_email_hash)
    then return 'accepted'; end if;
  if exists(select 1 from public.tenants t where t.slug = v_slug) then return 'slug_taken'; end if;
  insert into public.tenants(slug,name,industry_id,plan_id,status)
  values(v_slug,pg_catalog.btrim(p_name),p_industry,'trial','onboarding')
  returning id into v_tenant;
  insert into app.trial_registrations(tenant_id,email_hash) values(v_tenant,p_email_hash);
  insert into app.invitations(tenant_id,email,name,role,token_hash,invited_by,expires_at)
  values(v_tenant,v_email,pg_catalog.left(pg_catalog.btrim(coalesce(p_owner_name,'')),200),
    'owner',p_token_hash,null,pg_catalog.now() + interval '72 hours');
  return 'created';
exception when unique_violation then
  -- Competing requests must never give the applicant a way to enumerate email identities.
  return 'accepted';
end
$$;
revoke all on function public.trial_request_create(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.trial_request_create(text,text,text,text,text,text,text) to service_role;

-- Called only when system email delivery failed. No account may exist and nothing may have
-- been activated; this prevents an undeliverable request permanently reserving a slug.
create or replace function public.trial_request_cancel(p_token_hash text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  select t.id into v_tenant from public.tenants t
    join app.trial_registrations r on r.tenant_id=t.id
    join app.invitations i on i.tenant_id=t.id
    where i.token_hash=p_token_hash and i.used_at is null
      and t.status='onboarding' and r.started_at is null for update of t;
  if v_tenant is null then return false; end if;
  delete from app.invitations where tenant_id=v_tenant and used_at is null;
  delete from app.trial_registrations where tenant_id=v_tenant and started_at is null;
  delete from public.tenants where id=v_tenant and status='onboarding';
  return true;
end $$;
revoke all on function public.trial_request_cancel(text) from public,anon,authenticated;
grant execute on function public.trial_request_cancel(text) to service_role;

-- The first verified owner accepting the existing invitation activates the trial exactly once.
-- This is a DB trigger, not a browser event, so reloads or extra invites cannot reset the clock.
create or replace function app.trial_start_on_owner() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.role='owner' and new.status='active' then
    update public.tenants t set status='active',
      trial_started_at=pg_catalog.now(), trial_expires_at=pg_catalog.now()+interval '7 days'
      where t.id=new.tenant_id and t.status='onboarding'
       and t.plan_id='trial' and t.trial_started_at is null
       and exists(select 1 from app.trial_registrations r where r.tenant_id=t.id and r.started_at is null);
    if found then
      update app.trial_registrations r set started_at=pg_catalog.now()
       where r.tenant_id=new.tenant_id and r.started_at is null;
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.trial_start_on_owner() from public,anon,authenticated,service_role;
create trigger trial_start_on_verified_owner after insert or update of status,role on public.tenant_members
for each row execute function app.trial_start_on_owner();

-- Central RLS authorization becomes fail-closed as soon as a trial expires, even if
-- scheduled jobs are delayed. A converted paid tenant clears trial_expires_at only through
-- an operator-verified billing transition (never a self-service plan_id update).
create or replace function app.member_role(p_tenant uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id=p_tenant and m.user_id=(select auth.uid())
    and m.status='active' and t.status='active'
    and (t.trial_expires_at is null or t.trial_expires_at > pg_catalog.now())
$$;
-- Replace collection helpers that enumerate tenant IDs with the same time-based check.
create or replace function app.tenants_can(variadic p_permissions text[]) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id),'{}'::uuid[])
  from public.tenant_members m join public.tenants t on t.id=m.tenant_id
  where m.user_id=(select auth.uid()) and m.status='active' and t.status='active'
    and (t.trial_expires_at is null or t.trial_expires_at > pg_catalog.now())
    and p_permissions <@ app.role_permissions(m.role)
$$;
create or replace function app.tenants_with_role(variadic p_roles text[]) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.tenant_id),'{}'::uuid[])
  from public.tenant_members m join public.tenants t on t.id=m.tenant_id
  where m.user_id=(select auth.uid()) and m.status='active' and t.status='active'
    and (t.trial_expires_at is null or t.trial_expires_at > pg_catalog.now())
    and m.role = any(p_roles)
$$;
create or replace function app.my_member_ids() returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.id),'{}'::uuid[])
  from public.tenant_members m join public.tenants t on t.id=m.tenant_id
  where m.user_id=(select auth.uid()) and m.status='active' and t.status='active'
    and (t.trial_expires_at is null or t.trial_expires_at > pg_catalog.now())
$$;
create or replace function app.my_worker_ids() returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.worker_id),'{}'::uuid[])
  from public.tenant_members m join public.tenants t on t.id=m.tenant_id
  where m.user_id=(select auth.uid()) and m.status='active' and m.role='worker'
    and t.status='active'
    and (t.trial_expires_at is null or t.trial_expires_at > pg_catalog.now())
$$;

-- Report expiration in the existing session shape. Keep expired membership visible
-- for upgrade/contact support, but expose no active data capabilities after expiration.
create or replace function public.auth_context() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object(
    'user_id', v_uid, 'aal', app.session_aal(), 'session_id', app.session_id(),
    'live', app.session_live(), 'has_factor', app.has_verified_factor(),
    'recovery_codes_left', (select pg_catalog.count(*) from app.mfa_recovery_codes c where c.user_id=v_uid and c.used_at is null),
    'stepup_at', (select s.stepup_at from app.session_stamps s where s.session_id=app.session_id() and s.user_id=v_uid),
    'memberships', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'industry', t.industry_id, 'plan', t.plan_id,
        'status', case when t.trial_expires_at is not null and t.trial_expires_at <= pg_catalog.now() then 'suspended' else t.status end,
        'trial_started_at', t.trial_started_at, 'trial_expires_at', t.trial_expires_at,
        'member_id',m.id,'role',m.role,'worker_id',m.worker_id,'member_name',m.name,
        'capabilities',app.capabilities_of(t.id),
        'mfa_required',app.mfa_needed(t.id),'idle_minutes',app.idle_minutes(t.id)
      ) order by t.name)
      from public.tenant_members m join public.tenants t on t.id=m.tenant_id
      where m.user_id=v_uid and m.status='active' and t.status <> 'closed'), '[]'::jsonb)
  );
end $$;
revoke all on function public.auth_context() from public,anon,service_role;
grant execute on function public.auth_context() to authenticated;
