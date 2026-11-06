-- 0071 VYNTEX Partner Portal, part 2: the commercial catalog (services, packages, add-ons, rates) and the resource library.
--
-- Governance:
--   * An item has numbered versions. A version is draft, needs_approval, published or retired. Only one version of an item
--     is published at a time, and a published version is never edited: a change is a new draft, published by a
--     partner_admin (with a fresh identity check). Already issued offers keep their own frozen copy (0072).
--   * Every price row carries its status: approved_source (from a source VYNTEX approved), approved (approved in the portal),
--     needs_approval (a conflict, a missing figure or a quote) or informational_estimate (a third-party cost, never a
--     VYNTEX price). A version with a needs_approval price cannot be published unless it is marked "quote only", in which
--     case the portal shows "Request a quote" and never a figure.
--   * Every version keeps its provenance: which source file and line the text and each price came from.
-- ERP software (VYNTEX BUILD and the industry editions) is NOT in these tables: its prices come only from
-- config/vyntex-build-pricing.json through src/lib/pricing.ts, and the portal reads them there.

create table partner.catalog_categories (
  id       text primary key check (id ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name     jsonb not null check (pg_catalog.jsonb_typeof(name) = 'object'),
  sort     integer not null default 0,
  provenance jsonb not null default '{}'::jsonb
);

create table partner.catalog_items (
  id          text primary key check (id ~ '^[a-z][a-z0-9_-]{1,60}$'),
  category_id text not null references partner.catalog_categories (id) on delete restrict,
  kind        text not null check (kind in ('package', 'service', 'add_on', 'hourly_rate')),
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table partner.catalog_versions (
  id             uuid primary key default gen_random_uuid(),
  item_id        text not null references partner.catalog_items (id) on delete restrict,
  version        integer not null check (version >= 1),
  status         text not null check (status in ('draft', 'needs_approval', 'published', 'retired')),
  client_facing  boolean not null default true,
  popular        boolean not null default false,
  quote_only     boolean not null default false,
  name           jsonb not null check (pg_catalog.jsonb_typeof(name) = 'object' and name ? 'en'),
  tagline        jsonb not null default '{}'::jsonb,
  best_for       jsonb not null default '{}'::jsonb,
  includes       jsonb not null default '{}'::jsonb,
  excludes       jsonb not null default '{}'::jsonb,
  lead_time      jsonb not null default '{}'::jsonb,
  -- partner-facing only: selling notes. Never in Client View or a proposal.
  partner_notes  text not null default '' check (pg_catalog.length(partner_notes) <= 4000),
  provenance     jsonb not null default '{}'::jsonb,
  effective_from timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  approved_by    uuid,
  approved_at    timestamptz,
  unique (item_id, version)
);
create unique index catalog_versions_one_published on partner.catalog_versions (item_id) where status = 'published';

create table partner.catalog_prices (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references partner.catalog_versions (id) on delete restrict,
  kind                text not null check (kind in ('setup', 'recurring', 'one_time', 'deposit', 'hourly', 'surcharge', 'per_unit', 'quote')),
  amount_cents        bigint check (amount_cents is null or amount_cents >= 0),
  period              text not null default 'one_time' check (period in ('one_time', 'month', 'year', 'hour', 'unit')),
  optional            boolean not null default false,
  minimum_term_months integer check (minimum_term_months is null or minimum_term_months between 1 and 120),
  -- the lowest a partner may sell it for without VYNTEX approval (NULL: no discount without approval)
  floor_cents         bigint check (floor_cents is null or floor_cents >= 0),
  status              text not null check (status in ('approved_source', 'approved', 'needs_approval', 'informational_estimate')),
  label               jsonb not null default '{}'::jsonb,
  provenance          jsonb not null default '{}'::jsonb,
  sort                integer not null default 0
);
create index catalog_prices_version_idx on partner.catalog_prices (version_id);

-- Published versions and their prices are frozen.
create or replace function partner.catalog_version_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then raise exception 'A published catalog version is kept' using errcode = '42501'; end if;
    return old;
  end if;
  -- the only change allowed to a published version: it becomes retired
  if old.status = 'published' and not (new.status = 'retired' and (new.name, new.includes, new.excludes, new.quote_only, new.client_facing) is not distinct from (old.name, old.includes, old.excludes, old.quote_only, old.client_facing)) then
    raise exception 'A published catalog version cannot be edited: save a new version' using errcode = '42501';
  end if;
  if old.status = 'retired' then raise exception 'A retired catalog version cannot be edited' using errcode = '42501'; end if;
  return new;
end
$$;
create trigger catalog_versions_frozen before update or delete on partner.catalog_versions for each row execute function partner.catalog_version_frozen();

create or replace function partner.catalog_price_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from partner.catalog_versions v where v.id = coalesce(old.version_id, new.version_id) and v.status in ('published', 'retired')) then
    raise exception 'Prices of a published catalog version cannot be changed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
create trigger catalog_prices_frozen before insert or update or delete on partner.catalog_prices for each row execute function partner.catalog_price_frozen();

-- The resource library: guides, scripts, disclosures. Versioned the same way (a new row per version).
create table partner.resources (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null check (slug ~ '^[a-z][a-z0-9_-]{1,60}$'),
  version     integer not null default 1,
  kind        text not null check (kind in ('guide', 'faq', 'script', 'template', 'disclosure', 'training', 'checklist', 'terms')),
  status      text not null check (status in ('draft', 'needs_approval', 'published', 'retired')),
  title       jsonb not null check (pg_catalog.jsonb_typeof(title) = 'object' and title ? 'en'),
  body        jsonb not null default '{}'::jsonb,
  provenance  jsonb not null default '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (slug, version)
);
create unique index resources_one_published on partner.resources (slug) where status = 'published';

-- ---------------------------------------------------------------------------------------------------------------------
-- Reading the catalog
-- ---------------------------------------------------------------------------------------------------------------------
/** Can this version be put in an offer at a fixed price? Every non-optional price is approved and has an amount. */
create or replace function partner.version_priced(p_version uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not v.quote_only
     and exists (select 1 from partner.catalog_prices p where p.version_id = v.id and p.kind in ('setup', 'recurring', 'one_time'))
     and not exists (select 1 from partner.catalog_prices p where p.version_id = v.id and p.kind in ('setup', 'recurring', 'one_time')
                       and (p.status not in ('approved_source', 'approved') or p.amount_cents is null))
  from partner.catalog_versions v where v.id = p_version
$$;

/** Client-safe projection of a published version: no floor, no partner notes, no provenance, no compensation. */
create or replace function partner.client_item(v partner.catalog_versions, i partner.catalog_items) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', i.id, 'category', i.category_id, 'kind', i.kind, 'version', v.version, 'popular', v.popular,
    'name', v.name, 'tagline', v.tagline, 'best_for', v.best_for, 'includes', v.includes, 'excludes', v.excludes, 'lead_time', v.lead_time,
    'quote', not coalesce(partner.version_priced(v.id), false),
    'prices', case when coalesce(partner.version_priced(v.id), false) or not v.quote_only then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', p.kind, 'amount_cents', p.amount_cents, 'period', p.period,
               'optional', p.optional, 'minimum_term_months', p.minimum_term_months, 'label', p.label) order by p.sort, p.kind)
        from partner.catalog_prices p
       where p.version_id = v.id and p.status in ('approved_source', 'approved') and p.amount_cents is not null), '[]'::jsonb)
      else '[]'::jsonb end)
$$;

/**
 * The catalog a partner shows. p_view 'client': client-facing published items, client-safe fields only.
 * 'partner': the same plus the partner's notes, price floors and the compensation the approved policies give this
 * partner's lane (an estimate; "needs VYNTEX approval" where no approved policy covers the item).
 * Staff may pass p_as (a partner id) to see exactly what that partner sees; the preview is read only and audited.
 */
create or replace function public.partner_catalog(p_view text default 'client', p_as uuid default null) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare c record; v_partner uuid; v_kind text;
begin
  select * into c from partner.caller();
  if c.kind = 'staff' then
    v_partner := p_as;
  else
    v_partner := c.partner_id;
    if p_as is not null and p_as <> c.partner_id then raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;
  if v_partner is not null then select o.kind into v_kind from partner.organizations o where o.id = v_partner; end if;
  if c.kind = 'staff' and p_as is not null then perform partner.audit('staff', p_as, 'organization', p_as::text, 'preview.catalog', pg_catalog.jsonb_build_object('view', p_view)); end if;
  return pg_catalog.jsonb_build_object(
    'view', case when p_view = 'partner' then 'partner' else 'client' end,
    'categories', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', k.id, 'name', k.name) order by k.sort) from partner.catalog_categories k), '[]'::jsonb),
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        partner.client_item(v, i)
        || case when p_view = 'partner' then pg_catalog.jsonb_build_object(
             'partner_notes', v.partner_notes,
             'floors', coalesce((select pg_catalog.jsonb_object_agg(p.kind || ':' || p.period, p.floor_cents) from partner.catalog_prices p
                                  where p.version_id = v.id and p.floor_cents is not null), '{}'::jsonb),
             'deposit_cents', (select p.amount_cents from partner.catalog_prices p where p.version_id = v.id and p.kind = 'deposit' and p.status in ('approved_source', 'approved') limit 1),
             'compensation', case when v_kind is null then null else partner.compensation_for(v_kind, v_partner, i.id, v.id) end)
           else '{}'::jsonb end
        order by k.sort, i.sort, i.id)
      from partner.catalog_items i
      join partner.catalog_categories k on k.id = i.category_id
      join partner.catalog_versions v on v.item_id = i.id and v.status = 'published'
      where i.active and (p_view = 'partner' or v.client_facing)), '[]'::jsonb),
    'resources', case when p_view = 'partner' then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('slug', r.slug, 'kind', r.kind, 'version', r.version, 'title', r.title, 'body', r.body, 'updated_at', r.updated_at) order by r.kind, r.slug)
      from partner.resources r where r.status = 'published'), '[]'::jsonb) else '[]'::jsonb end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Maintaining the catalog (partner staff)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.partner_admin_catalog() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform partner.require_staff();
  return pg_catalog.jsonb_build_object(
    'categories', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(k) order by k.sort) from partner.catalog_categories k), '[]'::jsonb),
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', i.id, 'category', i.category_id, 'kind', i.kind, 'active', i.active,
        'versions', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) || pg_catalog.jsonb_build_object(
                        'priced', partner.version_priced(v.id),
                        'prices', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.sort, p.kind) from partner.catalog_prices p where p.version_id = v.id), '[]'::jsonb))
                      order by v.version desc)
                     from partner.catalog_versions v where v.item_id = i.id)) order by k.sort, i.sort, i.id)
      from partner.catalog_items i join partner.catalog_categories k on k.id = i.category_id), '[]'::jsonb),
    'resources', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.slug, r.version desc) from partner.resources r), '[]'::jsonb));
end
$$;

/**
 * Saves a new draft version of an item from the given text and prices (a copy of the published one, edited).
 * Managers may draft. A price marked "approved" by a manager is stored as needs_approval: approving figures is the
 * administrator's call, at publication.
 */
create or replace function public.partner_admin_catalog_draft(p_item text, p jsonb) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text := partner.require_staff();
  v_id uuid; v_next integer; x jsonb; v_n integer := 0;
begin
  if not exists (select 1 from partner.catalog_items i where i.id = p_item) then raise exception 'Unknown item' using errcode = '22023'; end if;
  if p is null or pg_catalog.jsonb_typeof(p -> 'name') <> 'object' or coalesce(p -> 'name' ->> 'en', '') = '' then
    raise exception 'An English name is required' using errcode = '22023', hint = 'bad_name';
  end if;
  -- one open draft per item: the new one replaces an earlier draft
  delete from partner.catalog_prices where version_id in (select id from partner.catalog_versions where item_id = p_item and status in ('draft', 'needs_approval'));
  delete from partner.catalog_versions where item_id = p_item and status in ('draft', 'needs_approval');
  select coalesce(max(version), 0) + 1 into v_next from partner.catalog_versions where item_id = p_item;
  insert into partner.catalog_versions (item_id, version, status, client_facing, popular, quote_only, name, tagline, best_for, includes, excludes, lead_time, partner_notes, provenance, created_by)
  values (p_item, v_next, 'draft', coalesce((p ->> 'client_facing')::boolean, true), coalesce((p ->> 'popular')::boolean, false), coalesce((p ->> 'quote_only')::boolean, false),
          p -> 'name', coalesce(p -> 'tagline', '{}'), coalesce(p -> 'best_for', '{}'), coalesce(p -> 'includes', '{}'), coalesce(p -> 'excludes', '{}'),
          coalesce(p -> 'lead_time', '{}'), pg_catalog.left(coalesce(p ->> 'partner_notes', ''), 4000),
          coalesce(p -> 'provenance', '{}') || pg_catalog.jsonb_build_object('edited_in_portal', true), (select auth.uid()))
  returning id into v_id;
  for x in select * from pg_catalog.jsonb_array_elements(coalesce(p -> 'prices', '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into partner.catalog_prices (version_id, kind, amount_cents, period, optional, minimum_term_months, floor_cents, status, label, provenance, sort)
    values (v_id, x ->> 'kind', (x ->> 'amount_cents')::bigint, coalesce(x ->> 'period', 'one_time'), coalesce((x ->> 'optional')::boolean, false),
            (x ->> 'minimum_term_months')::integer, (x ->> 'floor_cents')::bigint,
            case when x ->> 'status' in ('approved', 'approved_source') and v_role <> 'partner_admin' then 'needs_approval'
                 when x ->> 'status' in ('approved_source', 'approved', 'needs_approval', 'informational_estimate') then x ->> 'status'
                 else 'needs_approval' end,
            coalesce(x -> 'label', '{}'), coalesce(x -> 'provenance', '{}'), v_n);
  end loop;
  perform partner.audit('staff', null, 'catalog_item', p_item, 'catalog.draft_saved', pg_catalog.jsonb_build_object('version', v_next));
  return v_id;
end
$$;

/** Publishes a draft: administrators, with a fresh identity check. The published version before it is retired. */
create or replace function public.partner_admin_catalog_publish(p_version uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v partner.catalog_versions;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  select * into v from partner.catalog_versions where id = p_version for update;
  if not found or v.status not in ('draft', 'needs_approval') then raise exception 'Only a draft can be published' using errcode = '22023', hint = 'not_draft'; end if;
  if not v.quote_only and exists (select 1 from partner.catalog_prices p where p.version_id = v.id and p.kind not in ('quote') and p.status = 'needs_approval') then
    raise exception 'A price still needs approval. Approve it, or mark the item "quote only".' using errcode = '22023', hint = 'price_needs_approval';
  end if;
  update partner.catalog_versions set status = 'retired' where item_id = v.item_id and status = 'published';
  update partner.catalog_versions set status = 'published', approved_by = (select auth.uid()), approved_at = pg_catalog.now(),
         effective_from = coalesce(effective_from, pg_catalog.now())
   where id = v.id;
  perform partner.audit('staff', null, 'catalog_item', v.item_id, 'catalog.published', pg_catalog.jsonb_build_object('version', v.version, 'quote_only', v.quote_only));
  return pg_catalog.jsonb_build_object('item', v.item_id, 'version', v.version);
end
$$;

/** Takes an item out of the catalog (its versions are kept; issued offers keep their copy). */
create or replace function public.partner_admin_catalog_retire(p_item text) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  update partner.catalog_versions set status = 'retired' where item_id = p_item and status = 'published';
  if not found then return false; end if;
  perform partner.audit('staff', null, 'catalog_item', p_item, 'catalog.retired');
  return true;
end
$$;

create or replace function public.partner_admin_resource_save(p_slug text, p jsonb, p_publish boolean default false) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_role text := partner.require_staff(); v_next integer; v_id uuid;
begin
  if p_slug !~ '^[a-z][a-z0-9_-]{1,60}$' then raise exception 'Address word' using errcode = '22023', hint = 'bad_slug'; end if;
  if p_publish and v_role <> 'partner_admin' then raise exception 'Administrators publish' using errcode = '42501'; end if;
  if p_publish then perform app.require_stepup(); end if;
  if coalesce(p -> 'title' ->> 'en', '') = '' then raise exception 'An English title is required' using errcode = '22023', hint = 'bad_title'; end if;
  if coalesce(p ->> 'kind', '') not in ('guide', 'faq', 'script', 'template', 'disclosure', 'training', 'checklist', 'terms') then raise exception 'Kind' using errcode = '22023'; end if;
  delete from partner.resources where slug = p_slug and status in ('draft', 'needs_approval');
  select coalesce(max(version), 0) + 1 into v_next from partner.resources where slug = p_slug;
  if p_publish then update partner.resources set status = 'retired' where slug = p_slug and status = 'published'; end if;
  insert into partner.resources (slug, version, kind, status, title, body, provenance, updated_by)
  values (p_slug, v_next, p ->> 'kind', case when p_publish then 'published' else 'draft' end, p -> 'title', coalesce(p -> 'body', '{}'),
          coalesce(p -> 'provenance', '{}'), (select auth.uid()))
  returning id into v_id;
  perform partner.audit('staff', null, 'resource', p_slug, case when p_publish then 'resource.published' else 'resource.draft_saved' end, pg_catalog.jsonb_build_object('version', v_next));
  return pg_catalog.jsonb_build_object('id', v_id, 'version', v_next);
end
$$;

/**
 * One deliberate approval for the imported catalog: publishes every draft item whose figures all come from a source
 * VYNTEX approved (approved_source / approved) and every draft "terms" resource taken from such a source. Items with
 * a conflict or a missing figure stay unpublished ("Needs VYNTEX Approval"). Administrators, fresh identity check.
 */
create or replace function public.partner_admin_catalog_publish_ready() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v record; v_items integer := 0; v_res integer := 0;
begin
  perform partner.require_staff(true);
  perform app.require_stepup();
  for v in select cv.* from partner.catalog_versions cv
            where cv.status = 'draft' and not cv.quote_only
              and not exists (select 1 from partner.catalog_prices p where p.version_id = cv.id and p.status not in ('approved_source', 'approved', 'informational_estimate'))
              and not exists (select 1 from partner.catalog_versions x where x.item_id = cv.item_id and x.status = 'published')
  loop
    update partner.catalog_versions set status = 'published', approved_by = (select auth.uid()), approved_at = pg_catalog.now(), effective_from = pg_catalog.now() where id = v.id;
    v_items := v_items + 1;
  end loop;
  update partner.resources r set status = 'published', updated_by = (select auth.uid()), updated_at = pg_catalog.now()
   where r.status = 'draft' and coalesce(r.provenance ->> 'status', '') = 'approved_source'
     and not exists (select 1 from partner.resources x where x.slug = r.slug and x.status = 'published');
  get diagnostics v_res = row_count;
  perform partner.audit('staff', null, 'catalog', 'import', 'catalog.publish_ready', pg_catalog.jsonb_build_object('items', v_items, 'resources', v_res));
  return pg_catalog.jsonb_build_object('items', v_items, 'resources', v_res);
end
$$;

revoke all on function public.partner_catalog(text, uuid), public.partner_admin_catalog(), public.partner_admin_catalog_draft(text, jsonb),
  public.partner_admin_catalog_publish(uuid), public.partner_admin_catalog_retire(text), public.partner_admin_resource_save(text, jsonb, boolean),
  public.partner_admin_catalog_publish_ready()
  from public, anon, service_role;
grant execute on function public.partner_catalog(text, uuid), public.partner_admin_catalog(), public.partner_admin_catalog_draft(text, jsonb),
  public.partner_admin_catalog_publish(uuid), public.partner_admin_catalog_retire(text), public.partner_admin_resource_save(text, jsonb, boolean),
  public.partner_admin_catalog_publish_ready()
  to authenticated;

select partner.lockdown_check();
select app.lockdown_check();
