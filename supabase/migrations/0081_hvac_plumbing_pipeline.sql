-- 0081: VYNTEX HVAC and VYNTEX PLUMBING get their own pipeline and lead sources (src/packs/hvac, src/packs/plumbing).
-- HVAC: new call, contacted, diagnostic / estimate booked, options presented, financing / decision, sold, lost.
-- Plumbing: new call, contacted, visit / camera inspection booked, quote sent, waiting on approval, approved, lost.
-- Same function as 0063 with two branches added in front of the field default; supabase/tests/parity.mjs checks that
-- these match the packs. Every other edition returns exactly what it returned before.
create or replace function app.edition_defaults(p_industry text) returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_industry = 'barber' then jsonb_build_object(
      'family', 'practice',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","appointments","catalog","opportunities","reviews","comms","esign","assistant","money","cash","payroll","reports","automations","social","delete","export","import","assignLeads","allClients","credits","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","team","documents","appointments","catalog","opportunities","reviews","comms","esign","assistant","money","cash","credits","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","team","documents","appointments","catalog","opportunities","reviews","comms","esign","assistant"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"appointment","kind":"open","role":"visit"},
        {"id":"proposal","kind":"open","role":"proposal"},
        {"id":"negotiating","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","walk_in","referral","google","facebook","instagram","whatsapp","existing_client","other"]'::jsonb)
    when app.edition_family(p_industry) = 'practice' then jsonb_build_object(
      'family', 'practice',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView","reports","automations","social","delete","export","import","assignLeads","credits","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView","import","credits","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","team","documents","money","assistant","appointments","catalog","opportunities","reviews","comms","esign","cash","payroll","bookkeeping","licensing","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"appointment","kind":"open","role":"visit"},
        {"id":"proposal","kind":"open","role":"proposal"},
        {"id":"negotiating","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","walk_in","referral","google","facebook","instagram","whatsapp","existing_client","other"]'::jsonb)
    when p_industry = 'hvac' then jsonb_build_object(
      'family', 'field',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","reports","automations","assistant","compliance","delete","appointments","catalog","opportunities","reviews","social","comms","esign","cash","deadlines","export","assignLeads","allClients","credits","secureView","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"scheduled","kind":"open","role":"visit"},
        {"id":"sent","kind":"open","role":"proposal"},
        {"id":"financing","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["phone","website","google","google_lsa","existing_client","referral","home_warranty","manufacturer","utility_rebate","nextdoor","facebook","instagram","other"]'::jsonb)
    when p_industry = 'plumbing' then jsonb_build_object(
      'family', 'field',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","reports","automations","assistant","compliance","delete","appointments","catalog","opportunities","reviews","social","comms","esign","cash","deadlines","export","assignLeads","allClients","credits","secureView","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"scheduled","kind":"open","role":"visit"},
        {"id":"sent","kind":"open","role":"proposal"},
        {"id":"approval","kind":"open","role":"negotiation"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["phone","website","google","google_lsa","existing_client","referral","property_manager","insurance","home_warranty","realtor","water_utility","nextdoor","facebook","other"]'::jsonb)
    else jsonb_build_object(
      'family', 'field',
      'rolePermissions', jsonb_build_object(
        'owner', pg_catalog.to_jsonb(app.capabilities()),
        'manager', '["leads","clients","jobs","tasks","calendar","team","documents","money","reports","automations","assistant","compliance","delete","appointments","catalog","opportunities","reviews","social","comms","esign","cash","deadlines","export","assignLeads","allClients","credits","secureView","secureReveal","secureApprove","write"]'::jsonb,
        'staff', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView","write"]'::jsonb,
        'readonly', '["leads","clients","jobs","tasks","calendar","documents","assistant","appointments","catalog","opportunities","reviews","comms","esign","deadlines","secureView"]'::jsonb),
      'leadStages', '[
        {"id":"new","kind":"open","role":"new"},
        {"id":"contacted","kind":"open","role":"contacted"},
        {"id":"scheduled","kind":"open","role":"visit"},
        {"id":"sent","kind":"open","role":"proposal"},
        {"id":"won","kind":"won"},
        {"id":"lost","kind":"lost"}]'::jsonb,
      'leadSources', '["website","phone","referral","facebook","instagram","google","other"]'::jsonb)
  end
$$;
