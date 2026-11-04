-- 0086: invoices, sent from the ERP and paid online (owner decision of November 4, 2026: "ERP invoice + Stripe pay link").
--   * an invoice belongs to a project (public.jobs) and its client; lines are text, quantity and a price in cents
--   * an optional service fee line (2.9 percent where it applies) is computed here, never typed
--   * the ERP builds it, emails it and sends the reminders (api/_lib/invoices). The email carries a link to
--     /api/pay/<token>: each click opens a fresh Stripe Checkout page for what is still owed, so the link never expires
--     and can never charge more than the balance. Only a keyed hash of the token is kept
--   * Stripe's event, read back from Stripe, records the payment once (public.client_payments, by the Checkout session)
--     and marks the invoice paid. A person never types a Stripe payment
--   * online payment uses VYNTEX's own Stripe account, so it is offered only to VYNTEX USA's workspace (plan internal).
--     Every other company sends the same invoice, with its own payment instructions, until it connects its own Stripe
--   * a sent invoice cannot be edited, only voided (owner or manager, fresh identity check) and copied
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  number        text not null check (number ~ '^[A-Z0-9-]{3,20}$'),
  job_id        uuid not null,
  client_id     uuid,
  status        text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date    date not null default current_date,
  due_date      date not null default (current_date + 15),
  lang          text not null default 'en' check (lang in ('en', 'es')),
  -- [{ "text": "...", "qty": 1, "unitCents": 49700 }]
  lines         jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 50),
  fee_pct       numeric(5, 3) not null default 0 check (fee_pct >= 0 and fee_pct <= 10),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  fee_cents     bigint not null default 0 check (fee_cents >= 0),
  total_cents   bigint not null default 0 check (total_cents >= 0),
  paid_cents    bigint not null default 0 check (paid_cents >= 0),
  notes         text not null default '' check (length(notes) <= 2000),
  send_to       text check (send_to is null or (length(send_to) <= 254 and send_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  sent_at       timestamptz,
  reminders     smallint not null default 0,
  last_reminder date,
  pay_token_hash text unique check (pay_token_hash is null or pay_token_hash ~ '^[0-9a-f]{64}$'),
  paid_at       timestamptz,
  void_reason   text check (void_reason is null or length(void_reason) <= 300),
  extra         jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_by    uuid,
  created_at    timestamptz not null default pg_catalog.now(),
  updated_at    timestamptz not null default pg_catalog.now(),
  unique (tenant_id, number),
  foreign key (tenant_id, job_id) references public.jobs (tenant_id, id) on delete restrict,
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete restrict
);
create index if not exists invoices_tenant_idx on public.invoices (tenant_id, status, due_date);
create index if not exists invoices_job_idx on public.invoices (tenant_id, job_id);
create index if not exists invoices_client_idx on public.invoices (tenant_id, client_id);
alter table public.invoices enable row level security;
alter table public.invoices force row level security;
-- the people of the company with money rights read their own company's invoices; every write goes through the functions
-- below, so the totals, the numbering and the "a sent invoice never changes" rule cannot be skipped
revoke all on public.invoices from public, anon, authenticated;
grant select on public.invoices to authenticated;
create policy invoices_select on public.invoices for select to authenticated
  using (tenant_id = any ((select app.tenants_can('money'))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------------------------
-- the totals of a list of lines and a fee percent, in exact cents (the fee rounds half up)
create or replace function app.invoice_totals(p_lines jsonb, p_fee_pct numeric) returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_sub bigint := 0; l jsonb; q numeric; u bigint; v_fee bigint;
begin
  for l in select * from pg_catalog.jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if jsonb_typeof(l) <> 'object' or length(btrim(coalesce(l ->> 'text', ''))) not between 1 and 300
       or coalesce(l ->> 'qty', '') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or coalesce(l ->> 'unitCents', '') !~ '^-?[0-9]{1,10}$' then
      raise exception 'invalid_line' using errcode = '22023';
    end if;
    q := (l ->> 'qty')::numeric; u := (l ->> 'unitCents')::bigint;
    if q <= 0 then raise exception 'invalid_line' using errcode = '22023'; end if;
    v_sub := v_sub + pg_catalog.round(q * u)::bigint;
  end loop;
  if v_sub < 0 then raise exception 'negative_total' using errcode = '22023'; end if;
  v_fee := pg_catalog.round(v_sub * coalesce(p_fee_pct, 0) / 100)::bigint;
  return pg_catalog.jsonb_build_object('subtotal', v_sub, 'fee', v_fee, 'total', v_sub + v_fee);
end $$;
revoke all on function app.invoice_totals(jsonb, numeric) from public, anon, authenticated;

create or replace function app.invoice_json(i public.invoices) returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('id', i.id, 'number', i.number, 'jobId', i.job_id, 'clientId', i.client_id, 'status', i.status,
    'issueDate', i.issue_date, 'dueDate', i.due_date, 'lang', i.lang, 'lines', i.lines, 'feePct', i.fee_pct,
    'subtotalCents', i.subtotal_cents, 'feeCents', i.fee_cents, 'totalCents', i.total_cents, 'paidCents', i.paid_cents,
    'notes', i.notes, 'sendTo', i.send_to, 'sentAt', i.sent_at, 'reminders', i.reminders, 'lastReminder', i.last_reminder,
    'paidAt', i.paid_at, 'voidReason', i.void_reason, 'hasPayLink', i.pay_token_hash is not null, 'createdAt', i.created_at,
    'project', (select j.name from public.jobs j where j.id = i.job_id),
    'client', (select c.name from public.clients c where c.id = i.client_id),
    'overdue', i.status = 'sent' and i.due_date < current_date)
$$;
revoke all on function app.invoice_json(public.invoices) from public, anon, authenticated;

-- the next number of a company: INV-0001, INV-0002, ...
create or replace function app.invoice_next_number(p_tenant uuid) returns text language sql stable security definer set search_path = '' as $$
  select 'INV-' || pg_catalog.lpad((coalesce(max(nullif(pg_catalog.regexp_replace(i.number, '^INV-0*', ''), '')::bigint), 0) + 1)::text, 4, '0')
    from public.invoices i where i.tenant_id = p_tenant and i.number ~ '^INV-[0-9]+$'
$$;
revoke all on function app.invoice_next_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- for the people of the company (through /api/ws/rpc, listed in api/_lib/rpc-allowlist.js)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.invoice_list(p_tenant uuid, p_status text default null, p_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_tenant = any ((select app.tenants_can('money'))::uuid[])) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(app.invoice_json(i) order by i.issue_date desc, i.number desc) from public.invoices i
    where i.tenant_id = p_tenant and (p_status is null or i.status = p_status) and (p_job is null or i.job_id = p_job)), '[]'::jsonb);
end $$;

-- add or change a draft. Lines and fee are checked and totaled here; a sent invoice is never changed.
create or replace function public.invoice_save(p_tenant uuid, p_invoice jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.invoices; t jsonb; v_job uuid; v_client uuid; v_id uuid := nullif(p_invoice ->> 'id', '')::uuid;
begin
  if not (p_tenant = any ((select app.tenants_can('money', 'write'))::uuid[])) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_job := nullif(p_invoice ->> 'jobId', '')::uuid;
  select j.client_id into v_client from public.jobs j where j.tenant_id = p_tenant and j.id = v_job;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  t := app.invoice_totals(p_invoice -> 'lines', coalesce(nullif(p_invoice ->> 'feePct', '')::numeric, 0));
  if (t ->> 'total')::bigint <= 0 then raise exception 'empty_invoice' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.invoices (tenant_id, number, job_id, client_id, issue_date, due_date, lang, lines, fee_pct, subtotal_cents, fee_cents, total_cents, notes, send_to, created_by)
    values (p_tenant, app.invoice_next_number(p_tenant), v_job, v_client, coalesce(nullif(p_invoice ->> 'issueDate', '')::date, current_date),
            coalesce(nullif(p_invoice ->> 'dueDate', '')::date, current_date + 15), coalesce(nullif(p_invoice ->> 'lang', ''), 'en'),
            p_invoice -> 'lines', coalesce(nullif(p_invoice ->> 'feePct', '')::numeric, 0), (t ->> 'subtotal')::bigint, (t ->> 'fee')::bigint, (t ->> 'total')::bigint,
            coalesce(p_invoice ->> 'notes', ''), nullif(btrim(coalesce(p_invoice ->> 'sendTo', '')), ''), (select auth.uid()))
    returning * into v;
  else
    update public.invoices i set job_id = v_job, client_id = v_client,
        issue_date = coalesce(nullif(p_invoice ->> 'issueDate', '')::date, i.issue_date), due_date = coalesce(nullif(p_invoice ->> 'dueDate', '')::date, i.due_date),
        lang = coalesce(nullif(p_invoice ->> 'lang', ''), i.lang), lines = p_invoice -> 'lines', fee_pct = coalesce(nullif(p_invoice ->> 'feePct', '')::numeric, 0),
        subtotal_cents = (t ->> 'subtotal')::bigint, fee_cents = (t ->> 'fee')::bigint, total_cents = (t ->> 'total')::bigint,
        notes = coalesce(p_invoice ->> 'notes', i.notes), send_to = nullif(btrim(coalesce(p_invoice ->> 'sendTo', '')), ''), updated_at = pg_catalog.now()
     where i.id = v_id and i.tenant_id = p_tenant and i.status = 'draft' returning * into v;
    if v.id is null then raise exception 'not_a_draft' using errcode = '42501'; end if;
  end if;
  if v.due_date < v.issue_date then raise exception 'due_before_issue' using errcode = '22023'; end if;
  return app.invoice_json(v);
end $$;

-- void (owner or manager, fresh identity check). A paid invoice is never voided here: a refund is a person's job in Stripe.
create or replace function public.invoice_void(p_tenant uuid, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := app.member_role(p_tenant);
  if v_role not in ('owner', 'manager') then raise exception 'not_allowed' using errcode = '42501'; end if;
  perform app.require_stepup(300);
  update public.invoices i set status = 'void', void_reason = pg_catalog.left(nullif(btrim(coalesce(p_reason, '')), ''), 300), pay_token_hash = null, updated_at = pg_catalog.now()
   where i.id = p_id and i.tenant_id = p_tenant and i.status in ('draft', 'sent') and i.paid_cents = 0;
  if not found then return false; end if;
  perform app.security_event(p_tenant, (select auth.uid()), 'invoice.void', 'ok', null, pg_catalog.jsonb_build_object('invoice', p_id));
  return true;
end $$;

-- a draft is deleted outright (nothing was sent); a sent invoice is voided instead
create or replace function public.invoice_discard(p_tenant uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_tenant = any ((select app.tenants_can('money', 'write'))::uuid[])) then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.invoices i where i.id = p_id and i.tenant_id = p_tenant and i.status = 'draft';
  return found;
end $$;

revoke all on function public.invoice_list(uuid, text, uuid), public.invoice_save(uuid, jsonb), public.invoice_void(uuid, uuid, text), public.invoice_discard(uuid, uuid) from public, anon;
grant execute on function public.invoice_list(uuid, text, uuid), public.invoice_save(uuid, jsonb), public.invoice_void(uuid, uuid, text), public.invoice_discard(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- for the server only
-- ---------------------------------------------------------------------------------------------------------------------
-- what the server needs to send (or remind about) one invoice, after it checked the person may (invoice_send_check)
create or replace function public.invoice_send_check(p_tenant uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.invoices;
begin
  if not (p_tenant = any ((select app.tenants_can('money', 'write'))::uuid[])) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into v from public.invoices i where i.id = p_id and i.tenant_id = p_tenant and i.status in ('draft', 'sent');
  if v.id is null then return null; end if;
  return app.invoice_json(v) || pg_catalog.jsonb_build_object('online', (select t.plan_id = 'internal' from public.tenants t where t.id = p_tenant),
    'company', (select pg_catalog.jsonb_build_object('name', t.name, 'slug', t.slug) from public.tenants t where t.id = p_tenant),
    'clientEmail', (select c.email from public.clients c where c.id = v.client_id));
end $$;
revoke all on function public.invoice_send_check(uuid, uuid) from public, anon;
grant execute on function public.invoice_send_check(uuid, uuid) to authenticated;

-- the invoice was emailed: it is now sent (and can no longer be edited); the pay link's token hash is kept
create or replace function public.invoice_mark_sent(p_tenant uuid, p_id uuid, p_to text, p_token_hash text, p_reminder boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid' using errcode = '22023'; end if;
  update public.invoices i set status = 'sent', send_to = coalesce(p_to, i.send_to), sent_at = coalesce(i.sent_at, pg_catalog.now()),
      pay_token_hash = coalesce(p_token_hash, i.pay_token_hash),
      reminders = i.reminders + case when p_reminder then 1 else 0 end, last_reminder = case when p_reminder then current_date else i.last_reminder end,
      updated_at = pg_catalog.now()
   where i.id = p_id and i.tenant_id = p_tenant and i.status in ('draft', 'sent');
  if found then perform app.security_event(p_tenant, null, case when p_reminder then 'invoice.reminded' else 'invoice.sent' end, 'ok', null, pg_catalog.jsonb_build_object('invoice', p_id)); end if;
  return found;
end $$;
revoke all on function public.invoice_mark_sent(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.invoice_mark_sent(uuid, uuid, text, text, boolean) to service_role;

-- the pay link: the invoice behind a token hash, with what is still owed (null when nothing is, or it is not payable)
create or replace function public.invoice_by_token(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app.invoice_json(i) || pg_catalog.jsonb_build_object('tenantId', i.tenant_id, 'balanceCents', i.total_cents - i.paid_cents,
      'online', t.plan_id = 'internal' and app.tenant_open(t.status, t.trial_expires_at), 'companyName', t.name)
    from public.invoices i join public.tenants t on t.id = i.tenant_id
   where p_token_hash ~ '^[0-9a-f]{64}$' and i.pay_token_hash = p_token_hash and i.status = 'sent' and i.total_cents > i.paid_cents
$$;
revoke all on function public.invoice_by_token(text) from public, anon, authenticated;
grant execute on function public.invoice_by_token(text) to service_role;

-- Stripe's event, already read back from Stripe by the server: the payment is recorded once (by its Checkout session)
create or replace function public.invoice_paid(p_tenant uuid, p_id uuid, p_session text, p_cents bigint, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.invoices; v_new boolean;
begin
  if p_session !~ '^cs_[A-Za-z0-9_]{8,200}$' or p_cents is null or p_cents <= 0 then raise exception 'invalid' using errcode = '22023'; end if;
  select * into v from public.invoices i where i.id = p_id and i.tenant_id = p_tenant for update;
  if v.id is null then return pg_catalog.jsonb_build_object('recorded', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.client_payments p where p.tenant_id = p_tenant and p.ref = 'stripe:' || p_session) then
    return pg_catalog.jsonb_build_object('recorded', false, 'reason', 'already', 'status', v.status);
  end if;
  insert into public.client_payments (tenant_id, job_id, date, method, ref, amount, extra)
  values (p_tenant, v.job_id, coalesce(p_paid_at, pg_catalog.now())::date, 'card', 'stripe:' || p_session, p_cents / 100.0,
          pg_catalog.jsonb_build_object('invoice', v.id, 'number', v.number, 'source', 'stripe'));
  update public.invoices i set paid_cents = i.paid_cents + p_cents,
      status = case when i.paid_cents + p_cents >= i.total_cents then 'paid' else i.status end,
      paid_at = case when i.paid_cents + p_cents >= i.total_cents then coalesce(p_paid_at, pg_catalog.now()) else i.paid_at end,
      pay_token_hash = case when i.paid_cents + p_cents >= i.total_cents then null else i.pay_token_hash end, updated_at = pg_catalog.now()
   where i.id = v.id returning * into v;
  perform app.security_event(p_tenant, null, 'invoice.paid', 'ok', null, pg_catalog.jsonb_build_object('invoice', v.id, 'cents', p_cents));
  return pg_catalog.jsonb_build_object('recorded', true, 'status', v.status, 'balanceCents', v.total_cents - v.paid_cents, 'number', v.number,
    'sendTo', v.send_to, 'lang', v.lang, 'companyName', (select t.name from public.tenants t where t.id = p_tenant));
end $$;
revoke all on function public.invoice_paid(uuid, uuid, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.invoice_paid(uuid, uuid, text, bigint, timestamptz) to service_role;

-- the reminders due today: 3 days before the due date, on it, then 7 and 14 days after; at most one a day, five in all
create or replace function public.invoice_reminders_due() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenantId', i.tenant_id, 'id', i.id)), '[]'::jsonb)
    from public.invoices i join public.tenants t on t.id = i.tenant_id
   where i.status = 'sent' and i.total_cents > i.paid_cents and i.send_to is not null and i.reminders < 5
     and app.tenant_open(t.status, t.trial_expires_at)
     and (i.last_reminder is null or i.last_reminder < current_date)
     and (current_date - i.due_date) in (-3, 0, 7, 14)
$$;
revoke all on function public.invoice_reminders_due() from public, anon, authenticated;
grant execute on function public.invoice_reminders_due() to service_role;

-- what a reminder needs (server only: the daily pass has nobody signed in)
create or replace function public.invoice_for_server(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app.invoice_json(i) || pg_catalog.jsonb_build_object('online', t.plan_id = 'internal', 'company', pg_catalog.jsonb_build_object('name', t.name, 'slug', t.slug))
    from public.invoices i join public.tenants t on t.id = i.tenant_id where i.id = p_id and i.tenant_id = p_tenant
$$;
revoke all on function public.invoice_for_server(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invoice_for_server(uuid, uuid) to service_role;
