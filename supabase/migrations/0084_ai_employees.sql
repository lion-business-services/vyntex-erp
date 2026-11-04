-- 0084: AI employees (the VYNTEX USA Grok bots) working inside the company's own VYNTEX ERP workspace.
-- Owner decisions of November 4, 2026 (bot profiles prepared by Parker, access levels set by Abdul):
--   * each bot has its own account here, never a person's sign-in: app.bots, one secret key each, kept only as a hash
--   * each bot reaches exactly the sections its profile lists (none, view, edit), checked in this file for every call
--   * ACCESS IS NOT APPROVAL. No bot can send to a client, move money, change a price, delete, publish or sign. There is
--     no such tool at all. A bot can only ask (app.approvals), with What / Why / Risk if we do it / Risk if we don't /
--     Recommendation / Deadline; an owner or a manager of the company decides in the ERP (Daysi and Abdul decide every
--     level). The decision is carried out by that person, with their own rights and their own checks
--   * no bot ever sees a tax ID, a bank or card detail or the secure vault: no tool reads those columns or tables
--   * every call a bot makes is kept (app.bot_activity); a bot can be paused, and its key replaced or revoked, at once
-- The bots call /api/bot/* (api/_lib/public/bot.js, through api/public.js): the server checks the key's hash with bot_auth(), then runs the
-- tool with bot_call(). Neither function can be called by a person, a visitor or a signed-in user.
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists app.bots (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  slug           text not null check (slug ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name           text not null check (length(btrim(name)) between 1 and 60),
  title          text not null default '' check (length(title) <= 120),
  department     text not null default '' check (length(department) <= 120),
  reports_to     text not null default '' check (length(reports_to) <= 120),
  mission        text not null default '' check (length(mission) <= 400),
  -- section -> 'none' | 'view' | 'edit'
  access         jsonb not null default '{}'::jsonb check (jsonb_typeof(access) = 'object' and octet_length(access::text) <= 2048),
  status         text not null default 'active' check (status in ('active', 'paused')),
  key_hash       text unique check (key_hash is null or key_hash ~ '^[0-9a-f]{64}$'),
  key_hint       text check (key_hint is null or key_hint ~ '^[A-Za-z0-9_]{4,16}$'),
  key_created_at timestamptz,
  last_used_at   timestamptz,
  created_at     timestamptz not null default pg_catalog.now(),
  updated_at     timestamptz not null default pg_catalog.now(),
  unique (tenant_id, slug)
);
alter table app.bots enable row level security;
revoke all on app.bots from public, anon, authenticated;

create table if not exists app.approvals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  bot_id         uuid references app.bots (id) on delete set null,
  kind           text not null check (kind in ('message.send', 'record.delete', 'price.change', 'payment', 'refund', 'payout',
                   'discount', 'contract', 'publish', 'campaign', 'access', 'production', 'other')),
  level          smallint not null default 2 check (level in (2, 3)),
  what           text not null check (length(btrim(what)) between 3 and 500),
  why            text not null default '' check (length(why) <= 1000),
  risk_do        text not null default '' check (length(risk_do) <= 1000),
  risk_dont      text not null default '' check (length(risk_dont) <= 1000),
  recommendation text not null default '' check (length(recommendation) <= 1000),
  deadline       date,
  -- what the decision is about, e.g. {"type":"message","id":"..."}; never a secret
  target         jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object' and octet_length(target::text) <= 4096),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'done', 'cancelled')),
  decided_by     uuid,
  decided_name   text,
  decided_at     timestamptz,
  note           text check (note is null or length(note) <= 1000),
  done_at        timestamptz,
  created_at     timestamptz not null default pg_catalog.now()
);
create index if not exists approvals_tenant_idx on app.approvals (tenant_id, status, created_at desc);
alter table app.approvals enable row level security;
revoke all on app.approvals from public, anon, authenticated;

create table if not exists app.bot_activity (
  id         bigint generated always as identity primary key,
  -- like public.audit_log: kept for good, so a company or a bot with a log is never deleted (bots are paused instead)
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  bot_id     uuid references app.bots (id) on delete restrict,
  tool       text not null check (tool ~ '^[a-z_.]{2,40}$'),
  outcome    text not null check (outcome in ('ok', 'denied', 'invalid', 'error')),
  summary    jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096),
  at         timestamptz not null default pg_catalog.now()
);
create index if not exists bot_activity_idx on app.bot_activity (tenant_id, at desc);
alter table app.bot_activity enable row level security;
revoke all on app.bot_activity from public, anon, authenticated;
create trigger bot_activity_append_only before update or delete on app.bot_activity for each row execute function app.block_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.bot_sections() returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'messages', 'payments', 'catalog', 'reports', 'automations', 'team']::text[]
$$;
revoke all on function app.bot_sections() from public, anon, authenticated;

-- may this access map do `need` ('view' or 'edit') in `section`?
create or replace function app.bot_may(p_access jsonb, p_section text, p_need text) returns boolean language sql immutable set search_path = '' as $$
  select case coalesce(p_access ->> p_section, 'none')
    when 'edit' then true
    when 'view' then p_need = 'view'
    else false end
$$;
revoke all on function app.bot_may(jsonb, text, text) from public, anon, authenticated;

-- a clean access map: only the known sections, only none / view / edit
create or replace function app.bot_access_clean(p jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_object_agg(s, case when p ->> s in ('view', 'edit') then p ->> s else 'none' end), '{}'::jsonb)
  from pg_catalog.unnest(app.bot_sections()) s
$$;
revoke all on function app.bot_access_clean(jsonb) from public, anon, authenticated;

-- the person deciding: an active owner or manager of the company, with the second sign-in step
create or replace function app.bot_admin(p_tenant uuid, p_owner_only boolean) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_member uuid;
begin
  perform app.require_mfa(p_tenant);
  select m.role, m.id into v_role, v_member from public.tenant_members m
   where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active';
  if v_role is null or (p_owner_only and v_role <> 'owner') or (not p_owner_only and v_role not in ('owner', 'manager')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_member;
end $$;
revoke all on function app.bot_admin(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- for the people of the company (through /api/ws/rpc, listed in api/_lib/rpc-allowlist.js)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.bot_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'title', b.title, 'department', b.department, 'reportsTo', b.reports_to,
      'mission', b.mission, 'access', b.access, 'status', b.status, 'hasKey', b.key_hash is not null, 'keyHint', b.key_hint,
      'keyCreatedAt', b.key_created_at, 'lastUsedAt', b.last_used_at,
      'pending', (select pg_catalog.count(*) from app.approvals a where a.bot_id = b.id and a.status = 'pending'))
    order by b.created_at) from app.bots b where b.tenant_id = p_tenant), '[]'::jsonb);
end $$;

-- add or change a bot (the owner only, with a fresh identity check). Access is cleaned to the known sections.
create or replace function public.bot_save(p_tenant uuid, p_bot jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.bot_admin(p_tenant, true);
  perform app.require_stepup(300);
  if (select t.plan_id from public.tenants t where t.id = p_tenant) <> 'internal' then raise exception 'not_available' using errcode = '42501'; end if;
  if p_bot ? 'id' and nullif(p_bot ->> 'id', '') is not null then
    update app.bots b set name = coalesce(p_bot ->> 'name', b.name), title = coalesce(p_bot ->> 'title', b.title),
        department = coalesce(p_bot ->> 'department', b.department), reports_to = coalesce(p_bot ->> 'reportsTo', b.reports_to),
        mission = coalesce(p_bot ->> 'mission', b.mission),
        access = case when p_bot ? 'access' then app.bot_access_clean(p_bot -> 'access') else b.access end, updated_at = pg_catalog.now()
      where b.id = (p_bot ->> 'id')::uuid and b.tenant_id = p_tenant returning b.id into v_id;
    if v_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  else
    insert into app.bots (tenant_id, slug, name, title, department, reports_to, mission, access)
    values (p_tenant, p_bot ->> 'slug', p_bot ->> 'name', coalesce(p_bot ->> 'title', ''), coalesce(p_bot ->> 'department', ''),
            coalesce(p_bot ->> 'reportsTo', ''), coalesce(p_bot ->> 'mission', ''), app.bot_access_clean(coalesce(p_bot -> 'access', '{}'::jsonb)))
    returning id into v_id;
  end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.saved', 'ok', null, pg_catalog.jsonb_build_object('bot', v_id));
  return v_id;
end $$;

-- pause or resume (owner or manager: stopping a bot must be quick)
create or replace function public.bot_set_status(p_tenant uuid, p_bot uuid, p_status text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  if p_status not in ('active', 'paused') then raise exception 'invalid' using errcode = '22023'; end if;
  update app.bots b set status = p_status, updated_at = pg_catalog.now() where b.id = p_bot and b.tenant_id = p_tenant;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.' || p_status, 'ok', null, pg_catalog.jsonb_build_object('bot', p_bot));
  return true;
end $$;

-- a new key (the server makes it and shows it once; only its hash comes here). Owner only, fresh identity check.
create or replace function public.bot_key_set(p_tenant uuid, p_bot uuid, p_key_hash text, p_hint text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, true);
  perform app.require_stepup(300);
  if p_key_hash !~ '^[0-9a-f]{64}$' or p_hint !~ '^[A-Za-z0-9_]{4,16}$' then raise exception 'invalid' using errcode = '22023'; end if;
  update app.bots b set key_hash = p_key_hash, key_hint = p_hint, key_created_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where b.id = p_bot and b.tenant_id = p_tenant;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.key_issued', 'ok', null, pg_catalog.jsonb_build_object('bot', p_bot, 'hint', p_hint));
  return true;
end $$;

-- the key stops working at once (owner or manager)
create or replace function public.bot_key_revoke(p_tenant uuid, p_bot uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  update app.bots b set key_hash = null, key_hint = null, key_created_at = null, updated_at = pg_catalog.now() where b.id = p_bot and b.tenant_id = p_tenant;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.key_revoked', 'ok', null, pg_catalog.jsonb_build_object('bot', p_bot));
  return true;
end $$;

create or replace function public.bot_activity_list(p_tenant uuid, p_bot uuid default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(x order by x.at desc) from (
    select a.id, a.at, a.tool, a.outcome, a.summary, b.name as bot from app.bot_activity a left join app.bots b on b.id = a.bot_id
     where a.tenant_id = p_tenant and (p_bot is null or a.bot_id = p_bot) order by a.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end $$;

create or replace function public.approvals_list(p_tenant uuid, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(x order by x.created_at desc) from (
    select a.id, a.kind, a.level, a.what, a.why, a.risk_do as "riskDo", a.risk_dont as "riskDont", a.recommendation, a.deadline,
           a.target, a.status, a.decided_name as "decidedBy", a.decided_at as "decidedAt", a.note, a.done_at as "doneAt",
           a.created_at, b.name as bot, b.title as "botTitle"
      from app.approvals a left join app.bots b on b.id = a.bot_id
     where a.tenant_id = p_tenant and (p_status is null or a.status = p_status)
     order by a.created_at desc limit 300) x), '[]'::jsonb);
end $$;

-- an owner or a manager decides (Daysi and Abdul decide every level, owner decision of November 4, 2026).
-- Approving "send to a client" for a bot's draft queues that draft at once, in the approver's name: the delivery job
-- (0043, api/_lib/pipeline/deliver.js) checks consent and opt-outs again before anything leaves, exactly as for a message
-- a person writes. Answers { decided, queued }; decided is false when the request was not waiting any more.
create or replace function public.approval_decide(p_tenant uuid, p_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_name text; a app.approvals%rowtype; v_queued boolean := false;
begin
  v_member := app.bot_admin(p_tenant, false);
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid' using errcode = '22023'; end if;
  select m.name into v_name from public.tenant_members m where m.id = v_member;
  update app.approvals x set status = p_decision, decided_by = v_member, decided_name = v_name, decided_at = pg_catalog.now(),
      note = nullif(btrim(coalesce(p_note, '')), '')
   where x.id = p_id and x.tenant_id = p_tenant and x.status = 'pending'
  returning x.* into a;
  if a.id is null then return pg_catalog.jsonb_build_object('decided', false, 'queued', false); end if;

  if p_decision = 'approved' and a.kind = 'message.send' and a.target ->> 'type' = 'message' and coalesce(a.target ->> 'id', '') ~ '^[0-9a-f-]{36}$'
     and p_tenant = any ((select app.tenants_can('comms', 'write'))::uuid[]) then
    -- the one place a signed-in person's request moves a draft to the queue (app.messages_guard lets exactly this row pass)
    perform pg_catalog.set_config('app.approved_send', a.target ->> 'id', true);
    update public.messages m set status = 'queued', at = pg_catalog.now(), by_member_id = v_member, updated_at = pg_catalog.now()
     where m.tenant_id = p_tenant and m.id = (a.target ->> 'id')::uuid and m.status = 'draft' and coalesce(m.dir, 'out') = 'out';
    v_queued := found;
    perform pg_catalog.set_config('app.approved_send', '', true);
    if v_queued then update app.approvals x set status = 'done', done_at = pg_catalog.now() where x.id = a.id; end if;
  end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'approval.' || p_decision, 'ok', null,
    pg_catalog.jsonb_build_object('approval', p_id, 'kind', a.kind, 'queued', v_queued));
  return pg_catalog.jsonb_build_object('decided', true, 'queued', v_queued);
end $$;

-- 0013's guard, with one addition: the draft named by an approval being decided above may move to "queued", and only
-- to that, with nothing else changed but its time and its author (the approver)
create or replace function app.messages_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'demo') or new.dir = 'in' or new.provider is not null or new.external_id is not null or new.error is not null then
      raise exception 'Only the server records a message as queued, sent, delivered, failed or received' using errcode = '42501';
    end if;
    -- the author is the person signed in, whoever the row names
    if new.by_member_id is not null then new.by_member_id := app.current_member(new.tenant_id); end if;
    return new;
  end if;
  if old.status = 'draft' and new.status = 'queued' and coalesce(pg_catalog.current_setting('app.approved_send', true), '') = old.id::text
     and new.by_member_id is not distinct from app.current_member(new.tenant_id)
     and (pg_catalog.to_jsonb(new) - array['status', 'at', 'by_member_id', 'updated_at']) = (pg_catalog.to_jsonb(old) - array['status', 'at', 'by_member_id', 'updated_at']) then
    return new;
  end if;
  if old.status in ('draft', 'demo') then
    if new.status not in ('draft', 'demo')
       or (new.dir, new.provider, new.external_id, new.error, new.by_member_id) is distinct from (old.dir, old.provider, old.external_id, old.error, old.by_member_id) then
      raise exception 'Only the server records a message as queued, sent, delivered, failed or received' using errcode = '42501';
    end if;
  elsif (pg_catalog.to_jsonb(new) - array['read', 'updated_at']) is distinct from (pg_catalog.to_jsonb(old) - array['read', 'updated_at']) then
    -- once a message left (or arrived) it is a record of what happened: a person can mark it read, nothing else
    raise exception 'A message that was queued, sent or received can only be marked as read' using errcode = '42501';
  end if;
  return new;
end
$$;

-- the approved action was carried out by the person who approved it (for example the email was sent from Messages)
create or replace function public.approval_done(p_tenant uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  update app.approvals a set status = 'done', done_at = pg_catalog.now() where a.id = p_id and a.tenant_id = p_tenant and a.status = 'approved';
  return found;
end $$;

revoke all on function public.bot_list(uuid), public.bot_save(uuid, jsonb), public.bot_set_status(uuid, uuid, text),
  public.bot_key_set(uuid, uuid, text, text), public.bot_key_revoke(uuid, uuid), public.bot_activity_list(uuid, uuid, integer),
  public.approvals_list(uuid, text), public.approval_decide(uuid, uuid, text, text), public.approval_done(uuid, uuid) from public, anon;
grant execute on function public.bot_list(uuid), public.bot_save(uuid, jsonb), public.bot_set_status(uuid, uuid, text),
  public.bot_key_set(uuid, uuid, text, text), public.bot_key_revoke(uuid, uuid), public.bot_activity_list(uuid, uuid, integer),
  public.approvals_list(uuid, text), public.approval_decide(uuid, uuid, text, text), public.approval_done(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- for the server only: the key, then the tool
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.bot_auth(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v app.bots%rowtype; v_open boolean;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v from app.bots b where b.key_hash = p_key_hash;
  if v.id is null then return null; end if;
  select app.tenant_open(t.status, t.trial_expires_at) into v_open from public.tenants t where t.id = v.tenant_id;
  if v.status <> 'active' or not coalesce(v_open, false) then
    return pg_catalog.jsonb_build_object('refused', case when v.status <> 'active' then 'paused' else 'workspace_closed' end, 'bot', v.id);
  end if;
  update app.bots b set last_used_at = pg_catalog.now() where b.id = v.id and (b.last_used_at is null or b.last_used_at < pg_catalog.now() - interval '1 minute');
  return pg_catalog.jsonb_build_object('bot', v.id, 'tenant', v.tenant_id, 'name', v.name, 'title', v.title, 'access', v.access);
end $$;
revoke all on function public.bot_auth(text) from public, anon, authenticated;
grant execute on function public.bot_auth(text) to service_role;

-- one tool call. Every call is kept in app.bot_activity, refused ones too.
create or replace function public.bot_call(p_bot uuid, p_tool text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b app.bots%rowtype; t uuid; a jsonb := coalesce(p_args, '{}'::jsonb); out jsonb; v_id uuid; v_lim int; v_kind text; v_sec text;
  deny text := null;
begin
  select * into b from app.bots x where x.id = p_bot and x.status = 'active';
  if b.id is null then return pg_catalog.jsonb_build_object('error', 'bot_not_active'); end if;
  t := b.tenant_id;
  -- the same rule as for the people: a paused or closed company is closed to its bots too
  if not coalesce((select app.tenant_open(x.status, x.trial_expires_at) from public.tenants x where x.id = t), false) then
    return pg_catalog.jsonb_build_object('error', 'workspace_closed');
  end if;
  if jsonb_typeof(a) <> 'object' or octet_length(a::text) > 16384 then
    insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary) values (t, b.id, 'invalid', 'invalid', '{}'::jsonb);
    return pg_catalog.jsonb_build_object('error', 'invalid_arguments');
  end if;
  v_lim := case when coalesce(a ->> 'limit', '') ~ '^[0-9]{1,4}$' then least(greatest((a ->> 'limit')::int, 1), 200) else 50 end;

  -- the section each tool needs, and at which level
  v_sec := case
    when p_tool in ('leads.list', 'leads.get') then 'leads:view' when p_tool in ('leads.create', 'leads.update') then 'leads:edit'
    when p_tool in ('clients.list', 'clients.get') then 'clients:view' when p_tool = 'clients.update' then 'clients:edit'
    when p_tool in ('jobs.list', 'jobs.get') then 'jobs:view' when p_tool = 'jobs.update' then 'jobs:edit'
    when p_tool = 'tasks.list' then 'tasks:view' when p_tool in ('tasks.create', 'tasks.update') then 'tasks:edit'
    when p_tool = 'calendar.list' then 'calendar:view'
    when p_tool = 'documents.list' then 'documents:view'
    when p_tool = 'messages.list' then 'messages:view' when p_tool = 'messages.draft' then 'messages:edit'
    when p_tool = 'payments.list' then 'payments:view'
    when p_tool = 'catalog.list' then 'catalog:view'
    when p_tool = 'reports.summary' then 'reports:view'
    when p_tool = 'automations.list' then 'automations:view'
    when p_tool = 'team.list' then 'team:view'
    when p_tool = 'notes.add' then coalesce(a ->> 'parent', '') || 's:edit'
    when p_tool in ('whoami', 'approvals.request', 'approvals.list') then 'any'
    else null end;
  if v_sec is null then deny := 'unknown_tool';
  elsif v_sec <> 'any' and (split_part(v_sec, ':', 1) <> all (app.bot_sections()) or not app.bot_may(b.access, split_part(v_sec, ':', 1), split_part(v_sec, ':', 2))) then deny := 'not_allowed';
  end if;
  if deny is not null then
    insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary)
      values (t, b.id, case when p_tool ~ '^[a-z_.]{2,40}$' then p_tool else 'unknown' end, 'denied', pg_catalog.jsonb_build_object('reason', deny));
    return pg_catalog.jsonb_build_object('error', deny, 'tool', p_tool);
  end if;

  begin
    case p_tool
    when 'whoami' then
      out := pg_catalog.jsonb_build_object('name', b.name, 'title', b.title, 'department', b.department, 'access', b.access,
        'rules', 'Access is not approval: sending to clients, payments, prices, deletions and publishing are asked for with approvals.request and decided by a person.');

    -- ---- leads
    when 'leads.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select l.id, l.ticket, l.name, l.company, l.phone, l.email, l.status, l.source, l.type, l.pri, l.value, l.follow_up as "followUp",
               l.next_action_text as "nextAction", l.next_action_due as "nextActionDue", l.created, l.lang
          from public.leads l where l.tenant_id = t
           and (a ->> 'status' is null or l.status = a ->> 'status')
           and (a ->> 'since' is null or l.created >= (a ->> 'since')::date)
         order by l.created desc, l.created_at desc limit v_lim) x;
    when 'leads.get' then
      select pg_catalog.to_jsonb(x) into out from (
        select l.id, l.ticket, l.name, l.company, l.phone, l.email, l.address, l.status, l.source, l.source_detail as "sourceDetail", l.type,
               l.pri, l.value, l.follow_up as "followUp", l.next_action_text as "nextAction", l.next_action_due as "nextActionDue",
               l.appt_date as "apptDate", l.appt_time as "apptTime", l.created, l.lost_reason as "lostReason", l.client_id as "clientId", l.job_id as "jobId",
               (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', n.at, 'kind', n.kind, 'text', n.text) order by n.at desc), '[]'::jsonb)
                  from (select * from public.notes n where n.tenant_id = t and n.lead_id = l.id order by n.at desc limit 20) n) as notes
          from public.leads l where l.tenant_id = t and l.id = (a ->> 'id')::uuid) x;
      if out is null then out := pg_catalog.jsonb_build_object('error', 'not_found'); end if;
    when 'leads.create' then
      insert into public.leads (tenant_id, ticket, name, company, phone, email, address, type, source, source_detail, status, pri, value, follow_up, next_action_text, created, lang)
      values (t, 'AI-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.md5(gen_random_uuid()::text), 1, 6)), btrim(a ->> 'name'), nullif(a ->> 'company', ''),
              coalesce(a ->> 'phone', ''), coalesce(a ->> 'email', ''), coalesce(a ->> 'address', ''), coalesce(nullif(a ->> 'type', ''), 'other'),
              coalesce(nullif(a ->> 'source', ''), 'other'), pg_catalog.left(coalesce(a ->> 'sourceDetail', 'Added by ' || b.name), 300), 'new',
              coalesce(nullif(a ->> 'pri', ''), 'medium'), nullif(a ->> 'value', '')::numeric, nullif(a ->> 'followUp', '')::date,
              nullif(a ->> 'nextAction', ''), current_date, nullif(a ->> 'lang', ''))
      returning id into v_id;
      out := pg_catalog.jsonb_build_object('id', v_id);
    when 'leads.update' then
      -- the pipeline moves, but winning or losing a lead is a person's decision (approvals.request)
      if a ->> 'status' in ('won', 'lost') then raise exception 'needs_approval'; end if;
      update public.leads l set
          status = coalesce(nullif(a ->> 'status', ''), l.status), pri = coalesce(nullif(a ->> 'pri', ''), l.pri),
          follow_up = case when a ? 'followUp' then nullif(a ->> 'followUp', '')::date else l.follow_up end,
          next_action_text = case when a ? 'nextAction' then nullif(a ->> 'nextAction', '') else l.next_action_text end,
          next_action_due = case when a ? 'nextActionDue' then nullif(a ->> 'nextActionDue', '')::date else l.next_action_due end,
          updated_at = pg_catalog.now()
        where l.tenant_id = t and l.id = (a ->> 'id')::uuid returning l.id into v_id;
      out := case when v_id is null then pg_catalog.jsonb_build_object('error', 'not_found') else pg_catalog.jsonb_build_object('id', v_id) end;

    -- ---- clients (never a tax ID, a bank detail or the vault)
    when 'clients.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select c.id, c.name, c.company, c.phone, c.email, c.lifecycle, c.client_type as "clientType", c.tags, c.lang, c.since
          from public.clients c where c.tenant_id = t
           and (a ->> 'q' is null or c.name ilike '%' || (a ->> 'q') || '%' or c.company ilike '%' || (a ->> 'q') || '%')
         order by c.name limit v_lim) x;
    when 'clients.get' then
      select pg_catalog.to_jsonb(x) into out from (
        select c.id, c.name, c.company, c.phone, c.email, c.addresses, c.lifecycle, c.client_type as "clientType", c.tags, c.lang, c.since,
               c.email_opt_out as "emailOptOut", c.sms_opt_in as "smsOptIn",
               (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', j.id, 'name', j.name, 'status', j.status, 'price', j.price)), '[]'::jsonb)
                  from public.jobs j where j.tenant_id = t and j.client_id = c.id) as jobs,
               (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', n.at, 'kind', n.kind, 'text', n.text) order by n.at desc), '[]'::jsonb)
                  from (select * from public.notes n where n.tenant_id = t and n.client_id = c.id order by n.at desc limit 20) n) as notes
          from public.clients c where c.tenant_id = t and c.id = (a ->> 'id')::uuid) x;
      if out is null then out := pg_catalog.jsonb_build_object('error', 'not_found'); end if;
    when 'clients.update' then
      update public.clients c set
          phone = case when a ? 'phone' then coalesce(a ->> 'phone', '') else c.phone end,
          email = case when a ? 'email' then coalesce(a ->> 'email', '') else c.email end,
          company = case when a ? 'company' then nullif(a ->> 'company', '') else c.company end,
          lifecycle = coalesce(nullif(a ->> 'lifecycle', ''), c.lifecycle),
          tags = case when a ? 'tags' and jsonb_typeof(a -> 'tags') = 'array' then array(select jsonb_array_elements_text(a -> 'tags')) else c.tags end,
          updated_at = pg_catalog.now()
        where c.tenant_id = t and c.id = (a ->> 'id')::uuid returning c.id into v_id;
      out := case when v_id is null then pg_catalog.jsonb_build_object('error', 'not_found') else pg_catalog.jsonb_build_object('id', v_id) end;

    -- ---- jobs
    when 'jobs.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select j.id, j.number, j.name, j.client_id as "clientId", j.type, j.status, j.price, j.start_date as "start", j.end_date as "end"
          from public.jobs j where j.tenant_id = t and (a ->> 'status' is null or j.status = a ->> 'status')
         order by j.created desc nulls last limit v_lim) x;
    when 'jobs.get' then
      select pg_catalog.to_jsonb(x) into out from (
        select j.id, j.number, j.name, j.client_id as "clientId", j.type, j.status, j.price, j.start_date as "start", j.end_date as "end",
               j.scope, j.pay_terms as "payTerms",
               (select coalesce(sum(p.amount), 0) from public.client_payments p where p.tenant_id = t and p.job_id = j.id) as received
          from public.jobs j where j.tenant_id = t and j.id = (a ->> 'id')::uuid) x;
      if out is null then out := pg_catalog.jsonb_build_object('error', 'not_found'); end if;
    when 'jobs.update' then
      update public.jobs j set
          status = coalesce(nullif(a ->> 'status', ''), j.status),
          start_date = case when a ? 'start' then nullif(a ->> 'start', '')::date else j.start_date end,
          end_date = case when a ? 'end' then nullif(a ->> 'end', '')::date else j.end_date end,
          updated_at = pg_catalog.now()
        where j.tenant_id = t and j.id = (a ->> 'id')::uuid returning j.id into v_id;
      out := case when v_id is null then pg_catalog.jsonb_build_object('error', 'not_found') else pg_catalog.jsonb_build_object('id', v_id) end;

    -- ---- tasks
    when 'tasks.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select k.id, k.title, k.description, k.status, k.pri, k.due, k.type, k.lead_id as "leadId", k.client_id as "clientId", k.job_id as "jobId",
               (select m.name from public.tenant_members m where m.id = k.assignee_member_id) as assignee
          from public.tasks k where k.tenant_id = t
           and (a ->> 'status' is null or k.status = a ->> 'status')
           and (a ->> 'dueBefore' is null or k.due <= (a ->> 'dueBefore')::date)
         order by k.due nulls last, k.created_at desc limit v_lim) x;
    when 'tasks.create' then
      insert into public.tasks (tenant_id, title, description, status, pri, due, created, type, lead_id, client_id, job_id, assignee_member_id, requested_by)
      values (t, btrim(a ->> 'title'), nullif(a ->> 'description', ''), coalesce(nullif(a ->> 'status', ''), 'todo'), coalesce(nullif(a ->> 'pri', ''), 'medium'),
              nullif(a ->> 'due', '')::date, current_date, nullif(a ->> 'type', ''),
              nullif(a ->> 'leadId', '')::uuid, nullif(a ->> 'clientId', '')::uuid, nullif(a ->> 'jobId', '')::uuid,
              (select m.id from public.tenant_members m where m.tenant_id = t and m.status = 'active' and m.id = nullif(a ->> 'assigneeId', '')::uuid),
              pg_catalog.left(b.name, 60))
      returning id into v_id;
      out := pg_catalog.jsonb_build_object('id', v_id);
    when 'tasks.update' then
      update public.tasks k set
          title = coalesce(nullif(a ->> 'title', ''), k.title),
          description = case when a ? 'description' then nullif(a ->> 'description', '') else k.description end,
          status = coalesce(nullif(a ->> 'status', ''), k.status), pri = coalesce(nullif(a ->> 'pri', ''), k.pri),
          due = case when a ? 'due' then nullif(a ->> 'due', '')::date else k.due end,
          done_at = case when a ->> 'status' = 'done' then coalesce(k.done_at, current_date) when a ? 'status' then null else k.done_at end,
          updated_at = pg_catalog.now()
        where k.tenant_id = t and k.id = (a ->> 'id')::uuid returning k.id into v_id;
      out := case when v_id is null then pg_catalog.jsonb_build_object('error', 'not_found') else pg_catalog.jsonb_build_object('id', v_id) end;

    -- ---- calendar: what is booked in a window (jobs, visits, tasks due)
    when 'calendar.list' then
      select coalesce(pg_catalog.jsonb_agg(x order by x.date), '[]'::jsonb) into out from (
        select 'job' as kind, j.id, j.name as title, j.start_date as date from public.jobs j
         where j.tenant_id = t and j.start_date between coalesce((a ->> 'from')::date, current_date) and coalesce((a ->> 'to')::date, current_date + 14)
        union all
        select 'visit', l.id, l.name, l.appt_date from public.leads l
         where l.tenant_id = t and l.appt_date between coalesce((a ->> 'from')::date, current_date) and coalesce((a ->> 'to')::date, current_date + 14)
        union all
        select 'task', k.id, k.title, k.due from public.tasks k
         where k.tenant_id = t and k.status <> 'done' and k.due between coalesce((a ->> 'from')::date, current_date) and coalesce((a ->> 'to')::date, current_date + 14)
        limit 300) x;

    -- ---- notes on a lead, a client or a job (needs edit on that section)
    when 'notes.add' then
      insert into public.notes (tenant_id, parent_type, lead_id, client_id, job_id, at, kind, text, extra)
      values (t, a ->> 'parent', case when a ->> 'parent' = 'lead' then (a ->> 'id')::uuid end,
              case when a ->> 'parent' = 'client' then (a ->> 'id')::uuid end, case when a ->> 'parent' = 'job' then (a ->> 'id')::uuid end,
              pg_catalog.now(), 'note', pg_catalog.left(btrim(a ->> 'text'), 4000), pg_catalog.jsonb_build_object('by_bot', b.name))
      returning id into v_id;
      out := pg_catalog.jsonb_build_object('id', v_id);

    -- ---- documents (titles and status only: never a signature, an address or a device detail)
    when 'documents.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select d.id, d.kind, d.number, d.title, d.status, d.esign_status as "esignStatus", d.client_id as "clientId", d.job_id as "jobId", d.updated
          from public.documents d where d.tenant_id = t order by d.updated desc nulls last limit v_lim) x;

    -- ---- messages: a bot writes drafts; sending is a person's decision
    when 'messages.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select m.id, m.at, m.channel, m.dir, m.status, m.recipient, m.subject, pg_catalog.left(m.body, 500) as body, m.client_id as "clientId"
          from public.messages m where m.tenant_id = t and (a ->> 'status' is null or m.status = a ->> 'status')
         order by m.at desc limit v_lim) x;
    when 'messages.draft' then
      if coalesce(a ->> 'channel', 'email') not in ('email', 'text', 'whatsapp') then raise exception 'invalid_channel'; end if;
      insert into public.messages (tenant_id, at, channel, recipient, subject, body, status, dir, client_id, ref_type, ref_id, extra)
      values (t, pg_catalog.now(), coalesce(a ->> 'channel', 'email'), btrim(a ->> 'to'), coalesce(a ->> 'subject', ''), coalesce(a ->> 'body', ''), 'draft', 'out',
              nullif(a ->> 'clientId', '')::uuid,
              case when a ->> 'leadId' is not null then 'lead' when a ->> 'clientId' is not null then 'client' end,
              coalesce(nullif(a ->> 'leadId', '')::uuid, nullif(a ->> 'clientId', '')::uuid),
              pg_catalog.jsonb_build_object('drafted_by_bot', b.name))
      returning id into v_id;
      out := pg_catalog.jsonb_build_object('id', v_id, 'status', 'draft',
        'next', 'To send it, call approvals.request with kind message.send and target {"type":"message","id":"' || v_id || '"}.');

    -- ---- money (read only: amounts, dates, methods; never a bank or card detail)
    when 'payments.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select p.id, p.date, p.method, p.amount, p.job_id as "jobId", (select j.name from public.jobs j where j.id = p.job_id) as job
          from public.client_payments p where p.tenant_id = t order by p.date desc nulls last limit v_lim) x;
    when 'catalog.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select s.id, s.name, s.category, s.active,
               (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'name', r.name, 'price', r.price, 'unit', r.unit) order by r.position), '[]'::jsonb)
                  from public.catalog_tiers r where r.tenant_id = t and r.service_id = s.id) as tiers
          from public.catalog_services s where s.tenant_id = t order by s.name limit v_lim) x;
    when 'reports.summary' then
      out := pg_catalog.jsonb_build_object(
        'openLeads', (select pg_catalog.count(*) from public.leads l where l.tenant_id = t and l.status not in ('won', 'lost')),
        'pipelineValue', (select coalesce(sum(l.value), 0) from public.leads l where l.tenant_id = t and l.status not in ('won', 'lost')),
        'newLeads7d', (select pg_catalog.count(*) from public.leads l where l.tenant_id = t and l.created >= current_date - 7),
        'activeJobs', (select pg_catalog.count(*) from public.jobs j where j.tenant_id = t and j.status in ('contract', 'progress')),
        'overdueTasks', (select pg_catalog.count(*) from public.tasks k where k.tenant_id = t and k.status <> 'done' and k.due < current_date),
        'collectedThisMonth', (select coalesce(sum(p.amount), 0) from public.client_payments p where p.tenant_id = t and p.date >= pg_catalog.date_trunc('month', pg_catalog.now())::date),
        'pendingApprovals', (select pg_catalog.count(*) from app.approvals x where x.tenant_id = t and x.status = 'pending'),
        'note', 'Figures straight from the workspace records. Never add, round up or estimate.');
    when 'automations.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select r.id, r.name, r.active, r.event from public.rules r where r.tenant_id = t order by r.name limit 200) x;
    when 'team.list' then
      out := pg_catalog.jsonb_build_object(
        'people', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', m.id, 'name', m.name, 'role', m.role, 'title', m.title)), '[]'::jsonb)
                     from public.tenant_members m where m.tenant_id = t and m.status = 'active' and m.role <> 'worker'),
        'aiEmployees', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', x.name, 'title', x.title, 'status', x.status)), '[]'::jsonb)
                     from app.bots x where x.tenant_id = t));

    -- ---- approvals: the only way to anything a person must decide
    when 'approvals.request' then
      v_kind := a ->> 'kind';
      insert into app.approvals (tenant_id, bot_id, kind, level, what, why, risk_do, risk_dont, recommendation, deadline, target)
      values (t, b.id, v_kind, case when v_kind in ('payment', 'refund', 'payout', 'discount', 'contract', 'price.change', 'record.delete') then 3 else coalesce(nullif(a ->> 'level', '')::smallint, 2) end,
              btrim(a ->> 'what'), coalesce(a ->> 'why', ''), coalesce(a ->> 'riskIfWeDo', ''), coalesce(a ->> 'riskIfWeDont', ''),
              coalesce(a ->> 'recommendation', ''), nullif(a ->> 'deadline', '')::date, coalesce(a -> 'target', '{}'::jsonb))
      returning id into v_id;
      out := pg_catalog.jsonb_build_object('id', v_id, 'status', 'pending', 'note', 'Waiting for Daysi or Abdul in VYNTEX ERP, Approvals.');
    when 'approvals.list' then
      select coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb) into out from (
        select x.id, x.kind, x.what, x.status, x.decided_name as "decidedBy", x.decided_at as "decidedAt", x.note, x.created_at as "createdAt"
          from app.approvals x where x.tenant_id = t and x.bot_id = b.id and (a ->> 'status' is null or x.status = a ->> 'status')
         order by x.created_at desc limit v_lim) x;
    end case;
  exception when others then
    insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary)
      values (t, b.id, p_tool, case when sqlerrm = 'needs_approval' then 'denied' else 'invalid' end,
              pg_catalog.jsonb_build_object('reason', case when sqlerrm = 'needs_approval' then 'needs_approval' else pg_catalog.left(sqlstate, 5) end));
    return pg_catalog.jsonb_build_object('error', case when sqlerrm = 'needs_approval' then 'needs_approval' else 'invalid_arguments' end, 'tool', p_tool);
  end;

  insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary)
    values (t, b.id, p_tool, 'ok', pg_catalog.jsonb_build_object('id', coalesce(out ->> 'id', a ->> 'id'),
      'count', case when jsonb_typeof(out) = 'array' then jsonb_array_length(out) end));
  return coalesce(out, '{}'::jsonb);
end $$;
revoke all on function public.bot_call(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.bot_call(uuid, text, jsonb) to service_role;
