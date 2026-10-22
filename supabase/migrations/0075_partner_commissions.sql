-- 0075 VYNTEX Partner Portal, part 6: the commission ledger and payouts.
--
-- partner.commissions is the ledger: one row per amount earned or taken back, never changed or deleted. Each row keeps
-- the order, the order line, the verified payment that triggered it, the policy version, the base, the rate and a
-- written calculation. A correction is a new row (adjustment, reversal, clawback), never an edit.
-- partner.commission_events holds each row's status history (append only); the latest status is the current one:
--   eligible   the conditions of the policy are met (go-live recorded AND the setup balance verified as paid; for a
--              monthly share, VYNTEX collected that month)
--   approved   a partner_admin approved it for payment
--   payable    it is in an approved payout
--   paid       that payout was settled (a settlement reference was recorded). Never set by a status flag alone.
--   held / disputed / reversed, with a written reason
-- Estimated pay (offers and orders not yet eligible) is never in this ledger.
--
-- Nothing is triggered by an order merely being marked "completed": only verified payments (partner.order_payments,
-- recorded by an administrator with a fresh identity check) and the recorded go-live date.
-- Payout batches: draft -> approved -> sent (method + reference) -> settled (settlement reference) | cancelled. A batch
-- needs the partner's W-9 verified and agreement signed. A commission can be in one live payout only.

alter table partner.orders add column policy_versions uuid[] not null default '{}';

create table partner.commissions (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid not null references partner.organizations (id) on delete restrict,
  order_id          uuid references partner.orders (id) on delete restrict,
  order_line_id     uuid references partner.order_lines (id) on delete restrict,
  payment_id        uuid references partner.order_payments (id) on delete restrict,
  policy_version_id uuid references partner.policy_versions (id) on delete restrict,
  kind              text not null check (kind in ('referral_fee', 'setup_share', 'one_time_share', 'recurring_share', 'adjustment', 'reversal', 'clawback')),
  basis_cents       bigint,
  rate_bps          integer,
  amount_cents      bigint not null,
  period            date,
  calculation       text not null check (pg_catalog.length(calculation) between 1 and 1000),
  reverses          uuid references partner.commissions (id) on delete restrict,
  clawback_until    date,
  reason            text not null default '' check (pg_catalog.length(reason) <= 1000),
  dedupe            text not null unique,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  constraint commissions_sign check ((kind in ('reversal', 'clawback') and amount_cents < 0) or (kind = 'adjustment' and amount_cents <> 0)
                                     or (kind not in ('reversal', 'clawback', 'adjustment') and amount_cents >= 0))
);
create index commissions_partner_idx on partner.commissions (partner_id, created_at desc);
create index commissions_order_idx on partner.commissions (order_id);
create trigger commissions_append_only before update or delete on partner.commissions for each row execute function partner.append_only();

create table partner.commission_events (
  id            bigint generated always as identity primary key,
  commission_id uuid not null references partner.commissions (id) on delete restrict,
  at            timestamptz not null default now(),
  actor         uuid,
  actor_kind    text not null check (actor_kind in ('staff', 'partner', 'system')),
  status        text not null check (status in ('eligible', 'approved', 'payable', 'paid', 'held', 'disputed', 'reversed', 'inquiry', 'reply')),
  note          text not null default '' check (pg_catalog.length(note) <= 2000)
);
create index commission_events_idx on partner.commission_events (commission_id, id desc);
create trigger commission_events_append_only before update or delete on partner.commission_events for each row execute function partner.append_only();

create table partner.payout_batches (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,
  partner_id           uuid not null references partner.organizations (id) on delete restrict,
  status               text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'settled', 'cancelled')),
  total_cents          bigint not null,
  note                 text not null default '' check (pg_catalog.length(note) <= 1000),
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  approved_by          uuid,
  approved_at          timestamptz,
  method               text not null default '' check (pg_catalog.length(method) <= 60),
  reference            text not null default '' check (pg_catalog.length(reference) <= 200),
  sent_on              date,
  sent_by              uuid,
  settlement_reference text not null default '' check (pg_catalog.length(settlement_reference) <= 200),
  settled_on           date,
  settled_by           uuid,
  cancel_reason        text not null default '' check (pg_catalog.length(cancel_reason) <= 400)
);
create index payout_batches_partner_idx on partner.payout_batches (partner_id, created_at desc);

create table partner.payout_lines (
  batch_id      uuid not null references partner.payout_batches (id) on delete restrict,
  commission_id uuid not null references partner.commissions (id) on delete restrict,
  amount_cents  bigint not null,
  active        boolean not null default true,
  primary key (batch_id, commission_id)
);
-- one live payout per commission: no commission is ever paid twice
create unique index payout_lines_once on partner.payout_lines (commission_id) where active;

-- ---------------------------------------------------------------------------------------------------------------------
-- Status
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.commission_status(p_id uuid) returns text
language sql stable security definer
set search_path = ''
as $$ select e.status from partner.commission_events e where e.commission_id = p_id and e.status not in ('inquiry', 'reply') order by e.id desc limit 1 $$;

create or replace function partner.commission_set(p_id uuid, p_status text, p_actor_kind text, p_note text default '') returns void
language sql security definer
set search_path = ''
as $$ insert into partner.commission_events (commission_id, actor, actor_kind, status, note) values (p_id, (select auth.uid()), p_actor_kind, p_status, coalesce(p_note, '')) $$;

/** Adds a ledger row once (by its dedupe key) and marks it eligible. Returns true when it was new. */
create or replace function partner.ledger_add(p_partner uuid, p_order uuid, p_line uuid, p_payment uuid, p_version uuid, p_kind text, p_basis bigint, p_rate integer,
                                             p_amount bigint, p_period date, p_calc text, p_reverses uuid, p_clawback date, p_reason text, p_dedupe text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_amount = 0 and p_kind not in ('adjustment') then return false; end if;
  insert into partner.commissions (partner_id, order_id, order_line_id, payment_id, policy_version_id, kind, basis_cents, rate_bps, amount_cents, period, calculation,
                                   reverses, clawback_until, reason, dedupe, created_by)
  values (p_partner, p_order, p_line, p_payment, p_version, p_kind, p_basis, p_rate, p_amount, p_period, p_calc, p_reverses, p_clawback, coalesce(p_reason, ''), p_dedupe, (select auth.uid()))
  on conflict (dedupe) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  perform partner.commission_set(v_id, 'eligible', 'system', '');
  return true;
end
$$;

create or replace function partner.usd(p_cents bigint) returns text
language sql immutable
set search_path = ''
as $$ select case when p_cents < 0 then '-' else '' end || '$' || pg_catalog.to_char(abs(p_cents) / 100.0, 'FM999,999,990.00') $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The engine: run after every verified payment, go-live, cancellation or refund. Safe to run again (dedupe keys).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.evaluate_order(p_order uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  o partner.orders; l record; v record; pay record; c record;
  v_paid_once bigint; v_paid_all bigint; v_order_once bigint; v_new integer := 0; v_fee bigint := 0; v_fee_version uuid; v_fee_days integer;
  v_amount bigint; v_base bigint; v_versions uuid[];
begin
  select * into o from partner.orders where id = p_order for update;
  if not found then return 0; end if;
  -- the policy versions the order was submitted under; when none was approved then, the ones approved now
  v_versions := o.policy_versions;
  if cardinality(v_versions) = 0 then v_versions := array(select x.id from partner.versions_for(o.partner_id) x); end if;

  select coalesce(sum(amount_cents) filter (where kind in ('deposit', 'balance', 'one_time')), 0), coalesce(sum(amount_cents) filter (where kind in ('deposit', 'balance', 'one_time', 'monthly')), 0)
    into v_paid_once, v_paid_all from partner.order_payments where order_id = o.id;
  v_order_once := o.setup_cents + o.one_time_cents;

  -- 1. one-time pay: go-live recorded, the order active, and the setup and one-time charges paid in full
  if o.live_at is not null and o.status in ('live', 'completed', 'disputed') and v_paid_once >= v_order_once then
    for l in select * from partner.order_lines where order_id = o.id order by line_no loop
      for v in select * from partner.policy_versions pv where pv.id = any (v_versions) and l.item_id = any (pv.applies_to) loop
        if v.model = 'referral_flat_fee' then
          if v.amount_cents > v_fee then v_fee := v.amount_cents; v_fee_version := v.id; v_fee_days := v.clawback_days; end if;
        elsif v.model = 'revenue_share_setup' and l.setup_cents > 0 then
          v_amount := partner.pct(l.setup_cents, v.rate_bps);
          if partner.ledger_add(o.partner_id, o.id, l.id, null, v.id, 'setup_share', l.setup_cents, v.rate_bps, v_amount, null,
               pg_catalog.format('%s%% of setup %s = %s (%s v%s)', pg_catalog.to_char(v.rate_bps / 100.0, 'FM990.00'), partner.usd(l.setup_cents), partner.usd(v_amount), v.policy_id, v.version),
               null, case when v.clawback_days is not null then o.live_at + v.clawback_days end, '', 'setup:' || l.id || ':' || v.id) then v_new := v_new + 1; end if;
        elsif v.model = 'revenue_share_one_time' and l.setup_cents + l.one_time_cents > 0 and v_order_once >= coalesce(v.min_order_cents, 0) then
          v_base := l.setup_cents + l.one_time_cents;
          v_amount := partner.pct(v_base, v.rate_bps);
          if partner.ledger_add(o.partner_id, o.id, l.id, null, v.id, 'one_time_share', v_base, v.rate_bps, v_amount, null,
               pg_catalog.format('%s%% of one-time %s = %s (%s v%s; order %s)', pg_catalog.to_char(v.rate_bps / 100.0, 'FM990.00'), partner.usd(v_base), partner.usd(v_amount), v.policy_id, v.version, partner.usd(v_order_once)),
               null, case when v.clawback_days is not null then o.live_at + v.clawback_days end, '', 'once:' || l.id || ':' || v.id) then v_new := v_new + 1; end if;
        end if;
      end loop;
    end loop;
    if v_fee > 0 then
      select * into v from partner.policy_versions where id = v_fee_version;
      if partner.ledger_add(o.partner_id, o.id, null, null, v.id, 'referral_fee', null, null, v_fee, null,
           pg_catalog.format('Referral fee %s (%s v%s), one per client order', partner.usd(v_fee), v.policy_id, v.version),
           null, case when v_fee_days is not null then o.live_at + v_fee_days end, '', 'fee:' || o.id) then v_new := v_new + 1; end if;
    end if;
  end if;

  -- 2. monthly shares: each month VYNTEX collected, after go-live
  if o.live_at is not null and o.recurring_cents > 0 then
    for pay in select * from partner.order_payments where order_id = o.id and kind = 'monthly' order by period loop
      for l in select * from partner.order_lines where order_id = o.id and recurring_cents > 0 loop
        for v in select * from partner.policy_versions pv where pv.id = any (v_versions) and pv.model = 'revenue_share_recurring' and l.item_id = any (pv.applies_to) loop
          -- the line's part of what was collected, never more than the line's monthly
          v_base := least(l.recurring_cents, (pay.amount_cents * l.recurring_cents * 2 + o.recurring_cents) / (2 * o.recurring_cents));
          v_amount := partner.pct(v_base, v.rate_bps);
          if partner.ledger_add(o.partner_id, o.id, l.id, pay.id, v.id, 'recurring_share', v_base, v.rate_bps, v_amount, pay.period,
               pg_catalog.format('%s%% of %s collected for %s = %s (%s v%s)', pg_catalog.to_char(v.rate_bps / 100.0, 'FM990.00'), partner.usd(v_base), pg_catalog.to_char(pay.period, 'YYYY-MM'), partner.usd(v_amount), v.policy_id, v.version),
               null, null, '', 'month:' || pay.id || ':' || l.id || ':' || v.id) then v_new := v_new + 1; end if;
        end loop;
      end loop;
    end loop;
  end if;

  -- 3. refunds and chargebacks: each earned amount is reduced in proportion to the money returned
  for pay in select * from partner.order_payments where order_id = o.id and kind in ('refund', 'chargeback') order by created_at loop
    for c in select x.*, (x.amount_cents + coalesce((select sum(r.amount_cents) from partner.commissions r where r.reverses = x.id), 0))::bigint as remaining
               from partner.commissions x where x.order_id = o.id and x.amount_cents > 0 and x.kind not in ('adjustment') and x.created_at <= pay.created_at loop
      if c.remaining > 0 and v_paid_all > 0 then
        v_amount := least(c.remaining, (c.amount_cents * pay.amount_cents * 2 + v_paid_all) / (2 * v_paid_all));
        if partner.ledger_add(o.partner_id, o.id, c.order_line_id, pay.id, c.policy_version_id, 'reversal', null, null, -v_amount, c.period,
             pg_catalog.format('%s of %s returned to the client: %s taken back', pay.kind, partner.usd(pay.amount_cents), partner.usd(v_amount)),
             c.id, null, pay.kind || ' ' || pay.reference, 'refund:' || pay.id || ':' || c.id) then v_new := v_new + 1; end if;
      end if;
    end loop;
  end loop;

  -- 4. cancellation inside a clawback window: the rest of the one-time pay is taken back
  if o.status in ('cancelled', 'refunded') and o.ended_at is not null then
    for c in select x.*, (x.amount_cents + coalesce((select sum(r.amount_cents) from partner.commissions r where r.reverses = x.id), 0))::bigint as remaining
               from partner.commissions x where x.order_id = o.id and x.kind in ('referral_fee', 'setup_share', 'one_time_share') and x.clawback_until is not null
                and x.clawback_until >= o.ended_at loop
      if c.remaining > 0 then
        if partner.ledger_add(o.partner_id, o.id, c.order_line_id, null, c.policy_version_id, 'clawback', null, null, -c.remaining, null,
             pg_catalog.format('Client cancelled on %s, inside the window that ended %s: %s taken back', o.ended_at, c.clawback_until, partner.usd(c.remaining)),
             c.id, null, 'cancelled within the clawback window', 'clawback:' || c.id) then v_new := v_new + 1; end if;
      end if;
    end loop;
  end if;

  if v_new > 0 then
    perform partner.order_event(o.id, 'system', 'commission', 'partner', pg_catalog.format('%s commission record(s) added', v_new));
    perform partner.notify('commission.recorded', 'partner', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name, 'count', v_new));
  end if;
  return v_new;
end
$$;

-- Freeze the policy versions on submission (the order keeps the terms it was sold under).
create or replace function partner.order_policies_on_submit() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and old.status = 'draft' then
    new.policy_versions := array(select x.id from partner.versions_for(new.partner_id) x);
  end if;
  return new;
end
$$;
create trigger orders_policies_on_submit before update of status on partner.orders for each row execute function partner.order_policies_on_submit();

-- ---------------------------------------------------------------------------------------------------------------------
-- Reading the ledger
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.commission_json(c partner.commissions, p_staff boolean) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'amount_cents', c.amount_cents, 'basis_cents', c.basis_cents, 'rate_bps', c.rate_bps, 'period', c.period,
    'calculation', c.calculation, 'reason', c.reason, 'clawback_until', c.clawback_until, 'created_at', c.created_at, 'reverses', c.reverses,
    'status', partner.commission_status(c.id),
    'status_at', (select max(e.at) from partner.commission_events e where e.commission_id = c.id and e.status not in ('inquiry', 'reply')),
    'order', (select pg_catalog.jsonb_build_object('id', o.id, 'ref', o.ref, 'client', o.client_name, 'live_at', o.live_at) from partner.orders o where o.id = c.order_id),
    'item', (select l.item -> 'name' from partner.order_lines l where l.id = c.order_line_id),
    'policy', (select pg_catalog.jsonb_build_object('id', v.policy_id, 'version', v.version, 'model', v.model) from partner.policy_versions v where v.id = c.policy_version_id),
    'payout', (select pg_catalog.jsonb_build_object('ref', b.ref, 'status', b.status, 'sent_on', b.sent_on, 'settled_on', b.settled_on, 'method', b.method, 'reference', b.reference)
                 from partner.payout_lines pl join partner.payout_batches b on b.id = pl.batch_id where pl.commission_id = c.id and pl.active),
    'history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', e.at, 'status', e.status, 'note', e.note, 'by', e.actor_kind) order by e.id)
                           from partner.commission_events e where e.commission_id = c.id), '[]'::jsonb))
  || case when p_staff then pg_catalog.jsonb_build_object('partner', (select pg_catalog.jsonb_build_object('id', p.id, 'name', p.display_name, 'code', p.code) from partner.organizations p where p.id = c.partner_id)) else '{}'::jsonb end
$$;

/** The partner's own earnings statement. Staff pass p_as to see one partner's statement exactly as the partner does. */
create or replace function public.partner_commissions(p_as uuid default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare c record; v_partner uuid; v jsonb;
begin
  select * into c from partner.caller();
  if c.kind = 'staff' then v_partner := p_as; if v_partner is null then raise exception 'Choose a partner' using errcode = '22023'; end if;
  else v_partner := c.partner_id; if p_as is not null and p_as <> v_partner then raise exception 'Not allowed' using errcode = '42501'; end if; end if;
  with lines as (select x.*, partner.commission_status(x.id) as st from partner.commissions x where x.partner_id = v_partner)
  select pg_catalog.jsonb_build_object(
    'partner', (select partner.org_json(o, false) from partner.organizations o where o.id = v_partner),
    'totals', pg_catalog.jsonb_build_object(
      'eligible_cents', coalesce((select sum(amount_cents) from lines where st = 'eligible'), 0),
      'approved_cents', coalesce((select sum(amount_cents) from lines where st = 'approved'), 0),
      'payable_cents', coalesce((select sum(amount_cents) from lines where st = 'payable'), 0),
      'paid_cents', coalesce((select sum(amount_cents) from lines where st = 'paid'), 0),
      'held_cents', coalesce((select sum(amount_cents) from lines where st in ('held', 'disputed')), 0),
      'reversed_cents', coalesce((select sum(amount_cents) from lines where kind in ('reversal', 'clawback')), 0),
      'lifetime_cents', coalesce((select sum(amount_cents) from lines where st = 'paid'), 0),
      -- estimates: orders not yet eligible, and accepted offers not yet ordered
      'estimated_once_cents', coalesce((select sum(o.est_once_cents) from partner.orders o where o.partner_id = v_partner
                                          and o.status in ('submitted', 'under_review', 'info_required', 'approved', 'awaiting_payment', 'scheduled', 'in_progress')), 0)
                              + coalesce((select sum(f.est_once_cents) from partner.offers f where f.partner_id = v_partner and f.status = 'accepted'), 0),
      'estimated_monthly_cents', coalesce((select sum(o.est_monthly_cents) from partner.orders o where o.partner_id = v_partner
                                          and o.status in ('submitted', 'under_review', 'info_required', 'approved', 'awaiting_payment', 'scheduled', 'in_progress', 'live', 'completed')), 0)),
    'lines', coalesce((select pg_catalog.jsonb_agg(partner.commission_json(x, false) order by x.created_at desc) from partner.commissions x where x.partner_id = v_partner), '[]'::jsonb),
    'payouts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', b.id, 'ref', b.ref, 'status', b.status, 'total_cents', b.total_cents, 'created_at', b.created_at,
                            'sent_on', b.sent_on, 'method', b.method, 'reference', b.reference, 'settled_on', b.settled_on) order by b.created_at desc)
                         from partner.payout_batches b where b.partner_id = v_partner and b.status <> 'draft'), '[]'::jsonb),
    'policies', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('policy', x.policy_id, 'version', x.version, 'model', x.model, 'amount_cents', x.amount_cents,
                            'rate_bps', x.rate_bps, 'applies_to', x.applies_to, 'min_order_cents', x.min_order_cents, 'clawback_days', x.clawback_days, 'payout_days', x.payout_days,
                            'trigger', x.trigger_rule)) from partner.versions_for(v_partner) x), '[]'::jsonb))
  into v;
  if c.kind = 'staff' then perform partner.audit('staff', v_partner, 'organization', v_partner::text, 'preview.commissions'); end if;
  return v;
end
$$;

/** A partner asks about one of its commission lines. */
create or replace function public.partner_commission_inquiry(p_id uuid, p_note text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid := partner.require_partner(); x partner.commissions;
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_note, ''))) < 3 then raise exception 'Question' using errcode = '22023', hint = 'note_required'; end if;
  select * into x from partner.commissions where id = p_id;
  if not found or x.partner_id <> v_partner then raise exception 'Not found' using errcode = '42501'; end if;
  perform partner.commission_set(x.id, 'inquiry', 'partner', pg_catalog.left(p_note, 2000));
  perform partner.notify('commission.inquiry', 'staff', v_partner, 'commission', x.id, pg_catalog.jsonb_build_object('order', x.order_id));
  return partner.commission_json(x, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Administration of commissions and payouts (partner_admin; money moves need a fresh identity check)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.partner_admin_commissions(p_partner uuid default null, p_status text default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform partner.require_staff();
  return pg_catalog.jsonb_build_object(
    'lines', coalesce((select pg_catalog.jsonb_agg(partner.commission_json(x, true) order by x.created_at desc)
                         from partner.commissions x where (p_partner is null or x.partner_id = p_partner)
                          and (p_status is null or partner.commission_status(x.id) = p_status)), '[]'::jsonb),
    'liability', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('partner_id', p.id, 'partner', p.display_name, 'code', p.code,
                             'payout_eligible', (p.status = 'active' and p.w9_status = 'verified' and p.agreement_status = 'signed'),
                             'eligible_cents', s.eligible, 'approved_cents', s.approved, 'payable_cents', s.payable, 'held_cents', s.held, 'paid_cents', s.paid) order by p.display_name)
                           from partner.organizations p
                           join lateral (select coalesce(sum(x.amount_cents) filter (where partner.commission_status(x.id) = 'eligible'), 0) as eligible,
                                                coalesce(sum(x.amount_cents) filter (where partner.commission_status(x.id) = 'approved'), 0) as approved,
                                                coalesce(sum(x.amount_cents) filter (where partner.commission_status(x.id) = 'payable'), 0) as payable,
                                                coalesce(sum(x.amount_cents) filter (where partner.commission_status(x.id) in ('held', 'disputed')), 0) as held,
                                                coalesce(sum(x.amount_cents) filter (where partner.commission_status(x.id) = 'paid'), 0) as paid
                                           from partner.commissions x where x.partner_id = p.id) s on true), '[]'::jsonb),
    'payouts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) || pg_catalog.jsonb_build_object('partner', p.display_name,
                            'lines', (select count(*) from partner.payout_lines pl where pl.batch_id = b.id and pl.active)) order by b.created_at desc)
                         from partner.payout_batches b join partner.organizations p on p.id = b.partner_id), '[]'::jsonb));
end
$$;

/** approve | hold | release (back to eligible) | dispute | reverse (takes the whole remaining amount back) | reply. */
create or replace function public.partner_admin_commission_set(p_id uuid, p_action text, p_note text default '') returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare x partner.commissions; v_st text; v_rem bigint;
begin
  perform partner.require_staff(true);
  select * into x from partner.commissions where id = p_id;
  if not found then raise exception 'Not found' using errcode = '22023'; end if;
  v_st := partner.commission_status(x.id);
  if p_action <> 'approve' and p_action <> 'reply' and pg_catalog.length(pg_catalog.btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'A reason is required' using errcode = '22023', hint = 'reason_required';
  end if;
  if p_action = 'approve' then
    perform app.require_stepup();
    if v_st <> 'eligible' then raise exception 'Only an eligible line can be approved' using errcode = '22023', hint = 'bad_state'; end if;
    perform partner.commission_set(x.id, 'approved', 'staff', p_note);
  elsif p_action in ('hold', 'dispute') then
    if v_st not in ('eligible', 'approved') then raise exception 'Cannot hold now' using errcode = '22023', hint = 'bad_state'; end if;
    perform partner.commission_set(x.id, case when p_action = 'hold' then 'held' else 'disputed' end, 'staff', p_note);
  elsif p_action = 'release' then
    if v_st not in ('held', 'disputed') then raise exception 'Not held' using errcode = '22023', hint = 'bad_state'; end if;
    perform partner.commission_set(x.id, 'eligible', 'staff', p_note);
  elsif p_action = 'reverse' then
    perform app.require_stepup();
    if v_st in ('payable', 'reversed') or x.amount_cents <= 0 then raise exception 'Cannot reverse now' using errcode = '22023', hint = 'bad_state'; end if;
    v_rem := x.amount_cents + coalesce((select sum(r.amount_cents) from partner.commissions r where r.reverses = x.id), 0);
    if v_rem > 0 then
      perform partner.ledger_add(x.partner_id, x.order_id, x.order_line_id, null, x.policy_version_id, 'reversal', null, null, -v_rem, x.period,
        pg_catalog.format('Reversed by VYNTEX: %s', partner.usd(v_rem)), x.id, null, p_note, 'reverse:' || x.id);
    end if;
    if v_st <> 'paid' then perform partner.commission_set(x.id, 'reversed', 'staff', p_note); end if;
  elsif p_action = 'reply' then
    perform partner.commission_set(x.id, 'reply', 'staff', p_note);
  else
    raise exception 'Action' using errcode = '22023';
  end if;
  perform partner.audit('staff', x.partner_id, 'commission', x.id::text, 'commission.' || p_action, pg_catalog.jsonb_build_object('note', pg_catalog.left(coalesce(p_note, ''), 500)));
  perform partner.notify('commission.' || p_action, 'partner', x.partner_id, 'commission', x.id, '{}'::jsonb);
  return partner.commission_json(x, true);
end
$$;

/** A manual adjustment (positive or negative), with its reason. */
create or replace function public.partner_admin_commission_adjust(p_partner uuid, p_order uuid, p_amount_cents bigint, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid := gen_random_uuid();
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 10000000 then raise exception 'Amount' using errcode = '22023', hint = 'bad_amount'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Reason' using errcode = '22023', hint = 'reason_required'; end if;
  if p_order is not null and not exists (select 1 from partner.orders o where o.id = p_order and o.partner_id = p_partner) then raise exception 'Order' using errcode = '22023'; end if;
  perform partner.ledger_add(p_partner, p_order, null, null, null, 'adjustment', null, null, p_amount_cents, null,
    pg_catalog.format('Adjustment by VYNTEX: %s', partner.usd(p_amount_cents)), null, null, p_reason, 'adjust:' || v_id);
  perform partner.audit('staff', p_partner, 'commission', v_id::text, 'commission.adjusted', pg_catalog.jsonb_build_object('amount_cents', p_amount_cents, 'reason', pg_catalog.left(p_reason, 500)));
  return pg_catalog.jsonb_build_object('ok', true);
end
$$;

/** A payout for one partner: every approved line (deductions included). Needs W-9 verified and agreement signed. */
create or replace function public.partner_admin_payout_create(p_partner uuid, p_note text default '') returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.organizations; v_id uuid; v_total bigint; v_ref text;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  select * into o from partner.organizations where id = p_partner for update;
  if not found then raise exception 'Unknown partner' using errcode = '22023'; end if;
  if o.w9_status <> 'verified' or o.agreement_status <> 'signed' then
    raise exception 'W-9 verified and a signed agreement are required before any payment' using errcode = '22023', hint = 'not_payout_eligible';
  end if;
  select coalesce(sum(x.amount_cents), 0) into v_total from partner.commissions x
   where x.partner_id = p_partner and partner.commission_status(x.id) = 'approved'
     and not exists (select 1 from partner.payout_lines pl where pl.commission_id = x.id and pl.active);
  if v_total <= 0 then raise exception 'Nothing approved to pay' using errcode = '22023', hint = 'nothing_payable'; end if;
  v_ref := partner.next_ref('PO');
  insert into partner.payout_batches (ref, partner_id, total_cents, note, created_by) values (v_ref, p_partner, v_total, pg_catalog.left(coalesce(p_note, ''), 1000), (select auth.uid()))
  returning id into v_id;
  insert into partner.payout_lines (batch_id, commission_id, amount_cents)
  select v_id, x.id, x.amount_cents from partner.commissions x
   where x.partner_id = p_partner and partner.commission_status(x.id) = 'approved'
     and not exists (select 1 from partner.payout_lines pl where pl.commission_id = x.id and pl.active);
  perform partner.audit('staff', p_partner, 'payout', v_id::text, 'payout.created', pg_catalog.jsonb_build_object('total_cents', v_total));
  return pg_catalog.jsonb_build_object('id', v_id, 'ref', v_ref, 'total_cents', v_total);
end
$$;

/** approve | sent (method, reference, date) | settled (settlement reference, date) | cancel (reason). */
create or replace function public.partner_admin_payout_step(p_id uuid, p_step text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare b partner.payout_batches; r record;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  select * into b from partner.payout_batches where id = p_id for update;
  if not found then raise exception 'Unknown payout' using errcode = '22023'; end if;
  if p_step = 'approve' then
    if b.status <> 'draft' then raise exception 'Not a draft' using errcode = '22023', hint = 'bad_state'; end if;
    update partner.payout_batches set status = 'approved', approved_by = (select auth.uid()), approved_at = pg_catalog.now() where id = b.id;
    for r in select commission_id from partner.payout_lines where batch_id = b.id and active loop perform partner.commission_set(r.commission_id, 'payable', 'staff', b.ref); end loop;
  elsif p_step = 'sent' then
    if b.status <> 'approved' then raise exception 'Approve it first' using errcode = '22023', hint = 'bad_state'; end if;
    if coalesce(pg_catalog.btrim(p ->> 'method'), '') = '' or coalesce(pg_catalog.btrim(p ->> 'reference'), '') = '' then
      raise exception 'Method and reference are required' using errcode = '22023', hint = 'reference_required';
    end if;
    update partner.payout_batches set status = 'sent', method = pg_catalog.left(p ->> 'method', 60), reference = pg_catalog.left(p ->> 'reference', 200),
           sent_on = coalesce(nullif(p ->> 'date', '')::date, current_date), sent_by = (select auth.uid()) where id = b.id;
  elsif p_step = 'settled' then
    if b.status <> 'sent' then raise exception 'Mark it sent first' using errcode = '22023', hint = 'bad_state'; end if;
    if coalesce(pg_catalog.btrim(p ->> 'reference'), '') = '' then raise exception 'A settlement reference is required' using errcode = '22023', hint = 'reference_required'; end if;
    update partner.payout_batches set status = 'settled', settlement_reference = pg_catalog.left(p ->> 'reference', 200),
           settled_on = coalesce(nullif(p ->> 'date', '')::date, current_date), settled_by = (select auth.uid()) where id = b.id;
    for r in select commission_id from partner.payout_lines where batch_id = b.id and active loop perform partner.commission_set(r.commission_id, 'paid', 'staff', b.ref); end loop;
  elsif p_step = 'cancel' then
    if b.status not in ('draft', 'approved') then raise exception 'A sent payout cannot be cancelled: record a reversal or adjustment' using errcode = '22023', hint = 'bad_state'; end if;
    if pg_catalog.length(pg_catalog.btrim(coalesce(p ->> 'reason', ''))) < 3 then raise exception 'Reason' using errcode = '22023', hint = 'reason_required'; end if;
    update partner.payout_batches set status = 'cancelled', cancel_reason = pg_catalog.left(p ->> 'reason', 400) where id = b.id;
    for r in select commission_id from partner.payout_lines where batch_id = b.id and active loop
      if b.status = 'approved' then perform partner.commission_set(r.commission_id, 'approved', 'staff', 'Payout ' || b.ref || ' cancelled'); end if;
    end loop;
    -- the lines leave the payout so the commissions can be paid in another one
    update partner.payout_lines set active = false where batch_id = b.id;
  else
    raise exception 'Step' using errcode = '22023';
  end if;
  perform partner.audit('staff', b.partner_id, 'payout', b.id::text, 'payout.' || p_step, coalesce(p, '{}'::jsonb));
  if p_step in ('sent', 'settled') then perform partner.notify('payout.' || p_step, 'partner', b.partner_id, 'payout', b.id, pg_catalog.jsonb_build_object('ref', b.ref, 'total_cents', b.total_cents)); end if;
  return (select pg_catalog.to_jsonb(x) from partner.payout_batches x where x.id = b.id);
end
$$;

/** Weekly figures for the VYNTEX summary email (server only). */
create or replace function public.partner_summary() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'pending_offers', (select count(*) from partner.offers where status = 'pending_approval'),
    'new_orders', (select count(*) from partner.orders where status = 'submitted'),
    'open_orders', (select count(*) from partner.orders where status not in ('draft', 'completed', 'rejected', 'cancelled', 'refunded')),
    'eligible_cents', coalesce((select sum(amount_cents) from partner.commissions x where partner.commission_status(x.id) = 'eligible'), 0),
    'approved_cents', coalesce((select sum(amount_cents) from partner.commissions x where partner.commission_status(x.id) = 'approved'), 0),
    'open_payouts', (select count(*) from partner.payout_batches where status in ('draft', 'approved', 'sent')),
    'overdue', public.partner_orders_overdue(),
    'staff', coalesce((select pg_catalog.jsonb_agg(st.email) from partner.staff st where st.active), '[]'::jsonb))
$$;

revoke all on function public.partner_commissions(uuid), public.partner_commission_inquiry(uuid, text), public.partner_admin_commissions(uuid, text),
  public.partner_admin_commission_set(uuid, text, text), public.partner_admin_commission_adjust(uuid, uuid, bigint, text),
  public.partner_admin_payout_create(uuid, text), public.partner_admin_payout_step(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.partner_commissions(uuid), public.partner_commission_inquiry(uuid, text), public.partner_admin_commissions(uuid, text),
  public.partner_admin_commission_set(uuid, text, text), public.partner_admin_commission_adjust(uuid, uuid, bigint, text),
  public.partner_admin_payout_create(uuid, text), public.partner_admin_payout_step(uuid, text, jsonb) to authenticated;
revoke all on function public.partner_summary() from public, anon, authenticated;
grant execute on function public.partner_summary() to service_role;

select partner.lockdown_check();
select app.lockdown_check();
