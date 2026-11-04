-- The six AI employees of VYNTEX USA in its own workspace (vyntex-hq, plan internal), after migration 0084.
-- Source: "ERP bot profiles", prepared by Parker on November 4, 2026; access levels set per role by Abdul that day.
-- Insert only: a bot that already exists is left exactly as it is (never overwritten). No key is created here: the
-- owner creates each key in VYNTEX ERP, AI employees (fresh identity check, shown once).
-- Run once, IN: Supabase SQL Editor (or the Supabase connection), as the database owner.
-- Dry run first: the select at the bottom shows what would be added, without the insert, when run on its own.
with hq as (
  select t.id from public.tenants t where t.slug = 'vyntex-hq' and t.plan_id = 'internal'
), want (slug, name, title, department, reports_to, mission, access) as (values
  ('parker', 'Parker', 'Executive Assistant & Chief of Staff', 'Executive Office (above all five departments)',
   'Abdul (Director of Digital Strategy & Solutions) and Daysi A. Bettran (Founder & CEO)',
   'Be the single point of contact for Daysi and Abdul, orchestrate the five AI employees, consolidate reports and escalate decisions.',
   '{"leads":"view","clients":"view","jobs":"view","tasks":"edit","calendar":"edit","documents":"view","messages":"edit","payments":"view","catalog":"view","reports":"edit","automations":"view","team":"view"}'),
  ('sterling', 'Sterling', 'Head of Sales & Partnerships', 'Sales & Partnerships', 'Parker',
   'Turn every qualified conversation into a signed client, and grow the partner network into a second sales engine.',
   '{"leads":"edit","clients":"edit","jobs":"view","tasks":"edit","calendar":"edit","documents":"edit","messages":"edit","payments":"view","catalog":"view","reports":"edit","automations":"view","team":"none"}'),
  ('aria', 'Aria', 'Head of Marketing & Growth', 'Marketing & Growth', 'Parker',
   'Make VYNTEX the most visible, most credible AI automation agency for small and mid-sized businesses, in English and Spanish, and fill Sterling''s pipeline.',
   '{"leads":"edit","clients":"view","jobs":"none","tasks":"edit","calendar":"edit","documents":"none","messages":"edit","payments":"none","catalog":"view","reports":"edit","automations":"edit","team":"none"}'),
  ('atlas', 'Atlas', 'Head of Product & Engineering', 'Product & Engineering', 'Parker',
   'Make VYNTEX ERP, vyntexusa.com and every client build secure, stable, fast and ready to sell.',
   '{"leads":"none","clients":"none","jobs":"view","tasks":"edit","calendar":"view","documents":"none","messages":"none","payments":"none","catalog":"view","reports":"edit","automations":"edit","team":"edit"}'),
  ('sofia', 'Sofia', 'Head of Client Success & Delivery (bilingual EN/ES)', 'Client Success & Delivery', 'Parker',
   'Every client launches on time, uses what they bought, gets measurable results and renews.',
   '{"leads":"view","clients":"edit","jobs":"edit","tasks":"edit","calendar":"edit","documents":"edit","messages":"edit","payments":"view","catalog":"view","reports":"edit","automations":"view","team":"none"}'),
  ('grant', 'Grant', 'Head of Finance, Legal & Operations', 'Finance, Legal & Operations', 'Parker',
   'Every dollar is invoiced, collected, recorded and protected, every agreement is correct, and the company runs on clean processes.',
   '{"leads":"view","clients":"view","jobs":"view","tasks":"edit","calendar":"view","documents":"edit","messages":"edit","payments":"edit","catalog":"edit","reports":"edit","automations":"view","team":"none"}')
)
insert into app.bots (tenant_id, slug, name, title, department, reports_to, mission, access)
select hq.id, w.slug, w.name, w.title, w.department, w.reports_to, w.mission, app.bot_access_clean(w.access::jsonb)
  from hq cross join want w
on conflict (tenant_id, slug) do nothing
returning slug, name, access;

-- Dry run (on its own): what the insert above would add
-- select w.slug from (values ('parker'), ('sterling'), ('aria'), ('atlas'), ('sofia'), ('grant')) w(slug)
--  where not exists (select 1 from app.bots b join public.tenants t on t.id = b.tenant_id where t.slug = 'vyntex-hq' and b.slug = w.slug);
