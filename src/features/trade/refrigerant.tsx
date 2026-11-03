// Refrigerant log (EPA Section 608 recordkeeping): every pound added or recovered, by job, technician, refrigerant and
// cylinder, with leaks that are still open. Totals for the month and for each refrigerant.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { LuPlus } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { addDays } from '@/lib/dates';
import { Badge, Button, Card, FormModal, Stat, toast } from '@/ui';
import { Head, daysTo, useTrade } from './common';

const lb = (n: number) => (Math.round(n * 100) / 100).toString();

export default function RefrigerantPage({ tabs, section }: PageProps & { tabs?: ReactNode; section?: string }) {
  const { s, set, tx, data, job, client, worker, date, can, taskAll, isDone } = useTrade();
  const [adding, setAdding] = useState(false);
  const recent = s.refrigerant.filter((r) => (daysTo(r.date) ?? -999) >= -90);
  const added = recent.reduce((n, r) => n + r.added, 0);
  const recovered = recent.reduce((n, r) => n + r.recovered, 0);
  const leaks = s.refrigerant.filter((r) => r.leak === 'found_open');
  const gases = [...new Set(s.refrigerant.map((r) => r.gas))];
  const techs = data.workers.filter((w) => w.payType === 'hourly');
  const repairAll = (list = leaks) => {
    taskAll(list, (r) => 'leak:' + r.id, (r) => [tx(`Leak recheck and repair at ${client(r.clientId)?.name ?? ''}, then log the refrigerant`, `Revisar y reparar la fuga en ${client(r.clientId)?.name ?? ''} y registrar el refrigerante`), { clientId: r.clientId, jobId: r.jobId, type: 'refrigerant', due: 2, pri: 'high' }],
      (n) => (n === 1 ? tx('1 leak repair booked', '1 reparación de fuga agendada') : tx(`${n} leak repairs booked`, `${n} reparaciones de fugas agendadas`)));
  };
  return (
    <div className="trade">
      <Head tabs={tabs} title={section ?? tx('Refrigerant log', 'Registro de refrigerante')} sub={tx('EPA 608 records: every pound added or recovered, and every open leak.', 'Registros EPA 608: cada libra agregada o recuperada y cada fuga abierta.')}
        auto={() => repairAll()} autoLabel={tx('Book all leak repairs', 'Agendar reparaciones de fugas')} autoCount={leaks.filter((r) => !isDone('leak:' + r.id)).length}
        more={can('write') ? <Button icon={<LuPlus aria-hidden="true" />} onClick={() => setAdding(true)} data-testid="ref-add">{tx('Log refrigerant', 'Registrar refrigerante')}</Button> : undefined} />
      <div className="kpis">
        <Stat label={tx('Added, last 90 days', 'Agregado, últimos 90 días')} value={`${lb(added)} lb`} hint={gases.map((g) => `${g}: ${lb(recent.filter((r) => r.gas === g).reduce((n, r) => n + r.added, 0))} lb`).join(' · ')} />
        <Stat label={tx('Recovered, last 90 days', 'Recuperado, últimos 90 días')} value={`${lb(recovered)} lb`} hint={tx('Sent for reclaim with the cylinders', 'Se envía a recuperación con los cilindros')} />
        <Stat label={tx('Open leaks', 'Fugas abiertas')} value={String(leaks.length)} hint={leaks.length ? tx('Recheck and repair', 'Revisar y reparar') : tx('None open', 'Ninguna abierta')} attention={leaks.length > 0} />
        <Stat label={tx('Entries', 'Registros')} value={String(s.refrigerant.length)} hint={tx('Kept with each job', 'Guardados con cada trabajo')} />
      </div>
      <Card flush>
        <div className="table-wrap"><table className="tbl stackable" data-testid="ref-table">
          <thead><tr><th>{tx('Date', 'Fecha')}</th><th>{tx('Job / client', 'Trabajo / cliente')}</th><th>{tx('Technician', 'Técnico')}</th><th>{tx('Refrigerant', 'Refrigerante')}</th><th className="num">{tx('Added', 'Agregado')}</th><th className="num">{tx('Recovered', 'Recuperado')}</th><th>{tx('Cylinder', 'Cilindro')}</th><th>{tx('Leak check', 'Revisión de fugas')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
          <tbody>{[...s.refrigerant].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
            <tr key={r.id}>
              <td>{date(r.date)}</td>
              <td className="t1">{r.jobId && job(r.jobId) ? <A to={'/jobs/' + r.jobId}>{job(r.jobId)?.name}</A> : ''}<div className="xs dim">{client(r.clientId)?.name}</div>{r.note && <div className="xs">{r.note}</div>}</td>
              <td data-label={tx('Technician', 'Técnico')}>{worker(r.workerId)?.name}</td>
              <td data-label={tx('Refrigerant', 'Refrigerante')}><Badge tone="info">{r.gas}</Badge></td>
              <td className="num" data-label={tx('Added', 'Agregado')}>{lb(r.added)} lb</td>
              <td className="num" data-label={tx('Recovered', 'Recuperado')}>{lb(r.recovered)} lb</td>
              <td data-label={tx('Cylinder', 'Cilindro')} className="mono xs">{r.cylinder || '·'}</td>
              <td data-label={tx('Leak check', 'Revisión de fugas')}><Badge tone={r.leak === 'none' ? 'ok' : r.leak === 'found_repaired' ? 'info' : 'bad'}>{r.leak === 'none' ? tx('No leak', 'Sin fuga') : r.leak === 'found_repaired' ? tx('Found, repaired', 'Encontrada, reparada') : tx('Found, open', 'Encontrada, abierta')}</Badge></td>
              <td className="num">{r.leak === 'found_open' && (isDone('leak:' + r.id) ? <Badge tone="warn">{tx('Repair booked', 'Reparación agendada')}</Badge> : <Button size="sm" variant="primary" onClick={() => repairAll([r])}>{tx('Book repair', 'Agendar reparación')}</Button>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      {adding && <FormModal title={tx('Log refrigerant', 'Registrar refrigerante')} saveLabel={tx('Save', 'Guardar')} cancelLabel={tx('Cancel', 'Cancelar')} requiredMsg={tx('Fill in the required fields.', 'Complete los campos obligatorios.')}
        initial={{ date: addDays(0), gas: 'R-410A', workerId: techs[0]?.id, jobId: data.jobs[0]?.id, added: 0, recovered: 0, leak: 'none' }}
        fields={[
          { k: 'date', label: tx('Date', 'Fecha'), type: 'date', req: true },
          { k: 'jobId', label: tx('Job', 'Trabajo'), type: 'select', req: true, options: data.jobs.map((j) => [j.id, j.name]) },
          { k: 'workerId', label: tx('Technician', 'Técnico'), type: 'select', req: true, options: techs.map((w) => [w.id, w.name]) },
          { k: 'gas', label: tx('Refrigerant', 'Refrigerante'), type: 'select', req: true, options: ['R-410A', 'R-454B', 'R-32', 'R-22', 'R-407C', 'R-404A'].map((g) => [g, g]) },
          { k: 'added', label: tx('Pounds added', 'Libras agregadas'), type: 'number' }, { k: 'recovered', label: tx('Pounds recovered', 'Libras recuperadas'), type: 'number' },
          { k: 'cylinder', label: tx('Cylinder', 'Cilindro'), placeholder: 'CYL-0000' },
          { k: 'leak', label: tx('Leak check', 'Revisión de fugas'), type: 'select', options: [['none', tx('No leak', 'Sin fuga')], ['found_repaired', tx('Found, repaired', 'Encontrada, reparada')], ['found_open', tx('Found, open', 'Encontrada, abierta')]] },
          { k: 'note', label: tx('Note', 'Nota'), type: 'textarea' },
        ]}
        onSave={(v) => { const j = job(v.jobId); set((st) => ({ ...st, refrigerant: [{ id: 'r' + Date.now(), date: v.date, jobId: v.jobId, clientId: j?.clientId ?? '', workerId: v.workerId, gas: v.gas, added: v.added ?? 0, recovered: v.recovered ?? 0, cylinder: v.cylinder, leak: v.leak, note: v.note }, ...st.refrigerant] })); toast(tx('Refrigerant logged', 'Refrigerante registrado')); }}
        onClose={() => setAdding(false)} />}
    </div>
  );
}
