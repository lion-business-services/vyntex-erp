// Carries out a confirmed proposal through the same business actions the rest of the app uses,
// then reads the data back to make sure the change is really there before reporting it.
import { act, getSnapshot } from '@/store/store';
import { addClientPayment, addNote, bookAppointment, createJob, createLead, createTask, requestReview, saveClient, setJobStatus, setLeadStage, setTaskStatus, updateLead, updateTask } from '@/domain/actions';
import { isLive } from '@/platform/session';
import { addDaysFrom, today } from '@/lib/dates';
import { byId, jobMoney } from '@/domain/selectors';
import { money2 } from '@/lib/money';
import { effectiveRules, shippedRules } from '@/domain/rules/engine';
import { runRuleName } from '@/features/automations/format';
import { check, projectClient, type Env, type Proposal } from './engine';
import { SPEC_BY_ID, bindStore, runAction } from './actions';

bindStore(act, () => getSnapshot().data);

export interface Outcome { ok: boolean; text: string; link?: { label: string; to: string }; /** Names of the automation rules that ran because of the change. */ rules?: string[] }

export function execute(p: Proposal, env: Env): Outcome {
  const { t } = env;
  const blocked = check(p, env);
  if (blocked) return { ok: false, text: t('asst.state.failed', { why: blocked }) };
  const seen = new Set(getSnapshot().data.automation.runs.map((r) => r.id));
  const failed: Outcome = { ok: false, text: t('asst.state.failed', { why: t('asst.failed.generic') }) };
  let out: Outcome = failed;
  try {
    switch (p.kind) {
      case 'task': {
        const task = act(createTask, { title: p.title, due: p.due, assignee: p.assignee, pri: 'medium' });
        if (byId(getSnapshot().data.tasks, task.id)) out = { ok: true, text: t('asst.done.task'), link: { label: t('asst.open.task'), to: `/tasks?task=${task.id}` } };
        break;
      }
      case 'lead': {
        const lead = act(createLead, { name: p.name, phone: p.phone, email: '', address: '', type: p.type, source: 'other', pri: 'medium', ownerId: env.actor, value: null });
        if (byId(getSnapshot().data.leads, lead.id)) out = { ok: true, text: t('asst.done.lead'), link: { label: t('asst.open.lead'), to: `/leads/${lead.id}` } };
        break;
      }
      case 'note': {
        const holder = () => { const d = getSnapshot().data; return p.ref.type === 'lead' ? byId(d.leads, p.ref.id) : p.ref.type === 'client' ? byId(d.clients, p.ref.id) : byId(d.jobs, p.ref.id); };
        const before = holder()?.notes.length ?? 0;
        act(addNote, p.ref, 'note', p.text);
        const now = holder();
        if (now && now.notes.length === before + 1) out = { ok: true, text: t('asst.done.note', { name: now.name }), link: { label: t('asst.open.record'), to: p.ref.type === 'lead' ? `/leads/${p.ref.id}` : p.ref.type === 'client' ? `/clients/${p.ref.id}` : `/jobs/${p.ref.id}` } };
        break;
      }
      case 'taskDone': {
        act(setTaskStatus, p.taskId, 'done');
        const task = byId(getSnapshot().data.tasks, p.taskId);
        if (task?.status === 'done') out = { ok: true, text: t('asst.done.taskDone'), link: { label: t('asst.open.task'), to: `/tasks?task=${task.id}` } };
        break;
      }
      case 'jobStatus': {
        act(setJobStatus, p.jobId, p.status);
        const job = byId(getSnapshot().data.jobs, p.jobId);
        if (job?.status === p.status) out = { ok: true, text: t('asst.done.jobStatus', { name: job.name, status: t('st_' + job.status) }), link: { label: t('asst.open.job'), to: `/jobs/${job.id}` } };
        break;
      }
      case 'payment': {
        if (p.approve && byId(getSnapshot().data.jobs, p.jobId)?.status === 'estimate') act(setJobStatus, p.jobId, 'contract');
        const before = byId(getSnapshot().data.jobs, p.jobId)?.received.length ?? 0;
        act(addClientPayment, p.jobId, { amount: p.amount, date: p.date, method: p.method, ref: '' });
        const d = getSnapshot().data; const job = byId(d.jobs, p.jobId);
        if (job && job.received.length === before + 1) out = { ok: true, text: t('asst.done.payment', { amount: money2(p.amount), name: job.name, balance: money2(Math.max(0, jobMoney(d, job).clientOwes)) }), link: { label: t('asst.open.job'), to: `/jobs/${job.id}` } };
        break;
      }
      case 'visit': {
        act(updateLead, p.leadId, { apptDate: p.date, apptTime: p.time });
        const lead = byId(getSnapshot().data.leads, p.leadId);
        if (lead && lead.apptDate === p.date) out = { ok: true, text: t('asst.done.visit', { name: lead.name, date: env.day(p.date) + (p.time ? `, ${env.time(p.time)}` : '') }), link: { label: t('asst.open.lead'), to: `/leads/${lead.id}` } };
        break;
      }
      case 'appointment': {
        const res = act(bookAppointment, { typeId: p.typeId, staffId: p.staffId, date: p.date, time: p.time, ...(p.clientId ? { clientId: p.clientId } : {}), ...(p.leadId ? { leadId: p.leadId } : {}) });
        // the calendar has the last word: a time that is taken or already past is refused there, and said here
        if (!res.ok) { const key = 'asst.appt.' + res.reason; return { ok: false, text: t('asst.state.failed', { why: t(key) === key ? t('asst.appt.invalid') : t(key) }) }; }
        const a = res.appointment; const d = getSnapshot().data;
        const who = (a.clientId ? byId(d.clients, a.clientId)?.name : byId(d.leads, a.leadId)?.name) ?? '';
        if (d.appointments.some((x) => x.id === a.id)) out = { ok: true, text: t(a.status === 'awaiting_payment' ? 'asst.done.apptPay' : 'asst.done.appt', { name: who, date: `${env.day(a.date)}, ${env.time(a.time)}` }), link: { label: t('asst.open.appt'), to: `/appointments/${a.id}` } };
        break;
      }
      case 'review': {
        const res = act(requestReview, { clientId: p.clientId, ...(p.jobId ? { jobId: p.jobId } : {}), channel: p.channel });
        if (!res.ok) return { ok: false, text: t('asst.state.failed', { why: t('reviews.problem.' + res.reason) }) };
        const d = getSnapshot().data;
        if ((d.reviews ?? []).some((x) => x.id === res.review.id)) out = { ok: true, text: t('asst.done.review', { name: byId(d.clients, p.clientId)?.name ?? '' }), link: { label: t('asst.open.reviews'), to: '/reviews' } };
        break;
      }
      case 'client': {
        const c = act(saveClient, { name: p.name, ...(p.phone ? { phone: p.phone } : {}), ...(p.email ? { email: p.email } : {}) });
        if (byId(getSnapshot().data.clients, c.id)) out = { ok: true, text: t('asst.done.client', { name: c.name }), link: { label: t('asst.open.record'), to: `/clients/${c.id}` } };
        break;
      }
      case 'job': {
        const c = projectClient(p, getSnapshot().data); if (!c) break;
        const job = act(createJob, { name: p.name, clientId: c.id, ...(p.start ? { start: p.start } : {}), ...(p.price !== undefined ? { price: p.price } : {}) });
        if (byId(getSnapshot().data.jobs, job.id)) out = { ok: true, text: t('asst.done.job', { name: job.name, client: c.name }), link: { label: t('asst.open.job'), to: `/jobs/${job.id}` } };
        break;
      }
      case 'leadUpdate': {
        if (p.value !== undefined || p.followUp) act(updateLead, p.leadId, { ...(p.value !== undefined ? { value: p.value } : {}), ...(p.followUp ? { followUp: p.followUp } : {}) });
        if (p.stage) act(setLeadStage, p.leadId, p.stage);
        const lead = byId(getSnapshot().data.leads, p.leadId);
        if (lead && (!p.stage || lead.status === p.stage)) out = { ok: true, text: t('asst.done.leadUpdate', { name: lead.name }), link: { label: t('asst.open.lead'), to: `/leads/${lead.id}` } };
        break;
      }
      case 'taskUpdate': {
        act(updateTask, p.taskId, { ...(p.title ? { title: p.title } : {}), ...(p.due ? { due: p.due } : {}), ...(p.assignee ? { assignee: p.assignee } : {}) });
        const task = byId(getSnapshot().data.tasks, p.taskId);
        if (task && (!p.due || task.due === p.due)) out = { ok: true, text: t('asst.done.taskUpdate', { name: task.title }), link: { label: t('asst.open.task'), to: `/tasks?task=${task.id}` } };
        break;
      }
      case 'invoice': return { ok: false, text: t('asst.state.failed', { why: t('asst.failed.generic') }) }; // made by executeAsync
      case 'action': return failed; // made by executeAsync
    }
  } catch {
    return failed;
  }
  if (out.ok) {
    // every automation that ran because of the change, by the name the Automations screen gives it
    const d = getSnapshot().data;
    const ran = d.automation.runs.filter((r) => !seen.has(r.id) && r.status !== 'skipped').map((r) => runRuleName(r.ruleId, effectiveRules(d, env.pack), shippedRules(env.pack), t, env.lang));
    if (ran.length) out.rules = [...new Set(ran)];
  }
  return out;
}

/**
 * The same, for actions that go to the server: a draft invoice (live workspaces only; a sample workspace has no
 * invoices). Everything else is carried out by execute().
 */
export async function executeAsync(p: Proposal, env: Env): Promise<Outcome> {
  if (p.kind === 'action') {
    // 0097: any entry of the catalog; some go to the server (invoices, e-sign, files)
    const { t } = env;
    const blocked = check(p, env);
    if (blocked) return { ok: false, text: t('asst.state.failed', { why: blocked }) };
    const x = SPEC_BY_ID.get(p.action); if (!x) return { ok: false, text: t('asst.state.failed', { why: t('asst.failed.generic') }) };
    const r = await runAction(x, p.args, env);
    const link = r.link ? { link: { label: t('asst.open.record'), to: r.link } } : {};
    return r.ok ? { ok: true, text: t('asst.action.done', { what: env.lang === 'es' ? x.es : x.en }), ...link } : { ok: false, text: t('asst.state.failed', { why: r.why ?? t('asst.failed.generic') }), ...link };
  }
  if (p.kind !== 'invoice') return execute(p, env);
  const { t } = env;
  const blocked = check(p, env);
  if (blocked) return { ok: false, text: t('asst.state.failed', { why: blocked }) };
  if (!isLive()) return { ok: false, text: t('asst.state.failed', { why: t('asst.invoice.liveOnly') }) };
  try {
    const { rpc } = await import('@/platform/live/ops');
    const issue = today();
    const a = await rpc<{ id: string; number?: string }>('invoice_save', { p_invoice: { jobId: p.jobId, issueDate: issue, dueDate: p.due ?? addDaysFrom(issue, 15), lang: env.lang === 'es' ? 'es' : 'en',
      lines: p.lines.map((l) => ({ text: l.description, qty: l.qty, unitCents: Math.round(l.price * 100) })), feePct: 0, notes: '', sendTo: '' } });
    if (!a.ok) return { ok: false, text: t('asst.state.failed', { why: t('asst.failed.generic') }) };
    const inv = a.data.result;
    return { ok: true, text: t('asst.done.invoice', { n: inv?.number ?? '' }), link: { label: t('asst.open.invoices'), to: '/invoices' } };
  } catch { return { ok: false, text: t('asst.state.failed', { why: t('asst.failed.generic') }) }; }
}
