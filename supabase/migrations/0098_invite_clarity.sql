-- 0098: invitations say exactly what is wrong, and an invitation that cannot work is never sent (owner report of
-- November 6, 2026: accepting an invitation said "invitation expired" seconds after it was opened).
--   * Cause: the invited address was a VYNTEX Partner Portal account. A partner account cannot join a company workspace
--     (0070, tenant_members_00_not_partner), so the last step was refused, and the server reported every refusal as
--     "this invitation does not work any more".
--   * app.invitation_not_partner: an invitation to an active partner account is refused when it is made, with the word
--     partner_account, so the Team screen says why and nobody receives a link that cannot work
--   * public.invite_state / public.partner_invite_state (server only): what an invitation is now, so a refused claim is
--     said as it is: accepted already, expired, withdrawn, the company closed, or busy with another attempt (2 minutes)
-- Check after applying:
--   select pg_catalog.has_function_privilege('service_role', 'public.invite_state(text)', 'execute'),
--          pg_catalog.has_function_privilege('authenticated', 'public.invite_state(text)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.invitation_not_partner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from partner.users p where p.email = pg_catalog.lower(new.email) and p.status <> 'removed') then
    raise exception 'partner_account' using errcode = 'P0001', hint = 'partner_account';
  end if;
  return new;
end $$;
revoke all on function app.invitation_not_partner() from public, anon, authenticated;
drop trigger if exists invitations_not_partner on app.invitations;
create trigger invitations_not_partner before insert on app.invitations for each row execute function app.invitation_not_partner();

-- what a company invitation is now: 'open', 'busy', 'used', 'expired', 'revoked', 'closed' or 'unknown'
create or replace function public.invite_state(p_token_hash text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when i.used_at is not null then 'used'
      when i.revoked_at is not null then 'revoked'
      when not exists (select 1 from public.tenants t where t.id = i.tenant_id and t.status <> 'closed') then 'closed'
      when i.expires_at <= pg_catalog.now() then 'expired'
      when i.claimed_at is not null and i.claimed_at >= pg_catalog.now() - interval '2 minutes' then 'busy'
      else 'open' end
    from app.invitations i where i.token_hash = p_token_hash), 'unknown')
$$;

-- the same for a Partner Portal invitation
create or replace function public.partner_invite_state(p_token_hash text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when i.used_at is not null then 'used'
      when i.revoked_at is not null then 'revoked'
      when i.partner_id is not null and not exists (select 1 from partner.organizations o where o.id = i.partner_id and o.status = 'active') then 'closed'
      when i.expires_at <= pg_catalog.now() then 'expired'
      when i.claimed_at is not null and i.claimed_at >= pg_catalog.now() - interval '2 minutes' then 'busy'
      else 'open' end
    from partner.invitations i where i.token_hash = p_token_hash), 'unknown')
$$;

revoke all on function public.invite_state(text), public.partner_invite_state(text) from public, anon, authenticated;
grant execute on function public.invite_state(text), public.partner_invite_state(text) to service_role;
