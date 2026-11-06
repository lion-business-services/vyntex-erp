// The automations the HVAC edition ships with, on top of the ones every field edition has (src/packs/blueprint.ts).
// Plain data: WHEN an event, IF conditions, THEN steps. A company can switch each one off, change it, add its own, and
// put a shipped one back the way it shipped.
//
// What is on from the start is only what is safe without anyone looking: tasks, notes to the team, tags, and messages to
// a client PREPARED AS A DRAFT for a person to read and send. No rule here sends anything to a client by itself.
// Merge fields are filled from the records of the event: {{first_name}}, {{company}}, {{lead.name}}, {{job.name}}, ...
import type { L10n, MessageChannel, Priority, RuleCond, RuleDef, RuleEvent, RuleStep } from '@/domain/types';

const l = (en: string, es: string): L10n => ({ en, es });
type Who = 'owner' | 'manager' | 'record_owner';
/** The task type the title names, so the task list can be filtered by the trade's own kinds of work (pack taskTypes). */
const kindOf = (title: string): string | undefined =>
  /^EMERGENCY/.test(title) ? 'dispatch' : /^(Call|Check the age)/.test(title) ? 'call' : /refrigerant log/i.test(title) ? 'refrigerant'
    : /permit|inspection/i.test(title) ? 'permit' : /^Order/.test(title) ? 'parts' : /warranty/i.test(title) ? 'warranty' : /^Safety check/.test(title) ? 'safety' : undefined;
const task = (title: string, titleEs: string, who: Who, dueIn = 0, pri: Priority = 'medium'): RuleStep => {
  const type = kindOf(title);
  return { do: 'task', params: { title, titleEs, for: who, dueIn, pri, ...(type ? { type } : {}) } };
};
/** A message to the client, prepared for a person to review. Never `send`. */
const draft = (subject: string, subjectEs: string, body: string, bodyEs: string, channel: MessageChannel = 'text'): RuleStep =>
  ({ do: 'message', params: { channel, mode: 'draft', subject, subjectEs, body, bodyEs } });
const notify = (who: Who, text: string, textEs: string): RuleStep => ({ do: 'notify', params: { who, text, textEs } });
const tag = (name: string): RuleStep => ({ do: 'tag', params: { tag: name } });
const rule = (id: string, name: L10n, about: L10n, event: RuleEvent, then: RuleStep[], more: { if?: RuleCond[]; days?: number; off?: boolean } = {}): RuleDef =>
  ({ id, name, about, active: !more.off, when: { event, ...(more.days !== undefined ? { days: more.days } : {}) }, if: more.if ?? [], then, shipped: true });
const leadIs = (...types: string[]): RuleCond => (types.length === 1 ? { field: 'lead.type', op: 'is', value: types[0] } : { field: 'lead.type', op: 'in', value: types });
const jobIs = (...types: string[]): RuleCond => (types.length === 1 ? { field: 'job.type', op: 'is', value: types[0] } : { field: 'job.type', op: 'in', value: types });
const statusTo = (s: string): RuleCond => ({ field: 'extra.to', op: 'is', value: s });

const SIGN = '\n{{company}}';
const INSTALLS = ['install', 'heat_pump', 'commercial', 'ductwork'];
const REPAIRS = ['ac_repair', 'heat_repair', 'emergency', 'iaq', 'other'];

export const hvacRules: RuleDef[] = [
  // ---- emergencies first
  rule('hv-emergency-triage', l('Emergency no heat / no cool: dispatch now', 'Emergencia sin calefacción o sin aire: enviar ya'),
    l('When an emergency call comes in, creates an urgent callback for the dispatcher, alerts the manager and prepares a text telling the client a technician is being assigned.',
      'Cuando entra una emergencia, crea una devolución de llamada urgente para quien despacha, avisa al encargado y prepara un mensaje que le dice al cliente que se le está asignando un técnico.'),
    'lead.created', [
      task('EMERGENCY: call {{lead.name}} back within 15 minutes and dispatch the on-call tech', 'EMERGENCIA: devolver la llamada a {{lead.name}} en menos de 15 minutos y enviar al técnico de guardia', 'manager', 0, 'high'),
      notify('manager', 'Emergency call: {{lead.name}}. No heat or no cool. Assign the on-call technician.', 'Llamada de emergencia: {{lead.name}}. Sin calefacción o sin aire. Asigne al técnico de guardia.'),
      draft('', '',
        'Hi {{first_name}}, this is {{company}}. We got your call and a technician is being assigned now. We will text you the arrival window shortly. If you smell gas, leave the home and call 911 and your gas utility.' + SIGN,
        'Hola, {{first_name}}. Le habla {{company}}. Recibimos su llamada y ya le estamos asignando un técnico. En unos minutos le enviamos la ventana de llegada. Si huele a gas, salga de la casa y llame al 911 y a su compañía de gas.' + SIGN),
    ], { if: [leadIs('emergency')] }),
  rule('hv-service-call-confirm', l('Service call: confirm the appointment', 'Llamada de servicio: confirmar la cita'),
    l('Prepares a confirmation with the diagnostic fee and what to have ready when a repair or tune-up request comes in.',
      'Prepara una confirmación con la tarifa de diagnóstico y lo que debe tener listo cuando entra una solicitud de reparación o mantenimiento.'),
    'lead.created', [draft('Your service call with {{company}}', 'Su llamada de servicio con {{company}}',
      'Hi {{first_name}}, thanks for calling {{company}}. We will confirm your arrival window by text. Please have clear access to the indoor and outdoor units, the thermostat and the breaker panel. The diagnostic fee is credited toward the repair if you approve it.' + SIGN,
      'Hola, {{first_name}}. Gracias por llamar a {{company}}. Le confirmamos la ventana de llegada por mensaje. Por favor deje libre el acceso a los equipos de adentro y de afuera, al termostato y al panel eléctrico. La tarifa de diagnóstico se acredita a la reparación si usted la aprueba.' + SIGN, 'email')],
    { if: [leadIs('ac_repair', 'heat_repair', 'maintenance', 'iaq', 'heat_pump')] }),

  // ---- replacement sales
  rule('hv-replacement-options', l('Replacement quote: good, better, best', 'Cotización de reemplazo: tres opciones'),
    l('When a replacement or install lead gets a visit, creates the task to build three options (standard, high efficiency, heat pump) with the rebates and the financing.',
      'Cuando un prospecto de reemplazo o instalación tiene visita, crea la tarea de armar tres opciones (estándar, alta eficiencia, bomba de calor) con los reembolsos y el financiamiento.'),
    'lead.stage', [task('Build 3 options for {{lead.name}}: standard, high efficiency and heat pump, with rebates and monthly financing', 'Armar 3 opciones para {{lead.name}}: estándar, alta eficiencia y bomba de calor, con reembolsos y financiamiento mensual', 'record_owner', 1, 'high')],
    { if: [leadIs(...INSTALLS), statusTo('scheduled')] }),
  rule('hv-replacement-follow-up', l('Replacement quote follow-up', 'Seguimiento de la cotización de reemplazo'),
    l('Three days after a replacement quote is sent, prepares a follow-up that answers the usual questions, and creates a call task.',
      'Tres días después de enviar una cotización de reemplazo, prepara un seguimiento que contesta las preguntas de siempre y crea una tarea de llamada.'),
    'lead.idle', [
      draft('Your new system options', 'Sus opciones de equipo nuevo',
        'Hi {{first_name}}, just checking in on the system options we sent. Happy to walk through the efficiency, the rebates or the monthly payment on any of them. Install dates are filling up, reply here and we will hold one for you.' + SIGN,
        'Hola, {{first_name}}. Le escribimos por las opciones de equipo que le enviamos. Con gusto le explicamos la eficiencia, los reembolsos o el pago mensual de cualquiera. Las fechas de instalación se están llenando; responda aquí y le apartamos una.' + SIGN, 'email'),
      task('Call {{lead.name}} about the replacement quote', 'Llamar a {{lead.name}} por la cotización de reemplazo', 'record_owner', 0, 'medium'),
    ], { if: [leadIs(...INSTALLS)], days: 3 }),

  // ---- installs: permits, equipment, inspection
  rule('hv-install-permit', l('Install signed: permit, equipment and load check', 'Instalación firmada: permiso, equipo y cálculo de carga'),
    l('When an install job moves to signed, creates the permit, the equipment order and the load calculation tasks, and tells the manager.',
      'Cuando una instalación pasa a firmada, crea las tareas del permiso, el pedido del equipo y el cálculo de carga, y le avisa al encargado.'),
    'job.status', [
      task('Pull the mechanical permit for {{job.name}}', 'Tramitar el permiso mecánico de {{job.name}}', 'manager', 1, 'high'),
      task('Order the equipment for {{job.name}} and confirm the delivery date', 'Pedir el equipo de {{job.name}} y confirmar la fecha de entrega', 'manager', 1, 'high'),
      task('Load calculation (Manual J) and duct check for {{job.name}}', 'Cálculo de carga (Manual J) y revisión de ductos de {{job.name}}', 'manager', 2),
      notify('manager', 'Install signed: {{job.name}}. Permit and equipment order are on the task list.', 'Instalación firmada: {{job.name}}. El permiso y el pedido del equipo están en la lista de tareas.'),
    ], { if: [jobIs(...INSTALLS), statusTo('contract')] }),
  rule('hv-install-day-before', l('Install day: prepare the client', 'Día de instalación: preparar al cliente'),
    l('When an install starts, prepares a message telling the client what to expect on install day.',
      'Cuando empieza una instalación, prepara un mensaje que le dice al cliente qué esperar el día de la instalación.'),
    'job.status', [draft('Install day for your new system', 'Día de instalación de su equipo nuevo',
      'Hi {{first_name}}, your install crew is on the way. Plan on most of the day without heating or cooling. Please clear a path to the units and the attic or basement, and keep pets in a closed room. We will walk you through the new thermostat before we leave.' + SIGN,
      'Hola, {{first_name}}. Su equipo de instalación va en camino. Cuente con casi todo el día sin calefacción ni aire. Por favor deje libre el paso a los equipos y al ático o sótano, y deje a sus mascotas en un cuarto cerrado. Antes de irnos le enseñamos a usar el termostato nuevo.' + SIGN, 'email')],
    { if: [jobIs(...INSTALLS), statusTo('progress')] }),
  rule('hv-install-closeout', l('Install finished: warranty, inspection and commissioning', 'Instalación terminada: garantía, inspección y puesta en marcha'),
    l('When an install is completed, creates the warranty registration, the final inspection and the commissioning report tasks.',
      'Cuando se termina una instalación, crea las tareas de registrar la garantía, la inspección final y el reporte de puesta en marcha.'),
    'job.completed', [
      task('Register the manufacturer warranty for {{job.name}} (model and serial on the job)', 'Registrar la garantía del fabricante de {{job.name}} (modelo y serie en el trabajo)', 'manager', 3, 'high'),
      task('Schedule the final inspection with the town for {{job.name}}', 'Agendar con el municipio la inspección final de {{job.name}}', 'manager', 2, 'high'),
      task('Attach the commissioning readings: static pressure, superheat / subcooling, temperature split', 'Adjuntar las lecturas de puesta en marcha: presión estática, sobrecalentamiento / subenfriamiento, diferencia de temperatura', 'manager', 1),
    ], { if: [jobIs(...INSTALLS)] }),

  // ---- refrigerant and safety compliance
  rule('hv-refrigerant-log', l('EPA 608 refrigerant log', 'Registro de refrigerante EPA 608'),
    l('When a cooling, heat pump or rooftop job is completed, creates the task to record the refrigerant type and the pounds added or recovered.',
      'Cuando se termina un trabajo de aire acondicionado, bomba de calor o unidad de techo, crea la tarea de registrar el tipo de refrigerante y las libras agregadas o recuperadas.'),
    'job.completed', [task('Refrigerant log for {{job.name}}: type, pounds added or recovered, technician certification', 'Registro de refrigerante de {{job.name}}: tipo, libras agregadas o recuperadas, certificación del técnico', 'manager', 0, 'high')],
    { if: [jobIs('ac_repair', 'heat_pump', 'install', 'commercial', 'emergency', 'maintenance')] }),
  rule('hv-co-safety', l('Heating call: combustion and CO safety check', 'Llamada de calefacción: revisión de combustión y CO'),
    l('When a heating repair or emergency job is created, adds the combustion analysis and carbon monoxide check to the technician\'s checklist.',
      'Cuando se crea un trabajo de calefacción o de emergencia, agrega el análisis de combustión y la revisión de monóxido de carbono a la lista del técnico.'),
    'job.created', [task('Safety check on {{job.name}}: combustion analysis, CO reading, heat exchanger and flue', 'Revisión de seguridad en {{job.name}}: análisis de combustión, lectura de CO, intercambiador de calor y chimenea', 'manager', 0, 'high')],
    { if: [jobIs('heat_repair', 'emergency')] }),

  // ---- maintenance plans: the recurring revenue
  rule('hv-plan-offer', l('After a repair: offer the maintenance plan', 'Después de una reparación: ofrecer el plan de mantenimiento'),
    l('Two days after a repair is completed, prepares a message offering the maintenance plan and tags the client as a plan prospect.',
      'Dos días después de terminar una reparación, prepara un mensaje que ofrece el plan de mantenimiento y etiqueta al cliente como posible miembro.'),
    'job.completed', [
      tag('plan prospect'),
      draft('Keep your system running all year', 'Mantenga su equipo funcionando todo el año',
        'Hi {{first_name}}, thanks again for choosing {{company}}. Our maintenance plan covers a spring cooling tune-up and a fall heating tune-up, priority scheduling and a member discount on repairs. Want us to add you? Reply here.' + SIGN,
        'Hola, {{first_name}}. Gracias otra vez por elegir a {{company}}. Nuestro plan de mantenimiento incluye una revisión de aire en primavera y una de calefacción en otoño, prioridad en la agenda y descuento de miembro en reparaciones. ¿Lo agregamos? Responda aquí.' + SIGN, 'email'),
    ], { if: [jobIs(...REPAIRS)] }),
  rule('hv-tuneup-season', l('Seasonal tune-up reminders for plan members', 'Recordatorios de mantenimiento por temporada'),
    l('When a maintenance visit is scheduled, prepares the reminder with the filter size and the arrival window.',
      'Cuando se agenda una visita de mantenimiento, prepara el recordatorio con la medida del filtro y la ventana de llegada.'),
    'job.created', [draft('Your seasonal tune-up', 'Su mantenimiento de temporada',
      'Hi {{first_name}}, your {{company}} tune-up is on the calendar. The technician will check the refrigerant, the electrical, the drain line and the safety controls, and replace the filter. Reply with your filter size if you know it.' + SIGN,
      'Hola, {{first_name}}. Su mantenimiento con {{company}} ya está en la agenda. El técnico revisará el refrigerante, la parte eléctrica, la línea de drenaje y los controles de seguridad, y cambiará el filtro. Si sabe la medida de su filtro, respóndala aquí.' + SIGN, 'email')],
    { if: [jobIs('maintenance')] }),
  rule('hv-old-equipment', l('Old equipment: replacement opportunity', 'Equipo viejo: oportunidad de reemplazo'),
    l('When a repair on an emergency call is completed, creates a task to check the equipment age and offer a replacement quote.',
      'Cuando se termina la reparación de una emergencia, crea una tarea para revisar la edad del equipo y ofrecer una cotización de reemplazo.'),
    'job.completed', [task('Check the age of the system at {{job.name}}. Over 12 years or a major repair: offer a replacement quote', 'Revisar la edad del equipo en {{job.name}}. Más de 12 años o reparación mayor: ofrecer cotización de reemplazo', 'manager', 3)],
    { if: [jobIs('emergency', 'heat_repair', 'ac_repair')] }),

  // ---- reviews, idle leads, the week
  rule('hv-review', l('Review request after the visit', 'Solicitud de reseña después de la visita'),
    l('Prepares a review request a few days after a job is finished.', 'Prepara una solicitud de reseña unos días después de terminar un trabajo.'),
    'review.due', [{ do: 'review', params: { channel: 'text' } }], { days: 2 }),
  rule('hv-lead-idle', l('Unanswered request', 'Solicitud sin respuesta'),
    l('Creates a call task when nobody has answered a request in one day. In heating and cooling, a slow callback is a lost job.',
      'Crea una tarea de llamada cuando nadie ha contestado una solicitud en un día. En calefacción y aire, devolver tarde la llamada es perder el trabajo.'),
    'lead.idle', [task('Call back {{lead.name}}: still no answer', 'Devolver la llamada a {{lead.name}}: sigue sin respuesta', 'record_owner', 0, 'high')], { days: 1 }),
  rule('hv-task-overdue', l('Overdue task escalation', 'Escalamiento de tarea atrasada'),
    l('Tells the manager when a task is two days past its date.', 'Avisa al encargado cuando una tarea lleva dos días de atraso.'),
    'task.overdue', [notify('manager', 'Overdue by {{days}} days: {{task.title}} ({{owner}})', 'Atrasada {{days}} días: {{task.title}} ({{owner}})')], { days: 2 }),
  rule('hv-monday-dispatch', l('Monday: dispatch board and truck stock', 'Lunes: tablero de despacho e inventario del camión'),
    l('Creates the weekly dispatch review and truck restock task every Monday morning.', 'Crea la revisión semanal del despacho y el reabastecimiento de los camiones cada lunes en la mañana.'),
    'daily', [task('Weekly: dispatch board, on-call schedule, truck stock (capacitors, contactors, filters, refrigerant)', 'Semanal: tablero de despacho, guardias, inventario de los camiones (capacitores, contactores, filtros, refrigerante)', 'manager', 0, 'medium')],
    { if: [{ field: 'extra.weekday', op: 'is', value: 1 }] }),
];
