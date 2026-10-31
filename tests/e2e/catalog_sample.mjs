// A catalog with two books, shaped like an agency's services and a software company's plans: packages with a setup fee
// and a monthly fee, quoted work, starting prices, prices per unit and lists of what is included. Sample names and
// prices only; nothing here is a real offer. Used by tests/e2e/catalog.e2e.test.mjs.
//
// Each service is { name, category, i18n?, extra, tiers: [{ name, price, unit, extra }] }: `extra` is what the gateway keeps
// in the "extra" column, exactly as data inserted straight into catalog_services and catalog_tiers would carry it.
const svc = (book, bookOrder, category, categoryOrder, order, name, more, tiers) => ({
  name, category, i18n: more.i18n ?? null,
  extra: { book, bookOrder, categoryOrder, order, ...(more.highlights ? { highlights: more.highlights } : {}), ...(more.excludes ? { excludes: more.excludes } : {}), ...(more.bestFor ? { bestFor: more.bestFor } : {}) },
  tiers: tiers.map(([name, price, unit, extra = {}]) => ({ name, price, unit, extra })),
});

export const AGENCY = 'Sample Agency Services';
export const SOFTWARE = 'Sample Software Plans';

export const agencyBook = [
  svc(AGENCY, 1, 'Agency packages', 1, 1, 'Growth Package', {
    bestFor: 'Small businesses that want leads every month without hiring a team.',
    highlights: ['CRM set up with your pipeline', 'Website with up to 8 pages', 'Monthly social posts', 'One strategy call a month'],
    excludes: ['Paid ad spend', 'Printing'],
    i18n: { es: { name: 'Paquete de crecimiento', bestFor: 'Negocios pequeños que desean recibir prospectos cada mes sin contratar un equipo.',
      highlights: ['CRM configurado con su embudo', 'Sitio web de hasta 8 páginas', 'Publicaciones mensuales en redes', 'Una llamada de estrategia al mes'], excludes: ['Inversión en anuncios', 'Impresión'] } },
  }, [['Setup', 1500, 'flat', { kind: 'setup' }], ['Monthly', 497, 'month', { kind: 'recurring' }]]),
  svc(AGENCY, 1, 'Agency packages', 1, 2, 'Enterprise Package', {
    bestFor: 'Companies with several locations.', highlights: ['Everything in Growth', 'Dedicated account manager'],
  }, [['Custom scope', 0, 'flat', { quote: true }]]),
  svc(AGENCY, 1, 'CRM', 2, 1, 'CRM Setup', { highlights: ['Pipeline and stages', 'Forms and calendars', 'Two automations'] },
    [['Setup', 900, 'flat', { kind: 'setup' }], ['License', 97, 'month', { kind: 'recurring', per: 'per account' }]]),
  svc(AGENCY, 1, 'Websites', 3, 1, 'Business Website', { highlights: ['Up to 8 pages', 'Contact form', 'Basic SEO'], excludes: ['Copywriting'] },
    [['Build', 4000, 'flat', { from: true, kind: 'one_time' }], ['Hosting and care', 59, 'month', { kind: 'recurring' }]]),
  svc(AGENCY, 1, 'Websites', 3, 2, 'Online Store', {}, [['Build', 6500, 'flat', { quote: true, from: true }]]),
  svc(AGENCY, 1, 'AI tools', 4, 1, 'AI Voice Front Desk', { highlights: ['Answers calls day and night', 'Transfers to your team'] },
    [['Setup', 750, 'flat', { kind: 'setup' }], ['Service', 297, 'month', { kind: 'recurring' }]]),
  svc(AGENCY, 1, 'Branding', 5, 1, 'Logo and Brand Kit', {}, [['Starter', 350, 'flat'], ['Full kit', 0, 'flat', { quote: true }]]),
  svc(AGENCY, 1, 'Add-ons', 6, 1, 'Extra Web Form', {}, [['Form', 25, 'flat', { per: 'per form', kind: 'per_unit' }]]),
  svc(AGENCY, 1, 'Hourly rates', 7, 1, 'Design Hour', {}, [['Standard', 85, 'hour', { kind: 'hourly' }]]),
];

export const softwareBook = [
  svc(SOFTWARE, 2, 'Editions', 1, 1, 'ERP Starter', {
    bestFor: 'Offices with up to 5 people.', highlights: ['Leads, clients and jobs', 'Documents and e-signature', 'Two languages'], excludes: ['Data migration'],
    i18n: { es: { name: 'ERP Inicial', bestFor: 'Oficinas de hasta 5 personas.', highlights: ['Prospectos, clientes y trabajos', 'Documentos y firma electrónica', 'Dos idiomas'], excludes: ['Migración de datos'] } },
  }, [['Monthly', 49, 'month', { per: 'per user', kind: 'recurring' }], ['Onboarding', 500, 'flat', { kind: 'setup' }]]),
  svc(SOFTWARE, 2, 'Editions', 1, 2, 'ERP Professional', { highlights: ['Everything in Starter', 'Payroll and reports'] },
    [['Monthly', 89, 'month', { per: 'per user', kind: 'recurring' }], ['Onboarding', 0, 'flat', { kind: 'setup', quote: true }]]),
  svc(SOFTWARE, 2, 'ERP add-ons', 2, 1, 'Data Migration', {}, [['Project', 1200, 'flat', { quote: true, from: true }]]),
  svc(SOFTWARE, 2, 'ERP add-ons', 2, 2, 'Extra Storage', {}, [['Block', 15, 'month', { per: 'per 100 GB' }]]),
];

/** SQL that inserts services with their tiers for one company, as the local superuser. Values travel through _in. */
export const INSERT_SQL = String.raw`
  do $$ declare s jsonb; x jsonb; sid uuid; i int; tid uuid := (select v from _in where k = 't')::uuid; begin
    for s in select * from jsonb_array_elements((select v from _in where k = 'd')::jsonb) loop
      insert into public.catalog_services (tenant_id, name, category, active, i18n, extra)
        values (tid, s->>'name', s->>'category', true, case when jsonb_typeof(s->'i18n') = 'object' then s->'i18n' end, s->'extra') returning id into sid;
      i := 0;
      for x in select * from jsonb_array_elements(s->'tiers') loop
        insert into public.catalog_tiers (tenant_id, service_id, name, price, unit, position, extra)
          values (tid, sid, x->>'name', (x->>'price')::numeric, x->>'unit', i, x->'extra');
        i := i + 1;
      end loop;
    end loop;
  end $$;
  select '@@R@@' || '1';`;
