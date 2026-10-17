// Clients of the sample shop: regulars on different rhythms, members, kids and seniors, a business account, people who
// came in once as walk-ins, a client who misses appointments, and one who has not been back in a while.
// Fictional people: example.com addresses and 555 numbers. Ids bc1 to bc24 are fixed because the visits point at them.
// `HABITS` is how the sample visits are generated (seed/floor.ts): the usual barber, the usual service, the days between
// visits and when the client first came. It is part of the sample, not of the client record.
import type { Client, Lang } from '@/domain/types';
import { day, notes, txFor } from '../../practice/seed/util';

export interface Habit { barber: string; service: string; every: number; /** Days since the first visit on file. */ since: number; /** Days since the last visit (overrides the rhythm: someone who stopped coming). */ lastAgo?: number; own?: boolean; noShows?: number; walkIn?: boolean }
export const HABITS: Record<string, Habit> = {
  bc1: { barber: 'u2', service: 'sv-fade', every: 14, since: 70 },
  bc2: { barber: 'u1', service: 'sv-combo', every: 21, since: 70 },
  bc3: { barber: 'u2', service: 'sv-fade', every: 14, since: 66, own: true },
  bc4: { barber: 'u3', service: 'sv-cut', every: 28, since: 70 },
  bc5: { barber: 'u1', service: 'sv-beard', every: 10, since: 60 },
  bc6: { barber: 'u3', service: 'sv-fade', every: 18, since: 70 },
  bc7: { barber: 'u2', service: 'sv-combo', every: 21, since: 63, own: true },
  bc8: { barber: 'u1', service: 'sv-cut', every: 21, since: 70, lastAgo: 30 },
  bc9: { barber: 'u5', service: 'sv-cut', every: 28, since: 56 },
  bc10: { barber: 'u3', service: 'sv-combo', every: 21, since: 70, own: true },
  bc11: { barber: 'u4', service: 'sv-fade', every: 7, since: 70 },
  bc12: { barber: 'u4', service: 'sv-combo', every: 10, since: 70 },
  bc13: { barber: 'u5', service: 'sv-kids', every: 35, since: 70 },
  bc14: { barber: 'u5', service: 'sv-kids', every: 28, since: 45 },
  bc15: { barber: 'u1', service: 'sv-senior', every: 28, since: 70 },
  bc16: { barber: 'u3', service: 'sv-fade', every: 14, since: 70, lastAgo: 26 },
  bc17: { barber: 'u2', service: 'sv-cut', every: 28, since: 70, noShows: 2 },
  bc18: { barber: 'u1', service: 'sv-shave', every: 21, since: 50 },
  bc19: { barber: 'u3', service: 'sv-cut', every: 30, since: 70, lastAgo: 52 },
  bc20: { barber: 'u5', service: 'sv-cut', every: 30, since: 12, walkIn: true },
  bc21: { barber: 'u3', service: 'sv-fade', every: 20, since: 9, walkIn: true },
  bc22: { barber: 'u2', service: 'sv-gray', every: 35, since: 70 },
  bc23: { barber: 'u4', service: 'sv-fade', every: 7, since: 40 },
  bc24: { barber: 'u1', service: 'sv-cut', every: 25, since: 70 },
};

export function clients(lang: Lang): { clients: Client[] } {
  const tx = txFor(lang);
  const p = (id: string, name: string, phone: string, more: Partial<Client> = {}): Client => {
    const h = HABITS[id];
    return { id, name, phone, email: `${name.split(' ')[0].toLowerCase()}.${id}@example.com`, addresses: [], since: day(-(h?.since ?? 30)), notes: [], kind: 'individual', clientType: 'regular',
      lifecycle: 'active', assignedTo: h?.barber, lang: 'en', smsOptIn: true, ...more };
  };
  return {
    clients: [
      p('bc1', 'Jordan Hayes', '609-555-0711', { clientType: 'member', birthday: '1996-' + day(5).slice(5), tags: [tx('member', 'miembro')],
        notes: notes('bc1', 'u2', [[-60, 'note', tx('Number 1 on the sides, scissor on top. Likes a hard part.', 'Número 1 a los lados, tijera arriba. Le gusta la raya marcada.')]]) }),
      p('bc2', 'Rafael Ortiz', '609-555-0712', { lang: 'es', birthday: '1979-02-14', tags: [tx('loyal', 'fiel')], whatsappOptIn: true, whatsapp: '609-555-0712' }),
      p('bc3', 'Malik Johnson', '609-555-0713', { clientType: 'member', tags: [tx('member', 'miembro'), tx('own book', 'cartera propia')],
        notes: notes('bc3', 'u2', [[-66, 'note', tx('Followed Keisha from her old shop. Her own client: 100% to her.', 'Siguió a Keisha desde su barbería anterior. Cliente propio: 100% para ella.')]]) }),
      p('bc4', 'Ethan Brooks', '609-555-0714'),
      p('bc5', 'Victor Salazar', '609-555-0715', { clientType: 'member', lang: 'es', tags: [tx('member', 'miembro')] }),
      p('bc6', 'Darnell Price', '609-555-0716', { notes: notes('bc6', 'u3', [[-20, 'note', tx('Bought the 5-cut pack. One visit left.', 'Compró el paquete de 5 cortes. Le queda una visita.')]]) }),
      p('bc7', 'Chris Albright', '609-555-0717', { tags: [tx('own book', 'cartera propia')] }),
      p('bc8', 'Samuel Okoro', '609-555-0718', { clientType: 'member', tags: [tx('member', 'miembro')],
        notes: notes('bc8', 'u6', [[-4, 'call', tx('Card on file was declined for the membership. Will pay at the desk next visit.', 'Rechazaron la tarjeta para la membresía. Va a pagar en recepción en su próxima visita.')]]) }),
      p('bc9', 'Kevin Tran', '609-555-0719', { lang: 'zh' }),
      p('bc10', 'Andrés Molina', '609-555-0720', { lang: 'es', tags: [tx('own book', 'cartera propia')], birthday: '1992-' + day(3).slice(5) }),
      p('bc11', 'Isaiah Coleman', '609-555-0721'),
      p('bc12', 'Brandon Wells', '609-555-0722', { clientType: 'member', tags: [tx('member', 'miembro')] }),
      p('bc13', 'Mateo Rivera (age 8)', '609-555-0723', { clientType: 'kid', lang: 'es', contacts: [{ id: 'bc13-k1', name: 'Lucía Rivera', title: tx('Mother', 'Mamá'), phone: '609-555-0723', email: 'lucia.r@example.com' }] }),
      p('bc14', 'Noah Bennett (age 6)', '609-555-0724', { clientType: 'kid', contacts: [{ id: 'bc14-k1', name: 'Amanda Bennett', title: tx('Mother', 'Mamá'), phone: '609-555-0724', email: 'amanda.b@example.com' }] }),
      p('bc15', 'Walter Simmons', '609-555-0725', { clientType: 'senior', smsOptIn: false, notes: notes('bc15', 'u1', [[-50, 'call', tx('Prefers a phone call to texts. Tuesday mornings.', 'Prefiere llamada en lugar de mensajes. Martes en la mañana.')]]) }),
      p('bc16', 'Tyler Morgan', '609-555-0726'),
      p('bc17', 'Jason Reed', '609-555-0727', { tags: [tx('deposit required', 'pedir depósito')] }),
      p('bc18', 'Omar Haddad', '609-555-0728'),
      p('bc19', 'Liam Foster', '609-555-0729'),
      p('bc20', 'Derek Lim', '609-555-0730', { tags: ['walk-in'] }),
      p('bc21', 'Marcus Webb', '609-555-0731', { tags: ['walk-in'] }),
      p('bc22', 'Gregory Hall', '609-555-0732', { clientType: 'senior' }),
      p('bc23', 'Xavier Grant', '609-555-0733'),
      p('bc24', 'Nathan Cole', '609-555-0734', { company: 'Sample Harbor Realty', clientType: 'business', tags: [tx('business account', 'cuenta de empresa')],
        notes: notes('bc24', 'u1', [[-40, 'note', tx('Brings the office team in before their photo day each season.', 'Trae al equipo de su oficina antes del día de fotos de cada temporada.')]]) }),
    ],
  };
}
