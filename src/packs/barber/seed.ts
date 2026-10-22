// The sample business of the barbershop edition: a fictional shop, "Northline Barber Studio".
// Put together from parts, one file per area:
//   seed/people.ts    the team, the shop and its chairs          seed/menu.ts       services, booking types, memberships
//   seed/clients.ts   the regulars and how often they come        seed/floor.ts      visits, walk-ins, passes, weekly pay
//   seed/business.ts  group bookings, tasks, messages, reviews, cash, posts, paperwork, cross-sell, audit
// Nothing here is a real person, shop, price or review.
import type { Activity, Lang, SeedData } from '@/domain/types';
import { people } from './seed/people';
import { menu } from './seed/menu';
import { clients } from './seed/clients';
import { floor } from './seed/floor';
import { business } from './seed/business';
import { stamp } from '../practice/seed/util';
import { daysBetween, today } from '@/lib/dates';

export function seed(lang: Lang): SeedData {
  const team = people(lang); const m = menu(lang); const cl = clients(lang);
  const fl = floor(lang, { catalog: m.catalog, apptTypes: m.apptTypes, passPlans: m.passPlans, clients: cl.clients, chairs: team.chairs });
  const b = business(lang, { clients: cl.clients, appointments: fl.appointments, walkins: fl.walkins });
  const allClients = [...cl.clients, ...b.extraClients];
  const ago = (date: string) => -daysBetween(date, today());
  const activity: Activity[] = [
    ...allClients.map((c): Activity => ({ id: 'a-' + c.id, at: stamp(ago(c.since), 14), kind: 'client.created', ref: { type: 'client', id: c.id }, by: c.assignedTo ?? 'u1' })),
    ...b.leads.map((l): Activity => ({ id: 'a-' + l.id, at: stamp(ago(l.created), 13), kind: 'lead.created', params: { lead: l.name, source: l.source }, ref: { type: 'lead', id: l.id }, by: l.source === 'website' ? 'automation' : l.ownerId })),
    ...b.jobs.map((j): Activity => ({ id: 'a-' + j.id, at: stamp(ago(j.created), 15), kind: 'job.created', params: { job: j.name }, ref: { type: 'job', id: j.id }, also: [{ type: 'client', id: j.clientId }], by: j.managerId })),
    ...b.jobs.flatMap((j) => j.received.map((r): Activity => ({ id: 'a-' + r.id, at: stamp(ago(r.date), 16), kind: 'payment.received', params: { amount: r.amount, job: j.name }, ref: { type: 'job', id: j.id }, also: [{ type: 'client', id: j.clientId }], by: j.managerId }))),
  ].sort((a, c) => c.at.localeCompare(a.at));
  return {
    users: team.users, offices: team.offices, config: team.config, chairs: team.chairs,
    clients: allClients, leads: b.leads, jobs: b.jobs, tasks: b.tasks, docs: b.docs, messages: b.messages, workers: [], workerPays: [], activity,
    catalog: m.catalog, apptTypes: m.apptTypes, passPlans: m.passPlans,
    appointments: fl.appointments, walkins: fl.walkins, passes: fl.passes, payouts: fl.payouts,
    reviews: b.reviews, cash: b.cash, posts: b.posts, crossSell: b.crossSell, opportunities: b.opportunities, audit: b.audit,
  };
}
