-- 0061 Operator console: VYNTEX staff open a client company and invite its first owner from the website, at
-- erp.vyntexusa.com/admin, instead of typing SQL in the Supabase dashboard.
--
-- Who is an operator: a person listed in app.operators. The list is written only here, in SQL, by the database owner
-- (app.operator_add below): nobody can make themselves an operator from the website.
-- What an operator may do, through the functions below and nothing else:
--   operator_context()               am I an operator (and is my second sign-in step done)
--   operator_companies()             every client company: address, edition, plan, status, its owner and open invitation
--   operator_create_company(...)     a new company and the one-time invitation of its first owner (the token is returned once)
--   operator_reinvite(company, email) a new invitation for the first owner, while the company still has none
--   operator_set_status(company, s)  active or suspended (a suspended company cannot be opened by anyone in it)
-- Every one of them refuses a caller who is not an active operator, and refuses unless this session passed the second
-- sign-in step (aal2): an operator account can open any company, so a password alone is never enough.
-- Operators see company names, addresses, plans and owner email addresses. They never see a company's records.

create table app.operators (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  email     text not null check (email = pg_catalog.lower(email)),
  active    boolean not null default true,
  added_at  timestamptz not null default now()
);
alter table app.operators enable row level security;
alter table app.operators force row level security;
revoke all on app.operators from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The checks
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.is_operator() returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from app.operators o where o.user_id = (select auth.uid()) and o.active) $$;
revoke all on function app.is_operator() from public, anon, authenticated, service_role;

create or replace function app.require_operator() returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not app.is_operator() then
    raise exception 'Operators only' using errcode = '42501';
  end if;
  if app.session_aal() <> 'aal2' then
    raise exception 'The second sign-in step is required' using errcode = '42501', hint = 'mfa_required';
  end if;
end
$$;
revoke all on function app.require_operator() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Adding and removing operators: database owner only (Supabase SQL Editor)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.operator_add(p_email text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  select u.id into v_user from auth.users u where pg_catalog.lower(u.email) = v_email;
  if v_user is null then
    raise exception 'No account with that email yet. The person accepts an invitation first, then is added here.' using errcode = '22023';
  end if;
  insert into app.operators (user_id, email, active) values (v_user, v_email, true)
  on conflict (user_id) do update set active = true, email = excluded.email;
  perform app.security_event(null, v_user, 'operator.added', 'ok', null, '{}'::jsonb);
  return v_user;
end
$$;
revoke all on function app.operator_add(text) from public, anon, authenticated, service_role;

create or replace function app.operator_remove(p_email text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update app.operators set active = false where email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
end
$$;
revoke all on function app.operator_remove(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The owner's invitation, shared by create and reinvite. Same rules as invite_bootstrap (0022): one open invitation per
-- address, a random token of which only the hash is kept, 72 hours.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.operator_owner_invite(p_tenant uuid, p_email text, p_name text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_token text;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or pg_catalog.length(v_email) > 320 then
    raise exception 'That email address does not look right' using errcode = '22023', hint = 'bad_email';
  end if;
  if exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.role = 'owner' and m.status = 'active') then
    raise exception 'This company already has an owner. Owners invite from the workspace.' using errcode = '42501', hint = 'has_owner';
  end if;
  v_token := pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  update app.invitations i set revoked_at = pg_catalog.now()
   where i.tenant_id = p_tenant and i.role = 'owner' and i.used_at is null and i.revoked_at is null;
  insert into app.invitations (tenant_id, email, name, role, token_hash, invited_by, expires_at)
  values (p_tenant, v_email, pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 200), 'owner',
          pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex'), null, pg_catalog.now() + interval '72 hours');
  return v_token;
end
$$;
revoke all on function app.operator_owner_invite(uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- What the console calls (with the operator's own token)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.operator_context() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object('operator', app.is_operator(), 'aal', app.session_aal());
end
$$;
revoke all on function public.operator_context() from public, anon, service_role;
grant execute on function public.operator_context() to authenticated;

create or replace function public.operator_companies() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_operator();
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'industry', t.industry_id, 'plan', t.plan_id, 'status', t.status, 'created_at', t.created_at,
      'members', (select pg_catalog.count(*) from public.tenant_members m where m.tenant_id = t.id and m.status = 'active'),
      'owner', (select pg_catalog.jsonb_build_object('email', u.email, 'name', m.name, 'since', m.created_at)
                  from public.tenant_members m join auth.users u on u.id = m.user_id
                 where m.tenant_id = t.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1),
      'invitation', (select pg_catalog.jsonb_build_object('email', i.email, 'expires_at', i.expires_at, 'expired', i.expires_at < pg_catalog.now())
                       from app.invitations i
                      where i.tenant_id = t.id and i.role = 'owner' and i.used_at is null and i.revoked_at is null order by i.created_at desc limit 1)
    ) order by t.created_at desc)
    from public.tenants t
  ), '[]'::jsonb);
end
$$;
revoke all on function public.operator_companies() from public, anon, service_role;
grant execute on function public.operator_companies() to authenticated;

create or replace function public.operator_create_company(
  p_slug text, p_name text, p_industry text, p_plan text, p_owner_email text, p_owner_name text default ''
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_tenant uuid;
  v_token text;
begin
  perform app.require_operator();
  if not app.is_valid_slug(v_slug) then
    raise exception 'That address cannot be used' using errcode = '22023', hint = 'bad_slug';
  end if;
  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    raise exception 'That address is taken' using errcode = '23505', hint = 'slug_taken';
  end if;
  if pg_catalog.length(v_name) not between 1 and 200 then
    raise exception 'The business name is required' using errcode = '22023', hint = 'bad_name';
  end if;
  if not exists (select 1 from public.industries i where i.id = p_industry) then
    raise exception 'Unknown edition' using errcode = '22023', hint = 'bad_industry';
  end if;
  if coalesce(p_plan, '') !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'Unknown plan' using errcode = '22023', hint = 'bad_plan';
  end if;
  insert into public.tenants (slug, name, industry_id, plan_id, status)
  values (v_slug, v_name, p_industry, p_plan, 'active')
  returning id into v_tenant;
  v_token := app.operator_owner_invite(v_tenant, p_owner_email, p_owner_name);
  perform app.security_event(v_tenant, (select auth.uid()), 'operator.company_created', 'ok', null,
    pg_catalog.jsonb_build_object('slug', v_slug, 'industry', p_industry, 'plan', p_plan));
  return pg_catalog.jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'token', v_token, 'email', pg_catalog.lower(pg_catalog.btrim(p_owner_email)));
end
$$;
revoke all on function public.operator_create_company(text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.operator_create_company(text, text, text, text, text, text) to authenticated;

create or replace function public.operator_reinvite(p_tenant uuid, p_owner_email text, p_owner_name text default '') returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text; v_slug text; v_name text;
begin
  perform app.require_operator();
  select t.slug, t.name into v_slug, v_name from public.tenants t where t.id = p_tenant and t.status <> 'closed';
  if v_slug is null then raise exception 'Unknown company' using errcode = '22023', hint = 'unknown_company'; end if;
  v_token := app.operator_owner_invite(p_tenant, p_owner_email, p_owner_name);
  perform app.security_event(p_tenant, (select auth.uid()), 'operator.owner_reinvited', 'ok', null, '{}'::jsonb);
  return pg_catalog.jsonb_build_object('tenant_id', p_tenant, 'slug', v_slug, 'name', v_name, 'token', v_token, 'email', pg_catalog.lower(pg_catalog.btrim(p_owner_email)));
end
$$;
revoke all on function public.operator_reinvite(uuid, text, text) from public, anon, service_role;
grant execute on function public.operator_reinvite(uuid, text, text) to authenticated;

create or replace function public.operator_set_status(p_tenant uuid, p_status text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_slug text;
begin
  perform app.require_operator();
  if p_status not in ('active', 'suspended') then
    raise exception 'Unknown status' using errcode = '22023', hint = 'bad_status';
  end if;
  update public.tenants t set status = p_status where t.id = p_tenant and t.status <> 'closed' returning t.slug into v_slug;
  if v_slug is null then raise exception 'Unknown company' using errcode = '22023', hint = 'unknown_company'; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'operator.status', 'ok', null, pg_catalog.jsonb_build_object('status', p_status));
  return pg_catalog.jsonb_build_object('tenant_id', p_tenant, 'status', p_status);
end
$$;
revoke all on function public.operator_set_status(uuid, text) from public, anon, service_role;
grant execute on function public.operator_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- A suspended company is closed to everyone in it: the access functions below are the ones of earlier files (0003, 0010,
-- 0013, 0028), unchanged except that a suspended company now counts like a closed one. auth_context still lists it, so
-- the sign-in page can say the workspace is paused instead of failing. Reactivating opens it again exactly as it was.
-- ---------------------------------------------------------------------------------------------------------------------

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
    and t.status not in ('closed', 'suspended')
$$;

create or replace function app.current_member(p_tenant uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and t.status not in ('closed', 'suspended')
$$;

create or replace function app.current_worker(p_tenant uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.worker_id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'worker'
    and t.status not in ('closed', 'suspended')
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
    and t.status not in ('closed', 'suspended')
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
    and t.status not in ('closed', 'suspended')
    and m.role = any (p_roles)
$$;

create or replace function app.my_member_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and t.status not in ('closed', 'suspended')
$$;

create or replace function app.my_worker_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(m.worker_id), '{}'::uuid[])
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'worker' and t.status not in ('closed', 'suspended')
$$;

create or replace function app.my_permissions(p_tenant uuid) returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select app.permissions_for(t.industry_id, t.config, m.role)
     from public.tenant_members m
     join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and t.status not in ('closed', 'suspended')),
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
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker' and t.status not in ('closed', 'suspended')
$$;

create or replace function app.hidden_clients() returns setof uuid
language sql stable security definer rows 100
set search_path = ''
as $$
  select c.id
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  join public.clients c on c.tenant_id = m.tenant_id and c.office_id is not null
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker' and t.status not in ('closed', 'suspended')
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
  where m.user_id = (select auth.uid()) and m.status = 'active' and t.status not in ('closed', 'suspended')
    and (app.session_aal() = 'aal2' or not app.mfa_needed(m.tenant_id));
  return v_out;
end
$$;
