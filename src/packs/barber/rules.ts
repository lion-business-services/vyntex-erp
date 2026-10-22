// The automations the barbershop edition ships with. Plain data: WHEN an event, IF conditions, THEN steps.
// A shop can switch each one off, change it, add its own next to them, and put a shipped one back the way it shipped.
//
// What is on from the start is only what is safe without anyone looking: tasks, notes to the team, and messages to a
// client PREPARED AS A DRAFT for a person to read and send. No rule here sends anything to a client by itself; once a
// texting or email app is connected, the shop chooses which drafts may go out on their own.
// Merge fields are filled from the records of the event: {{first_name}}, {{company}}, {{appointment.date}}, {{barber}}, ...
import type { L10n, MessageChannel, Priority, RuleCond, RuleDef, RuleEvent, RuleStep } from '@/domain/types';
import { CONNECTED_APPT_RULES, CONNECTED_RULES } from '../connected-rules';

const l = (en: string, es: string): L10n => ({ en, es });
/** Events the engine knows that the data model's list does not name yet (src/domain/rules/fields.ts). */
const ev = (e: string) => e as RuleEvent;

type Who = 'owner' | 'manager' | 'record_owner';
const task = (title: string, titleEs: string, who: Who, dueIn = 0, pri: Priority = 'medium', type?: string): RuleStep =>
  ({ do: 'task', params: { title, titleEs, for: who, dueIn, pri, ...(type ? { type } : {}) } });
/** A message to the client, prepared for a person to review. Never `send`. */
const draft = (subject: string, subjectEs: string, body: string, bodyEs: string, channel: MessageChannel = 'text'): RuleStep =>
  ({ do: 'message', params: { channel, mode: 'draft', subject, subjectEs, body, bodyEs } });
const notify = (who: Who, text: string, textEs: string): RuleStep => ({ do: 'notify', params: { who, text, textEs } });
const builtin = (id: string, event: RuleEvent, name: L10n): RuleDef => ({ id, name, active: true, when: { event }, if: [], then: [{ do: 'builtin', params: { rule: id } }], shipped: true });
const rule = (id: string, name: L10n, about: L10n, event: RuleEvent, then: RuleStep[], more: { if?: RuleCond[]; days?: number; off?: boolean } = {}): RuleDef =>
  ({ id, name, about, active: !more.off, when: { event, ...(more.days !== undefined ? { days: more.days } : {}) }, if: more.if ?? [], then, shipped: true });

const SIGN = '\n{{company}}';

export const barberRules: RuleDef[] = [
  // ---- the walk-in line
  rule('b-walkin-joined', l('Place in line', 'Lugar en la fila'),
    l('Prepares a text with the ticket number and the estimated wait when someone joins the walk-in line.', 'Prepara un mensaje con el número de turno y la espera estimada cuando alguien entra a la fila.'),
    ev('walkin.joined'), [draft('', '',
      'Hi {{first_name}}, you are #{{ticket}} in line at {{company}}. Estimated wait: about {{wait}} minutes. We will text you when your chair is ready.' + SIGN,
      'Hola, {{first_name}}. Eres el turno #{{ticket}} en {{company}}. Espera estimada: unos {{wait}} minutos. Te escribimos cuando tu silla esté lista.' + SIGN)]),
  rule('b-walkin-called', l('Your chair is ready', 'Tu silla está lista'),
    l('Prepares a text when someone in line is called to a chair.', 'Prepara un mensaje cuando alguien de la fila pasa a una silla.'),
    ev('walkin.called'), [draft('', '',
      'Hi {{first_name}}, it is your turn at {{company}}. {{barber}} is ready for you.' + SIGN,
      'Hola, {{first_name}}. Ya es tu turno en {{company}}. {{barber}} te está esperando.' + SIGN)]),
  rule('b-long-wait', l('Long wait alert', 'Aviso de espera larga'),
    l('Tells the shop manager when a new arrival is quoted more than 45 minutes, so another chair can open.', 'Avisa al encargado cuando a alguien que llega se le estiman más de 45 minutos, para abrir otra silla.'),
    ev('walkin.joined'), [notify('manager', 'The wait is about {{wait}} minutes (#{{ticket}}). Can another chair open?', 'La espera es de unos {{wait}} minutos (turno #{{ticket}}). ¿Se puede abrir otra silla?')],
    { if: [{ field: 'extra.wait', op: 'gt', value: 45 }] }),
  rule('b-walkin-review', l('Thank-you and review after a walk-in', 'Agradecimiento y reseña después de una visita sin cita'),
    l('Prepares a review request after a walk-in visit is finished.', 'Prepara una solicitud de reseña al terminar una visita sin cita.'),
    ev('walkin.done'), [{ do: 'review', params: { channel: 'text' } }]),

  // ---- appointments
  rule('b-appt-confirm', l('Booking confirmation', 'Confirmación de cita'),
    l('Prepares a confirmation when an appointment is booked or moved.', 'Prepara una confirmación cuando se agenda o se cambia una cita.'),
    'appointment.booked', [draft('Your appointment on {{appointment.date}}', 'Tu cita del {{appointment.date}}',
      'Hi {{first_name}}, you are booked at {{company}} on {{appointment.date}} at {{appointment.time}}. Reply here if you need to change it.' + SIGN,
      'Hola, {{first_name}}. Tu cita en {{company}} quedó para el {{appointment.date}} a las {{appointment.time}}. Responde aquí si necesitas cambiarla.' + SIGN)]),
  rule('b-appt-reminder', l('Appointment reminder', 'Recordatorio de cita'),
    l('Prepares a reminder the day before an appointment.', 'Prepara un recordatorio el día antes de la cita.'),
    ev('appointment.soon'), [draft('Reminder: tomorrow at {{appointment.time}}', 'Recordatorio: mañana a las {{appointment.time}}',
      'Hi {{first_name}}, see you tomorrow at {{appointment.time}} at {{company}}. If you cannot make it, please let us know so someone else can take the time.' + SIGN,
      'Hola, {{first_name}}. Te esperamos mañana a las {{appointment.time}} en {{company}}. Si no puedes venir, avísanos para que alguien más tome el horario.' + SIGN)], { days: 1 }),
  rule('b-appt-noshow', l('No-show follow-up', 'Seguimiento de inasistencia'),
    l('Prepares a friendly message to rebook when someone misses an appointment.', 'Prepara un mensaje amable para volver a agendar cuando alguien falta a su cita.'),
    'appointment.no_show', [draft('We missed you today', 'Te extrañamos hoy',
      'Hi {{first_name}}, we had you down for {{appointment.time}} today and did not see you. Want to pick a new time? Reply here.' + SIGN,
      'Hola, {{first_name}}. Te teníamos a las {{appointment.time}} hoy y no pudimos atenderte. ¿Quieres escoger otro horario? Responde aquí.' + SIGN)]),
  rule('b-appt-noshow-repeat', l('Repeated no-show: deposit next time', 'Inasistencia repetida: depósito la próxima vez'),
    l('Tells the shop manager when the same client misses a second appointment, and tags them so the next booking takes a deposit.', 'Avisa al encargado cuando el mismo cliente falta a una segunda cita y lo etiqueta para que la próxima reserva pida depósito.'),
    'appointment.no_show', [
      notify('manager', '{{name}} missed another appointment ({{noShows}} in total). Next booking: ask for a deposit.', '{{name}} volvió a faltar ({{noShows}} en total). Próxima reserva: pedir depósito.'),
      { do: 'tag', params: { tag: 'deposit required' } },
    ], { if: [{ field: 'extra.noShows', op: 'gt', value: 1 }] }),
  rule('b-appt-review', l('Review request after a visit', 'Solicitud de reseña después de la visita'),
    l('Prepares a review request when an appointment is completed.', 'Prepara una solicitud de reseña cuando se completa una cita.'),
    'appointment.completed', [{ do: 'review', params: { channel: 'text' } }]),
  rule('b-appt-cancelled', l('Cancelled appointment: offer the time', 'Cita cancelada: ofrecer el horario'),
    l('Creates a task to offer the freed time to someone on the waiting list or in line.', 'Crea una tarea para ofrecer el horario libre a alguien en la lista de espera o en la fila.'),
    'appointment.cancelled', [task('Offer the {{appointment.time}} slot on {{appointment.date}} to someone waiting', 'Ofrecer el horario de las {{appointment.time}} del {{appointment.date}} a alguien que espera', 'manager', 0, 'medium', 'call')]),

  // ---- keeping clients coming back
  rule('b-rebook', l('Due for a cut', 'Ya le toca su corte'),
    l('Prepares a rebooking text when a client is past their usual time between visits and has nothing booked.', 'Prepara un mensaje para volver a agendar cuando un cliente ya pasó su tiempo habitual entre visitas y no tiene cita.'),
    ev('client.due'), [draft('Time for a fresh cut?', '¿Ya toca corte?',
      'Hi {{first_name}}, it has been about {{gap}} days since your last cut with {{barber}}. Want us to save you a spot this week? Reply with a day and time.' + SIGN,
      'Hola, {{first_name}}. Ya van como {{gap}} días desde tu último corte con {{barber}}. ¿Te apartamos un lugar esta semana? Responde con el día y la hora.' + SIGN)], { days: 3 }),
  rule('b-lapsed', l('Lapsed client: personal call', 'Cliente que dejó de venir: llamada personal'),
    l('Creates a call task for the client\'s barber when a regular is a month past their usual visit.', 'Crea una tarea de llamada para el barbero del cliente cuando un cliente frecuente lleva un mes de retraso.'),
    ev('client.due'), [task('Call {{client.name}}: a month past their usual cut', 'Llamar a {{client.name}}: lleva un mes de retraso en su corte', 'manager', 0, 'low', 'call')], { days: 30 }),
  rule('b-birthday', l('Birthday reward', 'Regalo de cumpleaños'),
    l('Prepares a birthday text a week ahead with an invitation to come in.', 'Prepara un mensaje de cumpleaños una semana antes con una invitación a venir.'),
    'client.birthday', [draft('Happy birthday from {{company}}', 'Feliz cumpleaños de parte de {{company}}',
      'Happy birthday, {{first_name}}! Come in this week and the hot towel is on us.' + SIGN,
      '¡Feliz cumpleaños, {{first_name}}! Ven esta semana y la toalla caliente va por nuestra cuenta.' + SIGN)], { days: 7, off: true }),

  // ---- memberships, packages, gift cards
  rule('b-pass-low', l('Package or gift card running low', 'Paquete o tarjeta de regalo por terminarse'),
    l('Prepares a message when a package is down to its last visit or a gift card is almost used up.', 'Prepara un mensaje cuando a un paquete le queda la última visita o a una tarjeta de regalo casi no le queda saldo.'),
    ev('pass.low'), [draft('', '',
      'Hi {{first_name}}, heads up: your {{plan}} is almost used up. Ask at the front desk about renewing on your next visit.' + SIGN,
      'Hola, {{first_name}}. Te avisamos que tu {{plan}} ya casi se termina. Pregunta en recepción por renovarlo en tu próxima visita.' + SIGN)]),
  rule('b-membership-renews', l('Membership billing reminder', 'Recordatorio de cobro de membresía'),
    l('Prepares a reminder three days before a membership bills.', 'Prepara un recordatorio tres días antes del cobro de una membresía.'),
    ev('pass.renews'), [draft('Your {{plan}} renews soon', 'Tu {{plan}} se renueva pronto',
      'Hi {{first_name}}, your {{plan}} renews in {{days}} days for {{amount}}. Thanks for being a member!' + SIGN,
      'Hola, {{first_name}}. Tu {{plan}} se renueva en {{days}} días por {{amount}}. ¡Gracias por ser miembro!' + SIGN)], { days: 3, off: true }),
  rule('b-membership-past-due', l('Membership payment not recorded', 'Pago de membresía sin registrar'),
    l('Creates a task for the front desk on the day a membership bills, to take the payment.', 'Crea una tarea para recepción el día que se cobra una membresía, para registrar el pago.'),
    ev('pass.renews'), [task('Take the {{plan}} payment from {{client.name}} ({{amount}})', 'Cobrar la {{plan}} a {{client.name}} ({{amount}})', 'manager', 0, 'high')], { days: 0 }),

  // ---- the team and the business
  builtin('lead-intake', 'lead.created', l('New inquiry intake', 'Entrada de consultas')),
  builtin('visit-prep', 'lead.stage', l('Consult preparation', 'Preparación de la consulta')),
  builtin('estimate-follow-up', 'lead.stage', l('Quote follow-up', 'Seguimiento de la cotización')),
  builtin('lead-won', 'lead.won', l('Booked inquiry to group booking', 'De consulta reservada a reserva de grupo')),
  builtin('job-started', 'job.status', l('Group booking confirmed', 'Reserva de grupo confirmada')),
  builtin('job-completed', 'job.status', l('Group booking finished', 'Reserva de grupo terminada')),
  builtin('payment-posted', 'payment.received', l('Payment posted', 'Pago registrado')),
  rule('b-lead-idle', l('Unanswered inquiry', 'Consulta sin respuesta'),
    l('Creates a call task when nobody has answered an inquiry in two days.', 'Crea una tarea de llamada cuando nadie ha contestado una consulta en dos días.'),
    'lead.idle', [task('Call back {{lead.name}}: no answer for {{days}} days', 'Devolver la llamada a {{lead.name}}: {{days}} días sin respuesta', 'record_owner', 0, 'medium', 'call')], { days: 2 }),
  rule('b-task-overdue', l('Overdue task escalation', 'Escalamiento de tarea atrasada'),
    l('Tells the shop manager when a task is two days past its date.', 'Avisa al encargado cuando una tarea lleva dos días de atraso.'),
    'task.overdue', [notify('manager', 'Overdue by {{days}} days: {{task.title}} ({{owner}})', 'Atrasada {{days}} días: {{task.title}} ({{owner}})')], { days: 2 }),
  rule('b-monday-restock', l('Monday supplies check', 'Revisión de insumos del lunes'),
    l('Creates the weekly restock and tool-care task every Monday morning.', 'Crea la tarea semanal de reabastecer y dar mantenimiento a las herramientas cada lunes en la mañana.'),
    'daily', [task('Weekly check: blades, guards, disinfectant, towels, retail shelf', 'Revisión semanal: navajas, peines guía, desinfectante, toallas, anaquel de productos', 'manager', 0, 'medium', 'restock')],
    { if: [{ field: 'extra.weekday', op: 'is', value: 1 }], off: true }),
  ...CONNECTED_RULES,
  ...CONNECTED_APPT_RULES,
];
