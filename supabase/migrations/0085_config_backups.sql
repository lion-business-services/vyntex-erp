-- 0085: a copy of a company's configuration before an operator changes it by hand (owner rule: no write to live data
-- without a backup). Server only: no person, visitor or signed-in user can read or write it.
-- First used on November 4, 2026, before VYNTEX USA's workspace switched off Payroll, Bookkeeping, Licensing and Social
-- media and renamed Engagements to Projects (tenants.config, one row).
create table if not exists app.config_backups (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  config    jsonb,
  reason    text,
  at        timestamptz not null default now()
);
alter table app.config_backups enable row level security;
revoke all on app.config_backups from public, anon, authenticated;
