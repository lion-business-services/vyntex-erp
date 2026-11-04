-- 0083: cancel the free trial in one click (owner decision of November 4, 2026).
--
-- A Stripe trial is cancelled at Stripe (cancel_at_period_end on the trialing subscription, api/_lib/billing/core.js
-- cancelTrial): nothing is charged, the workspace stays open until the last trial day, then Stripe ends the
-- subscription and billing_sync (0066) pauses the company with every record kept. The flag comes back through
-- billing_sync, so the reminders before the first charge (charge_3d, charge_1d) already skip it.
-- A quoted edition's trial (card saved, no charge ever scheduled) has no subscription: the server removes the saved
-- cards from Stripe and marks the trial cancelled here, so its trial reminders stop too.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.billing_trial_cancel(p_tenant uuid) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.plan_id = 'trial' and t.status = 'active') then return false; end if;
  insert into app.billing_accounts as a (tenant_id, cancel_at_period_end, updated_at) values (p_tenant, true, pg_catalog.now())
  on conflict (tenant_id) do update set cancel_at_period_end = true, updated_at = pg_catalog.now();
  perform app.security_event(p_tenant, null, 'trial.cancelled', 'ok', null, '{}'::jsonb);
  return true;
end
$$;
revoke all on function public.billing_trial_cancel(uuid) from public, anon, authenticated;
grant execute on function public.billing_trial_cancel(uuid) to service_role;

-- the trial reminders ("choose a plan") are not sent for a trial its owner cancelled
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
       and not exists (select 1 from app.billing_accounts a where a.tenant_id = t.id and a.cancel_at_period_end)
    union all
    select t.id, t.slug, t.name, 'trial_1d', pg_catalog.to_char(t.trial_expires_at, 'YYYY-MM-DD'), t.trial_expires_at
      from public.tenants t where t.plan_id = 'trial' and t.trial_expires_at between pg_catalog.now() and pg_catalog.now() + interval '1 day'
       and not exists (select 1 from app.billing_accounts a where a.tenant_id = t.id and a.cancel_at_period_end)
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
