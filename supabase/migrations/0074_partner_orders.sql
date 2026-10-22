-- 0074 VYNTEX Partner Portal, part 5: client orders, their state machine, the activity history, notifications.
--
-- States (docs/partners/README.md "Order workflow"):
--   draft -> submitted -> under_review -> info_required <-> under_review -> approved -> awaiting_payment -> scheduled
--   -> in_progress -> live -> completed;  exceptions: rejected, cancelled, disputed, refunded.
-- A partner may only submit, withdraw a draft or a just-submitted order, and answer an information request.
-- Every other move is VYNTEX's, and every move is written to the order's history (append only) with who made it.
-- Partners never mark an order approved, paid, live or commission-eligible. Payments are recorded by a partner_admin
-- (with a fresh identity check) as verified financial events; only those, plus go-live, feed the commission engine (0075).
--
-- Notifications go to an outbox (partner.notifications). The server sends them by email through Resend (job
-- partner.notify) and records the provider's answer; a row is "sent" only when Resend accepted it.

create table partner.notifications (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind ~ '^[a-z][a-z0-9_.]{2,60}$'),
  audience    text not null check (audience in ('staff', 'partner')),
  partner_id  uuid references partner.organizations (id) on delete restrict,
  entity      text not null default '',
  entity_id   uuid,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts    integer not null default 0,
  last_error  text not null default '' check (pg_catalog.length(last_error) <= 200),
  provider_id text not null default '' check (pg_catalog.length(provider_id) <= 200),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz
);
create index partner_notifications_due on partner.notifications (status, created_at) where status in ('queued', 'sending');

create or replace function partner.notify(p_kind text, p_audience text, p_partner uuid, p_entity text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb) returns void
language sql security definer
set search_path = ''
as $$
  insert into partner.notifications (kind, audience, partner_id, entity, entity_id, payload)
  values (p_kind, p_audience, p_partner, coalesce(p_entity, ''), p_entity_id, coalesce(p_payload, '{}'::jsonb))
$$;

create table partner.orders (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,
  partner_id      uuid not null references partner.organizations (id) on delete restrict,
  offer_id        uuid unique references partner.offers (id) on delete restrict,
  created_by      uuid not null,
  idem_key        text check (idem_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  status          text not null default 'draft' check (status in ('draft', 'submitted', 'under_review', 'info_required', 'approved', 'awaiting_payment',
                                                                 'scheduled', 'in_progress', 'live', 'completed', 'rejected', 'cancelled', 'disputed', 'refunded')),
  client_name     text not null check (pg_catalog.length(pg_catalog.btrim(client_name)) between 1 and 200),
  client_key      text not null,
  contact_name    text not null default '' check (pg_catalog.length(contact_name) <= 200),
  contact_email   text not null default '' check (contact_email = '' or (contact_email = pg_catalog.lower(contact_email) and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  contact_phone   text not null default '' check (pg_catalog.length(contact_phone) <= 40),
  industry        text not null default '' check (pg_catalog.length(industry) <= 80),
  lead_source     text not null default '' check (pg_catalog.length(lead_source) <= 200),
  timeline        text not null default '' check (pg_catalog.length(timeline) <= 400),
  requirements    text not null default '' check (pg_catalog.length(requirements) <= 4000),
  consent         boolean not null default false,
  consent_note    text not null default '' check (pg_catalog.length(consent_note) <= 400),
  setup_cents     bigint not null default 0,
  one_time_cents  bigint not null default 0,
  recurring_cents bigint not null default 0,
  deposit_cents   bigint not null default 0,
  est_once_cents  bigint,
  est_monthly_cents bigint,
  estimate        jsonb not null default '{}'::jsonb,
  duplicate_of    uuid references partner.orders (id) on delete restrict,
  attribution     text not null default 'clear' check (attribution in ('clear', 'possible_duplicate', 'conflict', 'confirmed')),
  assigned_to     uuid,
  next_action     text not null default '' check (pg_catalog.length(next_action) <= 400),
  follow_up_at    date,
  partner_follow_up_at date,
  live_at         date,
  ended_at        date,
  created_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  updated_at      timestamptz not null default now(),
  unique (partner_id, idem_key)
);
create index orders_partner_idx on partner.orders (partner_id, created_at desc);
create index orders_status_idx on partner.orders (status, updated_at desc);
create index orders_client_key_idx on partner.orders (client_key);
create trigger orders_touch before update on partner.orders for each row execute function partner.touch();

create table partner.order_lines (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references partner.orders (id) on delete restrict,
  line_no         integer not null,
  item_id         text not null references partner.catalog_items (id) on delete restrict,
  version_id      uuid not null references partner.catalog_versions (id) on delete restrict,
  quantity        integer not null check (quantity between 1 and 50),
  setup_cents     bigint not null default 0 check (setup_cents >= 0),
  one_time_cents  bigint not null default 0 check (one_time_cents >= 0),
  recurring_cents bigint not null default 0 check (recurring_cents >= 0),
  deposit_cents   bigint not null default 0 check (deposit_cents >= 0),
  item            jsonb not null,
  unique (order_id, line_no)
);
create trigger order_lines_append_only before update or delete on partner.order_lines for each row execute function partner.append_only();

create table partner.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references partner.orders (id) on delete restrict,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_kind  text not null check (actor_kind in ('staff', 'partner', 'system')),
  kind        text not null check (kind in ('created', 'status', 'message', 'note', 'assignment', 'payment', 'follow_up', 'attribution', 'commission')),
  from_status text,
  to_status   text,
  visibility  text not null check (visibility in ('partner', 'internal')),
  body        text not null default '' check (pg_catalog.length(body) <= 4000),
  detail      jsonb not null default '{}'::jsonb
);
create index order_events_order_idx on partner.order_events (order_id, at);
create trigger order_events_append_only before update or delete on partner.order_events for each row execute function partner.append_only();

-- Verified money in or out for an order, recorded by a partner_admin. The only input of the commission engine besides go-live.
create table partner.order_payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references partner.orders (id) on delete restrict,
  kind         text not null check (kind in ('deposit', 'balance', 'one_time', 'monthly', 'refund', 'chargeback')),
  amount_cents bigint not null check (amount_cents > 0),
  period       date,
  received_on  date not null,
  method       text not null default '' check (pg_catalog.length(method) <= 60),
  reference    text not null check (pg_catalog.length(pg_catalog.btrim(reference)) between 1 and 200),
  note         text not null default '' check (pg_catalog.length(note) <= 1000),
  recorded_by  uuid not null,
  created_at   timestamptz not null default now(),
  constraint order_payments_period check ((kind = 'monthly') = (period is not null)),
  unique (order_id, kind, reference)
);
create unique index order_payments_one_month on partner.order_payments (order_id, period) where kind = 'monthly';
create trigger order_payments_append_only before update or delete on partner.order_payments for each row execute function partner.append_only();

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function partner.client_key(p_name text, p_email text) returns text
language sql immutable
set search_path = ''
as $$ select case when coalesce(pg_catalog.btrim(p_email), '') <> '' then 'e:' || pg_catalog.lower(pg_catalog.btrim(p_email))
                  else 'n:' || pg_catalog.regexp_replace(pg_catalog.lower(coalesce(p_name, '')), '[^a-z0-9]+', '', 'g') end $$;

create or replace function partner.order_event(p_order uuid, p_actor_kind text, p_kind text, p_visibility text, p_body text default '',
                                               p_from text default null, p_to text default null, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer
set search_path = ''
as $$
  insert into partner.order_events (order_id, actor, actor_kind, kind, from_status, to_status, visibility, body, detail)
  values (p_order, (select auth.uid()), p_actor_kind, p_kind, p_from, p_to, p_visibility, coalesce(p_body, ''), coalesce(p_detail, '{}'::jsonb))
$$;

/** The moves each side may make. */
create or replace function partner.order_move_allowed(p_from text, p_to text, p_side text) returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_side
    when 'partner' then (p_from, p_to) in (('draft', 'submitted'), ('draft', 'cancelled'), ('submitted', 'cancelled'), ('info_required', 'under_review'))
    when 'staff' then (p_from, p_to) in (
      ('submitted', 'under_review'), ('submitted', 'info_required'), ('submitted', 'rejected'),
      ('under_review', 'info_required'), ('under_review', 'approved'), ('under_review', 'rejected'),
      ('info_required', 'under_review'), ('info_required', 'rejected'), ('info_required', 'cancelled'),
      ('approved', 'awaiting_payment'), ('approved', 'cancelled'),
      ('awaiting_payment', 'scheduled'), ('awaiting_payment', 'in_progress'), ('awaiting_payment', 'cancelled'), ('awaiting_payment', 'refunded'),
      ('scheduled', 'in_progress'), ('scheduled', 'cancelled'), ('scheduled', 'refunded'),
      ('in_progress', 'live'), ('in_progress', 'cancelled'), ('in_progress', 'refunded'),
      ('live', 'completed'), ('live', 'cancelled'), ('live', 'disputed'), ('live', 'refunded'),
      ('completed', 'disputed'), ('completed', 'cancelled'), ('completed', 'refunded'),
      ('disputed', 'live'), ('disputed', 'completed'), ('disputed', 'cancelled'), ('disputed', 'refunded'))
    else false end
$$;

/** The order as the caller may see it. Partners: no internal notes, no internal assignment detail. */
create or replace function partner.order_json(p_order uuid, p_staff boolean) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', o.id, 'ref', o.ref, 'status', o.status, 'offer_id', o.offer_id,
    'partner', pg_catalog.jsonb_build_object('id', p.id, 'name', p.display_name, 'code', p.code, 'kind', p.kind),
    'client_name', o.client_name, 'contact_name', o.contact_name, 'contact_email', o.contact_email, 'contact_phone', o.contact_phone,
    'industry', o.industry, 'lead_source', o.lead_source, 'timeline', o.timeline, 'requirements', o.requirements, 'consent', o.consent, 'consent_note', o.consent_note,
    'setup_cents', o.setup_cents, 'one_time_cents', o.one_time_cents, 'recurring_cents', o.recurring_cents, 'deposit_cents', o.deposit_cents,
    'est_once_cents', o.est_once_cents, 'est_monthly_cents', o.est_monthly_cents, 'estimate', o.estimate,
    'next_action', o.next_action, 'follow_up_at', o.follow_up_at, 'partner_follow_up_at', o.partner_follow_up_at, 'live_at', o.live_at,
    'assigned', (select pg_catalog.jsonb_build_object('name', coalesce(nullif(s.name, ''), s.email)) from partner.staff s where s.user_id = o.assigned_to),
    'created_at', o.created_at, 'submitted_at', o.submitted_at, 'updated_at', o.updated_at,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item', l.item_id, 'name', l.item -> 'name', 'quantity', l.quantity,
               'setup_cents', l.setup_cents, 'one_time_cents', l.one_time_cents, 'recurring_cents', l.recurring_cents) order by l.line_no)
             from partner.order_lines l where l.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', e.at, 'kind', e.kind, 'actor_kind', e.actor_kind, 'from', e.from_status,
               'to', e.to_status, 'body', e.body, 'visibility', e.visibility) order by e.at)
             from partner.order_events e where e.order_id = o.id and (p_staff or e.visibility = 'partner')), '[]'::jsonb),
    'payments', case when p_staff then coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.received_on, x.created_at) from partner.order_payments x where x.order_id = o.id), '[]'::jsonb)
                     else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', x.kind, 'amount_cents', x.amount_cents, 'period', x.period, 'received_on', x.received_on) order by x.received_on)
                                      from partner.order_payments x where x.order_id = o.id), '[]'::jsonb) end)
  || case when p_staff then pg_catalog.jsonb_build_object('attribution', o.attribution, 'duplicate_of',
          (select pg_catalog.jsonb_build_object('id', d.id, 'ref', d.ref, 'partner', dp.display_name, 'submitted_at', d.submitted_at)
             from partner.orders d join partner.organizations dp on dp.id = d.partner_id where d.id = o.duplicate_of),
          'assigned_to', o.assigned_to, 'client_key', o.client_key) else '{}'::jsonb end
  from partner.orders o join partner.organizations p on p.id = o.partner_id where o.id = p_order
$$;

create or replace function partner.order_for_caller(p_order uuid) returns record
language plpgsql stable security definer
set search_path = ''
as $$
declare c record; v_partner uuid; r record;
begin
  select * into c from partner.caller();
  select o.partner_id into v_partner from partner.orders o where o.id = p_order;
  if v_partner is null or (c.kind = 'partner' and v_partner <> c.partner_id) then raise exception 'Order not found' using errcode = '42501'; end if;
  select c.kind as kind, c.role as role, v_partner as partner_id into r;
  return r;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- What partners call
-- ---------------------------------------------------------------------------------------------------------------------
/**
 * A new order, as a draft (p.submit = true submits it at once). From an accepted offer (p.offer_id: its lines and prices
 * are copied, nothing retyped) or from catalog items at their published prices (p.lines: [{ item, quantity }]; quote-only
 * items go through an offer instead). p.idem_key makes a retried submission return the same order.
 */
create or replace function public.partner_order_create(p jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_partner uuid := partner.require_partner();
  v_id uuid; o partner.offers; x jsonb; v record; v_n integer := 0; v_lines jsonb := '[]'::jsonb; est jsonb;
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p ->> 'contact_email', '')));
  v_idem text := nullif(p ->> 'idem_key', '');
begin
  if v_idem is not null then
    select id into v_id from partner.orders where partner_id = v_partner and idem_key = v_idem;
    if v_id is not null then return partner.order_json(v_id, false); end if;
  end if;
  if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'Email' using errcode = '22023', hint = 'bad_email'; end if;
  if (p ->> 'offer_id') is not null then
    select * into o from partner.offers where id = (p ->> 'offer_id')::uuid for update;
    if not found or o.partner_id <> v_partner then raise exception 'Offer not found' using errcode = '42501'; end if;
    if o.status <> 'accepted' then raise exception 'Only an accepted offer becomes an order' using errcode = '22023', hint = 'offer_not_accepted'; end if;
  end if;
  if coalesce(pg_catalog.btrim(coalesce(nullif(pg_catalog.btrim(p ->> 'client_name'), ''), o.client_name)), '') = '' then raise exception 'Client' using errcode = '22023', hint = 'client_required'; end if;
  if coalesce(pg_catalog.btrim(p ->> 'contact_name'), '') = '' then raise exception 'Contact' using errcode = '22023', hint = 'contact_required'; end if;
  if v_email = '' and coalesce(pg_catalog.btrim(p ->> 'contact_phone'), '') = '' then raise exception 'Email or phone' using errcode = '22023', hint = 'contact_way_required'; end if;
  if not coalesce((p ->> 'consent')::boolean, false) then raise exception 'The client must agree to be contacted by VYNTEX' using errcode = '22023', hint = 'consent_required'; end if;
  insert into partner.orders (ref, partner_id, offer_id, created_by, idem_key, client_name, client_key, contact_name, contact_email, contact_phone, industry, lead_source,
                              timeline, requirements, consent, consent_note)
  values (partner.next_ref('OR'), v_partner, o.id, (select auth.uid()), v_idem, pg_catalog.left(pg_catalog.btrim(coalesce(nullif(pg_catalog.btrim(p ->> 'client_name'), ''), o.client_name)), 200),
          partner.client_key(coalesce(nullif(pg_catalog.btrim(p ->> 'client_name'), ''), o.client_name), v_email),
          pg_catalog.left(pg_catalog.btrim(p ->> 'contact_name'), 200), v_email, pg_catalog.left(coalesce(p ->> 'contact_phone', ''), 40),
          pg_catalog.left(coalesce(nullif(p ->> 'industry', ''), o.industry, ''), 80), pg_catalog.left(coalesce(p ->> 'lead_source', ''), 200),
          pg_catalog.left(coalesce(p ->> 'timeline', ''), 400), pg_catalog.left(coalesce(nullif(p ->> 'requirements', ''), o.requirements, ''), 4000),
          true, pg_catalog.left(coalesce(p ->> 'consent_note', ''), 400))
  returning id into v_id;
  if o.id is not null then
    insert into partner.order_lines (order_id, line_no, item_id, version_id, quantity, setup_cents, one_time_cents, recurring_cents, deposit_cents, item)
    select v_id, l.line_no, l.item_id, l.version_id, l.quantity, l.setup_cents, l.one_time_cents, l.recurring_cents, l.deposit_cents, l.item
      from partner.offer_lines l where l.offer_id = o.id;
    update partner.offers set status = 'ordered', order_id = v_id where id = o.id;
    perform partner.offer_event(o.id, 'partner', 'ordered');
  else
    if pg_catalog.jsonb_typeof(p -> 'lines') <> 'array' or pg_catalog.jsonb_array_length(p -> 'lines') = 0 or pg_catalog.jsonb_array_length(p -> 'lines') > 30 then
      raise exception 'Choose the services' using errcode = '22023', hint = 'no_lines';
    end if;
    for x in select * from pg_catalog.jsonb_array_elements(p -> 'lines') loop
      v_n := v_n + 1;
      select cv.* into v from partner.catalog_versions cv join partner.catalog_items ci on ci.id = cv.item_id
       where cv.item_id = x ->> 'item' and cv.status = 'published' and ci.active;
      if not found then raise exception 'Not in the published catalog' using errcode = '22023', hint = 'unknown_item'; end if;
      if not coalesce(partner.version_priced(v.id), false) then raise exception 'A quoted service needs an offer approved by VYNTEX first' using errcode = '22023', hint = 'quote_item'; end if;
      insert into partner.order_lines (order_id, line_no, item_id, version_id, quantity, setup_cents, one_time_cents, recurring_cents, deposit_cents, item)
      select v_id, v_n, v.item_id, v.id, q.n,
             q.n * coalesce((select sum(amount_cents) from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'setup' and not cp.optional), 0),
             q.n * coalesce((select sum(amount_cents) from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'one_time' and not cp.optional), 0),
             q.n * coalesce((select sum(amount_cents) from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'recurring' and cp.period = 'month' and not cp.optional), 0),
             q.n * coalesce((select amount_cents from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'deposit' and cp.status in ('approved_source', 'approved') limit 1), 0),
             pg_catalog.jsonb_build_object('name', v.name, 'version', v.version)
        from (select greatest(1, least(coalesce((x ->> 'quantity')::integer, 1), 50)) as n) q;
    end loop;
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item', l.item_id, 'setup_cents', l.setup_cents, 'one_time_cents', l.one_time_cents, 'recurring_cents', l.recurring_cents))
    into v_lines from partner.order_lines l where l.order_id = v_id;
  est := partner.estimate(v_partner, v_lines);
  update partner.orders set
    setup_cents = (select coalesce(sum(setup_cents), 0) from partner.order_lines where order_id = v_id),
    one_time_cents = (select coalesce(sum(one_time_cents), 0) from partner.order_lines where order_id = v_id),
    recurring_cents = (select coalesce(sum(recurring_cents), 0) from partner.order_lines where order_id = v_id),
    deposit_cents = (select coalesce(sum(deposit_cents), 0) from partner.order_lines where order_id = v_id),
    estimate = est, est_once_cents = (est ->> 'once_cents')::bigint, est_monthly_cents = (est ->> 'monthly_cents')::bigint
  where id = v_id;
  perform partner.order_event(v_id, 'partner', 'created', 'partner', '', null, 'draft');
  perform partner.audit('partner', v_partner, 'order', v_id::text, 'order.created', pg_catalog.jsonb_build_object('from_offer', o.id is not null));
  if coalesce((p ->> 'submit')::boolean, false) then return public.partner_order_submit(v_id); end if;
  return partner.order_json(v_id, false);
end
$$;

/** Submits a draft. Attribution: the first partner to submit a client keeps it for 90 days (approved rule "attribution"). */
create or replace function public.partner_order_submit(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid := partner.require_partner(); o partner.orders; d partner.orders;
begin
  select * into o from partner.orders where id = p_id for update;
  if not found or o.partner_id <> v_partner then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.status <> 'draft' then raise exception 'Already submitted' using errcode = '22023', hint = 'bad_state'; end if;
  select * into d from partner.orders x where x.client_key = o.client_key and x.id <> o.id and x.status not in ('draft', 'rejected', 'cancelled')
     and x.submitted_at > pg_catalog.now() - interval '90 days' order by x.submitted_at limit 1;
  update partner.orders set status = 'submitted', submitted_at = pg_catalog.now(), duplicate_of = d.id,
         attribution = case when d.id is null then 'clear' when d.partner_id = o.partner_id then 'possible_duplicate' else 'conflict' end
   where id = o.id;
  perform partner.order_event(o.id, 'partner', 'status', 'partner', '', 'draft', 'submitted');
  if d.id is not null then
    perform partner.order_event(o.id, 'system', 'attribution', 'internal',
      case when d.partner_id = o.partner_id then 'Possible duplicate of ' || d.ref else 'Attribution conflict: ' || d.ref || ' was submitted first by another partner' end);
  end if;
  perform partner.notify('order.submitted', 'staff', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name, 'conflict', d.id is not null));
  perform partner.notify('order.received', 'partner', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  perform partner.audit('partner', o.partner_id, 'order', o.id::text, 'order.submitted');
  return partner.order_json(o.id, false);
end
$$;

/** A message on an order. When VYNTEX asked for information, the answer sends the order back to review. */
create or replace function public.partner_order_message(p_id uuid, p_body text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid := partner.require_partner(); o partner.orders;
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_body, ''))) < 1 or pg_catalog.length(p_body) > 4000 then raise exception 'Message' using errcode = '22023', hint = 'bad_message'; end if;
  select * into o from partner.orders where id = p_id for update;
  if not found or o.partner_id <> v_partner then raise exception 'Order not found' using errcode = '42501'; end if;
  perform partner.order_event(o.id, 'partner', 'message', 'partner', p_body);
  if o.status = 'info_required' then
    update partner.orders set status = 'under_review' where id = o.id;
    perform partner.order_event(o.id, 'partner', 'status', 'partner', '', 'info_required', 'under_review');
  end if;
  perform partner.notify('order.partner_message', 'staff', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  return partner.order_json(o.id, false);
end
$$;

/** Withdraws a draft or a just-submitted order. */
create or replace function public.partner_order_cancel(p_id uuid, p_reason text default '') returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid := partner.require_partner(); o partner.orders;
begin
  select * into o from partner.orders where id = p_id for update;
  if not found or o.partner_id <> v_partner then raise exception 'Order not found' using errcode = '42501'; end if;
  if not partner.order_move_allowed(o.status, 'cancelled', 'partner') then raise exception 'Ask VYNTEX to cancel it' using errcode = '22023', hint = 'bad_state'; end if;
  update partner.orders set status = 'cancelled' where id = o.id;
  perform partner.order_event(o.id, 'partner', 'status', 'partner', p_reason, o.status, 'cancelled');
  if o.status <> 'draft' then perform partner.notify('order.withdrawn', 'staff', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name)); end if;
  return partner.order_json(o.id, false);
end
$$;

create or replace function public.partner_order_follow_up(p_id uuid, p_date date) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_partner uuid := partner.require_partner();
begin
  update partner.orders set partner_follow_up_at = p_date where id = p_id and partner_id = v_partner;
  if not found then raise exception 'Order not found' using errcode = '42501'; end if;
  return partner.order_json(p_id, false);
end
$$;

create or replace function public.partner_orders(p_status text default null, p_partner uuid default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare c record;
begin
  select * into c from partner.caller();
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'ref', o.ref, 'status', o.status, 'client_name', o.client_name, 'partner', p.display_name,
             'services', (select pg_catalog.string_agg(l.item -> 'name' ->> 'en', ', ' order by l.line_no) from partner.order_lines l where l.order_id = o.id),
             'setup_cents', o.setup_cents, 'one_time_cents', o.one_time_cents, 'recurring_cents', o.recurring_cents, 'est_once_cents', o.est_once_cents, 'est_monthly_cents', o.est_monthly_cents,
             'submitted_at', o.submitted_at, 'created_at', o.created_at, 'updated_at', o.updated_at, 'next_action', o.next_action,
             'follow_up_at', case when c.kind = 'staff' then o.follow_up_at else o.partner_follow_up_at end,
             'last_update', (select e.at from partner.order_events e where e.order_id = o.id and (c.kind = 'staff' or e.visibility = 'partner') order by e.at desc limit 1))
           || case when c.kind = 'staff' then pg_catalog.jsonb_build_object('attribution', o.attribution, 'assigned_to', o.assigned_to) else '{}'::jsonb end
           order by o.updated_at desc)
    from partner.orders o join partner.organizations p on p.id = o.partner_id
    where (c.kind = 'staff' or o.partner_id = c.partner_id) and (p_status is null or o.status = p_status)
      and (p_partner is null or c.kind <> 'staff' or o.partner_id = p_partner)), '[]'::jsonb);
end
$$;

create or replace function public.partner_order(p_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare c record;
begin
  select * into c from partner.order_for_caller(p_id) as (kind text, role text, partner_id uuid);
  return partner.order_json(p_id, c.kind = 'staff');
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- What VYNTEX staff call
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.partner_admin_order_move(p_id uuid, p_to text, p_note text default '', p_live_on date default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.orders;
begin
  perform partner.require_staff();
  select * into o from partner.orders where id = p_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if not partner.order_move_allowed(o.status, p_to, 'staff') then
    raise exception 'That move is not allowed from %', o.status using errcode = '22023', hint = 'bad_move';
  end if;
  if p_to in ('info_required', 'rejected', 'cancelled', 'disputed') and pg_catalog.length(pg_catalog.btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why' using errcode = '22023', hint = 'note_required';
  end if;
  update partner.orders set status = p_to,
         live_at = case when p_to = 'live' then coalesce(p_live_on, o.live_at, current_date) else live_at end,
         ended_at = case when p_to in ('cancelled', 'refunded') and o.live_at is not null then current_date else ended_at end
   where id = o.id;
  perform partner.order_event(o.id, 'staff', 'status', 'partner', p_note, o.status, p_to);
  perform partner.notify('order.status', 'partner', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name, 'to', p_to, 'note', pg_catalog.left(coalesce(p_note, ''), 500)));
  perform partner.audit('staff', o.partner_id, 'order', o.id::text, 'order.moved', pg_catalog.jsonb_build_object('from', o.status, 'to', p_to));
  -- go-live and a cancellation after go-live are commission events
  if p_to in ('live', 'cancelled', 'refunded') then perform partner.evaluate_order(o.id); end if;
  return partner.order_json(o.id, true);
end
$$;

/** A note: internal (VYNTEX only) or an update the partner sees. */
create or replace function public.partner_admin_order_note(p_id uuid, p_body text, p_internal boolean) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.orders;
begin
  perform partner.require_staff();
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_body, ''))) < 1 or pg_catalog.length(p_body) > 4000 then raise exception 'Note' using errcode = '22023', hint = 'bad_message'; end if;
  select * into o from partner.orders where id = p_id;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  perform partner.order_event(o.id, 'staff', case when p_internal then 'note' else 'message' end, case when p_internal then 'internal' else 'partner' end, p_body);
  if not p_internal then perform partner.notify('order.update', 'partner', o.partner_id, 'order', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name)); end if;
  return partner.order_json(o.id, true);
end
$$;

create or replace function public.partner_admin_order_plan(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.orders; v_assignee uuid := nullif(p ->> 'assigned_to', '')::uuid;
begin
  perform partner.require_staff();
  select * into o from partner.orders where id = p_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if v_assignee is not null and not exists (select 1 from partner.staff s where s.user_id = v_assignee and s.active) then raise exception 'Assignee' using errcode = '22023', hint = 'bad_assignee'; end if;
  if (p ->> 'attribution') is not null and p ->> 'attribution' not in ('clear', 'possible_duplicate', 'conflict', 'confirmed') then raise exception 'Attribution' using errcode = '22023'; end if;
  update partner.orders set assigned_to = case when p ? 'assigned_to' then v_assignee else assigned_to end,
         next_action = case when p ? 'next_action' then pg_catalog.left(coalesce(p ->> 'next_action', ''), 400) else next_action end,
         follow_up_at = case when p ? 'follow_up_at' then nullif(p ->> 'follow_up_at', '')::date else follow_up_at end,
         attribution = coalesce(p ->> 'attribution', attribution)
   where id = o.id;
  perform partner.order_event(o.id, 'staff', 'assignment', 'internal', '', null, null, p);
  return partner.order_json(o.id, true);
end
$$;

/** A verified payment, refund or chargeback. Administrators, with a fresh identity check. Feeds the commission engine. */
create or replace function public.partner_admin_order_payment(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.orders; v_pay uuid;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  select * into o from partner.orders where id = p_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if o.status in ('draft', 'submitted', 'under_review', 'info_required', 'rejected') then raise exception 'Approve the order first' using errcode = '22023', hint = 'bad_state'; end if;
  if coalesce(p ->> 'kind', '') not in ('deposit', 'balance', 'one_time', 'monthly', 'refund', 'chargeback') then raise exception 'Kind' using errcode = '22023', hint = 'bad_kind'; end if;
  if coalesce((p ->> 'amount_cents')::bigint, 0) <= 0 then raise exception 'Amount' using errcode = '22023', hint = 'bad_amount'; end if;
  if coalesce(pg_catalog.btrim(p ->> 'reference'), '') = '' then raise exception 'A reference (invoice, receipt or bank record) is required' using errcode = '22023', hint = 'reference_required'; end if;
  insert into partner.order_payments (order_id, kind, amount_cents, period, received_on, method, reference, note, recorded_by)
  values (o.id, p ->> 'kind', (p ->> 'amount_cents')::bigint,
          case when p ->> 'kind' = 'monthly' then pg_catalog.date_trunc('month', coalesce(nullif(p ->> 'period', '')::date, current_date))::date end,
          coalesce(nullif(p ->> 'received_on', '')::date, current_date), pg_catalog.left(coalesce(p ->> 'method', ''), 60),
          pg_catalog.btrim(p ->> 'reference'), pg_catalog.left(coalesce(p ->> 'note', ''), 1000), (select auth.uid()))
  returning id into v_pay;
  perform partner.order_event(o.id, 'staff', 'payment', 'partner', '', null, null,
    pg_catalog.jsonb_build_object('kind', p ->> 'kind', 'amount_cents', (p ->> 'amount_cents')::bigint, 'period', p ->> 'period'));
  perform partner.audit('staff', o.partner_id, 'order_payment', v_pay::text, 'order.payment_recorded',
    pg_catalog.jsonb_build_object('order', o.id, 'kind', p ->> 'kind', 'amount_cents', (p ->> 'amount_cents')::bigint, 'reference', pg_catalog.btrim(p ->> 'reference')));
  perform partner.evaluate_order(o.id);
  return partner.order_json(o.id, true);
end
$$;

/** Daily: orders whose VYNTEX follow-up date passed, or new orders untouched for two days. */
create or replace function public.partner_orders_overdue() returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'ref', o.ref, 'client', o.client_name, 'status', o.status, 'follow_up_at', o.follow_up_at)), '[]'::jsonb)
  from partner.orders o
  where o.status not in ('draft', 'completed', 'rejected', 'cancelled', 'refunded')
    and ((o.follow_up_at is not null and o.follow_up_at < current_date)
         or (o.status = 'submitted' and o.submitted_at < pg_catalog.now() - interval '2 days'))
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The notification outbox (server only)
-- ---------------------------------------------------------------------------------------------------------------------
/** Takes up to p_limit queued notifications (a claim lasts 5 minutes) with their recipients' addresses. */
create or replace function public.partner_outbox_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v jsonb;
begin
  with c as (
    update partner.notifications n set status = 'sending', claimed_at = pg_catalog.now(), attempts = attempts + 1
     where n.id in (select x.id from partner.notifications x
                     where (x.status = 'queued' or (x.status = 'sending' and x.claimed_at < pg_catalog.now() - interval '5 minutes')) and x.attempts < 5
                     order by x.id limit greatest(1, least(coalesce(p_limit, 20), 100)) for update skip locked)
    returning n.*)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'kind', c.kind, 'audience', c.audience, 'payload', c.payload, 'entity', c.entity, 'entity_id', c.entity_id,
           'lang', coalesce((select o.lang from partner.organizations o where o.id = c.partner_id), 'en'),
           'to', case when c.audience = 'staff' then coalesce((select pg_catalog.jsonb_agg(s.email) from partner.staff s where s.active), '[]'::jsonb)
                      else coalesce((select pg_catalog.jsonb_agg(u.email) from partner.users u where u.partner_id = c.partner_id and u.status = 'active'), '[]'::jsonb) end)), '[]'::jsonb)
    into v from c;
  return v;
end
$$;

create or replace function public.partner_outbox_mark(p_id bigint, p_status text, p_provider_id text default '', p_error text default '') returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped', 'queued') then raise exception 'Status' using errcode = '22023'; end if;
  update partner.notifications set status = case when p_status = 'failed' and attempts < 5 then 'queued' else p_status end,
         provider_id = pg_catalog.left(coalesce(p_provider_id, ''), 200), last_error = pg_catalog.left(coalesce(p_error, ''), 200),
         sent_at = case when p_status = 'sent' then pg_catalog.now() else sent_at end
   where id = p_id;
end
$$;

revoke all on function public.partner_order_create(jsonb), public.partner_order_submit(uuid), public.partner_order_message(uuid, text), public.partner_order_cancel(uuid, text),
  public.partner_order_follow_up(uuid, date), public.partner_orders(text, uuid), public.partner_order(uuid), public.partner_admin_order_move(uuid, text, text, date),
  public.partner_admin_order_note(uuid, text, boolean), public.partner_admin_order_plan(uuid, jsonb), public.partner_admin_order_payment(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.partner_order_create(jsonb), public.partner_order_submit(uuid), public.partner_order_message(uuid, text), public.partner_order_cancel(uuid, text),
  public.partner_order_follow_up(uuid, date), public.partner_orders(text, uuid), public.partner_order(uuid), public.partner_admin_order_move(uuid, text, text, date),
  public.partner_admin_order_note(uuid, text, boolean), public.partner_admin_order_plan(uuid, jsonb), public.partner_admin_order_payment(uuid, jsonb)
  to authenticated;
revoke all on function public.partner_orders_overdue(), public.partner_outbox_claim(integer), public.partner_outbox_mark(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.partner_orders_overdue(), public.partner_outbox_claim(integer), public.partner_outbox_mark(bigint, text, text, text) to service_role;

select partner.lockdown_check();
select app.lockdown_check();
