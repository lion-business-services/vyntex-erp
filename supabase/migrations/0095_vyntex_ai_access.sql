-- 0095: VYNTEX AI for the Master Builder plan (owner decision of November 5, 2026: "every business enrolled on the full
-- pro plan will have VYNTEX AI", the plan chosen: Master Builder; the model: Groq's free tier).
--   * public.assistant_access(p_tenant): may the person signed in use VYNTEX AI in this company? An active member (not a
--     field worker) of an open workspace on the Master Builder plan, or VYNTEX USA's own workspace (plan internal), with
--     the assistant not switched off in the company's settings. The server asks it before every question
--     (api/_lib/assistant/ask.js); the model never sees anything the person's own role could not open
-- Check after applying:
--   select pg_catalog.has_function_privilege('authenticated', 'public.assistant_access(uuid)', 'execute'),
--          pg_catalog.has_function_privilege('anon', 'public.assistant_access(uuid)', 'execute');
--   expected: true, false
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.assistant_access(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
      'allowed', coalesce(t.plan_id in ('master_builder', 'internal') and app.tenant_open(t.status, t.trial_expires_at)
                          and coalesce(t.config #>> '{modules,assistant}', 'true') <> 'false' and m.id is not null, false),
      'plan', t.plan_id, 'member', m.id is not null)
    from public.tenants t
    left join public.tenant_members m on m.tenant_id = t.id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'worker'
   where t.id = p_tenant
$$;
revoke all on function public.assistant_access(uuid) from public, anon;
grant execute on function public.assistant_access(uuid) to authenticated;
