// VYNTEX AI's reach into every section (owner request of November 6, 2026: "it must be able to do each and everything in
// every section"). Each entry is one thing a person can already do on a screen, carried out through the same business
// action that screen uses, so the history, the totals and the automations are exactly the same.
//   * the model sees a one-line index of the entries this person may use (their role and edition), and calls do_action
//   * the arguments are checked here, against this entry, before anything is shown; ids must be real records
//   * anything that reaches a client, records or moves money, changes a price, deletes or publishes waits for Confirm
//     (Parker rule: access is not approval). The rest is done at once, like the 15 everyday actions
//   * never here: security, roles, people's access, the tax ID vault, bank details, automation rules, integrations
import type { Permission } from '@/domain/permissions';
import type { DemoState } from '@/domain/types';
import {
  addExpense, addTaskComment, addWorkLog, approvePost, convertLead, createDoc, createDocFromTemplate, createPost, deleteJob, deleteLead, deletePost,
  deleteTask, discardDraft, handoffLead, logCall, publishPost, queueMessage, reassignTasks, remindEnvelope, saveClient, saveDeadline,
  schedulePost, sendDraft, sendReview, setJobStatus, setLeadStage, setTaskStatus, startPlaybook, submitPost, updateDocMeta, updateJob, voidEnvelope,
  completeDeadline, setDeadlineStatus, deleteDeadline, addOpportunity, setOpportunityStatus, snoozeOpportunity, opportunityToLead, opportunityToEngagement,
  setServiceActive, duplicateService, deleteService, assignNextLead, saveAssignment, removeFromJob, addCashEntry, transferCash, saveWorker, payWorker,
  saveService, createEnvelope, saveEnvelope,
} from '@/domain/actions';
import { saveApptType } from '@/domain/actions/appointments';
import { addUpload } from '@/domain/actions/documents';
import { finishWalkIn, sellPass, renewMembership } from '@/domain/actions/shop';
import { cashCategories } from '@/domain/actions/ops';
import { autoPlace } from '@/domain/esign/envelope';
import { isLive } from '@/platform/session';
import { uid } from '@/lib/id';
import { markLeadLost, setNextAction } from '@/domain/actions/leads';
import { mergeClients } from '@/domain/actions/clients';
import { rescheduleAppointment, confirmAppointment, completeAppointment, markNoShow, cancelAppointment, updateAppointment } from '@/domain/actions/appointments';
import { addWalkIn, callWalkIn, startWalkIn, dropWalkIn, setQueueOpen } from '@/domain/actions/shop';
import { stagesOf } from '@/domain/config';
import type { Ctx } from '@/domain/context';

// The store's act(), handed over by run.ts: this file stays free of the store so the engine and its tests can use it.
type ActFn = <A extends unknown[], R>(action: (d: DemoState, c: Ctx, ...args: A) => R, ...args: A) => R;
let act: ActFn = () => { throw new Error('not bound'); };
let snapshot: () => DemoState = () => { throw new Error('not bound'); };
export function bindStore(a: ActFn, s: () => DemoState) { act = a; snapshot = s; }
import { money2 } from '@/lib/money';
import { today } from '@/lib/dates';
import { maskTaxIds } from './records';
import type { Env } from './engine';

/** The collections a parameter can point at, and how a record is named on a card. */
export const COLLECTIONS = {
  leads: 'leads', clients: 'clients', projects: 'jobs', tasks: 'tasks', appointments: 'appointments', documents: 'docs', envelopes: 'envelopes',
  posts: 'posts', opportunities: 'opportunities', deadlines: 'complianceItems', services: 'catalog', messages: 'messages', reviews: 'reviews',
  users: 'users', workers: 'workers', walkins: 'walkins', appointment_types: 'apptTypes', pass_plans: 'passPlans', passes: 'passes', offices: 'offices',
} as const;
export type CollectionName = keyof typeof COLLECTIONS;

type P =
  | { t: 'text'; req?: boolean; max?: number; d?: string }
  | { t: 'number'; req?: boolean; min?: number; d?: string }
  | { t: 'date' | 'time' | 'datetime' | 'bool'; req?: boolean; d?: string }
  | { t: 'enum'; of: readonly string[] | ((env: Env) => string[]); req?: boolean; d?: string }
  | { t: 'list'; of: readonly string[]; req?: boolean; d?: string }
  | { t: 'ref'; of: CollectionName; req?: boolean; d?: string };

export interface Spec {
  id: string; section: string; perm: Permission;
  /** Waits for Confirm: a client is reached, money is recorded or moved, a price changes, something is deleted or published. */
  risky: boolean | ((a: Args) => boolean);
  en: string; es: string;
  params: Record<string, P>;
  run: (a: Args, env: Env) => unknown;
  /** Where the record can be opened afterwards. */
  link?: (a: Args, result: unknown) => string | undefined;
  /** Only in some editions (by a collection the edition uses). */
  when?: (env: Env) => boolean;
}
export type Args = Record<string, unknown>;

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const idOf = (r: unknown) => (r && typeof r === 'object' && 'id' in r ? String((r as { id: unknown }).id) : undefined);
const STAFF = (env: Env) => env.data.users.filter((u) => u.active !== false).map((u) => u.id);
const lostStage = (env: Env) => stagesOf(env.data, env.pack).find((x) => x.kind === 'lost')?.id ?? 'lost';

export const SPECS: Spec[] = [
  // ---- leads
  { id: 'lead_set_stage', section: 'leads', perm: 'leads', risky: false, en: 'Move a lead to a stage', es: 'Mover un prospecto a una etapa',
    params: { lead: { t: 'ref', of: 'leads', req: true }, stage: { t: 'enum', of: (e) => stagesOf(e.data, e.pack).map((x) => x.id), req: true } },
    run: (a) => act(setLeadStage, s(a.lead), s(a.stage)), link: (a) => `/leads/${s(a.lead)}` },
  { id: 'lead_mark_lost', section: 'leads', perm: 'leads', risky: false, en: 'Mark a lead as lost', es: 'Marcar un prospecto como perdido',
    params: { lead: { t: 'ref', of: 'leads', req: true }, reason: { t: 'text', req: true, max: 120 }, detail: { t: 'text', max: 400 } },
    run: (a, e) => act(markLeadLost, s(a.lead), lostStage(e), s(a.reason), s(a.detail) || undefined), link: (a) => `/leads/${s(a.lead)}` },
  { id: 'lead_next_action', section: 'leads', perm: 'leads', risky: false, en: 'Set the next step for a lead', es: 'Definir el siguiente paso de un prospecto',
    params: { lead: { t: 'ref', of: 'leads', req: true }, text: { t: 'text', req: true, max: 200 }, due: { t: 'date' } },
    run: (a) => act(setNextAction, s(a.lead), s(a.text), s(a.due) || undefined), link: (a) => `/leads/${s(a.lead)}` },
  { id: 'lead_convert', section: 'leads', perm: 'leads', risky: false, en: 'Turn a lead into a client and project', es: 'Convertir un prospecto en cliente y proyecto',
    params: { lead: { t: 'ref', of: 'leads', req: true } }, run: (a) => act(convertLead, s(a.lead)), link: (_a, r) => (idOf(r) ? `/jobs/${idOf(r)}` : undefined) },
  { id: 'lead_handoff', section: 'leads', perm: 'leads', risky: false, en: 'Hand a lead to a teammate', es: 'Pasar un prospecto a un compañero',
    params: { lead: { t: 'ref', of: 'leads', req: true }, to_user: { t: 'ref', of: 'users', req: true }, reason: { t: 'text', max: 200 } },
    run: (a) => act(handoffLead, s(a.lead), s(a.to_user), s(a.reason) || undefined), link: (a) => `/leads/${s(a.lead)}` },
  { id: 'lead_assign_next', section: 'leads', perm: 'leads', risky: false, en: 'Assign the next unassigned lead', es: 'Asignar el siguiente prospecto sin asignar',
    params: {}, run: () => act(assignNextLead) },
  { id: 'lead_delete', section: 'leads', perm: 'leads', risky: true, en: 'Delete a lead', es: 'Eliminar un prospecto',
    params: { lead: { t: 'ref', of: 'leads', req: true } }, run: (a) => act(deleteLead, s(a.lead)) },

  // ---- clients
  { id: 'client_update', section: 'clients', perm: 'clients', risky: false, en: 'Update a client', es: 'Actualizar un cliente',
    params: { client: { t: 'ref', of: 'clients', req: true }, name: { t: 'text', max: 120 }, company: { t: 'text', max: 120 }, phone: { t: 'text', max: 40 }, email: { t: 'text', max: 160 }, address: { t: 'text', max: 200 } },
    run: (a, e) => {
      const c = e.data.clients.find((x) => x.id === s(a.client)); if (!c) return null;
      const addresses = s(a.address) ? [s(a.address), ...c.addresses.filter((x) => x !== s(a.address))] : c.addresses;
      return act(saveClient, { ...c, name: s(a.name) || c.name, company: s(a.company) || c.company, phone: s(a.phone) || c.phone, email: s(a.email) || c.email, addresses }, c.id);
    }, link: (a) => `/clients/${s(a.client)}` },
  { id: 'client_merge', section: 'clients', perm: 'clients', risky: true, en: 'Merge two client records', es: 'Unir dos registros de cliente',
    params: { keep: { t: 'ref', of: 'clients', req: true, d: 'the record that stays' }, drop: { t: 'ref', of: 'clients', req: true, d: 'the duplicate that is folded in' } },
    run: (a) => (s(a.keep) === s(a.drop) ? null : act(mergeClients, s(a.keep), s(a.drop))), link: (a) => `/clients/${s(a.keep)}` },

  // ---- projects
  { id: 'project_update', section: 'projects', perm: 'jobs', risky: (a) => a.price !== undefined, en: 'Update a project', es: 'Actualizar un proyecto',
    params: { project: { t: 'ref', of: 'projects', req: true }, name: { t: 'text', max: 140 }, start: { t: 'date' }, end: { t: 'date' }, address: { t: 'text', max: 200 }, scope: { t: 'text', max: 2000 }, pay_terms: { t: 'text', max: 400 }, price: { t: 'number', min: 0 } },
    run: (a) => {
      const patch: Record<string, unknown> = {};
      for (const [k, f] of [['name', 'name'], ['start', 'start'], ['end', 'end'], ['address', 'address'], ['scope', 'scope'], ['pay_terms', 'payTerms']] as const) if (s(a[k])) patch[f] = s(a[k]);
      if (a.price !== undefined) patch.price = Math.round(n(a.price) * 100) / 100;
      return Object.keys(patch).length ? act(updateJob, s(a.project), patch) : null;
    }, link: (a) => `/jobs/${s(a.project)}` },
  { id: 'project_expense', section: 'projects', perm: 'money', risky: true, en: 'Add an expense to a project', es: 'Agregar un gasto a un proyecto',
    params: { project: { t: 'ref', of: 'projects', req: true }, amount: { t: 'number', req: true, min: 0.01 }, vendor: { t: 'text', req: true, max: 120 }, description: { t: 'text', max: 300 }, date: { t: 'date' } },
    run: (a) => act(addExpense, s(a.project), { date: s(a.date) || today(), vendor: s(a.vendor), desc: s(a.description), amount: Math.round(n(a.amount) * 100) / 100 }), link: (a) => `/jobs/${s(a.project)}` },
  { id: 'project_work_log', section: 'projects', perm: 'jobs', risky: false, en: 'Add a work log entry', es: 'Agregar una entrada al registro de trabajo',
    params: { project: { t: 'ref', of: 'projects', req: true }, worker: { t: 'ref', of: 'workers', req: true }, text: { t: 'text', req: true, max: 1000 } },
    run: (a) => act(addWorkLog, s(a.project), s(a.worker), s(a.text)), link: (a) => `/jobs/${s(a.project)}` },
  { id: 'project_start_playbook', section: 'projects', perm: 'jobs', risky: false, en: 'Start the service checklist on a project', es: 'Iniciar la lista de tareas del servicio en un proyecto',
    params: { project: { t: 'ref', of: 'projects', req: true } }, run: (a) => { const r = act(startPlaybook, s(a.project)); return r.length ? r : null; }, link: (a) => `/jobs/${s(a.project)}` },
  { id: 'project_status_bulk', section: 'projects', perm: 'jobs', risky: false, en: 'Change the status of a project', es: 'Cambiar el estado de un proyecto',
    params: { project: { t: 'ref', of: 'projects', req: true }, status: { t: 'enum', of: (e) => [...e.pack.jobStatuses], req: true } },
    run: (a) => act(setJobStatus, s(a.project), s(a.status) as never), link: (a) => `/jobs/${s(a.project)}` },
  { id: 'project_delete', section: 'projects', perm: 'jobs', risky: true, en: 'Delete a project', es: 'Eliminar un proyecto',
    params: { project: { t: 'ref', of: 'projects', req: true } }, run: (a) => act(deleteJob, s(a.project)) },

  // ---- tasks
  { id: 'task_status', section: 'tasks', perm: 'tasks', risky: false, en: 'Change the status of a task', es: 'Cambiar el estado de una tarea',
    params: { task: { t: 'ref', of: 'tasks', req: true }, status: { t: 'enum', of: ['todo', 'doing', 'waiting', 'review', 'done'], req: true } },
    run: (a) => act(setTaskStatus, s(a.task), s(a.status) as never), link: (a) => `/tasks?task=${s(a.task)}` },
  { id: 'task_comment', section: 'tasks', perm: 'tasks', risky: false, en: 'Comment on a task', es: 'Comentar una tarea',
    params: { task: { t: 'ref', of: 'tasks', req: true }, text: { t: 'text', req: true, max: 1000 } },
    run: (a) => act(addTaskComment, s(a.task), s(a.text)), link: (a) => `/tasks?task=${s(a.task)}` },
  { id: 'task_reassign', section: 'tasks', perm: 'tasks', risky: false, en: 'Reassign a task', es: 'Reasignar una tarea',
    params: { task: { t: 'ref', of: 'tasks', req: true }, to_user: { t: 'ref', of: 'users', req: true } },
    run: (a) => act(reassignTasks, [s(a.task)], 'u:' + s(a.to_user)) || null, link: (a) => `/tasks?task=${s(a.task)}` },
  { id: 'task_delete', section: 'tasks', perm: 'tasks', risky: true, en: 'Delete a task', es: 'Eliminar una tarea',
    params: { task: { t: 'ref', of: 'tasks', req: true } }, run: (a) => act(deleteTask, s(a.task)) },

  // ---- appointments
  { id: 'appt_reschedule', section: 'appointments', perm: 'appointments', risky: false, en: 'Move an appointment', es: 'Cambiar una cita de horario',
    params: { appointment: { t: 'ref', of: 'appointments', req: true }, date: { t: 'date', req: true }, time: { t: 'time', req: true }, staff: { t: 'ref', of: 'users' }, reason: { t: 'text', max: 200 } },
    run: (a) => act(rescheduleAppointment, s(a.appointment), { date: s(a.date), time: s(a.time), staffId: s(a.staff) || undefined, askedBy: 'staff', reason: s(a.reason) || undefined }), link: () => '/appointments' },
  { id: 'appt_confirm', section: 'appointments', perm: 'appointments', risky: false, en: 'Confirm an appointment', es: 'Confirmar una cita',
    params: { appointment: { t: 'ref', of: 'appointments', req: true } }, run: (a) => act(confirmAppointment, s(a.appointment)), link: () => '/appointments' },
  { id: 'appt_complete', section: 'appointments', perm: 'appointments', risky: false, en: 'Mark an appointment as done', es: 'Marcar una cita como realizada',
    params: { appointment: { t: 'ref', of: 'appointments', req: true } }, run: (a) => act(completeAppointment, s(a.appointment)), link: () => '/appointments' },
  { id: 'appt_no_show', section: 'appointments', perm: 'appointments', risky: false, en: 'Mark an appointment as a no-show', es: 'Marcar una cita como inasistencia',
    params: { appointment: { t: 'ref', of: 'appointments', req: true } }, run: (a) => act(markNoShow, s(a.appointment)), link: () => '/appointments' },
  { id: 'appt_notes', section: 'appointments', perm: 'appointments', risky: false, en: 'Write the notes of an appointment', es: 'Escribir las notas de una cita',
    params: { appointment: { t: 'ref', of: 'appointments', req: true }, notes: { t: 'text', req: true, max: 1000 } },
    run: (a) => act(updateAppointment, s(a.appointment), { notes: s(a.notes) }), link: () => '/appointments' },
  { id: 'appt_cancel', section: 'appointments', perm: 'appointments', risky: true, en: 'Cancel an appointment', es: 'Cancelar una cita',
    params: { appointment: { t: 'ref', of: 'appointments', req: true }, reason: { t: 'text', req: true, max: 200 } },
    run: (a) => act(cancelAppointment, s(a.appointment), 'staff', s(a.reason)), link: () => '/appointments' },

  // ---- messages (a draft waits in Messages; sending reaches the client, so it waits for Confirm)
  { id: 'message_draft', section: 'messages', perm: 'comms', risky: false, en: 'Write a message draft to a client', es: 'Escribir un borrador de mensaje a un cliente',
    params: { client: { t: 'ref', of: 'clients', req: true }, channel: { t: 'enum', of: ['email', 'text', 'whatsapp'], req: true }, subject: { t: 'text', max: 160 }, body: { t: 'text', req: true, max: 4000 } },
    run: (a, e) => sendTo(a, e, 'draft'), link: () => '/messages' },
  { id: 'message_send', section: 'messages', perm: 'comms', risky: true, en: 'Send a message to a client', es: 'Enviar un mensaje a un cliente',
    params: { client: { t: 'ref', of: 'clients', req: true }, channel: { t: 'enum', of: ['email', 'text', 'whatsapp'], req: true }, subject: { t: 'text', max: 160 }, body: { t: 'text', req: true, max: 4000 } },
    run: (a, e) => sendTo(a, e, 'send'), link: () => '/messages' },
  { id: 'message_send_draft', section: 'messages', perm: 'comms', risky: true, en: 'Send a waiting draft', es: 'Enviar un borrador pendiente',
    params: { message: { t: 'ref', of: 'messages', req: true } }, run: (a) => act(sendDraft, s(a.message)), link: () => '/messages' },
  { id: 'message_discard_draft', section: 'messages', perm: 'comms', risky: false, en: 'Discard a draft', es: 'Descartar un borrador',
    params: { message: { t: 'ref', of: 'messages', req: true } }, run: (a) => act(discardDraft, s(a.message)) || null, link: () => '/messages' },
  { id: 'call_log', section: 'messages', perm: 'clients', risky: false, en: 'Log a phone call', es: 'Registrar una llamada',
    params: { client: { t: 'ref', of: 'clients', req: true }, direction: { t: 'enum', of: ['in', 'out'], req: true }, minutes: { t: 'number', min: 0 }, text: { t: 'text', req: true, max: 1000 } },
    run: (a) => act(logCall, { type: 'client', id: s(a.client) }, { dir: s(a.direction) as 'in' | 'out', seconds: Math.round((n(a.minutes) || 0) * 60), text: s(a.text) }), link: (a) => `/clients/${s(a.client)}` },

  // ---- social
  { id: 'post_create', section: 'social', perm: 'social', risky: false, en: 'Write a social post draft', es: 'Escribir un borrador de publicación',
    params: { text: { t: 'text', req: true, max: 2200 }, channels: { t: 'list', of: ['facebook', 'instagram', 'gbp'], req: true } },
    run: (a) => act(createPost, { text: s(a.text), channels: (a.channels as never[]) }), link: () => '/social' },
  { id: 'post_submit', section: 'social', perm: 'social', risky: false, en: 'Send a post for approval', es: 'Enviar una publicación a aprobación',
    params: { post: { t: 'ref', of: 'posts', req: true } }, run: (a) => act(submitPost, s(a.post)), link: () => '/social' },
  { id: 'post_approve', section: 'social', perm: 'social', risky: true, en: 'Approve a post', es: 'Aprobar una publicación',
    params: { post: { t: 'ref', of: 'posts', req: true } }, run: (a) => act(approvePost, s(a.post)), link: () => '/social' },
  { id: 'post_schedule', section: 'social', perm: 'social', risky: true, en: 'Schedule a post', es: 'Programar una publicación',
    params: { post: { t: 'ref', of: 'posts', req: true }, when: { t: 'datetime', req: true } }, run: (a) => act(schedulePost, s(a.post), s(a.when)), link: () => '/social' },
  { id: 'post_publish', section: 'social', perm: 'social', risky: true, en: 'Publish a post now', es: 'Publicar ahora',
    params: { post: { t: 'ref', of: 'posts', req: true } }, run: (a) => act(publishPost, s(a.post)), link: () => '/social' },
  { id: 'post_delete', section: 'social', perm: 'social', risky: true, en: 'Delete a post', es: 'Eliminar una publicación',
    params: { post: { t: 'ref', of: 'posts', req: true } }, run: (a) => act(deletePost, s(a.post)) || null },

  // ---- opportunities
  { id: 'opportunity_add', section: 'opportunities', perm: 'opportunities', risky: false, en: 'Add a sales opportunity', es: 'Agregar una oportunidad de venta',
    params: { client: { t: 'ref', of: 'clients', req: true }, service: { t: 'ref', of: 'services', req: true }, note: { t: 'text', max: 400 } },
    run: (a) => act(addOpportunity, { clientId: s(a.client), serviceId: s(a.service), note: s(a.note) || undefined }), link: () => '/opportunities' },
  { id: 'opportunity_status', section: 'opportunities', perm: 'opportunities', risky: false, en: 'Change an opportunity', es: 'Cambiar una oportunidad',
    params: { opportunity: { t: 'ref', of: 'opportunities', req: true }, status: { t: 'enum', of: ['open', 'contacted', 'won', 'dismissed'], req: true }, reason: { t: 'text', max: 200 } },
    run: (a) => act(setOpportunityStatus, s(a.opportunity), s(a.status) as never, s(a.reason) || undefined), link: () => '/opportunities' },
  { id: 'opportunity_snooze', section: 'opportunities', perm: 'opportunities', risky: false, en: 'Snooze an opportunity', es: 'Posponer una oportunidad',
    params: { opportunity: { t: 'ref', of: 'opportunities', req: true }, until: { t: 'date', req: true }, with_task: { t: 'bool' } },
    run: (a) => act(snoozeOpportunity, s(a.opportunity), s(a.until), a.with_task === true), link: () => '/opportunities' },
  { id: 'opportunity_to_lead', section: 'opportunities', perm: 'leads', risky: false, en: 'Turn an opportunity into a lead', es: 'Convertir una oportunidad en prospecto',
    params: { opportunity: { t: 'ref', of: 'opportunities', req: true } }, run: (a) => act(opportunityToLead, s(a.opportunity)), link: (_a, r) => (idOf(r) ? `/leads/${idOf(r)}` : undefined) },
  { id: 'opportunity_to_project', section: 'opportunities', perm: 'jobs', risky: false, en: 'Turn an opportunity into a project', es: 'Convertir una oportunidad en proyecto',
    params: { opportunity: { t: 'ref', of: 'opportunities', req: true } }, run: (a) => act(opportunityToEngagement, s(a.opportunity)), link: (_a, r) => (idOf(r) ? `/jobs/${idOf(r)}` : undefined) },

  // ---- reviews
  { id: 'review_send', section: 'reviews', perm: 'reviews', risky: true, en: 'Send a waiting review request', es: 'Enviar una solicitud de reseña pendiente',
    params: { review: { t: 'ref', of: 'reviews', req: true } }, run: (a) => act(sendReview, s(a.review)), link: () => '/reviews' },

  // ---- deadlines
  { id: 'deadline_add', section: 'deadlines', perm: 'deadlines', risky: false, en: 'Add a deadline', es: 'Agregar una fecha límite',
    params: { title: { t: 'text', req: true, max: 140 }, kind: { t: 'enum', of: ['filing', 'license', 'renewal', 'deadline', 'insurance', 'other'], req: true }, due: { t: 'date', req: true },
      client: { t: 'ref', of: 'clients' }, project: { t: 'ref', of: 'projects' }, assignee: { t: 'ref', of: 'users' }, repeat: { t: 'enum', of: ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] }, note: { t: 'text', max: 400 } },
    run: (a) => act(saveDeadline, { title: s(a.title), kind: s(a.kind) as never, due: s(a.due), clientId: s(a.client) || undefined, jobId: s(a.project) || undefined, assignee: s(a.assignee) || undefined, repeat: (s(a.repeat) || undefined) as never, note: s(a.note) || undefined }), link: () => '/deadlines' },
  { id: 'deadline_complete', section: 'deadlines', perm: 'deadlines', risky: false, en: 'Mark a deadline as done', es: 'Marcar una fecha límite como cumplida',
    params: { deadline: { t: 'ref', of: 'deadlines', req: true } }, run: (a) => act(completeDeadline, s(a.deadline)), link: () => '/deadlines' },
  { id: 'deadline_waive', section: 'deadlines', perm: 'deadlines', risky: false, en: 'Waive or reopen a deadline', es: 'Dispensar o reabrir una fecha límite',
    params: { deadline: { t: 'ref', of: 'deadlines', req: true }, status: { t: 'enum', of: ['waived', 'open'], req: true } }, run: (a) => act(setDeadlineStatus, s(a.deadline), s(a.status) as never), link: () => '/deadlines' },
  { id: 'deadline_delete', section: 'deadlines', perm: 'deadlines', risky: true, en: 'Delete a deadline', es: 'Eliminar una fecha límite',
    params: { deadline: { t: 'ref', of: 'deadlines', req: true } }, run: (a) => act(deleteDeadline, s(a.deadline)) },

  // ---- documents and e-sign
  { id: 'document_create', section: 'documents', perm: 'documents', risky: false, en: 'Create a document from a template', es: 'Crear un documento desde una plantilla',
    params: { kind: { t: 'enum', of: ['contract', 'estimate', 'engagement_letter', 'service_order', 'service_agreement', 'custom'], req: true }, client: { t: 'ref', of: 'clients' }, project: { t: 'ref', of: 'projects' } },
    run: (a, e) => {
      const job = e.data.jobs.find((j) => j.id === s(a.project));
      const clientId = s(a.client) || job?.clientId; if (!clientId) return null;
      return job && !s(a.client) ? act(createDoc, job.id, s(a.kind) as never) : act(createDocFromTemplate, { kind: s(a.kind) as never, clientId, jobId: job?.id });
    }, link: (_a, r) => (idOf(r) ? `/documents/${idOf(r)}` : '/documents') },
  { id: 'document_rename', section: 'documents', perm: 'documents', risky: false, en: 'Rename or file a document', es: 'Renombrar o archivar un documento',
    params: { document: { t: 'ref', of: 'documents', req: true }, title: { t: 'text', max: 160 }, folder: { t: 'text', max: 80 } },
    run: (a) => act(updateDocMeta, s(a.document), { title: s(a.title) || undefined, folder: s(a.folder) || undefined }), link: (a) => `/documents/${s(a.document)}` },
  { id: 'esign_remind', section: 'esign', perm: 'esign', risky: true, en: 'Remind the signers of an envelope', es: 'Recordar a los firmantes de un sobre',
    params: { envelope: { t: 'ref', of: 'envelopes', req: true } }, run: (a) => act(remindEnvelope, s(a.envelope)), link: () => '/esign' },
  { id: 'esign_void', section: 'esign', perm: 'esign', risky: true, en: 'Void an envelope', es: 'Anular un sobre',
    params: { envelope: { t: 'ref', of: 'envelopes', req: true }, reason: { t: 'text', req: true, max: 200 } }, run: (a) => act(voidEnvelope, s(a.envelope), s(a.reason)), link: () => '/esign' },

  // ---- catalog
  { id: 'service_active', section: 'catalog', perm: 'catalog', risky: false, en: 'Turn a service on or off', es: 'Activar o desactivar un servicio',
    params: { service: { t: 'ref', of: 'services', req: true }, active: { t: 'bool', req: true } }, run: (a) => act(setServiceActive, s(a.service), a.active === true), link: () => '/catalog' },
  { id: 'service_duplicate', section: 'catalog', perm: 'catalog', risky: false, en: 'Duplicate a service', es: 'Duplicar un servicio',
    params: { service: { t: 'ref', of: 'services', req: true } }, run: (a) => act(duplicateService, s(a.service)), link: () => '/catalog' },
  { id: 'service_delete', section: 'catalog', perm: 'catalog', risky: true, en: 'Delete a service', es: 'Eliminar un servicio',
    params: { service: { t: 'ref', of: 'services', req: true } }, run: (a) => act(deleteService, s(a.service)) || null },

  // ---- shop floor (barber editions)
  { id: 'walkin_add', section: 'floor', perm: 'appointments', risky: false, en: 'Add a walk-in to the line', es: 'Agregar un cliente sin cita a la fila',
    params: { name: { t: 'text', req: true, max: 120 }, phone: { t: 'text', max: 40 }, service: { t: 'ref', of: 'services' }, note: { t: 'text', max: 200 } },
    run: (a) => act(addWalkIn, { name: s(a.name), phone: s(a.phone) || undefined, serviceId: s(a.service) || undefined, note: s(a.note) || undefined, source: 'desk' as never }), link: () => '/floor', when: (e) => (e.data.chairs?.length ?? 0) > 0 },
  { id: 'walkin_call', section: 'floor', perm: 'appointments', risky: false, en: 'Call the next walk-in to a chair', es: 'Llamar al siguiente cliente a una silla',
    params: { walkin: { t: 'ref', of: 'walkins', req: true } }, run: (a) => act(callWalkIn, s(a.walkin)), link: () => '/floor', when: (e) => (e.data.chairs?.length ?? 0) > 0 },
  { id: 'walkin_start', section: 'floor', perm: 'appointments', risky: false, en: 'Start a walk-in service', es: 'Iniciar el servicio de un cliente sin cita',
    params: { walkin: { t: 'ref', of: 'walkins', req: true } }, run: (a) => act(startWalkIn, s(a.walkin)), link: () => '/floor', when: (e) => (e.data.chairs?.length ?? 0) > 0 },
  { id: 'walkin_drop', section: 'floor', perm: 'appointments', risky: false, en: 'Take a walk-in off the line', es: 'Quitar a un cliente de la fila',
    params: { walkin: { t: 'ref', of: 'walkins', req: true }, why: { t: 'enum', of: ['left', 'no_show'], req: true } }, run: (a) => act(dropWalkIn, s(a.walkin), s(a.why) as never), link: () => '/floor', when: (e) => (e.data.chairs?.length ?? 0) > 0 },
  { id: 'queue_open', section: 'floor', perm: 'appointments', risky: false, en: 'Open or close the walk-in line', es: 'Abrir o cerrar la fila sin cita',
    params: { open: { t: 'bool', req: true } }, run: (a) => { act(setQueueOpen, a.open === true); return true; }, link: () => '/floor', when: (e) => (e.data.chairs?.length ?? 0) > 0 },
  // ---- invoices (0097): on the server; found by their number (INV-0003). Sending and money wait for Confirm
  { id: 'invoice_send', section: 'invoices', perm: 'money', risky: true, en: 'Send an invoice to the client (with the online pay link when payments are on)', es: 'Enviar una factura al cliente (con el enlace de pago en línea cuando los pagos están activos)',
    params: { invoice: { t: 'text', req: true, max: 20, d: 'invoice number, e.g. INV-0003' } },
    run: async (a) => { const inv = await invoiceByNumber(s(a.invoice)); if (!inv) return { ok: false, reason: 'invoice_not_found' };
      return rpcOk('invoice_send', { p_id: inv.id }); }, link: () => '/invoices' },
  { id: 'invoice_mark_paid', section: 'invoices', perm: 'money', risky: true, en: 'Record a payment on an invoice (paid outside Stripe)', es: 'Registrar un pago en una factura (pagada fuera de Stripe)',
    params: { invoice: { t: 'text', req: true, max: 20, d: 'invoice number' }, amount: { t: 'number', min: 0.01, d: 'empty: the whole balance' }, method: { t: 'enum', of: ['zelle', 'check', 'cash', 'transfer', 'card'], req: true }, date: { t: 'date' }, reference: { t: 'text', max: 60, d: 'check number or similar' } },
    run: async (a) => { const inv = await invoiceByNumber(s(a.invoice)); if (!inv) return { ok: false, reason: 'invoice_not_found' };
      return rpcOk('invoice_record_payment', { p_id: inv.id, p_cents: a.amount === undefined ? null : Math.round(n(a.amount) * 100), p_method: s(a.method), p_date: s(a.date) || today(), p_ref: s(a.reference) }); }, link: () => '/invoices' },
  { id: 'invoice_delete_draft', section: 'invoices', perm: 'money', risky: true, en: 'Delete a draft invoice', es: 'Eliminar una factura en borrador',
    params: { invoice: { t: 'text', req: true, max: 20 } },
    run: async (a) => { const inv = await invoiceByNumber(s(a.invoice)); if (!inv) return { ok: false, reason: 'invoice_not_found' }; if (inv.status !== 'draft') return { ok: false, reason: 'not_a_draft' };
      return rpcOk('invoice_discard', { p_id: inv.id }); }, link: () => '/invoices' },

  // ---- e-sign: a document goes out for signature; the boxes are placed on its signature lines
  { id: 'esign_send', section: 'esign', perm: 'esign', risky: true, en: 'Send a document for signature', es: 'Enviar un documento para firma',
    params: { document: { t: 'ref', of: 'documents', req: true }, signer_name: { t: 'text', max: 120, d: 'the client signer, when not the one on the record' }, signer_email: { t: 'text', max: 160 }, message: { t: 'text', max: 600 } },
    run: (a, e) => sendForSign(a, e), link: (_a, r) => (r && typeof r === 'object' && 'envelope' in r ? `/esign/${String((r as { envelope: string }).envelope)}` : '/esign') },

  // ---- projects: the crew, and entries made by mistake
  { id: 'project_assign_worker', section: 'projects', perm: 'jobs', risky: true, en: 'Assign a worker or crew to a project', es: 'Asignar un trabajador o equipo a un proyecto',
    params: { project: { t: 'ref', of: 'projects', req: true }, worker: { t: 'ref', of: 'workers', req: true }, scope: { t: 'text', req: true, max: 300 }, price: { t: 'number', min: 0, req: true, d: 'agreed total for this part' },
      pay_type: { t: 'enum', of: ['project', 'milestone', 'daily', 'weekly', 'monthly', 'hourly'] } },
    run: (a) => { act(saveAssignment, s(a.project), { workerId: s(a.worker), scope: s(a.scope), price: Math.round(n(a.price) * 100) / 100, payType: (s(a.pay_type) || 'project') as never, status: 'pending' }); return true; }, link: (a) => `/jobs/${s(a.project)}` },
  { id: 'project_remove_entry', section: 'projects', perm: 'money', risky: true, en: 'Remove a payment, expense, assignment or log entry made by mistake', es: 'Quitar un pago, gasto, asignación o registro hecho por error',
    params: { project: { t: 'ref', of: 'projects', req: true }, kind: { t: 'enum', of: ['payment', 'expense', 'assignment', 'log'], req: true }, amount: { t: 'number', min: 0, d: 'to find it' }, date: { t: 'date', d: 'to find it' } },
    run: (a, e) => {
      const j = e.data.jobs.find((x) => x.id === s(a.project)); if (!j) return null;
      const coll = ({ payment: 'received', expense: 'expenses', assignment: 'assign', log: 'log' } as const)[s(a.kind) as 'payment'];
      const list = (j[coll] as unknown as { id: string; amount?: number; price?: number; date?: string; at?: string }[]);
      const hits = list.filter((x) => (a.amount === undefined || Math.abs((x.amount ?? x.price ?? -1) - n(a.amount)) < 0.005) && (!s(a.date) || (x.date ?? x.at ?? '').startsWith(s(a.date))));
      if (hits.length !== 1) return { ok: false, reason: hits.length ? 'many_match' : 'no_match' };
      act(removeFromJob, j.id, coll, hits[0].id); return true;
    }, link: (a) => `/jobs/${s(a.project)}` },

  // ---- petty cash
  { id: 'cash_entry', section: 'cash', perm: 'cash', risky: true, en: 'Record petty cash in or out', es: 'Registrar caja chica (entrada o salida)',
    params: { direction: { t: 'enum', of: ['in', 'out'], req: true }, amount: { t: 'number', min: 0.01, req: true }, category: { t: 'enum', of: (e) => cashCategories(e.data), req: true }, memo: { t: 'text', max: 200 }, date: { t: 'date' }, office: { t: 'ref', of: 'offices' } },
    run: (a) => act(addCashEntry, { dir: s(a.direction) as 'in' | 'out', amount: n(a.amount), category: s(a.category), memo: s(a.memo), date: s(a.date) || today(), officeId: s(a.office) || undefined }), link: () => '/cash' },
  { id: 'cash_transfer', section: 'cash', perm: 'cash', risky: true, en: 'Move petty cash between offices', es: 'Mover caja chica entre oficinas',
    params: { from: { t: 'ref', of: 'offices', req: true }, to: { t: 'ref', of: 'offices', req: true }, amount: { t: 'number', min: 0.01, req: true }, memo: { t: 'text', max: 200 }, date: { t: 'date' } },
    run: (a) => act(transferCash, { from: s(a.from), to: s(a.to), amount: n(a.amount), memo: s(a.memo) || undefined, date: s(a.date) || today() }), link: () => '/cash', when: (e) => e.data.offices.length > 1 },

  // ---- team
  { id: 'worker_add', section: 'team', perm: 'team', risky: (a) => a.rate !== undefined, en: 'Add a worker or subcontractor', es: 'Agregar un trabajador o subcontratista',
    params: { name: { t: 'text', req: true, max: 120 }, trade: { t: 'text', req: true, max: 80 }, phone: { t: 'text', max: 40 }, email: { t: 'text', max: 160 }, pay_type: { t: 'enum', of: ['project', 'milestone', 'daily', 'weekly', 'monthly', 'hourly'] }, rate: { t: 'number', min: 0 } },
    run: (a) => act(saveWorker, { name: s(a.name), trade: s(a.trade), phone: s(a.phone), email: s(a.email), w9: false, active: true, ...(s(a.pay_type) ? { payType: s(a.pay_type) as never } : {}), ...(a.rate !== undefined ? { rate: n(a.rate) } : {}) }), link: () => '/team' },
  { id: 'worker_pay', section: 'team', perm: 'money', risky: true, en: 'Record a payment to a worker', es: 'Registrar un pago a un trabajador',
    params: { worker: { t: 'ref', of: 'workers', req: true }, amount: { t: 'number', min: 0.01, req: true }, method: { t: 'enum', of: ['zelle', 'check', 'cash', 'transfer', 'card'], req: true }, project: { t: 'ref', of: 'projects' }, date: { t: 'date' }, reference: { t: 'text', max: 60 } },
    run: (a) => (/\d{9,}/.test(s(a.reference)) ? { ok: false, reason: 'invalid_ref' } : act(payWorker, { workerId: s(a.worker), date: s(a.date) || today(), method: s(a.method) as never, ref: s(a.reference) }, [{ jobId: s(a.project), amount: Math.round(n(a.amount) * 100) / 100 }])), link: () => '/team' },

  // ---- catalog: prices and appointment types
  { id: 'service_price', section: 'catalog', perm: 'catalog', risky: true, en: 'Change the price of a service', es: 'Cambiar el precio de un servicio',
    params: { service: { t: 'ref', of: 'services', req: true }, price: { t: 'number', min: 0, req: true }, tier: { t: 'text', max: 80, d: 'tier name; empty: the first' } },
    run: (a, e) => {
      const sv = e.data.catalog.find((x) => x.id === s(a.service)); if (!sv) return null;
      const t = s(a.tier) ? sv.tiers.find((x) => x.name.toLowerCase() === s(a.tier).toLowerCase()) : sv.tiers[0]; if (!t) return { ok: false, reason: 'no_tier' };
      return act(saveService, { ...(sv as unknown as Record<string, unknown>), tiers: sv.tiers.map((x) => (x.id === t.id ? { ...x, price: Math.round(n(a.price) * 100) / 100 } : x)) } as never, sv.id);
    }, link: () => '/catalog' },
  { id: 'service_add', section: 'catalog', perm: 'catalog', risky: true, en: 'Add a service to the catalog', es: 'Agregar un servicio al catálogo',
    params: { name: { t: 'text', req: true, max: 120 }, price: { t: 'number', min: 0, req: true }, unit: { t: 'enum', of: ['flat', 'hour', 'month', 'quarter', 'year'] }, category: { t: 'text', max: 80 }, description: { t: 'text', max: 600 } },
    run: (a) => act(saveService, { name: s(a.name), category: s(a.category), description: s(a.description), active: true, tiers: [{ name: 'Standard', price: Math.round(n(a.price) * 100) / 100, unit: (s(a.unit) || 'flat') as never }] } as never), link: () => '/catalog' },
  { id: 'appt_type_save', section: 'appointments', perm: 'appointments', risky: (a) => a.fee !== undefined, en: 'Add or change an appointment type', es: 'Agregar o cambiar un tipo de cita',
    params: { type: { t: 'ref', of: 'appointment_types', d: 'empty: a new one' }, name_en: { t: 'text', max: 80 }, name_es: { t: 'text', max: 80 }, minutes: { t: 'number', min: 5 }, fee: { t: 'number', min: 0 }, mode: { t: 'enum', of: ['office', 'phone', 'video'] }, active: { t: 'bool' } },
    run: (a, e) => {
      const cur = e.data.apptTypes?.find((x) => x.id === s(a.type));
      const en = s(a.name_en) || cur?.name.en || s(a.name_es); const es = s(a.name_es) || cur?.name.es || en;
      if (!en) return { ok: false, reason: 'need_name' };
      return act(saveApptType, { ...(cur ?? { prepay: false, mode: 'office', minutes: 30, fee: 0 }), ...(cur ? { id: cur.id } : {}), name: { ...(cur?.name ?? {}), en, es } as never,
        minutes: a.minutes !== undefined ? Math.round(n(a.minutes)) : cur?.minutes ?? 30, fee: a.fee !== undefined ? n(a.fee) : cur?.fee ?? 0, mode: (s(a.mode) || cur?.mode || 'office') as never,
        active: a.active !== undefined ? a.active === true : cur?.active !== false } as never);
    }, link: () => '/appointments' },

  // ---- shop floor money (barber editions)
  { id: 'walkin_checkout', section: 'floor', perm: 'money', risky: true, en: 'Check out a walk-in and record the payment', es: 'Cobrar a un cliente sin cita y registrar el pago',
    params: { walkin: { t: 'ref', of: 'walkins', req: true }, amount: { t: 'number', min: 0, req: true }, tip: { t: 'number', min: 0 }, method: { t: 'enum', of: ['cash', 'card', 'zelle', 'check', 'transfer', 'pass'], req: true }, pass: { t: 'ref', of: 'passes' } },
    run: (a) => act(finishWalkIn, s(a.walkin), { amount: n(a.amount), tip: a.tip === undefined ? undefined : n(a.tip), method: s(a.method) as never, passId: s(a.pass) || undefined }), link: () => '/floor', when: (e) => (e.data.chairs?.length ?? 0) > 0 },
  { id: 'pass_sell', section: 'memberships', perm: 'money', risky: true, en: 'Sell a membership, package or gift card', es: 'Vender una membresía, paquete o tarjeta de regalo',
    params: { plan: { t: 'ref', of: 'pass_plans', d: 'empty for a gift card' }, client: { t: 'ref', of: 'clients' }, holder: { t: 'text', max: 120, d: 'gift card holder when not a client' }, amount: { t: 'number', min: 0.01, d: 'gift card amount' }, method: { t: 'enum', of: ['cash', 'card', 'zelle', 'check', 'transfer'], req: true } },
    run: (a) => act(sellPass, { planId: s(a.plan) || undefined, kind: s(a.plan) ? undefined : 'gift_card', clientId: s(a.client) || undefined, holder: s(a.holder) || undefined, amount: a.amount === undefined ? undefined : n(a.amount), method: s(a.method) as never }), link: () => '/memberships', when: (e) => (e.data.passPlans?.length ?? 0) > 0 },
  { id: 'membership_renew', section: 'memberships', perm: 'money', risky: true, en: 'Renew a membership', es: 'Renovar una membresía',
    params: { pass: { t: 'ref', of: 'passes', req: true }, method: { t: 'enum', of: ['cash', 'card', 'zelle', 'check', 'transfer'], req: true } },
    run: (a) => act(renewMembership, s(a.pass), s(a.method) as never), link: () => '/memberships', when: (e) => (e.data.passPlans?.length ?? 0) > 0 },

  // ---- a file attached to the chat, saved as a document
  { id: 'document_save_attachment', section: 'documents', perm: 'documents', risky: false, en: 'Save a file attached to this chat as a document', es: 'Guardar como documento un archivo adjunto a este chat',
    params: { file_name: { t: 'text', req: true, max: 120 }, client: { t: 'ref', of: 'clients' }, project: { t: 'ref', of: 'projects' }, lead: { t: 'ref', of: 'leads' }, title: { t: 'text', max: 160 }, folder: { t: 'text', max: 80 } },
    run: (a) => saveAttachment(a), link: (_a, r) => (idOf(r) ? `/documents/${idOf(r)}` : '/documents') },
];

/** A message to a client, by the address the client record holds for that channel. */
function sendTo(a: Args, env: Env, mode: 'draft' | 'send') {
  const c = env.data.clients.find((x) => x.id === s(a.client)); if (!c) return null;
  const channel = s(a.channel) as 'email' | 'text' | 'whatsapp';
  const to = channel === 'email' ? c.email : c.phone;
  if (!to && mode === 'send') return { ok: false, reason: 'no_address' };
  return act(queueMessage, { channel, to: to || '', subject: channel === 'email' ? s(a.subject) || undefined : undefined, body: maskTaxIds(s(a.body)), ref: { type: 'client', id: c.id }, clientId: c.id, mode, personal: true });
}

// ---- server helpers (live workspaces). A sample workspace has no invoices and sends nothing.
async function rpcCall<T>(name: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  if (!isLive()) return { ok: false, reason: 'live_only' };
  try { const { rpc } = await import('@/platform/live/ops'); const r = await rpc<T>(name, args); return r.ok ? { ok: true, data: r.data.result as T } : { ok: false, reason: r.code || 'generic' }; }
  catch { return { ok: false, reason: 'generic' }; }
}
const rpcOk = async (name: string, args: Record<string, unknown>) => { const r = await rpcCall<unknown>(name, args); return r.ok ? (r.data === false ? { ok: false, reason: 'generic' } : { ok: true, value: r.data }) : r; };
export interface InvoiceRow { id: string; number: string; status: string; project?: string; client?: string; totalCents: number; paidCents: number; dueDate: string; overdue?: boolean }
export async function listInvoices(): Promise<InvoiceRow[] | null> { const r = await rpcCall<InvoiceRow[]>('invoice_list', {}); return r.ok && Array.isArray(r.data) ? r.data : null; }
async function invoiceByNumber(num: string): Promise<InvoiceRow | undefined> {
  const list = await listInvoices(); const want = num.toUpperCase().replace(/\s+/g, '');
  return list?.find((i) => i.number.toUpperCase() === want || i.number.toUpperCase() === 'INV-' + want.replace(/^INV-?/, '').padStart(4, '0'));
}

/** Creates the request (or takes the open draft), places the boxes on the document's signature lines, and sends it. */
async function sendForSign(a: Args, env: Env) {
  const doc = env.data.docs.find((x) => x.id === s(a.document)); if (!doc) return null;
  const made = act(createEnvelope, doc.id, { message: s(a.message) || undefined });
  if (!made.ok) return made;
  const ev = made.data;
  if (s(a.signer_email) || s(a.signer_name)) {
    const hasClient = ev.signers.some((y) => y.role === 'client');
    const signers = ev.signers.map((x, i) => (x.role === 'client' || (i === 0 && !hasClient) ? { ...x, name: s(a.signer_name) || x.name, email: s(a.signer_email) || x.email } : x));
    act(saveEnvelope, ev.id, { signers } as never);
  }
  const { drawDocument, sendDrawn } = await import('@/features/esign/prepare');
  const cur = snapshot().docs.find((x) => x.id === doc.id) ?? doc;
  const drawn = await drawDocument({ data: snapshot(), pack: env.pack, lang: env.lang }, cur);
  if (!drawn.ok) return { ok: false, reason: drawn.reason, link: `/esign/${ev.id}` };
  const e2 = snapshot().envelopes.find((x) => x.id === ev.id);
  if (e2 && !e2.fields.length) {
    const placed = autoPlace(drawn.doc.anchors, e2.signers, () => uid('fd'));
    if (!placed.length) return { ok: false, reason: 'place_boxes', link: `/esign/${ev.id}` };
    act(saveEnvelope, ev.id, { fields: placed } as never);
  }
  const sent = await sendDrawn(ev.id, cur, drawn.doc);
  return sent.ok ? { ok: true, value: { envelope: ev.id } } : { ok: false, reason: sent.reason, link: `/esign/${ev.id}` };
}

// ---- files attached to the chat: the page hands them over with each question; they stay only while the page is open
export interface TurnFile { name: string; mime: string; dataUrl?: string; text?: string }
let turnFiles: TurnFile[] = [];
export function setTurnFiles(files: TurnFile[]) { if (files.length) turnFiles = [...files, ...turnFiles].slice(0, 6); }
const b64 = (bytes: Uint8Array) => { let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
async function saveAttachment(a: Args) {
  const f = turnFiles.find((x) => x.name.toLowerCase() === s(a.file_name).toLowerCase()) ?? (turnFiles.length === 1 ? turnFiles[0] : undefined);
  if (!f) return { ok: false, reason: 'no_file' };
  if (!s(a.client) && !s(a.project) && !s(a.lead)) return { ok: false, reason: 'need_holder' };
  const bytes = f.dataUrl ? Uint8Array.from(atob(f.dataUrl.split(',')[1] ?? ''), (c) => c.charCodeAt(0)) : new TextEncoder().encode(f.text ?? '');
  let file: { name: string; size: number; mime: string; path?: string; dataUrl?: string } | null;
  if (isLive()) {
    const { gateway } = await import('@/platform/gateway');
    const out = await gateway().files.upload(new File([bytes as BlobPart], f.name, { type: f.mime }), { clientId: s(a.client) || undefined, jobId: s(a.project) || undefined, folder: s(a.folder) || undefined });
    file = out.ok ? out.data : null;
  } else file = { name: f.name, size: bytes.length, mime: f.mime, dataUrl: f.dataUrl ?? `data:${f.mime};base64,${b64(bytes)}` };
  if (!file) return { ok: false, reason: 'upload_failed' };
  return act(addUpload, { file: file as never, title: s(a.title) || f.name, clientId: s(a.client) || undefined, jobId: s(a.project) || undefined, leadId: s(a.lead) || undefined, folder: s(a.folder) || undefined });
}

/** Why something could not be done, in words a person reads (English, Spanish). */
const WHY: Record<string, [string, string]> = {
  invoice_not_found: ['I could not find that invoice number.', 'No encontré ese número de factura.'],
  not_a_draft: ['Only a draft invoice can be deleted. A sent one is voided on the Invoices screen.', 'Solo se puede eliminar una factura en borrador. Una enviada se anula en la pantalla de Facturas.'],
  invalid_amount: ['That amount is more than the balance, or not a real amount.', 'Ese monto es mayor que el saldo, o no es válido.'],
  not_open: ['That invoice is already paid or void.', 'Esa factura ya está pagada o anulada.'],
  invalid_ref: ['A reference is a check number or similar, never an account number.', 'Una referencia es un número de cheque o similar, nunca un número de cuenta.'],
  live_only: ['This works in the company workspace, not in the sample.', 'Esto funciona en el espacio de la empresa, no en la muestra.'],
  place_boxes: ['The document is ready, but its signature boxes need to be placed by hand. Open the request to place them and send.', 'El documento está listo, pero las casillas de firma deben colocarse a mano. Abra la solicitud para colocarlas y enviar.'],
  not_pdf: ['Only a PDF can be sent for signature.', 'Solo se puede enviar un PDF para firma.'],
  no_signers: ['The request needs a signer with a name and an email.', 'La solicitud necesita un firmante con nombre y correo.'],
  bad_signer: ['A signer is missing a name or a valid email.', 'A un firmante le falta el nombre o un correo válido.'],
  template_unapproved: ['The template of this document is not approved yet.', 'La plantilla de este documento aún no está aprobada.'],
  consent_unapproved: ['The e-sign consent text is not approved yet (E-sign settings).', 'El texto de consentimiento de firma aún no está aprobado (ajustes de firma).'],
  placeholders: ['The document still has blanks to fill in.', 'El documento todavía tiene espacios por completar.'],
  delivery_not_configured: ['Email sending is not set up for this workspace.', 'El envío de correos no está configurado en este espacio.'],
  already_out: ['That document already has a request out for signature.', 'Ese documento ya tiene una solicitud de firma enviada.'],
  many_match: ['More than one entry matches. Say the amount and the date.', 'Hay más de una entrada que coincide. Indique el monto y la fecha.'],
  no_match: ['No entry matches that amount and date.', 'Ninguna entrada coincide con ese monto y fecha.'],
  no_tier: ['That service has no price option with that name.', 'Ese servicio no tiene una opción de precio con ese nombre.'],
  need_name: ['The appointment type needs a name.', 'El tipo de cita necesita un nombre.'],
  no_file: ['Attach the file to this chat first, then ask me to save it.', 'Primero adjunte el archivo a este chat y luego pídame que lo guarde.'],
  need_holder: ['Say which client, project or lead the file belongs to.', 'Indique a qué cliente, proyecto o prospecto pertenece el archivo.'],
  upload_failed: ['The file could not be stored. Please try again.', 'No se pudo guardar el archivo. Inténtelo de nuevo.'],
  locked: ['That day of petty cash is already closed.', 'Ese día de caja chica ya está cerrado.'],
  not_allowed: ['Your role does not include this.', 'Su función no incluye esto.'],
};

export const SPEC_BY_ID = new Map(SPECS.map((x) => [x.id, x]));

/** The entries this person may use here: their role, their edition. */
export function specsFor(env: Env): Spec[] {
  return SPECS.filter((x) => env.can(x.perm) && (!x.when || x.when(env)));
}

/** The index the model reads: one line per entry, "id(param*, param): what it does [confirm]". */
export function actionIndex(env: Env): string {
  return specsFor(env).map((x) => {
    const ps = Object.entries(x.params).map(([k, p]) => {
      const kind = p.t === 'ref' ? `${p.of} id` : p.t === 'enum' ? (typeof p.of === 'function' ? p.of(env) : p.of).join('|') : p.t === 'list' ? `list of ${p.of.join('|')}` : p.t;
      return `${k}${p.req ? '*' : ''}: ${kind}`;
    }).join(', ');
    return `${x.id}(${ps}): ${x.en}${(typeof x.risky === 'function' ? false : x.risky) ? ' [confirm]' : ''}`;
  }).join('\n');
}

export const isRiskyAction = (x: Spec, a: Args) => (typeof x.risky === 'function' ? x.risky(a) : x.risky);

/** A record of a collection, as the database holds it here. */
export function recordOf(data: DemoState, coll: CollectionName, id: string): Record<string, unknown> | undefined {
  const list = (data as unknown as Record<string, unknown[]>)[COLLECTIONS[coll]] ?? [];
  return list.find((r) => (r as { id?: string }).id === id) as Record<string, unknown> | undefined;
}

/** How a record is named on a card. */
export function nameOf(data: DemoState, coll: CollectionName, id: string): string | undefined {
  const r = recordOf(data, coll, id); if (!r) return undefined;
  if (coll === 'appointments') {
    const who = data.clients.find((c) => c.id === r.clientId)?.name ?? data.leads.find((l) => l.id === r.leadId)?.name ?? '';
    return `${who} ${String(r.date ?? '')} ${String(r.time ?? '')}`.trim();
  }
  if (coll === 'messages') return String(r.subject || r.body || '').slice(0, 60);
  if (coll === 'reviews') return data.clients.find((c) => c.id === r.clientId)?.name;
  if (coll === 'opportunities') return `${data.clients.find((c) => c.id === r.clientId)?.name ?? ''} · ${data.catalog.find((x) => x.id === r.serviceId)?.name ?? ''}`;
  if (coll === 'passes') return `${data.clients.find((c) => c.id === r.clientId)?.name ?? String(r.holder ?? '')} · ${String(r.kind ?? '')}`;
  const v0 = r.name ?? r.title ?? r.text ?? r.number;
  const v = v0 && typeof v0 === 'object' ? (v0 as Record<string, string>).en ?? Object.values(v0 as Record<string, string>)[0] : v0;
  return typeof v === 'string' ? maskTaxIds(v).slice(0, 80) : undefined;
}

/**
 * Checks the model's arguments against an entry. Answers the clean arguments, or the reason they cannot be used
 * (in the person's language): a missing value, a record that is not there, a value outside the list.
 */
export function cleanArgs(x: Spec, raw: unknown, env: Env): Args | string {
  const es = env.lang === 'es';
  const a: Args = {}; const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {};
  for (const [k, p] of Object.entries(x.params)) {
    let v = input[k];
    if (v === undefined || v === null || v === '') { if (p.req) return es ? `Falta un dato: ${k}.` : `Missing a value: ${k}.`; continue; }
    switch (p.t) {
      case 'text': { if (typeof v !== 'string') v = String(v); const t = (v as string).trim().slice(0, p.max ?? 400); if (!t && p.req) return es ? `Falta un dato: ${k}.` : `Missing a value: ${k}.`; a[k] = t; break; }
      case 'number': { const num = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, '')); if (!isFinite(num) || (p.min !== undefined && num < p.min)) return es ? `El valor de ${k} no es válido.` : `${k} is not a valid number.`; a[k] = num; break; }
      case 'bool': a[k] = v === true || v === 'true'; break;
      case 'date': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return es ? `La fecha de ${k} no es válida.` : `${k} is not a valid date.`; a[k] = v; break;
      case 'time': if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return es ? `La hora de ${k} no es válida.` : `${k} is not a valid time.`; a[k] = v; break;
      case 'datetime': if (typeof v !== 'string' || isNaN(Date.parse(v))) return es ? `La fecha de ${k} no es válida.` : `${k} is not a valid date and time.`; a[k] = new Date(v).toISOString(); break;
      case 'enum': { const of = typeof p.of === 'function' ? p.of(env) : p.of; if (!of.includes(String(v))) return es ? `${k} debe ser uno de: ${of.join(', ')}.` : `${k} must be one of: ${of.join(', ')}.`; a[k] = String(v); break; }
      case 'list': { const list = (Array.isArray(v) ? v : [v]).map(String).filter((y) => p.of.includes(y)); if (!list.length) return es ? `${k} debe ser: ${p.of.join(', ')}.` : `${k} must be: ${p.of.join(', ')}.`; a[k] = [...new Set(list)]; break; }
      case 'ref': {
        const id = String(v);
        const there = p.of === 'users' ? env.data.users.some((u) => u.id === id.replace(/^u:/, '')) : !!recordOf(env.data, p.of, id);
        if (!there) return es ? `No encontré ese registro (${k}).` : `I could not find that record (${k}).`;
        a[k] = p.of === 'users' ? id.replace(/^u:/, '') : id; break;
      }
    }
  }
  if (x.id === 'client_merge' && a.keep === a.drop) return es ? 'Elija dos clientes distintos.' : 'Pick two different clients.';
  if (x.id === 'project_update' && !Object.keys(a).some((k) => k !== 'project')) return es ? 'Diga qué cambiar del proyecto.' : 'Say what to change on the project.';
  if (x.id === 'lead_handoff' && !STAFF(env).includes(String(a.to_user))) return es ? 'Esa persona no está activa.' : 'That person is not active.';
  return a;
}

/** The card a person sees before it is done: the entry's name, then each value with records named. */
export function actionRows(x: Spec, a: Args, env: Env): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, p] of Object.entries(x.params)) {
    const v = a[k]; if (v === undefined) continue;
    const label = k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    let shown: string;
    if (p.t === 'ref') shown = (p.of === 'users' ? env.data.users.find((u) => u.id === v)?.name : p.of === 'workers' ? env.data.workers.find((w) => w.id === v)?.name : nameOf(env.data, p.of, String(v))) ?? String(v);
    else if (p.t === 'number' && /amount|price/.test(k)) shown = money2(Number(v));
    else if (p.t === 'date') shown = env.date(String(v));
    else if (p.t === 'bool') shown = v ? (env.lang === 'es' ? 'Sí' : 'Yes') : 'No';
    else if (p.t === 'list') shown = (v as string[]).join(', ');
    else if (p.t === 'enum' && k === 'status' && x.section === 'projects') shown = env.t('st_' + String(v));
    else shown = String(v);
    out.push([label, shown.length > 300 ? shown.slice(0, 300) + '…' : shown]);
  }
  return out;
}

/** Carries out an entry, then reads back that it worked. */
export async function runAction(x: Spec, a: Args, env: Env): Promise<{ ok: boolean; why?: string; link?: string }> {
  if (!env.can(x.perm)) return { ok: false, why: env.lang === 'es' ? 'Su función no incluye esto.' : 'Your role does not include this.' };
  let r: unknown;
  try { r = await x.run(a, { ...env, data: snapshot() }); } catch { return { ok: false }; }
  if (r === null || r === false) return { ok: false };
  if (r && typeof r === 'object' && 'ok' in r && (r as { ok: unknown }).ok === false) {
    const reason = String((r as { reason?: unknown }).reason ?? '');
    return { ok: false, why: reason ? (WHY[reason]?.[env.lang === 'es' ? 1 : 0] ?? reason.replace(/_/g, ' ')) : undefined, link: (r as { link?: string }).link };
  }
  const inner = r && typeof r === 'object' && 'ok' in r ? ((r as Record<string, unknown>).value ?? (r as Record<string, unknown>).appointment ?? r) : r;
  return { ok: true, link: x.link?.(a, inner) };
}

/** find_records: the records of one collection whose name matches, with the fields a person would read (never a tax ID, an account number or a secret). */
export function findRecords(env: Env, coll: string, query: string, limit = 10): unknown {
  if (!(coll in COLLECTIONS)) return { error: 'unknown collection', collections: Object.keys(COLLECTIONS) };
  const c = coll as CollectionName;
  const perm: Partial<Record<CollectionName, Permission>> = { leads: 'leads', clients: 'clients', projects: 'jobs', tasks: 'tasks', appointments: 'appointments', documents: 'documents', envelopes: 'esign', posts: 'social', opportunities: 'opportunities', deadlines: 'deadlines', services: 'catalog', messages: 'comms', reviews: 'reviews', workers: 'team', appointment_types: 'appointments', pass_plans: 'money', passes: 'money', offices: 'cash' };
  const need = perm[c]; if (need && !env.can(need)) return { error: 'not allowed' };
  const list = ((env.data as unknown as Record<string, unknown[]>)[COLLECTIONS[c]] ?? []) as Record<string, unknown>[];
  const q = query.trim().toLowerCase();
  const hits = list.filter((r) => !q || (nameOf(env.data, c, String(r.id)) ?? '').toLowerCase().includes(q) || JSON.stringify(pick(r)).toLowerCase().includes(q)).slice(0, Math.min(25, Math.max(1, limit)));
  return { collection: c, count: hits.length, records: hits.map((r) => ({ id: r.id, name: nameOf(env.data, c, String(r.id)), ...pick(r) })) };
}
const KEEP = ['status', 'stage', 'date', 'time', 'due', 'start', 'end', 'price', 'value', 'kind', 'channel', 'clientId', 'jobId', 'leadId', 'assignee', 'number', 'created', 'scheduledFor', 'active', 'trade', 'role', 'type'];
function pick(r: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const k of KEEP) if (r[k] !== undefined && r[k] !== '' && (typeof r[k] !== 'object' || r[k] === null)) o[k] = typeof r[k] === 'string' ? maskTaxIds(String(r[k])).slice(0, 120) : r[k];
  return o;
}
