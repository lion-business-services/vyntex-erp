-- 0070 VYNTEX Partner Portal, part 1: who is a partner, who is VYNTEX partner staff, and how they get in.
--
-- The portal lives in its own schema, "partner", which the Data API never exposes. Every table there has row level
-- security enabled and forced, no policy, and no privilege for any application role: the only way in is a
-- public.partner_* function below (SECURITY DEFINER, search_path fixed), and each of those checks the caller first.
--
-- Two kinds of people use the portal, and neither is a company member (public.tenant_members):
--   partner.staff   VYNTEX people who run the partner program: partner_admin (everything) or partner_manager
--                   (partners and orders, but not commission policy, payouts or compliance). Added only from the
--                   Supabase SQL Editor (partner.staff_add, partner.staff_invite_bootstrap) or by a partner_admin.
--   partner.users   a person who belongs to one partner organization (partner_owner or partner_member).
-- Roles are rows in the database. No code anywhere compares an email address to decide what someone may do.
--
-- Every portal function requires a live session that passed the second sign-in step (aal2). auth_context() now
-- reports a partner role, and the server (api/auth.js) requires the authenticator app of anyone who has one, even
-- with no company membership (audit gap G1). "partners", "partner" and "proposal" become reserved addresses (G2).
-- Partner invitations are separate from company invitations and never create a company membership (G3).

create schema if not exists partner;
revoke all on schema partner from public, anon, authenticated, service_role;
alter default privileges in schema partner revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema partner revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema partner revoke all on sequences from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Reserved addresses: a company can never be called "partners", "partner" or "proposal" (G2)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.reserved_slugs() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array[
    'demo', 'pricing', 'request-demo', 'api', 'assets', 'brand', 'login', 'logout', 'signup', 'signin', 'register',
    'auth', 'callback', 'invite', 'reset-password', 'admin', 'app', 'www', 'static', 'public', 'settings', 'account',
    'billing', 'checkout', 'pay', 'webhooks', 'support', 'help', 'docs', 'legal', 'privacy', 'terms', 'about',
    'contact', 'blog', 'status', 'health', 'new', 'onboarding', 'portal', 'worker', 'client', 'dashboard', 'sign',
    'vyntex', 'null', 'undefined',
    'preview', 'review', 'book', 'mfa',
    'partners', 'partner', 'proposal'
  ]::text[]
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------
create sequence partner.partner_code_seq;
create sequence partner.ref_seq;

create table partner.staff (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  email      text not null check (email = pg_catalog.lower(email)),
  name       text not null default '' check (pg_catalog.length(name) <= 200),
  role       text not null check (role in ('partner_admin', 'partner_manager')),
  active     boolean not null default true,
  added_by   uuid,
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table partner.organizations (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique default ('P-' || pg_catalog.lpad(pg_catalog.nextval('partner.partner_code_seq')::text, 4, '0')),
  display_name     text not null check (pg_catalog.length(pg_catalog.btrim(display_name)) between 1 and 200),
  legal_name       text not null default '' check (pg_catalog.length(legal_name) <= 200),
  -- the partner's lane (one per partner; one lane per client deal is the approved rule)
  kind             text not null check (kind in ('referral', 'revshare')),
  status           text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  contact_name     text not null default '' check (pg_catalog.length(contact_name) <= 200),
  contact_email    text not null check (contact_email = pg_catalog.lower(contact_email) and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  contact_phone    text not null default '' check (pg_catalog.length(contact_phone) <= 40),
  lang             text not null default 'en' check (lang in ('en', 'es')),
  -- compliance, set only by a partner_admin. Never a tax ID or bank number: those stay outside the portal.
  w9_status        text not null default 'missing' check (w9_status in ('missing', 'received', 'verified')),
  agreement_status text not null default 'none' check (agreement_status in ('none', 'sent', 'signed', 'terminated')),
  agreement_signed_at timestamptz,
  agreement_version text not null default '' check (pg_catalog.length(agreement_version) <= 60),
  internal_notes   text not null default '' check (pg_catalog.length(internal_notes) <= 4000),
  status_reason    text not null default '' check (pg_catalog.length(status_reason) <= 400),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table partner.users (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  partner_id uuid not null references partner.organizations (id) on delete restrict,
  role       text not null check (role in ('partner_owner', 'partner_member')),
  status     text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  name       text not null default '' check (pg_catalog.length(name) <= 200),
  email      text not null check (email = pg_catalog.lower(email)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partner_users_partner_idx on partner.users (partner_id);

create table partner.invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (email = pg_catalog.lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' and pg_catalog.length(email) <= 320),
  name         text not null default '' check (pg_catalog.length(name) <= 200),
  partner_id   uuid references partner.organizations (id) on delete restrict,
  partner_role text check (partner_role in ('partner_owner', 'partner_member')),
  staff_role   text check (staff_role in ('partner_admin', 'partner_manager')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  claimed_at   timestamptz,
  used_at      timestamptz,
  used_by      uuid,
  revoked_at   timestamptz,
  constraint invitations_one_kind check ((partner_id is not null and partner_role is not null and staff_role is null)
                                      or (partner_id is null and partner_role is null and staff_role is not null)),
  constraint invitations_expiry check (expires_at > created_at)
);
create unique index partner_invitations_open_uidx on partner.invitations (email) where used_at is null and revoked_at is null;

-- Business and financial actions: append only. Sign-ins and sessions stay in app.security_events.
create table partner.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_kind  text not null check (actor_kind in ('staff', 'partner', 'server', 'system', 'client')),
  partner_id  uuid,
  entity      text not null check (entity ~ '^[a-z_]{2,40}$'),
  entity_id   text not null default '',
  action      text not null check (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  detail      jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(detail) = 'object')
);
create index partner_audit_partner_idx on partner.audit_log (partner_id, at desc);
create index partner_audit_entity_idx on partner.audit_log (entity, entity_id, at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- Append-only tables refuse change (used here and by the later partner migrations)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: records are never changed or deleted', tg_table_name using errcode = '42501';
end
$$;
create trigger audit_log_append_only before update or delete on partner.audit_log
  for each row execute function partner.append_only();

create or replace function partner.touch() returns trigger
language plpgsql
set search_path = ''
as $$ begin new.updated_at := pg_catalog.now(); return new; end $$;
create trigger staff_touch before update on partner.staff for each row execute function partner.touch();
create trigger organizations_touch before update on partner.organizations for each row execute function partner.touch();
create trigger users_touch before update on partner.users for each row execute function partner.touch();

-- A partner account is never a company member, and a company member never becomes a partner account by accident.
create or replace function partner.no_partner_members() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and exists (select 1 from partner.users u where u.user_id = new.user_id and u.status <> 'removed') then
    raise exception 'A partner account cannot join a company workspace' using errcode = '42501', hint = 'partner_account';
  end if;
  return new;
end
$$;
create trigger tenant_members_00_not_partner before insert or update of user_id, status on public.tenant_members
  for each row execute function partner.no_partner_members();

-- ---------------------------------------------------------------------------------------------------------------------
-- The checks every portal function starts with
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.audit(p_actor_kind text, p_partner uuid, p_entity text, p_entity_id text, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into partner.audit_log (actor, actor_kind, partner_id, entity, entity_id, action, detail)
  values ((select auth.uid()), p_actor_kind, p_partner, p_entity, coalesce(p_entity_id, ''), p_action, coalesce(p_detail, '{}'::jsonb))
$$;

/** The caller's staff role (partner_admin / partner_manager), or NULL. Looks at the role row only: no aal check. */
create or replace function partner.staff_role() returns text
language sql stable security definer
set search_path = ''
as $$ select s.role from partner.staff s where s.user_id = (select auth.uid()) and s.active $$;

/** The caller's active partner membership, or no row. */
create or replace function partner.my_membership() returns table (user_id uuid, partner_id uuid, role text)
language sql stable security definer
set search_path = ''
as $$
  select u.user_id, u.partner_id, u.role
  from partner.users u join partner.organizations o on o.id = u.partner_id
  where u.user_id = (select auth.uid()) and u.status = 'active' and o.status = 'active'
$$;

create or replace function partner.require_session() returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not app.session_live() then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if app.session_aal() <> 'aal2' then
    raise exception 'The second sign-in step is required' using errcode = 'VX402', hint = 'mfa_required';
  end if;
end
$$;

/** Staff only. p_admin: partner_admin only. Returns the role. */
create or replace function partner.require_staff(p_admin boolean default false) returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare v_role text;
begin
  perform partner.require_session();
  v_role := partner.staff_role();
  if v_role is null or (p_admin and v_role <> 'partner_admin') then
    raise exception 'Partner administrators only' using errcode = '42501';
  end if;
  return v_role;
end
$$;

/** An active person of an active partner. Returns the partner id. */
create or replace function partner.require_partner() returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare v_partner uuid;
begin
  perform partner.require_session();
  select m.partner_id into v_partner from partner.my_membership() m;
  if v_partner is null then
    raise exception 'Partners only' using errcode = '42501';
  end if;
  return v_partner;
end
$$;

/**
 * Who is asking, for a function both sides call: ('staff', role, null) or ('partner', role, partner id).
 * Raises for anyone else. Staff never act as a partner here: a staff preview passes p_as explicitly (read only).
 */
create or replace function partner.caller(out kind text, out role text, out partner_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform partner.require_session();
  role := partner.staff_role();
  if role is not null then kind := 'staff'; partner_id := null; return; end if;
  select 'partner', m.role, m.partner_id into kind, role, partner_id from partner.my_membership() m;
  if kind is null then
    raise exception 'Partner Portal accounts only' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- auth_context() reports the partner role, so the server can require the second step and keep the session (G1)
-- ---------------------------------------------------------------------------------------------------------------------
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
      where m.user_id=v_uid and m.status='active' and t.status <> 'closed'), '[]'::jsonb),
    -- The Partner Portal role. Always requires the authenticator app; idle limit 30 minutes.
    'partner', coalesce(
      (select pg_catalog.jsonb_build_object('kind', 'staff', 'role', s.role, 'mfa_required', true, 'idle_minutes', 30)
         from partner.staff s where s.user_id = v_uid and s.active),
      (select pg_catalog.jsonb_build_object('kind', 'partner', 'role', u.role, 'partner_id', u.partner_id, 'name', o.display_name,
              'mfa_required', true, 'idle_minutes', 30)
         from partner.users u join partner.organizations o on o.id = u.partner_id
        where u.user_id = v_uid and u.status = 'active' and o.status = 'active'))
  );
end $$;
revoke all on function public.auth_context() from public,anon,service_role;
grant execute on function public.auth_context() to authenticated;

-- What the portal shell asks first. Does not require aal2, so the page can say "finish the second step".
create or replace function public.partner_context() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v jsonb;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select pg_catalog.jsonb_build_object('kind', 'staff', 'role', s.role, 'name', s.name, 'email', s.email)
    into v from partner.staff s where s.user_id = v_uid and s.active;
  if v is null then
    select pg_catalog.jsonb_build_object('kind', 'partner', 'role', u.role, 'name', u.name, 'email', u.email,
             'partner', pg_catalog.jsonb_build_object('id', o.id, 'code', o.code, 'name', o.display_name, 'kind', o.kind,
               'w9', o.w9_status, 'agreement', o.agreement_status))
      into v from partner.users u join partner.organizations o on o.id = u.partner_id
     where u.user_id = v_uid and u.status = 'active' and o.status = 'active';
  end if;
  return coalesce(v, pg_catalog.jsonb_build_object('kind', null)) || pg_catalog.jsonb_build_object('user_id', v_uid, 'aal', app.session_aal(), 'live', app.session_live());
end
$$;
revoke all on function public.partner_context() from public, anon, service_role;
grant execute on function public.partner_context() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Staff: added only from the SQL Editor, or invited there (the bootstrap of info@vyntexusa.com, docs/partners/README.md)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.staff_add(p_email text, p_role text default 'partner_admin') returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  if p_role not in ('partner_admin', 'partner_manager') then raise exception 'Unknown role' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u where pg_catalog.lower(u.email) = v_email;
  if v_user is null then
    raise exception 'No account with that email yet. Use partner.staff_invite_bootstrap, or let the person accept an invitation first.' using errcode = '22023';
  end if;
  if exists (select 1 from partner.users u where u.user_id = v_user and u.status <> 'removed') then
    raise exception 'That account belongs to a partner. Staff and partner accounts stay separate.' using errcode = '42501';
  end if;
  insert into partner.staff (user_id, email, role, active) values (v_user, v_email, p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true, email = excluded.email;
  insert into partner.audit_log (actor, actor_kind, entity, entity_id, action, detail)
  values (null, 'system', 'staff', v_user::text, 'staff.added', pg_catalog.jsonb_build_object('role', p_role));
  perform app.security_event(null, v_user, 'partner.staff_added', 'ok', null, pg_catalog.jsonb_build_object('role', p_role));
  return v_user;
end
$$;

create or replace function partner.staff_remove(p_email text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_user uuid;
begin
  update partner.staff set active = false where email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))) returning user_id into v_user;
  if v_user is not null then
    insert into app.session_revocations (user_id, revoked_before, reason, updated_at) values (v_user, pg_catalog.now(), 'partner_staff_removed', pg_catalog.now())
    on conflict (user_id) do update set revoked_before = pg_catalog.now(), reason = excluded.reason, updated_at = pg_catalog.now();
    insert into partner.audit_log (actor, actor_kind, entity, entity_id, action) values (null, 'system', 'staff', v_user::text, 'staff.removed');
  end if;
end
$$;

/** A staff invitation for an address that has no account yet. Returns the token ONCE: send <site>/partners/invite/<token>. */
create or replace function partner.staff_invite_bootstrap(p_email text, p_role text default 'partner_admin', p_ttl_hours integer default 72) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_token text;
begin
  if p_role not in ('partner_admin', 'partner_manager') then raise exception 'Unknown role' using errcode = '22023'; end if;
  v_token := pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  update partner.invitations set revoked_at = pg_catalog.now() where email = v_email and used_at is null and revoked_at is null;
  insert into partner.invitations (email, staff_role, token_hash, expires_at)
  values (v_email, p_role, pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex'),
          pg_catalog.now() + pg_catalog.make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 72), 336))));
  insert into partner.audit_log (actor, actor_kind, entity, entity_id, action, detail)
  values (null, 'system', 'invitation', v_email, 'staff.invited', pg_catalog.jsonb_build_object('role', p_role));
  return v_token;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Partners (partner staff)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.org_json(o partner.organizations, p_internal boolean) returns jsonb
language sql stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', o.id, 'code', o.code, 'name', o.display_name, 'legal_name', o.legal_name, 'kind', o.kind, 'status', o.status,
    'contact_name', o.contact_name, 'contact_email', o.contact_email, 'contact_phone', o.contact_phone, 'lang', o.lang,
    'w9', o.w9_status, 'agreement', o.agreement_status, 'agreement_signed_at', o.agreement_signed_at, 'agreement_version', o.agreement_version,
    'payout_eligible', (o.status = 'active' and o.w9_status = 'verified' and o.agreement_status = 'signed'),
    'created_at', o.created_at)
  || case when p_internal then pg_catalog.jsonb_build_object('internal_notes', o.internal_notes, 'status_reason', o.status_reason) else '{}'::jsonb end
$$;

create or replace function public.partner_admin_partners() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform partner.require_staff();
  return coalesce((
    select pg_catalog.jsonb_agg(partner.org_json(o, true) || pg_catalog.jsonb_build_object(
      'users', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user_id', u.user_id, 'name', u.name, 'email', u.email, 'role', u.role, 'status', u.status) order by u.created_at)
                           from partner.users u where u.partner_id = o.id), '[]'::jsonb),
      'invitations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', i.id, 'email', i.email, 'role', i.partner_role, 'expires_at', i.expires_at,
                                   'expired', i.expires_at <= pg_catalog.now()) order by i.created_at desc)
                                 from partner.invitations i where i.partner_id = o.id and i.used_at is null and i.revoked_at is null), '[]'::jsonb)
    ) order by o.created_at desc)
    from partner.organizations o), '[]'::jsonb);
end
$$;

create or replace function public.partner_admin_partner_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text := partner.require_staff();
  v_id uuid := p_id;
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p ->> 'contact_email', '')));
  v_old partner.organizations;
  o partner.organizations;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  if coalesce(pg_catalog.btrim(p ->> 'name'), '') = '' then raise exception 'The partner name is required' using errcode = '22023', hint = 'bad_name'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'Contact email' using errcode = '22023', hint = 'bad_email'; end if;
  if coalesce(p ->> 'kind', '') not in ('referral', 'revshare') then raise exception 'Lane' using errcode = '22023', hint = 'bad_kind'; end if;
  if v_id is null then
    insert into partner.organizations (display_name, legal_name, kind, contact_name, contact_email, contact_phone, lang, internal_notes, created_by)
    values (pg_catalog.btrim(p ->> 'name'), pg_catalog.left(coalesce(p ->> 'legal_name', ''), 200), p ->> 'kind',
            pg_catalog.left(coalesce(p ->> 'contact_name', ''), 200), v_email, pg_catalog.left(coalesce(p ->> 'contact_phone', ''), 40),
            case when p ->> 'lang' = 'es' then 'es' else 'en' end, pg_catalog.left(coalesce(p ->> 'internal_notes', ''), 4000), (select auth.uid()))
    returning * into o;
    perform partner.audit('staff', o.id, 'organization', o.id::text, 'partner.created', pg_catalog.jsonb_build_object('kind', o.kind));
  else
    select * into v_old from partner.organizations where id = v_id for update;
    if not found then raise exception 'Unknown partner' using errcode = '22023'; end if;
    -- changing the lane changes how a partner is paid: administrators only
    if v_old.kind <> p ->> 'kind' and v_role <> 'partner_admin' then raise exception 'Administrators only' using errcode = '42501'; end if;
    update partner.organizations set display_name = pg_catalog.btrim(p ->> 'name'), legal_name = pg_catalog.left(coalesce(p ->> 'legal_name', ''), 200),
           kind = p ->> 'kind', contact_name = pg_catalog.left(coalesce(p ->> 'contact_name', ''), 200), contact_email = v_email,
           contact_phone = pg_catalog.left(coalesce(p ->> 'contact_phone', ''), 40), lang = case when p ->> 'lang' = 'es' then 'es' else 'en' end,
           internal_notes = pg_catalog.left(coalesce(p ->> 'internal_notes', v_old.internal_notes), 4000)
     where id = v_id returning * into o;
    perform partner.audit('staff', o.id, 'organization', o.id::text, 'partner.updated',
      pg_catalog.jsonb_build_object('kind_before', v_old.kind, 'kind', o.kind));
  end if;
  return partner.org_json(o, true);
end
$$;

/** Compliance: W-9 and agreement state. Administrators, with a fresh identity check. */
create or replace function public.partner_admin_partner_compliance(p_id uuid, p_w9 text, p_agreement text, p_agreement_version text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.organizations; v_old partner.organizations;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  if p_w9 not in ('missing', 'received', 'verified') or p_agreement not in ('none', 'sent', 'signed', 'terminated') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  select * into v_old from partner.organizations where id = p_id for update;
  if not found then raise exception 'Unknown partner' using errcode = '22023'; end if;
  update partner.organizations set w9_status = p_w9, agreement_status = p_agreement,
         agreement_signed_at = case when p_agreement = 'signed' then coalesce(v_old.agreement_signed_at, pg_catalog.now()) else v_old.agreement_signed_at end,
         agreement_version = coalesce(pg_catalog.left(p_agreement_version, 60), v_old.agreement_version)
   where id = p_id returning * into o;
  perform partner.audit('staff', o.id, 'organization', o.id::text, 'partner.compliance',
    pg_catalog.jsonb_build_object('w9_before', v_old.w9_status, 'w9', o.w9_status, 'agreement_before', v_old.agreement_status, 'agreement', o.agreement_status));
  return partner.org_json(o, true);
end
$$;

/** Suspend, reinstate or revoke a partner. Every session of its people ends at once; nothing financial is deleted. */
create or replace function public.partner_admin_partner_status(p_id uuid, p_status text, p_reason text default '') returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.organizations; v_before text;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  if p_status not in ('active', 'suspended', 'revoked') then raise exception 'Unknown status' using errcode = '22023'; end if;
  if p_status <> 'active' and pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023', hint = 'reason_required';
  end if;
  select status into v_before from partner.organizations where id = p_id for update;
  if v_before is null then raise exception 'Unknown partner' using errcode = '22023'; end if;
  if v_before = 'revoked' then raise exception 'A revoked partner stays revoked' using errcode = '22023', hint = 'revoked'; end if;
  update partner.organizations set status = p_status, status_reason = pg_catalog.left(coalesce(p_reason, ''), 400) where id = p_id returning * into o;
  if p_status <> 'active' then
    insert into app.session_revocations (user_id, revoked_before, reason, updated_at)
    select u.user_id, pg_catalog.now(), 'partner_' || p_status, pg_catalog.now() from partner.users u where u.partner_id = p_id
    on conflict (user_id) do update set revoked_before = pg_catalog.now(), reason = excluded.reason, updated_at = pg_catalog.now();
    update partner.invitations set revoked_at = pg_catalog.now() where partner_id = p_id and used_at is null and revoked_at is null;
  end if;
  perform partner.audit('staff', p_id, 'organization', p_id::text, 'partner.status',
    pg_catalog.jsonb_build_object('before', v_before, 'after', p_status, 'reason', pg_catalog.left(coalesce(p_reason, ''), 400)));
  return partner.org_json(o, true);
end
$$;

/** One person of a partner: suspend or reinstate (their sessions end at once). */
create or replace function public.partner_admin_user_status(p_user uuid, p_status text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid;
begin
  perform partner.require_staff();
  if p_status not in ('active', 'suspended', 'removed') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update partner.users set status = p_status where user_id = p_user returning partner_id into v_partner;
  if v_partner is null then return false; end if;
  if p_status <> 'active' then
    insert into app.session_revocations (user_id, revoked_before, reason, updated_at) values (p_user, pg_catalog.now(), 'partner_user_' || p_status, pg_catalog.now())
    on conflict (user_id) do update set revoked_before = pg_catalog.now(), reason = excluded.reason, updated_at = pg_catalog.now();
  end if;
  perform partner.audit('staff', v_partner, 'partner_user', p_user::text, 'partner_user.status', pg_catalog.jsonb_build_object('status', p_status));
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Invitations. Staff create them (the server makes the token and passes its hash); the server accepts them.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.partner_admin_invite(p_partner uuid, p_email text, p_name text, p_role text, p_token_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_id uuid; v_expires timestamptz := pg_catalog.now() + interval '72 hours';
  o partner.organizations;
begin
  perform partner.require_staff();
  select * into o from partner.organizations where id = p_partner;
  if not found or o.status <> 'active' then raise exception 'Unknown or inactive partner' using errcode = '22023', hint = 'partner_inactive'; end if;
  if coalesce(p_role, '') not in ('partner_owner', 'partner_member') then raise exception 'Unknown role' using errcode = '22023'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or pg_catalog.length(v_email) > 320 then
    raise exception 'Email' using errcode = '22023', hint = 'bad_email';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Token' using errcode = '22023'; end if;
  if exists (select 1 from partner.users u join auth.users a on a.id = u.user_id where pg_catalog.lower(a.email) = v_email and u.status <> 'removed') then
    raise exception 'Already a partner account' using errcode = '23505', hint = 'already_partner';
  end if;
  update partner.invitations set revoked_at = pg_catalog.now() where email = v_email and used_at is null and revoked_at is null;
  insert into partner.invitations (email, name, partner_id, partner_role, token_hash, invited_by, expires_at)
  values (v_email, pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 200), p_partner, p_role, p_token_hash, (select auth.uid()), v_expires)
  returning id into v_id;
  perform partner.audit('staff', p_partner, 'invitation', v_id::text, 'partner.invited', pg_catalog.jsonb_build_object('role', p_role));
  return pg_catalog.jsonb_build_object('id', v_id, 'email', v_email, 'expires_at', v_expires, 'partner', o.display_name, 'lang', o.lang);
end
$$;

create or replace function public.partner_admin_invite_revoke(p_invitation uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid;
begin
  perform partner.require_staff();
  update partner.invitations set revoked_at = pg_catalog.now() where id = p_invitation and used_at is null and revoked_at is null returning partner_id into v_partner;
  if not found then return false; end if;
  perform partner.audit('staff', v_partner, 'invitation', p_invitation::text, 'partner.invite_revoked');
  return true;
end
$$;

create or replace function public.partner_invite_peek(p_token_hash text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'partner', coalesce(o.display_name, 'VYNTEX'), 'staff', i.staff_role is not null,
    'email_hint', pg_catalog.left(i.email, 1) || '***@' || pg_catalog.split_part(i.email, '@', 2), 'expires_at', i.expires_at)
  from partner.invitations i left join partner.organizations o on o.id = i.partner_id
  where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > pg_catalog.now()
    and (i.partner_id is null or o.status = 'active')
$$;

create or replace function public.partner_invite_claim(p_token_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare r record;
begin
  update partner.invitations i set claimed_at = pg_catalog.now()
   where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > pg_catalog.now()
     and (i.claimed_at is null or i.claimed_at < pg_catalog.now() - interval '2 minutes')
     and (i.partner_id is null or exists (select 1 from partner.organizations o where o.id = i.partner_id and o.status = 'active'))
  returning i.id, i.email, i.name into r;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('id', r.id, 'email', r.email, 'name', r.name);
end
$$;

create or replace function public.partner_invite_release(p_token_hash text) returns void
language sql security definer
set search_path = ''
as $$ update partner.invitations set claimed_at = null where token_hash = p_token_hash and used_at is null $$;

/** Links the verified account to the partner (or staff role) and uses the invitation up. Never a company membership. */
create or replace function public.partner_invite_complete(p_token_hash text, p_user uuid, p_name text default null, p_ip_hash text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  inv partner.invitations%rowtype;
  v_email text;
  v_name text;
begin
  select * into inv from partner.invitations i
   where i.token_hash = p_token_hash and i.used_at is null and i.revoked_at is null and i.expires_at > pg_catalog.now() and i.claimed_at is not null
   for update;
  if not found then raise exception 'invite_invalid' using errcode = '22023'; end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is null or v_email <> inv.email then raise exception 'invite_invalid' using errcode = '22023'; end if;
  v_name := coalesce(nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_name, '')), 200), ''), inv.name);
  if inv.staff_role is not null then
    if exists (select 1 from partner.users u where u.user_id = p_user and u.status <> 'removed') then
      raise exception 'A partner account cannot be staff' using errcode = '42501', hint = 'partner_account';
    end if;
    insert into partner.staff (user_id, email, name, role, active) values (p_user, v_email, v_name, inv.staff_role, true)
    on conflict (user_id) do update set role = excluded.role, active = true, name = excluded.name;
  else
    -- An ERP customer's account (a company member) or VYNTEX staff does not become a partner account.
    if exists (select 1 from public.tenant_members m where m.user_id = p_user and m.status = 'active')
       or exists (select 1 from partner.staff s where s.user_id = p_user and s.active) then
      raise exception 'This account is already used for something else' using errcode = '42501', hint = 'account_in_use';
    end if;
    insert into partner.users (user_id, partner_id, role, status, name, email) values (p_user, inv.partner_id, inv.partner_role, 'active', v_name, v_email)
    on conflict (user_id) do update set partner_id = excluded.partner_id, role = excluded.role, status = 'active', name = excluded.name;
  end if;
  update partner.invitations set used_at = pg_catalog.now(), used_by = p_user where id = inv.id;
  insert into partner.audit_log (actor, actor_kind, partner_id, entity, entity_id, action, detail)
  values (p_user, 'server', inv.partner_id, 'invitation', inv.id::text, 'invite.accepted', pg_catalog.jsonb_build_object('staff', inv.staff_role is not null));
  perform app.security_event(null, p_user, 'partner.invite_accepted', 'ok', p_ip_hash, pg_catalog.jsonb_build_object('staff', inv.staff_role is not null));
  return pg_catalog.jsonb_build_object('staff', inv.staff_role is not null, 'partner_id', inv.partner_id);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants. Everything in the partner schema stays closed; the server and signed-in people reach only these.
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function public.partner_invite_peek(text), public.partner_invite_claim(text), public.partner_invite_release(text),
  public.partner_invite_complete(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.partner_invite_peek(text), public.partner_invite_claim(text), public.partner_invite_release(text),
  public.partner_invite_complete(text, uuid, text, text) to service_role;

revoke all on function public.partner_admin_partners(), public.partner_admin_partner_save(uuid, jsonb),
  public.partner_admin_partner_compliance(uuid, text, text, text), public.partner_admin_partner_status(uuid, text, text),
  public.partner_admin_user_status(uuid, text), public.partner_admin_invite(uuid, text, text, text, text),
  public.partner_admin_invite_revoke(uuid) from public, anon, service_role;
grant execute on function public.partner_admin_partners(), public.partner_admin_partner_save(uuid, jsonb),
  public.partner_admin_partner_compliance(uuid, text, text, text), public.partner_admin_partner_status(uuid, text, text),
  public.partner_admin_user_status(uuid, text), public.partner_admin_invite(uuid, text, text, text, text),
  public.partner_admin_invite_revoke(uuid) to authenticated;

-- The partner schema's own lockdown check, run at the end of every partner migration and by the test runner.
create or replace function partner.lockdown_check() returns void
language plpgsql
set search_path = ''
as $lockdown$
declare r record;
begin
  for r in select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relkind from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'partner' and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    if r.relkind = 'S' then
      execute pg_catalog.format('revoke all on sequence partner.%I from public, anon, authenticated, service_role', r.relname);
    else
      execute pg_catalog.format('revoke all on partner.%I from public, anon, authenticated, service_role', r.relname);
    end if;
    if r.relkind in ('r', 'p') then
      execute pg_catalog.format('alter table partner.%I enable row level security', r.relname);
      execute pg_catalog.format('alter table partner.%I force row level security', r.relname);
    end if;
  end loop;
  for r in select p.oid::pg_catalog.regprocedure as sig from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'partner'
  loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  for r in select p.oid::pg_catalog.regprocedure as sig from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'partner' and p.prosecdef
              and not exists (select 1 from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) cfg where cfg like 'search_path=%')
  loop
    raise exception 'SECURITY DEFINER function % has no fixed search_path', r.sig;
  end loop;
  -- No public.partner_* function may be run by the anonymous role.
  for r in select p.oid::pg_catalog.regprocedure as sig from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'partner\_%' and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
  loop
    raise exception 'The anonymous role can run %', r.sig;
  end loop;
end
$lockdown$;
revoke all on function partner.lockdown_check() from public, anon, authenticated, service_role;

select partner.lockdown_check();
select app.lockdown_check();
