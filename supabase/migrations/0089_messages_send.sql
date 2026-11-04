-- 0089: Send works from the Messages screen again (bug found November 4, 2026).
-- 0043 says a person saves an outgoing message as "queued" and the server takes it from there (consent checked again,
-- the connected account, the result). But 0013's rules only let a person write "draft" or "demo", so Send in a live
-- workspace was refused: a new message (insert) by the access rule, a draft sent later (update) by app.messages_guard.
-- Fixed for every company:
--   * a person with "comms" write may save an outgoing message as "queued", new or from a draft of theirs
--   * still never "sent", "delivered", "failed" or "received", never an incoming one, never the provider's fields:
--     those stay the server's (api/_lib/pipeline/deliver.js)
--   * a queued message is stamped with the person signed in, whatever the row names
--   * a draft an AI employee wrote (extra.drafted_by_bot) is still sent only through Approvals (0084): a person cannot
--     queue it directly, and its mark cannot be removed
--   * once queued it is a record, as before: it can only be marked read
-- Check after applying:
--   select pg_catalog.pg_get_expr(polwithcheck, polrelid) like '%queued%' from pg_catalog.pg_policy where polname = 'messages_insert';
--   expected: true
-- ---------------------------------------------------------------------------------------------------------------------

alter policy messages_insert on public.messages
  with check (tenant_id = any ((select app.tenants_can('comms', 'write'))::uuid[]) and status in ('draft', 'demo', 'queued'));

create or replace function app.messages_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.jwt_role() <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'demo', 'queued') or new.dir = 'in' or new.provider is not null or new.external_id is not null or new.error is not null then
      raise exception 'Only the server records a message as sent, delivered, failed or received' using errcode = '42501';
    end if;
    if new.extra ? 'drafted_by_bot' then
      raise exception 'Only an AI employee writes its own drafts' using errcode = '42501';
    end if;
    -- the author is the person signed in, whoever the row names; a queued message always names them
    if new.by_member_id is not null or new.status = 'queued' then new.by_member_id := app.current_member(new.tenant_id); end if;
    if new.status = 'queued' then new.dir := 'out'; end if;
    return new;
  end if;
  -- an AI employee's draft keeps its mark whatever a person sends
  if old.extra ? 'drafted_by_bot' then
    new.extra := coalesce(new.extra, '{}'::jsonb) || pg_catalog.jsonb_build_object('drafted_by_bot', old.extra -> 'drafted_by_bot');
  end if;
  -- 0084: the draft named by an approval being decided moves to "queued", nothing else changed but its time and author
  if old.status = 'draft' and new.status = 'queued' and coalesce(pg_catalog.current_setting('app.approved_send', true), '') = old.id::text
     and new.by_member_id is not distinct from app.current_member(new.tenant_id)
     and (pg_catalog.to_jsonb(new) - array['status', 'at', 'by_member_id', 'updated_at']) = (pg_catalog.to_jsonb(old) - array['status', 'at', 'by_member_id', 'updated_at']) then
    return new;
  end if;
  -- a person sends their own draft (its text may change in the same step)
  if old.status = 'draft' and new.status = 'queued' then
    if old.extra ? 'drafted_by_bot' then
      raise exception 'A message an AI employee drafted is sent through Approvals' using errcode = '42501';
    end if;
    if coalesce(old.dir, 'out') <> 'out' or coalesce(new.dir, 'out') <> 'out'
       or (new.provider, new.external_id, new.error) is distinct from (old.provider, old.external_id, old.error) then
      raise exception 'Only the server records a message as sent, delivered, failed or received' using errcode = '42501';
    end if;
    new.by_member_id := app.current_member(new.tenant_id);
    new.dir := 'out';
    return new;
  end if;
  if old.status in ('draft', 'demo') then
    if new.status not in ('draft', 'demo')
       or (new.dir, new.provider, new.external_id, new.error, new.by_member_id) is distinct from (old.dir, old.provider, old.external_id, old.error, old.by_member_id) then
      raise exception 'Only the server records a message as sent, delivered, failed or received' using errcode = '42501';
    end if;
  elsif (pg_catalog.to_jsonb(new) - array['read', 'updated_at']) is distinct from (pg_catalog.to_jsonb(old) - array['read', 'updated_at']) then
    -- once a message left (or arrived) it is a record of what happened: a person can mark it read, nothing else
    raise exception 'A message that was queued, sent or received can only be marked as read' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.messages_guard() from public, anon, authenticated, service_role;
