-- 0078: the public seven-day trial, and the numbers the Team page and the invitation route need for seat limits.
--
-- TRIALS. Owner decision of October 29, 2026: anyone may start a seven-day trial of VYNTEX ERP from
-- erp.vyntexusa.com/start-trial. 0066 had taken the public request functions of 0064 away from the server; this file
-- gives them back to the server key (service role) only. A visitor, a signed-in person and the public still cannot call
-- them: api/auth.js (route trial/request) does, after its own checks (csrf, rate limits, validation, honeypot).
-- What does not change:
--   * one trial per email address, ever (app.trial_registrations, shared with the operator's trials of 0066)
--   * the answer for an address that already had a trial is the same 'accepted' as for a new one: nothing tells the
--     requester whether an address is known
--   * the company waits in onboarding with no clock; the clock (7 days) starts when the owner accepts the invitation,
--     through the trigger of 0064 (app.trial_start_on_owner), exactly as for an operator's trial
-- What is new in trial_request_create:
--   * only an edition with published plans (the pricing file) can start a self-serve trial: a quoted edition answers
--     'quoted_edition' (the page then sends the visitor to Request a demo). The list is app.trial_editions(), kept equal
--     to the pricing file by scripts/check-pricing.mjs
--   * the email hash is computed here from the address (the same SHA-256 the operator path of 0066 uses), so the two
--     paths always agree on "this address already had a trial", whatever the caller sends
--   * trial_request_cancel closes the company and releases its address word instead of deleting it (the delete of 0064
--     is refused by the append-only audit trail)
--   * the clock is exactly 168 hours (0064 added '7 days', which is 7 days and an hour across a daylight-saving change)
--   * a competing request that takes the same address word at the same moment answers 'slug_taken' (the server tries
--     another word) instead of 'accepted'; a competing request for the same email still answers 'accepted'
--
-- SEATS. public.seat_usage(p_tenant): how many people of a company count against its plan's users (active office
-- members plus open office invitations; field workers on the portal do not count). The limit itself is read from the
-- pricing file by the server (src/lib/seats.ts in api/_lib/domain.bundle.mjs), never typed here.

-- ---------------------------------------------------------------------------------------------------------------------
-- Reserved addresses: the trial page lives at /start-trial, so no company can be called that
-- (kept equal to RESERVED_SLUGS in src/platform/mode.ts; supabase/tests/parity.mjs compares the two)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.reserved_slugs() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array[
    'demo', 'pricing', 'request-demo', 'api', 'assets', 'brand', 'login', 'logout', 'signup', 'signin', 'register',
    'auth', 'callback', 'invite', 'reset-password', 'admin', 'app', 'www', 'static', 'public', 'settings', 'account',
    'billing', 'checkout', 'pay', 'webhooks', 'support', 'help', 'docs', 'legal', 'privacy', 'terms', 'about',
    'contact', 'blog', 'status', 'health', 'new', 'onboarding', 'portal', 'worker', 'client', 'dashboard', 'sign',
    'vyntex', 'null', 'undefined',
    'preview', 'review', 'book', 'mfa',
    'partners', 'partner', 'proposal',
    'start-trial'
  ]::text[]
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The editions that can start a self-serve trial: exactly the editions of config/vyntex-build-pricing.json
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.trial_editions() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array['build', 'clean', 'landscape', 'wash', 'haul', 'snow', 'turnover', 'events']::text[]
$$;
revoke all on function app.trial_editions() from public, anon, authenticated, service_role;

create or replace function public.trial_request_create(
  p_slug text, p_name text, p_industry text, p_email text,
  p_owner_name text, p_email_hash text, p_token_hash text
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_hash text;
  v_tenant uuid;
begin
  if not app.is_valid_slug(v_slug) then return 'bad_slug'; end if;
  if pg_catalog.length(v_name) not between 2 and 200 then return 'bad_name'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or pg_catalog.length(v_email) > 320
    then return 'bad_email'; end if;
  if coalesce(p_email_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
    then return 'invalid'; end if;
  if not exists (select 1 from public.industries i where i.id = p_industry and i.active)
    then return 'bad_industry'; end if;
  if not (p_industry = any (app.trial_editions())) then return 'quoted_edition'; end if;
  -- the same hash as the operator's trials (0066): one trial per address across both paths
  v_hash := pg_catalog.encode(extensions.digest(v_email, 'sha256'), 'hex');
  -- One trial per email. Never reveal to the requester whether an account already exists.
  if exists (select 1 from app.trial_registrations r where r.email_hash = v_hash) then return 'accepted'; end if;
  if exists (select 1 from public.tenants t where t.slug = v_slug) then return 'slug_taken'; end if;
  insert into public.tenants (slug, name, industry_id, plan_id, status)
  values (v_slug, v_name, p_industry, 'trial', 'onboarding')
  returning id into v_tenant;
  insert into app.trial_registrations (tenant_id, email_hash) values (v_tenant, v_hash);
  insert into app.invitations (tenant_id, email, name, role, token_hash, invited_by, expires_at)
  values (v_tenant, v_email, pg_catalog.left(pg_catalog.btrim(coalesce(p_owner_name, '')), 200),
    'owner', p_token_hash, null, pg_catalog.now() + interval '72 hours');
  perform app.security_event(v_tenant, null, 'trial.requested', 'info', null,
    pg_catalog.jsonb_build_object('slug', v_slug, 'industry', p_industry, 'source', 'public'));
  return 'created';
exception when unique_violation then
  -- Competing requests: the same address again is 'accepted' (no way to enumerate email identities); the same
  -- address word taken a moment earlier by somebody else is 'slug_taken', so the server tries another word.
  if exists (select 1 from app.trial_registrations r where r.email_hash = v_hash) then return 'accepted'; end if;
  return 'slug_taken';
end
$$;
revoke all on function public.trial_request_create(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.trial_request_create(text, text, text, text, text, text, text) to service_role;

-- Undoing a request whose activation email could not be sent (the server calls it). 0064 deleted the company, which can
-- never work: the audit trail (0004, append-only) already holds the company's creation and keeps it. So the request is
-- undone without deleting anything that is audited: the unused invitation and the trial registration go (the address
-- may ask again), and the company is closed and its address word released (renamed to released-<id>), so the visitor
-- can ask again for the same name. Only a company in onboarding whose trial never started and whose invitation was
-- never used can be undone.
create or replace function public.trial_request_cancel(p_token_hash text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then return false; end if;
  select t.id into v_tenant from public.tenants t
    join app.trial_registrations r on r.tenant_id = t.id
    join app.invitations i on i.tenant_id = t.id
    where i.token_hash = p_token_hash and i.used_at is null and i.claimed_at is null
      and t.status = 'onboarding' and t.plan_id = 'trial' and r.started_at is null
      and not exists (select 1 from public.tenant_members m where m.tenant_id = t.id)
    for update of t;
  if v_tenant is null then return false; end if;
  delete from app.invitations where tenant_id = v_tenant and used_at is null;
  delete from app.trial_registrations where tenant_id = v_tenant and started_at is null;
  update public.tenants set status = 'closed',
    slug = 'released-' || pg_catalog.left(pg_catalog.replace(v_tenant::text, '-', ''), 24)
    where id = v_tenant;
  perform app.security_event(v_tenant, null, 'trial.cancelled', 'info', null, pg_catalog.jsonb_build_object('reason', 'email_failed'));
  return true;
end $$;
revoke all on function public.trial_request_cancel(text) from public, anon, authenticated;
grant execute on function public.trial_request_cancel(text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The clock: exactly 7 x 24 hours from the owner's activation
-- ---------------------------------------------------------------------------------------------------------------------
-- Same trigger as 0064 (operator trials and public trials alike), one change: "+ interval '7 days'" counts calendar days
-- in the session's time zone, so across a daylight-saving change it gave 7 days and one hour (and the banner said 8 days
-- left). '168 hours' is the same seven days everywhere.
create or replace function app.trial_start_on_owner() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.role = 'owner' and new.status = 'active' then
    update public.tenants t set status = 'active',
      trial_started_at = pg_catalog.now(), trial_expires_at = pg_catalog.now() + interval '168 hours'
      where t.id = new.tenant_id and t.status = 'onboarding'
       and t.plan_id = 'trial' and t.trial_started_at is null
       and exists (select 1 from app.trial_registrations r where r.tenant_id = t.id and r.started_at is null);
    if found then
      update app.trial_registrations r set started_at = pg_catalog.now()
       where r.tenant_id = new.tenant_id and r.started_at is null;
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.trial_start_on_owner() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Seats
-- ---------------------------------------------------------------------------------------------------------------------
-- For a member of the company (any role): its plan and edition, and how many people count against the plan's users.
-- Office roles only (owner, manager, staff, read-only); a field worker's portal account is not a user seat.
create or replace function public.seat_usage(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_plan text; v_industry text;
begin
  if app.member_role(p_tenant) is null then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  select t.plan_id, t.industry_id into v_plan, v_industry from public.tenants t where t.id = p_tenant;
  return pg_catalog.jsonb_build_object(
    'plan', v_plan, 'industry', v_industry,
    'members', (select pg_catalog.count(*) from public.tenant_members m
                 where m.tenant_id = p_tenant and m.status = 'active' and m.role <> 'worker'),
    'invites', (select pg_catalog.count(*) from app.invitations i
                 where i.tenant_id = p_tenant and i.role <> 'worker' and i.used_at is null and i.revoked_at is null
                   and i.expires_at > pg_catalog.now()));
end
$$;
revoke all on function public.seat_usage(uuid) from public, anon, service_role;
grant execute on function public.seat_usage(uuid) to authenticated;
