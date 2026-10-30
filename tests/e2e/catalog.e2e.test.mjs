// Several catalogs ("books") in one live workspace, end to end in a real browser, against the local stand-ins
// (tests/e2e/stack.mjs: a local PostgreSQL with every migration, the Supabase test double and scripts/serve.mjs):
//   services are written straight into catalog_services and catalog_tiers with the book, the lists and the tier flags in
//   "extra" (the way a catalog is loaded for a company); one book alone shows the page as it always was; two books give
//   sub-tabs with counts, the tab is in the address and survives a reload; a quoted tier reads "Quote", never $0; editing
//   a service in the form keeps every field in "extra"; the page fits a 390 px phone.
//
//   node --test --test-concurrency=1 tests/e2e/catalog.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, typeCode, shot } from './helpers.mjs';
import { AGENCY, SOFTWARE, INSERT_SQL, agencyBook, softwareBook } from './catalog_sample.mjs';

const PW = 'Harbor-pencil-meadow-37';
let st; let browser; let owner; let co;
const open = [];
const one = (dep, text, data) => dep.sql(`select '@@R@@' || coalesce(to_jsonb((${text}))::text, 'null');`, data);
const insert = (list) => st.vyntex.sql(INSERT_SQL, { t: co.tenantId, d: JSON.stringify(list) });
const tabs = () => owner.page.$$eval('[data-testid=catalog-books] [role=tab]', (els) => els.map((b) => ({ book: b.dataset.book, text: b.innerText.replace(/\s+/g, ' ').trim(), on: b.getAttribute('aria-selected') === 'true' })));
const groups = () => owner.page.$$eval('[data-testid=catalog-group] b', (els) => els.map((b) => b.textContent));
const toCatalog = async (q = '') => { await owner.go(`/${co.slug}/catalog${q}`); await owner.page.waitForSelector('[data-testid=catalog-list]'); };

before(async () => {
  st = await startStack();
  browser = await launch();
  // the production setting of VYNTEX ERP (supabase/setup/go-live.sql): owners and managers of every company use an authenticator
  await st.vyntex.sql(`update app.server_settings set value = '{"mfaRoles": ["owner", "manager"]}'::jsonb where key = 'security.required'; select '@@R@@' || '1';`);
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

test('the owner of a new company accepts the invitation and opens an empty catalog', async () => {
  co = await st.vyntex.company({ industry: 'practice', name: 'Sample Catalog Company', slug: 'sample-catalog-co' });
  owner = await person(browser, st.vyntex.origin); open.push(owner);
  await owner.go(co.inviteLink.replace(st.vyntex.origin, ''));
  await owner.page.waitForSelector('[data-testid=auth-invite-form]');
  await owner.page.fill('[data-testid=auth-invite-name]', 'Cam Sample');
  await owner.page.fill('[data-testid=auth-invite-password]', PW); await owner.page.fill('[data-testid=auth-invite-again]', PW);
  await owner.page.click('[data-testid=auth-submit]');
  await owner.page.waitForSelector('[data-testid=auth-enroll]');
  const secret = await owner.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  await typeCode(owner, st.vyntex.totp(secret));
  await owner.page.waitForSelector('[data-testid=auth-codes]');
  await owner.page.check('[data-testid=auth-codes-kept]');
  await owner.page.click('[data-testid=auth-codes-continue]');
  await owner.workspace();
  await owner.go(`/${co.slug}/catalog`);
  await owner.page.waitForSelector('text=No services yet');
  assert.equal(await owner.page.$('[data-testid=catalog-books]'), null);
  assert.deepEqual(owner.errors, []);
});

test('one book: the page looks as it always did, in the order of the book, and a quoted tier reads "Quote"', async () => {
  await insert(agencyBook);
  await toCatalog();
  assert.equal(await owner.page.$('[data-testid=catalog-books]'), null, 'no sub-tabs with a single book');
  assert.deepEqual(await groups(), ['Agency packages', 'CRM', 'Websites', 'AI tools', 'Branding', 'Add-ons', 'Hourly rates'], 'categories follow categoryOrder');
  const sites = await owner.page.$$eval('[data-testid=catalog-list] tr[data-service] .catalog-name', (els) => els.map((a) => a.textContent));
  assert.ok(sites.indexOf('Growth Package') < sites.indexOf('Enterprise Package') && sites.indexOf('Business Website') < sites.indexOf('Online Store'), 'services follow their order');
  const row = (name) => owner.page.locator('tr[data-service]', { hasText: name }).first().innerText();
  const ent = await row('Enterprise Package');
  assert.match(ent, /Quote/); assert.doesNotMatch(ent, /\$0\b/);
  assert.match(await row('Growth Package'), /Setup[\s\S]*\$1,500[\s\S]*\$497 \/ month/);
  assert.match(await row('Business Website'), /From \$4,000/);
  assert.match(await row('Extra Web Form'), /\$25 per form/);
  assert.match(await row('Online Store'), /From \$6,500/);
  assert.deepEqual(owner.errors, []);
});

test('two books: sub-tabs with counts, the tab is in the address and survives a reload; Other appears for services in no book', async () => {
  await insert(softwareBook);
  await toCatalog();
  assert.deepEqual(await tabs(), [
    { book: 'all', text: 'All 13', on: true }, { book: 'sample-agency-services', text: `${AGENCY} 9`, on: false }, { book: 'sample-software-plans', text: `${SOFTWARE} 4`, on: false },
  ]);
  await owner.page.click('[data-testid=catalog-books] [data-book=sample-software-plans]');
  await owner.page.waitForFunction(() => location.search === '?book=sample-software-plans');
  assert.deepEqual(await groups(), ['Editions', 'ERP add-ons']);
  assert.match(await owner.page.innerText('[data-testid=catalog-sum]'), /^4 services/);
  await shot(owner, 'catalog-live-software');
  await owner.page.reload(); await owner.workspace(); await owner.page.waitForSelector('[data-testid=catalog-list]');
  assert.equal((await tabs()).find((x) => x.on).book, 'sample-software-plans', 'the tab survives a reload');
  assert.deepEqual(await groups(), ['Editions', 'ERP add-ons']);
  // search and the category filter work inside the book
  await owner.page.fill('.catalog-filters input', 'storage');
  await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid=catalog-list] tr[data-service]').length === 1);
  await owner.page.fill('.catalog-filters input', 'growth');
  await owner.page.waitForSelector('[data-testid=catalog-clear-empty]');
  await owner.page.click('[data-testid=catalog-clear-empty]');
  const cats = await owner.page.$$eval('[data-testid=catalog-filter-category] option', (els) => els.map((o) => o.textContent));
  assert.deepEqual(cats.slice(1), ['Editions', 'ERP add-ons'], 'the category filter offers the categories of the book');

  await insert([{ name: 'Loose Sample Service', category: 'Misc', i18n: null, extra: {}, tiers: [{ name: 'Standard', price: 40, unit: 'hour', extra: {} }] }]);
  await toCatalog('?book=other');
  assert.deepEqual((await tabs()).map((x) => x.text), ['All 14', `${AGENCY} 9`, `${SOFTWARE} 4`, 'Other 1']);
  assert.equal((await tabs()).find((x) => x.on).book, 'other');
  assert.deepEqual(await groups(), ['Misc']);
  // an address naming no book opens All
  await toCatalog('?book=nothing-like-this');
  assert.equal((await tabs()).find((x) => x.on).book, 'all');
  assert.deepEqual(owner.errors, []);
});

test('a service page shows Best for and the lists; editing it in the form keeps the book, the lists and the tier flags in the database', async () => {
  await toCatalog('?book=sample-software-plans');
  await owner.page.click('a.catalog-name:has-text("ERP Starter")');
  await owner.page.waitForSelector('[data-testid=catalog-includes]');
  assert.match(await owner.page.innerText('[data-testid=catalog-includes]'), /Best for: Offices with up to 5 people\.[\s\S]*Leads, clients and jobs[\s\S]*Data migration/);
  assert.match(await owner.page.innerText('[data-testid=catalog-tiers]'), /\$49 \/ month per user[\s\S]*Setup[\s\S]*\$500/);
  await shot(owner, 'catalog-live-service');

  await owner.page.click('[data-testid=catalog-edit]');
  await owner.page.waitForSelector('[data-testid=catalog-f-book]');
  assert.equal(await owner.page.inputValue('[data-testid=catalog-f-book]'), SOFTWARE);
  assert.equal(await owner.page.inputValue('[data-testid=catalog-f-included]'), 'Leads, clients and jobs\nDocuments and e-signature\nTwo languages');
  assert.equal(await owner.page.inputValue('[data-testid=catalog-f-tier-per] >> nth=0'), 'per user');
  await owner.page.fill('[data-testid=catalog-f-tier-price] >> nth=0', '55');
  await owner.page.fill('[data-testid=catalog-f-included]', 'Leads, clients and jobs\nDocuments and e-signature\nTwo languages\nMobile app');
  await owner.synced(() => owner.page.click('[data-testid=catalog-save]'));

  const row = await one(st.vyntex, `(select jsonb_build_object('extra', s.extra, 'i18n', s.i18n, 'tiers', (select jsonb_agg(jsonb_build_object('name', x.name, 'price', x.price, 'extra', x.extra) order by x.position) from public.catalog_tiers x where x.service_id = s.id))
    from public.catalog_services s where s.tenant_id = (select v from _in where k = 't')::uuid and s.name = 'ERP Starter')`, { t: co.tenantId });
  assert.equal(row.extra.book, SOFTWARE); assert.equal(row.extra.bookOrder, 2); assert.equal(row.extra.categoryOrder, 1); assert.equal(row.extra.order, 1);
  assert.equal(row.extra.bestFor, 'Offices with up to 5 people.');
  assert.deepEqual(row.extra.highlights, ['Leads, clients and jobs', 'Documents and e-signature', 'Two languages', 'Mobile app']);
  assert.deepEqual(row.extra.excludes, ['Data migration']);
  assert.deepEqual(row.i18n.es.highlights, ['Prospectos, clientes y trabajos', 'Documentos y firma electrónica', 'Dos idiomas']);
  assert.equal(row.i18n.es.bestFor, 'Oficinas de hasta 5 personas.');
  assert.deepEqual(row.tiers.map((x) => [x.name, Number(x.price), x.extra]), [['Monthly', 55, { per: 'per user', kind: 'recurring' }], ['Onboarding', 500, { kind: 'setup' }]]);

  // a quoted tier keeps its flag through the form as well
  await toCatalog('?book=sample-software-plans');
  await owner.page.click('a.catalog-name:has-text("ERP Professional")');
  await owner.page.waitForSelector('[data-testid=catalog-tiers]');
  assert.match(await owner.page.innerText('[data-testid=catalog-tiers]'), /Onboarding[\s\S]*Quote/);
  await owner.page.click('[data-testid=catalog-edit]');
  await owner.page.waitForSelector('[data-testid=catalog-f-tier-quote]');
  assert.equal(await owner.page.isChecked('[data-testid=catalog-f-tier-quote] >> nth=1'), true);
  assert.equal(await owner.page.inputValue('[data-testid=catalog-f-tier-price] >> nth=1'), '', 'a quote opens with an empty price, not 0');
  await owner.synced(() => owner.page.click('[data-testid=catalog-save]'));
  const pro = await one(st.vyntex, `(select jsonb_agg(x.extra order by x.position) from public.catalog_tiers x join public.catalog_services s on s.id = x.service_id where s.tenant_id = (select v from _in where k = 't')::uuid and s.name = 'ERP Professional')`, { t: co.tenantId });
  assert.deepEqual(pro, [{ per: 'per user', kind: 'recurring' }, { kind: 'setup', quote: true }]);

  await owner.page.reload(); await owner.workspace(); await owner.page.waitForSelector('[data-testid=catalog-tiers]');
  assert.match(await owner.page.innerText('[data-testid=catalog-tiers]'), /Onboarding[\s\S]*Quote/);
  const refused = owner.applies.flatMap((a) => a.refused ?? a.rejected ?? []);
  assert.deepEqual(refused, [], 'nothing the page sent was refused');
  assert.deepEqual(owner.errors, []);
});

test('on a 390 px phone the sub-tabs, the list and a service page fit the screen', async () => {
  await owner.page.setViewportSize({ width: 390, height: 844 });
  const wide = () => owner.page.evaluate(() => document.documentElement.scrollWidth);
  await toCatalog('?book=sample-agency-services');
  assert.ok(await wide() <= 390, `the list is ${await wide()} px wide`);
  const bar = await owner.page.locator('[data-testid=catalog-books]').boundingBox();
  assert.ok(bar.x >= 0 && bar.x + bar.width <= 390, 'the sub-tabs stay on screen (they scroll sideways inside themselves)');
  await shot(owner, 'catalog-live-390');
  await owner.page.click('a.catalog-name:has-text("Growth Package")');
  await owner.page.waitForSelector('[data-testid=catalog-includes]');
  assert.ok(await wide() <= 390, `the service page is ${await wide()} px wide`);
  await shot(owner, 'catalog-live-service-390');
  assert.deepEqual(owner.errors, []);
});
