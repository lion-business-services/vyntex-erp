-- 0082: a card on file to start the seven-day trial (owner decision of November 4, 2026).
--
-- The flow, every step enforced here and not only on screen:
--   1. a visitor asks for a trial (erp.vyntexusa.com/start-trial, api/_lib/trial.js) or an operator invites one (0066);
--      the company waits in 'onboarding', as before
--   2. the owner opens the emailed link, sets a password and the second sign-in step. The company is now
--      'awaiting_card' (was: 'active' with the clock running). app.tenant_open() is false for it, so every
--      workspace read and write is refused by the access rules, exactly as for a paused company
--   3. on the sign-in page the owner picks a plan and adds a card in Stripe Checkout (api/billing.js, trial: true):
--        a priced edition    a subscription with a 7-day Stripe trial: $0 today, the plan starts on day 7 unless the
--                            owner cancels before; a trial with no card on file is cancelled by Stripe, never charged
--        a quoted edition    the card is saved (Checkout setup mode); the trial clock below runs; VYNTEX sends the quote
--   4. Stripe's event, read back from Stripe's API, opens the company: billing_sync (0066) for the subscription, or
--      billing_trial_card_saved below for a saved card. The 7 days start then, not before
--   5. one free trial per card: the card's fingerprint is kept only as a keyed hash (app.trial_cards). A card that
--      already had a trial starts the plan the same day (api/_lib/billing/core.js ends the Stripe trial now)
--   6. reminders 3 days and 1 day before the first charge (billing_notices_due: charge_3d, charge_1d)
-- Companies that were already open keep running as they were. VYNTEX's own workspace (plan 'internal') never waits.
-- ---------------------------------------------------------------------------------------------------------------------

-- the new state of a company: signed up, waiting for the card
alter table public.tenants drop constraint if exists tenants_status_check;
alter table public.tenants add constraint tenants_status_check
  check (status in ('onboarding', 'awaiting_card', 'active', 'suspended', 'closed'));

-- a company waiting for its card is closed to every workspace request (same rule as a paused one)
create or replace function app.tenant_open(p_status text, p_trial_expires_at timestamptz) returns boolean
language sql stable
set search_path = ''
as $$
  select p_status not in ('closed', 'suspended', 'awaiting_card')
     and (p_trial_expires_at is null or p_trial_expires_at > pg_catalog.now())
$$;
revoke all on function app.tenant_open(text, timestamptz) from public, anon;
grant execute on function app.tenant_open(text, timestamptz) to authenticated, service_role;

-- the owner accepting the invitation no longer starts the clock: the company waits for the card
create or replace function app.trial_start_on_owner() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.role = 'owner' and new.status = 'active' then
    update public.tenants t set status = 'awaiting_card'
      where t.id = new.tenant_id and t.status = 'onboarding'
       and t.plan_id = 'trial' and t.trial_started_at is null
       and exists (select 1 from app.trial_registrations r where r.tenant_id = t.id and r.started_at is null);
    if found then
      perform app.security_event(new.tenant_id, null, 'trial.awaiting_card', 'info', null, '{}'::jsonb);
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.trial_start_on_owner() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- One free trial per card. Only a keyed hash of Stripe's card fingerprint is kept (made by the server with its own
-- secret): no card number, no fingerprint itself, nothing a reader of the table could use.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists app.trial_cards (
  card_hash  text primary key check (card_hash ~ '^[0-9a-f]{64}$'),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now()
);
alter table app.trial_cards enable row level security;
revoke all on app.trial_cards from public, anon, authenticated;

-- 'new' the first time a card starts a trial (it is remembered for that company), 'same' when it is the same company
-- again, 'reused' when another company already had a trial with this card
create or replace function public.billing_trial_card(p_tenant uuid, p_card_hash text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare v_owner uuid;
begin
  if p_tenant is null or p_card_hash is null or p_card_hash !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  insert into app.trial_cards (card_hash, tenant_id) values (p_card_hash, p_tenant) on conflict (card_hash) do nothing;
  select c.tenant_id into v_owner from app.trial_cards c where c.card_hash = p_card_hash;
  if v_owner = p_tenant then
    return case when exists (select 1 from app.trial_registrations r where r.tenant_id = p_tenant and r.started_at is not null) then 'same' else 'new' end;
  end if;
  perform app.security_event(p_tenant, null, 'trial.card_reused', 'denied', null, '{}'::jsonb);
  return 'reused';
end
$$;
revoke all on function public.billing_trial_card(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_trial_card(uuid, text) to service_role;

-- The trial has started: the card is on file. p_until is when the free days end (Stripe's trial end, or 168 hours from
-- now for a saved card). A company waiting for its card opens; the registration is marked started (one trial per email).
--   p_clock  true for a saved card (quoted edition): the company keeps plan 'trial' with the 168-hour clock
--            false for a Stripe trial: billing_sync (0066) has already given the company its plan and opened it
create or replace function public.billing_trial_started(p_tenant uuid, p_until timestamptz, p_clock boolean) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_status text;
begin
  select t.status into v_status from public.tenants t where t.id = p_tenant for update;
  if v_status is null or v_status = 'closed' then return false; end if;
  if p_clock then
    update public.tenants t set status = 'active', trial_started_at = coalesce(t.trial_started_at, pg_catalog.now()),
        trial_expires_at = least(coalesce(p_until, pg_catalog.now() + interval '168 hours'), pg_catalog.now() + interval '168 hours')
      where t.id = p_tenant and t.status = 'awaiting_card' and t.plan_id = 'trial';
  else
    update public.tenants t set trial_started_at = coalesce(t.trial_started_at, pg_catalog.now()),
        status = case when t.status = 'awaiting_card' then 'active' else t.status end
      where t.id = p_tenant;
  end if;
  update app.trial_registrations r set started_at = coalesce(r.started_at, pg_catalog.now()) where r.tenant_id = p_tenant;
  perform app.security_event(p_tenant, null, 'trial.started', 'ok', null,
    pg_catalog.jsonb_build_object('until', p_until, 'card_saved_only', p_clock));
  return true;
end
$$;
revoke all on function public.billing_trial_started(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.billing_trial_started(uuid, timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Reminders. 0066's list, plus the two notices before a Stripe trial turns into the first charge:
--   charge_3d  1 to 3 days before          charge_1d  within the last day
-- (`at` is the end of the free days, read from the subscription; the amount is priced by the server from the plan)
-- ---------------------------------------------------------------------------------------------------------------------
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
    select t.id, t.slug, t.name, 'charge_3d', pg_catalog.to_char(a.current_period_end, 'YYYY-MM-DD'), a.current_period_end
      from app.billing_accounts a join public.tenants t on t.id = a.tenant_id
     where a.status = 'trialing' and not a.cancel_at_period_end
       and a.current_period_end between pg_catalog.now() + interval '1 day' and pg_catalog.now() + interval '3 days'
    union all
    select t.id, t.slug, t.name, 'charge_1d', pg_catalog.to_char(a.current_period_end, 'YYYY-MM-DD'), a.current_period_end
      from app.billing_accounts a join public.tenants t on t.id = a.tenant_id
     where a.status = 'trialing' and not a.cancel_at_period_end
       and a.current_period_end between pg_catalog.now() and pg_catalog.now() + interval '1 day'
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
revoke all on function public.billing_notices_due() from public, anon, authenticated;
grant execute on function public.billing_notices_due() to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The second sign-in step is still required while the company waits for its card. app.member_role() is empty for a
-- company that is not open (that is what keeps the workspace closed), so the requirement is read from the membership
-- of a company waiting for its card directly: the owner sets up the authenticator before adding the card.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.mfa_needed(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(coalesce(app.member_role(p_tenant), (
      select m.role from public.tenant_members m join public.tenants t on t.id = m.tenant_id
       where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active' and t.status = 'awaiting_card'))
    = any (app.mfa_roles(p_tenant)), false) or app.has_verified_factor()
$$;
