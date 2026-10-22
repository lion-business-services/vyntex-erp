-- 0062 Connected apps: the connections on the roadmap (listed and demonstrated, not yet connectable in a live workspace)
-- join the list of providers a message may name, and the rule builder's "send to a connected app" step (connector)
-- joins the steps a rule may take. Same lists as ProviderId and RuleStep in src/domain/types.ts
-- (supabase/tests/parity.mjs compares them).

alter table public.messages drop constraint if exists messages_provider_check;
alter table public.messages add constraint messages_provider_check check (provider in (
  'gmail', 'resend', 'gcal', 'gmeet', 'gbp', 'gmaps', 'square', 'quickbooks', 'whatsapp', 'meta', 'dialpad', 'sms', 'ai',
  'gdrive', 'gsheets', 'gcontacts', 'gforms', 'galerts', 'outlook', 'stripe', 'slack', 'zapier'));

create or replace function app.rule_step_kinds() returns text[]
language sql immutable parallel safe
set search_path = ''
as $$ select array['task', 'message', 'notify', 'assign', 'stage', 'document', 'envelope', 'appointment', 'opportunity', 'review', 'tag', 'playbook', 'connector', 'builtin']::text[] $$;
