-- Module tests, part 9: the barbershop edition and its shop floor (0063). Company S is a barbershop.
--   the edition's role matrix; who may change a chair's pay; a served walk-in is a record; a pass's sale and its ledger
--   never change and a gift card only goes down; payouts are written once, for a whole week, adding up to the cent;
--   another company sees none of it; the shop events are accepted by the rules table.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('40. the barbershop shop floor') \g /dev/null

select test.seed_company('s', 'sample-shop', 'barber', 'quoted') \g /dev/null
insert into public.offices (tenant_id, name, address, timezone) select test.id('s'), 'The shop', '45 Sample Boulevard', 'America/New_York' returning id \gset so_
select test.remember('s.o1', :'so_id') \g /dev/null
insert into public.catalog_services (tenant_id, name, category) values (test.id('s'), 'Classic haircut', 'haircut') returning id \gset ss_
select test.remember('s.s1', :'ss_id') \g /dev/null
select test.seed_shop('s') \g /dev/null

-- the edition
select test.is(app.edition_family('barber'), 'practice', 'the barbershop belongs to the appointment family') \g /dev/null
select test.ok(app.role_permissions('barber', 'staff') @> array['appointments', 'money', 'cash', 'write'] and not app.role_permissions('barber', 'staff') @> array['payroll'],
  'a barber works the floor and takes payments, and never sees anyone''s pay') \g /dev/null
select test.ok(app.role_permissions('barber', 'manager') @> array['payroll', 'reports', 'automations'], 'the shop manager pays the barbers') \g /dev/null
select test.ok(not app.role_permissions('barber', 'readonly') @> array['write'], 'view only changes nothing') \g /dev/null

-- chairs
select test.is(test.as('s_staff', format($q$update public.chairs set status = 'break' where id = %L$q$, test.id('s.chair1'))), 'rows:1', 'a barber sets their chair on a break') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.chairs set split = 90 where id = %L$q$, test.id('s.chair1'))), 'error:42501', 'but never changes their own split') \g /dev/null
select test.is(test.as('s_manager', format($q$update public.chairs set rent = 0, pay = 'rent' where id = %L$q$, test.id('s.chair1'))), 'error:42501', 'the shop manager does not change pay either: that is configuration') \g /dev/null
select test.is(test.as('s_owner', format($q$update public.chairs set split = 65 where id = %L$q$, test.id('s.chair1'))), 'rows:1', 'the owner does') \g /dev/null
select test.is(test.as('s_staff', format($q$insert into public.chairs (tenant_id, label) values (%L, 'Chair 9')$q$, test.id('s'))), 'error:42501', 'a barber does not add chairs') \g /dev/null
select test.is(test.as('s_owner', format($q$insert into public.chairs (tenant_id, label, member_id) values (%L, 'Chair 9', %L)$q$, test.id('s'), test.id('s.m_staff'))), 'error:23505', 'one chair per barber') \g /dev/null
select test.is(test.as('s_owner', format($q$insert into public.chairs (tenant_id, label, pay) values (%L, 'Chair 9', 'rent')$q$, test.id('s'))), 'error:23514', 'a rented chair has its rent') \g /dev/null

-- walk-ins
select test.is(test.as('s_staff', format($q$insert into public.walkins (tenant_id, ticket, name, source) values (%L, 3, 'New Guest', 'kiosk')$q$, test.id('s'))), 'rows:1', 'a barber adds a walk-in') \g /dev/null
select test.ok((select by_member_id = test.id('s.m_staff') from public.walkins where tenant_id = test.id('s') and name = 'New Guest'), 'in their own name, whatever the row said') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.walkins set status = 'done' where id = %L$q$, test.id('s.walk_wait'))), 'error:23514', 'a visit is done only with who served it and how it was paid') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.walkins set tip = 50 where id = %L$q$, test.id('s.walk_done'))), 'error:42501', 'a served visit is a record: the tip is not rewritten') \g /dev/null
select test.is(test.as('s_owner', format($q$update public.walkins set amount = 1, method = 'card' where id = %L$q$, test.id('s.walk_done'))), 'error:42501', 'not even by the owner') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.walkins set note = 'Asked for a lineup next time' where id = %L$q$, test.id('s.walk_done'))), 'rows:1', 'a note can still be added') \g /dev/null
select test.ok(test.blocked(test.as('s_readonly', format($q$update public.walkins set status = 'left' where id = %L$q$, test.id('s.walk_wait')))), 'view only changes nothing on the floor') \g /dev/null

-- passes: the sale and the ledger
select test.is(test.as('s_staff', format($q$update public.passes set uses = uses || '[{"id":"u2","at":"2026-01-01T10:00:00Z","amount":30}]'::jsonb, visits_left = 0 where id = %L$q$, test.id('s.pass1'))), 'rows:1',
  'a use is added to the ledger') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.passes set uses = '[]'::jsonb where id = %L$q$, test.id('s.pass1'))), 'error:42501', 'recorded uses are never removed') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.passes set uses = jsonb_set(uses, '{0,amount}', '1') where id = %L$q$, test.id('s.pass1'))), 'error:42501', 'nor rewritten') \g /dev/null
select test.is(test.as('s_owner', format($q$update public.passes set sold = jsonb_set(sold, '{amount}', '1') where id = %L$q$, test.id('s.pass1'))), 'error:42501', 'what was sold is a record') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.passes set visits_left = 2 where id = %L$q$, test.id('s.pass1'))), 'rows:1', 'a membership renewal gives the visits back') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.passes set balance = 500 where id = %L$q$, test.id('s.gift1'))), 'error:42501', 'a gift card balance only goes down') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.passes set balance = -5 where id = %L$q$, test.id('s.gift1'))), 'error:23514', 'and never below zero') \g /dev/null
select test.is(test.as('s_staff', format($q$insert into public.passes (tenant_id, kind, holder, code, sold) values (%L, 'gift_card', 'Copy', %L, '{"amount":10,"method":"cash"}')$q$, test.id('s'), 'SGC1-AB23')), 'error:23505', 'a gift card code is used once per shop') \g /dev/null
select test.is(test.as('s_staff', format($q$insert into public.passes (tenant_id, kind, holder, sold) values (%L, 'gift_card', 'Odd', '{"amount":10,"method":"bitcoin"}')$q$, test.id('s'))), 'error:23514', 'a sale is paid with a method the shop records') \g /dev/null
select test.is(test.as('s_staff', format($q$update public.pass_plans set price = 1 where id = %L$q$, test.id('s.plan1'))), 'rows:1', 'a barber with the catalog changes a plan') \g /dev/null
select test.ok(test.blocked(test.as('s_readonly', format($q$update public.pass_plans set price = 2 where id = %L$q$, test.id('s.plan1')))), 'view only does not') \g /dev/null

-- payouts
select test.is(test.as('s_staff', format('select 1 from public.payouts where tenant_id = %L', test.id('s'))), 'rows:0', 'a barber does not see anyone''s pay') \g /dev/null
select test.is(test.as('s_manager', format('select 1 from public.payouts where tenant_id = %L', test.id('s'))), 'rows:1', 'the shop manager does') \g /dev/null
select test.is(test.as('s_manager', format($q$insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method) values (%L, %L, %L, %L, 80, 40, 10, 0, 50, 2, 'cash')$q$,
  test.id('s'), test.id('s.m_staff'), date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)), 'rows:1', 'last week is paid') \g /dev/null
select test.ok((select by_member_id = test.id('s.m_manager') from public.payouts where tenant_id = test.id('s') and period_from = date_trunc('week', current_date)::date - 7), 'in the name of who paid') \g /dev/null
select test.is(test.as('s_manager', format($q$insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method) values (%L, %L, %L, %L, 80, 40, 10, 0, 50, 2, 'cash')$q$,
  test.id('s'), test.id('s.m_staff'), date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)), 'error:23505', 'a week is paid once') \g /dev/null
select test.is(test.as('s_manager', format($q$insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method) values (%L, %L, %L, %L, 80, 40, 10, 0, 49.99, 2, 'cash')$q$,
  test.id('s'), test.id('s.m_owner'), date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1)), 'error:23514', 'the amount is share plus tips minus rent, to the cent') \g /dev/null
select test.is(test.as('s_manager', format($q$insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method) values (%L, %L, %L, %L, 0, 0, 0, 0, 0, 0, 'cash')$q$,
  test.id('s'), test.id('s.m_owner'), date_trunc('week', current_date)::date - 6, date_trunc('week', current_date)::date)), 'error:23514', 'a week starts on Monday') \g /dev/null
select test.is(test.as('s_manager', format($q$insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method) values (%L, %L, %L, %L, 0, 0, 0, 0, 0, 0, 'cash')$q$,
  test.id('s'), test.id('s.m_owner'), date_trunc('week', current_date)::date + 7, date_trunc('week', current_date)::date + 13)), 'error:23514', 'a week that has not ended is not paid') \g /dev/null
select test.ok(test.blocked(test.as('s_owner', format($q$update public.payouts set amount = 0 where tenant_id = %L$q$, test.id('s')))), 'a payout is never changed') \g /dev/null
select test.ok(test.blocked(test.as('s_owner', format($q$delete from public.payouts where tenant_id = %L$q$, test.id('s')))), 'nor removed') \g /dev/null
select test.is(test.as('s_staff', format($q$insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method) values (%L, %L, %L, %L, 0, 0, 0, 0, 0, 0, 'cash')$q$,
  test.id('s'), test.id('s.m_staff'), date_trunc('week', current_date)::date - 21, date_trunc('week', current_date)::date - 15)), 'error:42501', 'a barber does not pay themselves') \g /dev/null

-- isolation
select test.ok(test.blocked(test.as('a_owner', format('select 1 from public.chairs where tenant_id = %L', test.id('s')))), 'another company''s owner sees no chair of the shop') \g /dev/null
select test.ok(test.blocked(test.as('a_owner', format('select 1 from public.walkins where tenant_id = %L', test.id('s')))), 'no walk-in') \g /dev/null
select test.ok(test.blocked(test.as('a_owner', format('select 1 from public.passes where tenant_id = %L', test.id('s')))), 'no pass') \g /dev/null
select test.ok(test.blocked(test.as('a_owner', format('select 1 from public.payouts where tenant_id = %L', test.id('s')))), 'no payout') \g /dev/null
select test.ok(test.blocked(test.as('a_owner', format($q$update public.chairs set status = 'off' where tenant_id = %L$q$, test.id('s')))), 'and changes none of them') \g /dev/null

-- the shop events are rule events
select test.is(test.as('s_owner', format($q$insert into public.rules (tenant_id, rule_id, name, event, conditions, steps) values (%L, 'b-test', '{"en":"T","es":"T"}', 'walkin.joined', '[{"field":"extra.wait","op":"gt","value":45}]', '[{"do":"notify","params":{"who":"manager","text":"Long wait"}}]')$q$, test.id('s'))), 'rows:1',
  'a rule starts from someone joining the walk-in line') \g /dev/null
select test.is(test.as('s_owner', format($q$insert into public.rules (tenant_id, rule_id, name, event) values (%L, 'b-test2', '{"en":"T","es":"T"}', 'walkin.teleported')$q$, test.id('s'))), 'error:23514', 'an event the engine does not know is refused') \g /dev/null

-- what the shop loads
select test.load('s_owner', 's') as sl \gset
select test.ok(jsonb_array_length(:'sl'::jsonb -> 'chairs') = 2 and jsonb_array_length(:'sl'::jsonb -> 'walkins') = 3 and jsonb_array_length(:'sl'::jsonb -> 'passes') = 2
           and jsonb_array_length(:'sl'::jsonb -> 'passPlans') = 2 and jsonb_array_length(:'sl'::jsonb -> 'payouts') = 2 and :'sl'::jsonb ->> 'pack' = 'barber',
  'ws_load: the owner gets the shop floor lists') \g /dev/null
select test.load('s_staff', 's') as st \gset
select test.ok(jsonb_array_length(:'st'::jsonb -> 'payouts') = 0 and jsonb_array_length(:'st'::jsonb -> 'walkins') = 3, 'a barber loads the floor and no payouts') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '40. the barbershop shop floor' group by section;
