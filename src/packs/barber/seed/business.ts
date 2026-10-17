// The rest of the sample shop: group and event inquiries in every stage, the group bookings they became, tasks, a few
// conversations, review requests, the cash drawer, social posts, the paperwork of the group bookings, cross-sell rules
// and a few lines of the audit trail. Everything is made up; nothing here was sent, posted or signed anywhere.
import type { AuditEntry, CashEntry, Client, CrossSellRule, DocRecord, Job, Lang, Lead, Message, MessageChannel, Ref, ReviewRequest, SocialPost, Task, Appointment, WalkIn } from '@/domain/types';
import type { Opp } from '@/domain/actions/opportunities';
import { at as atDay } from '@/lib/dates';
import { day, notes, stamp, txFor } from '../../practice/seed/util';
import { SHOP_ADDRESS } from './people';

export function business(lang: Lang, x: { clients: Client[]; appointments: Appointment[]; walkins: WalkIn[] }) {
  const tx = txFor(lang);

  /* ---------- inquiries: groups, events, business accounts ---------- */
  let n = 2000;
  const lead = (o: Omit<Lead, 'ticket' | 'notes' | 'pri' | 'address' | 'email' | 'value'> & Partial<Pick<Lead, 'notes' | 'pri' | 'address' | 'email' | 'value'>>): Lead =>
    ({ ticket: `VBR-${++n}`, notes: [], pri: 'medium', address: '', email: '', value: null, officeId: 'o1', ...o });
  const leads: Lead[] = [
    lead({ id: 'bl1', name: 'Danielle Moore', phone: '609-555-0751', email: 'danielle.m@example.com', type: 'group', serviceIds: ['sv-group'], source: 'website', status: 'new', ownerId: 'u2', kind: 'individual', created: day(0), pri: 'high', value: 315,
      nextAction: { text: tx('Call back about the wedding party (7 groomsmen)', 'Devolver la llamada por la boda (7 padrinos)'), due: day(0) },
      notes: notes('bl1', 'u2', [[0, 'note', tx('Website form: wedding in five weeks, 7 people, morning of the wedding.', 'Formulario del sitio: boda en cinco semanas, 7 personas, la mañana de la boda.')]]) }),
    lead({ id: 'bl2', name: 'Coach Ramírez', company: 'Sample Shore High School', phone: '609-555-0752', email: 'coach.r@example.com', type: 'group', serviceIds: ['sv-group'], source: 'instagram', status: 'contacted', ownerId: 'u3', kind: 'business', lang: 'es', created: day(-3), value: 540,
      lastContact: stamp(-2, 15), followUp: day(1), nextAction: { text: tx('Send two Saturday options for team photo day', 'Mandar dos opciones de sábado para el día de fotos del equipo'), due: day(1) } }),
    lead({ id: 'bl3', name: 'Priya Shah', company: 'Sample Frame Productions', phone: '609-555-0753', email: 'priya@example.com', type: 'group', serviceIds: ['sv-group', 'sv-shave'], source: 'referral', sourceDetail: 'Nathan Cole', status: 'appointment', ownerId: 'u1', kind: 'business', created: day(-6), value: 900, pri: 'high',
      apptDate: day(2), apptTime: '10:00', lastContact: stamp(-1, 11), nextAction: { text: tx('Consult call: period looks for a film shoot, 12 actors', 'Llamada de consulta: looks de época para una filmación, 12 actores'), due: day(2) } }),
    lead({ id: 'bl4', name: 'Nathan Cole', company: 'Sample Harbor Realty', phone: '609-555-0734', email: 'nathan.bc24@example.com', type: 'group', serviceIds: ['sv-cut'], source: 'existing_client', status: 'proposal', ownerId: 'u1', kind: 'business', created: day(-9), value: 420, clientId: 'bc24',
      lastContact: stamp(-4, 16), followUp: day(2), nextAction: { text: tx('Ask if the quote for the office photo day works', 'Preguntar si la cotización para el día de fotos de la oficina le funciona'), due: day(2) } }),
    lead({ id: 'bl5', name: 'Felix Romero', phone: '609-555-0755', type: 'group', serviceIds: ['sv-combo'], source: 'whatsapp', status: 'negotiating', ownerId: 'u2', kind: 'individual', lang: 'es', created: day(-11), value: 330, smsOptIn: true,
      lastContact: stamp(-1, 19), followUp: day(0), nextAction: { text: tx('He asked for a lower price for 6 people after hours', 'Pidió precio más bajo para 6 personas fuera de horario'), due: day(0) },
      notes: notes('bl5', 'u2', [[-1, 'text', tx('Bachelor party. Wants the shop to themselves on a Friday night.', 'Despedida de soltero. Quiere la barbería solo para ellos un viernes en la noche.')]]) }),
    lead({ id: 'bl6', name: 'Grace Whitman', phone: '609-555-0756', email: 'grace.w@example.com', type: 'group', serviceIds: ['sv-group'], source: 'google', status: 'won', ownerId: 'u2', kind: 'individual', created: day(-25), value: 360, clientId: 'bc25', jobId: 'bj1' }),
    lead({ id: 'bl7', name: 'Coach Daniels', company: 'Sample Bay Youth Football', phone: '609-555-0757', email: 'coach.d@example.com', type: 'group', serviceIds: ['sv-kids'], source: 'referral', status: 'won', ownerId: 'u3', kind: 'business', created: day(-40), value: 500, clientId: 'bc26', jobId: 'bj2' }),
    lead({ id: 'bl8', name: 'Owen Price', phone: '609-555-0758', type: 'group', serviceIds: ['sv-group'], source: 'facebook', status: 'lost', ownerId: 'u3', kind: 'individual', created: day(-30), value: 270, lostReason: 'date_taken', lostAt: day(-26), lastContact: stamp(-27, 12) }),
    lead({ id: 'bl9', name: 'Hannah Lee', company: 'Sample Pines Senior Living', phone: '609-555-0759', email: 'hannah@example.com', type: 'group', serviceIds: ['sv-senior'], source: 'phone', status: 'won', ownerId: 'u1', kind: 'business', created: day(-80), value: 250, clientId: 'bc27', jobId: 'bj3' }),
  ];
  const extraClients: Client[] = [
    { id: 'bc25', name: 'Grace Whitman', phone: '609-555-0756', email: 'grace.w@example.com', addresses: [], since: day(-24), notes: [], kind: 'individual', clientType: 'regular', lifecycle: 'active', assignedTo: 'u2', lang: 'en', smsOptIn: true },
    { id: 'bc26', name: 'Coach Daniels', company: 'Sample Bay Youth Football', phone: '609-555-0757', email: 'coach.d@example.com', addresses: [], since: day(-38), notes: [], kind: 'business', clientType: 'business', lifecycle: 'active', assignedTo: 'u3', lang: 'en' },
    { id: 'bc27', name: 'Hannah Lee', company: 'Sample Pines Senior Living', phone: '609-555-0759', email: 'hannah@example.com', addresses: ['12 Sample Pines Way, Linwood, NJ'], since: day(-78), notes: [], kind: 'business', clientType: 'business', lifecycle: 'active', assignedTo: 'u1', lang: 'en' },
  ];

  /* ---------- group bookings ---------- */
  let jn = 3000;
  const job = (o: Pick<Job, 'id' | 'name' | 'clientId' | 'type' | 'status' | 'price' | 'managerId'> & Partial<Job>): Job =>
    ({ number: `VBR-G-${++jn}`, address: SHOP_ADDRESS, start: '', end: '', repeat: 'once', scope: '', payTerms: '', assign: [], expenses: [], received: [], log: [], notes: [], created: day(-20), officeId: 'o1', ...o });
  const jobs: Job[] = [
    job({ id: 'bj1', name: tx('Whitman wedding party (8 people)', 'Boda Whitman (8 personas)'), clientId: 'bc25', type: 'group', status: 'contract', price: 360, managerId: 'u2', serviceId: 'sv-group', tierId: 'sv-group-t1', leadId: 'bl6',
      start: day(19), end: day(19), created: day(-22),
      scope: tx('Haircuts and beard line-ups for the groom and 7 groomsmen, the morning of the wedding. Two chairs from 8 to 11.', 'Cortes y perfilado de barba para el novio y 7 padrinos, la mañana de la boda. Dos sillas de 8 a 11.'),
      payTerms: tx('$360. Deposit of $100 holds the date; balance on the day.', '$360. Un depósito de $100 aparta la fecha; el saldo el mismo día.'),
      received: [{ id: 'bj1-r1', date: day(-20), method: 'card', ref: 'SAMPLE-DEP-01', amount: 100 }] }),
    job({ id: 'bj2', name: tx('Youth football picture day', 'Día de fotos de futbol juvenil'), clientId: 'bc26', type: 'kids', status: 'done', price: 500, managerId: 'u3', serviceId: 'sv-kids', tierId: 'sv-kids-t1', leadId: 'bl7',
      start: day(-9), end: day(-9), created: day(-38),
      scope: tx('20 kids cuts before the team photo, three chairs, Saturday morning.', '20 cortes de niño antes de la foto del equipo, tres sillas, sábado en la mañana.'),
      payTerms: tx('$25 per player, paid by the league.', '$25 por jugador, lo paga la liga.'),
      received: [{ id: 'bj2-r1', date: day(-30), method: 'check', ref: '1052', amount: 150 }, { id: 'bj2-r2', date: day(-9), method: 'check', ref: '1077', amount: 350 }] }),
    job({ id: 'bj3', name: tx('Monthly visit: Sample Pines Senior Living', 'Visita mensual: Sample Pines Senior Living'), clientId: 'bc27', type: 'kids', status: 'progress', price: 250, managerId: 'u1', serviceId: 'sv-senior', tierId: 'sv-senior-t1', leadId: 'bl9',
      start: day(-75), repeat: 'monthly', created: day(-78), address: '12 Sample Pines Way, Linwood, NJ',
      scope: tx('One barber on site the first Tuesday of each month, up to 10 residents.', 'Un barbero en el lugar el primer martes de cada mes, hasta 10 residentes.'),
      payTerms: tx('$250 per visit, invoiced monthly.', '$250 por visita, se factura cada mes.'),
      received: [{ id: 'bj3-r1', date: day(-45), method: 'transfer', ref: '', amount: 250 }] }),
    job({ id: 'bj4', name: tx('Office photo day, Sample Harbor Realty', 'Día de fotos de oficina, Sample Harbor Realty'), clientId: 'bc24', type: 'group', status: 'estimate', price: 420, managerId: 'u1', serviceId: 'sv-cut', tierId: 'sv-cut-t1',
      created: day(-6), scope: tx('12 haircuts in the shop the morning before their photo shoot.', '12 cortes en la barbería la mañana antes de su sesión de fotos.'), payTerms: tx('$35 per person.', '$35 por persona.') }),
  ];
  const lead4 = leads.find((l) => l.id === 'bl4')!; lead4.jobId = undefined;

  /* ---------- tasks ---------- */
  let tn = 0;
  const task = (o: Pick<Task, 'title' | 'assignee'> & Partial<Task>): Task => ({ id: `bt${++tn}`, status: 'todo', pri: 'medium', type: 'todo', created: day(-3), ...o });
  const tasks: Task[] = [
    task({ title: tx('Order clipper blades and neck strips', 'Pedir navajas para máquina y tiras de cuello'), assignee: 'u:u2', type: 'restock', due: day(1), pri: 'high' }),
    task({ title: tx('Deep clean and oil all clippers', 'Limpieza profunda y aceite a todas las máquinas'), assignee: 'u:u5', type: 'cleaning', due: day(0), status: 'doing' }),
    task({ title: tx('Confirm the wedding headcount with Grace', 'Confirmar con Grace cuántas personas van a la boda'), assignee: 'u:u2', jobId: 'bj1', clientId: 'bc25', type: 'call', due: day(5) }),
    task({ title: tx('Send the invoice for this month\'s Sample Pines visit', 'Mandar la factura de la visita de este mes a Sample Pines'), assignee: 'u:u1', jobId: 'bj3', clientId: 'bc27', due: day(-2), pri: 'high' }),
    task({ title: tx('Restock the retail shelf (pomade and beard oil)', 'Reabastecer el anaquel de productos (pomada y aceite de barba)'), assignee: 'u:u6', type: 'restock', due: day(-1), status: 'waiting',
      comments: [{ id: 'bt5-c1', at: stamp(-1, 16, 10), by: 'u6', text: tx('Supplier says delivery on Friday.', 'El proveedor dice que entrega el viernes.') }] }),
    task({ title: tx('Call Samuel about his membership payment', 'Llamar a Samuel por el pago de su membresía'), assignee: 'u:u6', clientId: 'bc8', type: 'call', due: day(0), pri: 'high' }),
    task({ title: tx('Review the new barber\'s portfolio before the trial day', 'Revisar el portafolio del barbero nuevo antes del día de prueba'), assignee: 'u:u1', due: day(3), status: 'review' }),
    task({ title: tx('Update the price board for the new season', 'Actualizar el tablero de precios para la nueva temporada'), assignee: 'u:u2', due: day(-6), status: 'done', doneAt: day(-6) }),
    task({ title: tx('Client asked to switch to Keisha for fades', 'Cliente pidió cambiarse con Keisha para desvanecidos'), assignee: 'u:u2', clientId: 'bc16', type: 'client_request', requestedBy: 'Tyler Morgan', channel: 'text', due: day(2) }),
  ];

  /* ---------- conversations (texts mostly) ---------- */
  const client = (id: string): Ref => ({ type: 'client', id });
  const thread = (ref: Ref, channel: MessageChannel) => `${ref.type === 'client' ? 'c' : 'l'}:${ref.id}:${channel}`;
  const inc = (id: string, at: string, channel: MessageChannel, ref: Ref, from: string, body: string, read = true): Message =>
    ({ id, at, channel, to: '', from, subject: '', body, status: 'received', dir: 'in', read, ref, threadId: thread(ref, channel), ...(ref.type === 'client' ? { clientId: ref.id } : {}) });
  const out = (id: string, at: string, channel: MessageChannel, ref: Ref, to: string, body: string, by = 'u6'): Message =>
    ({ id, at, channel, to, subject: '', body, status: 'demo', ref, threadId: thread(ref, channel), by, ...(ref.type === 'client' ? { clientId: ref.id } : {}) });
  const messages: Message[] = [
    inc('bm1', stamp(0, 8, 20), 'text', client('bc16'), '609-555-0726', tx('Any openings with Keisha this week? Luis is great but she did my brother\'s fade.', '¿Hay lugar con Keisha esta semana? Luis es buenísimo pero ella le hizo el desvanecido a mi hermano.'), false),
    inc('bm2', stamp(-1, 18, 5), 'whatsapp', client('bc2'), '609-555-0712', tx('Can I move Saturday to Sunday morning?', '¿Puedo cambiar el sábado al domingo en la mañana?')),
    out('bm3', stamp(-1, 18, 30), 'whatsapp', client('bc2'), '609-555-0712', tx('Sunday 10:30 with Marco is open. Want it?', 'El domingo a las 10:30 con Marco está libre. ¿Lo quieres?')),
    inc('bm4', stamp(-1, 18, 41), 'whatsapp', client('bc2'), '609-555-0712', tx('Yes please, thank you!', '¡Sí por favor, gracias!')),
    inc('bm5', stamp(-2, 12, 0), 'text', { type: 'lead', id: 'bl5' }, '609-555-0755', tx('6 of us, Friday night, can you do $40 each?', 'Somos 6, viernes en la noche, ¿pueden dejarlo en $40 cada uno?')),
    out('bm6', stamp(-4, 10, 0), 'email', client('bc24'), 'nathan.bc24@example.com', tx('Hi Nathan, the quote for the office photo day is attached. 12 cuts, $420 total.', 'Hola, Nathan. Te mando la cotización del día de fotos de la oficina. 12 cortes, $420 en total.'), 'u1'),
    inc('bm7', stamp(-3, 9, 15), 'call', client('bc15'), '609-555-0725', tx('Called to book his usual Tuesday cut with Marco.', 'Llamó para agendar su corte de siempre del martes con Marco.')),
  ];
  messages[5].subject = tx('Your quote from Northline Barber Studio', 'Tu cotización de Northline Barber Studio');
  messages[6].seconds = 95;

  /* ---------- review requests: two answered, one waiting ---------- */
  type SampleReview = ReviewRequest & { token: string; expires: string; openedAt?: string; answeredAt?: string };
  const reviews: SampleReview[] = [
    { id: 'brv3', clientId: 'bc4', at: stamp(-2, 18), channel: 'text', status: 'sent', by: 'u3', token: 'sample-brv3', expires: day(28) },
    { id: 'brv2', clientId: 'bc6', at: stamp(-12, 17), channel: 'text', status: 'rated', by: 'u3', token: 'sample-brv2', expires: day(18), openedAt: stamp(-12, 20), answeredAt: stamp(-12, 20, 5), rating: 3,
      comment: tx('Sample answer: the wait on Saturday was longer than the time I was quoted.', 'Respuesta de muestra: el sábado esperé más de lo que me dijeron.') },
    { id: 'brv1', clientId: 'bc1', at: stamp(-20, 16), channel: 'text', status: 'rated', by: 'u2', token: 'sample-brv1', expires: day(10), openedAt: stamp(-20, 19), answeredAt: stamp(-20, 19, 4), rating: 5 },
  ];

  /* ---------- the cash drawer: the last week ---------- */
  let cn = 0;
  const cashLine = (off: number, dir: 'in' | 'out', amount: number, category: string, memo: string, by = 'u6'): CashEntry => ({ id: `bk${++cn}`, date: day(off), officeId: 'o1', dir, amount, category, memo, by });
  const cash: CashEntry[] = [cashLine(-7, 'in', 200, 'change_fund', tx('Starting float for the drawer (sample)', 'Fondo inicial de la caja (muestra)'), 'u1')];
  for (let off = -6; off <= 0; off++) {
    const date = day(off);
    const walkCash = x.walkins.filter((w) => w.status === 'done' && w.method === 'cash' && (w.doneAt ?? '').slice(0, 10) === date).reduce((s, w) => s + (w.amount ?? 0) + (w.tip ?? 0), 0);
    const apptCash = x.appointments.filter((a) => a.date === date && a.paid?.method === 'cash').reduce((s, a) => s + (a.paid?.amount ?? 0) + (a.tip ?? 0), 0);
    if (walkCash) cash.push(cashLine(off, 'in', Math.round(walkCash * 100) / 100, 'client_payment', tx('Walk-ins paid in cash', 'Clientes sin cita pagados en efectivo')));
    if (apptCash) cash.push(cashLine(off, 'in', Math.round(apptCash * 100) / 100, 'client_payment', tx('Appointments paid in cash', 'Citas pagadas en efectivo')));
    if (off === -5) cash.push(cashLine(off, 'out', 42.6, 'supplies', tx('Neck strips and disinfectant', 'Tiras de cuello y desinfectante'), 'u2'));
    if (off === -3) cash.push(cashLine(off, 'out', 300, 'bank_deposit', tx('Taken to the bank', 'Llevado al banco'), 'u1'));
    if (off === -1) cash.push(cashLine(off, 'out', 15.5, 'supplies', tx('Coffee and water for the waiting area', 'Café y agua para la sala de espera')));
  }

  /* ---------- social posts ---------- */
  const posts: SocialPost[] = [
    { id: 'bs1', status: 'draft', by: 'u2', created: stamp(-1, 15, 20), channels: ['instagram', 'facebook'], text: tx('Fresh fades all weekend. Walk-ins welcome, or book online.', 'Desvanecidos frescos todo el fin de semana. Ven sin cita o agenda en línea.') },
    { id: 'bs2', status: 'scheduled', by: 'u2', approvedBy: 'u1', created: stamp(-2, 11, 0), scheduledFor: atDay(3, 10, 0), channels: ['facebook', 'gbp'],
      text: tx('Kids cuts every Saturday morning. The 4-pack saves you money all season.', 'Cortes de niño todos los sábados en la mañana. El paquete de 4 te ahorra toda la temporada.') },
    { id: 'bs3', status: 'demo', by: 'u1', approvedBy: 'u1', created: stamp(-6, 9, 0), publishedAt: stamp(-5, 10, 0), channels: ['facebook', 'gbp'],
      text: tx('Join the Cut Club: two cuts a month and 10% off products. Ask at the front desk.', 'Únete al Club del Corte: dos cortes al mes y 10% de descuento en productos. Pregunta en recepción.') },
  ];

  /* ---------- paperwork of the group bookings ---------- */
  const docs: DocRecord[] = [];
  jobs.forEach((j, i) => {
    const num = 1001 + i;
    if (j.status === 'estimate') { docs.push({ id: `bd-${j.id}-e`, kind: 'estimate', number: `VBR-EST-${num}`, title: j.name, jobId: j.id, clientId: j.clientId, status: 'sent', created: j.created, updated: j.created }); return; }
    docs.push({ id: `bd-${j.id}-e`, kind: 'estimate', number: `VBR-EST-${num}`, title: j.name, jobId: j.id, clientId: j.clientId, status: 'signed', created: j.created, updated: j.created });
    if (j.status === 'progress' || j.status === 'done') {
      const paid = j.received.reduce((a, r) => a + r.amount, 0);
      docs.push({ id: `bd-${j.id}-i`, kind: 'invoice', number: `VBR-INV-${num}`, title: j.name, jobId: j.id, clientId: j.clientId, status: paid >= j.price ? 'paid' : 'sent', created: j.start || j.created, updated: j.received.at(-1)?.date ?? j.created });
    }
  });

  /* ---------- cross-sell ---------- */
  const crossSell: CrossSellRule[] = [
    { id: 'bcs-beard', name: tx('Haircut regulars: add the beard', 'Clientes de corte: agregar la barba'), whenServiceIds: ['sv-fade', 'sv-cut'], suggestServiceId: 'sv-combo', unlessServiceIds: ['sv-combo', 'sv-beard'], clientKind: 'individual', active: true,
      note: tx('Offer the haircut and beard combo at checkout; it is one appointment instead of two.', 'Ofrece el combo de corte y barba al cobrar; es una cita en lugar de dos.') },
    { id: 'bcs-shave', name: tx('Beard clients: try the hot towel shave', 'Clientes de barba: probar el afeitado con toalla caliente'), whenServiceIds: ['sv-beard'], suggestServiceId: 'sv-shave', unlessServiceIds: ['sv-shave'], active: true,
      note: tx('Good before a wedding or an interview.', 'Ideal antes de una boda o una entrevista.') },
  ];
  const opportunities: Opp[] = [
    { id: 'bop1', clientId: 'bc5', serviceId: 'sv-shave', ruleId: 'bcs-shave', status: 'open', created: day(-3), by: 'automation', value: 40, note: crossSell[1].note },
    { id: 'bop2', clientId: 'bc4', serviceId: 'sv-combo', ruleId: 'bcs-beard', status: 'contacted', created: day(-10), by: 'automation', value: 55, note: crossSell[0].note },
  ];

  /* ---------- audit trail ---------- */
  const audit: AuditEntry[] = [
    { id: 'bau5', at: stamp(0, 8, 40), by: 'u1', action: 'signin.completed', entity: 'user', entityId: 'u1' },
    { id: 'bau4', at: stamp(-1, 12, 10), by: 'u1', action: 'invite.created', entity: 'user', entityId: 'u7', summary: 'sam@example.com' },
    { id: 'bau3', at: stamp(-3, 17, 30), by: 'u2', action: 'export.clients', entity: 'export', summary: `clients-${day(-3)}.csv` },
    { id: 'bau2', at: stamp(-8, 11, 0), by: 'u1', action: 'member.role_changed', entity: 'user', entityId: 'u2', summary: 'staff > manager' },
    { id: 'bau1', at: stamp(-30, 9, 0), by: 'u1', action: 'signin.completed', entity: 'user', entityId: 'u1' },
  ];

  return { leads, extraClients, jobs, tasks, messages, reviews, cash, posts, docs, crossSell, opportunities, audit };
}
