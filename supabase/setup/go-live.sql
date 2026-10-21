-- VYNTEX ERP go-live: the one-time setup of the client database, after every file of supabase/migrations and
-- supabase/seed.sql has been applied. Run it once, in the Supabase SQL Editor of the client project (check the project
-- name at the top of the page first). Each part says what it does. Nothing here holds a secret: the two keys are made
-- inside the database and stay in Supabase Vault (Project Settings, Vault), where you can copy them to the password manager.

-- 1. The two database secrets (docs/DEPLOYMENT.md, section 3). Made only when they do not exist yet.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pii_encryption_key') then
    perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(48), 'base64'), 'pii_encryption_key', 'Encrypts tax IDs. If lost, stored tax IDs cannot be read.');
  end if;
  if not exists (select 1 from vault.secrets where name = 'ip_hash_salt') then
    perform vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), 'ip_hash_salt', 'Turns network addresses into keyed hashes for the audit trail.');
  end if;
end $$;

-- 2. Owners and managers of every client company sign in with an authenticator app (the second step). A company can
--    add more roles from its own security settings; it can never remove these two.
update app.server_settings set value = '{"mfaRoles": ["owner", "manager"]}'::jsonb where key = 'security.required'
returning key, value;

-- 3. VYNTEX's own workspace, whose owner becomes the first operator, and the invitation of that owner.
--    The result is a token, shown once: the link is  https://erp.vyntexusa.com/invite/<token>
--    Open it, set the password, add the authenticator app. Then run part 4.
with t as (
  insert into public.tenants (slug, name, industry_id, plan_id, status)
  values ('vyntex-hq', 'VYNTEX USA', 'practice', 'quoted', 'active')
  on conflict (slug) do update set name = excluded.name
  returning id
)
select public.invite_bootstrap((select id from t), 'info@vyntexusa.com') as owner_invitation_token;

-- 4. After the invitation in part 3 was accepted: make that account an operator. It can then open
--    https://erp.vyntexusa.com/admin (with its authenticator code) and create client workspaces.
--    Add other staff the same way once they have accepted an invitation to vyntex-hq.
-- select app.operator_add('info@vyntexusa.com');
