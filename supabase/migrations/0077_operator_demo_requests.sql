-- 0077 Demo requests in the operator console: VYNTEX staff see who asked for a demo on the sales pages and turn a request
-- into a 7-day trial workspace with one click (the "New client workspace" form opens filled in).
--
--   operator_demo_requests()   the latest 100 demo requests, newest first, each with `workspace`: the address word of the
--                              company already made for that person (an active owner, or an open or used owner
--                              invitation, with the same email), or null
--
-- Same rules as the other operator functions (0061): an active operator whose session passed the second sign-in step
-- (app.require_operator), and nothing else. The request's contact details are what the person typed so VYNTEX can call
-- back. What is never returned: the network address hash, the browser signature and the consent evidence.
-- Read only. The table itself stays closed to every person (0003: no policy, server key only).

create or replace function public.operator_demo_requests() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_operator();
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', d.id, 'created_at', d.created_at, 'name', d.name, 'business', d.business, 'industry', d.industry,
      'phone', d.phone, 'email', d.email, 'language', d.language, 'contact_method', d.contact_method,
      'team_size', d.team_size, 'message', d.message,
      'workspace', (
        select w.slug from (
          select t.slug, 0 as rank, m.created_at as at
            from public.tenant_members m
            join public.tenants t on t.id = m.tenant_id
            join auth.users u on u.id = m.user_id
           where m.role = 'owner' and m.status = 'active' and t.status <> 'closed'
             and pg_catalog.lower(u.email) = pg_catalog.lower(d.email)
          union all
          select t.slug, case when i.used_at is not null then 1 else 2 end, i.created_at
            from app.invitations i
            join public.tenants t on t.id = i.tenant_id
           where i.role = 'owner' and t.status <> 'closed'
             and (i.used_at is not null or i.revoked_at is null)
             and pg_catalog.lower(i.email) = pg_catalog.lower(d.email)
        ) w
        order by w.rank, w.at desc
        limit 1
      )
    ) order by d.created_at desc, d.id)
    from (
      select r.id, r.created_at, r.name, r.business, r.industry, r.phone, r.email, r.language, r.contact_method, r.team_size, r.message
        from public.demo_requests r
       order by r.created_at desc, r.id
       limit 100
    ) d
  ), '[]'::jsonb);
end
$$;
revoke all on function public.operator_demo_requests() from public, anon, service_role;
grant execute on function public.operator_demo_requests() to authenticated;
