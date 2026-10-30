// Unit tests for the catalog cards: what a card shows for a package (setup and monthly), a software plan (monthly and
// yearly) and a single price, and that a line whose figure the company never set is left out. Run with `npm run test:unit`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';

const { cardPrice, isPlan, depositOf, makeT, PACKS } = await load(`
  export { cardPrice, isPlan, depositOf } from '@/features/catalog/cardModel';
  export { makeT } from '@/i18n';
  export { PACKS } from '@/packs';
`);
const t = makeT('en', PACKS.practice);
const es = makeT('es', PACKS.practice);
const lines = (p) => Object.fromEntries(p.lines.map((x) => [x.label, x.value]));

const pkg = { id: 'p', name: 'Sample package', category: 'Packages', active: true, minTermMonths: 12, installments: 3, prepayMonths: 10, leadTime: '7 to 10 business days',
  i18n: { es: { leadTime: '7 a 10 días hábiles' } },
  tiers: [{ id: 's', name: 'Setup', price: 900, unit: 'flat', kind: 'setup', note: 'Deposit to start: $450' }, { id: 'm', name: 'Monthly', price: 300, unit: 'month', kind: 'recurring' }] };

test('a package: setup to build, monthly under it, then deposit, balance, payments, the year, term and lead time', () => {
  const p = cardPrice(t, pkg, 'en');
  assert.equal(p.shape, 'build'); assert.equal(p.big, '$900'); assert.equal(p.suffix, 'to build'); assert.equal(p.second, '$300'); assert.equal(p.secondSuffix, '/mo');
  assert.deepEqual(lines(p), { 'Deposit to start': '$450', 'Balance at launch': '$450', 'or 3 payments of': '$300', 'Pay the year': '$3,000', 'Minimum term': '12 months', 'Ready in': '7 to 10 business days' });
  assert.equal(lines(cardPrice(es, pkg, 'es'))['Listo en'], '7 a 10 días hábiles');
});

test('terms the company never set are not shown', () => {
  const bare = { ...pkg, minTermMonths: undefined, installments: undefined, prepayMonths: undefined, leadTime: undefined, i18n: undefined, tiers: [{ ...pkg.tiers[0], note: undefined }, pkg.tiers[1]] };
  assert.deepEqual(cardPrice(t, bare, 'en').lines, []);
});

const plan = { id: 'pl', name: 'Pro', category: 'Plans', active: true, users: 5, welcomeCredit: 100,
  tiers: [{ id: 'm', name: 'Monthly', price: 119, unit: 'month' }, { id: 'y', name: 'Yearly', price: 1309, unit: 'year' }, { id: 's', name: 'Setup', price: 499, unit: 'flat', kind: 'setup' }] };

test('a software plan reads like the pricing page, monthly or yearly', () => {
  assert.equal(isPlan(plan), true); assert.equal(isPlan(pkg), false);
  const m = cardPrice(t, plan, 'en', 'month');
  assert.equal(m.big, '$119'); assert.equal(m.suffix, 'per month'); assert.equal(m.sub, 'or $1,309 per year'); assert.equal(m.save, 'Saves $119 a year over paying monthly');
  assert.deepEqual(lines(m), { 'One-time setup': '$499', 'Users included': 'Up to 5', 'Welcome credit': '$100' });
  const y = cardPrice(t, plan, 'en', 'year');
  assert.equal(y.big, '$1,309'); assert.equal(y.suffix, 'per year'); assert.equal(y.sub, 'or $119 per month');
  const one = cardPrice(t, { ...plan, users: 1, welcomeCredit: 0, tiers: [{ ...plan.tiers[0], price: 59 }, { ...plan.tiers[1], price: 708 }, plan.tiers[2]] }, 'en');
  assert.equal(one.save, 'Same total as paying monthly'); assert.equal(lines(one)['Users included'], '1'); assert.equal(lines(one)['Welcome credit'], 'None');
  assert.equal(lines(cardPrice(t, { ...plan, users: 'unlimited' }, 'en'))['Users included'], 'Unlimited');
});

test('a single price, an hourly rate and a quote', () => {
  assert.deepEqual([cardPrice(t, { ...pkg, tiers: [{ id: 'h', name: 'Hourly', price: 125, unit: 'hour' }] }, 'en')].map((p) => [p.big, p.suffix]), [['$125', 'per hour']]);
  const q = cardPrice(t, { ...pkg, tiers: [{ id: 'q', name: 'Quoted', price: 0, unit: 'flat', quote: true }] }, 'en');
  assert.equal(q.big, 'Quote'); assert.equal(q.sub, 'Priced for each client'); assert.equal(q.suffix, undefined);
  const qs = cardPrice(t, { ...pkg, tiers: [{ id: 's', name: 'Setup', price: 0, unit: 'flat', kind: 'setup', quote: true }, pkg.tiers[1]] }, 'en');
  assert.equal(qs.big, 'Quote'); assert.equal(lines(qs)['Deposit to start'], undefined);
  assert.equal(depositOf({ note: 'Deposit to start: $1,249' }), 1249); assert.equal(depositOf({ note: 'Bring photos' }), undefined);
});
