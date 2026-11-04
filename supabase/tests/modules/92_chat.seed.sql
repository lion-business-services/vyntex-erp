-- Sample rows for the tables of 0087 (team chat), for the three sample companies. Included by rls_isolation.sql.
create function test.seed_chat(p text) returns void language plpgsql as $$
declare r uuid; x uuid;
begin
  insert into public.chat_rooms (tenant_id, kind, name, created_by) values (test.id(p), 'group', 'Sample group ' || p, test.id(p || '.m_owner')) returning id into r;
  insert into public.chat_members (tenant_id, room_id, member_id, role) values (test.id(p), r, test.id(p || '.m_owner'), 'admin');
  insert into public.chat_messages (tenant_id, room_id, author_member, body) values (test.id(p), r, test.id(p || '.m_owner'), 'Hello ' || p) returning id into x;
  insert into public.chat_reactions (tenant_id, message_id, member_id, emoji) values (test.id(p), x, test.id(p || '.m_owner'), '👍');
end $$;
select test.seed_chat('a') \g /dev/null
select test.seed_chat('b') \g /dev/null
select test.seed_chat('c') \g /dev/null
