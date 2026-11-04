-- Sample rows for the table of 0086 (invoices), for the three sample companies. Included by rls_isolation.sql.
create function test.seed_invoices(p text) returns void language plpgsql as $$
begin
  insert into public.invoices (tenant_id, number, job_id, client_id, lines, subtotal_cents, total_cents)
    values (test.id(p), 'INV-9001', test.id(p || '.j1'), test.id(p || '.c1'), '[{"text":"Sample","qty":1,"unitCents":10000}]', 10000, 10000);
end $$;
select test.seed_invoices('a') \g /dev/null
select test.seed_invoices('b') \g /dev/null
select test.seed_invoices('c') \g /dev/null
