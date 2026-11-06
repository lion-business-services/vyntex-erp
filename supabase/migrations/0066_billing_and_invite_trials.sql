-- 0066: subscriptions and billing (Stripe), and trials by invitation only.
--
-- TRIALS. The seven-day trial is no longer open to the public: VYNTEX gives it to a client it chose, from the operator
-- console. operator_create_company() with the plan 'trial' opens the company in onboarding with a trial registration for
-- the owner's address (one trial per address, ever); the clock starts when the owner accepts the invitation (the
-- trigger of 0064). The public request function of 0064 stays in place but nobody can call it any more.
--
-- BILLING. A company pays VYNTEX through Stripe. What Stripe says is recorded here, and only the server (service role)
-- writes it, after checking Stripe's signature and reading the event back from Stripe's API:
--   app.billing_accounts    one row per company: its Stripe customer and subscription and their state
--   app.billing_checkouts   every checkout link made (by the owner, or sent by an operator), and how it ended
--   app.billing_events      what happened, once per Stripe object (payments, failures, cancellations): never changed
--   app.billing_notices     which reminder went to which company for which period, so none goes twice
-- The plan and status of public.tenants follow the subscription: paid (or trialing at Stripe) opens the company and sets
-- its plan; a failed payment gives a grace period (7 days); after the grace period, or when the subscription ends, the
-- company is paused with every record kept; paying again opens it. No person in a company can change any of this.

-- ---------------------------------------------------------------------------------------------------------------------
-- Trials by invitation
-- ---------------------------------------------------------------------------------------------------------------------
revoke execute on function public.trial_request_create(text, text, text, text, text, text, text) from service_role;
revoke execute on function public.trial_request_cancel(text) from service_role;

create or replace function public.operator_create_company(
  p_slug text, p_name text, p_industry text, p_plan text, p_owner_email text, p_owner_name text default ''
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_owner_email, '')));
  v_trial boolean := p_plan = 'trial';
  v_tenant uuid;
  v_token text;
begin
  perform app.require_operator();
  if not app.is_valid_slug(v_slug) then
    raise exception 'That address cannot be used' using errcode = '22023', hint = 'bad_slug';
  end if;
  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    raise exception 'That address is taken' using errcode = '23505', hint = 'slug_taken';
  end if;
  if pg_catalog.length(v_name) not between 1 and 200 then
    raise exception 'The business name is required' using errcode = '22023', hint = 'bad_name';
  end if;
  if not exists (select 1 from public.industries i where i.id = p_industry) then
    raise exception 'Unknown edition' using errcode = '22023', hint = 'bad_industry';
  end if;
  if coalesce(p_plan, '') !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'Unknown plan' using errcode = '22023', hint = 'bad_plan';
  end if;
  -- one trial per address, ever: a second one for the same owner is refused
  if v_trial and exists (select 1 from app.trial_registrations r where r.email_hash = pg_catalog.encode(extensions.digest(v_email, 'sha256'), 'hex')) then
    raise exception 'This address already had a trial' using errcode = '23505', hint = 'trial_used';
  end if;
  insert into public.tenants (slug, name, industry_id, plan_id, status)
  values (v_slug, v_name, p_industry, p_plan, case when v_trial then 'onboarding' else 'active' end)
  returning id into v_tenant;
  if v_trial then
    insert into app.trial_registrations (tenant_id, email_hash)
    values (v_tenant, pg_catalog.encode(extensions.digest(v_email, 'sha256'), 'hex'));
  end if;
  v_token := app.operator_owner_invite(v_tenant, p_owner_email, p_owner_name);
  perform app.security_event(v_tenant, (select auth.uid()), 'operator.company_created', 'ok', null,
    pg_catalog.jsonb_build_object('slug', v_slug, 'industry', p_industry, 'plan', p_plan, 'trial', v_trial));
  return pg_catalog.jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'token', v_token, 'email', v_email, 'trial', v_trial);
end
$$;
revoke all on function public.operator_create_company(text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.operator_create_company(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Billing tables (app schema: no person reads them directly; the server and the operator functions do)
-- ---------------------------------------------------------------------------------------------------------------------
create table app.billing_accounts (
  tenant_id            uuid primary key references public.tenants (id) on delete cascade,
  customer_id          text unique check (customer_id ~ '^cus_[A-Za-z0-9]{6,60}$'),
  subscription_id      text unique check (subscription_id ~ '^sub_[A-Za-z0-9]{6,60}$'),
  status               text not null default 'none'
                       check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  plan_id              text check (plan_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  billing              text check (billing in ('monthly', 'yearly', 'custom')),
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until          timestamptz,
  last_payment_at      timestamptz,
  last_failure_at      timestamptz,
  -- true while the company is paused because of billing (not by an operator): only then does a payment reopen it
  paused_by_billing    boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table app.billing_accounts enable row level security;
alter table app.billing_accounts force row level security;
revoke all on app.billing_accounts from public, anon, authenticated, service_role;

create table app.billing_checkouts (
  session_id      text primary key check (session_id ~ '^cs_[A-Za-z0-9_]{6,200}$'),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  created_by      uuid,
  source          text not null check (source in ('owner', 'operator')),
  plan_id         text check (plan_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  billing         text not null check (billing in ('monthly', 'yearly', 'custom')),
  setup_cents     bigint not null check (setup_cents >= 0),
  recurring_cents bigint not null check (recurring_cents > 0),
  status          text not null default 'open' check (status in ('open', 'complete', 'expired')),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index billing_checkouts_tenant on app.billing_checkouts (tenant_id, created_at desc);
alter table app.billing_checkouts enable row level security;
alter table app.billing_checkouts force row level security;
revoke all on app.billing_checkouts from public, anon, authenticated, service_role;

create table app.billing_events (
  id           bigint generated always as identity primary key,
  tenant_id    uuid references public.tenants (id) on delete cascade,
  kind         text not null check (kind ~ '^[a-z][a-z0-9_.]{2,60}$'),
  stripe_id    text not null check (pg_catalog.length(stripe_id) between 3 and 200),
  amount_cents bigint,
  currency     text check (currency ~ '^[a-z]{3}$'),
  status       text check (pg_catalog.length(status) <= 40),
  facts        jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(facts) = 'object' and pg_catalog.pg_column_size(facts) < 8192),
  at           timestamptz not null default now(),
  unique (kind, stripe_id)
);
create index billing_events_tenant on app.billing_events (tenant_id, at desc);
alter table app.billing_events enable row level security;
alter table app.billing_events force row level security;
revoke all on app.billing_events from public, anon, authenticated, service_role;

create table app.billing_notices (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind      text not null check (kind ~ '^[a-z][a-z0-9_.]{2,60}$'),
  period    text not null check (pg_catalog.length(period) between 1 and 60),
  sent_at   timestamptz not null default now(),
  primary key (tenant_id, kind, period)
);
alter table app.billing_notices enable row level security;
alter table app.billing_notices force row level security;
revoke all on app.billing_notices from public, anon, authenticated, service_role;

-- A billing event is a record: it is never changed or removed (a company deleted by the database owner takes its rows).
create or replace function app.billing_events_frozen() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Billing events are never changed' using errcode = '42501';
end $$;
create trigger billing_events_frozen before update on app.billing_events for each row execute function app.billing_events_frozen();

-- ---------------------------------------------------------------------------------------------------------------------
-- Server functions (service role only)
-- ---------------------------------------------------------------------------------------------------------------------

-- Who may look at or pay for a company's plan: an active owner or manager of it, whatever the company's state (an ended
-- trial or a paused company must still be able to pay). NULL for anyone else. Only owners may buy: the server checks the role.
create or replace function public.billing_context(p_user uuid, p_tenant uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'industry', t.industry_id, 'plan', t.plan_id, 'status', t.status,
    'trial_started_at', t.trial_started_at, 'trial_expires_at', t.trial_expires_at, 'role', m.role,
    'email', (select pg_catalog.lower(u.email) from auth.users u where u.id = p_user),
    'account', (select pg_catalog.to_jsonb(a) - 'tenant_id' from app.billing_accounts a where a.tenant_id = t.id))
  from public.tenant_members m join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_user and m.tenant_id = p_tenant and m.status = 'active' and m.role in ('owner', 'manager') and t.status <> 'closed'
$$;

-- What an operator needs to send a payment link: the company and its first active owner.
create or replace function public.billing_company(p_tenant uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'industry', t.industry_id, 'plan', t.plan_id, 'status', t.status,
    'trial_expires_at', t.trial_expires_at,
    'owner_email', (select m.email from public.tenant_members m where m.tenant_id = t.id and m.role = 'owner' and m.status = 'active' and m.email is not null order by m.created_at limit 1),
    'owner_name', (select m.name from public.tenant_members m where m.tenant_id = t.id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1),
    'account', (select pg_catalog.to_jsonb(a) - 'tenant_id' from app.billing_accounts a where a.tenant_id = t.id))
  from public.tenants t where t.id = p_tenant and t.status <> 'closed'
$$;

create or replace function public.billing_tenant_of_customer(p_customer text) returns uuid
language sql stable security definer
set search_path = ''
as $$ select a.tenant_id from app.billing_accounts a where a.customer_id = p_customer $$;

-- Remembers the Stripe customer of a company. A company keeps one customer: a different one later is refused.
create or replace function public.billing_customer_set(p_tenant uuid, p_customer text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.billing_accounts (tenant_id, customer_id) values (p_tenant, p_customer)
  on conflict (tenant_id) do update set customer_id = excluded.customer_id, updated_at = pg_catalog.now()
    where app.billing_accounts.customer_id is null or app.billing_accounts.customer_id = excluded.customer_id;
  return exists (select 1 from app.billing_accounts a where a.tenant_id = p_tenant and a.customer_id = p_customer);
end
$$;

create or replace function public.billing_checkout_add(
  p_session text, p_tenant uuid, p_by uuid, p_source text, p_plan text, p_billing text, p_setup bigint, p_recurring bigint, p_expires timestamptz
) returns void
language sql security definer
set search_path = ''
as $$
  insert into app.billing_checkouts (session_id, tenant_id, created_by, source, plan_id, billing, setup_cents, recurring_cents, expires_at)
  values (p_session, p_tenant, p_by, p_source, p_plan, p_billing, p_setup, p_recurring, p_expires)
  on conflict (session_id) do nothing
$$;

create or replace function public.billing_checkout_done(p_session text, p_status text) returns jsonb
language sql security definer
set search_path = ''
as $$
  update app.billing_checkouts c set status = p_status, completed_at = case when p_status = 'complete' then pg_catalog.now() else c.completed_at end
   where c.session_id = p_session and c.status = 'open' and p_status in ('complete', 'expired')
  returning pg_catalog.jsonb_build_object('tenant_id', c.tenant_id, 'plan_id', c.plan_id, 'billing', c.billing, 'source', c.source)
$$;

-- Records one thing Stripe reported. TRUE the first time, FALSE when it was already recorded (a repeated event).
create or replace function public.billing_event_add(
  p_tenant uuid, p_kind text, p_stripe_id text, p_amount bigint, p_currency text, p_status text, p_facts jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.billing_events (tenant_id, kind, stripe_id, amount_cents, currency, status, facts)
  values (p_tenant, p_kind, p_stripe_id, p_amount, pg_catalog.lower(p_currency), p_status, coalesce(p_facts, '{}'::jsonb));
  return true;
exception when unique_violation then
  return false;
end
$$;

-- The subscription as Stripe has it now, applied to the company. The server calls it with what it read back from Stripe's
-- API (never with what a webhook body claimed), so the newest state always wins, whatever order events arrive in.
create or replace function public.billing_sync(
  p_tenant uuid, p_customer text, p_subscription text, p_status text, p_plan text, p_billing text,
  p_period_end timestamptz, p_cancel_at_end boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before text;
  v_tenant_before text;
  v_open boolean := p_status in ('active', 'trialing');
  v_late boolean := p_status in ('past_due', 'unpaid');
  v_out jsonb;
begin
  select t.status into v_tenant_before from public.tenants t where t.id = p_tenant for update;
  if v_tenant_before is null or v_tenant_before = 'closed' then return null; end if;
  select a.status into v_before from app.billing_accounts a where a.tenant_id = p_tenant;

  insert into app.billing_accounts as a (tenant_id, customer_id, subscription_id, status, plan_id, billing, current_period_end, cancel_at_period_end, updated_at)
  values (p_tenant, p_customer, p_subscription, p_status, p_plan, p_billing, p_period_end, coalesce(p_cancel_at_end, false), pg_catalog.now())
  on conflict (tenant_id) do update set
    customer_id = coalesce(a.customer_id, excluded.customer_id),
    subscription_id = excluded.subscription_id,
    status = excluded.status,
    plan_id = coalesce(excluded.plan_id, a.plan_id),
    billing = coalesce(excluded.billing, a.billing),
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    grace_until = case when v_late then coalesce(a.grace_until, pg_catalog.now() + interval '7 days') else null end,
    last_failure_at = case when v_late and a.status is distinct from excluded.status then pg_catalog.now() else a.last_failure_at end,
    updated_at = pg_catalog.now();
  if v_late then
    update app.billing_accounts a set grace_until = coalesce(a.grace_until, pg_catalog.now() + interval '7 days') where a.tenant_id = p_tenant;
  end if;

  if v_open then
    -- paid (or a Stripe trial): the plan is the subscription's, the trial is over, the company is open. A company an
    -- operator paused by hand stays paused: only a pause for billing is lifted by paying.
    update public.tenants t set
      plan_id = coalesce(p_plan, t.plan_id),
      trial_expires_at = null,
      status = case when t.status = 'suspended' and not coalesce((select a.paused_by_billing from app.billing_accounts a where a.tenant_id = p_tenant), false)
                    then 'suspended' else 'active' end
    where t.id = p_tenant;
    update app.billing_accounts a set paused_by_billing = false where a.tenant_id = p_tenant;
  elsif p_status in ('canceled', 'incomplete_expired', 'paused') and v_before is not null and v_before in ('active', 'trialing', 'past_due', 'unpaid') then
    -- the subscription ended (or was paused at Stripe): the company is paused, every record kept
    update public.tenants t set status = 'suspended' where t.id = p_tenant and t.status = 'active';
    if found then update app.billing_accounts a set paused_by_billing = true where a.tenant_id = p_tenant; end if;
  end if;

  select pg_catalog.jsonb_build_object('before', v_before, 'after', p_status, 'tenant_before', v_tenant_before,
    'tenant_after', (select t.status from public.tenants t where t.id = p_tenant),
    'grace_until', (select a.grace_until from app.billing_accounts a where a.tenant_id = p_tenant)) into v_out;
  perform app.security_event(p_tenant, null, 'billing.subscription_' || p_status, 'ok', null,
    pg_catalog.jsonb_build_object('plan', p_plan, 'billing', p_billing, 'before', v_before));
  return v_out;
end
$$;

-- A payment went through: the date is kept and the grace period ends.
create or replace function public.billing_paid(p_tenant uuid) returns void
language sql security definer
set search_path = ''
as $$
  update app.billing_accounts a set last_payment_at = pg_catalog.now(), grace_until = null, updated_at = pg_catalog.now()
   where a.tenant_id = p_tenant
$$;

-- Once a day: companies whose grace period ended are paused (records kept). Returns them with their owners' addresses.
create or replace function public.billing_enforce_grace() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with due as (
    select a.tenant_id from app.billing_accounts a join public.tenants t on t.id = a.tenant_id
     where a.grace_until is not null and a.grace_until < pg_catalog.now() and a.status in ('past_due', 'unpaid')
       and t.status = 'active'
  ), paused as (
    update public.tenants t set status = 'suspended' from due where t.id = due.tenant_id returning t.id, t.slug, t.name
  ), marked as (
    update app.billing_accounts a set paused_by_billing = true from paused p where a.tenant_id = p.id returning a.tenant_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenant_id', p.id, 'slug', p.slug, 'name', p.name,
    'owners', (select coalesce(pg_catalog.jsonb_agg(m.email), '[]'::jsonb) from public.tenant_members m
               where m.tenant_id = p.id and m.role = 'owner' and m.status = 'active' and m.email is not null))), '[]'::jsonb)
    into v_out from paused p;
  return v_out;
end
$$;

-- Once a day: the reminders that are due. kind = trial_3d | trial_1d | trial_ended | payment_failed | paused.
-- `period` makes each reminder once per company and occasion.
create or replace function public.billing_notices_due() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with owners as (
    select m.tenant_id, pg_catalog.jsonb_agg(m.email) as emails
    from public.tenant_members m where m.role = 'owner' and m.status = 'active' and m.email is not null group by m.tenant_id
  ), candidates as (
    select t.id, t.slug, t.name, 'trial_3d'::text as kind, pg_catalog.to_char(t.trial_expires_at, 'YYYY-MM-DD') as period, t.trial_expires_at as at
      from public.tenants t where t.plan_id = 'trial' and t.trial_expires_at between pg_catalog.now() + interval '1 day' and pg_catalog.now() + interval '3 days'
    union all
    select t.id, t.slug, t.name, 'trial_1d', pg_catalog.to_char(t.trial_expires_at, 'YYYY-MM-DD'), t.trial_expires_at
      from public.tenants t where t.plan_id = 'trial' and t.trial_expires_at between pg_catalog.now() and pg_catalog.now() + interval '1 day'
    union all
    select t.id, t.slug, t.name, 'trial_ended', pg_catalog.to_char(t.trial_expires_at, 'YYYY-MM-DD'), t.trial_expires_at
      from public.tenants t where t.plan_id = 'trial' and t.trial_expires_at between pg_catalog.now() - interval '3 days' and pg_catalog.now()
    union all
    select t.id, t.slug, t.name, 'payment_failed', pg_catalog.to_char(a.last_failure_at, 'YYYY-MM-DD'), a.grace_until
      from app.billing_accounts a join public.tenants t on t.id = a.tenant_id
     where a.status in ('past_due', 'unpaid') and a.grace_until is not null and a.grace_until > pg_catalog.now()
       and a.grace_until < pg_catalog.now() + interval '3 days'
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('tenant_id', c.id, 'slug', c.slug, 'name', c.name, 'kind', c.kind,
    'period', c.period, 'at', c.at, 'owners', o.emails)), '[]'::jsonb)
  from candidates c join owners o on o.tenant_id = c.id
  where (select t.status from public.tenants t where t.id = c.id) <> 'closed'
    and not exists (select 1 from app.billing_notices n where n.tenant_id = c.id and n.kind = c.kind and n.period = c.period)
$$;

create or replace function public.billing_notice_mark(p_tenant uuid, p_kind text, p_period text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.billing_notices (tenant_id, kind, period) values (p_tenant, p_kind, p_period);
  return true;
exception when unique_violation then
  return false;
end
$$;

revoke all on function public.billing_context(uuid, uuid), public.billing_company(uuid), public.billing_tenant_of_customer(text),
  public.billing_customer_set(uuid, text), public.billing_checkout_add(text, uuid, uuid, text, text, text, bigint, bigint, timestamptz),
  public.billing_checkout_done(text, text), public.billing_event_add(uuid, text, text, bigint, text, text, jsonb),
  public.billing_sync(uuid, text, text, text, text, text, timestamptz, boolean), public.billing_paid(uuid),
  public.billing_enforce_grace(), public.billing_notices_due(), public.billing_notice_mark(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_context(uuid, uuid), public.billing_company(uuid), public.billing_tenant_of_customer(text),
  public.billing_customer_set(uuid, text), public.billing_checkout_add(text, uuid, uuid, text, text, text, bigint, bigint, timestamptz),
  public.billing_checkout_done(text, text), public.billing_event_add(uuid, text, text, bigint, text, text, jsonb),
  public.billing_sync(uuid, text, text, text, text, text, timestamptz, boolean), public.billing_paid(uuid),
  public.billing_enforce_grace(), public.billing_notices_due(), public.billing_notice_mark(uuid, text, text)
  to service_role;
revoke all on function app.billing_events_frozen() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Operator functions (the operator's own token, second sign-in step done: app.require_operator)
-- ---------------------------------------------------------------------------------------------------------------------

-- Billing state of every company, for the operator console. Amounts and dates only, nothing from a company's records.
create or replace function public.operator_billing() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_operator();
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'tenant_id', t.id, 'plan', t.plan_id, 'status', t.status, 'trial_expires_at', t.trial_expires_at,
      'billing_status', coalesce(a.status, 'none'), 'billing', a.billing, 'current_period_end', a.current_period_end,
      'cancel_at_period_end', coalesce(a.cancel_at_period_end, false), 'grace_until', a.grace_until,
      'last_payment_at', a.last_payment_at,
      'paid_cents', (select coalesce(sum(e.amount_cents), 0) from app.billing_events e where e.tenant_id = t.id and e.kind = 'invoice.paid'),
      'open_checkout', (select c.created_at from app.billing_checkouts c where c.tenant_id = t.id and c.status = 'open'
                        and (c.expires_at is null or c.expires_at > pg_catalog.now()) order by c.created_at desc limit 1)))
    from public.tenants t left join app.billing_accounts a on a.tenant_id = t.id
    where t.status <> 'closed'), '[]'::jsonb);
end
$$;
revoke all on function public.operator_billing() from public, anon, service_role;
grant execute on function public.operator_billing() to authenticated;

-- An operator may ask to send a payment link for a company: the server calls this with the operator's token first.
create or replace function public.operator_billing_allowed(p_tenant uuid) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_operator();
  return exists (select 1 from public.tenants t where t.id = p_tenant and t.status <> 'closed');
end
$$;
revoke all on function public.operator_billing_allowed(uuid) from public, anon, service_role;
grant execute on function public.operator_billing_allowed(uuid) to authenticated;

-- A trial converted by hand (paid outside Stripe, or a decision of VYNTEX) still goes through 0065's
-- operator_convert_trial(); a Stripe payment converts it by itself through billing_sync().
