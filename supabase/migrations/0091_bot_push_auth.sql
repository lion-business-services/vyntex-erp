-- 0091: Push delivery to the AI employees with each bot's own Authorization header (owner decision of November 5, 2026:
-- the AI employees wake on webhooks, so each bot's Chat address is its Grok routine webhook, and the push carries the
-- Authorization header that routine expects).
--   * app.bots.webhook_auth_sealed: the header value (for example "Bearer ..."), sealed by the server with its key, like
--     the signing secret; never shown again and never readable from the browser. webhook_auth_hint: its last 4 characters
--   * public.bot_webhook_set gains p_auth_sealed / p_auth_hint / p_auth_mode: 'keep' (the saved header stays, the default
--     when only the address changes), 'set' (a new header), 'clear' (none). Turning the address off clears both
--   * public.chat_bot_delivery hands the sealed header to the server for the push; bot_list shows whether one is saved
-- Check after applying:
--   select pg_catalog.has_function_privilege('authenticated', 'public.bot_webhook_set(uuid, uuid, text, text, text, text, text, text)', 'execute'),
--          pg_catalog.has_function_privilege('anon', 'public.chat_bot_delivery(uuid, uuid)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

alter table app.bots add column if not exists webhook_auth_sealed text check (webhook_auth_sealed is null or length(webhook_auth_sealed) <= 3000);
alter table app.bots add column if not exists webhook_auth_hint text check (webhook_auth_hint is null or webhook_auth_hint ~ '^[A-Za-z0-9._~+/=-]{1,4}$');

drop function if exists public.bot_webhook_set(uuid, uuid, text, text, text);
create or replace function public.bot_webhook_set(p_tenant uuid, p_bot uuid, p_url text, p_sealed text, p_hint text,
  p_auth_mode text default 'keep', p_auth_sealed text default null, p_auth_hint text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_off boolean := nullif(p_url, '') is null;
begin
  perform app.bot_admin(p_tenant, true);
  perform app.require_stepup(300);
  if coalesce(p_auth_mode, 'keep') not in ('keep', 'set', 'clear') or (p_auth_mode = 'set' and nullif(p_auth_sealed, '') is null) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  update app.bots b set webhook_url = nullif(p_url, ''),
      webhook_secret_sealed = case when v_off then null else p_sealed end,
      webhook_hint = case when v_off then null else p_hint end,
      webhook_auth_sealed = case when v_off or p_auth_mode = 'clear' then null when p_auth_mode = 'set' then p_auth_sealed else b.webhook_auth_sealed end,
      webhook_auth_hint = case when v_off or p_auth_mode = 'clear' then null when p_auth_mode = 'set' then p_auth_hint else b.webhook_auth_hint end,
      updated_at = pg_catalog.now()
   where b.id = p_bot and b.tenant_id = p_tenant;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.webhook_set', 'ok', null,
    pg_catalog.jsonb_build_object('bot', p_bot, 'off', v_off, 'auth', coalesce(p_auth_mode, 'keep')));
  return true;
end $$;
revoke all on function public.bot_webhook_set(uuid, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.bot_webhook_set(uuid, uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.chat_bot_delivery(p_bot uuid, p_message uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('bot', pg_catalog.jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
      'url', b.webhook_url, 'sealed', b.webhook_secret_sealed, 'auth', b.webhook_auth_sealed, 'tenant', b.tenant_id,
      'room', pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', case when r.kind = 'direct' then '' else r.name end),
      'message', app.chat_message_json(x))
    from app.bots b join public.chat_messages x on x.tenant_id = b.tenant_id join public.chat_rooms r on r.id = x.room_id
   where b.id = p_bot and x.id = p_message and b.status = 'active' and app.chat_bots_for(x.id) @> array[b.id]
$$;
revoke all on function public.chat_bot_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_bot_delivery(uuid, uuid) to service_role;

create or replace function public.bot_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'title', b.title, 'department', b.department, 'reportsTo', b.reports_to,
      'mission', b.mission, 'access', b.access, 'status', b.status, 'hasKey', b.key_hash is not null, 'keyHint', b.key_hint,
      'keyCreatedAt', b.key_created_at, 'lastUsedAt', b.last_used_at, 'webhookUrl', b.webhook_url, 'webhookHint', b.webhook_hint,
      'webhookAuth', b.webhook_auth_sealed is not null, 'webhookAuthHint', b.webhook_auth_hint,
      'pending', (select pg_catalog.count(*) from app.approvals a where a.bot_id = b.id and a.status = 'pending'))
    order by b.created_at) from app.bots b where b.tenant_id = p_tenant), '[]'::jsonb);
end $$;
