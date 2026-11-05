-- Module tests: an invoice paid outside Stripe (0097).
--   people with money rights record it; never more than the balance; partly paid stays open; fully paid closes the pay
--   link; the payment lands on the project; a void or paid invoice takes no more; another company cannot
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('94. invoice paid outside Stripe') \g /dev/null

select test.seed_company('ip', 'inv-pay', 'practice', 'internal') \g /dev/null
select test.seed_company('iq', 'inv-pay-other', 'build', 'builder') \g /dev/null

create function pg_temp.pay(who text, inv uuid, cents bigint, method text default 'zelle', ref text default '') returns jsonb language sql as
$$ select test.j(who, format('select public.invoice_record_payment(%L, %L, %s, %L, current_date, %L)', test.id('ip'), inv, coalesce(cents::text, 'null'), method, ref)) $$;

select (test.j('ip_owner', format('select public.invoice_save(%L, %L::jsonb)', test.id('ip'),
  jsonb_build_object('jobId', test.id('ip.j1'), 'lines', jsonb_build_array(jsonb_build_object('text', 'Website deposit', 'qty', 1, 'unitCents', 621000))))) ->> 'id')::uuid as inv \gset
select public.invoice_mark_sent(test.id('ip'), :'inv', 'client@example.com', repeat('e', 64), false) \g /dev/null
select count(*) as before from public.client_payments where tenant_id = test.id('ip') and job_id = test.id('ip.j1') \gset

-- who may
select test.ok(pg_temp.pay('ip_readonly', :'inv', 1000) ->> 'error' = '42501', 'read only cannot record a payment') \g /dev/null
select test.ok(pg_temp.pay('iq_owner', :'inv', 1000) ->> 'error' = '42501', 'another company cannot') \g /dev/null
select test.ok(pg_temp.pay('anon', :'inv', 1000) ->> 'error' = '42501', 'nor a visitor') \g /dev/null
-- checks
select test.ok(pg_temp.pay('ip_owner', :'inv', 621001) ->> 'error' = '22023', 'never more than the balance') \g /dev/null
select test.ok(pg_temp.pay('ip_owner', :'inv', 0) ->> 'error' = '22023', 'a real amount') \g /dev/null
select test.ok(pg_temp.pay('ip_owner', :'inv', 1000, 'bitcoin') ->> 'error' = '22023', 'a known method') \g /dev/null
select test.ok(pg_temp.pay('ip_owner', :'inv', 1000, 'check', '4111111111111111') ->> 'error' = '22023', 'a reference is never an account number') \g /dev/null
-- partly paid
select test.is(pg_temp.pay('ip_owner', :'inv', 300000, 'zelle', 'ZL-77') ->> 'status', 'sent', 'partly paid stays open') \g /dev/null
select test.is((select paid_cents::text from public.invoices where id = :'inv'), '300000', 'the paid amount') \g /dev/null
select test.ok((select pay_token_hash is not null from public.invoices where id = :'inv'), 'the pay link keeps working for the rest') \g /dev/null
select test.ok((select count(*) from public.client_payments where tenant_id = test.id('ip') and job_id = test.id('ip.j1')) = :before + 1, 'the payment is on the project') \g /dev/null
select test.ok(exists (select 1 from public.client_payments where tenant_id = test.id('ip') and amount = 3000 and method = 'zelle' and ref = 'ZL-77' and extra ->> 'invoice' = :'inv'), 'tied to the invoice') \g /dev/null
-- the rest: no amount means the balance
select test.is(pg_temp.pay('ip_staff', :'inv', null, 'check') ->> 'status', 'paid', 'the balance closes it') \g /dev/null
select test.ok((select pay_token_hash is null and paid_at is not null from public.invoices where id = :'inv'), 'paid: the link stops working') \g /dev/null
select test.ok(pg_temp.pay('ip_owner', :'inv', 100) ->> 'error' = '22023', 'a paid invoice takes no more') \g /dev/null
select test.ok(exists (select 1 from app.security_events where tenant_id = test.id('ip') and kind = 'invoice.paid_manual'), 'in the security log') \g /dev/null
select test.ok(test.as('ip_owner', format('update public.invoices set paid_cents = 0 where id = %L', :'inv')) like 'error:%', 'nobody writes the table directly') \g /dev/null

