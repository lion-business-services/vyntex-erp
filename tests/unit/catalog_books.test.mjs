// Unit tests for several catalogs ("books") in one company and for the richer price tiers: which sub-tabs a company
// sees, the order of books, categories and services, how a quoted tier reads (never $0) and that nothing a form does not
// edit is lost when a service is saved. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { saveService, duplicateService, importCatalog, addOpportunity } from '@/domain/actions';
  export { fromService } from '@/domain/actions/jobs';
  export { tierAmount, serviceHighlights, serviceExcludes, serviceBestFor, bookOf } from '@/domain/actions/catalog';
  export { tierPrice, priceFrom, booksOf, showBooks, bookSlug, categoriesOf, byServiceOrder, NO_BOOK } from '@/features/catalog/parts';
  export { catalogCsvRows, readCatalogCsv, COLUMNS } from '@/features/catalog/csv';
  export { PACKS } from '@/packs';
  export { makeT } from '@/i18n';
`);
const { saveService, duplicateService, importCatalog, fromService, tierAmount, serviceHighlights, serviceExcludes, serviceBestFor, bookOf, tierPrice, priceFrom, booksOf, showBooks, bookSlug,
  categoriesOf, byServiceOrder, NO_BOOK, catalogCsvRows, readCatalogCsv, COLUMNS, PACKS, makeT } = m;

/** A company that sells from two books, shaped like an agency and a software catalog. Nothing here is a real price. */
function world(lang = 'en') {
  const pack = PACKS.practice;
  const d = blank(pack);
  d.users = [{ id: 'u1', name: 'Owner Sample', role: 'owner', email: 'u1@example.com', active: true }];
  d.catalog = [
    { id: 'a1', name: 'Website Build', category: 'Websites', active: true, book: 'Agency Services', bookOrder: 1, categoryOrder: 2, order: 2,
      highlights: ['Up to 5 pages', 'Contact form'], excludes: ['Copywriting'], bestFor: 'New businesses',
      i18n: { es: { name: 'Sitio web', highlights: ['Hasta 5 páginas', 'Formulario de contacto'], bestFor: 'Negocios nuevos' } },
      tiers: [{ id: 'a1-t1', name: 'Build', price: 4000, unit: 'flat', from: true }] },
    { id: 'a2', name: 'Brand Kit', category: 'Branding', active: true, book: 'Agency Services', bookOrder: 1, categoryOrder: 1, order: 1,
      tiers: [{ id: 'a2-t1', name: 'Custom', price: 0, unit: 'flat', quote: true }] },
    { id: 'a3', name: 'Another Site', category: 'Websites', active: true, book: 'Agency Services', bookOrder: 1, categoryOrder: 2, order: 1,
      tiers: [{ id: 'a3-t1', name: 'Setup', price: 1500, unit: 'flat', kind: 'setup' }, { id: 'a3-t2', name: 'Care', price: 99, unit: 'month', kind: 'recurring' }] },
    { id: 'e1', name: 'ERP Starter', category: 'Editions', active: true, book: 'Software Plans', bookOrder: 0,
      tiers: [{ id: 'e1-t1', name: 'Seat', price: 25, unit: 'month', per: 'per user' }, { id: 'e1-t2', name: 'Onboarding', price: 900, unit: 'flat', kind: 'setup', quote: true, from: true }] },
    { id: 'x1', name: 'Loose Service', category: 'Other things', active: true, tiers: [{ id: 'x1-t1', name: 'Standard', price: 50, unit: 'hour' }] },
  ];
  const ctx = { pack, lang, t: makeT(lang, pack), actor: 'u1' };
  return { d, ctx, pack };
}

test('books: two books and services in none give All, each book by bookOrder, then Other', () => {
  const { d } = world();
  const books = booksOf(d.catalog);
  assert.deepEqual(books, [{ name: 'Software Plans', slug: 'software-plans' }, { name: 'Agency Services', slug: 'agency-services' }]);
  assert.equal(showBooks(d.catalog, books), true);
  // a single book and nothing outside it: the page stays as it was
  const one = d.catalog.filter((s) => s.book === 'Agency Services');
  assert.equal(showBooks(one, booksOf(one)), false);
  // no book at all
  const none = d.catalog.map(({ book: _b, ...s }) => s);
  assert.equal(showBooks(none, booksOf(none)), false);
  // one book plus services in none: worth a tab each
  const mixed = [...one, d.catalog.find((s) => s.id === 'x1')];
  assert.equal(showBooks(mixed, booksOf(mixed)), true);
  assert.equal(bookSlug('VYNTEX ERP'), 'vyntex-erp'); assert.equal(bookSlug('Catálogo Español'), 'catalogo-espanol');
  assert.notEqual(booksOf([{ ...one[0], book: 'Other' }, ...one])[0].slug, NO_BOOK, 'a book called Other never takes the address of the services in no book');
  assert.equal(bookOf({ book: '  Agency Services ' }), 'Agency Services');
});

test('order: categories by categoryOrder, services by order, then the name', () => {
  const { d, pack } = world();
  const agency = d.catalog.filter((s) => s.book === 'Agency Services');
  assert.deepEqual(categoriesOf(pack, agency), ['Branding', 'Websites']);
  const sites = agency.filter((s) => s.category === 'Websites').sort(byServiceOrder('en'));
  assert.deepEqual(sites.map((s) => s.id), ['a3', 'a1']);
  // without any order the categories and services read as before: alphabetical
  const plain = d.catalog.map(({ categoryOrder: _c, order: _o, ...s }) => s);
  assert.deepEqual(categoriesOf(pack, plain.filter((s) => s.book === 'Agency Services')), ['Branding', 'Websites']);
  assert.deepEqual(plain.filter((s) => s.category === 'Websites').sort(byServiceOrder('en')).map((s) => s.id), ['a3', 'a1']);
});

test('prices: Quote, From, the per label and Setup; a quoted tier never reads $0', () => {
  for (const lang of ['en', 'es']) {
    const { d, ctx } = world(lang); const t = ctx.t;
    const by = (id) => d.catalog.flatMap((s) => s.tiers).find((x) => x.id === id);
    const quote = tierPrice(t, by('a2-t1'));
    assert.equal(quote, lang === 'en' ? 'Quote' : 'A cotizar');
    assert.doesNotMatch(quote, /\$/);
    assert.equal(tierPrice(t, by('a1-t1')), lang === 'en' ? 'From $4,000' : 'Desde $4,000');
    assert.equal(tierPrice(t, by('e1-t1')), lang === 'en' ? '$25 / month per user' : '$25 / mes per user');
    assert.equal(tierPrice(t, by('e1-t2')), lang === 'en' ? 'From $900' : 'Desde $900', 'a quote with a starting price shows it as From');
    assert.equal(tierPrice(t, by('a3-t1'), true), lang === 'en' ? '$1,500 · Setup' : '$1,500 · Configuración inicial');
    // a quoted tier with a price but no "From" is still a quote
    assert.equal(tierPrice(t, { price: 700, unit: 'flat', quote: true }), lang === 'en' ? 'Quote' : 'A cotizar');
    assert.equal(priceFrom(t, d.catalog.find((s) => s.id === 'a2')), lang === 'en' ? 'Quote' : 'A cotizar');
    assert.equal(priceFrom(t, d.catalog.find((s) => s.id === 'a1')), lang === 'en' ? 'From $4,000' : 'Desde $4,000');
    for (const s of d.catalog) for (const x of s.tiers) assert.doesNotMatch(tierPrice(t, x, true), /[\u2013\u2014]/, 'no long dashes');
  }
});

test('a quoted tier puts no price on new work: the person types the agreed amount', () => {
  const { d, ctx } = world();
  assert.equal(tierAmount({ price: 900, quote: true }), 0);
  assert.equal(tierAmount({ price: 900 }), 900);
  assert.equal(fromService(d, ctx, 'a2').price, 0);
  assert.equal(fromService(d, ctx, 'e1', 'e1-t2').price, 0, 'a quote with a starting price still starts empty');
  assert.equal(fromService(d, ctx, 'e1', 'e1-t1').price, 25);
});

test('saving a service keeps its book, lists, order and tier flags; the form can change and clear them', () => {
  const { d, ctx } = world();
  const s = d.catalog.find((x) => x.id === 'a1');
  s.tiers[0].somethingElse = 'kept';
  // what the form sends: names, descriptions and lists per language, the book, tiers with their flags; no order fields
  const saved = saveService(d, ctx, {
    name: 'Website Build', category: 'Websites', active: true, book: 'Agency Services', bestFor: 'New businesses', highlights: ['Up to 5 pages', 'Contact form', ' '], excludes: ['Copywriting'],
    i18n: { en: { name: 'Website Build', highlights: ['Up to 5 pages', 'Contact form'] }, es: { name: 'Sitio web', bestFor: 'Negocios nuevos', highlights: ['Hasta 5 páginas', 'Formulario de contacto'] } },
    tiers: [{ id: 'a1-t1', name: 'Build', price: 4000, unit: 'flat', from: true, quote: false, per: '' }, { name: 'Hosting', price: 30, unit: 'month', per: 'per site', kind: 'recurring' }],
  }, 'a1');
  assert.equal(saved.book, 'Agency Services'); assert.equal(saved.bookOrder, 1); assert.equal(saved.order, 2); assert.equal(saved.categoryOrder, 2);
  assert.deepEqual(saved.highlights, ['Up to 5 pages', 'Contact form']);
  assert.deepEqual(saved.i18n.es.highlights, ['Hasta 5 páginas', 'Formulario de contacto']);
  assert.equal(saved.i18n.es.bestFor, 'Negocios nuevos');
  assert.deepEqual(saved.tiers[0], { id: 'a1-t1', name: 'Build', price: 4000, unit: 'flat', from: true, somethingElse: 'kept' });
  assert.deepEqual({ ...saved.tiers[1], id: 'x' }, { id: 'x', name: 'Hosting', price: 30, unit: 'month', per: 'per site', kind: 'recurring' });
  assert.deepEqual(serviceHighlights(saved, 'es'), ['Hasta 5 páginas', 'Formulario de contacto']);
  assert.deepEqual(serviceExcludes(saved, 'es'), ['Copywriting'], 'a list not translated falls back to the base one');
  assert.equal(serviceBestFor(saved, 'en'), 'New businesses');

  // a caller that does not mention the lists or a tier's flags keeps them
  const again = saveService(d, ctx, { name: 'Website Build', category: 'Websites', active: true, tiers: [{ id: 'a1-t1', name: 'Build', price: 4500, unit: 'flat' }] }, 'a1');
  assert.equal(again.book, 'Agency Services'); assert.deepEqual(again.highlights, ['Up to 5 pages', 'Contact form']); assert.equal(again.tiers[0].from, true);
  assert.deepEqual(again.i18n.es.highlights, ['Hasta 5 páginas', 'Formulario de contacto'], 'a translation written elsewhere is not dropped');

  // the form clears them on purpose
  const cleared = saveService(d, ctx, { name: 'Website Build', category: 'Websites', active: true, book: '', highlights: [], excludes: [], bestFor: '', i18n: { es: { highlights: [], bestFor: '' } },
    tiers: [{ id: 'a1-t1', name: 'Build', price: 4500, unit: 'flat', from: false, quote: true }] }, 'a1');
  assert.equal(cleared.book, undefined); assert.equal(cleared.highlights, undefined); assert.equal(cleared.i18n.es.highlights, undefined); assert.equal(cleared.i18n.es.name, 'Sitio web');
  assert.equal(cleared.tiers[0].from, undefined); assert.equal(cleared.tiers[0].quote, true);

  // a copy keeps the book, the lists and the flags
  const copy = duplicateService(d, ctx, 'e1');
  assert.equal(copy.book, 'Software Plans'); assert.equal(copy.tiers[1].quote, true); assert.equal(copy.tiers[0].per, 'per user');
});

test('a file: the export carries the book and the tier flags; an import puts a new service in the book of its line and keeps flags', () => {
  const { d, ctx, pack } = world();
  const rows = catalogCsvRows(d, d.catalog.filter((s) => s.book === 'Software Plans'), ctx.t, pack);
  const head = rows[0]; const at = (c) => head.indexOf(c);
  assert.ok(['book', 'quoted', 'from_price', 'per', 'kind'].every((c) => COLUMNS.includes(c)));
  assert.equal(rows.length, 3);
  assert.equal(rows[1][at('book')], 'Software Plans'); assert.equal(rows[1][at('per')], 'per user');
  assert.equal(rows[2][at('quoted')], true); assert.equal(rows[2][at('kind')], 'setup');
  const parsed = readCatalogCsv('service,tier,price,unit,book\nFresh Plan,Seat,30,month,Software Plans\nERP Starter,Onboarding,950,flat,\n', pack);
  importCatalog(d, ctx, parsed.rows, true);
  assert.equal(d.catalog.find((s) => s.name === 'Fresh Plan').book, 'Software Plans');
  const onb = d.catalog.find((s) => s.id === 'e1').tiers[1];
  assert.equal(onb.price, 950); assert.equal(onb.quote, true); assert.equal(onb.kind, 'setup');
});
