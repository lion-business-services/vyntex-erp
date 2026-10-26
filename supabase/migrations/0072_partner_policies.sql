-- 0072 VYNTEX Partner Portal, part 3: the versioned commission-policy engine.
--
-- A policy (for example "referral-flat-150") has numbered versions. Only an APPROVED version is ever used to estimate or
-- calculate a partner's pay. Every policy imported from the Master Command source starts as a draft or needs_approval
-- version (0076): nothing is paid, and no earning is shown as more than "needs VYNTEX approval", until a partner_admin
-- approves a version with a fresh identity check. An approved version is never edited: a change is a new version.
--
-- Which versions apply to a partner:
--   * a partner with negotiated arrangements (partner.policy_assignments) gets exactly its assigned approved versions;
--   * otherwise, the approved versions of the partner's lane (referral or revshare).
-- Calculation rules (the agreement terms, not the legacy code; docs/partners/README.md "Commission engine"):
--   referral_flat_fee        a fixed amount per client order: the highest approved fee among the order's items
--                            (one fee per client deal, as the legacy one-fee-per-lead rule)
--   revenue_share_setup      rate_bps of the setup charge of the covered items
--   revenue_share_one_time   rate_bps of the one-time and setup charges of the covered items, only when the whole
--                            order reaches min_order_cents
--   revenue_share_recurring  rate_bps of each monthly payment VYNTEX actually collected for the covered items
-- Amounts are integer cents. Percentages are basis points. Rounding: half up, to the cent.

create table partner.policies (
  id          text primary key check (id ~ '^[a-z][a-z0-9_-]{1,60}$'),
  name        jsonb not null check (pg_catalog.jsonb_typeof(name) = 'object' and name ? 'en'),
  provenance  jsonb not null default '{}'::jsonb,
  conflicts   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create table partner.policy_versions (
  id              uuid primary key default gen_random_uuid(),
  policy_id       text not null references partner.policies (id) on delete restrict,
  version         integer not null check (version >= 1),
  status          text not null check (status in ('draft', 'needs_approval', 'approved', 'retired')),
  model           text not null check (model in ('referral_flat_fee', 'revenue_share_setup', 'revenue_share_recurring', 'revenue_share_one_time',
                                                 'exclusion', 'rule', 'non_cash_alternative', 'reseller_commission', 'wholesale_margin', 'undefined')),
  lane            text check (lane in ('referral', 'revshare', 'authorized_reseller', 'website_reseller', 'all')),
  amount_cents    bigint check (amount_cents is null or amount_cents >= 0),
  rate_bps        integer check (rate_bps is null or rate_bps between 0 and 10000),
  applies_to      text[] not null default '{}',
  min_order_cents bigint check (min_order_cents is null or min_order_cents >= 0),
  clawback_days   integer check (clawback_days is null or clawback_days between 0 and 730),
  payout_days     integer check (payout_days is null or payout_days between 0 and 120),
  trigger_rule    text not null default '' check (pg_catalog.length(trigger_rule) <= 1000),
  note            text not null default '' check (pg_catalog.length(note) <= 2000),
  terms           jsonb not null default '{}'::jsonb,
  effective_from  date,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  approved_by     uuid,
  approved_at     timestamptz,
  unique (policy_id, version),
  constraint policy_versions_calculable check (
    status <> 'approved' or model not in ('referral_flat_fee', 'revenue_share_setup', 'revenue_share_recurring', 'revenue_share_one_time')
    or (lane in ('referral', 'revshare') and cardinality(applies_to) > 0
        and ((model = 'referral_flat_fee' and amount_cents is not null) or (model <> 'referral_flat_fee' and rate_bps is not null))))
);
create unique index policy_versions_one_approved on partner.policy_versions (policy_id) where status = 'approved';

create or replace function partner.policy_version_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'retired') then raise exception 'An approved policy version is kept' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status = 'approved' and not (new.status = 'retired'
       and (new.model, new.lane, new.amount_cents, new.rate_bps, new.applies_to, new.min_order_cents, new.clawback_days)
           is not distinct from (old.model, old.lane, old.amount_cents, old.rate_bps, old.applies_to, old.min_order_cents, old.clawback_days)) then
    raise exception 'An approved policy version cannot be edited: draft a new version' using errcode = '42501';
  end if;
  if old.status = 'retired' then raise exception 'A retired policy version cannot be edited' using errcode = '42501'; end if;
  return new;
end
$$;
create trigger policy_versions_frozen before update or delete on partner.policy_versions for each row execute function partner.policy_version_frozen();

-- Negotiated arrangements: a partner gets exactly these approved versions.
create table partner.policy_assignments (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid not null references partner.organizations (id) on delete restrict,
  policy_version_id uuid not null references partner.policy_versions (id) on delete restrict,
  note              text not null default '' check (pg_catalog.length(note) <= 1000),
  assigned_by       uuid,
  assigned_at       timestamptz not null default now(),
  ended_at          timestamptz
);
create unique index policy_assignments_open on partner.policy_assignments (partner_id, policy_version_id) where ended_at is null;

-- ---------------------------------------------------------------------------------------------------------------------
-- The engine's reads
-- ---------------------------------------------------------------------------------------------------------------------
/** The approved, calculable versions that apply to a partner. */
create or replace function partner.versions_for(p_partner uuid) returns setof partner.policy_versions
language plpgsql stable security definer
set search_path = ''
as $$
declare v_kind text;
begin
  select o.kind into v_kind from partner.organizations o where o.id = p_partner;
  if v_kind is null then return; end if;
  if exists (select 1 from partner.policy_assignments a where a.partner_id = p_partner and a.ended_at is null) then
    return query select v.* from partner.policy_versions v join partner.policy_assignments a on a.policy_version_id = v.id
                  where a.partner_id = p_partner and a.ended_at is null and v.status = 'approved'
                    and v.model in ('referral_flat_fee', 'revenue_share_setup', 'revenue_share_recurring', 'revenue_share_one_time');
  else
    return query select v.* from partner.policy_versions v
                  where v.status = 'approved' and v.lane = v_kind
                    and v.model in ('referral_flat_fee', 'revenue_share_setup', 'revenue_share_recurring', 'revenue_share_one_time');
  end if;
end
$$;

create or replace function partner.pct(p_base bigint, p_bps integer) returns bigint
language sql immutable
set search_path = ''
as $$ select case when p_base is null or p_bps is null then null
                  when p_base >= 0 then (p_base * p_bps + 5000) / 10000
                  else -((-p_base * p_bps + 5000) / 10000) end $$;

/**
 * What a partner of this lane could earn on one catalog item at its published price: an estimate, per approved policy.
 * status 'approved' when at least one approved version covers the item, else 'needs_approval' (no figure shown).
 */
create or replace function partner.compensation_for(p_kind text, p_partner uuid, p_item text, p_version uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_setup bigint; v_month bigint; v_once bigint; lines jsonb := '[]'::jsonb; r record;
begin
  select coalesce(sum(amount_cents) filter (where kind = 'setup'), 0), coalesce(sum(amount_cents) filter (where kind = 'recurring' and period = 'month' and not optional), 0),
         coalesce(sum(amount_cents) filter (where kind = 'one_time'), 0)
    into v_setup, v_month, v_once
    from partner.catalog_prices where version_id = p_version and status in ('approved_source', 'approved') and amount_cents is not null;
  for r in select * from partner.versions_for(p_partner) v where p_item = any (v.applies_to) order by v.model loop
    lines := lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'policy', r.policy_id, 'version', r.version, 'model', r.model, 'amount_cents', r.amount_cents, 'rate_bps', r.rate_bps,
      'min_order_cents', r.min_order_cents, 'clawback_days', r.clawback_days, 'payout_days', r.payout_days, 'trigger', r.trigger_rule,
      'estimate_cents', case r.model when 'referral_flat_fee' then r.amount_cents
                                     when 'revenue_share_setup' then partner.pct(v_setup, r.rate_bps)
                                     when 'revenue_share_one_time' then partner.pct(v_setup + v_once, r.rate_bps)
                                     when 'revenue_share_recurring' then partner.pct(v_month, r.rate_bps) end,
      'per', case when r.model = 'revenue_share_recurring' then 'month' else 'order' end));
  end loop;
  return pg_catalog.jsonb_build_object('lane', p_kind, 'status', case when pg_catalog.jsonb_array_length(lines) > 0 then 'approved' else 'needs_approval' end,
                                       'estimate', true, 'lines', lines);
end
$$;

/**
 * Estimated pay for a set of priced lines (an offer or an order), by the approved policies of the partner.
 * p_lines: [{ item, setup_cents, one_time_cents, recurring_cents }] (amounts already multiplied by quantity).
 * Returns { once_cents, monthly_cents, covered, uncovered: [items], basis: [...] }. An estimate, never a promise.
 */
create or replace function partner.estimate(p_partner uuid, p_lines jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  r record; x jsonb; v_once bigint := 0; v_month bigint := 0; v_fee bigint := 0; v_fee_policy text;
  v_order_total bigint := 0; basis jsonb := '[]'::jsonb; uncovered text[] := '{}'; covered boolean; v bigint;
begin
  select coalesce(sum(coalesce((e ->> 'setup_cents')::bigint, 0) + coalesce((e ->> 'one_time_cents')::bigint, 0)), 0) into v_order_total
    from pg_catalog.jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e;
  for x in select * from pg_catalog.jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    covered := false;
    for r in select * from partner.versions_for(p_partner) pv where (x ->> 'item') = any (pv.applies_to) loop
      covered := true;
      if r.model = 'referral_flat_fee' then
        if r.amount_cents > v_fee then v_fee := r.amount_cents; v_fee_policy := r.policy_id || ' v' || r.version; end if;
      elsif r.model = 'revenue_share_setup' then
        v := partner.pct(coalesce((x ->> 'setup_cents')::bigint, 0), r.rate_bps); v_once := v_once + v;
        basis := basis || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('item', x ->> 'item', 'policy', r.policy_id, 'version', r.version, 'rate_bps', r.rate_bps, 'base_cents', (x ->> 'setup_cents')::bigint, 'cents', v));
      elsif r.model = 'revenue_share_one_time' then
        if v_order_total >= coalesce(r.min_order_cents, 0) then
          v := partner.pct(coalesce((x ->> 'setup_cents')::bigint, 0) + coalesce((x ->> 'one_time_cents')::bigint, 0), r.rate_bps); v_once := v_once + v;
          basis := basis || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('item', x ->> 'item', 'policy', r.policy_id, 'version', r.version, 'rate_bps', r.rate_bps,
                     'base_cents', coalesce((x ->> 'setup_cents')::bigint, 0) + coalesce((x ->> 'one_time_cents')::bigint, 0), 'cents', v));
        else
          basis := basis || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('item', x ->> 'item', 'policy', r.policy_id, 'version', r.version, 'cents', 0, 'below_minimum', r.min_order_cents));
        end if;
      elsif r.model = 'revenue_share_recurring' then
        v := partner.pct(coalesce((x ->> 'recurring_cents')::bigint, 0), r.rate_bps); v_month := v_month + v;
        basis := basis || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('item', x ->> 'item', 'policy', r.policy_id, 'version', r.version, 'rate_bps', r.rate_bps, 'base_cents', (x ->> 'recurring_cents')::bigint, 'cents', v, 'per', 'month'));
      end if;
    end loop;
    if not covered then uncovered := uncovered || (x ->> 'item'); end if;
  end loop;
  if v_fee > 0 then
    v_once := v_once + v_fee;
    basis := basis || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('policy', v_fee_policy, 'cents', v_fee, 'flat', true));
  end if;
  return pg_catalog.jsonb_build_object('once_cents', v_once, 'monthly_cents', v_month, 'uncovered', pg_catalog.to_jsonb(uncovered), 'basis', basis, 'estimate', true);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Managing policies (administrators only: partner managers never change how partners are paid)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.partner_admin_policies() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform partner.require_staff();
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) || pg_catalog.jsonb_build_object(
      'versions', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) order by v.version desc) from partner.policy_versions v where v.policy_id = p.id),
      'assignments', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', a.id, 'partner', o.display_name, 'partner_id', o.id, 'version', v.version, 'note', a.note, 'assigned_at', a.assigned_at))
                        from partner.policy_assignments a join partner.policy_versions v on v.id = a.policy_version_id join partner.organizations o on o.id = a.partner_id
                       where v.policy_id = p.id and a.ended_at is null)) order by p.id)
    from partner.policies p), '[]'::jsonb);
end
$$;

/** A new draft version of a policy (copy of the latest, with the given changes). */
create or replace function public.partner_admin_policy_draft(p_policy text, p jsonb) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare l partner.policy_versions; v_id uuid;
begin
  perform partner.require_staff(true);
  select * into l from partner.policy_versions where policy_id = p_policy order by version desc limit 1;
  if not found then raise exception 'Unknown policy' using errcode = '22023'; end if;
  delete from partner.policy_versions where policy_id = p_policy and status in ('draft', 'needs_approval')
    and not exists (select 1 from partner.policy_assignments a where a.policy_version_id = partner.policy_versions.id);
  insert into partner.policy_versions (policy_id, version, status, model, lane, amount_cents, rate_bps, applies_to, min_order_cents, clawback_days, payout_days, trigger_rule, note, terms, created_by)
  values (p_policy, (select max(version) + 1 from partner.policy_versions where policy_id = p_policy), 'draft',
          coalesce(p ->> 'model', l.model), coalesce(p ->> 'lane', l.lane),
          case when p ? 'amount_cents' then (p ->> 'amount_cents')::bigint else l.amount_cents end,
          case when p ? 'rate_bps' then (p ->> 'rate_bps')::integer else l.rate_bps end,
          case when p ? 'applies_to' then array(select pg_catalog.jsonb_array_elements_text(p -> 'applies_to')) else l.applies_to end,
          case when p ? 'min_order_cents' then (p ->> 'min_order_cents')::bigint else l.min_order_cents end,
          case when p ? 'clawback_days' then (p ->> 'clawback_days')::integer else l.clawback_days end,
          case when p ? 'payout_days' then (p ->> 'payout_days')::integer else l.payout_days end,
          coalesce(p ->> 'trigger_rule', l.trigger_rule), coalesce(p ->> 'note', l.note), l.terms, (select auth.uid()))
  returning id into v_id;
  perform partner.audit('staff', null, 'policy', p_policy, 'policy.draft_saved', coalesce(p, '{}'::jsonb));
  return v_id;
end
$$;

/** Approves a version: it becomes the one used for this policy from now on. Administrators, fresh identity check. */
create or replace function public.partner_admin_policy_approve(p_version uuid, p_effective date default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v partner.policy_versions;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  select * into v from partner.policy_versions where id = p_version for update;
  if not found or v.status not in ('draft', 'needs_approval') then raise exception 'Only a draft can be approved' using errcode = '22023', hint = 'not_draft'; end if;
  update partner.policy_versions set status = 'retired' where policy_id = v.policy_id and status = 'approved';
  update partner.policy_versions set status = 'approved', approved_by = (select auth.uid()), approved_at = pg_catalog.now(),
         effective_from = coalesce(p_effective, current_date)
   where id = v.id;
  perform partner.audit('staff', null, 'policy', v.policy_id, 'policy.approved',
    pg_catalog.jsonb_build_object('version', v.version, 'model', v.model, 'amount_cents', v.amount_cents, 'rate_bps', v.rate_bps));
  return pg_catalog.jsonb_build_object('policy', v.policy_id, 'version', v.version);
end
$$;

create or replace function public.partner_admin_policy_retire(p_version uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_policy text;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  update partner.policy_versions set status = 'retired' where id = p_version and status = 'approved' returning policy_id into v_policy;
  if v_policy is null then return false; end if;
  perform partner.audit('staff', null, 'policy', v_policy, 'policy.retired');
  return true;
end
$$;

/** A negotiated arrangement: assign (or end) an approved version for one partner. */
create or replace function public.partner_admin_policy_assign(p_partner uuid, p_version uuid, p_assign boolean, p_note text default '') returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  if p_assign then
    if not exists (select 1 from partner.policy_versions where id = p_version and status = 'approved') then
      raise exception 'Only an approved version can be assigned' using errcode = '22023', hint = 'not_approved';
    end if;
    insert into partner.policy_assignments (partner_id, policy_version_id, note, assigned_by) values (p_partner, p_version, pg_catalog.left(coalesce(p_note, ''), 1000), (select auth.uid()))
    on conflict do nothing;
  else
    update partner.policy_assignments set ended_at = pg_catalog.now() where partner_id = p_partner and policy_version_id = p_version and ended_at is null;
  end if;
  perform partner.audit('staff', p_partner, 'policy_assignment', p_version::text, case when p_assign then 'policy.assigned' else 'policy.unassigned' end,
    pg_catalog.jsonb_build_object('note', pg_catalog.left(coalesce(p_note, ''), 1000)));
  return true;
end
$$;

revoke all on function public.partner_admin_policies(), public.partner_admin_policy_draft(text, jsonb), public.partner_admin_policy_approve(uuid, date),
  public.partner_admin_policy_retire(uuid), public.partner_admin_policy_assign(uuid, uuid, boolean, text) from public, anon, service_role;
grant execute on function public.partner_admin_policies(), public.partner_admin_policy_draft(text, jsonb), public.partner_admin_policy_approve(uuid, date),
  public.partner_admin_policy_retire(uuid), public.partner_admin_policy_assign(uuid, uuid, boolean, text) to authenticated;

select partner.lockdown_check();
select app.lockdown_check();
