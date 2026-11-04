-- Module tests: AI employees (0084).
--   only the owner of the VYNTEX USA workspace (plan internal), with the second sign-in step and a fresh identity check,
--   adds a bot or issues its key; an owner or a manager pauses, revokes and decides approvals; nobody else, and never
--   a visitor or another company. The server key alone reaches bot_auth and bot_call. Every tool works on the bot's own
--   company only, within the bot's access map; there is no tool that sends, deletes, prices, pays or publishes; tax IDs
--   and bank details are never returned; every call is kept, and the log cannot be changed.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('90. AI employees') \g /dev/null

select test.seed_company('hq', 'bot-hq', 'build', 'internal') \g /dev/null
select test.seed_company('bx', 'bot-other', 'build', 'builder') \g /dev/null
select test.stepup('hq_owner') \g /dev/null
select test.stepup('bx_owner') \g /dev/null
select test.stepup('hq_manager') \g /dev/null

-- ---- who may add a bot
create function pg_temp.parker() returns text language sql as $$
  select format('select to_jsonb(public.bot_save(%L, %L::jsonb))', test.id('hq'), '{"slug":"parker","name":"Parker","title":"Executive Assistant & Chief of Staff",
    "access":{"leads":"view","clients":"view","jobs":"view","tasks":"edit","calendar":"edit","documents":"view","messages":"edit","payments":"view",
              "catalog":"view","reports":"edit","automations":"view","team":"view","vault":"edit","made_up":"edit"}}')
$$;
select test.ok(test.j('hq_manager', pg_temp.parker()) ->> 'error' = '42501', 'a manager cannot add a bot') \g /dev/null
select test.ok(test.j('hq_staff', pg_temp.parker()) ->> 'error' = '42501', 'nor can staff') \g /dev/null
select test.ok(test.j('anon', pg_temp.parker()) ->> 'error' = '42501', 'nor a visitor') \g /dev/null
select test.ok(test.j('bx_owner', pg_temp.parker()) ->> 'error' = '42501', 'nor the owner of another company') \g /dev/null
select test.ok(test.j('bx_owner', format('select to_jsonb(public.bot_save(%L, %L::jsonb))', test.id('bx'), '{"slug":"x1","name":"X"}')) ->> 'word' = 'not_available',
  'AI employees are only for the VYNTEX USA workspace') \g /dev/null
select test.stepup_stale('hq_owner') \g /dev/null
select test.ok(test.j('hq_owner', pg_temp.parker()) ->> 'error' = 'VX403', 'the owner needs a fresh identity check') \g /dev/null
select test.stepup('hq_owner') \g /dev/null
select test.j('hq_owner', pg_temp.parker()) #>> '{}' as parker \gset
select test.remember('bot.parker', :'parker'::uuid) \g /dev/null
select test.ok((select access = '{"leads":"view","clients":"view","jobs":"view","tasks":"edit","calendar":"edit","documents":"view","messages":"edit","payments":"view","catalog":"view","reports":"edit","automations":"view","team":"view"}'::jsonb
  from app.bots where id = test.id('bot.parker')), 'access keeps only the twelve known sections') \g /dev/null

-- Atlas: tasks and reports, no leads, no clients, no messages, no payments
select test.j('hq_owner', format('select to_jsonb(public.bot_save(%L, %L::jsonb))', test.id('hq'),
  '{"slug":"atlas","name":"Atlas","title":"Head of Product & Engineering","access":{"jobs":"view","calendar":"view","catalog":"view","tasks":"edit","reports":"edit","automations":"edit","team":"edit"}}')) #>> '{}' as atlas \gset
select test.remember('bot.atlas', :'atlas'::uuid) \g /dev/null
-- Sterling: leads and clients to edit
select test.j('hq_owner', format('select to_jsonb(public.bot_save(%L, %L::jsonb))', test.id('hq'),
  '{"slug":"sterling","name":"Sterling","title":"Head of Sales & Partnerships","access":{"leads":"edit","clients":"edit","jobs":"view","tasks":"edit","calendar":"edit","documents":"edit","messages":"edit","payments":"view","catalog":"view","reports":"edit","automations":"view"}}')) #>> '{}' as sterling \gset
select test.remember('bot.sterling', :'sterling'::uuid) \g /dev/null

-- ---- who sees them
select test.ok(jsonb_array_length(test.j('hq_manager', format('select public.bot_list(%L)', test.id('hq')))) = 3, 'a manager sees the bots') \g /dev/null
select test.ok(test.j('hq_staff', format('select public.bot_list(%L)', test.id('hq'))) ->> 'error' = '42501', 'staff do not') \g /dev/null
select test.ok(test.j('bx_owner', format('select public.bot_list(%L)', test.id('hq'))) ->> 'error' = '42501', 'nor another company') \g /dev/null
select test.ok(test.as('hq_owner', 'select 1 from app.bots') like 'error:%', 'nobody reads the bots table directly') \g /dev/null
select test.ok(test.as('hq_owner', 'select 1 from app.approvals') like 'error:%', 'nor the approvals table') \g /dev/null

-- ---- keys
select test.ok(test.j('hq_manager', format('select to_jsonb(public.bot_key_set(%L, %L, %L, %L))', test.id('hq'), test.id('bot.parker'), repeat('a', 64), 'vxb_ab12')) ->> 'error' = '42501',
  'a manager cannot issue a key') \g /dev/null
select test.ok((test.j('hq_owner', format('select to_jsonb(public.bot_key_set(%L, %L, %L, %L))', test.id('hq'), test.id('bot.parker'), repeat('a', 64), 'vxb_ab12')) #>> '{}')::boolean,
  'the owner issues Parker''s key (its hash only)') \g /dev/null
select test.j('hq_owner', format('select to_jsonb(public.bot_key_set(%L, %L, %L, %L))', test.id('hq'), test.id('bot.atlas'), repeat('b', 64), 'vxb_cd34')) \g /dev/null
select test.j('hq_owner', format('select to_jsonb(public.bot_key_set(%L, %L, %L, %L))', test.id('hq'), test.id('bot.sterling'), repeat('c', 64), 'vxb_ef56')) \g /dev/null
select test.ok(test.j('hq_owner', format('select to_jsonb(public.bot_key_set(%L, %L, %L, %L))', test.id('hq'), test.id('bot.parker'), 'not-a-hash', 'vxb_ab12')) ->> 'error' = '22023',
  'a key hash must be a hash') \g /dev/null

select test.ok(test.as('anon', format('select public.bot_auth(%L)', repeat('a', 64))) = 'error:42501', 'a visitor cannot check a bot key') \g /dev/null
select test.ok(test.as('hq_owner', format('select public.bot_auth(%L)', repeat('a', 64))) = 'error:42501', 'nor a signed-in person') \g /dev/null
select test.ok(test.as('hq_owner', format('select public.bot_call(%L, %L, %L)', test.id('bot.parker'), 'whoami', '{}')) = 'error:42501', 'nor run a bot tool') \g /dev/null
select test.ok(public.bot_auth(repeat('a', 64)) ->> 'tenant' = test.id('hq')::text, 'the server finds the bot and its company from the key hash') \g /dev/null
select test.ok(public.bot_auth(repeat('d', 64)) is null, 'an unknown key finds nothing') \g /dev/null
select test.ok(public.bot_auth('junk') is null, 'nor does junk') \g /dev/null

-- ---- every tool, within the access map (the server key)
create function pg_temp.call(p_bot text, p_tool text, p_args jsonb default '{}') returns jsonb language sql as
$$ select public.bot_call(test.id('bot.' || p_bot), p_tool, p_args) $$;
create function pg_temp.fine(p jsonb) returns boolean language sql as
$$ select p is not null and not (jsonb_typeof(p) = 'object' and p ? 'error') $$;

select test.ok(pg_temp.call('parker', 'whoami') ->> 'name' = 'Parker', 'whoami') \g /dev/null
select test.ok(jsonb_array_length(pg_temp.call('parker', 'leads.list')) >= 1, 'leads.list') \g /dev/null
select test.ok(pg_temp.call('parker', 'leads.get', jsonb_build_object('id', test.id('hq.l1'))) ->> 'name' = 'Lead hq', 'leads.get') \g /dev/null
select test.ok(pg_temp.call('parker', 'leads.get', jsonb_build_object('id', test.id('bx.l1'))) ->> 'error' = 'not_found', 'never a lead of another company') \g /dev/null
select test.ok(pg_temp.call('parker', 'leads.update', jsonb_build_object('id', test.id('hq.l1'), 'pri', 'high')) ->> 'error' = 'not_allowed', 'Parker only views leads') \g /dev/null
select test.ok(pg_temp.call('atlas', 'leads.list') ->> 'error' = 'not_allowed', 'Atlas has no leads at all') \g /dev/null
select test.ok(pg_temp.call('atlas', 'clients.list') ->> 'error' = 'not_allowed', 'nor clients') \g /dev/null
select test.ok(pg_temp.call('atlas', 'payments.list') ->> 'error' = 'not_allowed', 'nor payments') \g /dev/null
select test.ok(pg_temp.call('atlas', 'messages.draft', '{"to":"a@example.com","body":"x"}') ->> 'error' = 'not_allowed', 'nor messages') \g /dev/null

select pg_temp.call('sterling', 'leads.create', '{"name":"New Prospect","email":"np@example.com","source":"website","type":"service"}') ->> 'id' as newlead \gset
select test.ok((select ticket like 'AI-%' and status = 'new' and tenant_id = test.id('hq') from public.leads where id = :'newlead'::uuid), 'leads.create, with its own ticket, as new') \g /dev/null
select test.ok(pg_temp.fine(pg_temp.call('sterling', 'leads.update', jsonb_build_object('id', :'newlead', 'status', 'contacted', 'nextAction', 'Call back Monday'))), 'leads.update') \g /dev/null
select test.ok(pg_temp.call('sterling', 'leads.update', jsonb_build_object('id', :'newlead', 'status', 'won')) ->> 'error' = 'needs_approval', 'winning a lead needs a person') \g /dev/null
select test.ok(pg_temp.call('sterling', 'leads.update', jsonb_build_object('id', test.id('bx.l1'), 'pri', 'low')) ->> 'error' = 'not_found', 'never changes another company''s lead') \g /dev/null

select test.ok(jsonb_array_length(pg_temp.call('parker', 'clients.list')) >= 1, 'clients.list') \g /dev/null
select pg_temp.call('parker', 'clients.get', jsonb_build_object('id', test.id('hq.c1'))) as cl \gset
select test.ok(:'cl'::jsonb ->> 'name' = 'Client hq', 'clients.get') \g /dev/null
select test.ok(:'cl'::text !~* 'tax|bank|routing|account_number|vault|ssn|ein', 'clients.get never carries a tax ID or a bank detail') \g /dev/null
select test.ok(pg_temp.fine(pg_temp.call('sterling', 'clients.update', jsonb_build_object('id', test.id('hq.c1'), 'tags', jsonb_build_array('vip')))), 'clients.update') \g /dev/null

select test.ok(jsonb_array_length(pg_temp.call('parker', 'jobs.list')) >= 2, 'jobs.list') \g /dev/null
select test.ok(pg_temp.call('parker', 'jobs.get', jsonb_build_object('id', test.id('hq.j1'))) ->> 'name' = 'Job One hq', 'jobs.get') \g /dev/null
select test.ok(pg_temp.call('sterling', 'jobs.update', jsonb_build_object('id', test.id('hq.j1'), 'status', 'hold')) ->> 'error' = 'not_allowed', 'Sterling only views jobs') \g /dev/null

select pg_temp.call('atlas', 'tasks.create', '{"title":"Check the release","due":"2026-12-01"}') ->> 'id' as task \gset
select test.ok((select requested_by = 'Atlas' and status = 'todo' from public.tasks where id = :'task'::uuid), 'tasks.create, marked as asked by the bot') \g /dev/null
select test.ok(pg_temp.fine(pg_temp.call('atlas', 'tasks.update', jsonb_build_object('id', :'task', 'status', 'done'))), 'tasks.update') \g /dev/null
select test.ok((select done_at is not null from public.tasks where id = :'task'::uuid), 'a finished task gets its date') \g /dev/null
select test.ok(jsonb_typeof(pg_temp.call('atlas', 'tasks.list')) = 'array', 'tasks.list') \g /dev/null
select test.ok(jsonb_typeof(pg_temp.call('atlas', 'calendar.list', '{"from":"2020-01-01","to":"2030-01-01"}')) = 'array', 'calendar.list') \g /dev/null
select test.ok(pg_temp.fine(pg_temp.call('sterling', 'notes.add', jsonb_build_object('parent', 'lead', 'id', :'newlead', 'text', 'Asked for pricing'))), 'notes.add on a lead') \g /dev/null
select test.ok(pg_temp.call('sterling', 'notes.add', jsonb_build_object('parent', 'job', 'id', test.id('hq.j1'), 'text', 'x')) ->> 'error' = 'not_allowed', 'a note on a job needs edit on jobs') \g /dev/null
select test.ok(pg_temp.call('sterling', 'notes.add', jsonb_build_object('parent', 'vault', 'id', test.id('hq.j1'), 'text', 'x')) ->> 'error' = 'not_allowed', 'and only on a lead, a client or a job') \g /dev/null
select test.ok(jsonb_typeof(pg_temp.call('parker', 'documents.list')) = 'array', 'documents.list') \g /dev/null
select test.ok(jsonb_typeof(pg_temp.call('parker', 'messages.list')) = 'array', 'messages.list') \g /dev/null

select pg_temp.call('sterling', 'messages.draft', jsonb_build_object('to', 'np@example.com', 'subject', 'Hello', 'body', 'Thanks for reaching out.', 'leadId', :'newlead')) ->> 'id' as msg \gset
select test.ok((select status = 'draft' and dir = 'out' and tenant_id = test.id('hq') from public.messages where id = :'msg'::uuid), 'messages.draft writes a draft, never a send') \g /dev/null
select test.ok(pg_temp.call('sterling', 'messages.send', jsonb_build_object('id', :'msg')) ->> 'error' = 'unknown_tool', 'there is no send tool') \g /dev/null
select test.ok(pg_temp.call('parker', 'leads.delete', jsonb_build_object('id', test.id('hq.l1'))) ->> 'error' = 'unknown_tool', 'nor a delete tool') \g /dev/null
select test.ok(pg_temp.call('parker', 'catalog.update', '{}') ->> 'error' = 'unknown_tool', 'nor a price tool') \g /dev/null

select test.ok(jsonb_typeof(pg_temp.call('parker', 'payments.list')) = 'array', 'payments.list') \g /dev/null
select test.ok(pg_temp.call('parker', 'payments.list')::text !~* 'bank|routing|card|last4|account', 'payments carry amounts, never a bank or card detail') \g /dev/null
select test.ok(jsonb_typeof(pg_temp.call('parker', 'catalog.list')) = 'array', 'catalog.list') \g /dev/null
select test.ok(pg_temp.call('parker', 'reports.summary') ? 'openLeads', 'reports.summary') \g /dev/null
select test.ok(jsonb_typeof(pg_temp.call('parker', 'automations.list')) = 'array', 'automations.list') \g /dev/null
select test.ok(jsonb_array_length(pg_temp.call('parker', 'team.list') -> 'aiEmployees') = 3, 'team.list') \g /dev/null
select test.ok(pg_temp.call('sterling', 'team.list') ->> 'error' = 'not_allowed', 'Sterling has no team access') \g /dev/null
select test.ok(pg_temp.call('parker', 'leads.list', '{"since":"not-a-date"}') ->> 'error' = 'invalid_arguments', 'bad arguments are refused, not crashed on') \g /dev/null

-- ---- approvals
select pg_temp.call('sterling', 'approvals.request', jsonb_build_object('kind', 'message.send', 'what', 'Send the welcome email to New Prospect',
  'why', 'They asked for pricing', 'riskIfWeDo', 'None', 'riskIfWeDont', 'They go cold', 'recommendation', 'Send', 'target', jsonb_build_object('type', 'message', 'id', :'msg'))) ->> 'id' as ap \gset
select test.ok((select status = 'pending' and level = 2 from app.approvals where id = :'ap'::uuid), 'a bot asks; the request waits') \g /dev/null
select pg_temp.call('sterling', 'approvals.request', '{"kind":"price.change","what":"Lower the Pro price","level":2}') ->> 'id' as ap3 \gset
select test.ok((select level = 3 from app.approvals where id = :'ap3'::uuid), 'a price change is always level 3') \g /dev/null
select test.ok(pg_temp.call('sterling', 'approvals.request', '{"kind":"launch_rockets","what":"x"}') ->> 'error' = 'invalid_arguments', 'only the known kinds') \g /dev/null
select test.ok(test.j('hq_staff', format('select public.approval_decide(%L, %L, %L)', test.id('hq'), :'ap', 'approved')) ->> 'error' = '42501', 'staff cannot decide') \g /dev/null
select test.ok(test.j('bx_owner', format('select public.approval_decide(%L, %L, %L)', test.id('bx'), :'ap', 'approved')) ->> 'decided' = 'false', 'another company cannot decide it') \g /dev/null
select test.ok(test.w('hq_manager', format('update public.messages set status = ''queued'' where id = %L', :'msg')) like '42501:%', 'a person cannot queue a bot''s draft directly') \g /dev/null
select test.ok(test.w('hq_manager', format('update public.messages set status = ''queued'', extra = ''{}'' where id = %L', :'msg')) like '42501:%', 'not even by removing its mark (0089)') \g /dev/null
select test.ok(test.w('hq_manager', format('update public.messages set extra = ''{}'' where id = %L', :'msg')) = 'ok' and (select extra ? 'drafted_by_bot' from public.messages where id = :'msg'::uuid), 'the mark stays on an edit') \g /dev/null
select test.ok(test.j('hq_owner', format('select public.approval_decide(%L, %L, %L)', test.id('hq'), :'ap3', 'rejected')) = '{"decided": true, "queued": false}'::jsonb, 'the owner decides any level') \g /dev/null
select test.ok(test.j('hq_manager', format('select public.approval_decide(%L, %L, %L, %L)', test.id('hq'), :'ap', 'approved', 'Go ahead')) = '{"decided": true, "queued": true}'::jsonb,
  'a manager approves; the bot''s draft is queued at once') \g /dev/null
select test.ok((select status = 'queued' and by_member_id = test.id('hq.m_manager') and subject = 'Hello' and body = 'Thanks for reaching out.' from public.messages where id = :'msg'::uuid),
  'the draft is queued in the approver''s name, unchanged') \g /dev/null
select test.ok((select status = 'done' and decided_name = 'Manager hq' and note = 'Go ahead' from app.approvals where id = :'ap'::uuid), 'the approval is done, and who decided is kept') \g /dev/null
select test.ok(test.j('hq_owner', format('select public.approval_decide(%L, %L, %L)', test.id('hq'), :'ap', 'rejected')) ->> 'decided' = 'false', 'a decision is final') \g /dev/null
select test.ok(coalesce(current_setting('app.approved_send', true), '') = '', 'the one-row pass does not outlive the decision') \g /dev/null
-- another kind: approved, then carried out by a person and marked done
select pg_temp.call('sterling', 'approvals.request', '{"kind":"publish","what":"Publish the case study page"}') ->> 'id' as ap4 \gset
select test.ok(test.j('hq_owner', format('select public.approval_decide(%L, %L, %L)', test.id('hq'), :'ap4', 'approved')) = '{"decided": true, "queued": false}'::jsonb, 'approving anything else does nothing by itself') \g /dev/null
select test.ok((test.j('hq_manager', format('select to_jsonb(public.approval_done(%L, %L))', test.id('hq'), :'ap4')) #>> '{}')::boolean, 'the person marks it done once carried out') \g /dev/null
select test.ok(pg_temp.call('sterling', 'approvals.list') -> 0 ->> 'status' = 'done', 'the bot sees the outcome') \g /dev/null
select test.ok(jsonb_array_length(test.j('hq_manager', format('select public.approvals_list(%L)', test.id('hq')))) = 3, 'approvals_list') \g /dev/null
-- ---- pause, revoke, the log
select test.ok((test.j('hq_manager', format('select to_jsonb(public.bot_set_status(%L, %L, %L))', test.id('hq'), test.id('bot.sterling'), 'paused')) #>> '{}')::boolean, 'a manager pauses a bot') \g /dev/null
select test.ok(public.bot_auth(repeat('c', 64)) ->> 'refused' = 'paused', 'a paused bot''s key is refused') \g /dev/null
select test.ok(pg_temp.call('sterling', 'whoami') ->> 'error' = 'bot_not_active', 'and its tools') \g /dev/null
select test.ok((test.j('hq_manager', format('select to_jsonb(public.bot_key_revoke(%L, %L))', test.id('hq'), test.id('bot.atlas'))) #>> '{}')::boolean, 'a manager revokes a key') \g /dev/null
select test.ok(public.bot_auth(repeat('b', 64)) is null, 'a revoked key finds nothing') \g /dev/null
select test.ok((select count(*) from app.bot_activity where bot_id = test.id('bot.parker')) >= 15, 'every call is kept') \g /dev/null
select test.ok((select count(*) from app.bot_activity where bot_id = test.id('bot.atlas') and outcome = 'denied') >= 4, 'refused ones too') \g /dev/null
select test.ok(jsonb_array_length(test.j('hq_manager', format('select public.bot_activity_list(%L)', test.id('hq')))) >= 30, 'bot_activity_list') \g /dev/null
select test.is(test.try('update app.bot_activity set outcome = ''ok'''), 'error:42501', 'the log cannot be changed') \g /dev/null
select test.ok(test.try('delete from app.bot_activity') like 'error:%', 'nor emptied') \g /dev/null
select test.ok((select count(*) from app.security_events e where e.tenant_id = test.id('hq') and e.kind like 'bot.%') >= 6, 'bot changes are security events') \g /dev/null
