-- 0094: Photos in Team Chat (owner decision of November 5, 2026: "the team chat profile photos and the group photos can be
-- edited by all team members, whether Daysi and Abdul or the AI employees").
--   * people keep the profile photo they already have (Team > Profiles, tenant_members.photo); Team Chat now shows it
--   * app.bots.photo: an AI employee's photo. Any active team member may change it (public.bot_photo_set), and the AI
--     employee may set its own with its profile_photo_set tool (bot_call 'profile.photo_set'; the server stores the file)
--   * public.chat_rooms.photo: a group's photo. Any member of the group may change it (public.chat_room_photo_set)
--   * a photo is always a file in the company's own private folder: <company>/profiles/<name> or <company>/chat/<name>,
--     never a web address or an inline picture
-- Check after applying:
--   select pg_catalog.has_function_privilege('authenticated', 'public.chat_room_photo_set(uuid, uuid, text)', 'execute'),
--          pg_catalog.has_function_privilege('anon', 'public.bot_photo_set(uuid, uuid, text)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

alter table app.bots add column if not exists photo text check (photo is null or (length(photo) <= 500 and photo ~ '^[0-9a-f-]{36}/(profiles|chat)/[A-Za-z0-9][A-Za-z0-9._-]{4,120}$'));
alter table public.chat_rooms add column if not exists photo text check (photo is null or (length(photo) <= 500 and photo ~ '^[0-9a-f-]{36}/(profiles|chat)/[A-Za-z0-9][A-Za-z0-9._-]{4,120}$'));

-- a photo path is fine for a company when it sits in that company's own profiles or chat folder ('' or null: no photo)
create or replace function app.photo_path_ok(p_tenant uuid, p_path text) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_path, '') = '' or p_path ~ ('^' || p_tenant::text || '/(profiles|chat)/[A-Za-z0-9][A-Za-z0-9._-]{4,120}$')
$$;
revoke all on function app.photo_path_ok(uuid, text) from public, anon, authenticated;

-- a group's photo: any member of the group (a direct chat shows the other person's photo instead)
create or replace function public.chat_room_photo_set(p_tenant uuid, p_room uuid, p_photo text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null or not app.chat_is_member(p_room, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not app.photo_path_ok(p_tenant, p_photo) then raise exception 'invalid_photo' using errcode = '22023'; end if;
  update public.chat_rooms r set photo = nullif(p_photo, '') where r.id = p_room and r.tenant_id = p_tenant and r.kind = 'group';
  return found;
end $$;
revoke all on function public.chat_room_photo_set(uuid, uuid, text) from public, anon;
grant execute on function public.chat_room_photo_set(uuid, uuid, text) to authenticated;

-- an AI employee's photo, changed by any active team member (owner, manager or staff; not field workers)
create or replace function public.bot_photo_set(p_tenant uuid, p_bot uuid, p_photo text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if app.chat_me(p_tenant) is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not app.photo_path_ok(p_tenant, p_photo) then raise exception 'invalid_photo' using errcode = '22023'; end if;
  update app.bots b set photo = nullif(p_photo, ''), updated_at = pg_catalog.now() where b.id = p_bot and b.tenant_id = p_tenant;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.photo_set', 'ok', null, pg_catalog.jsonb_build_object('bot', p_bot));
  return true;
end $$;
revoke all on function public.bot_photo_set(uuid, uuid, text) from public, anon;
grant execute on function public.bot_photo_set(uuid, uuid, text) to authenticated;

-- the AI employee's own photo, from its profile_photo_set tool (the server stored the file and passes its path)
create or replace function app.bot_photo_own(p_bot uuid, p_tenant uuid, p_path text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_path, '') = '' or not app.photo_path_ok(p_tenant, p_path) then raise exception 'invalid_photo'; end if;
  update app.bots b set photo = p_path, updated_at = pg_catalog.now() where b.id = p_bot and b.tenant_id = p_tenant;
  return pg_catalog.jsonb_build_object('id', p_bot, 'photo', p_path);
end $$;
revoke all on function app.bot_photo_own(uuid, uuid, text) from public, anon, authenticated;

-- 0087's chat_sync, the same plus photos: rooms, members, people, AI employees and the person signed in
create or replace function public.chat_sync(p_tenant uuid, p_room uuid default null, p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_room is not null and not app.chat_is_member(p_room, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object(
    'me', me,
    'mePhoto', (select m.photo from public.tenant_members m where m.id = me),
    'now', pg_catalog.now(),
    'rooms', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'topic', r.topic, 'photo', r.photo, 'lastAt', r.last_at,
        'role', mine.role, 'muted', mine.muted, 'lastReadAt', mine.last_read_at,
        'unread', (select pg_catalog.count(*) from public.chat_messages x where x.room_id = r.id and x.created_at > mine.last_read_at and x.author_member is distinct from me and x.deleted_at is null),
        'mentioned', exists (select 1 from public.chat_messages x where x.room_id = r.id and x.created_at > mine.last_read_at and x.deleted_at is null
                       and x.mentions @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type', 'member', 'id', me::text))),
        'last', (select pg_catalog.jsonb_build_object('body', case when x.deleted_at is null then pg_catalog.left(x.body, 140) else '' end, 'files', pg_catalog.jsonb_array_length(x.files),
                   'name', coalesce((select m.name from public.tenant_members m where m.id = x.author_member), (select b.name from app.bots b where b.id = x.author_bot)), 'at', x.created_at)
                   from public.chat_messages x where x.room_id = r.id order by x.created_at desc limit 1),
        'members', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', case when c.member_id is not null then 'member' else 'bot' end,
                      'id', coalesce(c.member_id, c.bot_id), 'role', c.role, 'lastReadAt', c.last_read_at,
                      'name', coalesce((select m.name from public.tenant_members m where m.id = c.member_id), (select b.name from app.bots b where b.id = c.bot_id)),
                      'title', coalesce((select m.title from public.tenant_members m where m.id = c.member_id), (select b.title from app.bots b where b.id = c.bot_id)),
                      'photo', coalesce((select m.photo from public.tenant_members m where m.id = c.member_id), (select b.photo from app.bots b where b.id = c.bot_id)))
                      order by c.created_at) from public.chat_members c where c.room_id = r.id)) order by r.last_at desc)
      from public.chat_rooms r join public.chat_members mine on mine.room_id = r.id and mine.member_id = me
     where r.tenant_id = p_tenant and not r.archived), '[]'::jsonb),
    'people', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', 'member', 'id', m.id, 'name', m.name, 'title', m.title, 'role', m.role, 'photo', m.photo) order by m.name)
      from public.tenant_members m where m.tenant_id = p_tenant and m.status = 'active' and m.role <> 'worker' and m.id <> me), '[]'::jsonb),
    'bots', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', 'bot', 'id', b.id, 'name', b.name, 'title', b.title, 'live', b.webhook_url is not null, 'photo', b.photo) order by b.created_at)
      from app.bots b where b.tenant_id = p_tenant and b.status = 'active'), '[]'::jsonb),
    'messages', case when p_room is null then '[]'::jsonb else coalesce((select pg_catalog.jsonb_agg(app.chat_message_json(x) order by x.created_at) from (
        select * from public.chat_messages x where x.room_id = p_room
           and (p_since is null or x.created_at > p_since or x.edited_at > p_since or x.deleted_at > p_since
                or exists (select 1 from public.chat_reactions e where e.message_id = x.id and e.created_at > p_since))
         order by x.created_at desc limit 200) x), '[]'::jsonb) end);
end $$;

-- 0093's bot_list, the same plus the photo
create or replace function public.bot_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'title', b.title, 'department', b.department, 'reportsTo', b.reports_to,
      'mission', b.mission, 'access', b.access, 'status', b.status, 'hasKey', b.key_hash is not null, 'keyHint', b.key_hint,
      'keyCreatedAt', b.key_created_at, 'lastUsedAt', b.last_used_at, 'webhookUrl', b.webhook_url, 'webhookHint', b.webhook_hint,
      'webhookAuth', b.webhook_auth_sealed is not null, 'webhookAuthHint', b.webhook_auth_hint, 'photo', b.photo,
      'lastDelivery', (select pg_catalog.jsonb_build_object('status', d.status_code, 'error', d.error, 'attempts', d.attempts, 'kind', d.kind, 'at', d.updated_at)
                         from app.bot_webhook_deliveries d where d.bot_id = b.id order by d.created_at desc limit 1),
      'pending', (select pg_catalog.count(*) from app.approvals a where a.bot_id = b.id and a.status = 'pending'))
    order by b.created_at) from app.bots b where b.tenant_id = p_tenant), '[]'::jsonb);
end $$;

-- 0088's wrapper, the same plus profile.photo
create or replace function public.bot_call(p_bot uuid, p_tool text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b app.bots%rowtype; a jsonb := coalesce(p_args, '{}'::jsonb); out jsonb;
begin
  if p_tool not in ('chat.inbox', 'chat.send', 'chat.rooms', 'profile.photo_set') then return public.bot_call_0084(p_bot, p_tool, p_args); end if;
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
      when 'chat.rooms' then app.bot_chat_rooms(b.id, b.tenant_id)
      when 'profile.photo_set' then app.bot_photo_own(b.id, b.tenant_id, a ->> 'path') end;
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
