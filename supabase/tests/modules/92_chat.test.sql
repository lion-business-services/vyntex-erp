-- Module tests: team chat (0087).
--   a person reads only the rooms they are in; a direct chat between the same two is found again; a group's admin
--   manages it; one's own messages are edited and removed, nobody else's; mentions and files are checked; reactions
--   toggle; the AI employees a message is meant for are a direct chat with them or an @mention; a bot answers only in
--   its own rooms; nothing of another company is reachable
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('92. team chat') \g /dev/null

select test.seed_company('ch', 'chat-hq', 'practice', 'internal') \g /dev/null
select test.seed_company('cx', 'chat-other', 'build', 'builder') \g /dev/null
insert into app.bots (tenant_id, slug, name, title, access) values (test.id('ch'), 'parker', 'Parker', 'Chief of Staff', '{}') returning id \gset bot_
select test.remember('ch.parker', :'bot_id'::uuid) \g /dev/null
insert into app.bots (tenant_id, slug, name, access) values (test.id('cx'), 'other', 'Other bot', '{}') returning id \gset obot_

create function pg_temp.j(who text, q text) returns jsonb language sql as $$ select test.j(who, q) $$;
create function pg_temp.open(who text, body jsonb) returns text language sql as
$$ select pg_temp.j(who, format('select to_jsonb(public.chat_room_open(%L, %L::jsonb))', test.id('ch'), body)) #>> '{}' $$;

-- ---- rooms
select pg_temp.open('ch_owner', jsonb_build_object('kind', 'direct', 'with', jsonb_build_object('type', 'member', 'id', test.id('ch.m_manager')))) as dm \gset
select test.ok(:'dm' ~ '^[0-9a-f-]{36}$', 'a direct chat with a teammate') \g /dev/null
select test.is(pg_temp.open('ch_manager', jsonb_build_object('kind', 'direct', 'with', jsonb_build_object('type', 'member', 'id', test.id('ch.m_owner')))), :'dm', 'the same pair finds the same chat, from either side') \g /dev/null
select pg_temp.open('ch_owner', jsonb_build_object('kind', 'direct', 'with', jsonb_build_object('type', 'bot', 'id', test.id('ch.parker')))) as botdm \gset
select test.ok(:'botdm' ~ '^[0-9a-f-]{36}$', 'a direct chat with an AI employee') \g /dev/null
select test.ok(pg_temp.j('ch_owner', format('select to_jsonb(public.chat_room_open(%L, %L::jsonb))', test.id('ch'), jsonb_build_object('kind', 'direct', 'with', jsonb_build_object('type', 'bot', 'id', :'obot_id')))) ->> 'error' = 'P0002',
  'never with another company''s AI employee') \g /dev/null
select test.ok(pg_temp.j('ch_owner', format('select to_jsonb(public.chat_room_open(%L, %L::jsonb))', test.id('ch'), jsonb_build_object('kind', 'direct', 'with', jsonb_build_object('type', 'member', 'id', test.id('cx.m_owner'))))) ->> 'error' = 'P0002',
  'nor with a person of another company') \g /dev/null
select pg_temp.open('ch_owner', jsonb_build_object('kind', 'group', 'name', 'Sales', 'members', jsonb_build_array(
  jsonb_build_object('type', 'member', 'id', test.id('ch.m_staff')), jsonb_build_object('type', 'bot', 'id', test.id('ch.parker')),
  jsonb_build_object('type', 'member', 'id', test.id('cx.m_owner'))))) as grp \gset
select test.is((select count(*)::text from public.chat_members where room_id = :'grp'::uuid), '3', 'a group: its admin, a teammate and Parker (the outsider is left out)') \g /dev/null
select test.ok(pg_temp.j('ch_w1', format('select public.chat_sync(%L)', test.id('ch'))) ->> 'error' = '42501', 'a field worker has no team chat') \g /dev/null
select test.ok(pg_temp.j('cx_owner', format('select public.chat_sync(%L, %L)', test.id('ch'), :'grp')) ->> 'error' = '42501', 'another company cannot read it') \g /dev/null
select test.ok(pg_temp.j('ch_manager', format('select public.chat_sync(%L, %L)', test.id('ch'), :'grp')) ->> 'error' = '42501', 'nor a teammate who is not in it') \g /dev/null
select test.ok(test.as('ch_manager', format('select count(*) from public.chat_messages where room_id = %L', :'grp')) = 'rows:1', 'the access rules hide it too') \g /dev/null

-- ---- messages
select pg_temp.j('ch_owner', format('select public.chat_send(%L, %L, %L, null, %L::jsonb)', test.id('ch'), :'grp', '@Parker please check the Sales pipeline, @Staff ch thanks',
  jsonb_build_array(jsonb_build_object('type', 'bot', 'id', test.id('ch.parker')), jsonb_build_object('type', 'member', 'id', test.id('ch.m_staff')), jsonb_build_object('type', 'member', 'id', test.id('ch.m_manager'))))) as sent \gset
select test.ok(jsonb_array_length(:'sent'::jsonb #> '{message,mentions}') = 2, 'mentions keep only people in the room') \g /dev/null
select test.ok((:'sent'::jsonb -> 'bots') ? test.id('ch.parker')::text, 'an @mention of Parker is meant for Parker') \g /dev/null
select :'sent'::jsonb #>> '{message,id}' as m1 \gset
select pg_temp.j('ch_staff', format('select public.chat_send(%L, %L, %L)', test.id('ch'), :'grp', 'On it')) as sent2 \gset
select test.ok(jsonb_array_length(:'sent2'::jsonb -> 'bots') = 0, 'a group message without a mention is not sent to the bot') \g /dev/null
select pg_temp.j('ch_owner', format('select public.chat_send(%L, %L, %L)', test.id('ch'), :'botdm', 'Good morning Parker')) as sent3 \gset
select test.ok((:'sent3'::jsonb -> 'bots') ? test.id('ch.parker')::text, 'every message of a direct chat with Parker is meant for Parker') \g /dev/null
select test.ok(pg_temp.j('ch_owner', format('select public.chat_send(%L, %L, %L)', test.id('ch'), :'grp', '   ')) ->> 'error' = '22023', 'an empty message is refused') \g /dev/null
select test.ok(pg_temp.j('ch_manager', format('select public.chat_send(%L, %L, %L)', test.id('ch'), :'grp', 'hi')) ->> 'error' = '42501', 'a person outside the room cannot write in it') \g /dev/null
select test.ok(pg_temp.j('ch_owner', format('select public.chat_send(%L, %L, %L, null, %L::jsonb, %L::jsonb)', test.id('ch'), :'grp', 'file', '[]',
  jsonb_build_array(jsonb_build_object('path', test.id('cx')::text || '/chat/abcdefgh.pdf', 'name', 'x.pdf')))) ->> 'error' = '22023', 'a file of another company is refused') \g /dev/null
select test.ok(pg_temp.j('ch_owner', format('select public.chat_send(%L, %L, %L, null, %L::jsonb, %L::jsonb)', test.id('ch'), :'grp', '', '[]',
  jsonb_build_array(jsonb_build_object('path', test.id('ch')::text || '/chat/abcdefgh.pdf', 'name', 'Plan.pdf', 'size', 10, 'mime', 'application/pdf')))) #>> '{message,files,0,name}' = 'Plan.pdf',
  'a file of this company''s chat area is kept') \g /dev/null
select test.ok(pg_temp.j('ch_staff', format('select public.chat_send(%L, %L, %L, %L)', test.id('ch'), :'grp', 'Replying', :'m1')) #>> '{message,replyTo,id}' = :'m1', 'a reply quotes its message') \g /dev/null

select test.ok((pg_temp.j('ch_staff', format('select to_jsonb(public.chat_edit(%L, %L, %L))', test.id('ch'), :'m1', 'changed')) #>> '{}') = 'false', 'nobody edits another person''s message') \g /dev/null
select test.ok((pg_temp.j('ch_owner', format('select to_jsonb(public.chat_edit(%L, %L, %L))', test.id('ch'), :'m1', '@Parker please check the pipeline')) #>> '{}')::boolean, 'one''s own message is edited') \g /dev/null
select test.ok((pg_temp.j('ch_staff', format('select to_jsonb(public.chat_delete(%L, %L))', test.id('ch'), :'m1')) #>> '{}') = 'false', 'nor removes it') \g /dev/null
select test.ok((pg_temp.j('ch_owner', format('select to_jsonb(public.chat_react(%L, %L, %L))', test.id('ch'), :'m1', '👍')) #>> '{}')::boolean, 'a reaction') \g /dev/null
select test.ok((pg_temp.j('ch_owner', format('select to_jsonb(public.chat_react(%L, %L, %L))', test.id('ch'), :'m1', '👍')) #>> '{}') = 'false', 'the same reaction again takes it back') \g /dev/null
select test.ok(pg_temp.j('ch_owner', format('select to_jsonb(public.chat_react(%L, %L, %L))', test.id('ch'), :'m1', 'xx')) ->> 'error' is not null, 'only the known reactions') \g /dev/null

-- ---- sync, unread, read (writing in a room marks it read for the writer, so a new mention comes after)
select pg_temp.j('ch_owner', format('select public.chat_send(%L, %L, %L, null, %L::jsonb)', test.id('ch'), :'grp', '@Staff ch one more thing',
  jsonb_build_array(jsonb_build_object('type', 'member', 'id', test.id('ch.m_staff'))))) \g /dev/null
select pg_temp.j('ch_staff', format('select public.chat_sync(%L)', test.id('ch'))) as s1 \gset
select test.ok((select (r ->> 'mentioned')::boolean from jsonb_array_elements(:'s1'::jsonb -> 'rooms') r where r ->> 'id' = :'grp'), 'staff sees they were mentioned') \g /dev/null
select test.ok(not exists (select 1 from jsonb_array_elements(:'s1'::jsonb -> 'rooms') r where r ->> 'id' = :'dm'), 'and not the chat they are not in') \g /dev/null
select test.ok(jsonb_array_length(pg_temp.j('ch_staff', format('select public.chat_sync(%L, %L)', test.id('ch'), :'grp')) -> 'messages') >= 4, 'the messages of an open room') \g /dev/null
select pg_temp.j('ch_staff', format('select to_jsonb(public.chat_read(%L, %L))', test.id('ch'), :'grp')) \g /dev/null
select test.ok((select (r ->> 'unread')::int from jsonb_array_elements(pg_temp.j('ch_staff', format('select public.chat_sync(%L)', test.id('ch'))) -> 'rooms') r where r ->> 'id' = :'grp') = 0, 'read') \g /dev/null

-- ---- the AI employee: inbox, reply, only its rooms
select test.ok(test.as('ch_owner', format('select public.bot_call(%L, %L, %L)', test.id('ch.parker'), 'chat.inbox', '{}')) = 'error:42501', 'a person cannot call the bot tools') \g /dev/null
select public.bot_call(test.id('ch.parker'), 'chat.inbox', '{}') as inbox \gset
select test.is(jsonb_array_length(:'inbox'::jsonb)::text, '2', 'Parker''s inbox: the mention in the group and the direct message') \g /dev/null
select test.is(jsonb_array_length(public.bot_call(test.id('ch.parker'), 'chat.inbox', '{}'))::text, '0', 'read once') \g /dev/null
select public.bot_call(test.id('ch.parker'), 'chat.send', jsonb_build_object('roomId', :'botdm', 'body', 'Good morning. Three leads need a follow-up today.')) as reply \gset
select test.ok((select author_bot = test.id('ch.parker') from public.chat_messages where id = (:'reply'::jsonb ->> 'id')::uuid), 'Parker answers in the direct chat') \g /dev/null
select test.ok(public.bot_call(test.id('ch.parker'), 'chat.send', jsonb_build_object('roomId', :'dm', 'body', 'x')) ->> 'error' = 'not_a_member', 'never in a chat it is not in') \g /dev/null
select test.ok(public.bot_call(:'obot_id', 'chat.send', jsonb_build_object('roomId', :'grp', 'body', 'x')) ->> 'error' = 'not_a_member', 'nor another company''s bot') \g /dev/null
select test.ok(jsonb_array_length(public.bot_call(test.id('ch.parker'), 'chat.rooms', '{}')) = 2, 'chat.rooms: its two rooms') \g /dev/null
select test.ok(public.bot_call(test.id('ch.parker'), 'whoami', '{}') ->> 'name' = 'Parker', 'the tools of 0084 still answer') \g /dev/null
select test.ok(public.chat_bot_delivery(test.id('ch.parker'), (:'sent3'::jsonb #>> '{message,id}')::uuid) #>> '{room,id}' = :'botdm', 'the server finds what to deliver') \g /dev/null
select test.ok(public.chat_bot_delivery(test.id('ch.parker'), (:'sent2'::jsonb #>> '{message,id}')::uuid) is null, 'and nothing for a message not meant for it') \g /dev/null
select test.ok(test.as('ch_owner', format('select public.chat_bot_delivery(%L, %L)', test.id('ch.parker'), :'m1')) = 'error:42501', 'only the server reads deliveries') \g /dev/null

-- ---- groups
select test.ok(pg_temp.j('ch_staff', format('select to_jsonb(public.chat_room_update(%L, %L, %L::jsonb))', test.id('ch'), :'grp', '{"name":"Hijack"}')) ->> 'error' = '42501', 'only an admin renames a group') \g /dev/null
select jsonb_build_object('name', 'Sales team', 'add', jsonb_build_array(jsonb_build_object('type', 'member', 'id', test.id('ch.m_manager')))) as chg \gset
select test.ok((pg_temp.j('ch_owner', format('select to_jsonb(public.chat_room_update(%L, %L, %L::jsonb))', test.id('ch'), :'grp', :'chg')) #>> '{}')::boolean, 'the admin renames and adds') \g /dev/null
select test.ok(pg_temp.j('ch_manager', format('select public.chat_sync(%L, %L)', test.id('ch'), :'grp')) ? 'messages', 'the added teammate reads the group') \g /dev/null
select test.ok((pg_temp.j('ch_owner', format('select to_jsonb(public.chat_room_update(%L, %L, %L::jsonb))', test.id('ch'), :'grp', '{"leave":true}')) #>> '{}')::boolean, 'the admin leaves') \g /dev/null
select test.ok((select count(*) = 1 from public.chat_members where room_id = :'grp'::uuid and role = 'admin' and member_id is not null), 'and the group keeps an admin') \g /dev/null

-- ---- the server's translation cache
select test.ok(test.as('ch_owner', format('select public.chat_translation_set(%L, %L, %L, %L)', test.id('ch'), :'m1', 'es', 'x')) = 'error:42501', 'only the server writes a translation') \g /dev/null
select test.ok(public.chat_translation_set(test.id('ch'), :'m1', 'es', '@Parker revise el pipeline, por favor'), 'the server caches one') \g /dev/null
select test.ok(test.as('ch_owner', format('update public.chat_messages set body = %L where id = %L', 'x', :'m1')) like 'error:%', 'nobody writes the tables directly') \g /dev/null
