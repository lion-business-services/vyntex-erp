-- Module tests, part 12: the VYNTEX Partner Portal (0070-0076).
--   who gets in (partner and staff roles in the database, the second sign-in step, invitations, suspension, the
--   separation from company workspaces); the imported catalog and its governance; offers priced by the server, the
--   approval queue, frozen proposals; orders and their state machine; the commission engine (eligibility from verified
--   payments and go-live only, policy versions, rounding, monthly shares, refunds, clawbacks); payouts (W-9 gate, no
--   double payment, paid only when settled); isolation between partners on every path.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
select set_config('app.settings.pii_encryption_key', 'local-test-key-0123456789-abcdefghijklmnop', false) \g /dev/null
select set_config('app.settings.ip_hash_salt', 'local-test-salt-0123456789', false) \g /dev/null
select test.begin_section('43. the partner portal') \g /dev/null

create or replace function test.err(r jsonb) returns text language sql immutable as $$ select r ->> 'error' $$;
-- A statement run by the database owner itself (no role, no row security): 'ok' or 'error:<sqlstate>'.
create or replace function test.raw(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'error:' || sqlstate;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- People. Staff are added from the SQL editor only (partner.staff_add), never by email comparison in code.
-- ---------------------------------------------------------------------------------------------------------------------
select test.new_user('pt_admin') \g /dev/null
select test.new_user('pt_mgr') \g /dev/null
select test.new_user('pt_a1') \g /dev/null
select test.new_user('pt_a2') \g /dev/null
select test.new_user('pt_b1') \g /dev/null
select test.new_user('pt_nobody') \g /dev/null
select partner.staff_add('pt_admin@example.com', 'partner_admin') \g /dev/null
select partner.staff_add('pt_mgr@example.com', 'partner_manager') \g /dev/null

select test.is(test.as('pt_a1', $q$select partner.staff_add('pt_a1@example.com', 'partner_admin')$q$), 'error:42501', 'nobody signed in can make themselves partner staff') \g /dev/null
select test.is(test.as('pt_a1', $q$select 1 from partner.staff$q$), 'error:42501', 'the partner schema is closed to signed-in people') \g /dev/null
select test.is(test.as('anon', $q$select public.partner_context()$q$), 'error:42501', 'the anonymous role runs no partner function') \g /dev/null
select test.is(test.as('anon', $q$select public.partner_proposal_peek('x')$q$), 'error:42501', 'not even the proposal reader: the server reads proposals') \g /dev/null
select test.ok('partners' = any (app.reserved_slugs()) and 'proposal' = any (app.reserved_slugs()), 'partners and proposal are reserved addresses') \g /dev/null

-- the second sign-in step is required by the database itself
select test.login_session('pt_admin', 'aal1') \g /dev/null
do $$ begin perform public.partner_admin_partners(); raise exception 'FAILED: aal1 staff reached the partner list'; exception when sqlstate 'VX402' then null; end $$;
select test.logout() \g /dev/null
select test.ok(true, 'staff without the second step are refused (VX402)') \g /dev/null

-- partners
select (test.j('pt_admin', $q$select public.partner_admin_partner_save(null, '{"name":"Alpha Growth Partners","kind":"revshare","contact_email":"Ops@Alpha.example","lang":"en","internal_notes":"secret note"}')$q$)) ->> 'id' as pa \gset
select (test.j('pt_mgr', $q$select public.partner_admin_partner_save(null, '{"name":"Bravo Referrals","kind":"referral","contact_email":"hi@bravo.example","lang":"es"}')$q$)) ->> 'id' as pb \gset
select test.ok(:'pa' is not null and :'pb' is not null, 'staff (admin and manager) create partners') \g /dev/null
select test.is(test.err(test.j('pt_mgr', format($q$select public.partner_admin_partner_save(%L, '{"name":"Alpha Growth Partners","kind":"referral","contact_email":"ops@alpha.example"}')$q$, :'pa'))), '42501', 'a manager cannot change how a partner is paid (lane)') \g /dev/null

-- invitations: hashed token, one use, never a company membership
select test.j('pt_admin', format($q$select public.partner_admin_invite(%L, 'pt_a1@example.com', 'Ana Alpha', 'partner_owner', %L)$q$, :'pa', repeat('a', 64))) \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_invite(%L, 'pt_b1@example.com', 'Beto Bravo', 'partner_owner', %L)$q$, :'pb', repeat('b', 64))) \g /dev/null
select test.j('pt_mgr', format($q$select public.partner_admin_invite(%L, 'a_owner@example.com', 'Customer', 'partner_member', %L)$q$, :'pa', repeat('c', 64))) \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_invite_claim(%L)$q$, repeat('a', 64)))), '42501', 'only the server accepts invitations') \g /dev/null
select test.ok((test.j('service', format($q$select public.partner_invite_peek(%L)$q$, repeat('a', 64))) ->> 'partner') = 'Alpha Growth Partners', 'the invitation page sees the partner name') \g /dev/null
select test.j('service', format($q$select public.partner_invite_claim(%L)$q$, repeat('a', 64))) \g /dev/null
select test.ok(test.j('service', format($q$select public.partner_invite_claim(%L)$q$, repeat('a', 64))) is null, 'a claimed invitation cannot be claimed twice at once') \g /dev/null
select test.is(test.err(test.j('service', format($q$select public.partner_invite_complete(%L, %L, 'Ana')$q$, repeat('a', 64), test.id('pt_b1')))), '22023', 'an invitation is used only by the account of its own address') \g /dev/null
select test.j('service', format($q$select public.partner_invite_complete(%L, %L, 'Ana Alpha')$q$, repeat('a', 64), test.id('pt_a1'))) \g /dev/null
select test.ok(test.j('service', format($q$select public.partner_invite_peek(%L)$q$, repeat('a', 64))) is null, 'a used invitation is gone') \g /dev/null
select test.j('service', format($q$select public.partner_invite_claim(%L)$q$, repeat('b', 64))) \g /dev/null
select test.j('service', format($q$select public.partner_invite_complete(%L, %L, 'Beto')$q$, repeat('b', 64), test.id('pt_b1'))) \g /dev/null
select test.j('service', format($q$select public.partner_invite_claim(%L)$q$, repeat('c', 64))) \g /dev/null
select test.is(test.err(test.j('service', format($q$select public.partner_invite_complete(%L, %L, 'C')$q$, repeat('c', 64), test.id('a_owner')))), '42501',
  'an ERP customer account does not become a partner account') \g /dev/null
select test.ok(not exists (select 1 from public.tenant_members m where m.user_id in (test.id('pt_a1'), test.id('pt_b1'))), 'accepting creates no company membership') \g /dev/null
select test.is(test.raw(format($q$insert into public.tenant_members (tenant_id, user_id, role, name, email) values (%L, %L, 'owner', 'X', 'pt_a1@example.com')$q$, test.id('a'), test.id('pt_a1'))),
  'error:42501', 'a partner account cannot be put into a company workspace') \g /dev/null
update partner.invitations set expires_at = now() - interval '1 second', created_at = now() - interval '73 hours' where token_hash = repeat('c', 64) \g /dev/null
select test.ok(test.j('service', format($q$select public.partner_invite_peek(%L)$q$, repeat('c', 64))) is null, 'an expired invitation is gone') \g /dev/null

-- what sign-in learns
select test.ok((test.j('pt_a1', 'select public.auth_context()') -> 'partner' ->> 'kind') = 'partner' and (test.j('pt_a1', 'select public.auth_context()') -> 'partner' ->> 'mfa_required')::boolean,
  'auth_context reports the partner role and requires the authenticator app (G1)') \g /dev/null
select test.is(test.j('pt_admin', 'select public.auth_context()') -> 'partner' ->> 'role', 'partner_admin', 'and the staff role') \g /dev/null
select test.ok(test.j('a_owner', 'select public.auth_context()') -> 'partner' = 'null'::jsonb, 'a company owner has no partner role') \g /dev/null
select test.is(test.err(test.j('a_owner', $q$select public.partner_catalog('client')$q$)), '42501', 'an ERP customer cannot open the portal') \g /dev/null
select test.is(test.err(test.j('pt_a1', 'select public.partner_admin_partners()')), '42501', 'a partner cannot open the partner list') \g /dev/null
select test.ok(test.j('pt_a1', 'select public.partner_context()') -> 'partner' ->> 'name' = 'Alpha Growth Partners', 'the partner sees its own partner') \g /dev/null
select test.ok(not (test.j('pt_a1', 'select public.partner_context()')::text like '%secret note%'), 'and never the internal notes about it') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- The imported catalog: nothing published, nothing approved
-- ---------------------------------------------------------------------------------------------------------------------
select test.is((select count(*)::text from partner.catalog_items), '37', 'the 37 service items are imported (ERP software is not: it comes from the pricing file)') \g /dev/null
select test.is((select count(*)::text from partner.catalog_versions where status = 'published'), '0', 'none of them is published by the import') \g /dev/null
select test.is((select count(*)::text from partner.policies), '19', 'the 19 commission policies are imported') \g /dev/null
select test.is((select count(*)::text from partner.policy_versions where status = 'approved'), '0', 'none of them is approved by the import') \g /dev/null
select test.ok((select bool_and(provenance ? 'source') from partner.policies), 'every policy keeps its source') \g /dev/null
select test.ok((select bool_and(provenance <> '{}'::jsonb) from partner.catalog_prices), 'every price keeps its source') \g /dev/null
select test.is((select jsonb_array_length(test.j('pt_a1', $q$select public.partner_catalog('client')$q$) -> 'items')::text), '0', 'the client view is empty until VYNTEX publishes') \g /dev/null

select test.is(test.err(test.j('pt_admin', 'select public.partner_admin_catalog_publish_ready()')), 'VX403', 'publishing needs a fresh identity check') \g /dev/null
select test.is(test.err(test.j('pt_mgr', 'select public.partner_admin_catalog_publish_ready()')), '42501', 'and an administrator') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.is(test.j('pt_admin', 'select public.partner_admin_catalog_publish_ready()') ->> 'items', '28', 'the 28 items whose figures come from an approved source are published at once') \g /dev/null
select test.ok((select count(*) = 9 from partner.catalog_items i where not exists (select 1 from partner.catalog_versions v where v.item_id = i.id and v.status = 'published')),
  'the 9 items with a conflict or a missing figure stay unpublished') \g /dev/null
select test.is(test.err(test.j('pt_admin', format($q$select public.partner_admin_catalog_publish(%L)$q$, (select id from partner.catalog_versions where item_id = 'web-custom')))), null,
  'a quote-only item can be published without a figure') \g /dev/null
select test.ok(exists (select 1 from jsonb_array_elements(test.j('pt_a1', $q$select public.partner_catalog('client')$q$) -> 'items') x where x ->> 'id' = 'web-custom' and (x ->> 'quote')::boolean and x -> 'prices' = '[]'::jsonb),
  'and shows "Request a quote", never a price') \g /dev/null

-- the client view hides every partner-only field (server-side projection)
select test.ok(not (test.j('pt_a1', $q$select public.partner_catalog('client')$q$)::text ~ '(floors|partner_notes|compensation|provenance|rate_bps|deposit_cents|approved_source)'),
  'the client view carries no partner pay, floors, notes or sources') \g /dev/null
select test.ok((select (x -> 'prices') @> '[{"kind":"setup","amount_cents":89700},{"kind":"recurring","amount_cents":34700,"period":"month"}]'::jsonb
                from jsonb_array_elements(test.j('pt_a1', $q$select public.partner_catalog('client')$q$) -> 'items') x where x ->> 'id' = 'starter'),
  'Starter shows $897 setup and $347 a month, as the approved source') \g /dev/null
select test.ok(not (test.j('pt_a1', $q$select public.partner_catalog('client')$q$)::text like '%—%'), 'no em dash in client-facing text') \g /dev/null

-- the partner view: compensation needs approval until VYNTEX approves a policy version
select test.is((select x -> 'compensation' ->> 'status' from jsonb_array_elements(test.j('pt_a1', $q$select public.partner_catalog('partner')$q$) -> 'items') x where x ->> 'id' = 'starter'),
  'needs_approval', 'no earning is shown before a policy is approved') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_catalog('partner', %L)$q$, :'pb'))), '42501', 'a partner cannot preview another partner') \g /dev/null

-- policies: administrators approve, managers cannot
select test.is(test.err(test.j('pt_mgr', format($q$select public.partner_admin_policy_approve(%L)$q$, (select id from partner.policy_versions where policy_id = 'revshare-setup-20')))), '42501', 'a manager cannot approve a commission policy') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_admin_policy_approve(%L)$q$, (select id from partner.policy_versions where policy_id = 'revshare-setup-20')))), '42501', 'nor can a partner') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_policy_approve(%L)$q$, (select id from partner.policy_versions where policy_id = p and version = 1))) from unnest(array['revshare-setup-20', 'revshare-monthly-3', 'revshare-onetime-35', 'referral-flat-150', 'referral-flat-200', 'referral-flat-250']) p \g /dev/null
select test.is((select count(*)::text from partner.policy_versions where status = 'approved'), '6', 'six calculable policies approved') \g /dev/null
select test.is(test.err(test.j('pt_admin', format($q$select public.partner_admin_policy_approve(%L)$q$, (select id from partner.policy_versions where policy_id = 'referral-custom')))), '23514',
  'a rule with no figure cannot be approved as a paying policy') \g /dev/null
select test.ok(test.raw($q$update partner.policy_versions set rate_bps = 9000 where policy_id = 'revshare-setup-20' and status = 'approved'$q$) like 'error:%', 'an approved version is never edited') \g /dev/null
select test.ok((select (x -> 'compensation' -> 'lines') @> '[{"model":"revenue_share_setup","estimate_cents":17940},{"model":"revenue_share_recurring","estimate_cents":1041,"per":"month"}]'::jsonb
                from jsonb_array_elements(test.j('pt_a1', $q$select public.partner_catalog('partner')$q$) -> 'items') x where x ->> 'id' = 'starter'),
  'the revenue-share partner sees 20% of $897 = $179.40 and 3% of $347 = $10.41 a month, as estimates') \g /dev/null
select test.ok((select (x -> 'compensation' -> 'lines') @> '[{"model":"referral_flat_fee","estimate_cents":15000}]'::jsonb
                from jsonb_array_elements(test.j('pt_b1', $q$select public.partner_catalog('partner')$q$) -> 'items') x where x ->> 'id' = 'starter'),
  'the referral partner sees the $150 fee') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- Offers: the server prices, VYNTEX approves exceptions, a sent proposal is frozen
-- ---------------------------------------------------------------------------------------------------------------------
select test.j('pt_a1', $q$select public.partner_offer_save(null, '{"client_name":"Sunrise Cleaning","client_email":"Owner@Sunrise.example","lang":"es","discount_bps":1000,
  "lines":[{"item":"starter","quantity":1,"setup_cents":1}],"setup_cents":1,"recurring_cents":1}')$q$) as offer \gset
select :'offer'::jsonb ->> 'id' as of1 \gset
select test.ok((:'offer'::jsonb ->> 'setup_cents')::bigint = 80730 and (:'offer'::jsonb ->> 'recurring_cents')::bigint = 34700,
  'the server prices the offer from the catalog (10% off the setup, never off the monthly); prices sent by the browser are ignored') \g /dev/null
select test.ok((:'offer'::jsonb ->> 'est_once_cents')::bigint = 16146 and (:'offer'::jsonb ->> 'est_monthly_cents')::bigint = 1041, 'and estimates the partner pay on the discounted price') \g /dev/null
select test.ok((:'offer'::jsonb ->> 'needs_approval')::boolean, 'a discount below the (absent) floor needs VYNTEX approval') \g /dev/null
select test.is(test.err(test.j('pt_b1', format('select public.partner_offer(%L)', :'of1'))), '42501', 'another partner cannot read the offer') \g /dev/null
select test.is(test.err(test.j('pt_b1', format('select public.partner_offer_submit(%L)', :'of1'))), '42501', 'nor submit it') \g /dev/null
select test.ok(jsonb_array_length(test.j('pt_b1', 'select public.partner_offers()')) = 0, 'nor see it in a list') \g /dev/null
select test.is(test.j('pt_a1', format('select public.partner_offer_submit(%L)', :'of1')) ->> 'status', 'pending_approval', 'submitting puts it in the approval queue') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_offer_share(%L, %L)$q$, :'of1', repeat('d', 64)))), '22023', 'it cannot be shared before approval') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_admin_offer_decide(%L, 'approve')$q$, :'of1'))), '42501', 'a partner cannot approve its own offer') \g /dev/null
select test.is(test.j('pt_mgr', format($q$select public.partner_admin_offer_decide(%L, 'approve', 'OK for this client')$q$, :'of1')) ->> 'status', 'approved', 'VYNTEX approves it') \g /dev/null
select test.ok(exists (select 1 from partner.notifications where kind = 'offer.approved' and entity_id = :'of1'::uuid and audience = 'partner'), 'the partner is notified') \g /dev/null
select test.is(test.j('pt_a1', format($q$select public.partner_offer_share(%L, %L, 14)$q$, :'of1', repeat('d', 64))) ->> 'ref', (select ref from partner.offers where id = :'of1'), 'a proposal link is made') \g /dev/null
select test.is((select status from partner.offers where id = :'of1'), 'sent', 'and the offer is sent and frozen') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_offer_save(%L, '{"client_name":"X","lines":[{"item":"growth"}]}')$q$, :'of1'))), '22023', 'a sent offer cannot be edited') \g /dev/null
select test.ok(test.raw(format($q$update partner.offers set setup_cents = 1 where id = %L$q$, :'of1')) like 'error:%', 'not even directly in the database') \g /dev/null

-- a later catalog change does not touch the issued proposal
select test.j('pt_admin', $q$select to_jsonb(public.partner_admin_catalog_draft('starter', jsonb_build_object('name', '{"en":"Starter","es":"Starter"}'::jsonb,
  'prices', '[{"kind":"setup","amount_cents":99900,"period":"one_time","status":"approved"},{"kind":"recurring","amount_cents":39900,"period":"month","status":"approved"}]'::jsonb)))$q$) \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_catalog_publish(%L)$q$, (select id from partner.catalog_versions where item_id = 'starter' and version = 2))) \g /dev/null
select test.ok((select status = 'retired' from partner.catalog_versions where item_id = 'starter' and version = 1), 'publishing a new version retires the old one') \g /dev/null
select test.j('service', format($q$select public.partner_proposal_peek(%L)$q$, repeat('d', 64))) as prop \gset
select test.ok((:'prop'::jsonb ->> 'setup_cents')::bigint = 80730 and (:'prop'::jsonb -> 'lines' -> 0 ->> 'setup_cents')::bigint = 80730, 'the proposal keeps the prices it was issued with') \g /dev/null
select test.ok(not (:'prop'::text ~ '(est_once|estimate|partner|discount_bps|approval_reasons|floor|policy)'), 'the proposal shows no partner pay, partner, floor or policy') \g /dev/null
select test.is(:'prop'::jsonb ->> 'status', 'viewed', 'opening it marks the offer viewed') \g /dev/null
select test.ok(test.j('service', format($q$select public.partner_proposal_peek(%L)$q$, repeat('e', 64))) is null, 'an unknown link shows nothing') \g /dev/null
select test.is(test.err(test.j('service', format($q$select public.partner_proposal_respond(%L, 'accepted', '')$q$, repeat('d', 64)))), '22023', 'accepting needs the client''s name') \g /dev/null
select test.is(test.j('service', format($q$select public.partner_proposal_respond(%L, 'accepted', 'Rosa Ruiz', %L)$q$, repeat('d', 64), repeat('f', 32))) ->> 'status', 'accepted', 'the client accepts on the proposal page') \g /dev/null
select test.is(test.err(test.j('service', format($q$select public.partner_proposal_respond(%L, 'declined', 'Rosa Ruiz')$q$, repeat('d', 64)))), '22023', 'a decision is final') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------------------------------------
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_order_create(jsonb_build_object('offer_id', %L, 'contact_name', 'Rosa Ruiz', 'contact_email', 'owner@sunrise.example'))$q$, :'of1'))), '22023',
  'an order needs the client''s consent to be contacted') \g /dev/null
select test.j('pt_a1', format($q$select public.partner_order_create(jsonb_build_object('offer_id', %L, 'contact_name', 'Rosa Ruiz', 'contact_email', 'owner@sunrise.example',
  'consent', true, 'lead_source', 'walk-in', 'idem_key', 'order-key-0001', 'submit', true))$q$, :'of1')) as ord \gset
select :'ord'::jsonb ->> 'id' as or1 \gset
select test.ok(:'ord'::jsonb ->> 'status' = 'submitted' and (:'ord'::jsonb ->> 'setup_cents')::bigint = 80730, 'the accepted offer becomes a submitted order with its prices, nothing retyped') \g /dev/null
select test.is((select status from partner.offers where id = :'of1'), 'ordered', 'and the offer is marked ordered') \g /dev/null
select test.is(test.j('pt_a1', $q$select public.partner_order_create('{"idem_key":"order-key-0001","client_name":"Again","contact_name":"x","contact_email":"x@x.example","consent":true,"lines":[{"item":"growth"}]}')$q$) ->> 'id',
  :'or1', 'a retried submission returns the same order') \g /dev/null
select test.ok(exists (select 1 from partner.notifications where kind = 'order.submitted' and audience = 'staff' and entity_id = :'or1'::uuid), 'VYNTEX is notified of the new order') \g /dev/null
-- another partner submits the same client: attribution conflict, first submission wins
select test.j('pt_b1', $q$select public.partner_order_create('{"client_name":"Sunrise Cleaning LLC","contact_name":"Rosa","contact_email":"OWNER@sunrise.example","consent":true,"lines":[{"item":"crm-basic"}],"submit":true}')$q$) ->> 'id' as orb \gset
select test.is((select attribution from partner.orders where id = :'orb'), 'conflict', 'the same client from another partner is flagged as an attribution conflict') \g /dev/null
select test.ok(not (test.j('pt_b1', format('select public.partner_order(%L)', :'orb'))::text like '%Attribution conflict%'), 'the internal attribution note is not shown to the partner') \g /dev/null
select test.is(test.err(test.j('pt_b1', format('select public.partner_order(%L)', :'or1'))), '42501', 'partner B cannot read partner A''s order') \g /dev/null
select test.is(test.err(test.j('pt_b1', format($q$select public.partner_order_message(%L, 'hi')$q$, :'or1'))), '42501', 'nor write on it') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_admin_order_move(%L, 'approved')$q$, :'or1'))), '42501', 'a partner cannot approve an order') \g /dev/null
select test.is(test.err(test.j('pt_mgr', format($q$select public.partner_admin_order_move(%L, 'live')$q$, :'or1'))), '22023', 'the state machine refuses a jump (submitted to live)') \g /dev/null
select test.j('pt_mgr', format($q$select public.partner_admin_order_move(%L, 'info_required', 'Which booking calendar do they use?')$q$, :'or1')) \g /dev/null
select test.j('pt_mgr', format($q$select public.partner_admin_order_note(%L, 'Internal: check the credit card on file', true)$q$, :'or1')) \g /dev/null
select test.ok(not (test.j('pt_a1', format('select public.partner_order(%L)', :'or1'))::text like '%credit card on file%'), 'internal notes stay internal') \g /dev/null
select test.ok(test.j('pt_a1', format('select public.partner_order(%L)', :'or1'))::text like '%Which booking calendar%', 'the information request is shown to the partner') \g /dev/null
select test.is(test.j('pt_a1', format($q$select public.partner_order_message(%L, 'Google Calendar')$q$, :'or1')) ->> 'status', 'under_review', 'the partner''s answer sends the order back to review') \g /dev/null
select test.j('pt_mgr', format($q$select public.partner_admin_order_move(%L, %L)$q$, :'or1', s)) from unnest(array['approved', 'awaiting_payment', 'in_progress']) s \g /dev/null
select test.is((select status from partner.orders where id = :'or1'), 'in_progress', 'VYNTEX moves it along') \g /dev/null
select test.ok((select count(*) >= 6 from partner.order_events where order_id = :'or1' and kind = 'status'), 'every move is in the history') \g /dev/null
select test.ok(test.raw(format($q$delete from partner.order_events where order_id = %L$q$, :'or1')) like 'error:%', 'the history cannot be deleted') \g /dev/null

-- ---------------------------------------------------------------------------------------------------------------------
-- Commissions: verified payments and go-live only
-- ---------------------------------------------------------------------------------------------------------------------
select test.is(test.err(test.j('pt_mgr', format($q$select public.partner_admin_order_payment(%L, '{"kind":"deposit","amount_cents":40365,"reference":"INV-1"}')$q$, :'or1'))), '42501', 'managers do not record money') \g /dev/null
select test.stepup_stale('pt_admin') \g /dev/null
select test.is(test.err(test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"deposit","amount_cents":40365,"reference":"INV-1"}')$q$, :'or1'))), 'VX403', 'recording money needs a fresh identity check') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"deposit","amount_cents":40365,"reference":"INV-1","method":"card"}')$q$, :'or1')) \g /dev/null
select test.j('pt_mgr', format($q$select public.partner_admin_order_move(%L, 'live', '', %L)$q$, :'or1', current_date - 10)) \g /dev/null
select test.is((select count(*)::text from partner.commissions where order_id = :'or1'), '0', 'live with only the deposit paid: nothing is earned yet') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"balance","amount_cents":40365,"reference":"INV-2"}')$q$, :'or1')) \g /dev/null
select test.ok((select amount_cents = 16146 and kind = 'setup_share' and partner.commission_status(id) = 'eligible' and clawback_until = current_date + 80
                from partner.commissions where order_id = :'or1' and kind = 'setup_share'),
  'balance paid and live: 20% of the $807.30 setup = $161.46 is eligible, with its 90-day clawback date') \g /dev/null
select test.ok((select policy_version_id = (select id from partner.policy_versions where policy_id = 'revshare-setup-20' and status = 'approved') and calculation like '20.00%% of setup $807.30 = $161.46%%'
                from partner.commissions where order_id = :'or1' and kind = 'setup_share'), 'the ledger line keeps its policy version and a written calculation') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"monthly","amount_cents":34700,"period":"2026-10-01","reference":"INV-3"}')$q$, :'or1')) \g /dev/null
select test.ok((select amount_cents = 1041 and period = date '2026-10-01' from partner.commissions where order_id = :'or1' and kind = 'recurring_share'), 'a collected month earns 3% = $10.41') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.is(test.err(test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"monthly","amount_cents":34700,"period":"2026-10-15","reference":"INV-4"}')$q$, :'or1'))), '23505',
  'the same month cannot be recorded twice') \g /dev/null
select test.is((select partner.evaluate_order(:'or1')::text), '0', 'running the engine again adds nothing') \g /dev/null
select test.ok(test.raw($q$update partner.commissions set amount_cents = 999999$q$) like 'error:%', 'ledger lines are never changed') \g /dev/null

-- what the partner sees
select test.j('pt_a1', 'select public.partner_commissions()') as stmt \gset
select test.ok((:'stmt'::jsonb -> 'totals' ->> 'eligible_cents')::bigint = 17187 and jsonb_array_length(:'stmt'::jsonb -> 'lines') = 2, 'the partner''s statement: $171.87 eligible on two lines') \g /dev/null
select test.ok(jsonb_array_length(test.j('pt_b1', 'select public.partner_commissions()') -> 'lines') = 0, 'partner B sees none of partner A''s pay') \g /dev/null
select test.is(test.err(test.j('pt_b1', format('select public.partner_commissions(%L)', :'pa'))), '42501', 'even when asking for it by id') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_admin_commission_set(%L, 'approve')$q$, (select id from partner.commissions where kind = 'setup_share' limit 1)))), '42501', 'a partner cannot approve its own pay') \g /dev/null
select test.is(test.as('pt_a1', 'update partner.commissions set amount_cents = 1'), 'error:42501', 'nor touch the ledger') \g /dev/null
select test.j('pt_a1', format($q$select public.partner_commission_inquiry(%L, 'Is October included?')$q$, (select id from partner.commissions where kind = 'recurring_share' limit 1))) \g /dev/null
select test.ok(exists (select 1 from partner.notifications where kind = 'commission.inquiry' and audience = 'staff'), 'a question about a line reaches VYNTEX') \g /dev/null

-- payouts: W-9 gate, approval, no double payment, paid only when settled
select test.stepup('pt_admin') \g /dev/null
select test.is(test.err(test.j('pt_admin', format('select public.partner_admin_payout_create(%L)', :'pa'))), '22023', 'no payout without a verified W-9 and a signed agreement') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_partner_compliance(%L, 'verified', 'signed', 'rev-share 2026-09')$q$, :'pa')) \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.is(test.j('pt_admin', format('select public.partner_admin_payout_create(%L)', :'pa')) ->> 'word', 'Nothing approved to pay', 'eligible is not approved: nothing to pay yet') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_commission_set(%L, 'approve')$q$, id)) from partner.commissions where partner_id = :'pa'::uuid \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format('select public.partner_admin_payout_create(%L)', :'pa')) as po \gset
select test.is(:'po'::jsonb ->> 'total_cents', '17187', 'the payout holds every approved line') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.is(test.err(test.j('pt_admin', format('select public.partner_admin_payout_create(%L)', :'pa'))), '22023', 'the same lines cannot go into a second payout') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_payout_step(%L, 'approve')$q$, :'po'::jsonb ->> 'id')) \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.is(test.err(test.j('pt_admin', format($q$select public.partner_admin_payout_step(%L, 'sent', '{"method":"ACH"}')$q$, :'po'::jsonb ->> 'id'))), '22023', 'marking it sent needs a reference') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_payout_step(%L, 'sent', '{"method":"ACH","reference":"BANK-778","date":"2026-11-03"}')$q$, :'po'::jsonb ->> 'id')) \g /dev/null
select test.ok((select bool_and(partner.commission_status(id) = 'payable') from partner.commissions where partner_id = :'pa'::uuid), 'sent is not paid: the lines are payable') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_payout_step(%L, 'settled', '{"reference":"RECON-2026-11","date":"2026-11-05"}')$q$, :'po'::jsonb ->> 'id')) \g /dev/null
select test.ok((select bool_and(partner.commission_status(id) = 'paid') from partner.commissions where partner_id = :'pa'::uuid), 'settled: the lines are paid') \g /dev/null
select test.ok((test.j('pt_a1', 'select public.partner_commissions()') -> 'payouts' -> 0) @> '{"status":"settled","method":"ACH","reference":"BANK-778","settled_on":"2026-11-05"}'::jsonb,
  'the partner sees the payout, its method, reference and date') \g /dev/null
select test.is(test.err(test.j('pt_a1', format($q$select public.partner_admin_payout_step(%L, 'cancel', '{"reason":"oops"}')$q$, :'po'::jsonb ->> 'id'))), '42501', 'a partner cannot change a payout') \g /dev/null

-- the client cancels inside the 90 days: the setup share is clawed back (the paid monthly share is not)
select test.j('pt_mgr', format($q$select public.partner_admin_order_move(%L, 'cancelled', 'Client closed the business')$q$, :'or1')) \g /dev/null
select test.ok((select amount_cents = -16146 and partner.commission_status(id) = 'eligible' from partner.commissions where order_id = :'or1' and kind = 'clawback'),
  'cancelled inside the window: -$161.46 is recorded, to come off the next payout') \g /dev/null
select test.ok(not exists (select 1 from partner.commissions where order_id = :'or1' and kind = 'clawback' and reverses = (select id from partner.commissions where order_id = :'or1' and kind = 'recurring_share')),
  'a collected monthly share is not clawed back') \g /dev/null

-- the referral partner: one fee per client order, then a partial refund
select test.j('pt_mgr', format($q$select public.partner_admin_order_move(%L, %L, 'ok')$q$, :'orb', s)) from unnest(array['under_review', 'approved', 'awaiting_payment', 'in_progress', 'live']) s \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"one_time","amount_cents":49700,"reference":"INV-B1"}')$q$, :'orb')) \g /dev/null
select test.ok((select count(*) = 1 and sum(amount_cents) = 15000 from partner.commissions where order_id = :'orb' and kind = 'referral_fee'), 'the referral partner earns the $150 fee once') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_order_payment(%L, '{"kind":"refund","amount_cents":24850,"reference":"RF-1"}')$q$, :'orb')) \g /dev/null
select test.ok((select amount_cents = -7500 from partner.commissions where order_id = :'orb' and kind = 'reversal'), 'half the money refunded: half the fee is taken back') \g /dev/null

-- suspension ends access at once and keeps the records
select test.stepup('pt_admin') \g /dev/null
select test.is(test.err(test.j('pt_admin', format($q$select public.partner_admin_partner_status(%L, 'suspended', '')$q$, :'pb'))), '22023', 'suspending needs a reason') \g /dev/null
select test.stepup('pt_admin') \g /dev/null
select test.j('pt_admin', format($q$select public.partner_admin_partner_status(%L, 'suspended', 'Agreement under review')$q$, :'pb')) \g /dev/null
select test.ok(exists (select 1 from app.session_revocations where user_id = test.id('pt_b1')), 'every session of its people is revoked') \g /dev/null
select test.ok(test.j('pt_b1', 'select public.auth_context()') -> 'partner' = 'null'::jsonb, 'sign-in no longer finds a partner role') \g /dev/null
select test.is(test.err(test.j('pt_b1', 'select public.partner_orders()')), '42501', 'and every call is refused') \g /dev/null
select test.ok((select count(*) > 0 from partner.commissions where partner_id = :'pb'::uuid), 'its financial records are kept') \g /dev/null

-- staff preview: exactly what the partner sees, audited
select test.ok(jsonb_array_length(test.j('pt_mgr', format('select public.partner_commissions(%L)', :'pa')) -> 'lines') = 3, 'staff can preview a partner''s statement') \g /dev/null
select test.ok(exists (select 1 from partner.audit_log where action = 'preview.commissions' and partner_id = :'pa'::uuid), 'and the preview is audited') \g /dev/null
select test.ok(test.raw('delete from partner.audit_log') like 'error:%', 'the audit log is append only') \g /dev/null

-- the outbox: sent only when the provider accepted
select test.ok(jsonb_array_length(test.j('service', 'select public.partner_outbox_claim(100)')) > 0, 'the server claims queued notifications with their recipients') \g /dev/null
select test.is(test.err(test.j('pt_admin', 'select public.partner_outbox_claim(1)')), '42501', 'only the server') \g /dev/null
select partner.lockdown_check() \g /dev/null
select test.ok(true, 'the partner schema passes its lockdown check') \g /dev/null

\pset tuples_only off
\pset format aligned
select section, count(*) as checks_passed from test.results where section = '43. the partner portal' group by section;
