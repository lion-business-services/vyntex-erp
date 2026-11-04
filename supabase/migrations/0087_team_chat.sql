-- 0087: Team chat (owner decision of November 4, 2026): group chats and direct chats for the people of a company, with
-- @mentions, replies, reactions, read ticks, files, English/Spanish translation, and VYNTEX USA's AI employees as team
-- members ("ERP pings the bots"):
--   * a room is a group (named, with admins) or a direct chat between two people, or a person and an AI employee
--   * only the room's members read it: the access rules below, and every function checks membership again
--   * a message to a room an AI employee is in reaches that AI employee when the room is a direct chat with it, or the
--     message @mentions it. The server sends it to the bot's own address, signed (api/_lib/chat/deliver.js); the bot
--     answers with the chat_send tool (public.bot_call). An AI employee only ever reads the rooms it is a member of
--   * text is kept as written; a translation is cached per message and language (api/_lib/chat/translate.js)
--   * a person edits or removes only their own messages; a removed message keeps its place and loses its text
--   * files go to the company's private storage under chat/ (0028 rules), shown through one-minute links
-- Every write goes through the functions below; nobody writes the tables directly.
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.chat_rooms (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  kind        text not null check (kind in ('group', 'direct')),
  name        text not null default '' check (length(name) <= 80),
  topic       text not null default '' check (length(topic) <= 300),
  -- for a direct chat: the two ends, sorted, so the same pair always finds the same room
  pair_key    text check (pair_key is null or length(pair_key) <= 100),
  created_by  uuid,
  last_at     timestamptz not null default pg_catalog.now(),
  archived    boolean not null default false,
  extra       jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at  timestamptz not null default pg_catalog.now(),
  unique (tenant_id, id),
  unique (tenant_id, pair_key)
);
create index if not exists chat_rooms_tenant_idx on public.chat_rooms (tenant_id, last_at desc);

create table if not exists public.chat_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  room_id     uuid not null,
  member_id   uuid,
  bot_id      uuid,
  role        text not null default 'member' check (role in ('admin', 'member')),
  last_read_at timestamptz not null default pg_catalog.now(),
  muted       boolean not null default false,
  extra       jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at  timestamptz not null default pg_catalog.now(),
  check ((member_id is null) <> (bot_id is null)),
  foreign key (tenant_id, room_id) references public.chat_rooms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade
);
create unique index if not exists chat_members_person_uq on public.chat_members (room_id, member_id) where member_id is not null;
create unique index if not exists chat_members_bot_uq on public.chat_members (room_id, bot_id) where bot_id is not null;
create index if not exists chat_members_tenant_idx on public.chat_members (tenant_id, member_id);
create index if not exists chat_members_room_idx on public.chat_members (tenant_id, room_id);

create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  room_id      uuid not null,
  author_member uuid,
  author_bot   uuid,
  body         text not null default '' check (length(body) <= 8000),
  reply_to     uuid,
  -- [{ "type": "member" | "bot", "id": "..." }]
  mentions     jsonb not null default '[]'::jsonb check (jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) <= 30),
  -- [{ "name": "...", "size": 123, "mime": "...", "path": "<tenant>/chat/<random>.<ext>" }]
  files        jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 10),
  -- { "es": "...", "en": "..." } cached by the server
  translations jsonb not null default '{}'::jsonb check (jsonb_typeof(translations) = 'object'),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  extra        jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at   timestamptz not null default pg_catalog.now(),
  check ((author_member is null) <> (author_bot is null)),
  unique (tenant_id, id),
  foreign key (tenant_id, room_id) references public.chat_rooms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, author_member) references public.tenant_members (tenant_id, id) on delete restrict
);
create index if not exists chat_messages_room_idx on public.chat_messages (tenant_id, room_id, created_at desc);
create index if not exists chat_messages_author_idx on public.chat_messages (tenant_id, author_member);

create table if not exists public.chat_reactions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  message_id  uuid not null,
  member_id   uuid,
  bot_id      uuid,
  emoji       text not null check (emoji in ('👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🔥')),
  extra       jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at  timestamptz not null default pg_catalog.now(),
  check ((member_id is null) <> (bot_id is null)),
  foreign key (tenant_id, message_id) references public.chat_messages (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade
);
create unique index if not exists chat_reactions_person_uq on public.chat_reactions (message_id, member_id, emoji) where member_id is not null;
create unique index if not exists chat_reactions_bot_uq on public.chat_reactions (message_id, bot_id, emoji) where bot_id is not null;
create index if not exists chat_reactions_msg_idx on public.chat_reactions (tenant_id, message_id);
create index if not exists chat_reactions_member_idx on public.chat_reactions (tenant_id, member_id);

-- the AI employee's address for chat (owner, fresh identity check): where the server sends a message meant for it,
-- signed with a secret only the server can open (sealed with the server's key, never readable by a person)
alter table app.bots add column if not exists webhook_url text check (webhook_url is null or (length(webhook_url) <= 500 and webhook_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^\s]*)?$'));
alter table app.bots add column if not exists webhook_secret_sealed text check (webhook_secret_sealed is null or length(webhook_secret_sealed) <= 600);
alter table app.bots add column if not exists webhook_hint text check (webhook_hint is null or webhook_hint ~ '^[A-Za-z0-9_]{4,16}$');

-- ---------------------------------------------------------------------------------------------------------------------
-- access: members of the room read it; nobody writes directly
-- ---------------------------------------------------------------------------------------------------------------------
-- the person's membership id in this company, when the company is open to them and they are not a field worker
create or replace function app.chat_me(p_tenant uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.tenant_members m
   where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
     and app.member_role(p_tenant) is not null
$$;
revoke all on function app.chat_me(uuid) from public, anon;
grant execute on function app.chat_me(uuid) to authenticated;

-- the rooms the signed-in person is a member of, in every company they work in (once per statement)
create or replace function app.chat_my_rooms() returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(c.room_id), '{}'::uuid[]) from public.chat_members c
    join public.tenant_members m on m.id = c.member_id
   where m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
     and c.tenant_id = any ((select app.session_tenants())::uuid[])
$$;
revoke all on function app.chat_my_rooms() from public, anon;
grant execute on function app.chat_my_rooms() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['chat_rooms', 'chat_members', 'chat_messages', 'chat_reactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy chat_rooms_select on public.chat_rooms for select to authenticated using (id = any ((select app.chat_my_rooms())::uuid[]));
create policy chat_members_select on public.chat_members for select to authenticated using (room_id = any ((select app.chat_my_rooms())::uuid[]));
create policy chat_messages_select on public.chat_messages for select to authenticated using (room_id = any ((select app.chat_my_rooms())::uuid[]));
create policy chat_reactions_select on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages x where x.id = message_id and x.room_id = any ((select app.chat_my_rooms())::uuid[])));

-- ---------------------------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.chat_is_member(p_room uuid, p_member uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members c where c.room_id = p_room and c.member_id = p_member)
$$;
revoke all on function app.chat_is_member(uuid, uuid) from public, anon, authenticated;

create or replace function app.chat_message_json(x public.chat_messages) returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('id', x.id, 'roomId', x.room_id, 'at', x.created_at,
    'author', case when x.author_member is not null then pg_catalog.jsonb_build_object('type', 'member', 'id', x.author_member, 'name', (select m.name from public.tenant_members m where m.id = x.author_member))
                   else pg_catalog.jsonb_build_object('type', 'bot', 'id', x.author_bot, 'name', (select b.name from app.bots b where b.id = x.author_bot), 'title', (select b.title from app.bots b where b.id = x.author_bot)) end,
    'body', case when x.deleted_at is null then x.body else '' end, 'deleted', x.deleted_at is not null, 'editedAt', x.edited_at,
    'replyTo', case when x.reply_to is null then null else (select pg_catalog.jsonb_build_object('id', r.id, 'body', case when r.deleted_at is null then pg_catalog.left(r.body, 160) else '' end,
        'name', coalesce((select m.name from public.tenant_members m where m.id = r.author_member), (select b.name from app.bots b where b.id = r.author_bot)))
        from public.chat_messages r where r.id = x.reply_to) end,
    'mentions', x.mentions, 'files', case when x.deleted_at is null then x.files else '[]'::jsonb end, 'translations', x.translations,
    'reactions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('emoji', g.emoji, 'n', g.n, 'who', g.who, 'ids', g.ids)) from (
        select e.emoji, pg_catalog.count(*) as n,
               pg_catalog.jsonb_agg(coalesce((select m.name from public.tenant_members m where m.id = e.member_id), (select b.name from app.bots b where b.id = e.bot_id))) as who,
               pg_catalog.jsonb_agg(coalesce(e.member_id, e.bot_id)) as ids
          from public.chat_reactions e where e.message_id = x.id group by e.emoji) g), '[]'::jsonb))
$$;
revoke all on function app.chat_message_json(public.chat_messages) from public, anon, authenticated;

-- the mentions of a message, kept only when they name a person or an AI employee who is in the room
create or replace function app.chat_clean_mentions(p_room uuid, p jsonb) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(distinct pg_catalog.jsonb_build_object('type', e ->> 'type', 'id', e ->> 'id')), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
   where (e ->> 'type' = 'member' and exists (select 1 from public.chat_members c where c.room_id = p_room and c.member_id::text = e ->> 'id'))
      or (e ->> 'type' = 'bot' and exists (select 1 from public.chat_members c where c.room_id = p_room and c.bot_id::text = e ->> 'id'))
$$;
revoke all on function app.chat_clean_mentions(uuid, jsonb) from public, anon, authenticated;

-- the files of a message: only paths of this company's chat area, as the server made them (api/ws.js, file/upload)
create or replace function app.chat_clean_files(p_tenant uuid, p jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare f jsonb; out jsonb := '[]'::jsonb;
begin
  for f in select * from pg_catalog.jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) loop
    if coalesce(f ->> 'path', '') !~ ('^' || p_tenant::text || '/chat/[A-Za-z0-9][A-Za-z0-9._-]{4,120}$') then raise exception 'invalid_file' using errcode = '22023'; end if;
    out := out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path', f ->> 'path', 'name', pg_catalog.left(coalesce(f ->> 'name', 'file'), 200),
      'size', coalesce(nullif(f ->> 'size', '')::bigint, 0), 'mime', pg_catalog.left(coalesce(f ->> 'mime', ''), 120)));
  end loop;
  return out;
end $$;
revoke all on function app.chat_clean_files(uuid, jsonb) from public, anon, authenticated;

-- the AI employees a new message is meant for: a direct chat with one, or an @mention of one in the room
create or replace function app.chat_bots_for(p_message uuid) returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(distinct c.bot_id), '{}'::uuid[])
    from public.chat_messages x join public.chat_rooms r on r.id = x.room_id
    join public.chat_members c on c.room_id = x.room_id and c.bot_id is not null
    join app.bots b on b.id = c.bot_id and b.status = 'active'
   where x.id = p_message and c.bot_id is distinct from x.author_bot
     and (r.kind = 'direct' or x.mentions @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type', 'bot', 'id', c.bot_id::text)))
$$;
revoke all on function app.chat_bots_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- for the people of the company (through /api/ws/rpc and the office operations)
-- ---------------------------------------------------------------------------------------------------------------------
-- everything the chat screen needs since a moment: the rooms with their members and unread counts, the people and AI
-- employees one can start a chat with, and the messages of one open room
create or replace function public.chat_sync(p_tenant uuid, p_room uuid default null, p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_room is not null and not app.chat_is_member(p_room, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object(
    'me', me,
    'now', pg_catalog.now(),
    'rooms', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'topic', r.topic, 'lastAt', r.last_at,
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
                      'title', coalesce((select m.title from public.tenant_members m where m.id = c.member_id), (select b.title from app.bots b where b.id = c.bot_id)))
                      order by c.created_at) from public.chat_members c where c.room_id = r.id)) order by r.last_at desc)
      from public.chat_rooms r join public.chat_members mine on mine.room_id = r.id and mine.member_id = me
     where r.tenant_id = p_tenant and not r.archived), '[]'::jsonb),
    'people', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', 'member', 'id', m.id, 'name', m.name, 'title', m.title, 'role', m.role) order by m.name)
      from public.tenant_members m where m.tenant_id = p_tenant and m.status = 'active' and m.role <> 'worker' and m.id <> me), '[]'::jsonb),
    'bots', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', 'bot', 'id', b.id, 'name', b.name, 'title', b.title, 'live', b.webhook_url is not null) order by b.created_at)
      from app.bots b where b.tenant_id = p_tenant and b.status = 'active'), '[]'::jsonb),
    'messages', case when p_room is null then '[]'::jsonb else coalesce((select pg_catalog.jsonb_agg(app.chat_message_json(x) order by x.created_at) from (
        select * from public.chat_messages x where x.room_id = p_room
           and (p_since is null or x.created_at > p_since or x.edited_at > p_since or x.deleted_at > p_since
                or exists (select 1 from public.chat_reactions e where e.message_id = x.id and e.created_at > p_since))
         order by x.created_at desc limit 200) x), '[]'::jsonb) end);
end $$;

-- older messages of a room, before one moment
create or replace function public.chat_history(p_tenant uuid, p_room uuid, p_before timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null or not app.chat_is_member(p_room, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(app.chat_message_json(x) order by x.created_at) from (
    select * from public.chat_messages x where x.room_id = p_room and x.created_at < p_before order by x.created_at desc limit 100) x), '[]'::jsonb);
end $$;

-- a group (the creator is its admin), or the direct chat with one person or one AI employee (found again if it exists)
create or replace function public.chat_room_open(p_tenant uuid, p_room jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant); v_id uuid; v_kind text := p_room ->> 'kind'; v_with jsonb := p_room -> 'with'; v_key text; e jsonb; n int := 0;
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if v_kind = 'direct' then
    if v_with ->> 'type' = 'member' and exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.id::text = v_with ->> 'id' and m.status = 'active' and m.role <> 'worker' and m.id <> me) then
      v_key := 'm:' || least(me::text, v_with ->> 'id') || ':' || greatest(me::text, v_with ->> 'id');
    elsif v_with ->> 'type' = 'bot' and exists (select 1 from app.bots b where b.tenant_id = p_tenant and b.id::text = v_with ->> 'id' and b.status = 'active') then
      v_key := 'b:' || me::text || ':' || (v_with ->> 'id');
    else raise exception 'not_found' using errcode = 'P0002'; end if;
    select r.id into v_id from public.chat_rooms r where r.tenant_id = p_tenant and r.pair_key = v_key;
    if v_id is not null then update public.chat_rooms r set archived = false where r.id = v_id; return v_id; end if;
    insert into public.chat_rooms (tenant_id, kind, pair_key, created_by) values (p_tenant, 'direct', v_key, me) returning id into v_id;
    insert into public.chat_members (tenant_id, room_id, member_id, role) values (p_tenant, v_id, me, 'admin');
    if v_with ->> 'type' = 'member' then insert into public.chat_members (tenant_id, room_id, member_id, role) values (p_tenant, v_id, (v_with ->> 'id')::uuid, 'admin');
    else insert into public.chat_members (tenant_id, room_id, bot_id) values (p_tenant, v_id, (v_with ->> 'id')::uuid); end if;
    return v_id;
  elsif v_kind = 'group' then
    if length(btrim(coalesce(p_room ->> 'name', ''))) not between 1 and 80 then raise exception 'name_required' using errcode = '22023'; end if;
    insert into public.chat_rooms (tenant_id, kind, name, topic, created_by) values (p_tenant, 'group', btrim(p_room ->> 'name'), pg_catalog.left(coalesce(p_room ->> 'topic', ''), 300), me) returning id into v_id;
    insert into public.chat_members (tenant_id, room_id, member_id, role) values (p_tenant, v_id, me, 'admin');
    for e in select * from pg_catalog.jsonb_array_elements(case when jsonb_typeof(p_room -> 'members') = 'array' then p_room -> 'members' else '[]'::jsonb end) loop
      n := n + 1; if n > 100 then exit; end if;
      perform app.chat_add(p_tenant, v_id, e);
    end loop;
    return v_id;
  end if;
  raise exception 'invalid' using errcode = '22023';
end $$;

create or replace function app.chat_add(p_tenant uuid, p_room uuid, e jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if e ->> 'type' = 'member' and exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant and m.id::text = e ->> 'id' and m.status = 'active' and m.role <> 'worker') then
    insert into public.chat_members (tenant_id, room_id, member_id) values (p_tenant, p_room, (e ->> 'id')::uuid) on conflict do nothing;
  elsif e ->> 'type' = 'bot' and exists (select 1 from app.bots b where b.tenant_id = p_tenant and b.id::text = e ->> 'id' and b.status = 'active') then
    insert into public.chat_members (tenant_id, room_id, bot_id) values (p_tenant, p_room, (e ->> 'id')::uuid) on conflict do nothing;
  end if;
end $$;
revoke all on function app.chat_add(uuid, uuid, jsonb) from public, anon, authenticated;

-- a group's admin renames it, changes its topic, adds or removes members; anyone leaves a group
create or replace function public.chat_room_update(p_tenant uuid, p_room uuid, p_change jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant); v_role text; e jsonb;
begin
  select c.role into v_role from public.chat_members c join public.chat_rooms r on r.id = c.room_id
   where c.room_id = p_room and c.member_id = me and r.tenant_id = p_tenant and r.kind = 'group';
  if me is null or v_role is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_change ? 'leave' then
    delete from public.chat_members c where c.room_id = p_room and c.member_id = me;
    -- a group never stays without an admin
    if not exists (select 1 from public.chat_members c where c.room_id = p_room and c.role = 'admin' and c.member_id is not null) then
      update public.chat_members c set role = 'admin' where c.id = (select x.id from public.chat_members x where x.room_id = p_room and x.member_id is not null order by x.created_at limit 1);
    end if;
    return true;
  end if;
  if v_role <> 'admin' then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.chat_rooms r set name = coalesce(nullif(btrim(p_change ->> 'name'), ''), r.name), topic = coalesce(pg_catalog.left(p_change ->> 'topic', 300), r.topic) where r.id = p_room;
  for e in select * from pg_catalog.jsonb_array_elements(case when jsonb_typeof(p_change -> 'add') = 'array' then p_change -> 'add' else '[]'::jsonb end) loop
    perform app.chat_add(p_tenant, p_room, e);
  end loop;
  for e in select * from pg_catalog.jsonb_array_elements(case when jsonb_typeof(p_change -> 'remove') = 'array' then p_change -> 'remove' else '[]'::jsonb end) loop
    delete from public.chat_members c where c.room_id = p_room and coalesce(c.member_id, c.bot_id)::text = e ->> 'id' and c.member_id is distinct from me;
  end loop;
  if jsonb_typeof(p_change -> 'admins') = 'array' then
    update public.chat_members c set role = case when (p_change -> 'admins') ? c.member_id::text then 'admin' else 'member' end where c.room_id = p_room and c.member_id is not null and c.member_id <> me;
  end if;
  return true;
end $$;

-- a message. Answers the message and the AI employees it is meant for (the server sends it to them)
create or replace function public.chat_send(p_tenant uuid, p_room uuid, p_body text, p_reply_to uuid default null, p_mentions jsonb default '[]'::jsonb, p_files jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant); x public.chat_messages; v_files jsonb;
begin
  if me is null or not app.chat_is_member(p_room, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_files := app.chat_clean_files(p_tenant, p_files);
  if length(btrim(coalesce(p_body, ''))) = 0 and jsonb_array_length(v_files) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  if length(p_body) > 8000 then raise exception 'too_long' using errcode = '22023'; end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = p_reply_to and r.room_id = p_room) then raise exception 'invalid' using errcode = '22023'; end if;
  insert into public.chat_messages (tenant_id, room_id, author_member, body, reply_to, mentions, files)
  values (p_tenant, p_room, me, coalesce(p_body, ''), p_reply_to, app.chat_clean_mentions(p_room, p_mentions), v_files) returning * into x;
  update public.chat_rooms r set last_at = x.created_at, archived = false where r.id = p_room;
  update public.chat_members c set last_read_at = x.created_at where c.room_id = p_room and c.member_id = me;
  return pg_catalog.jsonb_build_object('message', app.chat_message_json(x), 'bots', pg_catalog.to_jsonb(app.chat_bots_for(x.id)));
end $$;

create or replace function public.chat_edit(p_tenant uuid, p_message uuid, p_body text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 8000 then raise exception 'invalid' using errcode = '22023'; end if;
  update public.chat_messages x set body = p_body, edited_at = pg_catalog.now(), translations = '{}'::jsonb
   where x.id = p_message and x.tenant_id = p_tenant and x.author_member = me and x.deleted_at is null;
  return found;
end $$;

create or replace function public.chat_delete(p_tenant uuid, p_message uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.chat_messages x set deleted_at = pg_catalog.now(), body = '', files = '[]'::jsonb, translations = '{}'::jsonb
   where x.id = p_message and x.tenant_id = p_tenant and x.author_member = me and x.deleted_at is null;
  return found;
end $$;

create or replace function public.chat_react(p_tenant uuid, p_message uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant); v_room uuid;
begin
  select x.room_id into v_room from public.chat_messages x where x.id = p_message and x.tenant_id = p_tenant and x.deleted_at is null;
  if me is null or v_room is null or not app.chat_is_member(v_room, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.chat_reactions e where e.message_id = p_message and e.member_id = me and e.emoji = p_emoji;
  if found then return false; end if;
  insert into public.chat_reactions (tenant_id, message_id, member_id, emoji) values (p_tenant, p_message, me, p_emoji);
  return true;
end $$;

create or replace function public.chat_read(p_tenant uuid, p_room uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.chat_members c set last_read_at = greatest(c.last_read_at, pg_catalog.now()) where c.room_id = p_room and c.member_id = me;
  return found;
end $$;

create or replace function public.chat_mute(p_tenant uuid, p_room uuid, p_muted boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.chat_members c set muted = coalesce(p_muted, false) where c.room_id = p_room and c.member_id = me;
  return found;
end $$;

-- what a translation needs: the message, when the person may read it (the server translates and caches it)
create or replace function public.chat_message_get(p_tenant uuid, p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := app.chat_me(p_tenant); x public.chat_messages;
begin
  select * into x from public.chat_messages m where m.id = p_message and m.tenant_id = p_tenant and m.deleted_at is null;
  if me is null or x.id is null or not app.chat_is_member(x.room_id, me) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object('id', x.id, 'body', x.body, 'translations', x.translations);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.chat_sync(uuid, uuid, timestamptz)', 'public.chat_history(uuid, uuid, timestamptz)', 'public.chat_room_open(uuid, jsonb)',
    'public.chat_room_update(uuid, uuid, jsonb)', 'public.chat_send(uuid, uuid, text, uuid, jsonb, jsonb)', 'public.chat_edit(uuid, uuid, text)',
    'public.chat_delete(uuid, uuid)', 'public.chat_react(uuid, uuid, text)', 'public.chat_read(uuid, uuid)', 'public.chat_mute(uuid, uuid, boolean)',
    'public.chat_message_get(uuid, uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- for the server only
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.chat_translation_set(p_tenant uuid, p_message uuid, p_lang text, p_text text) returns boolean
language sql security definer set search_path = '' as $$
  update public.chat_messages x set translations = x.translations || pg_catalog.jsonb_build_object(p_lang, pg_catalog.left(p_text, 9000))
   where x.id = p_message and x.tenant_id = p_tenant and p_lang in ('en', 'es') and x.deleted_at is null returning true
$$;
revoke all on function public.chat_translation_set(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.chat_translation_set(uuid, uuid, text, text) to service_role;

-- what the server sends to an AI employee about one message (its address, sealed secret, the message, the room)
create or replace function public.chat_bot_delivery(p_bot uuid, p_message uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('bot', pg_catalog.jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
      'url', b.webhook_url, 'sealed', b.webhook_secret_sealed, 'tenant', b.tenant_id,
      'room', pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', case when r.kind = 'direct' then '' else r.name end),
      'message', app.chat_message_json(x))
    from app.bots b join public.chat_messages x on x.tenant_id = b.tenant_id join public.chat_rooms r on r.id = x.room_id
   where b.id = p_bot and x.id = p_message and b.status = 'active' and app.chat_bots_for(x.id) @> array[b.id]
$$;
revoke all on function public.chat_bot_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_bot_delivery(uuid, uuid) to service_role;

-- an AI employee's chat address (owner, fresh identity check; the server seals the secret and shows it once)
create or replace function public.bot_webhook_set(p_tenant uuid, p_bot uuid, p_url text, p_sealed text, p_hint text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, true);
  perform app.require_stepup(300);
  update app.bots b set webhook_url = nullif(p_url, ''), webhook_secret_sealed = case when nullif(p_url, '') is null then null else p_sealed end,
      webhook_hint = case when nullif(p_url, '') is null then null else p_hint end, updated_at = pg_catalog.now()
   where b.id = p_bot and b.tenant_id = p_tenant;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'bot.webhook_set', 'ok', null, pg_catalog.jsonb_build_object('bot', p_bot, 'off', nullif(p_url, '') is null));
  return true;
end $$;
revoke all on function public.bot_webhook_set(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.bot_webhook_set(uuid, uuid, text, text, text) to authenticated;

-- the AI employees screen shows whether each has a chat address
create or replace function public.bot_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.bot_admin(p_tenant, false);
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'title', b.title, 'department', b.department, 'reportsTo', b.reports_to,
      'mission', b.mission, 'access', b.access, 'status', b.status, 'hasKey', b.key_hash is not null, 'keyHint', b.key_hint,
      'keyCreatedAt', b.key_created_at, 'lastUsedAt', b.last_used_at, 'webhookUrl', b.webhook_url, 'webhookHint', b.webhook_hint,
      'pending', (select pg_catalog.count(*) from app.approvals a where a.bot_id = b.id and a.status = 'pending'))
    order by b.created_at) from app.bots b where b.tenant_id = p_tenant), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- the AI employees' chat tools (called by public.bot_call, which checked the key, the bot and its company)
-- ---------------------------------------------------------------------------------------------------------------------
-- chat.inbox: what was said to the bot since it last read (direct chats and @mentions), oldest first
create or replace function app.bot_chat_inbox(p_bot uuid, p_tenant uuid, p_limit int) returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('room', pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name), 'message', app.chat_message_json(x)) order by x.created_at), '[]'::jsonb)
    into out from (select x.* from public.chat_messages x join public.chat_members c on c.room_id = x.room_id and c.bot_id = p_bot
                    join public.chat_rooms r on r.id = x.room_id
                   where x.tenant_id = p_tenant and x.created_at > c.last_read_at and x.author_bot is distinct from p_bot and x.deleted_at is null
                     and (r.kind = 'direct' or x.mentions @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type', 'bot', 'id', p_bot::text)))
                   order by x.created_at limit p_limit) x join public.chat_rooms r on r.id = x.room_id;
  update public.chat_members c set last_read_at = pg_catalog.now() where c.bot_id = p_bot and c.tenant_id = p_tenant;
  return out;
end $$;
revoke all on function app.bot_chat_inbox(uuid, uuid, int) from public, anon, authenticated;

-- chat.send: the bot answers in a room it is a member of. Answers the message and who else it is meant for
create or replace function app.bot_chat_send(p_bot uuid, p_tenant uuid, a jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.chat_messages; v_room uuid := nullif(a ->> 'roomId', '')::uuid;
begin
  if not exists (select 1 from public.chat_members c where c.room_id = v_room and c.bot_id = p_bot and c.tenant_id = p_tenant) then raise exception 'not_a_member'; end if;
  if length(btrim(coalesce(a ->> 'body', ''))) not between 1 and 8000 then raise exception 'empty'; end if;
  insert into public.chat_messages (tenant_id, room_id, author_bot, body, reply_to, mentions)
  values (p_tenant, v_room, p_bot, a ->> 'body',
          (select r.id from public.chat_messages r where r.id = nullif(a ->> 'replyTo', '')::uuid and r.room_id = v_room),
          app.chat_clean_mentions(v_room, coalesce(a -> 'mentions', '[]'::jsonb))) returning * into x;
  update public.chat_rooms r set last_at = x.created_at where r.id = v_room;
  update public.chat_members c set last_read_at = x.created_at where c.room_id = v_room and c.bot_id = p_bot;
  return pg_catalog.jsonb_build_object('id', x.id, 'roomId', v_room, 'bots', pg_catalog.to_jsonb(app.chat_bots_for(x.id)));
end $$;
revoke all on function app.bot_chat_send(uuid, uuid, jsonb) from public, anon, authenticated;

-- chat.rooms: the rooms the bot is in
create or replace function app.bot_chat_rooms(p_bot uuid, p_tenant uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'topic', r.topic, 'lastAt', r.last_at,
      'members', (select pg_catalog.jsonb_agg(coalesce((select m.name from public.tenant_members m where m.id = c2.member_id), (select b.name from app.bots b where b.id = c2.bot_id)))
                    from public.chat_members c2 where c2.room_id = r.id)) order by r.last_at desc), '[]'::jsonb)
    from public.chat_rooms r join public.chat_members c on c.room_id = r.id and c.bot_id = p_bot where r.tenant_id = p_tenant and not r.archived
$$;
revoke all on function app.bot_chat_rooms(uuid, uuid) from public, anon, authenticated;

-- The bot tools of 0084 stay as they are (renamed); the chat tools are answered here first, logged the same way.
alter function public.bot_call(uuid, text, jsonb) rename to bot_call_0084;
revoke all on function public.bot_call_0084(uuid, text, jsonb) from public, anon, authenticated, service_role;

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
  insert into app.bot_activity (tenant_id, bot_id, tool, outcome, summary)
    values (b.tenant_id, b.id, p_tool, 'ok', pg_catalog.jsonb_build_object('id', out ->> 'id', 'count', case when jsonb_typeof(out) = 'array' then jsonb_array_length(out) end));
  return out;
end $$;
revoke all on function public.bot_call(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.bot_call(uuid, text, jsonb) to service_role;
