// Unit tests for the shop floor of the barbershop edition: the walk-in line and its estimates, checkout, memberships,
// packages and gift cards, loyalty points, barber pay in whole cents, the insights, and the shop automations.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export * as shop from '@/domain/actions/shop';
  export { PACKS } from '@/packs';
  export { loadSeed, seedOf } from '@/packs/seeds';
  export { makeT } from '@/i18n';
`);
const { shop, PACKS, makeT } = m;
const pack = PACKS.barber;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return iso(x); };
const user = (id, role) => ({ id, name: 'Barber ' + id, role, email: id + '@example.com', active: true });

/** A small shop at 10:00 today: three barbers in chairs, a menu of three services, the edition's rules. */
function world() {
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff')];
  d.apptTypes = [{ id: 'at1', name: { en: 'Cut', es: 'Corte' }, minutes: 30, fee: 30, prepay: false, mode: 'office', active: true, serviceId: 'cut' },
    { id: 'at2', name: { en: 'Fade', es: 'Desvanecido' }, minutes: 45, fee: 40, prepay: false, mode: 'office', active: true, serviceId: 'fade' },
    { id: 'at3', name: { en: 'Beard', es: 'Barba' }, minutes: 20, fee: 20, prepay: false, mode: 'office', active: true, serviceId: 'beard' }];
  const svc = (id, price, at) => ({ id, name: id, category: 'haircut', active: true, tiers: [{ id: id + '-t1', name: 'Standard', price, unit: 'flat' }], appointmentTypeId: at });
  d.catalog = [svc('cut', 30, 'at1'), svc('fade', 40, 'at2'), svc('beard', 20, 'at3')];
  d.chairs = [
    { id: 'c1', label: 'Chair 1', staffId: 'u1', status: 'open', walkIns: true, pay: 'commission', split: 100, ownSplit: 100 },
    { id: 'c2', label: 'Chair 2', staffId: 'u2', status: 'open', walkIns: true, pay: 'commission', split: 60, ownSplit: 100 },
    { id: 'c3', label: 'Chair 3', staffId: 'u3', status: 'open', walkIns: true, pay: 'rent', split: 100, ownSplit: 100, rent: 100 },
  ];
  d.rules = pack.rules.map((r) => ({ ...r, when: { ...r.when }, if: r.if.map((c) => ({ ...c })), then: r.then.map((s) => ({ ...s, params: { ...s.params } })) }));
  d.settings = { shop: { buffer: 5 } };
  const ctx = (actor = 'u2') => ({ pack, lang: 'en', t: makeT('en', pack), actor });
  const at10 = new Date(); at10.setHours(10, 0, 0, 0);
  return { d, ctx, at: (min) => new Date(at10.getTime() + min * 60000) };
}
const ok = (r) => { assert.ok(r.ok, 'refused: ' + (r.reason ?? '')); return r.value; };

test('the line: tickets count up per day, a guest with a phone joins the client list once, consent is recorded', () => {
  const { d, ctx, at } = world();
  const a = ok(shop.addWalkIn(d, ctx(), { name: '  Ana   Sample ', phone: '609-555-0101', serviceId: 'cut', source: 'desk', textOk: true }, at(0)));
  const b = ok(shop.addWalkIn(d, ctx(), { name: 'Ana Sample', phone: '(609) 555-0101', serviceId: 'fade', source: 'kiosk' }, at(1)));
  assert.equal(a.ticket, 1); assert.equal(b.ticket, 2);
  assert.equal(a.name, 'Ana Sample', 'extra spaces are tidied');
  assert.equal(a.clientId, b.clientId, 'the same phone number is the same client');
  assert.equal(d.clients.filter((c) => c.phone.includes('555-0101')).length, 1);
  assert.equal(d.clients.find((c) => c.id === a.clientId).smsOptIn, true);
  assert.deepEqual(shop.addWalkIn(d, ctx(), { name: '', source: 'desk' }, at(2)), { ok: false, reason: 'invalid' });
  assert.deepEqual(shop.addWalkIn(d, ctx(), { name: 'X', phone: '12', source: 'desk' }, at(2)), { ok: false, reason: 'invalid' }, 'a phone number that is not one is refused');
  shop.setQueueOpen(d, ctx(), false);
  assert.deepEqual(shop.addWalkIn(d, ctx(), { name: 'Late', source: 'kiosk' }, at(3)), { ok: false, reason: 'not_allowed' }, 'a paused line takes nobody new');
});

test('estimates: three free chairs serve three guests at once; the fourth waits for the first chair to free up, plus the buffer', () => {
  const { d, ctx, at } = world();
  for (const n of ['A', 'B', 'C', 'D']) ok(shop.addWalkIn(d, ctx(), { name: n, serviceId: 'cut', source: 'desk' }, at(0)));
  const plan = shop.planQueue(d, at(1));
  assert.deepEqual(plan.lines.map((l) => l.wait), [0, 0, 0, 35], 'cut 30 min + 5 min buffer');
  assert.equal(new Set(plan.lines.slice(0, 3).map((l) => l.chairId)).size, 3, 'one guest per chair');
  assert.equal(shop.quoteWait(d, 'cut', undefined, at(1)), 35, 'what the kiosk tells the next person is the same plan');
});

test('estimates: a booked appointment keeps its time; a walk-in goes in only when the service fits before it', () => {
  const { d, ctx, at } = world();
  d.chairs = d.chairs.slice(1, 2); // one chair, u2
  const t = (min) => { const x = at(min); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
  d.appointments = [{ id: 'ap1', typeId: 'at1', clientId: undefined, staffId: 'u2', date: day(0), time: t(20), minutes: 30, mode: 'office', status: 'confirmed', fee: 30, created: '', createdBy: 'u2' }];
  ok(shop.addWalkIn(d, ctx(), { name: 'Beard', serviceId: 'beard', source: 'desk' }, at(0)));
  ok(shop.addWalkIn(d, ctx(), { name: 'Fade', serviceId: 'fade', source: 'desk' }, at(0)));
  const [beard, fade] = shop.planQueue(d, at(0)).lines;
  assert.equal(beard.wait, 0, 'a 20 minute beard fits before the 10:20 booking');
  assert.equal(fade.wait, 55, 'the 45 minute fade waits until the booking is over (10:50) plus the buffer, rounded up to 5');
});

test('estimates: a guest who asked for a barber waits for that barber; the desk can switch them to the first available', () => {
  const { d, ctx, at } = world();
  ok(shop.addWalkIn(d, ctx(), { name: 'First', serviceId: 'fade', prefStaffId: 'u2', source: 'desk' }, at(0)));
  const w = ok(shop.addWalkIn(d, ctx(), { name: 'Second', serviceId: 'fade', prefStaffId: 'u2', source: 'desk' }, at(0)));
  let line = shop.planQueue(d, at(0)).lines.find((l) => l.walkinId === w.id);
  assert.equal(line.staffId, 'u2'); assert.equal(line.wait, 50);
  ok(shop.setPreference(d, ctx(), w.id, undefined));
  line = shop.planQueue(d, at(0)).lines.find((l) => l.walkinId === w.id);
  assert.notEqual(line.staffId, 'u2'); assert.equal(line.wait, 0);
});

test('a chair on a break, closed, or that does not offer the service takes nobody; with no barber at all the wait is -1', () => {
  const { d, ctx, at } = world();
  ok(shop.setChairStatus(d, ctx(), 'c1', 'break')); ok(shop.setChairStatus(d, ctx(), 'c2', 'off'));
  d.chairs[2].skipServiceIds = ['fade'];
  assert.equal(shop.quoteWait(d, 'fade', undefined, at(0)), -1);
  assert.equal(shop.quoteWait(d, 'cut', undefined, at(0)), 0);
});

test('call, seat, finish: the chair is busy while someone is in it; checkout records amount, tip and method, cash goes into the drawer', () => {
  const { d, ctx, at } = world();
  const w = ok(shop.addWalkIn(d, ctx(), { name: 'Guest', phone: '609-555-0102', serviceId: 'cut', source: 'desk', textOk: true }, at(0)));
  const called = ok(shop.callWalkIn(d, ctx(), w.id, undefined, at(1)));
  assert.equal(called.status, 'called'); assert.ok(called.chairId);
  ok(shop.startWalkIn(d, ctx(), w.id, at(2)));
  assert.equal(d.chairs.find((c) => c.id === called.chairId).status, 'busy');
  assert.equal(shop.setChairStatus(d, ctx(), called.chairId, 'off').reason, 'not_allowed', 'a chair with someone in it cannot be closed');
  assert.equal(shop.finishWalkIn(d, ctx(), w.id, { amount: 30, tip: 6.5, method: 'bitcoin' }, at(30)).reason, 'invalid');
  const done = ok(shop.finishWalkIn(d, ctx(), w.id, { amount: 30, tip: 6.5, method: 'cash' }, at(30)));
  assert.equal(done.status, 'done'); assert.equal(done.tip, 6.5);
  assert.equal(d.chairs.find((c) => c.id === called.chairId).status, 'open');
  assert.equal(d.cash.length, 1); assert.equal(d.cash[0].amount, 36.5); assert.equal(d.cash[0].category, 'client_payment');
  assert.equal(shop.finishWalkIn(d, ctx(), w.id, { amount: 30, method: 'cash' }, at(31)).reason, 'already', 'a visit is paid once');
  const n = shop.dayNumbers(d, iso(at(0)));
  assert.equal(n.services, 30); assert.equal(n.tips, 6.5); assert.equal(n.served, 1); assert.equal(n.avgWait, 2);
});

test('the shop automations: joining the line prepares the text with the ticket and wait; a long wait tells the manager; a finished visit prepares a review request', () => {
  const { d, ctx, at } = world();
  d.chairs = d.chairs.slice(0, 1);
  const first = ok(shop.addWalkIn(d, ctx(), { name: 'Ana Sample', phone: '609-555-0103', serviceId: 'fade', source: 'desk', textOk: true }, at(0)));
  const text = d.messages.find((x) => x.clientId === first.clientId);
  assert.ok(text && text.status === 'draft' && /#1/.test(text.body) && /about 0 minutes/.test(text.body), 'the draft carries the ticket and the wait: ' + text?.body);
  for (const n of ['B Sample', 'C Sample']) ok(shop.addWalkIn(d, ctx(), { name: n, serviceId: 'fade', source: 'desk' }, at(0)));
  assert.ok(d.automation.runs.some((r) => r.ruleId === 'b-long-wait' && r.status === 'ok'), 'a wait over 45 minutes reaches the manager');
  ok(shop.startWalkIn(d, ctx(), first.id, at(1)));
  ok(shop.finishWalkIn(d, ctx(), first.id, { amount: 40, tip: 8, method: 'card' }, at(45)));
  assert.ok(d.reviews.some((r) => r.clientId === first.clientId), 'a review request was prepared');
});

test('memberships: sold with the first month paid, one visit per covered service, pause and renew; a second active membership is refused', () => {
  const { d, ctx } = world();
  d.clients = [{ id: 'k1', name: 'Member Sample', phone: '609-555-0104', email: '', addresses: [], since: day(-1), notes: [] }];
  const plan = ok(shop.savePassPlan(d, ctx(), { kind: 'membership', name: 'Club', price: 60, visits: 2, serviceIds: ['cut', 'fade'], active: true }));
  const p = ok(shop.sellPass(d, ctx(), { planId: plan.id, clientId: 'k1', method: 'card' }));
  assert.equal(p.visitsLeft, 2); assert.ok(p.renews > day(0));
  assert.equal(shop.sellPass(d, ctx(), { planId: plan.id, clientId: 'k1', method: 'card' }).reason, 'already');
  assert.equal(shop.redeemPass(d, ctx(), p.id, { apptId: 'x', amount: 20, serviceId: 'beard' }).reason, 'not_allowed', 'a beard is not covered');
  const r1 = ok(shop.redeemPass(d, ctx(), p.id, { apptId: 'a1', amount: 30, serviceId: 'cut' }));
  assert.equal(r1.value, 30, 'a visit is worth its share: 60 a month for 2 visits');
  assert.equal(shop.redeemPass(d, ctx(), p.id, { apptId: 'a1', amount: 30 }).reason, 'already', 'the same visit is never paid twice');
  ok(shop.redeemPass(d, ctx(), p.id, { apptId: 'a2', amount: 30 }));
  assert.equal(shop.redeemPass(d, ctx(), p.id, { apptId: 'a3', amount: 30 }).reason, 'empty');
  ok(shop.setPassStatus(d, ctx(), p.id, 'paused'));
  assert.equal(shop.usablePasses(d, 'k1').length, 0, 'a paused membership pays for nothing');
  const renewed = ok(shop.renewMembership(d, ctx(), p.id, 'cash'));
  assert.equal(renewed.status, 'active'); assert.equal(renewed.visitsLeft, 2);
  assert.equal(d.cash.at(-1).amount, 60, 'a cash renewal goes into the drawer');
  // the morning sweep marks a membership past due when its billing date passed without a payment
  renewed.renews = day(-1); shop.sweepPasses(d, ctx());
  assert.equal(renewed.status, 'past_due');
});

test('packages and gift cards: used up exactly, never below zero, expired cards close; a gift card has a readable code', () => {
  const { d, ctx } = world();
  d.clients = [{ id: 'k1', name: 'Pack Sample', phone: '609-555-0105', email: '', addresses: [], since: day(-1), notes: [] }];
  const pk = ok(shop.savePassPlan(d, ctx(), { kind: 'package', name: '3 cuts', price: 75, visits: 3, serviceIds: [], active: true }));
  const p = ok(shop.sellPass(d, ctx(), { planId: pk.id, clientId: 'k1', method: 'card' }));
  for (const id of ['v1', 'v2', 'v3']) assert.equal(ok(shop.redeemPass(d, ctx(), p.id, { walkinId: id, amount: 30 })).value, 25);
  assert.equal(p.status, 'used_up');
  const g = ok(shop.sellPass(d, ctx(), { kind: 'gift_card', holder: 'For a friend', amount: 50, method: 'cash' }));
  assert.match(g.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(shop.redeemPass(d, ctx(), g.id, { amount: 50.01 }).reason, 'not_enough');
  ok(shop.redeemPass(d, ctx(), g.id, { amount: 0.1 })); ok(shop.redeemPass(d, ctx(), g.id, { amount: 0.2 }));
  assert.equal(g.balance, 49.7, 'whole cents: 50 - 0.1 - 0.2');
  g.expires = day(-1); shop.sweepPasses(d, ctx());
  assert.equal(g.status, 'expired');
});

test('barber pay: share of shop clients, own-client rate, tips never in the base, chair rent off; paid once, after the week', () => {
  const { d, ctx } = world();
  const { from } = shop.weekOf(day(-7));
  const mon = (n) => { const [y, mo, dd] = from.split('-').map(Number); return iso(new Date(y, mo - 1, dd + n)); };
  const appt = (id, staffId, fee, tip, own, date) => ({ id, typeId: 'at1', clientId: 'k1', staffId, date, time: '10:00', minutes: 30, mode: 'office', status: 'completed', fee, paid: { at: '', method: 'card', ref: '', amount: fee }, tip, own, created: '', createdBy: 'u2' });
  d.clients = [{ id: 'k1', name: 'Sample', phone: '', email: '', addresses: [], since: day(-30), notes: [] }];
  d.appointments = [appt('a1', 'u2', 40, 8, false, mon(0)), appt('a2', 'u2', 33.33, 5, true, mon(2)), appt('a3', 'u3', 30, 4, false, mon(3)), appt('a4', 'u2', 99, 0, false, mon(8))];
  const s2 = shop.statementFor(d, 'u2', from);
  assert.equal(s2.visits, 2, 'the visit of the next week is not in this one');
  assert.equal(s2.services, 73.33); assert.equal(s2.share, 57.33, '60% of 40 = 24.00, plus 100% of 33.33 for the own client');
  assert.equal(s2.tips, 13); assert.equal(s2.amount, 70.33); assert.equal(s2.shop, 16);
  const s3 = shop.statementFor(d, 'u3', from);
  assert.equal(s3.share, 30, 'a renter keeps every service'); assert.equal(s3.rent, 100); assert.equal(s3.amount, -66, 'and owes the shop when the rent is more');
  assert.equal(shop.payStatement(d, ctx(), 'u2', shop.weekOf(day(0)).from, 'transfer').reason, 'not_allowed', 'the week in progress cannot be paid');
  assert.equal(shop.payStatement(d, ctx(), 'u2', mon(1), 'transfer').reason, 'invalid', 'a week starts on Monday');
  const p = ok(shop.payStatement(d, ctx(), 'u2', from, 'transfer'));
  assert.equal(p.amount, 70.33);
  assert.equal(shop.payStatement(d, ctx(), 'u2', from, 'transfer').reason, 'already');
  d.appointments[0].tip = 100;
  assert.equal(shop.statementFor(d, 'u2', from).paid.amount, 70.33, 'what was paid is frozen on the payout');
});

test('loyalty points: one point per dollar of services, tips excluded; a reward turns points into a gift card once', () => {
  const { d, ctx } = world();
  d.clients = [{ id: 'k1', name: 'Loyal Sample', phone: '', email: '', addresses: [], since: day(-90), notes: [] }];
  d.settings = { shop: { rewardPoints: 100, rewardValue: 10 } };
  d.appointments = [1, 2, 3].map((i) => ({ id: 'a' + i, typeId: 'at2', clientId: 'k1', staffId: 'u2', date: day(-i * 7), time: '10:00', minutes: 45, mode: 'office', status: 'completed', fee: 40, paid: { at: '', method: 'card', ref: '', amount: 40 }, tip: 50, created: '', createdBy: 'u2' }));
  assert.deepEqual(shop.pointsOf(d, 'k1'), { earned: 120, spent: 0, balance: 120, visits: 3, spentMoney: 120 });
  const card = ok(shop.redeemPoints(d, ctx(), 'k1'));
  assert.equal(card.balance, 10);
  assert.equal(shop.pointsOf(d, 'k1').balance, 20);
  assert.equal(shop.redeemPoints(d, ctx(), 'k1').reason, 'not_enough');
});

test('insights: a client past their own rhythm with nothing booked is due; a booking takes them off; misses put an appointment on the watch list', () => {
  const { d } = world();
  d.clients = [{ id: 'k1', name: 'Regular', phone: '', email: '', addresses: [], since: day(-90), notes: [] }];
  const visit = (id, off, status = 'completed') => ({ id, typeId: 'at1', clientId: 'k1', staffId: 'u2', date: day(off), time: '10:00', minutes: 30, mode: 'office', status, fee: 30, created: '', createdBy: 'u2' });
  d.appointments = [visit('a1', -44), visit('a2', -30), visit('a3', -16)];
  const due = shop.dueForCut(d);
  assert.equal(due.length, 1); assert.equal(due[0].gap, 14); assert.equal(due[0].overdue, 2); assert.equal(due[0].staffId, 'u2');
  d.appointments.push(visit('a4', 3, 'scheduled'));
  assert.equal(shop.dueForCut(d).length, 0);
  assert.equal(shop.atRisk(d).length, 0);
  d.appointments.push(visit('a0', -60, 'no_show'));
  assert.deepEqual(shop.atRisk(d).map((x) => [x.appointment.id, x.misses]), [['a4', 1]]);
});

test('the waiting-area display shows a first name and an initial, never the full name', () => {
  assert.equal(shop.displayName('Jordan Hayes'), 'Jordan H.');
  assert.equal(shop.displayName('  Bryce   Lee Long '), 'Bryce L.');
  assert.equal(shop.displayName('Prince'), 'Prince');
});

test('the barbershop sample: every chair has a barber on file, the line is consistent, passes and payouts add up to the cent', async () => {
  await m.loadSeed('barber');
  for (const lang of ['en', 'es']) {
    const s = m.seedOf('barber')(lang);
    const users = new Set(s.users.map((u) => u.id)); const clients = new Set(s.clients.map((c) => c.id));
    for (const c of s.chairs) if (c.staffId) assert.ok(users.has(c.staffId), 'chair ' + c.id);
    for (const w of s.walkins) {
      if (w.clientId) assert.ok(clients.has(w.clientId), 'walk-in ' + w.id);
      if (w.status === 'done') assert.ok(w.staffId && w.startedAt && w.doneAt && w.doneAt >= w.startedAt, 'served walk-in ' + w.id);
    }
    for (const a of s.appointments) { assert.ok(!a.clientId || clients.has(a.clientId)); assert.ok(users.has(a.staffId)); }
    for (const p of s.passes) {
      if (p.kind === 'gift_card') assert.ok(p.balance >= 0 && p.balance <= p.sold.amount, 'gift card ' + p.id);
      if (p.kind === 'package') assert.ok(p.visitsLeft >= 0, 'package ' + p.id);
      for (const u of p.uses) if (u.apptId) assert.equal(s.appointments.find((a) => a.id === u.apptId)?.passId, p.id, 'use ' + u.id + ' points at its visit');
    }
    const d = { ...blank(pack), ...s };
    for (const p of s.payouts) assert.equal(p.amount, shop.statementFor(d, p.staffId, p.from).paid.amount);
    assert.ok(shop.inLine(d).length >= 4, 'today there is a line');
  }
});
