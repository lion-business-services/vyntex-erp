// Barbershop edition: a shop that serves clients in chairs, by appointment and from a walk-in line. It is built on the
// appointment-centred family (no field crews) and adds the screens a shop runs on: the live shop floor (chairs, the
// walk-in queue, the self check-in kiosk and the waiting-area display), memberships, packages and gift cards, and
// barber pay (commission splits, tips and chair rent, paid weekly).
// Everything that makes it different is in this file and its rules and sample business. The app core never checks the
// edition id.
import type { IndustryPack } from '../types';
import { barberRules } from './rules';
import type { L10n, OfficeRole, StageDef } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import { ALL_PERMISSIONS } from '../blueprint';

/** Product name of the edition. Not in the pricing file: quoted on request until the owner approves prices. */
export const BARBER_PRODUCT = 'VYNTEX BARBER';

const l = (en: string, es: string, zh?: string): L10n => (zh ? { en, es, zh } : { en, es });

/**
 * The pipeline of a shop: group and event bookings (weddings, proms, team photos, a film set) and business accounts.
 * Stage ids are the professional-services ones on purpose: the database knows this family's stages by id.
 */
const STAGES: StageDef[] = [
  { id: 'new', label: l('New inquiry', 'Consulta nueva'), kind: 'open', role: 'new' },
  { id: 'contacted', label: l('Contacted', 'Contactado'), kind: 'open', role: 'contacted' },
  { id: 'appointment', label: l('Consult booked', 'Consulta agendada'), kind: 'open', role: 'visit', hot: true },
  { id: 'proposal', label: l('Quote sent', 'Cotización enviada'), kind: 'open', role: 'proposal', hot: true },
  { id: 'negotiating', label: l('Deciding', 'Decidiendo'), kind: 'open', role: 'negotiation', hot: true },
  { id: 'won', label: l('Booked', 'Reservado'), kind: 'won' },
  { id: 'lost', label: l('Lost', 'Perdido'), kind: 'lost' },
];

/** What anyone on the team may look at. "View only" is exactly this list. */
const VIEW: Permission[] = ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'appointments', 'catalog', 'opportunities', 'reviews', 'comms', 'esign', 'assistant'];
/**
 * Owner: everything. Shop manager: runs the floor and the money, pays the barbers, changes the automations.
 * Barber: works the chair and the front desk (walk-ins, bookings, checkout and payments, the drawer), never sees anyone's pay.
 * View only: looks, changes nothing.
 */
const ROLES: Record<OfficeRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: [...VIEW, 'money', 'cash', 'payroll', 'reports', 'automations', 'social', 'delete', 'export', 'import', 'assignLeads', 'allClients', 'credits', 'write'],
  staff: [...VIEW, 'money', 'cash', 'credits', 'write'],
  readonly: VIEW,
};
export const BARBER_ROLES = ROLES;

export const barberPack: IndustryPack = {
  id: 'barber',
  product: BARBER_PRODUCT,
  label: l('Barbershop', 'Barbería', '理发店'),
  blurb: l('For barbershops and grooming lounges: chairs, walk-ins, bookings, memberships and barber pay.', 'Para barberías y salones de caballero: sillas, clientes sin cita, citas, membresías y pago a barberos.'),
  ticketPrefix: 'VBR-',
  recurring: false,
  // fictional shop; the sample business is in ./seed.ts
  sampleCompany: { name: 'Northline Barber Studio', initials: 'NB', license: 'Sample shop for demonstration', phone: '609-555-0700', email: 'northline@example.com' },
  serviceTypes: [
    { id: 'haircut', en: 'Haircuts', es: 'Cortes', zh: '理发' },
    { id: 'beard', en: 'Beard and shave', es: 'Barba y afeitado', zh: '胡须与剃须' },
    { id: 'kids', en: 'Kids and seniors', es: 'Niños y mayores', zh: '儿童与长者' },
    { id: 'grooming', en: 'Grooming extras', es: 'Arreglos extra', zh: '护理' },
    { id: 'group', en: 'Group and event booking', es: 'Reserva de grupo o evento', zh: '团体与活动' },
    { id: 'products', en: 'Products', es: 'Productos', zh: '产品' },
    { id: 'other', en: 'Other', es: 'Otro', zh: '其他' },
  ],
  terms: {
    en: {
      owner: 'Owner', industry: 'Industry',
      projects: 'Group bookings', project: 'Group booking', newProject: 'New group booking', back: 'All group bookings', deleteProject: 'Delete group booking',
      name: 'Booking name', noProjects: 'No group bookings match. Clear the filters or add a new one.',
      forProject: 'Group booking', convert: 'Make it a group booking', converted: 'Group booking created', search: 'Search client or booking',
      subs: 'Team', sub: 'Team member', workersPlural: 'Team members', newSub: 'New team member', subName: 'Full name', allSubs: 'Whole team', trade: 'Role',
      secAssign: 'Who is working it', addAssign: 'Assign a barber', secSubPay: 'Payments to the team', addSubPay: 'Pay a team member', paySub: 'Pay a team member',
      paidSubs: 'Paid to the team', oweSubs: 'Owed to the team', subLabor: 'Team cost', secLog: 'Notes',
      materials: 'Supplies and costs', secPurch: 'Supplies and costs', addPurch: 'Add a cost', desc: 'What it was for', vendor: 'Paid to',
      scope: 'What the booking covers', payTerms: 'Price and deposit', contract: 'Price', contractBtn: 'Booking agreement',
      activeProjects: 'Active group bookings', contractValue: 'Group bookings value', activeList: 'Active group bookings', contractTotal: 'Booking total',
      address: 'Where', jobSite: 'Booking', type: 'Service', allTypes: 'All services',
      start: 'Event date', end: 'Last day', ev_start: 'Group booking', ev_end: 'Group booking ends', ev_appt: 'Appointment', estAppt: 'Consult', apptDate: 'Consult date',
      repeat: 'Repeats', rp_once: 'One time', rp_weekly: 'Every week', rp_biweekly: 'Every 2 weeks', rp_monthly: 'Every month', rp_quarterly: 'Every quarter', rp_yearly: 'Every year',
      st_estimate: 'Quote', st_contract: 'Waiting on deposit', st_progress: 'Confirmed', pt_project: 'Per booking',
      thanks: 'Thank you for choosing {company}.', contractorSig: 'Shop', saveSig: 'Sign', consent: 'I agree to sign this document electronically and to receive it by email.',
      confirmReset: 'Throw away your edits and rebuild this document from the booking details?',
      notePh: 'What did they ask for? What should the next person know?', pinIt: 'Pin to the top', noNotes: 'No notes yet. Write down what the client asked for so the next person has it.',
      'leads.visitOn': 'Consult {date}', 'leads.schedule': 'Book a consult', 'leads.reschedule': 'Change the consult', 'leads.f.visitDate': 'Consult date', 'leads.f.visitTime': 'Consult time',
      'leads.lostPh': 'Price, date taken, went elsewhere…', 'notif.apptToday': 'Appointment today', 'act.visit.scheduled': 'Consult booked for {date}',
      'auto.visit-prep.name': 'Consult preparation', 'auto.visit-prep.when': 'A consult is booked with an inquiry', 'auto.visit-prep.then1': 'Put the consult on the calendar',
      'auto.visit-prep.then2': 'Create a task to prepare for the consult', 'auto.task.visitPrep': 'Prepare for the consult with {lead}',
      'auto.estimate-follow-up.name': 'Quote follow-up', 'auto.estimate-follow-up.when': 'A quote is sent', 'auto.task.estimateFollowUp': 'Follow up on the quote for {lead}',
      'auto.job-started.then2': 'Show the booking to the person responsible',
      'auto.recurring-visits.name': 'Repeating bookings', 'auto.recurring-visits.then1': 'Put every upcoming date on the calendar',
      'auto.visitsPlanned': '{n} upcoming dates on the calendar', 'auto.visitsPlanned.one': '1 upcoming date on the calendar',
      'doc.kind.estimate': 'Quote', 'doc.kind.contract': 'Booking agreement', 'docs.kinds.estimate': 'Quotes', 'docs.kinds.contract': 'Booking agreements',
      'messages.tpl.estimate': 'Quote follow-up', 'messages.tpl.estimate.subject': 'Your quote from {company}',
      'messages.tpl.estimate.body': 'Hello {name},\n\nI am following up on the quote we sent you for {jobName}. Do you have any questions, or is there anything you would like to change?\n\nWhen you are ready, reply to this email and we will hold the date with the deposit.\n\nThank you,\n{company}\n{phone}',
      'docs.p.est.intro': '{company} prepared this quote for the {client} named below.', 'docs.p.est.scope': 'Services included', 'docs.p.est.price': 'Quoted price',
      'docs.p.est.validH': 'About this quote', 'docs.p.est.valid': 'This quote lists the services and the price on its date. The date is held once the deposit is paid.',
      'docs.p.est.accept': 'To accept this quote, sign and date below.',
      'calendar.newVisit': 'Book this day', 'calendar.visit.title': 'Book an appointment', 'calendar.visit.saved': 'Appointment booked', 'calendar.ev_visit': 'Repeating booking',
      'dash.ev.visit': 'Repeating booking', 'dash.kpi.visitsThisWeek': 'Bookings, next 7 days', 'dash.hint.visits': 'Appointments and group bookings',
      'jobs.f.repeatHint': 'A repeating booking goes on the calendar by itself.', 'jobs.ov.nextVisits': 'Next dates',
      'reports.profit.note': 'Profit is the agreed price minus the costs recorded on each group booking. Quotes are left out. Chair visits are on the Shop floor and Barber pay screens.',
      'jobs.tab.log': 'Notes', 'settings.perm.team': 'Team', 'clients.moneyNote': 'Billed counts every group booking past the quote. The balance is what is still owed on bookings that started or finished.',
      'docs.emptyHint': 'Pick a group booking and its quote, agreement or invoice is written from the details you already entered.',
      'clients.noDocs': 'No documents yet. Quotes and invoices are created from each group booking.',
      // screens shared with the professional-services family say "firm"; a barbershop is a shop
      'payments.p.sub': 'What {clients} paid the shop and what they still owe. Payments are recorded at checkout or here by hand.',
      'payments.p.cr.reason.cancel_staff': 'The shop cancelled a paid appointment', 'payments.p.cr.emptyHint': 'A credit is created when the shop cancels an appointment that was already paid.',
      'payments.p.separate': 'These are the shop\'s own payments from its {clients}. What the company pays for the platform is a separate ledger and is not part of this screen.',
      'reports.p.ap.cancelled_staff': 'Cancelled by the shop', 'reports.p.cr.cancel_staff': 'The shop cancelled a paid appointment',
      'docs.nd.how.file': 'Upload the shop\'s form', 'docs.nd.formNote': 'No consent or authorization wording comes with the product. Upload the form your shop uses, or write it from your own approved template.',
      'docs.tpl.rule': 'No legal wording comes with the product. A starter is only a structure: headings, merge fields, signature lines and bracketed notes that say where your own wording goes. Replace every bracketed part with wording your shop has approved, then mark the template as approved. Until then, documents made from it say so and cannot be sent for signature.',
      'docs.consent.intro': 'The sentence each signer ticks before signing. It is recorded with the time on the completion certificate. No sentence comes with the product: write the one your shop has approved.',
      'tour.leads.body': 'Group and event inquiries move from stage to stage. Mark one as booked and the {client}, the {job} and its first tasks are created for you.',
      'tour.jobs.body': 'Weddings, team picture days and visits to a senior home: the price, the deposit, the payments and the paperwork sit together.',
      'tour.pay.body': 'What {clients} paid at the chair and on group bookings, in one place. Balances keep themselves up to date.',
      'reviews.mail.subject': 'How was your cut, {name}?', 'reviews.mail.short': '{company}: how was your cut? Tell us here: {link}',
      'reviews.mail.bodyNoJob': 'Hi {name},\n\nThanks for coming in to {company}. How was your cut? Tell us in a minute:\n\n{link}\n\nYour answer comes straight to us.\n\n{company}',
      'dash.p.glanceFirm': 'Today at a glance, whole shop', 'dash.p.scope.firm': 'Whole shop', 'dash.p.firm': 'The shop', 'dash.p.weekFirm': 'The shop\'s next 7 days',
    },
    es: {
      owner: 'Dueño', industry: 'Industria',
      projects: 'Reservas de grupo', project: 'Reserva de grupo', newProject: 'Nueva reserva de grupo', back: 'Todas las reservas de grupo', deleteProject: 'Borrar reserva de grupo',
      name: 'Nombre de la reserva', noProjects: 'Ninguna reserva de grupo coincide. Quite los filtros o agregue una.',
      forProject: 'Reserva de grupo', convert: 'Convertir en reserva de grupo', converted: 'Reserva de grupo creada', search: 'Buscar cliente o reserva',
      subs: 'Equipo', sub: 'Miembro del equipo', workersPlural: 'Miembros del equipo', newSub: 'Nuevo miembro del equipo', subName: 'Nombre completo', allSubs: 'Todo el equipo', trade: 'Función',
      secAssign: 'Quién la atiende', addAssign: 'Asignar un barbero', secSubPay: 'Pagos al equipo', addSubPay: 'Pagar a un miembro del equipo', paySub: 'Pagar a un miembro del equipo',
      paidSubs: 'Pagado al equipo', oweSubs: 'Por pagar al equipo', subLabor: 'Costo del equipo', secLog: 'Notas',
      materials: 'Insumos y costos', secPurch: 'Insumos y costos', addPurch: 'Agregar un costo', desc: 'Concepto', vendor: 'Pagado a',
      scope: 'Qué incluye la reserva', payTerms: 'Precio y depósito', contract: 'Precio', contractBtn: 'Acuerdo de reserva',
      activeProjects: 'Reservas de grupo activas', contractValue: 'Valor de reservas de grupo', activeList: 'Reservas de grupo activas', contractTotal: 'Total de la reserva',
      address: 'Dónde', jobSite: 'Reserva', type: 'Servicio', allTypes: 'Todos los servicios',
      start: 'Fecha del evento', end: 'Último día', ev_start: 'Reserva de grupo', ev_end: 'Termina la reserva', ev_appt: 'Cita', estAppt: 'Consulta', apptDate: 'Fecha de la consulta',
      repeat: 'Se repite', rp_once: 'Una vez', rp_weekly: 'Cada semana', rp_biweekly: 'Cada 2 semanas', rp_monthly: 'Cada mes', rp_quarterly: 'Cada trimestre', rp_yearly: 'Cada año',
      st_estimate: 'Cotización', st_contract: 'Esperando depósito', st_progress: 'Confirmada', pt_project: 'Por reserva',
      thanks: 'Gracias por elegir {company}.', contractorSig: 'La barbería', saveSig: 'Firmar', consent: 'Acepto firmar este documento de forma electrónica y recibirlo por correo.',
      confirmReset: '¿Descartar sus cambios y volver a armar este documento con los datos de la reserva?',
      notePh: '¿Qué pidió? ¿Qué debe saber la siguiente persona?', pinIt: 'Fijar arriba', noNotes: 'Aún no hay notas. Anote lo que pidió el cliente para que la siguiente persona lo tenga.',
      'leads.visitOn': 'Consulta {date}', 'leads.schedule': 'Agendar una consulta', 'leads.reschedule': 'Cambiar la consulta', 'leads.f.visitDate': 'Fecha de la consulta', 'leads.f.visitTime': 'Hora de la consulta',
      'leads.lostPh': 'Precio, fecha ocupada, se fue a otro lado…', 'notif.apptToday': 'Cita hoy', 'act.visit.scheduled': 'Consulta agendada para el {date}',
      'auto.visit-prep.name': 'Preparación de la consulta', 'auto.visit-prep.when': 'Se agenda una consulta con un prospecto', 'auto.visit-prep.then1': 'Poner la consulta en el calendario',
      'auto.visit-prep.then2': 'Crear una tarea para preparar la consulta', 'auto.task.visitPrep': 'Preparar la consulta con {lead}',
      'auto.estimate-follow-up.name': 'Seguimiento de la cotización', 'auto.estimate-follow-up.when': 'Se envía una cotización', 'auto.task.estimateFollowUp': 'Dar seguimiento a la cotización de {lead}',
      'auto.job-started.then2': 'Mostrar la reserva a la persona responsable',
      'auto.recurring-visits.name': 'Reservas recurrentes', 'auto.recurring-visits.then1': 'Poner cada fecha próxima en el calendario',
      'auto.visitsPlanned': '{n} fechas próximas en el calendario', 'auto.visitsPlanned.one': '1 fecha próxima en el calendario',
      'doc.kind.estimate': 'Cotización', 'doc.kind.contract': 'Acuerdo de reserva', 'docs.kinds.estimate': 'Cotizaciones', 'docs.kinds.contract': 'Acuerdos de reserva',
      'messages.tpl.estimate': 'Seguimiento de la cotización', 'messages.tpl.estimate.subject': 'Tu cotización de {company}',
      'messages.tpl.estimate.body': 'Hola, {name}:\n\nTe escribo para dar seguimiento a la cotización que te mandamos para {jobName}. ¿Tienes alguna pregunta o quieres cambiar algo?\n\nCuando estés listo, responde a este correo y apartamos la fecha con el depósito.\n\nGracias,\n{company}\n{phone}',
      'docs.p.est.intro': '{company} preparó esta cotización para el {client} nombrado abajo.', 'docs.p.est.scope': 'Servicios incluidos', 'docs.p.est.price': 'Precio cotizado',
      'docs.p.est.validH': 'Sobre esta cotización', 'docs.p.est.valid': 'Esta cotización indica los servicios y el precio en su fecha. La fecha se aparta cuando se paga el depósito.',
      'docs.p.est.accept': 'Para aceptar esta cotización, firma y pon la fecha abajo.',
      'calendar.newVisit': 'Agendar este día', 'calendar.visit.title': 'Agendar una cita', 'calendar.visit.saved': 'Cita agendada', 'calendar.ev_visit': 'Reserva recurrente',
      'dash.ev.visit': 'Reserva recurrente', 'dash.kpi.visitsThisWeek': 'Reservas, próximos 7 días', 'dash.hint.visits': 'Citas y reservas de grupo',
      'jobs.f.repeatHint': 'Una reserva recurrente entra sola al calendario.', 'jobs.ov.nextVisits': 'Próximas fechas',
      'reports.profit.note': 'La ganancia es el precio acordado menos los costos registrados en cada reserva de grupo. No se cuentan las cotizaciones. Las visitas en silla están en Piso de la barbería y Pago a barberos.',
      'jobs.tab.log': 'Notas', 'settings.perm.team': 'Equipo', 'clients.moneyNote': 'Lo facturado cuenta cada reserva de grupo que ya pasó de cotización. El saldo es lo que aún se debe de reservas iniciadas o terminadas.',
      'docs.emptyHint': 'Elija una reserva de grupo y su cotización, acuerdo o factura se redacta con los datos que ya capturó.',
      'clients.noDocs': 'Aún no hay documentos. Las cotizaciones y facturas se crean desde cada reserva de grupo.',
      'payments.p.sub': 'Lo que pagaron los {clients} a la barbería y lo que todavía deben. Los pagos se registran al cobrar o aquí a mano.',
      'payments.p.cr.reason.cancel_staff': 'La barbería canceló una cita ya pagada', 'payments.p.cr.emptyHint': 'Un crédito se crea cuando la barbería cancela una cita que ya estaba pagada.',
      'payments.p.separate': 'Estos son los pagos que la barbería recibe de sus {clients}. Lo que la empresa paga por la plataforma es un registro aparte y no forma parte de esta pantalla.',
      'reports.p.ap.cancelled_staff': 'Canceladas por la barbería', 'reports.p.cr.cancel_staff': 'La barbería canceló una cita ya pagada',
      'docs.nd.how.file': 'Subir el formulario de la barbería', 'docs.nd.formNote': 'El producto no trae texto de consentimiento ni de autorización. Suba el formulario que usa su barbería o redáctelo con su propia plantilla aprobada.',
      'docs.tpl.rule': 'El producto no trae texto legal. Una estructura inicial es solo eso: encabezados, campos de datos, líneas de firma y notas entre corchetes que indican dónde va su propio texto. Reemplace cada parte entre corchetes con el texto que su barbería aprobó y después marque la plantilla como aprobada. Hasta entonces, los documentos hechos con ella lo indican y no se pueden enviar para firma.',
      'docs.consent.intro': 'La frase que cada firmante marca antes de firmar. Queda registrada con la hora en el certificado de finalización. El producto no trae ninguna frase: escriba la que su barbería aprobó.',
      'tour.leads.body': 'Las consultas de grupos y eventos avanzan de etapa en etapa. Marque una como reservada y se crean el {client}, la {job} y sus primeras tareas.',
      'tour.jobs.body': 'Bodas, días de fotos de equipo y visitas a una residencia de adultos mayores: el precio, el depósito, los pagos y los papeles están juntos.',
      'tour.pay.body': 'Lo que pagaron los {clients} en la silla y en las reservas de grupo, en un solo lugar. Los saldos se mantienen al día solos.',
      'reviews.mail.subject': '¿Qué tal tu corte, {name}?', 'reviews.mail.short': '{company}: ¿qué tal tu corte? Cuéntanos aquí: {link}',
      'reviews.mail.bodyNoJob': 'Hola, {name}:\n\nGracias por venir a {company}. ¿Qué tal tu corte? Cuéntanos en un minuto:\n\n{link}\n\nTu respuesta nos llega directo.\n\n{company}',
      'dash.p.glanceFirm': 'El día de un vistazo, toda la barbería', 'dash.p.scope.firm': 'Toda la barbería', 'dash.p.firm': 'La barbería', 'dash.p.weekFirm': 'Los próximos 7 días de la barbería',
    },
  },
  jobStatuses: ['estimate', 'contract', 'progress', 'hold', 'done'],
  kpis: ['newLeads', 'pipelineValue', 'overdueTasks', 'activeJobs', 'clientsOwe', 'collectedMonth'],
  // Structure only: the shop adds its own approved wording before sending one.
  agreement: {
    en: {
      title: 'Group booking agreement',
      intro: 'Between {company} and the client named below. [Opening paragraph: the shop adds its approved wording here.]',
      s1: '1. Services', s2: '2. Price and deposit', total: 'Total for this booking',
      s3: '3. Date and time', sched: 'Event date: {start}. [The shop adds its approved wording about timing here.]',
      s4: '4. Arrival and late changes', chg: '[The shop adds its approved wording here.]',
      s5: '5. What the shop provides', ins: '[The shop adds its approved wording here.]',
      s6: '6. Cancelling', cxl: '[The shop adds its approved wording here.]',
      s7: '7. Signatures', esig: '[The shop adds its approved wording about signing electronically here.]',
      draft: 'Structure only. The approved wording has not been added yet. Do not send this to a client until the shop has reviewed and replaced every bracketed part.',
    },
    es: {
      title: 'Acuerdo de reserva de grupo',
      intro: 'Entre {company} y el cliente nombrado abajo. [Párrafo inicial: la barbería agrega aquí su texto aprobado.]',
      s1: '1. Servicios', s2: '2. Precio y depósito', total: 'Total de esta reserva',
      s3: '3. Fecha y hora', sched: 'Fecha del evento: {start}. [La barbería agrega aquí su texto aprobado sobre los horarios.]',
      s4: '4. Llegada y cambios de último momento', chg: '[La barbería agrega aquí su texto aprobado.]',
      s5: '5. Lo que pone la barbería', ins: '[La barbería agrega aquí su texto aprobado.]',
      s6: '6. Cancelación', cxl: '[La barbería agrega aquí su texto aprobado.]',
      s7: '7. Firmas', esig: '[La barbería agrega aquí su texto aprobado sobre la firma electrónica.]',
      draft: 'Solo estructura. Todavía no se agrega el texto aprobado. No lo envíe a un cliente hasta que la barbería haya revisado y reemplazado cada parte entre corchetes.',
    },
  },
  kickoffTasks: [
    { en: 'Collect the deposit to hold the date', es: 'Cobrar el depósito para apartar la fecha', dueIn: 0, for: 'owner', pri: 'high' },
    { en: 'Block the chairs and barbers on the calendar', es: 'Bloquear las sillas y los barberos en el calendario', dueIn: 1, for: 'owner', pri: 'high' },
    { en: 'Confirm the headcount and the services for each person', es: 'Confirmar cuántas personas y el servicio de cada una', dueIn: 3, for: 'owner' },
  ],
  closeoutTasks: [
    { en: 'Collect the balance', es: 'Cobrar el saldo', dueIn: 0, for: 'owner', pri: 'high' },
    { en: 'Ask the organizer for a review', es: 'Pedir una reseña al organizador', dueIn: 2, for: 'owner', pri: 'low' },
    { en: 'Invite the group to book their next cut', es: 'Invitar al grupo a agendar su próximo corte', dueIn: 5, for: 'owner', pri: 'low' },
  ],
  compliance: false,

  family: 'practice',
  // not in the pricing file: no plan and no price are shown for this edition, it is quoted on request
  priced: false,
  modules: [
    'floor', 'appointments', 'calendar', 'clients', 'tasks', 'leads', 'jobs',
    'memberships', 'commissions', 'catalog', 'payments', 'cash', 'reviews', 'messages', 'social', 'opportunities', 'team', 'documents', 'reports',
    'automations', 'integrations', 'assistant', 'settings', 'security', 'audit',
  ],
  leadStages: STAGES,
  leadSources: [
    { id: 'website', label: l('Website', 'Sitio web') }, { id: 'phone', label: l('Phone call', 'Llamada') }, { id: 'walk_in', label: l('Walk-in', 'Llegó a la barbería') },
    { id: 'referral', label: l('Referral', 'Referido') }, { id: 'google', label: l('Google', 'Google') }, { id: 'facebook', label: l('Facebook', 'Facebook') },
    { id: 'instagram', label: l('Instagram', 'Instagram') }, { id: 'whatsapp', label: l('WhatsApp', 'WhatsApp') }, { id: 'existing_client', label: l('Existing client', 'Cliente actual') },
    { id: 'other', label: l('Other', 'Otro') },
  ],
  lostReasons: [
    { id: 'price', label: l('Price', 'Precio') }, { id: 'competitor', label: l('Went to another shop', 'Se fue a otra barbería') },
    { id: 'date_taken', label: l('Date already full', 'La fecha ya estaba llena') }, { id: 'no_response', label: l('No response', 'Sin respuesta') },
    { id: 'not_a_fit', label: l('Not a fit', 'No era para nosotros') }, { id: 'other', label: l('Other', 'Otro') },
  ],
  taskTypes: [
    { id: 'todo', label: l('To do', 'Por hacer') }, { id: 'client_request', label: l('Client request', 'Solicitud del cliente') }, { id: 'call', label: l('Call', 'Llamada') },
    { id: 'restock', label: l('Restock', 'Reabastecer') }, { id: 'cleaning', label: l('Cleaning and tools', 'Limpieza y herramientas') },
  ],
  clientTypes: [
    { id: 'regular', label: l('Regular', 'Cliente frecuente') }, { id: 'member', label: l('Member', 'Miembro') }, { id: 'kid', label: l('Kid', 'Niño') },
    { id: 'senior', label: l('Senior', 'Adulto mayor') }, { id: 'business', label: l('Business account', 'Cuenta de empresa') },
  ],
  roleLabels: {
    owner: l('Owner', 'Dueño', '店主'), manager: l('Shop manager', 'Encargado', '店长'), staff: l('Barber', 'Barbero', '理发师'), readonly: l('View only', 'Solo lectura', '只读'),
  },
  rolePermissions: ROLES,
  docKinds: ['estimate', 'contract', 'invoice', 'service_agreement', 'upload', 'custom'],
  // starter set for a new shop: the length of each service. Prices are the shop's decision, so they start at zero.
  appointmentTypes: [
    { name: l('Haircut', 'Corte de cabello'), minutes: 30, fee: 0, prepay: false, mode: 'office', buffer: 5, active: true },
    { name: l('Skin fade', 'Desvanecido a piel'), minutes: 45, fee: 0, prepay: false, mode: 'office', buffer: 5, active: true },
    { name: l('Beard trim and line-up', 'Arreglo de barba y perfilado'), minutes: 20, fee: 0, prepay: false, mode: 'office', active: true },
    { name: l('Haircut and beard', 'Corte y barba'), minutes: 60, fee: 0, prepay: false, mode: 'office', buffer: 5, active: true },
    { name: l('Hot towel shave', 'Afeitado con toalla caliente'), minutes: 40, fee: 0, prepay: false, mode: 'office', buffer: 5, active: true },
    { name: l('Kids cut', 'Corte de niño'), minutes: 30, fee: 0, prepay: false, mode: 'office', active: true },
    { name: l('Group or event consult', 'Consulta para grupo o evento'), minutes: 20, fee: 0, prepay: false, mode: 'phone', active: true },
  ],
  rules: barberRules.map((r) => ({ ...r, when: { ...r.when } })),
  usesWorkers: false,
  // "reserva de grupo" is feminine: the shared Spanish sentences agree with it
  grammar: { es: { job: 'f' } },
};
