-- 0097: an invoice paid outside Stripe (Zelle, check, cash, a bank transfer) is recorded by a person, from the Invoices
-- screen or by VYNTEX AI after the person confirms (owner request of November 6, 2026: the AI does everything a person does).
--   * public.invoice_record_payment: people with money rights; a sent (or draft) invoice; never more than its balance
--   * the payment is written to the project like any other client payment, tied to the invoice, in one step with the invoice
--   * fully paid: the invoice is paid and its pay link stops working; partly paid: it stays open with its balance
--   * every recording is in the security log
-- Check after applying:
--   select pg_catalog.has_function_privilege('authenticated', 'public.invoice_record_payment(uuid, uuid, bigint, text, date, text)', 'execute'),
--          pg_catalog.has_function_privilege('anon', 'public.invoice_record_payment(uuid, uuid, bigint, text, date, text)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.invoice_record_payment(p_tenant uuid, p_id uuid, p_cents bigint, p_method text, p_date date, p_ref text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.invoices; v_ref text := pg_catalog.left(pg_catalog.btrim(coalesce(p_ref, '')), 60);
begin
  if not (p_tenant = any ((select app.tenants_can('money', 'write'))::uuid[])) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_method is null or p_method not in ('cash', 'check', 'transfer', 'zelle', 'card') then raise exception 'invalid_method' using errcode = '22023'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 3650 then raise exception 'invalid_date' using errcode = '22023'; end if;
  -- a reference is a check number or similar, never a card or bank account number
  if v_ref ~ '\d{9,}' then raise exception 'invalid_ref' using errcode = '22023'; end if;
  select * into v from public.invoices i where i.id = p_id and i.tenant_id = p_tenant for update;
  if v.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status not in ('sent', 'draft') then raise exception 'not_open' using errcode = '22023'; end if;
  -- no amount: the whole balance
  p_cents := coalesce(p_cents, v.total_cents - v.paid_cents);
  if p_cents <= 0 or p_cents > v.total_cents - v.paid_cents then raise exception 'invalid_amount' using errcode = '22023'; end if;
  insert into public.client_payments (tenant_id, job_id, date, method, ref, amount, extra)
  values (p_tenant, v.job_id, p_date, p_method, v_ref, p_cents / 100.0,
          pg_catalog.jsonb_build_object('invoice', v.id, 'number', v.number, 'source', 'manual', 'by', (select auth.uid())));
  update public.invoices i set paid_cents = i.paid_cents + p_cents,
      status = case when i.paid_cents + p_cents >= i.total_cents then 'paid' else i.status end,
      paid_at = case when i.paid_cents + p_cents >= i.total_cents then pg_catalog.now() else i.paid_at end,
      pay_token_hash = case when i.paid_cents + p_cents >= i.total_cents then null else i.pay_token_hash end, updated_at = pg_catalog.now()
   where i.id = v.id returning * into v;
  perform app.security_event(p_tenant, (select auth.uid()), 'invoice.paid_manual', 'ok', null, pg_catalog.jsonb_build_object('invoice', v.id, 'cents', p_cents, 'method', p_method));
  return app.invoice_json(v);
end $$;
revoke all on function public.invoice_record_payment(uuid, uuid, bigint, text, date, text) from public, anon;
grant execute on function public.invoice_record_payment(uuid, uuid, bigint, text, date, text) to authenticated;
