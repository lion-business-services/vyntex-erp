// Permits & inspections: every permit of every job from filing to the final inspection, so no job is closed (or paid)
// before it passes. Booking an inspection puts a task on the list.
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { addDays } from '@/lib/dates';
import { Badge, Button, Card, PageHeader, Stat, toast } from '@/ui';
import type { Tone } from '@/ui';
import { DemoNote, daysTo, useTrade } from './common';
import type { Permit, PermitStatus } from './store';

const ORDER: PermitStatus[] = ['applied', 'approved', 'rough', 'final_booked', 'passed'];
const TONE: Record<PermitStatus, Tone> = { applied: 'neutral', approved: 'info', rough: 'violet', final_booked: 'warn', passed: 'ok', failed: 'bad' };

export default function PermitsPage(_: PageProps) {
  const { s, set, tx, job, client, date, task } = useTrade();
  const label: Record<PermitStatus, string> = { applied: tx('Filed, waiting on the town', 'Entregado, esperando al municipio'), approved: tx('Approved, posted on site', 'Aprobado, puesto en el sitio'), rough: tx('Rough inspection passed', 'Inspección preliminar aprobada'), final_booked: tx('Final inspection booked', 'Inspección final agendada'), passed: tx('Final passed, closed', 'Final aprobada, cerrado'), failed: tx('Failed, fix and rebook', 'Rechazada, corregir y reagendar') };
  const open = s.permits.filter((p) => p.status !== 'passed');
  const week = s.permits.filter((p) => { const n = daysTo(p.inspection); return p.status !== 'passed' && n !== undefined && n >= 0 && n <= 7; });
  const waiting = s.permits.filter((p) => p.status === 'applied');
  const patch = (id: string, q: Partial<Permit>) => set((st) => ({ ...st, permits: st.permits.map((x) => (x.id === id ? { ...x, ...q } : x)) }));
  const next = (p: Permit) => {
    const i = ORDER.indexOf(p.status); const n = p.status === 'failed' ? 'final_booked' : ORDER[Math.min(i + 1, ORDER.length - 1)];
    patch(p.id, { status: n, ...(n === 'final_booked' ? { inspection: addDays(3) } : {}) });
    if (n === 'final_booked') task(tx(`Final inspection for ${job(p.jobId)?.name ?? ''}: meet the inspector, permit card on site`, `Inspección final de ${job(p.jobId)?.name ?? ''}: recibir al inspector, permiso en el sitio`), { jobId: p.jobId, type: 'permit', due: 3, pri: 'high' });
    if (n === 'passed') toast(tx('Permit closed. The job can be invoiced in full.', 'Permiso cerrado. El trabajo se puede facturar completo.'));
  };
  const nextLabel = (p: Permit) => (p.status === 'applied' ? tx('Mark approved', 'Marcar aprobado') : p.status === 'approved' ? tx('Rough passed', 'Preliminar aprobada') : p.status === 'rough' ? tx('Book final', 'Agendar final') : p.status === 'final_booked' ? tx('Final passed', 'Final aprobada') : p.status === 'failed' ? tx('Rebook final', 'Reagendar final') : '');
  return (
    <div className="trade">
      <PageHeader title={tx('Permits & inspections', 'Permisos e inspecciones')} sub={tx('Every permit from filing to the final inspection. A job is not closed until its final passes.', 'Cada permiso desde que se entrega hasta la inspección final. Un trabajo no se cierra hasta que pasa la final.')} />
      <DemoNote />
      <div className="kpis">
        <Stat label={tx('Open permits', 'Permisos abiertos')} value={String(open.length)} hint={tx(`${s.permits.length} on file`, `${s.permits.length} en total`)} />
        <Stat label={tx('Inspections in 7 days', 'Inspecciones en 7 días')} value={String(week.length)} hint={tx('Someone on site with the permit card', 'Alguien en el sitio con el permiso')} attention={week.length > 0} />
        <Stat label={tx('Waiting on the town', 'Esperando al municipio')} value={String(waiting.length)} hint={tx('Call if it is more than 5 days', 'Llamar si pasan más de 5 días')} />
        <Stat label={tx('Closed', 'Cerrados')} value={String(s.permits.filter((p) => p.status === 'passed').length)} />
      </div>
      <Card flush>
        <div className="table-wrap"><table className="tbl stackable" data-testid="permits-table">
          <thead><tr><th>{tx('Job', 'Trabajo')}</th><th>{tx('Permit', 'Permiso')}</th><th>{tx('Town', 'Municipio')}</th><th>{tx('Progress', 'Avance')}</th><th>{tx('Inspection', 'Inspección')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
          <tbody>{s.permits.map((p) => { const j = job(p.jobId); const step = p.status === 'failed' ? 3 : ORDER.indexOf(p.status); return (
            <tr key={p.id} data-permit={p.id}>
              <td className="t1">{j ? <A to={'/jobs/' + j.id}>{j.name}</A> : ''}<div className="xs dim">{client(j?.clientId)?.name}</div></td>
              <td data-label={tx('Permit', 'Permiso')}><b>{p.kind}</b><div className="xs dim mono">{p.number}</div>{p.note && <div className="xs">{p.note}</div>}</td>
              <td data-label={tx('Town', 'Municipio')}>{p.town}<div className="xs dim">{tx('Filed', 'Entregado')} {date(p.applied)}</div></td>
              <td data-label={tx('Progress', 'Avance')}><div className="td-steps" aria-label={label[p.status]}>{ORDER.map((o, i) => <i key={o} className={i <= step ? (p.status === 'failed' && i === 3 ? 'bad' : 'on') : ''} />)}</div><Badge tone={TONE[p.status]}>{label[p.status]}</Badge></td>
              <td data-label={tx('Inspection', 'Inspección')}>{p.inspection ? date(p.inspection) : <span className="dim">{tx('Not booked', 'Sin agendar')}</span>}</td>
              <td className="num"><span className="row tight nowrap">
                {p.status !== 'passed' && <Button size="sm" variant={p.status === 'final_booked' ? 'primary' : 'default'} onClick={() => next(p)}>{nextLabel(p)}</Button>}
                {(p.status === 'final_booked' || p.status === 'rough') && <Button size="sm" variant="ghost" onClick={() => { patch(p.id, { status: 'failed' }); task(tx(`Inspection failed on ${j?.name ?? ''}: fix the correction list and rebook`, `Inspección rechazada en ${j?.name ?? ''}: corregir y reagendar`), { jobId: p.jobId, type: 'permit', due: 1, pri: 'high' }); }}>{tx('Failed', 'Rechazada')}</Button>}
              </span></td>
            </tr>
          ); })}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
