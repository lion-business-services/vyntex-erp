-- 0093: Every push to an AI employee's webhook is logged, and a test push can be sent (owner request of November 5, 2026,
-- after the routines answered 401 and nothing showed it).
--   * app.bot_webhook_deliveries: one row per push (a chat message, or a test), with the last HTTP status, a short
--     error (the start of the routine's answer, never a header or a secret), the attempts made, and when
--   * the server writes it (public.bot_delivery_log, server only); the AI employee card shows the last one (bot_list)
--   * public.bot_webhook_target: the bot's address and sealed headers, for a test push by the server only
--   * public.bot_webhook_test_check: may this person send a test push (owner or manager, verified sign-in)
-- Keys, webhook addresses and Authorization headers already saved are not touched.
-- Check after applying:
--   select pg_catalog.has_function_privilege('service_role', 'public.bot_delivery_log(uuid, uuid, uuid, uuid, text, integer, text, integer)', 'execute'),
--          pg_catalog.has_function_privilege('authenticated', 'public.bot_delivery_log(uuid, uuid, uuid, uuid, text, integer, text, integer)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists app.bot_webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  bot_id      uuid not null references app.bots (id) on delete cascade,
  message_id  uuid,
  kind        text not null default 'chat' check (kind in ('chat', 'test')),
  status_code integer check (status_code is null or status_code between 0 and 999),
  error       text check (error is null or length(error) <= 300),
  attempts    integer not null default 0 check (attempts between 0 and 10),
  created_at  timestamptz not null default pg_catalog.now(),
  updated_at  timestamptz not null default pg_catalog.now()
);
create index if not exists bot_webhook_deliveries_bot_idx on app.bot_webhook_deliveries (bot_id, created_at desc);
create index if not exists bot_webhook_deliveries_tenant_idx on app.bot_webhook_deliveries (tenant_id, created_at desc);
alter table app.bot_webhook_deliveries enable row level security;
alter table app.bot_webhook_deliveries force row level security;
revoke all on app.bot_webhook_deliveries from public, anon, authenticated;

-- the server's log: a new row (p_id null) or the next attempt of one
create or replace function public.bot_delivery_log(p_id uuid, p_tenant uuid, p_bot uuid, p_message uuid, p_kind text,
  p_status integer, p_error text, p_attempts integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  if v_id is null then
    insert into app.bot_webhook_deliveries (tenant_id, bot_id, message_id, kind, status_code, error, attempts)
    select b.tenant_id, b.id, p_message, coalesce(p_kind, 'chat'), p_status, pg_catalog.left(p_error, 300), greatest(0, least(10, coalesce(p_attempts, 0)))
      from app.bots b where b.id = p_bot and b.tenant_id = p_tenant
    returning id into v_id;
  else
    update app.bot_webhook_deliveries d set status_code = p_status, error = pg_catalog.left(p_error, 300),
        attempts = greatest(0, least(10, coalesce(p_attempts, d.attempts))), updated_at = pg_catalog.now()
     where d.id = v_id and d.tenant_id = p_tenant;
  end if;
  return v_id;
end $$;
revoke all on function public.bot_delivery_log(uuid, uuid, uuid, uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.bot_delivery_log(uuid, uuid, uuid, uuid, text, integer, text, integer) to service_role;

-- what a test push needs (server only): the address and the sealed signing secret and Authorization header
create or replace function public.bot_webhook_target(p_bot uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('bot', pg_catalog.jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
      'tenant', b.tenant_id, 'url', b.webhook_url, 'sealed', b.webhook_secret_sealed, 'auth', b.webhook_auth_sealed)
    from app.bots b where b.id = p_bot
$$;
revoke all on function public.bot_webhook_target(uuid) from public, anon, authenticated;
grant execute on function public.bot_webhook_target(uuid) to service_role;

-- may this person send a test push to this bot: owner or manager of its company
create or replace function public.bot_webhook_test_check(p_tenant uuid, p_bot uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return exists (select 1 from app.bots b where b.id = p_bot and b.tenant_id = p_tenant);
end $$;
revoke all on function public.bot_webhook_test_check(uuid, uuid) from public, anon;
grant execute on function public.bot_webhook_test_check(uuid, uuid) to authenticated;

-- 0091's bot_list, the same plus the last push
create or replace function public.bot_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'title', b.title, 'department', b.department, 'reportsTo', b.reports_to,
      'mission', b.mission, 'access', b.access, 'status', b.status, 'hasKey', b.key_hash is not null, 'keyHint', b.key_hint,
      'keyCreatedAt', b.key_created_at, 'lastUsedAt', b.last_used_at, 'webhookUrl', b.webhook_url, 'webhookHint', b.webhook_hint,
      'webhookAuth', b.webhook_auth_sealed is not null, 'webhookAuthHint', b.webhook_auth_hint,
      'lastDelivery', (select pg_catalog.jsonb_build_object('status', d.status_code, 'error', d.error, 'attempts', d.attempts, 'kind', d.kind, 'at', d.updated_at)
                         from app.bot_webhook_deliveries d where d.bot_id = b.id order by d.created_at desc limit 1),
      'pending', (select pg_catalog.count(*) from app.approvals a where a.bot_id = b.id and a.status = 'pending'))
    order by b.created_at) from app.bots b where b.tenant_id = p_tenant), '[]'::jsonb);
end $$;
