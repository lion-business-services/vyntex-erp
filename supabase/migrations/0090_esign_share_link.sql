-- 0090: Copy a signing link, and sign the company's part from inside the ERP (owner decision of November 5, 2026: "we
-- must be able to both email the client the private sign link and also copy it and share on WhatsApp", a copy and
-- shareable link for every signer, and the company signs its part from inside the ERP).
--   * public.envelope_link_new: the office operation `envelope_link` (api/_lib/esign/send.js) makes a fresh private link
--     for any signer who has not signed or declined yet. The server makes the token; only its SHA-256 is kept here, as with every link
--   * who may: the owner or a manager of the company (with the e-signature and write rights and a verified sign-in), or
--     the signer themself when they are a member of the company (their login email is the signer's email)
--   * a copied link is one more way in for that signer: the link already in their email keeps working, and a reminder
--     or their turn coming does not replace a copied link (app.public_links.shared). It lasts as long as the request,
--     and every link stops when the request is signed, declined, voided or expires (as before)
--   * every copied link is written to the security log (who, which request, which signer)
--   * when a signer signs or declines, every link of theirs stops at once (the copied one and the emailed one)
-- Check after applying:
--   select pg_catalog.has_function_privilege('authenticated', 'public.envelope_link_new(uuid, uuid, uuid, text)', 'execute'),
--          pg_catalog.has_function_privilege('anon', 'public.envelope_link_new(uuid, uuid, uuid, text)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

alter table app.public_links add column if not exists shared boolean not null default false;

-- 0041's links for the signers just let in, the same but for one thing: a copied (shared) link is not taken back
create or replace function app.envelope_links(p_tenant uuid, p_envelope uuid, p_links jsonb) returns integer
language plpgsql
set search_path = ''
as $$
declare
  l jsonb;
  n integer := 0;
  v_until timestamptz;
begin
  select coalesce(e.expires_at, now() + interval '30 days') into v_until from public.envelopes e where e.tenant_id = p_tenant and e.id = p_envelope;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if (l ->> 'tokenHash') !~ '^[0-9a-f]{64}$' or not exists (select 1 from public.envelope_signers s
         where s.tenant_id = p_tenant and s.envelope_id = p_envelope and s.id = (l ->> 'signerId')::uuid and s.status in ('sent', 'viewed')) then
      raise exception 'invalid_link' using errcode = 'P0001';
    end if;
    update app.public_links x set revoked_at = now()
     where x.tenant_id = p_tenant and x.purpose = 'sign' and x.signer_id = (l ->> 'signerId')::uuid and x.used_at is null and x.revoked_at is null
       and not x.shared;
    insert into app.public_links (tenant_id, purpose, token_hash, signer_id, expires_at)
    values (p_tenant, 'sign', l ->> 'tokenHash', (l ->> 'signerId')::uuid, greatest(v_until, now() + interval '1 hour'));
    n := n + 1;
  end loop;
  return n;
end
$$;

create or replace function public.envelope_link_new(p_tenant uuid, p_envelope uuid, p_signer uuid, p_token_hash text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  e public.envelopes%rowtype;
  s public.envelope_signers%rowtype;
  v_role text := app.member_role(p_tenant);
  v_mail text := lower(coalesce((select u.email from auth.users u where u.id = (select auth.uid())), ''));
begin
  perform app.require_mfa(p_tenant);
  if not (app.can(p_tenant, 'esign') and app.can(p_tenant, 'write')) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'invalid' using errcode = '22023'; end if;
  select * into e from public.envelopes x where x.tenant_id = p_tenant and x.id = p_envelope and not x.demo
     and (x.client_id is null or x.client_id not in (select app.hidden_clients()));
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into s from public.envelope_signers x where x.tenant_id = p_tenant and x.envelope_id = p_envelope and x.id = p_signer;
  if not found then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v_role not in ('owner', 'manager') and lower(s.email) <> v_mail then raise exception 'Not allowed' using errcode = '42501'; end if;
  if e.status not in ('sent', 'partly_signed') or (e.expires_at is not null and e.expires_at <= pg_catalog.now()) then
    return pg_catalog.jsonb_build_object('error', 'not_open');
  end if;
  -- any signer who has not answered: one whose turn has not come yet opens a page that says so, and can sign once it has
  if s.status in ('signed', 'declined') then return pg_catalog.jsonb_build_object('error', 'already_answered'); end if;
  insert into app.public_links (tenant_id, purpose, token_hash, signer_id, expires_at, shared)
  values (p_tenant, 'sign', p_token_hash, p_signer, greatest(coalesce(e.expires_at, pg_catalog.now() + interval '30 days'), pg_catalog.now() + interval '1 hour'), true);
  perform app.security_event(p_tenant, (select auth.uid()), 'esign.link_copied', 'ok', null,
    pg_catalog.jsonb_build_object('envelope', p_envelope, 'signer', p_signer));
  return pg_catalog.jsonb_build_object('ok', true, 'expiresAt', e.expires_at);
end
$$;
revoke all on function public.envelope_link_new(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.envelope_link_new(uuid, uuid, uuid, text) to authenticated;

-- a signer who answered has no open way in left: all their links stop, whichever one they used
create or replace function app.envelope_signer_links_close() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status in ('signed', 'declined') and old.status is distinct from new.status then
    update app.public_links x set revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
     where x.tenant_id = new.tenant_id and x.purpose = 'sign' and x.signer_id = new.id and x.used_at is null and x.revoked_at is null;
  end if;
  return new;
end
$$;
revoke all on function app.envelope_signer_links_close() from public, anon, authenticated, service_role;
drop trigger if exists envelope_signer_links_close on public.envelope_signers;
-- at the end of the save, so the link the signer just used is already marked used and keeps its stored answer
create constraint trigger envelope_signer_links_close after update of status on public.envelope_signers
  deferrable initially deferred for each row execute function app.envelope_signer_links_close();
