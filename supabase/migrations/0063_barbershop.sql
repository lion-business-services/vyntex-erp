-- 0063 The barbershop edition (VYNTEX BARBER): the shop floor, memberships and barber pay
--   Chair     -> chairs         staffId = member_id (the barber in it), officeId = office_id
--   PassPlan  -> pass_plans     a membership, package or gift card the shop sells
--   Pass      -> passes         one a client holds; `uses` is its ledger (added to, never rewritten)
--   WalkIn    -> walkins        someone in the walk-in line, and how the visit was paid
--   Payout    -> payouts        a weekly statement paid to a barber, frozen when paid
-- The edition belongs to the appointment family (no field crews): the same stages and lead sources as the
-- professional-services edition, its own role matrix (src/packs/barber/pack.ts, ROLES).
--
-- Who may do what, in the database:
--   chairs       everyone on the floor sees them and sets a chair open, busy, on a break or off; only people who change the
--                company's configuration add or remove a chair or change its barber, pay, split or rent
--   walkins      people who work appointments; a served visit is a record: what was paid, the tip and who served it stay
--   pass_plans   read by everyone who sees clients, changed by people who change the catalog
--   passes       people who work with clients; what was sold and every use already recorded never change; a gift card
--                balance only goes down; visits left only go up when a membership is renewed
--   payouts      people with "payroll", added once per barber and week, never changed or removed

-- ---------------------------------------------------------------------------------------------------------------------
-- The edition: family and defaults
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.edition_family(p_industry text) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select case when p_industry in ('practice', 'barber') then 'practice' else 'field' end $$;

-- 0010's defaults, with the barbershop matrix in front of them. Stages and sources are the practice family's.
create or replace function app.edition_defaults(p_industry text) returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_industry = 'barber' then jsonb_build_object(
      'family', 'practice',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","appointments","catalog","opportunities","reviews","comms","esign","assistant","money","cash","payroll","reports","automations","social","delete","export","import","assignLeads","allClients","credits","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","team","documents","appointments","catalog","opportunities","reviews","comms","esign","assistant","money","cash","credits","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","team","documents","appointments","catalog","opportunities","reviews","comms","esign","assistant"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"appointment","kind":"open","role":"visit"},
        {"id":"proposal","kind":"open","role":"proposal"},
        {"id":"negotiating","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","walk_in","referral","google","facebook","instagram","whatsapp","existing_client","other"]'::jsonb)
    when app.edition_family(p_industry) = 'practice' then jsonb_build_object(
      'family', 'practice',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView","reports","automations","social","delete","export","import","assignLeads","credits","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView","import","credits","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"appointment","kind":"open","role":"visit"},
        {"id":"proposal","kind":"open","role":"proposal"},
        {"id":"negotiating","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","walk_in","referral","google","facebook","instagram","whatsapp","existing_client","other"]'::jsonb)
    else jsonb_build_object(
      'family', 'field',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","reports","automations","assistant","compliance","delete","appointments","catalog","opportunities","reviews","social","comms","esign","cash","deadlines","export","assignLeads","allClients","credits","secureView","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"scheduled","kind":"open","role":"visit"},
        {"id":"sent","kind":"open","role":"proposal"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","referral","facebook","instagram","google","other"]'::jsonb)
  end
$$;

-- The shop events of the rule engine (RuleEvent in src/domain/types.ts).
alter table public.rules drop constraint rules_event_check;
alter table public.rules add constraint rules_event_check check (event in (
  'lead.created', 'lead.stage', 'lead.won', 'lead.lost', 'lead.idle', 'client.created', 'job.created', 'job.status', 'job.completed',
  'payment.received', 'appointment.booked', 'appointment.paid', 'appointment.unpaid', 'appointment.completed', 'appointment.no_show',
  'appointment.cancelled', 'task.overdue', 'doc.sent', 'envelope.completed', 'envelope.idle', 'message.received', 'review.due',
  'deadline.near', 'client.birthday', 'worker.document', 'daily',
  'appointment.soon', 'appointment.pay_soon', 'opportunity.created', 'credit.expiring',
  'walkin.joined', 'walkin.called', 'walkin.done', 'client.due', 'pass.low', 'pass.renews'));

-- ---------------------------------------------------------------------------------------------------------------------
-- chairs
-- ---------------------------------------------------------------------------------------------------------------------
create table public.chairs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  label       text not null check (length(btrim(label)) between 1 and 60),
  member_id   uuid,
  status      text not null default 'off' check (status in ('open', 'busy', 'break', 'off')),
  walk_ins    boolean not null default true,
  pay         text not null default 'commission' check (pay in ('commission', 'rent')),
  split       numeric(5,2) not null default 50 check (split between 0 and 100),
  own_split   numeric(5,2) not null default 100 check (own_split between 0 and 100),
  rent        numeric(12,2) check (rent >= 0),
  -- catalog services this chair does not offer
  skip        uuid[] check (skip is null or cardinality(skip) <= 200),
  office_id   uuid,
  since       timestamptz,
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint chairs_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint chairs_rent_when_renting check (pay <> 'rent' or rent is not null),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete set null (member_id),
  foreign key (tenant_id, office_id) references public.offices (tenant_id, id) on delete set null (office_id)
);
-- one chair per barber
create unique index chairs_member_uidx on public.chairs (tenant_id, member_id) where member_id is not null;
create index chairs_office_idx on public.chairs (tenant_id, office_id);
select app.module_table('chairs');
create policy chairs_select on public.chairs for select to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[]));
create policy chairs_insert on public.chairs for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('config', 'write'))::uuid[]));
create policy chairs_update on public.chairs for update to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]));
create policy chairs_delete on public.chairs for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('config', 'write', 'delete'))::uuid[]));
create trigger chairs_audit after insert or update or delete on public.chairs for each row execute function app.audit_row();

-- The floor changes a chair's status; who sits in it and how the barber is paid is configuration.
create or replace function app.chairs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if (new.label, new.member_id, new.walk_ins, new.pay, new.split, new.own_split, new.rent, new.skip, new.office_id)
     is distinct from (old.label, old.member_id, old.walk_ins, old.pay, old.split, old.own_split, old.rent, old.skip, old.office_id)
     and not (new.tenant_id = any (app.tenants_can('config', 'write'))) then
    raise exception 'Only people who change the company''s configuration change a chair''s barber or pay' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.chairs_guard() from public, anon;
create trigger chairs_guard before update on public.chairs for each row execute function app.chairs_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- pass_plans
-- ---------------------------------------------------------------------------------------------------------------------
create table public.pass_plans (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  kind         text not null check (kind in ('membership', 'package', 'gift_card')),
  name         text not null check (length(btrim(name)) between 1 and 120),
  i18n         jsonb check (i18n is null or jsonb_typeof(i18n) = 'object'),
  price        numeric(12,2) not null default 0 check (price >= 0),
  visits       integer check (visits between 0 and 1000),
  "interval"   text check ("interval" in ('month')),
  service_ids  uuid[] not null default '{}'::uuid[] check (cardinality(service_ids) <= 200),
  discount     numeric(5,2) check (discount between 0 and 100),
  valid_days   integer check (valid_days between 0 and 3650),
  perks        text check (length(perks) <= 500),
  active       boolean not null default true,
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint pass_plans_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint pass_plans_package_visits check (kind <> 'package' or visits >= 1)
);
create index pass_plans_kind_idx on public.pass_plans (tenant_id, kind);
select app.module_table('pass_plans');
create policy pass_plans_select on public.pass_plans for select to authenticated
  using (tenant_id = any ((select app.tenants_can('clients'))::uuid[]));
create policy pass_plans_insert on public.pass_plans for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('catalog', 'write'))::uuid[]));
create policy pass_plans_update on public.pass_plans for update to authenticated
  using (tenant_id = any ((select app.tenants_can('catalog', 'write'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_can('catalog', 'write'))::uuid[]));
create policy pass_plans_delete on public.pass_plans for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('catalog', 'write', 'delete'))::uuid[]));
create trigger pass_plans_audit after insert or update or delete on public.pass_plans for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------------------------------------------------
-- passes
-- ---------------------------------------------------------------------------------------------------------------------
create table public.passes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  plan_id      uuid,
  kind         text not null check (kind in ('membership', 'package', 'gift_card')),
  client_id    uuid,
  holder       text check (length(holder) <= 200),
  code         text check (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  status       text not null default 'active' check (status in ('active', 'paused', 'past_due', 'cancelled', 'used_up', 'expired')),
  start        date not null default current_date,
  renews       date,
  visits_left  integer check (visits_left >= 0),
  balance      numeric(12,2) check (balance >= 0),
  expires      date,
  -- { at, amount, method, by }: the sale
  sold         jsonb not null check (jsonb_typeof(sold) = 'object' and sold ? 'amount' and sold ? 'method' and (sold ->> 'method') in ('cash', 'check', 'transfer', 'zelle', 'card')),
  -- [{ id, at, amount?, apptId?, walkinId?, by, note? }]: every use, oldest first
  uses         jsonb not null default '[]'::jsonb check (jsonb_typeof(uses) = 'array' and jsonb_array_length(uses) <= 5000),
  note         text check (length(note) <= 1000),
  extra        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  constraint passes_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint passes_holder check (client_id is not null or holder is not null or kind <> 'gift_card' or status in ('cancelled', 'expired', 'used_up')),
  foreign key (tenant_id, plan_id) references public.pass_plans (tenant_id, id) on delete set null (plan_id),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id)
);
create index passes_client_idx on public.passes (tenant_id, client_id);
create index passes_plan_idx on public.passes (tenant_id, plan_id);
-- a gift card code is read out at the desk: one per shop
create unique index passes_code_uidx on public.passes (tenant_id, code) where code is not null;
select app.module_table('passes');
create policy passes_select on public.passes for select to authenticated
  using (tenant_id = any ((select app.tenants_can('clients'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create policy passes_insert on public.passes for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create policy passes_update on public.passes for update to authenticated
  using (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())))
  with check (tenant_id = any ((select app.tenants_can('clients', 'write'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create policy passes_delete on public.passes for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('clients', 'write', 'delete'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create trigger passes_audit after insert or update or delete on public.passes for each row execute function app.audit_row('note');

-- A pass is money a client already paid: the sale and every recorded use stay as they were.
create or replace function app.passes_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n integer := pg_catalog.jsonb_array_length(old.uses);
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.sold is distinct from old.sold or new.kind is distinct from old.kind then
    raise exception 'What was sold is a record and does not change' using errcode = '42501', constraint = 'passes_record';
  end if;
  if pg_catalog.jsonb_array_length(new.uses) < n
     or (n > 0 and (select pg_catalog.jsonb_agg(e.value order by e.ordinality) from pg_catalog.jsonb_array_elements(new.uses) with ordinality e where e.ordinality <= n) is distinct from old.uses) then
    raise exception 'A use of a pass is a record: new uses are added, recorded ones never change' using errcode = '42501', constraint = 'passes_ledger';
  end if;
  if new.balance > old.balance then
    raise exception 'A gift card balance only goes down' using errcode = '42501', constraint = 'passes_balance';
  end if;
  if new.visits_left > old.visits_left and new.kind <> 'membership' then
    raise exception 'Visits left only go up when a membership is renewed' using errcode = '42501', constraint = 'passes_visits';
  end if;
  return new;
end
$$;
revoke all on function app.passes_guard() from public, anon;
create trigger passes_guard before update on public.passes for each row execute function app.passes_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- walkins
-- ---------------------------------------------------------------------------------------------------------------------
create table public.walkins (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  ticket          integer not null check (ticket between 1 and 10000),
  name            text not null check (length(btrim(name)) between 1 and 120),
  phone           text check (length(phone) <= 40),
  client_id       uuid,
  service_id      uuid,
  pref_member_id  uuid,
  joined          timestamptz not null default now(),
  status          text not null default 'waiting' check (status in ('waiting', 'called', 'in_service', 'done', 'left', 'no_show')),
  member_id       uuid,
  chair_id        uuid,
  called_at       timestamptz,
  started_at      timestamptz,
  done_at         timestamptz,
  amount          numeric(12,2) check (amount >= 0),
  tip             numeric(12,2) check (tip >= 0),
  method          text check (method in ('cash', 'check', 'transfer', 'zelle', 'card', 'pass')),
  pass_id         uuid,
  source          text not null default 'desk' check (source in ('desk', 'kiosk', 'online', 'phone')),
  text_ok         boolean,
  note            text check (length(note) <= 1000),
  by_member_id    uuid,
  extra           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  constraint walkins_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint walkins_paid_when_done check (status <> 'done' or (member_id is not null and method is not null)),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id) on delete set null (client_id),
  foreign key (tenant_id, service_id) references public.catalog_services (tenant_id, id) on delete set null (service_id),
  foreign key (tenant_id, pref_member_id) references public.tenant_members (tenant_id, id) on delete set null (pref_member_id),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete set null (member_id),
  foreign key (tenant_id, chair_id) references public.chairs (tenant_id, id) on delete set null (chair_id),
  foreign key (tenant_id, pass_id) references public.passes (tenant_id, id) on delete set null (pass_id),
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id)
);
create index walkins_joined_idx on public.walkins (tenant_id, joined);
create index walkins_client_idx on public.walkins (tenant_id, client_id);
create index walkins_service_idx on public.walkins (tenant_id, service_id);
create index walkins_pref_idx on public.walkins (tenant_id, pref_member_id);
create index walkins_member_idx on public.walkins (tenant_id, member_id);
create index walkins_chair_idx on public.walkins (tenant_id, chair_id);
create index walkins_pass_idx on public.walkins (tenant_id, pass_id);
create index walkins_by_idx on public.walkins (tenant_id, by_member_id);
select app.module_table('walkins');
create policy walkins_select on public.walkins for select to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create policy walkins_insert on public.walkins for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create policy walkins_update on public.walkins for update to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())))
  with check (tenant_id = any ((select app.tenants_can('appointments', 'write'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create policy walkins_delete on public.walkins for delete to authenticated
  using (tenant_id = any ((select app.tenants_can('appointments', 'write', 'delete'))::uuid[]) and (client_id is null or client_id not in (select app.hidden_clients())));
create trigger walkins_audit_delete after delete on public.walkins for each row execute function app.audit_row('note');
-- added in the name of the person signed in, whatever the row said
create trigger walkins_stamp before insert on public.walkins for each row execute function app.stamp_member('by_member_id');

-- A served visit is a record: what was paid, the tip, the method and who served it stay as they were.
create or replace function app.walkins_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if old.status = 'done' and (new.status, new.amount, new.tip, new.method, new.pass_id, new.member_id, new.done_at)
     is distinct from (old.status, old.amount, old.tip, old.method, old.pass_id, old.member_id, old.done_at) then
    raise exception 'A served visit is a record and is not changed' using errcode = '42501', constraint = 'walkins_record';
  end if;
  return new;
end
$$;
revoke all on function app.walkins_guard() from public, anon;
create trigger walkins_guard before update on public.walkins for each row execute function app.walkins_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- payouts
-- ---------------------------------------------------------------------------------------------------------------------
create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  member_id     uuid not null,
  period_from   date not null check (extract(isodow from period_from) = 1),
  period_to     date not null,
  services      numeric(12,2) not null check (services >= 0),
  share         numeric(12,2) not null check (share >= 0),
  tips          numeric(12,2) not null check (tips >= 0),
  rent          numeric(12,2) not null default 0 check (rent >= 0),
  amount        numeric(12,2) not null,
  visits        integer not null check (visits >= 0),
  paid_at       timestamptz not null default now(),
  method        text not null check (method in ('cash', 'check', 'transfer', 'zelle', 'card')),
  by_member_id  uuid,
  note          text check (length(note) <= 1000),
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, member_id, period_from),
  constraint payouts_extra_shape check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 65536),
  constraint payouts_week check (period_to = period_from + 6 and period_to < (paid_at at time zone 'UTC')::date + 1),
  constraint payouts_sum check (amount = share + tips - rent),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete restrict,
  foreign key (tenant_id, by_member_id) references public.tenant_members (tenant_id, id) on delete set null (by_member_id)
);
create index payouts_by_idx on public.payouts (tenant_id, by_member_id);
select app.module_table('payouts', 'select, insert');
create policy payouts_select on public.payouts for select to authenticated
  using (tenant_id = any ((select app.tenants_can('payroll'))::uuid[]));
create policy payouts_insert on public.payouts for insert to authenticated
  with check (tenant_id = any ((select app.tenants_can('payroll', 'write'))::uuid[]));
create trigger payouts_audit after insert on public.payouts for each row execute function app.audit_row();
create trigger payouts_stamp before insert on public.payouts for each row execute function app.stamp_member('by_member_id');
create trigger payouts_no_update before update on public.payouts for each row execute function app.block_change();
create trigger payouts_no_delete before delete on public.payouts for each row execute function app.block_change();
create trigger payouts_no_truncate before truncate on public.payouts for each statement execute function app.block_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- The gateway. After the clients, the catalog and the appointments; the walk-ins after the chairs and passes they name.
-- ---------------------------------------------------------------------------------------------------------------------
select app.ws_register($j${
  "name": "chairs", "ord": 114, "relation": "chairs",
  "read_caps": ["appointments"], "write_caps": ["appointments"], "delete_caps": ["config", "delete"], "order_by": "t.label, t.id",
  "fields": { "id": "id", "label": "label", "staffId": "member_id", "status": "status", "walkIns": "walk_ins", "pay": "pay", "split": "split",
              "ownSplit": "own_split", "rent": "rent", "skipServiceIds": "skip", "officeId": "office_id", "since": "since" }
}$j$);
select app.ws_register($j${
  "name": "passPlans", "ord": 115, "relation": "pass_plans",
  "read_caps": ["clients"], "write_caps": ["catalog"], "delete_caps": ["delete"], "order_by": "t.kind, t.name, t.id",
  "fields": { "id": "id", "kind": "kind", "name": "name", "i18n": "i18n", "price": "price", "visits": "visits", "interval": "interval",
              "serviceIds": { "col": "service_ids", "empty": [] }, "discount": "discount", "validDays": "valid_days", "perks": "perks", "active": "active" }
}$j$);
select app.ws_register($j${
  "name": "passes", "ord": 116, "relation": "passes",
  "read_caps": ["clients"], "write_caps": ["clients"], "delete_caps": ["delete"], "order_by": "t.start desc, t.created_at desc, t.id",
  "fields": { "id": "id", "planId": "plan_id", "kind": "kind", "clientId": "client_id", "holder": "holder", "code": "code", "status": "status",
              "start": "start", "renews": "renews", "visitsLeft": "visits_left", "balance": "balance", "expires": "expires", "sold": "sold",
              "uses": { "col": "uses", "empty": [] }, "note": "note" }
}$j$);
select app.ws_register($j${
  "name": "walkins", "ord": 117, "relation": "walkins",
  "read_caps": ["appointments"], "write_caps": ["appointments"], "delete_caps": ["delete"], "order_by": "t.joined desc, t.id",
  "fields": { "id": "id", "ticket": "ticket", "name": "name", "phone": "phone", "clientId": "client_id", "serviceId": "service_id",
              "prefStaffId": "pref_member_id", "joined": "joined", "status": "status", "staffId": "member_id", "chairId": "chair_id",
              "calledAt": "called_at", "startedAt": "started_at", "doneAt": "done_at", "amount": "amount", "tip": "tip", "method": "method",
              "passId": "pass_id", "source": "source", "textOk": "text_ok", "note": "note", "by": { "col": "by_member_id", "stamp": "member" } }
}$j$);
select app.ws_register($j${
  "name": "payouts", "ord": 118, "relation": "payouts",
  "read_caps": ["payroll"], "write_caps": ["payroll"], "delete_caps": [], "order_by": "t.period_from desc, t.id",
  "fields": { "id": "id", "staffId": "member_id", "from": "period_from", "to": "period_to", "services": "services", "share": "share", "tips": "tips",
              "rent": "rent", "amount": "amount", "visits": "visits", "paidAt": "paid_at", "method": "method",
              "by": { "col": "by_member_id", "stamp": "member" }, "note": "note" }
}$j$);

select app.lockdown_check();
