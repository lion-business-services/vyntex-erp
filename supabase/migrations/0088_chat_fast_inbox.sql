-- 0088: Fast replies from the AI employees in Team Chat (owner decision of November 4, 2026: "quick and highly responsive
-- whenever any employee is mentioned, DM or group chat", the way NOVA CRM's bots work, with no address to set up).
--   * an AI employee keeps one chat_inbox call open with "wait": the server holds it up to 25 seconds and answers the
--     moment a direct message or an @mention for it arrives (api/_lib/public/bot.js). While it waits, the server asks
--     public.chat_bot_pending once a second: a read that writes nothing
--   * a message shows up once it is one second old, and the inbox marks a room read only up to the newest message it
--     handed out, so a message that was still being saved is never skipped
--   * an inbox call that found nothing is not written to the activity log (a waiting bot asks about 3 times a minute)
-- The chat address (webhook) of 0087 stays available as an option; nothing else changes.
-- Check after applying:  select pg_catalog.has_function_privilege('service_role', 'public.chat_bot_pending(uuid)', 'execute'),
--                               pg_catalog.has_function_privilege('authenticated', 'public.chat_bot_pending(uuid)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

-- what is waiting for this AI employee: direct chats, and @mentions of it in groups, not its own messages
create or replace function app.chat_bot_waiting(p_bot uuid, p_tenant uuid) returns setof public.chat_messages
language sql stable security definer set search_path = '' as $$
  select x.* from public.chat_messages x
    join public.chat_members c on c.room_id = x.room_id and c.bot_id = p_bot
    join public.chat_rooms r on r.id = x.room_id
   where x.tenant_id = p_tenant and c.tenant_id = p_tenant
     and x.created_at > c.last_read_at and x.created_at < pg_catalog.clock_timestamp() - interval '1 second'
     and x.author_bot is distinct from p_bot and x.deleted_at is null and not r.archived
     and (r.kind = 'direct' or x.mentions @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type', 'bot', 'id', p_bot::text)))
$$;
revoke all on function app.chat_bot_waiting(uuid, uuid) from public, anon, authenticated;

-- the server's once-a-second question while a bot waits: is there anything? Writes nothing
create or replace function public.chat_bot_pending(p_bot uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.bots b, app.chat_bot_waiting(b.id, b.tenant_id) x where b.id = p_bot and b.status = 'active')
$$;
revoke all on function public.chat_bot_pending(uuid) from public, anon, authenticated;
grant execute on function public.chat_bot_pending(uuid) to service_role;

-- 0087's inbox, now marking each room read only up to the newest message it returns (oldest first, at most p_limit)
create or replace function app.bot_chat_inbox(p_bot uuid, p_tenant uuid, p_limit int) returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  -- one statement: the messages picked, the rooms marked read up to the newest of them (a data-changing step of a WITH
  -- always runs once), and the answer built from the same pick
  with picked as (
    select x.id, x.room_id, x.created_at from app.chat_bot_waiting(p_bot, p_tenant) x order by x.created_at, x.id limit p_limit
  ), marked as (
    update public.chat_members c set last_read_at = g.upto
      from (select p.room_id, pg_catalog.max(p.created_at) as upto from picked p group by p.room_id) g
     where c.room_id = g.room_id and c.bot_id = p_bot and c.tenant_id = p_tenant and c.last_read_at < g.upto
    returning c.id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('room', pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name),
           'message', app.chat_message_json(x)) order by x.created_at, x.id), '[]'::jsonb)
    into out from picked p join public.chat_messages x on x.id = p.id join public.chat_rooms r on r.id = x.room_id;
  return out;
end $$;
revoke all on function app.bot_chat_inbox(uuid, uuid, int) from public, anon, authenticated;

-- 0087's wrapper, the same but for one thing: an inbox call that found nothing leaves no activity row
create or replace function public.bot_call(p_bot uuid, p_tool text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b app.bots%rowtype; a jsonb := coalesce(p_args, '{}'::jsonb); out jsonb;
begin
  if p_tool not in ('chat.inbox', 'chat.send', 'chat.rooms') then return public.bot_call_0084(p_bot, p_tool, p_args); end if;
  select * into b from app.bots x where x.id = p_bot and x.status = 'active';
  if b.id is null then return pg_catalog.jsonb_build_object('error', 'bot_not_active'); end if;
  if not coalesce((select app.tenant_open(t.status, t.trial_expires_at) from public.tenants t where t.id = b.tenant_id), false) then
    return pg_catalog.jsonb_build_object('error', 'workspace_closed');
  end if;
  if jsonb_typeof(a) <> 'object' or octet_length(a::text) > 16384 then return pg_catalog.jsonb_build_object('error', 'invalid_arguments'); end if;
  begin
    out := case p_tool
      when 'chat.inbox' then app.bot_chat_inbox(b.id, b.tenant_id, case when coalesce(a ->> 'limit', '') ~ '^[0-9]{1,3}$' then least(greatest((a ->> 'limit')::int, 1), 100) else 50 end)
      when 'chat.send' then app.bot_chat_send(b.id, b.tenant_id, a)
      when 'chat.rooms' then app.bot_chat_rooms(b.id, b.tenant_id) end;
  exception when others then
    insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary) values (b.tenant_id, b.id, p_tool, 'invalid',
      pg_catalog.jsonb_build_object('reason', case when sqlerrm in ('not_a_member', 'empty') then sqlerrm else pg_catalog.left(sqlstate, 5) end));
    return pg_catalog.jsonb_build_object('error', case when sqlerrm = 'not_a_member' then 'not_a_member' else 'invalid_arguments' end, 'tool', p_tool);
  end;
  if p_tool = 'chat.inbox' and jsonb_typeof(out) = 'array' and jsonb_array_length(out) = 0 then return out; end if;
  insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary)
    values (b.tenant_id, b.id, p_tool, 'ok', pg_catalog.jsonb_build_object('id', out ->> 'id', 'count', case when jsonb_typeof(out) = 'array' then jsonb_array_length(out) end));
  return out;
end $$;
revoke all on function public.bot_call(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.bot_call(uuid, text, jsonb) to service_role;
