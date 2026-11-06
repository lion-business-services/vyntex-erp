// Dispatch board: today's calls by technician, the emergency queue on top, who is on call, and each call moved from
// waiting to en route, on site and done. Built from the edition's own open jobs, visits and emergency calls.
import { LuCircleAlert, LuMapPin, LuPhone, LuTruck } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { Badge, Button, Card, Stat, cx, toast } from '@/ui';
import type { Tone } from '@/ui';
import { Head, useTrade } from './common';
import type { Dispatch, DispatchState } from './store';

const NEXT: Record<DispatchState, DispatchState | null> = { waiting: 'en_route', en_route: 'on_site', on_site: 'done', done: null };
const TONE: Record<DispatchState, Tone> = { waiting: 'neutral', en_route: 'info', on_site: 'warn', done: 'ok' };

export default function DispatchPage(_: PageProps) {
  const { s, set, tx, data, pack, task } = useTrade();
  const label: Record<DispatchState, string> = { waiting: tx('Scheduled', 'Agendada'), en_route: tx('En route', 'En camino'), on_site: tx('On site', 'En el sitio'), done: tx('Done', 'Terminada') };
  const move: Record<DispatchState, string> = { waiting: tx('Start driving', 'Salir'), en_route: tx('Arrived', 'Llegó'), on_site: tx('Finish', 'Terminar'), done: '' };
  const techs = data.workers.filter((w) => w.active !== false && w.payType === 'hourly');
  const queue = s.dispatch.filter((x) => !x.workerId);
  const urgent = s.dispatch.filter((x) => x.urgent && x.state !== 'done');
  const rolling = s.dispatch.filter((x) => x.state === 'en_route' || x.state === 'on_site').length;
  const done = s.dispatch.filter((x) => x.state === 'done').length;
  const patch = (id: string, p: Partial<Dispatch>) => set((st) => ({ ...st, dispatch: st.dispatch.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const assign = (x: Dispatch, workerId: string) => {
    patch(x.id, { workerId: workerId || undefined });
    const w = data.workers.find((y) => y.id === workerId);
    if (w) toast(tx(`${x.clientName} assigned to ${w.name}`, `${x.clientName} asignado a ${w.name}`));
  };
  const advance = (x: Dispatch) => {
    const n = NEXT[x.state]; if (!n) return;
    patch(x.id, { state: n });
    if (n === 'done') task(tx(`Close out ${x.title}: invoice, photos and notes`, `Cerrar ${x.title}: factura, fotos y notas`), { ...(x.ref.type === 'job' ? { jobId: x.ref.id } : {}), type: 'todo' });
  };
  /** Emergencies to whoever is on call, every other waiting call to the technician with the fewest open calls. */
  const autoDispatch = () => {
    const load = new Map(techs.map((w) => [w.id, s.dispatch.filter((x) => x.workerId === w.id && x.state !== 'done').length]));
    const picks = new Map<string, string>();
    for (const x of [...queue].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent))) {
      const w = x.urgent && load.has(s.onCall.workerId) ? s.onCall.workerId : [...load.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
      if (!w) continue; picks.set(x.id, w); load.set(w, (load.get(w) ?? 0) + 1);
    }
    set((st) => ({ ...st, dispatch: st.dispatch.map((x) => (picks.has(x.id) ? { ...x, workerId: picks.get(x.id) } : x)) }));
    toast(tx(`${picks.size} calls assigned. Emergencies went to ${data.workers.find((w) => w.id === s.onCall.workerId)?.name ?? ''} (on call).`, `${picks.size} llamadas asignadas. Las emergencias fueron para ${data.workers.find((w) => w.id === s.onCall.workerId)?.name ?? ''} (de guardia).`));
  };
  const card = (x: Dispatch) => (
    <article key={x.id} className={cx('td-card', x.urgent && 'urgent', x.state === 'done' && 'done')} data-testid="dispatch-card">
      <header className="row between">
        <Badge tone={x.urgent ? 'bad' : TONE[x.state]}>{x.urgent && x.state === 'waiting' ? tx('Emergency', 'Emergencia') : label[x.state]}</Badge>
        <span className="xs dim">{x.window}</span>
      </header>
      <div className="td-title">{x.ref.type === 'job' ? <A to={'/jobs/' + x.ref.id}>{x.title}</A> : <A to={'/leads/' + x.ref.id}>{x.title}</A>}</div>
      <div className="small">{x.clientName}</div>
      <div className="xs dim row tight"><LuMapPin aria-hidden="true" />{x.address}</div>
      <div className="row tight td-actions">
        <select aria-label={pack.id === 'plumbing' ? tx('Plumber', 'Plomero') : tx('Technician', 'Técnico')} value={x.workerId ?? ''} onChange={(e) => assign(x, e.target.value)}>
          <option value="">{tx('Not assigned', 'Sin asignar')}</option>
          {techs.map((w) => <option key={w.id} value={w.id}>{w.name}{s.onCall.workerId === w.id ? ' · ' + tx('on call', 'de guardia') : ''}</option>)}
        </select>
        {NEXT[x.state] && x.workerId && <Button size="sm" variant={x.state === 'on_site' ? 'primary' : 'default'} onClick={() => advance(x)}>{move[x.state]}</Button>}
      </div>
    </article>
  );
  return (
    <div className="trade">
      <Head title={tx('Dispatch board', 'Tablero de despacho')} sub={tx('Today\'s calls. Emergencies go to whoever is on call.', 'Las llamadas de hoy. Las emergencias van a quien está de guardia.')}
        auto={autoDispatch} autoLabel={tx('Auto-dispatch', 'Despachar todo')} autoCount={queue.length}
        more={<label className="row tight small td-oncall"><LuPhone aria-hidden="true" />{tx('On call', 'De guardia')}
          <select value={s.onCall.workerId} onChange={(e) => { set((st) => ({ ...st, onCall: { workerId: e.target.value } })); toast(tx('On-call technician changed', 'Técnico de guardia cambiado')); }}>
            {techs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>} />
      <div className="kpis">
        <Stat label={tx('Calls on the board', 'Llamadas en el tablero')} value={String(s.dispatch.length)} hint={tx(`${queue.length} not assigned`, `${queue.length} sin asignar`)} />
        <Stat label={tx('Emergencies waiting', 'Emergencias esperando')} value={String(urgent.length)} hint={tx('Callback within 15 minutes', 'Devolver la llamada en 15 minutos')} attention={urgent.length > 0} />
        <Stat label={tx('On the road or on site', 'En camino o en el sitio')} value={String(rolling)} hint={tx(`${techs.length} working today`, `${techs.length} trabajando hoy`)} />
        <Stat label={tx('Finished today', 'Terminadas hoy')} value={String(done)} hint={tx('Each one gets a close-out task', 'Cada una genera una tarea de cierre')} />
      </div>
      {queue.length > 0 && (
        <Card title={<span className="row tight"><LuCircleAlert aria-hidden="true" className="neg" />{pack.id === 'plumbing' ? tx('Needs a plumber', 'Necesita plomero') : tx('Needs a technician', 'Necesita técnico')} <Badge tone="bad">{queue.length}</Badge></span>}>
          <div className="td-queue">{queue.map(card)}</div>
        </Card>
      )}
      <div className="td-lanes" data-testid="dispatch-lanes">
        {techs.map((w) => {
          const mine = s.dispatch.filter((x) => x.workerId === w.id);
          return (
            <section key={w.id} className="td-lane" aria-label={w.name}>
              <header><b>{w.name}</b>{s.onCall.workerId === w.id && <Badge tone="violet">{tx('On call', 'De guardia')}</Badge>}<div className="xs dim">{w.trade}</div></header>
              {mine.length ? mine.map(card) : <p className="xs dim td-free"><LuTruck aria-hidden="true" /> {tx('Free for a call', 'Libre para una llamada')}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
