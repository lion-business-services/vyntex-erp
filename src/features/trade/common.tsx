// What every trade section shares: the records of the edition on screen, the two-language wording, the person and job
// names, the demo note, and the actions that reach the real workspace data (a task, a lead).
import type { ReactNode } from 'react';
import { useApp } from '@/app/hooks';
import { act } from '@/store/store';
import { createTask } from '@/domain/actions/tasks';
import { createLead } from '@/domain/actions/leads';
import { addDays, today } from '@/lib/dates';
import type { Priority } from '@/domain/types';
import { Note, toast } from '@/ui';
import { sampleFor, tradeState, updateTrade, useTradeVersion, type TradeState } from './store';
import './trade.css';

export function useTrade() {
  const app = useApp();
  const { data, pack, lang } = app;
  useTradeVersion();
  const s = tradeState(pack.id, lang, () => sampleFor(pack.id, lang, data));
  const es = lang === 'es';
  const tx = (en: string, spanish: string) => (es ? spanish : en);
  const set = (change: (s: TradeState) => TradeState) => updateTrade(pack.id, lang, change);
  const client = (id?: string) => data.clients.find((c) => c.id === id);
  const worker = (id?: string) => data.workers.find((w) => w.id === id);
  const job = (id?: string) => data.jobs.find((j) => j.id === id);
  const owner = data.users.find((u) => u.role === 'manager')?.id ?? data.users[0]?.id ?? 'u1';
  /** A real task in the workspace, like one made on the Tasks page. */
  const task = (title: string, o: { clientId?: string; jobId?: string; due?: number; pri?: Priority; type?: string; who?: string } = {}) => {
    try {
      act(createTask, { title, assignee: o.who ?? 'u:' + owner, pri: o.pri ?? 'medium', due: addDays(o.due ?? 0), ...(o.clientId ? { clientId: o.clientId } : {}), ...(o.jobId ? { jobId: o.jobId } : {}), ...(o.type && pack.taskTypes.some((x) => x.id === o.type) ? { type: o.type } : {}) });
      toast(tx('Task added to Tasks', 'Tarea agregada a Tareas'));
    } catch { toast(tx('You cannot add tasks with this role', 'Con este rol no puede agregar tareas'), true); }
  };
  /** A real lead in the pipeline, linked to the client: the replacement or repair opportunity. */
  const lead = (clientId: string, type: string, value: number, note: string) => {
    const c = client(clientId); if (!c) return false;
    try {
      act(createLead, { name: c.name, ...(c.company ? { company: c.company } : {}), phone: c.phone, email: c.email, address: c.addresses?.[0] ?? '', type, source: pack.leadSources.some((x) => x.id === 'existing_client') ? 'existing_client' : 'other', pri: 'high', value, clientId, firstNote: note });
      toast(tx('Opportunity added to Leads', 'Oportunidad agregada a Prospectos'));
      return true;
    } catch { toast(tx('You cannot add leads with this role', 'Con este rol no puede agregar prospectos'), true); return false; }
  };
  return { ...app, s, set, tx, es, client, worker, job, task, lead, today: today() };
}

/** Days from today to a date (negative: in the past). */
export const daysTo = (iso?: string): number | undefined => {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number); const now = new Date(); const a = Date.UTC(y, m - 1, d); const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
};
export const ageYears = (iso?: string): number => { const n = daysTo(iso); return n === undefined ? 0 : Math.max(0, Math.floor(-n / 365)); };

export function DemoNote({ children }: { children?: ReactNode }) {
  const { tx } = useTrade();
  return <Note>{children ?? tx('Demo section: it works on the sample business. Tasks and leads it creates go into the workspace like any others.', 'Sección de demostración: funciona con el negocio de ejemplo. Las tareas y prospectos que crea entran al espacio de trabajo como cualquier otro.')}</Note>;
}
