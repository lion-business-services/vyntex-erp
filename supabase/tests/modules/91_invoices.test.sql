-- Module tests: invoices (0086).
--   people with money rights make drafts; lines, the fee and the totals are checked and computed by the database; a sent
--   invoice is never changed; voiding needs an owner or a manager and a fresh identity check; another company sees
--   nothing; the server alone marks it sent, finds it by its pay link, and records the Stripe payment exactly once
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('91. invoices') \g /dev/null

select test.seed_company('iv', 'inv-hq', 'practice', 'internal') \g /dev/null
select test.seed_company('ix', 'inv-other', 'build', 'builder') \g /dev/null

create function pg_temp.save(who text, body jsonb) returns jsonb language sql as
$$ select test.j(who, format('select public.invoice_save(%L, %L::jsonb)', test.id('iv'), body)) $$;
create function pg_temp.draft() returns jsonb language sql as $$
  select jsonb_build_object('jobId', test.id('iv.j1'), 'lang', 'es', 'feePct', 2.9, 'sendTo', 'client@example.com',
    'lines', jsonb_build_array(jsonb_build_object('text', 'Deposit 50%', 'qty', 1, 'unitCents', 150000), jsonb_build_object('text', 'Hosting', 'qty', 3, 'unitCents', 4999)))
$$;

-- ---- who may
select test.ok(pg_temp.save('iv_readonly', pg_temp.draft()) ->> 'error' = '42501', 'read only cannot make an invoice') \g /dev/null
select test.ok(pg_temp.save('ix_owner', pg_temp.draft()) ->> 'error' = '42501', 'another company cannot') \g /dev/null
select test.ok(pg_temp.save('anon', pg_temp.draft()) ->> 'error' = '42501', 'nor a visitor') \g /dev/null
select test.ok(test.as('iv_owner', format('update public.invoices set total_cents = 1 where tenant_id = %L', test.id('iv'))) like 'error:%', 'nobody writes the table directly') \g /dev/null
select test.ok(test.as('iv_owner', format('delete from public.invoices where tenant_id = %L', test.id('iv'))) like 'error:%', 'nor deletes from it') \g /dev/null
select test.ok(test.j('ix_owner', format('select public.invoice_save(%L, %L::jsonb)', test.id('ix'), pg_temp.draft())) ->> 'error' = 'P0002', 'a project of another company is not found') \g /dev/null

-- ---- totals by the database
select pg_temp.save('iv_owner', pg_temp.draft()) as inv \gset
select test.is(:'inv'::jsonb ->> 'number', 'INV-0001', 'the first number') \g /dev/null
select test.is(:'inv'::jsonb ->> 'subtotalCents', '164997', 'subtotal: 1500.00 + 3 x 49.99') \g /dev/null
select test.is(:'inv'::jsonb ->> 'feeCents', '4785', 'the 2.9% fee, rounded half up') \g /dev/null
select test.is(:'inv'::jsonb ->> 'totalCents', '169782', 'total') \g /dev/null
select test.is(:'inv'::jsonb ->> 'status', 'draft', 'a draft') \g /dev/null
select test.ok((:'inv'::jsonb ->> 'clientId')::uuid = test.id('iv.c1'), 'the client comes from the project') \g /dev/null
select test.remember('inv.1', (:'inv'::jsonb ->> 'id')::uuid) \g /dev/null
select test.is(pg_temp.save('iv_owner', pg_temp.draft()) ->> 'number', 'INV-0002', 'the next number') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || '{"lines":[{"text":"x","qty":0,"unitCents":100}]}') ->> 'error' = '22023', 'a zero quantity is refused') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || '{"lines":[{"text":"","qty":1,"unitCents":100}]}') ->> 'error' = '22023', 'a line needs a description') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || '{"lines":[]}') ->> 'error' = '22023', 'an empty invoice is refused') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || '{"lines":[{"text":"x","qty":1,"unitCents":"1e9"}]}') ->> 'error' = '22023', 'a price must be whole cents') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || '{"feePct":50}') ->> 'error' is not null, 'the fee is capped') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || '{"issueDate":"2026-12-10","dueDate":"2026-12-01"}') ->> 'error' = '22023', 'due before issue is refused') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || jsonb_build_object('id', test.id('inv.1'), 'feePct', 0)) ->> 'totalCents' = '164997', 'a draft can be changed') \g /dev/null

select test.ok(jsonb_array_length(test.j('iv_staff', format('select public.invoice_list(%L)', test.id('iv')))) = 2, 'the team with money rights sees them') \g /dev/null
select test.ok(test.j('ix_owner', format('select public.invoice_list(%L)', test.id('iv'))) ->> 'error' = '42501', 'another company does not') \g /dev/null

-- ---- the server sends; a sent invoice is not changed
select test.ok(test.as('iv_owner', format('select public.invoice_mark_sent(%L, %L, %L, %L, false)', test.id('iv'), test.id('inv.1'), 'client@example.com', repeat('a', 64))) = 'error:42501',
  'a person cannot mark an invoice sent') \g /dev/null
select test.ok((test.j('iv_owner', format('select public.invoice_send_check(%L, %L)', test.id('iv'), test.id('inv.1'))) ->> 'online')::boolean, 'VYNTEX USA''s workspace pays online') \g /dev/null
select test.ok(public.invoice_mark_sent(test.id('iv'), test.id('inv.1'), 'client@example.com', repeat('a', 64), false), 'the server marks it sent') \g /dev/null
select test.ok(pg_temp.save('iv_owner', pg_temp.draft() || jsonb_build_object('id', test.id('inv.1'))) ->> 'error' = '42501', 'a sent invoice cannot be changed') \g /dev/null
select test.ok(test.j('iv_owner', format('select to_jsonb(public.invoice_discard(%L, %L))', test.id('iv'), test.id('inv.1'))) #>> '{}' = 'false', 'nor deleted') \g /dev/null

-- ---- the pay link and the Stripe payment (server only)
select test.ok(test.as('anon', format('select public.invoice_by_token(%L)', repeat('a', 64))) = 'error:42501', 'a visitor cannot look up a pay link') \g /dev/null
select test.ok((public.invoice_by_token(repeat('a', 64)) ->> 'balanceCents')::bigint = 164997, 'the server finds the balance from the token hash') \g /dev/null
select test.ok(public.invoice_by_token(repeat('b', 64)) is null, 'an unknown token finds nothing') \g /dev/null
select test.ok(test.as('iv_owner', format('select public.invoice_paid(%L, %L, %L, 100, now())', test.id('iv'), test.id('inv.1'), 'cs_test_abcdefghij')) = 'error:42501', 'a person cannot record a Stripe payment') \g /dev/null
select test.ok((public.invoice_paid(test.id('iv'), test.id('inv.1'), 'cs_test_partial0001', 64997, now()) ->> 'status') = 'sent', 'a part payment leaves it open') \g /dev/null
select test.ok((public.invoice_by_token(repeat('a', 64)) ->> 'balanceCents')::bigint = 100000, 'the link now asks for the rest only') \g /dev/null
select test.ok((public.invoice_paid(test.id('iv'), test.id('inv.1'), 'cs_test_partial0001', 64997, now()) ->> 'reason') = 'already', 'the same session is recorded once') \g /dev/null
select test.ok((public.invoice_paid(test.id('iv'), test.id('inv.1'), 'cs_test_rest0000001', 100000, now()) ->> 'status') = 'paid', 'paid in full') \g /dev/null
select test.ok(public.invoice_by_token(repeat('a', 64)) is null, 'a paid invoice''s link stops working') \g /dev/null
select test.is((select count(*)::text from public.client_payments p where p.tenant_id = test.id('iv') and p.ref like 'stripe:cs_test_%'), '2', 'two payments on the project') \g /dev/null
select test.ok((select sum(amount) = 1649.97 from public.client_payments p where p.tenant_id = test.id('iv') and p.ref like 'stripe:cs_test_%' and p.job_id = test.id('iv.j1')), 'for the exact amount') \g /dev/null
select test.ok(test.try(format('select public.invoice_paid(%L, %L, %L, 100, now())', test.id('iv'), test.id('inv.1'), 'not-a-session')) like 'error:%', 'a bad session id is refused') \g /dev/null

-- ---- void
select test.ok(pg_temp.save('iv_owner', pg_temp.draft()) ->> 'number' = 'INV-0003', 'another draft') \g /dev/null
select (select id from public.invoices where tenant_id = test.id('iv') and number = 'INV-0003') as inv3 \gset
select public.invoice_mark_sent(test.id('iv'), :'inv3', 'client@example.com', repeat('c', 64), false) \g /dev/null
select test.ok(test.j('iv_staff', format('select to_jsonb(public.invoice_void(%L, %L, %L))', test.id('iv'), :'inv3', 'typo')) ->> 'error' = '42501', 'staff cannot void') \g /dev/null
select test.stepup('iv_manager') \g /dev/null
select test.ok((test.j('iv_manager', format('select to_jsonb(public.invoice_void(%L, %L, %L))', test.id('iv'), :'inv3', 'typo')) #>> '{}')::boolean, 'a manager voids, with a fresh identity check') \g /dev/null
select test.ok(public.invoice_by_token(repeat('c', 64)) is null, 'a void invoice''s link stops working') \g /dev/null
select test.ok((test.j('iv_manager', format('select to_jsonb(public.invoice_void(%L, %L, %L))', test.id('iv'), test.id('inv.1'), 'x')) #>> '{}') = 'false', 'a paid invoice is never voided') \g /dev/null

-- ---- reminders
update public.invoices set due_date = current_date + 3, issue_date = current_date - 10 where id = (select id from public.invoices where tenant_id = test.id('iv') and number = 'INV-0002') \g /dev/null
select public.invoice_mark_sent(test.id('iv'), (select id from public.invoices where tenant_id = test.id('iv') and number = 'INV-0002'), 'client@example.com', repeat('d', 64), false) \g /dev/null
select test.ok(public.invoice_reminders_due() @> jsonb_build_array(jsonb_build_object('id', (select id from public.invoices where tenant_id = test.id('iv') and number = 'INV-0002'))), 'due in 3 days: a reminder') \g /dev/null
select public.invoice_mark_sent(test.id('iv'), (select id from public.invoices where tenant_id = test.id('iv') and number = 'INV-0002'), null, null, true) \g /dev/null
select test.ok(not public.invoice_reminders_due() @> jsonb_build_array(jsonb_build_object('id', (select id from public.invoices where tenant_id = test.id('iv') and number = 'INV-0002'))), 'one a day at most') \g /dev/null
select test.ok(test.as('iv_owner', 'select public.invoice_reminders_due()') = 'error:42501', 'only the server lists them') \g /dev/null
