-- 0096: VYNTEX AI keeps its conversations (owner request of November 5, 2026: "previous chats data like a real time
-- comprehensive AI engine"). Each person has their own chats, private to them, in their own company.
--   * public.assistant_chats: one conversation (title, messages as [{ role, text, at, files? }], at most 80 kept)
--   * read: the person who had the conversation, and nobody else (not the owner, not another company)
--   * written only through the functions below, with the person's own session; a person keeps their last 50 chats
--   * nothing secret is kept: the browser masks anything shaped like a tax ID before a message is saved, and the
--     functions mask it again; attachments are not kept, only their names
-- Check after applying:
--   select pg_catalog.has_function_privilege('authenticated', 'public.assistant_chat_save(uuid, uuid, text, jsonb)', 'execute'),
--          pg_catalog.has_function_privilege('anon', 'public.assistant_chat_save(uuid, uuid, text, jsonb)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.assistant_chats (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  member_id   uuid not null,
  title       text not null default '' check (length(title) <= 120),
  messages    jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 80),
  extra       jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at  timestamptz not null default pg_catalog.now(),
  updated_at  timestamptz not null default pg_catalog.now(),
  unique (tenant_id, id),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade
);
create index if not exists assistant_chats_member_idx on public.assistant_chats (tenant_id, member_id, updated_at desc);
alter table public.assistant_chats enable row level security;
alter table public.assistant_chats force row level security;
revoke all on public.assistant_chats from public, anon, authenticated;
grant select on public.assistant_chats to authenticated;
create policy assistant_chats_select on public.assistant_chats for select to authenticated
  using (member_id in (select m.id from public.tenant_members m where m.user_id = (select auth.uid()) and m.status = 'active'));

-- the person asking, as a member of this company (not a field worker), or null
create or replace function app.assistant_me(p_tenant uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.tenant_members m
   where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
$$;
revoke all on function app.assistant_me(uuid) from public, anon, authenticated;

-- one message as kept: a role, its text (masked, at most 6000 characters), its time, the names of its files
create or replace function app.assistant_clean_messages(p jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'role', case when e ->> 'role' = 'user' then 'user' else 'assistant' end,
      'text', pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.left(coalesce(e ->> 'text', ''), 6000), '\m\d{3}-?\d{2}-?\d{4}\M', '***-**-****', 'g'), '\m\d{2}-\d{7}\M', '**-*******', 'g'),
      'at', case when coalesce(e ->> 'at', '') ~ '^\d{4}-\d{2}-\d{2}T' then pg_catalog.left(e ->> 'at', 40) end,
      'files', case when pg_catalog.jsonb_typeof(e -> 'files') = 'array' then (select pg_catalog.jsonb_agg(pg_catalog.left(f.v #>> '{}', 200)) from pg_catalog.jsonb_array_elements(e -> 'files') with ordinality f(v, k) where f.k <= 5) end))
    order by n), '[]'::jsonb)
  from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality x(e, n)
  where n > greatest(0, pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) - 80)
$$;
revoke all on function app.assistant_clean_messages(jsonb) from public, anon, authenticated;

-- saves a conversation (new when p_id is null or not the person's own); answers its id
create or replace function public.assistant_chat_save(p_tenant uuid, p_id uuid, p_title text, p_messages jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.assistant_me(p_tenant); v_id uuid; v_title text := pg_catalog.left(pg_catalog.btrim(coalesce(p_title, '')), 120);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.assistant_chats c set title = case when v_title <> '' then v_title else c.title end, messages = app.assistant_clean_messages(p_messages), updated_at = pg_catalog.now()
   where c.id = p_id and c.tenant_id = p_tenant and c.member_id = me returning c.id into v_id;
  if v_id is null then
    insert into public.assistant_chats (tenant_id, member_id, title, messages) values (p_tenant, me, v_title, app.assistant_clean_messages(p_messages)) returning id into v_id;
    -- a person keeps their last 50 conversations
    delete from public.assistant_chats c where c.tenant_id = p_tenant and c.member_id = me and c.id not in (
      select x.id from public.assistant_chats x where x.tenant_id = p_tenant and x.member_id = me order by x.updated_at desc limit 50);
  end if;
  return v_id;
end $$;

create or replace function public.assistant_chat_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := app.assistant_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'title', c.title, 'updatedAt', c.updated_at, 'count', pg_catalog.jsonb_array_length(c.messages)) order by c.updated_at desc)
    from public.assistant_chats c where c.tenant_id = p_tenant and c.member_id = me), '[]'::jsonb);
end $$;

create or replace function public.assistant_chat_get(p_tenant uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := app.assistant_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  return (select pg_catalog.jsonb_build_object('id', c.id, 'title', c.title, 'messages', c.messages, 'updatedAt', c.updated_at)
    from public.assistant_chats c where c.id = p_id and c.tenant_id = p_tenant and c.member_id = me);
end $$;

create or replace function public.assistant_chat_delete(p_tenant uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := app.assistant_me(p_tenant);
begin
  if me is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.assistant_chats c where c.id = p_id and c.tenant_id = p_tenant and c.member_id = me;
  return found;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.assistant_chat_save(uuid, uuid, text, jsonb)', 'public.assistant_chat_list(uuid)', 'public.assistant_chat_get(uuid, uuid)', 'public.assistant_chat_delete(uuid, uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
