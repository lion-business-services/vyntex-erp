-- 0073 VYNTEX Partner Portal, part 4: offers a partner builds for a client, VYNTEX approval, and client proposals.
--
-- The server prices everything. The browser sends only which catalog items, how many, and an optional discount request;
-- this file looks the prices up in the published catalog version, computes the totals and the partner's estimated pay,
-- and decides whether VYNTEX must approve the offer first:
--   * a discount below a published floor (no floor = no discount without approval), on one-time charges only:
--     the monthly is never discounted (approved term "monthly_floor");
--   * a quote-only item ("Request a quote"): VYNTEX sets its price when approving;
--   * an item whose partner pay is not covered by an approved policy (the partner is told; the offer can still be sent).
-- Once sent, an offer is frozen: the client proposal is an immutable snapshot that a later catalog change cannot alter.
-- Proposal links carry a random token of which only the SHA-256 hash is stored; they expire, can be revoked, and are
-- read only by the server (service role) behind a rate limit. A proposal never shows partner pay, floors, notes or ids.

create table partner.offers (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique,
  partner_id        uuid not null references partner.organizations (id) on delete restrict,
  created_by        uuid not null,
  status            text not null default 'draft' check (status in ('draft', 'pending_approval', 'changes_requested', 'approved', 'sent', 'viewed',
                                                                  'accepted', 'declined', 'expired', 'withdrawn', 'ordered')),
  title             text not null default '' check (pg_catalog.length(title) <= 200),
  summary           text not null default '' check (pg_catalog.length(summary) <= 4000),
  client_name       text not null check (pg_catalog.length(pg_catalog.btrim(client_name)) between 1 and 200),
  client_contact    text not null default '' check (pg_catalog.length(client_contact) <= 200),
  client_email      text not null default '' check (client_email = '' or (client_email = pg_catalog.lower(client_email) and client_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  client_phone      text not null default '' check (pg_catalog.length(client_phone) <= 40),
  industry          text not null default '' check (pg_catalog.length(industry) <= 80),
  requirements      text not null default '' check (pg_catalog.length(requirements) <= 4000),
  lang              text not null default 'en' check (lang in ('en', 'es')),
  valid_until       date not null,
  discount_bps      integer not null default 0 check (discount_bps between 0 and 5000),
  setup_cents       bigint not null default 0,
  one_time_cents    bigint not null default 0,
  recurring_cents   bigint not null default 0,
  deposit_cents     bigint not null default 0,
  discount_cents    bigint not null default 0,
  est_once_cents    bigint,
  est_monthly_cents bigint,
  estimate          jsonb not null default '{}'::jsonb,
  approval_reasons  jsonb not null default '[]'::jsonb,
  revision          integer not null default 1,
  parent_id         uuid references partner.offers (id) on delete restrict,
  snapshot          jsonb,
  decided_name      text not null default '' check (pg_catalog.length(decided_name) <= 200),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  approved_by       uuid,
  approved_at       timestamptz,
  sent_at           timestamptz,
  decided_at        timestamptz,
  order_id          uuid
);
create index offers_partner_idx on partner.offers (partner_id, created_at desc);
create index offers_status_idx on partner.offers (status, created_at desc);

create table partner.offer_lines (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null references partner.offers (id) on delete cascade,
  line_no         integer not null,
  item_id         text not null references partner.catalog_items (id) on delete restrict,
  version_id      uuid not null references partner.catalog_versions (id) on delete restrict,
  quantity        integer not null default 1 check (quantity between 1 and 50),
  quote           boolean not null default false,
  -- unit prices from the catalog version, then the line totals (quantity applied, discount applied to one-time charges)
  unit_setup_cents     bigint not null default 0,
  unit_one_time_cents  bigint not null default 0,
  unit_recurring_cents bigint not null default 0,
  setup_cents     bigint not null default 0,
  one_time_cents  bigint not null default 0,
  recurring_cents bigint not null default 0,
  deposit_cents   bigint not null default 0,
  minimum_term_months integer,
  item            jsonb not null,
  unique (offer_id, line_no)
);

create table partner.offer_events (
  id        bigint generated always as identity primary key,
  offer_id  uuid not null references partner.offers (id) on delete restrict,
  at        timestamptz not null default now(),
  actor     uuid,
  actor_kind text not null check (actor_kind in ('staff', 'partner', 'client', 'system')),
  kind      text not null check (kind ~ '^[a-z][a-z0-9_.]{2,40}$'),
  note      text not null default '' check (pg_catalog.length(note) <= 2000),
  detail    jsonb not null default '{}'::jsonb
);
create index offer_events_offer_idx on partner.offer_events (offer_id, at);
create trigger offer_events_append_only before update or delete on partner.offer_events for each row execute function partner.append_only();

create table partner.proposal_shares (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references partner.offers (id) on delete restrict,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  views         integer not null default 0,
  last_viewed_at timestamptz
);
create index proposal_shares_offer_idx on partner.proposal_shares (offer_id);

create trigger offers_touch before update on partner.offers for each row execute function partner.touch();

-- A sent offer is frozen: only its status moves on (viewed, accepted, declined, expired, ordered).
create or replace function partner.offer_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Offers are kept' using errcode = '42501'; end if;
  if old.status in ('sent', 'viewed', 'accepted', 'declined', 'expired', 'ordered', 'withdrawn')
     and (new.snapshot is distinct from old.snapshot or new.setup_cents <> old.setup_cents or new.recurring_cents <> old.recurring_cents
          or new.one_time_cents <> old.one_time_cents or new.discount_bps <> old.discount_bps or new.client_name <> old.client_name
          or new.valid_until <> old.valid_until or new.partner_id <> old.partner_id) then
    raise exception 'A sent offer cannot be changed: duplicate it to revise' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger offers_frozen before update or delete on partner.offers for each row execute function partner.offer_frozen();

create or replace function partner.offer_lines_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from partner.offers o where o.id = coalesce(new.offer_id, old.offer_id)
              and o.status not in ('draft', 'changes_requested', 'pending_approval')) then
    raise exception 'The lines of a sent offer cannot be changed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
create trigger offer_lines_frozen before insert or update or delete on partner.offer_lines for each row execute function partner.offer_lines_frozen();

create or replace function partner.next_ref(p_prefix text) returns text
language sql volatile security definer
set search_path = ''
as $$ select p_prefix || '-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' || pg_catalog.lpad(pg_catalog.nextval('partner.ref_seq')::text, 5, '0') $$;

create or replace function partner.offer_event(p_offer uuid, p_actor_kind text, p_kind text, p_note text default '', p_detail jsonb default '{}'::jsonb) returns void
language sql security definer
set search_path = ''
as $$ insert into partner.offer_events (offer_id, actor, actor_kind, kind, note, detail) values (p_offer, (select auth.uid()), p_actor_kind, p_kind, coalesce(p_note, ''), coalesce(p_detail, '{}'::jsonb)) $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Pricing an offer (server side, from the catalog)
-- ---------------------------------------------------------------------------------------------------------------------
/** Recomputes every line and the totals, the estimate and the approval reasons. Overrides: VYNTEX's prices for quote lines. */
create or replace function partner.offer_reprice(p_offer uuid, p_overrides jsonb default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  o partner.offers; l record; v_disc bigint := 0; reasons jsonb := '[]'::jsonb; est jsonb; lines jsonb := '[]'::jsonb;
  s bigint; ot bigint; rc bigint; dep bigint; floor_s bigint; floor_o bigint; ov jsonb;
begin
  select * into o from partner.offers where id = p_offer for update;
  for l in select * from partner.offer_lines where offer_id = p_offer order by line_no loop
    ov := coalesce(p_overrides -> l.id::text, null);
    if l.quote then
      if ov is not null then
        s := coalesce((ov ->> 'setup_cents')::bigint, 0); ot := coalesce((ov ->> 'one_time_cents')::bigint, 0); rc := coalesce((ov ->> 'recurring_cents')::bigint, 0);
        if s < 0 or ot < 0 or rc < 0 then raise exception 'Prices cannot be negative' using errcode = '22023'; end if;
        update partner.offer_lines set unit_setup_cents = s, unit_one_time_cents = ot, unit_recurring_cents = rc where id = l.id;
        l.unit_setup_cents := s; l.unit_one_time_cents := ot; l.unit_recurring_cents := rc;
      elsif l.unit_setup_cents + l.unit_one_time_cents + l.unit_recurring_cents = 0 then
        reasons := reasons || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', 'quote_line', 'item', l.item_id));
      end if;
    end if;
    s := l.unit_setup_cents * l.quantity; ot := l.unit_one_time_cents * l.quantity; rc := l.unit_recurring_cents * l.quantity;
    -- the discount applies to one-time charges only, never to the monthly
    if o.discount_bps > 0 then
      select max(p.floor_cents) filter (where p.kind = 'setup'), max(p.floor_cents) filter (where p.kind = 'one_time') into floor_s, floor_o
        from partner.catalog_prices p where p.version_id = l.version_id;
      if (s > 0 and (floor_s is null or s - partner.pct(s, o.discount_bps) < floor_s * l.quantity))
         or (ot > 0 and (floor_o is null or ot - partner.pct(ot, o.discount_bps) < floor_o * l.quantity)) then
        reasons := reasons || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', 'below_floor', 'item', l.item_id));
      end if;
      v_disc := v_disc + partner.pct(s, o.discount_bps) + partner.pct(ot, o.discount_bps);
      s := s - partner.pct(s, o.discount_bps); ot := ot - partner.pct(ot, o.discount_bps);
    end if;
    -- deposit: 50% of the setup (approved term "deposit"), from the catalog when it lists one for the undiscounted price
    select p.amount_cents into dep from partner.catalog_prices p where p.version_id = l.version_id and p.kind = 'deposit' and p.status in ('approved_source', 'approved') limit 1;
    dep := case when o.discount_bps = 0 and dep is not null and not l.quote then dep * l.quantity else partner.pct(s + ot, 5000) end;
    update partner.offer_lines set setup_cents = s, one_time_cents = ot, recurring_cents = rc, deposit_cents = dep where id = l.id;
    lines := lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('item', l.item_id, 'setup_cents', s, 'one_time_cents', ot, 'recurring_cents', rc));
  end loop;
  est := partner.estimate(o.partner_id, lines);
  if pg_catalog.jsonb_array_length(est -> 'uncovered') > 0 then
    reasons := reasons || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code', 'pay_not_approved', 'items', est -> 'uncovered', 'blocking', false));
  end if;
  if o.discount_bps > 0 and not exists (select 1 from pg_catalog.jsonb_array_elements(reasons) r where r ->> 'code' = 'below_floor') then
    null; -- within every floor: allowed without approval
  end if;
  update partner.offers set
    setup_cents = (select coalesce(sum(setup_cents), 0) from partner.offer_lines where offer_id = p_offer),
    one_time_cents = (select coalesce(sum(one_time_cents), 0) from partner.offer_lines where offer_id = p_offer),
    recurring_cents = (select coalesce(sum(recurring_cents), 0) from partner.offer_lines where offer_id = p_offer),
    deposit_cents = (select coalesce(sum(deposit_cents), 0) from partner.offer_lines where offer_id = p_offer),
    discount_cents = v_disc, estimate = est, est_once_cents = (est ->> 'once_cents')::bigint, est_monthly_cents = (est ->> 'monthly_cents')::bigint,
    approval_reasons = reasons
  where id = p_offer;
end
$$;

/** Does this offer need VYNTEX approval before it can be sent? (Uncovered partner pay alone does not block.) */
create or replace function partner.offer_needs_approval(p_offer uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from partner.offers o, pg_catalog.jsonb_array_elements(o.approval_reasons) r
                  where o.id = p_offer and coalesce((r ->> 'blocking')::boolean, true))
$$;

/** The client-safe content of an offer (what a proposal shows). */
create or replace function partner.offer_client_json(p_offer uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ref', o.ref, 'title', o.title, 'summary', o.summary, 'client_name', o.client_name, 'client_contact', o.client_contact, 'industry', o.industry,
    'requirements', o.requirements, 'lang', o.lang, 'valid_until', o.valid_until,
    'setup_cents', o.setup_cents, 'one_time_cents', o.one_time_cents, 'recurring_cents', o.recurring_cents, 'deposit_cents', o.deposit_cents,
    'discount_cents', o.discount_cents, 'first_payment_cents', o.deposit_cents,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'item', l.item_id, 'quantity', l.quantity, 'quote', l.quote and l.unit_setup_cents + l.unit_one_time_cents + l.unit_recurring_cents = 0,
        'name', l.item -> 'name', 'tagline', l.item -> 'tagline', 'includes', l.item -> 'includes', 'excludes', l.item -> 'excludes', 'lead_time', l.item -> 'lead_time',
        'setup_cents', l.setup_cents, 'one_time_cents', l.one_time_cents, 'recurring_cents', l.recurring_cents, 'minimum_term_months', l.minimum_term_months) order by l.line_no)
      from partner.offer_lines l where l.offer_id = o.id), '[]'::jsonb),
    'terms', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('title', r.title, 'body', r.body) order by r.slug)
                         from partner.resources r where r.status = 'published' and r.kind = 'terms'), '[]'::jsonb))
  from partner.offers o where o.id = p_offer
$$;

/** The offer as the partner (or staff) sees it: client content plus the partner's estimate and the workflow. */
create or replace function partner.offer_json(p_offer uuid, p_staff boolean) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select partner.offer_client_json(o.id) || pg_catalog.jsonb_build_object(
    'id', o.id, 'status', o.status, 'partner', pg_catalog.jsonb_build_object('id', p.id, 'name', p.display_name, 'code', p.code, 'kind', p.kind),
    'client_email', o.client_email, 'client_phone', o.client_phone, 'discount_bps', o.discount_bps,
    'estimate', o.estimate, 'est_once_cents', o.est_once_cents, 'est_monthly_cents', o.est_monthly_cents,
    'approval_reasons', o.approval_reasons, 'needs_approval', partner.offer_needs_approval(o.id),
    'revision', o.revision, 'parent_id', o.parent_id, 'order_id', o.order_id, 'decided_name', o.decided_name,
    'created_at', o.created_at, 'updated_at', o.updated_at, 'submitted_at', o.submitted_at, 'approved_at', o.approved_at, 'sent_at', o.sent_at, 'decided_at', o.decided_at,
    'line_ids', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', l.id, 'item', l.item_id, 'quote', l.quote, 'version_id', l.version_id) order by l.line_no) from partner.offer_lines l where l.offer_id = o.id), '[]'::jsonb),
    'shares', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'created_at', s.created_at, 'expires_at', s.expires_at, 'revoked', s.revoked_at is not null, 'views', s.views, 'last_viewed_at', s.last_viewed_at) order by s.created_at desc)
                        from partner.proposal_shares s where s.offer_id = o.id), '[]'::jsonb),
    'events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', e.at, 'kind', e.kind, 'actor_kind', e.actor_kind, 'note', e.note) order by e.at) from partner.offer_events e where e.offer_id = o.id), '[]'::jsonb))
  from partner.offers o join partner.organizations p on p.id = o.partner_id where o.id = p_offer
$$;

/** The offer, if the caller may see it. Staff: any. Partner: its own only (another partner's id is "not found"). */
create or replace function partner.offer_for_caller(p_offer uuid, p_write boolean) returns partner.offers
language plpgsql stable security definer
set search_path = ''
as $$
declare c record; o partner.offers;
begin
  select * into c from partner.caller();
  select * into o from partner.offers where id = p_offer;
  if not found or (c.kind = 'partner' and o.partner_id <> c.partner_id) or (c.kind = 'staff' and p_write) then
    raise exception 'Offer not found' using errcode = '42501';
  end if;
  return o;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- What partners call
-- ---------------------------------------------------------------------------------------------------------------------
/**
 * Creates (p_id NULL) or updates a draft offer. p: { title, summary, client_name, client_contact, client_email, client_phone,
 * industry, requirements, lang, valid_days, discount_bps, lines: [{ item, quantity }] }. Prices are never read from p.
 */
create or replace function public.partner_offer_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_partner uuid := partner.require_partner();
  v_id uuid := p_id; o partner.offers; x jsonb; v_n integer := 0; v record; v_quote boolean; v_days integer;
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p ->> 'client_email', '')));
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then raise exception 'Nothing to save' using errcode = '22023'; end if;
  if coalesce(pg_catalog.btrim(p ->> 'client_name'), '') = '' then raise exception 'Client name' using errcode = '22023', hint = 'client_required'; end if;
  if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'Email' using errcode = '22023', hint = 'bad_email'; end if;
  if pg_catalog.jsonb_typeof(p -> 'lines') <> 'array' or pg_catalog.jsonb_array_length(p -> 'lines') = 0 then raise exception 'Choose at least one service' using errcode = '22023', hint = 'no_lines'; end if;
  if pg_catalog.jsonb_array_length(p -> 'lines') > 30 then raise exception 'Too many lines' using errcode = '22023', hint = 'too_many_lines'; end if;
  v_days := greatest(1, least(coalesce((p ->> 'valid_days')::integer, 30), 90));
  if coalesce((p ->> 'discount_bps')::integer, 0) not between 0 and 5000 then raise exception 'Discount' using errcode = '22023', hint = 'bad_discount'; end if;
  if v_id is null then
    insert into partner.offers (ref, partner_id, created_by, client_name, valid_until)
    values (partner.next_ref('OF'), v_partner, (select auth.uid()), pg_catalog.btrim(p ->> 'client_name'), current_date + v_days)
    returning id into v_id;
    perform partner.offer_event(v_id, 'partner', 'created');
  else
    select * into o from partner.offers where id = v_id for update;
    if not found or o.partner_id <> v_partner then raise exception 'Offer not found' using errcode = '42501'; end if;
    if o.status not in ('draft', 'changes_requested') then raise exception 'Only a draft can be edited: duplicate it to revise' using errcode = '22023', hint = 'not_draft'; end if;
  end if;
  update partner.offers set title = pg_catalog.left(coalesce(p ->> 'title', ''), 200), summary = pg_catalog.left(coalesce(p ->> 'summary', ''), 4000),
         client_name = pg_catalog.left(pg_catalog.btrim(p ->> 'client_name'), 200), client_contact = pg_catalog.left(coalesce(p ->> 'client_contact', ''), 200),
         client_email = v_email, client_phone = pg_catalog.left(coalesce(p ->> 'client_phone', ''), 40),
         industry = pg_catalog.left(coalesce(p ->> 'industry', ''), 80), requirements = pg_catalog.left(coalesce(p ->> 'requirements', ''), 4000),
         lang = case when p ->> 'lang' = 'es' then 'es' else 'en' end, valid_until = current_date + v_days,
         discount_bps = coalesce((p ->> 'discount_bps')::integer, 0), status = 'draft'
   where id = v_id;
  delete from partner.offer_lines where offer_id = v_id;
  for x in select * from pg_catalog.jsonb_array_elements(p -> 'lines') loop
    v_n := v_n + 1;
    select cv.*, ci.kind as item_kind into v from partner.catalog_versions cv join partner.catalog_items ci on ci.id = cv.item_id
     where cv.item_id = x ->> 'item' and cv.status = 'published' and ci.active;
    if not found then raise exception 'That service is not in the published catalog' using errcode = '22023', hint = 'unknown_item'; end if;
    v_quote := not coalesce(partner.version_priced(v.id), false);
    insert into partner.offer_lines (offer_id, line_no, item_id, version_id, quantity, quote, unit_setup_cents, unit_one_time_cents, unit_recurring_cents, minimum_term_months, item)
    select v_id, v_n, v.item_id, v.id, greatest(1, least(coalesce((x ->> 'quantity')::integer, 1), 50)), v_quote,
           case when v_quote then 0 else coalesce((select sum(amount_cents) from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'setup' and not cp.optional), 0) end,
           case when v_quote then 0 else coalesce((select sum(amount_cents) from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'one_time' and not cp.optional), 0) end,
           case when v_quote then 0 else coalesce((select sum(amount_cents) from partner.catalog_prices cp where cp.version_id = v.id and cp.kind = 'recurring' and cp.period = 'month' and not cp.optional), 0) end,
           (select max(minimum_term_months) from partner.catalog_prices cp where cp.version_id = v.id),
           pg_catalog.jsonb_build_object('name', v.name, 'tagline', v.tagline, 'includes', v.includes, 'excludes', v.excludes, 'lead_time', v.lead_time, 'version', v.version, 'kind', v.item_kind);
  end loop;
  perform partner.offer_reprice(v_id);
  perform partner.offer_event(v_id, 'partner', 'saved');
  perform partner.audit('partner', v_partner, 'offer', v_id::text, 'offer.saved');
  return partner.offer_json(v_id, false);
end
$$;

create or replace function public.partner_offers(p_status text default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare c record;
begin
  select * into c from partner.caller();
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'ref', o.ref, 'status', o.status, 'title', o.title, 'client_name', o.client_name,
             'partner', p.display_name, 'setup_cents', o.setup_cents, 'one_time_cents', o.one_time_cents, 'recurring_cents', o.recurring_cents,
             'est_once_cents', o.est_once_cents, 'est_monthly_cents', o.est_monthly_cents, 'valid_until', o.valid_until, 'needs_approval', partner.offer_needs_approval(o.id),
             'updated_at', o.updated_at) order by o.updated_at desc)
    from partner.offers o join partner.organizations p on p.id = o.partner_id
    where (c.kind = 'staff' or o.partner_id = c.partner_id) and (p_status is null or o.status = p_status)), '[]'::jsonb);
end
$$;

create or replace function public.partner_offer(p_id uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare o partner.offers;
begin
  o := partner.offer_for_caller(p_id, false);
  return partner.offer_json(o.id, partner.staff_role() is not null);
end
$$;

/** Ready: needs approval -> pending_approval; otherwise approved at once. */
create or replace function public.partner_offer_submit(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers;
begin
  o := partner.offer_for_caller(p_id, true);
  if o.status not in ('draft', 'changes_requested') then raise exception 'Only a draft can be submitted' using errcode = '22023', hint = 'not_draft'; end if;
  if o.valid_until < current_date then raise exception 'The offer has expired' using errcode = '22023', hint = 'expired'; end if;
  perform partner.offer_reprice(o.id);
  if partner.offer_needs_approval(o.id) then
    update partner.offers set status = 'pending_approval', submitted_at = pg_catalog.now() where id = o.id;
    perform partner.offer_event(o.id, 'partner', 'submitted_for_approval');
    perform partner.notify('offer.pending_approval', 'staff', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  else
    update partner.offers set status = 'approved', submitted_at = pg_catalog.now(), approved_at = pg_catalog.now() where id = o.id;
    perform partner.offer_event(o.id, 'system', 'approved_automatically', 'Within the published catalog and floors');
  end if;
  perform partner.audit('partner', o.partner_id, 'offer', o.id::text, 'offer.submitted');
  return partner.offer_json(o.id, false);
end
$$;

create or replace function public.partner_offer_duplicate(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers; v_new uuid;
begin
  o := partner.offer_for_caller(p_id, true);
  insert into partner.offers (ref, partner_id, created_by, title, summary, client_name, client_contact, client_email, client_phone, industry, requirements, lang, valid_until, discount_bps, revision, parent_id)
  values (partner.next_ref('OF'), o.partner_id, (select auth.uid()), o.title, o.summary, o.client_name, o.client_contact, o.client_email, o.client_phone, o.industry, o.requirements, o.lang,
          current_date + 30, o.discount_bps, o.revision + 1, o.id)
  returning id into v_new;
  -- the copy uses today's published catalog, not the old prices
  perform public.partner_offer_save(v_new, pg_catalog.jsonb_build_object('title', o.title, 'summary', o.summary, 'client_name', o.client_name, 'client_contact', o.client_contact,
    'client_email', o.client_email, 'client_phone', o.client_phone, 'industry', o.industry, 'requirements', o.requirements, 'lang', o.lang, 'discount_bps', o.discount_bps,
    'lines', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item', l.item_id, 'quantity', l.quantity) order by l.line_no) from partner.offer_lines l where l.offer_id = o.id)));
  perform partner.offer_event(v_new, 'partner', 'duplicated', o.ref);
  return partner.offer_json(v_new, false);
end
$$;

create or replace function public.partner_offer_withdraw(p_id uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers;
begin
  o := partner.offer_for_caller(p_id, true);
  if o.status in ('accepted', 'ordered', 'withdrawn', 'declined', 'expired') then raise exception 'Cannot withdraw now' using errcode = '22023', hint = 'bad_state'; end if;
  update partner.offers set status = 'withdrawn' where id = o.id;
  update partner.proposal_shares set revoked_at = pg_catalog.now() where offer_id = o.id and revoked_at is null;
  perform partner.offer_event(o.id, 'partner', 'withdrawn');
  return partner.offer_json(o.id, false);
end
$$;

/**
 * Makes a client proposal link for an approved offer and freezes the offer. The server makes the token and passes its hash.
 * The link expires at the end of the offer's validity (or sooner, p_days).
 */
create or replace function public.partner_offer_share(p_user uuid, p_id uuid, p_token_hash text, p_days integer default 30) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers; v_exp timestamptz; v_partner uuid;
begin
  -- server only: the server made the token (and rate limits this), after guard() checked the person's session and second step.
  -- The person must still be an active member of the active partner that owns the offer.
  select u.partner_id into v_partner from partner.users u join partner.organizations g on g.id = u.partner_id
   where u.user_id = p_user and u.status = 'active' and g.status = 'active';
  select * into o from partner.offers where id = p_id;
  if v_partner is null or not found or o.partner_id <> v_partner then raise exception 'Offer not found' using errcode = '42501'; end if;
  if o.status not in ('approved', 'sent', 'viewed') then raise exception 'Only an approved offer can be shared' using errcode = '22023', hint = 'not_approved'; end if;
  if o.valid_until < current_date then raise exception 'The offer has expired' using errcode = '22023', hint = 'expired'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Token' using errcode = '22023'; end if;
  if (select count(*) from partner.proposal_shares s where s.offer_id = o.id and s.revoked_at is null and s.expires_at > pg_catalog.now()) >= 5 then
    raise exception 'Too many open links for this offer: revoke one first' using errcode = '22023', hint = 'too_many_links';
  end if;
  v_exp := least((o.valid_until + 1)::timestamptz, pg_catalog.now() + pg_catalog.make_interval(days => greatest(1, least(coalesce(p_days, 30), 90))));
  if o.status = 'approved' then
    update partner.offers set status = 'sent', sent_at = pg_catalog.now(), snapshot = partner.offer_client_json(o.id) where id = o.id;
  end if;
  insert into partner.proposal_shares (offer_id, token_hash, created_by, expires_at) values (o.id, p_token_hash, p_user, v_exp);
  insert into partner.offer_events (offer_id, actor, actor_kind, kind, detail) values (o.id, p_user, 'partner', 'shared', pg_catalog.jsonb_build_object('expires_at', v_exp));
  insert into partner.audit_log (actor, actor_kind, partner_id, entity, entity_id, action) values (p_user, 'partner', o.partner_id, 'offer', o.id::text, 'offer.shared');
  return pg_catalog.jsonb_build_object('expires_at', v_exp, 'ref', o.ref, 'lang', o.lang, 'client_email', o.client_email, 'client_name', o.client_name);
end
$$;

create or replace function public.partner_offer_share_revoke(p_id uuid, p_share uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers;
begin
  o := partner.offer_for_caller(p_id, true);
  update partner.proposal_shares set revoked_at = pg_catalog.now() where id = p_share and offer_id = o.id and revoked_at is null;
  if not found then return false; end if;
  perform partner.offer_event(o.id, 'partner', 'link_revoked');
  return true;
end
$$;

/** The client told the partner they decline. Only the client (on the proposal page) or VYNTEX staff (with a reason) records an acceptance. */
create or replace function public.partner_offer_decision(p_id uuid, p_decision text, p_name text default '') returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers;
begin
  o := partner.offer_for_caller(p_id, true);
  if p_decision = 'accepted' then raise exception 'Only the client accepts, on the proposal page, or VYNTEX records it' using errcode = '42501', hint = 'client_accepts'; end if;
  if p_decision <> 'declined' then raise exception 'Decision' using errcode = '22023'; end if;
  if o.status not in ('sent', 'viewed', 'approved') then raise exception 'Only a sent offer can be decided' using errcode = '22023', hint = 'bad_state'; end if;
  if p_decision = 'accepted' and o.valid_until < current_date then raise exception 'The offer has expired' using errcode = '22023', hint = 'expired'; end if;
  update partner.offers set status = p_decision, decided_at = pg_catalog.now(), decided_name = pg_catalog.left(coalesce(p_name, ''), 200),
         snapshot = coalesce(snapshot, partner.offer_client_json(o.id)), sent_at = coalesce(sent_at, pg_catalog.now())
   where id = o.id;
  perform partner.offer_event(o.id, 'partner', p_decision, 'Recorded by the partner');
  return partner.offer_json(o.id, false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- What VYNTEX staff call: the approval queue
-- ---------------------------------------------------------------------------------------------------------------------
/** p_decision: 'approve' (optionally pricing quote lines: { "<line id>": { setup_cents, one_time_cents, recurring_cents } }) or 'changes'. */
/** VYNTEX records a client's acceptance received outside the proposal page (signed paper, email): a written reason is kept. */
create or replace function public.partner_admin_offer_accept(p_id uuid, p_name text, p_reason text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers;
begin
  perform partner.require_staff();
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 3 or pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'The client''s name and how they accepted are required' using errcode = '22023', hint = 'reason_required';
  end if;
  select * into o from partner.offers where id = p_id for update;
  if not found then raise exception 'Offer not found' using errcode = '22023'; end if;
  if o.status not in ('sent', 'viewed') then raise exception 'Only a sent offer can be accepted' using errcode = '22023', hint = 'bad_state'; end if;
  if o.valid_until < current_date then raise exception 'The offer has expired' using errcode = '22023', hint = 'expired'; end if;
  update partner.offers set status = 'accepted', decided_at = pg_catalog.now(), decided_name = pg_catalog.left(pg_catalog.btrim(p_name), 200) where id = o.id;
  perform partner.offer_event(o.id, 'staff', 'accepted', pg_catalog.left(p_reason, 2000));
  perform partner.audit('staff', o.partner_id, 'offer', o.id::text, 'offer.accepted_by_staff', pg_catalog.jsonb_build_object('reason', pg_catalog.left(p_reason, 500)));
  perform partner.notify('offer.accepted', 'partner', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  return partner.offer_json(o.id, true);
end
$$;

create or replace function public.partner_admin_offer_decide(p_id uuid, p_decision text, p_note text default '', p_prices jsonb default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare o partner.offers; v_role text := partner.require_staff();
begin
  select * into o from partner.offers where id = p_id for update;
  if not found then raise exception 'Offer not found' using errcode = '22023'; end if;
  if o.status <> 'pending_approval' then raise exception 'Not waiting for approval' using errcode = '22023', hint = 'bad_state'; end if;
  -- prices below a floor and prices set for quoted lines are money decisions: administrators only
  if p_decision = 'approve' and v_role <> 'partner_admin' and (p_prices is not null
      or exists (select 1 from pg_catalog.jsonb_array_elements(o.approval_reasons) r where r ->> 'code' in ('below_floor', 'quote_line'))) then
    raise exception 'Administrators approve discounts below a floor and quoted prices' using errcode = '42501', hint = 'admin_only';
  end if;
  if p_decision = 'approve' then
    perform partner.offer_reprice(o.id, p_prices);
    if exists (select 1 from partner.offers x, pg_catalog.jsonb_array_elements(x.approval_reasons) r where x.id = o.id and r ->> 'code' = 'quote_line') then
      raise exception 'Set a price for every quote line first' using errcode = '22023', hint = 'quote_unpriced';
    end if;
    update partner.offers set status = 'approved', approved_by = (select auth.uid()), approved_at = pg_catalog.now() where id = o.id;
    perform partner.offer_event(o.id, 'staff', 'approved', p_note, coalesce(p_prices, '{}'::jsonb));
    perform partner.notify('offer.approved', 'partner', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  elsif p_decision = 'changes' then
    if pg_catalog.length(pg_catalog.btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say what to change' using errcode = '22023', hint = 'note_required'; end if;
    update partner.offers set status = 'changes_requested' where id = o.id;
    perform partner.offer_event(o.id, 'staff', 'changes_requested', p_note);
    perform partner.notify('offer.changes_requested', 'partner', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name, 'note', pg_catalog.left(p_note, 500)));
  else
    raise exception 'Decision' using errcode = '22023';
  end if;
  perform partner.audit('staff', o.partner_id, 'offer', o.id::text, 'offer.' || p_decision);
  return partner.offer_json(o.id, true);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The client proposal (server only, by token hash)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.partner_proposal_peek(p_token_hash text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare s partner.proposal_shares; o partner.offers;
begin
  select * into s from partner.proposal_shares where token_hash = p_token_hash and revoked_at is null and expires_at > pg_catalog.now();
  if not found then return null; end if;
  select * into o from partner.offers where id = s.offer_id;
  if o.status not in ('sent', 'viewed', 'accepted', 'declined', 'ordered') or o.snapshot is null then return null; end if;
  -- reading changes nothing (link scanners open links too); the page reports a real view with partner_proposal_viewed
  return o.snapshot || pg_catalog.jsonb_build_object('status', case when o.status = 'ordered' then 'accepted' else o.status end,
    'expired', o.valid_until < current_date, 'decided_at', o.decided_at);
end
$$;

/** The proposal page, once drawn in a browser, says it was seen (a POST from the page's script). */
create or replace function public.partner_proposal_viewed(p_token_hash text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare s partner.proposal_shares; o partner.offers;
begin
  select * into s from partner.proposal_shares where token_hash = p_token_hash and revoked_at is null and expires_at > pg_catalog.now() for update;
  if not found then return false; end if;
  select * into o from partner.offers where id = s.offer_id for update;
  update partner.proposal_shares set views = views + 1, last_viewed_at = pg_catalog.now() where id = s.id;
  if o.status = 'sent' then
    update partner.offers set status = 'viewed' where id = o.id;
    insert into partner.offer_events (offer_id, actor_kind, kind) values (o.id, 'client', 'viewed');
    perform partner.notify('offer.viewed', 'partner', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  end if;
  return true;
end
$$;

create or replace function public.partner_proposal_respond(p_token_hash text, p_decision text, p_name text, p_ip_hash text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare s partner.proposal_shares; o partner.offers;
begin
  if p_decision not in ('accepted', 'declined') then raise exception 'Decision' using errcode = '22023'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) < 2 then raise exception 'Your name' using errcode = '22023', hint = 'name_required'; end if;
  select * into s from partner.proposal_shares where token_hash = p_token_hash and revoked_at is null and expires_at > pg_catalog.now();
  if not found then return null; end if;
  select * into o from partner.offers where id = s.offer_id for update;
  if o.status not in ('sent', 'viewed') then raise exception 'Already decided' using errcode = '22023', hint = 'decided'; end if;
  if o.valid_until < current_date then raise exception 'Expired' using errcode = '22023', hint = 'expired'; end if;
  update partner.offers set status = p_decision, decided_at = pg_catalog.now(), decided_name = pg_catalog.left(pg_catalog.btrim(p_name), 200) where id = o.id;
  insert into partner.offer_events (offer_id, actor_kind, kind, note, detail)
  values (o.id, 'client', p_decision, pg_catalog.left(pg_catalog.btrim(p_name), 200), pg_catalog.jsonb_build_object('ip_hash', case when p_ip_hash ~ '^[0-9a-f]{16,128}$' then p_ip_hash end));
  perform partner.notify('offer.' || p_decision, 'partner', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  perform partner.notify('offer.' || p_decision, 'staff', o.partner_id, 'offer', o.id, pg_catalog.jsonb_build_object('ref', o.ref, 'client', o.client_name));
  return pg_catalog.jsonb_build_object('status', p_decision);
end
$$;

/** Daily: offers past their validity expire, and their links stop working. */
create or replace function public.partner_offers_expire() returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  with x as (update partner.offers set status = 'expired' where status in ('draft', 'pending_approval', 'changes_requested', 'approved', 'sent', 'viewed')
               and valid_until < current_date returning id)
  insert into partner.offer_events (offer_id, actor_kind, kind) select id, 'system', 'expired' from x;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.partner_offer_save(uuid, jsonb), public.partner_offers(text), public.partner_offer(uuid), public.partner_offer_submit(uuid),
  public.partner_offer_duplicate(uuid), public.partner_offer_withdraw(uuid),
  public.partner_offer_share_revoke(uuid, uuid), public.partner_offer_decision(uuid, text, text), public.partner_admin_offer_decide(uuid, text, text, jsonb),
  public.partner_admin_offer_accept(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.partner_offer_save(uuid, jsonb), public.partner_offers(text), public.partner_offer(uuid), public.partner_offer_submit(uuid),
  public.partner_offer_duplicate(uuid), public.partner_offer_withdraw(uuid),
  public.partner_offer_share_revoke(uuid, uuid), public.partner_offer_decision(uuid, text, text), public.partner_admin_offer_decide(uuid, text, text, jsonb),
  public.partner_admin_offer_accept(uuid, text, text)
  to authenticated;
revoke all on function public.partner_proposal_peek(text), public.partner_proposal_viewed(text), public.partner_proposal_respond(text, text, text, text), public.partner_offers_expire(),
  public.partner_offer_share(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.partner_proposal_peek(text), public.partner_proposal_viewed(text), public.partner_proposal_respond(text, text, text, text), public.partner_offers_expire(),
  public.partner_offer_share(uuid, uuid, text, integer) to service_role;

select partner.lockdown_check();
select app.lockdown_check();
