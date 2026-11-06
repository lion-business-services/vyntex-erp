-- Module tests: VYNTEX AI conversations (0096).
--   a person keeps their own chats and nobody else reads them (not a teammate, not the owner, not another company);
--   messages are cleaned (roles, length, tax IDs masked, at most 80); a person keeps their last 50; a field worker has none
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('93. VYNTEX AI conversations') \g /dev/null

select test.seed_company('ai', 'ai-hq', 'practice', 'internal') \g /dev/null
select test.seed_company('ax', 'ai-other', 'build', 'builder') \g /dev/null
create function pg_temp.j(who text, q text) returns jsonb language sql as $$ select test.j(who, q) $$;

select pg_temp.j('ai_owner', format('select to_jsonb(public.assistant_chat_save(%L, null, %L, %L::jsonb))', test.id('ai'), 'Brian''s proposal',
  jsonb_build_array(jsonb_build_object('role', 'user', 'text', 'Add Brian, SSN 123-45-6789', 'at', '2026-11-05T08:00:00Z', 'files', jsonb_build_array('proposal.pdf')),
                    jsonb_build_object('role', 'system', 'text', 'Done.')))) #>> '{}' as chat \gset
select test.ok(:'chat' ~ '^[0-9a-f-]{36}$', 'a conversation is saved') \g /dev/null
select test.is(pg_temp.j('ai_owner', format('select public.assistant_chat_get(%L, %L)', test.id('ai'), :'chat')) #>> '{messages,0,text}', 'Add Brian, SSN ***-**-****', 'a tax ID is masked when kept') \g /dev/null
select test.is(pg_temp.j('ai_owner', format('select public.assistant_chat_get(%L, %L)', test.id('ai'), :'chat')) #>> '{messages,1,role}', 'assistant', 'only user and assistant roles') \g /dev/null
select test.is(pg_temp.j('ai_owner', format('select public.assistant_chat_get(%L, %L)', test.id('ai'), :'chat')) #>> '{messages,0,files,0}', 'proposal.pdf', 'file names, not files') \g /dev/null
select test.is(jsonb_array_length(pg_temp.j('ai_owner', format('select public.assistant_chat_list(%L)', test.id('ai'))))::text, '1', 'listed for its owner') \g /dev/null
-- private to the person
select test.ok(pg_temp.j('ai_manager', format('select public.assistant_chat_get(%L, %L)', test.id('ai'), :'chat')) is null, 'a teammate does not see it') \g /dev/null
select test.is(jsonb_array_length(pg_temp.j('ai_manager', format('select public.assistant_chat_list(%L)', test.id('ai'))))::text, '0', 'nor in their list') \g /dev/null
select test.is(test.as('ai_manager', format('select id from public.assistant_chats where id = %L', :'chat')), 'rows:0', 'the access rules hide it too') \g /dev/null
select test.ok(pg_temp.j('ax_owner', format('select public.assistant_chat_list(%L)', test.id('ai'))) ->> 'error' = '42501', 'another company cannot reach it') \g /dev/null
-- saving again updates the same chat; a teammate saving with its id makes their own instead
select test.is(pg_temp.j('ai_owner', format('select to_jsonb(public.assistant_chat_save(%L, %L, %L, %L::jsonb))', test.id('ai'), :'chat', '', jsonb_build_array(jsonb_build_object('role', 'user', 'text', 'Hi again')))) #>> '{}', :'chat', 'the same conversation') \g /dev/null
select test.is((select title from public.assistant_chats where id = :'chat'::uuid), 'Brian''s proposal', 'the title stays when none is given') \g /dev/null
select test.ok((pg_temp.j('ai_manager', format('select to_jsonb(public.assistant_chat_save(%L, %L, %L, %L::jsonb))', test.id('ai'), :'chat', 'Mine', '[]'))) #>> '{}' <> :'chat', 'never another person''s') \g /dev/null
select test.is((select messages #>> '{0,text}' from public.assistant_chats where id = :'chat'::uuid), 'Hi again', 'untouched by the teammate') \g /dev/null
-- at most 80 messages, the newest kept; at most 50 conversations
select pg_temp.j('ai_owner', format('select to_jsonb(public.assistant_chat_save(%L, %L, %L, %L::jsonb))', test.id('ai'), :'chat', '', (select jsonb_agg(jsonb_build_object('role', 'user', 'text', 'm' || n)) from generate_series(1, 95) n))) \g /dev/null
select test.is((select jsonb_array_length(messages) || ' ' || (messages #>> '{0,text}') from public.assistant_chats where id = :'chat'::uuid), '80 m16', 'the last 80 messages') \g /dev/null
select pg_temp.j('ai_owner', format('select to_jsonb(public.assistant_chat_save(%L, null, %L, %L::jsonb))', test.id('ai'), 'Chat ' || n, '[]')) from generate_series(1, 55) n \g /dev/null
select test.is((select count(*)::text from public.assistant_chats where tenant_id = test.id('ai') and member_id = test.id('ai.m_owner')), '50', 'the last 50 conversations') \g /dev/null
-- delete one's own only
select test.ok(pg_temp.j('ai_manager', format('select to_jsonb(public.assistant_chat_delete(%L, %L))', test.id('ai'), (select id from public.assistant_chats where member_id = test.id('ai.m_owner') limit 1))) #>> '{}' = 'false', 'not another person''s') \g /dev/null
select test.ok(test.as('ai_owner', 'insert into public.assistant_chats (tenant_id, member_id) values (gen_random_uuid(), gen_random_uuid())') like 'error:%', 'no direct writes') \g /dev/null
-- a field worker has no conversations
select test.ok(pg_temp.j('ai_w1', format('select public.assistant_chat_list(%L)', test.id('ai'))) ->> 'error' = '42501', 'not for a field worker') \g /dev/null


