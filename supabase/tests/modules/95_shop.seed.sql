-- Sample rows for the tables of 0063 (the barbershop shop floor): a chair with its barber, a membership plan and a gift
-- card plan, a membership and a gift card a client holds (one use each), a walk-in served and paid, one waiting, and a
-- weekly payout. Every company gets the same shape, so the isolation checks have something to look at.
create function test.seed_shop(p text) returns void language plpgsql as $$
declare
  t uuid := test.id(p); ch uuid; pl uuid; gp uuid; ps uuid; x uuid;
  monday date := (date_trunc('week', current_date)::date - 14);
begin
  insert into public.chairs (tenant_id, label, member_id, status, walk_ins, pay, split, own_split, office_id)
    values (t, 'Chair 1', test.id(p || '.m_staff'), 'open', true, 'commission', 60, 100, test.id(p || '.o1')) returning id into ch;
  perform test.remember(p || '.chair1', ch);
  insert into public.chairs (tenant_id, label, pay, rent, status) values (t, 'Chair 2', 'rent', 120, 'off');
  insert into public.pass_plans (tenant_id, kind, name, i18n, price, visits, "interval", service_ids, discount)
    values (t, 'membership', 'Cut Club ' || p, '{"es":{"name":"Club del Corte"}}', 60, 2, 'month', array[test.id(p || '.s1')], 10) returning id into pl;
  insert into public.pass_plans (tenant_id, kind, name, price, valid_days) values (t, 'gift_card', 'Gift card ' || p, 50, 365) returning id into gp;
  perform test.remember(p || '.plan1', pl);
  insert into public.passes (tenant_id, plan_id, kind, client_id, status, start, renews, visits_left, sold, uses)
    values (t, pl, 'membership', test.id(p || '.c1'), 'active', current_date - 20, current_date + 10, 1,
            jsonb_build_object('at', now() - interval '20 days', 'amount', 60, 'method', 'card', 'by', test.id(p || '.m_staff')),
            jsonb_build_array(jsonb_build_object('id', 'u1', 'at', now() - interval '5 days', 'amount', 30, 'by', test.id(p || '.m_staff')))) returning id into ps;
  perform test.remember(p || '.pass1', ps);
  insert into public.passes (tenant_id, plan_id, kind, holder, code, status, balance, expires, sold, uses)
    values (t, gp, 'gift_card', 'Gift for a friend', upper(p) || 'GC1-AB23', 'active', 30, current_date + 300,
            jsonb_build_object('at', now() - interval '9 days', 'amount', 50, 'method', 'cash'),
            jsonb_build_array(jsonb_build_object('id', 'g1', 'at', now() - interval '2 days', 'amount', 20))) returning id into x;
  perform test.remember(p || '.gift1', x);
  insert into public.walkins (tenant_id, ticket, name, phone, client_id, service_id, joined, status, member_id, chair_id, called_at, started_at, done_at, amount, tip, method, source, text_ok, by_member_id)
    values (t, 1, 'Served Guest', '555-0199', test.id(p || '.c1'), test.id(p || '.s1'), now() - interval '90 minutes', 'done', test.id(p || '.m_staff'), ch,
            now() - interval '80 minutes', now() - interval '79 minutes', now() - interval '45 minutes', 35, 7, 'cash', 'desk', true, test.id(p || '.m_staff')) returning id into x;
  perform test.remember(p || '.walk_done', x);
  insert into public.walkins (tenant_id, ticket, name, service_id, joined, status, source, by_member_id)
    values (t, 2, 'Waiting Guest', test.id(p || '.s1'), now() - interval '10 minutes', 'waiting', 'kiosk', test.id(p || '.m_staff')) returning id into x;
  perform test.remember(p || '.walk_wait', x);
  insert into public.payouts (tenant_id, member_id, period_from, period_to, services, share, tips, rent, amount, visits, method, by_member_id)
    values (t, test.id(p || '.m_staff'), monday, monday + 6, 100, 60, 12, 0, 72, 3, 'transfer', test.id(p || '.m_owner'));
end $$;
select test.seed_shop('a') \g /dev/null
select test.seed_shop('b') \g /dev/null
select test.seed_shop('c') \g /dev/null
