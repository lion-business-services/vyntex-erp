// Backflow devices: every device at every account with its test due date, last result and whether the report reached
// the water utility. Recording a test sets the next due date; a failed test becomes a repair task.
import { useState } from 'react';
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { addDays } from '@/lib/dates';
import { money } from '@/lib/money';
import { Badge, Button, Card, FormModal, PageHeader, Stat, cx, toast } from '@/ui';
import { DemoNote, daysTo, useTrade } from './common';
import type { Device } from './store';

export default function BackflowPage(_: PageProps) {
  const { s, set, tx, client, date, task, data } = useTrade();
  const [testing, setTesting] = useState<Device | null>(null);
  const due30 = s.devices.filter((d) => { const n = daysTo(d.due); return n !== undefined && n >= 0 && n <= 30; });
  const overdue = s.devices.filter((d) => (daysTo(d.due) ?? 0) < 0);
  const failed = s.devices.filter((d) => d.result === 'fail');
  const unfiled = s.devices.filter((d) => !d.filed && d.lastTest);
  const price = data.catalog.find((x) => x.category === 'backflow')?.tiers[0]?.price ?? 0;
  const patch = (id: string, p: Partial<Device>) => set((st) => ({ ...st, devices: st.devices.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const dueCell = (d: Device) => { const n = daysTo(d.due) ?? 0; return <span className={cx(n < 0 && 'neg', n >= 0 && n <= 30 && 'warn-t')}>{date(d.due)}{n < 0 ? ' · ' + tx(`${-n} days late`, `${-n} días tarde`) : n <= 30 ? ' · ' + tx(`in ${n} days`, `en ${n} días`) : ''}</span>; };
  return (
    <div className="trade">
      <PageHeader title={tx('Backflow devices', 'Dispositivos de reflujo')} sub={tx('Every device with its yearly test date, last result and the report to the water utility. Nothing is missed and every account renews.', 'Cada dispositivo con su fecha de prueba anual, el último resultado y el reporte a la compañía de agua. No se pasa ninguno y cada cuenta se renueva.')} />
      <DemoNote />
      <div className="kpis">
        <Stat label={tx('Devices tracked', 'Dispositivos registrados')} value={String(s.devices.length)} hint={price ? tx(`${new Set(s.devices.map((d) => d.clientId)).size} accounts · about ${money(s.devices.length * price)} a year`, `${new Set(s.devices.map((d) => d.clientId)).size} cuentas · unos ${money(s.devices.length * price)} al año`) : undefined} />
        <Stat label={tx('Tests due in 30 days', 'Pruebas en 30 días')} value={String(due30.length)} hint={tx('Book them now', 'Agendarlas ya')} attention={due30.length > 0} />
        <Stat label={tx('Overdue', 'Vencidas')} value={String(overdue.length)} hint={tx('The utility can shut off the water', 'La compañía puede cortar el agua')} attention={overdue.length > 0} />
        <Stat label={tx('Failed or report not filed', 'Rechazadas o sin reporte')} value={String(new Set([...failed, ...unfiled]).size)} hint={tx('Repair, retest, file', 'Reparar, volver a probar, entregar')} attention={failed.length + unfiled.length > 0} />
      </div>
      <Card flush>
        <div className="table-wrap"><table className="tbl stackable" data-testid="backflow-table">
          <thead><tr><th>{tx('Account', 'Cuenta')}</th><th>{tx('Device', 'Dispositivo')}</th><th>{tx('Serial', 'Serie')}</th><th>{tx('Last test', 'Última prueba')}</th><th>{tx('Next test due', 'Próxima prueba')}</th><th>{tx('Utility report', 'Reporte a la compañía')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
          <tbody>{[...s.devices].sort((a, b) => a.due.localeCompare(b.due)).map((d) => (
            <tr key={d.id} data-device={d.id}>
              <td className="t1"><A to={'/clients/' + d.clientId}>{client(d.clientId)?.name}</A><div className="xs dim">{d.location}</div></td>
              <td data-label={tx('Device', 'Dispositivo')}><b>{d.kind}</b> {d.size}<div className="xs dim">{d.kind === 'RPZ' ? tx('Reduced pressure zone', 'Zona de presión reducida') : d.kind === 'DCVA' ? tx('Double check valve', 'Doble retención') : tx('Pressure vacuum breaker', 'Rompedor de vacío')}</div></td>
              <td data-label={tx('Serial', 'Serie')} className="mono xs">{d.serial}</td>
              <td data-label={tx('Last test', 'Última prueba')}>{d.lastTest ? <>{date(d.lastTest)} <Badge tone={d.result === 'pass' ? 'ok' : 'bad'}>{d.result === 'pass' ? tx('Passed', 'Aprobada') : tx('Failed', 'Rechazada')}</Badge></> : ''}{d.readings && <div className="xs dim">{d.readings}</div>}</td>
              <td data-label={tx('Next test due', 'Próxima prueba')}>{dueCell(d)}</td>
              <td data-label={tx('Utility report', 'Reporte a la compañía')}>{d.filed ? <Badge tone="ok">{tx('Filed', 'Entregado')}</Badge> : d.lastTest ? <Badge tone="warn">{tx('Not filed', 'Sin entregar')}</Badge> : ''}</td>
              <td className="num"><span className="row tight nowrap">
                <Button size="sm" variant={(daysTo(d.due) ?? 99) <= 30 || d.result === 'fail' ? 'primary' : 'default'} onClick={() => setTesting(d)} data-testid="backflow-test">{tx('Record test', 'Registrar prueba')}</Button>
                {!d.filed && d.lastTest && d.result === 'pass' && <Button size="sm" onClick={() => { patch(d.id, { filed: true }); toast(tx('Marked as filed with the water utility', 'Marcado como entregado a la compañía de agua')); }}>{tx('Mark filed', 'Marcar entregado')}</Button>}
                {(daysTo(d.due) ?? 99) <= 30 && <Button size="sm" variant="ghost" onClick={() => task(tx(`Book the backflow test at ${client(d.clientId)?.name ?? ''} (${d.kind}, ${d.location})`, `Agendar la prueba de reflujo en ${client(d.clientId)?.name ?? ''} (${d.kind}, ${d.location})`), { clientId: d.clientId, type: 'backflow', due: 1 })}>{tx('Book test', 'Agendar prueba')}</Button>}
              </span></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      {testing && <FormModal title={tx(`Test result: ${testing.kind} ${testing.size}, ${client(testing.clientId)?.name ?? ''}`, `Resultado: ${testing.kind} ${testing.size}, ${client(testing.clientId)?.name ?? ''}`)} saveLabel={tx('Save result', 'Guardar resultado')} cancelLabel={tx('Cancel', 'Cancelar')} requiredMsg={tx('Pick the result.', 'Escoja el resultado.')}
        initial={{ result: 'pass', date: addDays(0) }}
        fields={[
          { k: 'date', label: tx('Tested on', 'Fecha de la prueba'), type: 'date', req: true },
          { k: 'result', label: tx('Result', 'Resultado'), type: 'select', req: true, options: [['pass', tx('Passed', 'Aprobada')], ['fail', tx('Failed', 'Rechazada')]] },
          { k: 'readings', label: tx('Readings', 'Lecturas'), type: 'textarea', placeholder: tx('Check 1 psid, check 2 psid, relief opening point', 'Retención 1 psid, retención 2 psid, punto de apertura del alivio') },
          { k: 'filed', label: tx('Report filed with the water utility', 'Reporte entregado a la compañía de agua'), type: 'checkbox' },
        ]}
        onSave={(v) => {
          const pass = v.result === 'pass';
          patch(testing.id, { lastTest: v.date, result: v.result, readings: v.readings || undefined, due: addDays(pass ? 365 : 10), filed: !!v.filed && pass });
          if (!pass) task(tx(`Backflow failed at ${client(testing.clientId)?.name ?? ''}: quote the rebuild kit, repair and retest within 10 days`, `Reflujo rechazado en ${client(testing.clientId)?.name ?? ''}: cotizar el kit, reparar y volver a probar en 10 días`), { clientId: testing.clientId, type: 'backflow', due: 1, pri: 'high' });
          else if (!v.filed) task(tx(`File the backflow report for ${client(testing.clientId)?.name ?? ''} with the water utility`, `Entregar el reporte de reflujo de ${client(testing.clientId)?.name ?? ''} a la compañía de agua`), { clientId: testing.clientId, type: 'backflow', due: 1, pri: 'high' });
          toast(pass ? tx('Passed. Next test due in a year.', 'Aprobada. La próxima prueba es en un año.') : tx('Failed. Repair task added, retest in 10 days.', 'Rechazada. Se agregó la tarea de reparación, volver a probar en 10 días.'), !pass);
        }}
        onClose={() => setTesting(null)} />}
    </div>
  );
}
