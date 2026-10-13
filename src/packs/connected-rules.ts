// The rules that hand work to connected apps: Google Workspace, QuickBooks and Slack. Every edition ships them, plain
// data like any other rule. A step whose app is not connected does nothing and says so in the run history, so these
// rules are safe to have on from the start: they begin working the moment the app is connected in Integrations.
// In the public demo the apps are simulated connections (Integrations > Connect Google Workspace).
//
// This file imports nothing but types, so the packs, the wording and the engine can all read it.
import type { L10n, RuleDef, RuleEvent, RuleStep } from '@/domain/types';

const l = (en: string, es: string): L10n => ({ en, es });
const app = (id: string): RuleStep => ({ do: 'connector', params: { app: id } });
const rule = (id: string, name: L10n, about: L10n, event: RuleEvent, then: RuleStep[]): RuleDef =>
  ({ id, name, about, active: true, when: { event }, if: [], then, shipped: true });

export const CONNECTED_RULES: RuleDef[] = [
  rule('connected-won', l('Google Workspace: new client set up', 'Google Workspace: alta del cliente nuevo'),
    l('When a lead is won, the person goes into Google Contacts, a Google Drive folder is opened for their documents, the tracker sheet gets a row, the work goes on Google Calendar and the team hears about it on Slack.',
      'Cuando se gana un prospecto, la persona entra en Google Contacts, se abre una carpeta de Google Drive para sus documentos, la hoja de seguimiento recibe una fila, el trabajo va a Google Calendar y el equipo se entera por Slack.'),
    'lead.won', [app('gcontacts'), app('gdrive'), app('gsheets'), app('gcal'), app('slack')]),
  rule('connected-scheduled', l('Google Calendar and Slack: new work scheduled', 'Google Calendar y Slack: trabajo nuevo agendado'),
    l('When new work is created, its dates go on Google Calendar and the team hears about it on Slack.',
      'Cuando se crea un trabajo nuevo, sus fechas van a Google Calendar y el equipo se entera por Slack.'),
    'job.created', [app('gcal'), app('slack')]),
  rule('connected-paid', l('QuickBooks and Slack: payment received', 'QuickBooks y Slack: pago recibido'),
    l('When a payment is recorded, it goes to QuickBooks Online and the team sees it on Slack.',
      'Cuando se registra un pago, pasa a QuickBooks Online y el equipo lo ve en Slack.'),
    'payment.received', [app('quickbooks'), app('slack')]),
  rule('connected-sent', l('Google Drive: file every document sent', 'Google Drive: guardar cada documento enviado'),
    l('When a document is sent, a copy is filed in the client\'s Google Drive folder.',
      'Cuando se envía un documento, se guarda una copia en la carpeta de Google Drive del cliente.'),
    'doc.sent', [app('gdrive')]),
];

/** Appointments exist in the editions that book them: the meeting goes on Google Calendar with its Meet link. */
export const CONNECTED_APPT_RULES: RuleDef[] = [
  rule('connected-booked', l('Google Calendar and Meet: appointment booked', 'Google Calendar y Meet: cita agendada'),
    l('When an appointment is booked, it goes on Google Calendar and a Google Meet link is created for it.',
      'Cuando se agenda una cita, va a Google Calendar y se crea un enlace de Google Meet para ella.'),
    'appointment.booked', [app('gcal'), app('gmeet')]),
];
