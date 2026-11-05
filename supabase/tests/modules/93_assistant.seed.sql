-- Sample rows for the table of 0096 (VYNTEX AI conversations), for the three sample companies. Included by rls_isolation.sql.
create function test.seed_assistant(p text) returns void language plpgsql as $$
begin
  insert into public.assistant_chats (tenant_id, member_id, title, messages)
  values (test.id(p), test.id(p || '.m_owner'), 'Sample chat ' || p, jsonb_build_array(jsonb_build_object('role', 'user', 'text', 'Hello ' || p)));
end $$;
select test.seed_assistant('a') \g /dev/null
select test.seed_assistant('b') \g /dev/null
select test.seed_assistant('c') \g /dev/null
