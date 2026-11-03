// The automations the plumbing edition ships with, on top of the ones every field edition has (src/packs/blueprint.ts).
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
  /^EMERGENCY/.test(title) ? 'dispatch' : /^Call 811/.test(title) ? 'markout' : /^(Call|Check the)/.test(title) ? 'call' : /backflow test report/i.test(title) ? 'backflow'
    : /^Gas pressure/.test(title) ? 'safety' : /permit|inspection/i.test(title) ? 'permit' : /^Order/.test(title) ? 'parts' : /warranty/i.test(title) ? 'warranty' : undefined;
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
const PERMITTED = ['water_heater', 'repipe', 'gas', 'remodel', 'sewer'];
const REPAIRS = ['leak', 'drain', 'fixtures', 'emergency', 'other'];

export const plumbingRules: RuleDef[] = [
  // ---- emergencies first
  rule('pl-emergency-triage', l('Emergency: burst pipe, flooding or no water', 'Emergencia: tubo roto, inundación o sin agua'),
    l('When an emergency call comes in, creates an urgent callback for the dispatcher, alerts the manager and prepares a text telling the client how to shut off the water while a plumber is assigned.',
      'Cuando entra una emergencia, crea una devolución de llamada urgente para quien despacha, avisa al encargado y prepara un mensaje que le dice al cliente cómo cerrar el agua mientras se le asigna un plomero.'),
    'lead.created', [
      task('EMERGENCY: call {{lead.name}} back within 15 minutes and dispatch the on-call plumber', 'EMERGENCIA: devolver la llamada a {{lead.name}} en menos de 15 minutos y enviar al plomero de guardia', 'manager', 0, 'high'),
      notify('manager', 'Emergency plumbing call: {{lead.name}}. Assign the on-call plumber now.', 'Emergencia de plomería: {{lead.name}}. Asigne ya al plomero de guardia.'),
      draft('', '',
        'Hi {{first_name}}, this is {{company}}. A plumber is being assigned now and we will text you the arrival time. If water is leaking, close the main shutoff valve (usually where the water line enters the home, or next to the water meter) and turn off the water heater. If you smell gas, leave the home and call 911 and your gas utility.' + SIGN,
        'Hola, {{first_name}}. Le habla {{company}}. Ya le estamos asignando un plomero y le mandamos la hora de llegada por mensaje. Si hay fuga, cierre la llave de paso principal (normalmente donde entra la tubería a la casa, o junto al medidor) y apague el calentador. Si huele a gas, salga de la casa y llame al 911 y a su compañía de gas.' + SIGN),
    ], { if: [leadIs('emergency')] }),
  rule('pl-gas-safety', l('Gas line request: safety first', 'Solicitud de línea de gas: primero la seguridad'),
    l('When a gas line request comes in, creates a same day callback to ask about a gas smell, and prepares the safety text.',
      'Cuando entra una solicitud de línea de gas, crea una devolución de llamada el mismo día para preguntar si huele a gas, y prepara el mensaje de seguridad.'),
    'lead.created', [
      task('Call {{lead.name}} today: ask about any gas smell before booking the visit', 'Llamar hoy a {{lead.name}}: preguntar si huele a gas antes de agendar la visita', 'manager', 0, 'high'),
      draft('', '',
        'Hi {{first_name}}, thanks for contacting {{company}} about your gas line. If you smell gas at any time, leave the home right away and call 911 and your gas utility from outside. We will call you today to book the visit.' + SIGN,
        'Hola, {{first_name}}. Gracias por contactar a {{company}} por su línea de gas. Si en cualquier momento huele a gas, salga de inmediato y llame al 911 y a su compañía de gas desde afuera. Hoy le llamamos para agendar la visita.' + SIGN),
    ], { if: [leadIs('gas')] }),
  rule('pl-service-call-confirm', l('Service call: confirm the appointment', 'Llamada de servicio: confirmar la cita'),
    l('Prepares a confirmation with the diagnostic fee and what to have ready when a repair, drain or fixture request comes in.',
      'Prepara una confirmación con la tarifa de diagnóstico y lo que debe tener listo cuando entra una solicitud de reparación, destape o accesorios.'),
    'lead.created', [draft('Your plumbing visit with {{company}}', 'Su visita de plomería con {{company}}',
      'Hi {{first_name}}, thanks for calling {{company}}. We will confirm your arrival window by text. Please clear the area under the sink, around the water heater or near the cleanout. The diagnostic fee is credited toward the repair if you approve it.' + SIGN,
      'Hola, {{first_name}}. Gracias por llamar a {{company}}. Le confirmamos la ventana de llegada por mensaje. Por favor despeje el área bajo el fregadero, alrededor del calentador o cerca del registro. La tarifa de diagnóstico se acredita a la reparación si usted la aprueba.' + SIGN, 'email')],
    { if: [leadIs('leak', 'drain', 'fixtures', 'water_heater', 'sewer')] }),

  // ---- quotes for bigger work
  rule('pl-camera-to-quote', l('Sewer camera inspection: quote the repair', 'Inspección con cámara: cotizar la reparación'),
    l('When a sewer lead gets a visit, creates the task to attach the camera video and quote the options: hydro jetting, spot repair, trenchless lining or replacement.',
      'Cuando un prospecto de alcantarillado tiene visita, crea la tarea de adjuntar el video de la cámara y cotizar las opciones: hidrolimpieza, reparación puntual, encamisado sin zanja o reemplazo.'),
    'lead.stage', [task('Attach the camera video for {{lead.name}} and quote: jetting, spot repair, trenchless lining, replacement', 'Adjuntar el video de la cámara de {{lead.name}} y cotizar: hidrolimpieza, reparación puntual, encamisado sin zanja, reemplazo', 'record_owner', 1, 'high')],
    { if: [leadIs('sewer'), statusTo('scheduled')] }),
  rule('pl-water-heater-options', l('Water heater: tank or tankless options', 'Calentador: opciones de tanque o sin tanque'),
    l('When a water heater lead gets a visit, creates the task to quote a tank and a tankless option with the gas line, venting and expansion tank.',
      'Cuando un prospecto de calentador tiene visita, crea la tarea de cotizar una opción de tanque y una sin tanque con la línea de gas, la ventilación y el tanque de expansión.'),
    'lead.stage', [task('Quote 2 options for {{lead.name}}: tank and tankless, with venting, gas line and expansion tank', 'Cotizar 2 opciones para {{lead.name}}: tanque y sin tanque, con ventilación, línea de gas y tanque de expansión', 'record_owner', 1, 'high')],
    { if: [leadIs('water_heater'), statusTo('scheduled')] }),
  rule('pl-quote-follow-up', l('Quote follow-up', 'Seguimiento de la cotización'),
    l('Three days after a repipe, sewer, water heater or remodel quote goes quiet, prepares a follow-up and creates a call task.',
      'Tres días después de que una cotización de cambio de tubería, alcantarillado, calentador o remodelación se queda sin respuesta, prepara un seguimiento y crea una tarea de llamada.'),
    'lead.idle', [
      draft('Your plumbing quote', 'Su cotización de plomería',
        'Hi {{first_name}}, just checking in on the quote we sent. Happy to go over the options, the timing or the payment plan. Reply here and we will hold a start date for you.' + SIGN,
        'Hola, {{first_name}}. Le escribimos por la cotización que le enviamos. Con gusto le explicamos las opciones, los tiempos o el plan de pagos. Responda aquí y le apartamos una fecha de inicio.' + SIGN, 'email'),
      task('Call {{lead.name}} about the quote', 'Llamar a {{lead.name}} por la cotización', 'record_owner', 0, 'medium'),
    ], { if: [leadIs(...PERMITTED)], days: 3 }),

  // ---- permitted work: permits, markouts, inspections
  rule('pl-permit', l('Signed: permit, markout and materials', 'Firmado: permiso, marcado y materiales'),
    l('When a water heater, repipe, gas, sewer or remodel job moves to signed, creates the permit, the 811 markout and the materials tasks, and tells the manager.',
      'Cuando un trabajo de calentador, cambio de tubería, gas, alcantarillado o remodelación pasa a firmado, crea las tareas del permiso, el marcado del 811 y los materiales, y le avisa al encargado.'),
    'job.status', [
      task('Pull the plumbing permit for {{job.name}} (gas permit too if there is gas work)', 'Tramitar el permiso de plomería de {{job.name}} (también el de gas si hay trabajo de gas)', 'manager', 1, 'high'),
      task('Call 811 for a markout if {{job.name}} needs digging', 'Llamar al 811 para marcar los servicios si {{job.name}} requiere excavar', 'manager', 1),
      task('Order the materials for {{job.name}} and confirm the delivery date', 'Pedir los materiales de {{job.name}} y confirmar la fecha de entrega', 'manager', 1),
      notify('manager', 'Signed: {{job.name}}. Permit, markout and materials are on the task list.', 'Firmado: {{job.name}}. El permiso, el marcado y los materiales están en la lista de tareas.'),
    ], { if: [jobIs(...PERMITTED), statusTo('contract')] }),
  rule('pl-water-shutdown', l('Work day: water shutdown notice', 'Día de trabajo: aviso de corte de agua'),
    l('When a repipe, water heater or remodel job starts, prepares the message telling the client when the water will be off.',
      'Cuando empieza un trabajo de cambio de tubería, calentador o remodelación, prepara el mensaje que le dice al cliente cuándo estará cortada el agua.'),
    'job.status', [draft('Water shutdown today', 'Corte de agua hoy',
      'Hi {{first_name}}, our plumbers are on the way. The water will be off for part of the day while we work, we will tell you before we shut it off and when it is back on. Please fill a few jugs for drinking and keep the work area clear.' + SIGN,
      'Hola, {{first_name}}. Nuestros plomeros van en camino. El agua estará cortada parte del día mientras trabajamos; le avisamos antes de cerrarla y cuando vuelva. Por favor llene algunos garrafones para tomar y mantenga libre el área de trabajo.' + SIGN, 'email')],
    { if: [jobIs('repipe', 'water_heater', 'remodel'), statusTo('progress')] }),
  rule('pl-closeout', l('Finished: inspection, warranty and photos', 'Terminado: inspección, garantía y fotos'),
    l('When permitted work is completed, creates the final inspection, the warranty registration and the photo tasks.',
      'Cuando se termina un trabajo con permiso, crea las tareas de la inspección final, el registro de la garantía y las fotos.'),
    'job.completed', [
      task('Schedule the final plumbing inspection for {{job.name}}', 'Agendar la inspección final de plomería de {{job.name}}', 'manager', 2, 'high'),
      task('Register the warranty for {{job.name}} (model and serial on the job)', 'Registrar la garantía de {{job.name}} (modelo y serie en el trabajo)', 'manager', 3),
      task('Attach the before and after photos, the pressure test and the camera video to {{job.name}}', 'Adjuntar las fotos de antes y después, la prueba de presión y el video de la cámara a {{job.name}}', 'manager', 1),
    ], { if: [jobIs(...PERMITTED)] }),

  // ---- compliance
  rule('pl-backflow-due', l('Backflow test: certificate to the water utility', 'Prueba de reflujo: certificado a la compañía de agua'),
    l('When a backflow test is completed, creates the task to file the test report with the water utility and tags the client for next year\'s test.',
      'Cuando se termina una prueba de reflujo, crea la tarea de entregar el reporte a la compañía de agua y etiqueta al cliente para la prueba del próximo año.'),
    'job.completed', [
      task('File the backflow test report for {{job.name}} with the water utility before the deadline', 'Entregar el reporte de la prueba de reflujo de {{job.name}} a la compañía de agua antes de la fecha límite', 'manager', 1, 'high'),
      tag('backflow yearly'),
    ], { if: [jobIs('backflow')] }),
  rule('pl-gas-pressure-test', l('Gas line: pressure test before covering', 'Línea de gas: prueba de presión antes de tapar'),
    l('When a gas line job starts, adds the pressure test and the leak check to the checklist before any wall is closed.',
      'Cuando empieza un trabajo de línea de gas, agrega la prueba de presión y la revisión de fugas a la lista antes de cerrar cualquier pared.'),
    'job.status', [task('Gas pressure test and leak check on {{job.name}}: record the reading before the inspection and before closing walls', 'Prueba de presión de gas y revisión de fugas en {{job.name}}: anotar la lectura antes de la inspección y de cerrar paredes', 'manager', 0, 'high')],
    { if: [jobIs('gas'), statusTo('progress')] }),

  // ---- keeping clients coming back
  rule('pl-plan-offer', l('After a repair: offer the yearly inspection plan', 'Después de una reparación: ofrecer el plan anual de inspección'),
    l('Two days after a repair is completed, prepares a message offering the yearly plumbing inspection plan and tags the client as a plan prospect.',
      'Dos días después de terminar una reparación, prepara un mensaje que ofrece el plan anual de inspección de plomería y etiqueta al cliente como posible miembro.'),
    'job.completed', [
      tag('plan prospect'),
      draft('Catch small leaks before they get expensive', 'Detecte fugas chicas antes de que salgan caras',
        'Hi {{first_name}}, thanks again for choosing {{company}}. Our yearly plumbing inspection covers a water heater flush, a check of every fixture and shutoff, a water pressure test and priority scheduling with a member discount on repairs. Want us to add you? Reply here.' + SIGN,
        'Hola, {{first_name}}. Gracias otra vez por elegir a {{company}}. Nuestra inspección anual de plomería incluye la limpieza del calentador, revisión de cada accesorio y llave de paso, prueba de presión del agua y prioridad en la agenda con descuento de miembro en reparaciones. ¿Lo agregamos? Responda aquí.' + SIGN, 'email'),
    ], { if: [jobIs(...REPAIRS)] }),
  rule('pl-plan-visit', l('Plan member: book the yearly inspection', 'Miembro del plan: agendar la inspección anual'),
    l('When a client joins the yearly inspection plan, prepares the welcome email and creates the task to book the first inspection.',
      'Cuando un cliente se une al plan anual de inspección, prepara el correo de bienvenida y crea la tarea de agendar la primera inspección.'),
    'job.created', [
      draft('Welcome to the yearly inspection plan', 'Bienvenido al plan anual de inspección',
        'Hi {{first_name}}, welcome to the {{company}} yearly inspection plan. We will call you to book your inspection: water heater flush, every fixture and shutoff, and a water pressure test. As a member you get priority scheduling, 15% off repairs and no after hours fee.' + SIGN,
        'Hola, {{first_name}}. Bienvenido al plan anual de inspección de {{company}}. Le llamaremos para agendar su inspección: limpieza del calentador, revisión de cada accesorio y llave de paso, y prueba de presión del agua. Como miembro tiene prioridad en la agenda, 15% de descuento en reparaciones y sin cargo fuera de horario.' + SIGN, 'email'),
      task('Call {{client.name}} to book the yearly plumbing inspection', 'Llamar a {{client.name}} para agendar la inspección anual de plomería', 'manager', 2),
    ], { if: [jobIs('plan')] }),
  rule('pl-drain-repeat', l('Repeat drain clog: recommend a camera inspection', 'Drenaje tapado otra vez: recomendar inspección con cámara'),
    l('When a drain cleaning is completed, creates a task to check for earlier drain calls at the address and offer a camera inspection.',
      'Cuando se termina un destape, crea una tarea para revisar si hubo destapes antes en la dirección y ofrecer una inspección con cámara.'),
    'job.completed', [task('Check the history of {{job.name}}: a second clog in 12 months means roots or a belly, offer a camera inspection', 'Revisar el historial de {{job.name}}: un segundo tapón en 12 meses indica raíces o un hundimiento, ofrecer inspección con cámara', 'manager', 2)],
    { if: [jobIs('drain')] }),
  rule('pl-old-water-heater', l('Old water heater: replacement opportunity', 'Calentador viejo: oportunidad de reemplazo'),
    l('When a leak or emergency job is completed, creates a task to check the age of the water heater and offer a replacement quote.',
      'Cuando se termina un trabajo de fuga o de emergencia, crea una tarea para revisar la edad del calentador y ofrecer una cotización de reemplazo.'),
    'job.completed', [task('Check the water heater age at {{job.name}}. Over 10 years or rust at the base: offer a tank or tankless quote', 'Revisar la edad del calentador en {{job.name}}. Más de 10 años u óxido en la base: ofrecer cotización de tanque o sin tanque', 'manager', 3)],
    { if: [jobIs('leak', 'emergency')] }),

  // ---- reviews, idle leads, the week
  rule('pl-review', l('Review request after the visit', 'Solicitud de reseña después de la visita'),
    l('Prepares a review request a few days after a job is finished.', 'Prepara una solicitud de reseña unos días después de terminar un trabajo.'),
    'review.due', [{ do: 'review', params: { channel: 'text' } }], { days: 2 }),
  rule('pl-lead-idle', l('Unanswered request', 'Solicitud sin respuesta'),
    l('Creates a call task when nobody has answered a request in one day. In plumbing, the first plumber to call back gets the job.',
      'Crea una tarea de llamada cuando nadie ha contestado una solicitud en un día. En plomería, el primero que devuelve la llamada se queda con el trabajo.'),
    'lead.idle', [task('Call back {{lead.name}}: still no answer', 'Devolver la llamada a {{lead.name}}: sigue sin respuesta', 'record_owner', 0, 'high')], { days: 1 }),
  rule('pl-task-overdue', l('Overdue task escalation', 'Escalamiento de tarea atrasada'),
    l('Tells the manager when a task is two days past its date.', 'Avisa al encargado cuando una tarea lleva dos días de atraso.'),
    'task.overdue', [notify('manager', 'Overdue by {{days}} days: {{task.title}} ({{owner}})', 'Atrasada {{days}} días: {{task.title}} ({{owner}})')], { days: 2 }),
  rule('pl-monday-dispatch', l('Monday: dispatch board and truck stock', 'Lunes: tablero de despacho e inventario del camión'),
    l('Creates the weekly dispatch review and truck restock task every Monday morning.', 'Crea la revisión semanal del despacho y el reabastecimiento de los camiones cada lunes en la mañana.'),
    'daily', [task('Weekly: dispatch board, on-call schedule, truck stock (PEX, fittings, wax rings, cartridges, jetter and camera check)', 'Semanal: tablero de despacho, guardias, inventario de los camiones (PEX, conexiones, anillos de cera, cartuchos, revisar la hidrolimpiadora y la cámara)', 'manager', 0, 'medium')],
    { if: [{ field: 'extra.weekday', op: 'is', value: 1 }] }),
];
