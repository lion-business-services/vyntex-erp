// A calm, action-led home for barbershop owners and reception.
// All counts are derived from the current workspace. No hardcoded "live" KPIs or fabricated events.
import { LuArmchair, LuCalendarClock, LuUsers, LuWallet, LuZap, LuArrowUpRight, LuCrown, LuClockAlert, LuCircleCheckBig, LuScissors } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { dayNumbers, dueForCut, inChair, inLine, quoteWait } from '@/domain/actions/shop';
import { effectiveRules, isRuleOn } from '@/domain/rules/engine';
import { today } from '@/lib/dates';
import { money } from '@/lib/money';
import './barber.css';

export default function BarberDashboard() {
  const { data, pack, can, lang } = useApp();
  const es = lang === 'es';
  const tr = (en: string, spanish: string) => es ? spanish : en;
  const line = inLine(data);
  const busy = inChair(data);
  const chairs = (data.chairs ?? []).filter(ch => ch.status !== 'off');
  const ready = chairs.filter(ch => ch.status === 'open' && ch.staffId && !busy.some(w => w.chairId === ch.id)).length;
  const td = today();
  const appts = (data.appointments ?? [])
    .filter(a => a.date === td && !['cancelled', 'no_show'].includes(a.status))
    .sort((a,b) => a.time.localeCompare(b.time));
  const wait = quoteWait(data);
  const numbers = dayNumbers(data);
  const due = can('clients') ? dueForCut(data).length : 0;
  const pastDue = can('clients') ? (data.passes ?? []).filter(p => p.status === 'past_due').length : 0;
  const rules = can('automations') ? effectiveRules(data, pack).filter(r => isRuleOn(data, r)) : [];
  const atTime = (time: string) => {
    const [h,m] = time.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
    return new Date(2000,0,1,h,m).toLocaleTimeString(es ? 'es' : 'en', {hour:'numeric',minute:'2-digit'});
  };
  const metrics = [
    { icon:<LuCalendarClock />, label:tr('Appointments today','Citas para hoy'), value:String(appts.length), meta:tr('Open today’s schedule','Ver agenda del día'), to:'/appointments' },
    { icon:<LuUsers />, label:tr('Guests in line','Clientes en espera'), value:String(line.length), meta:wait >= 0 ? tr('Estimated wait: ','Espera estimada: ') + wait + tr(' min',' min') : tr('No available chair','Sin silla disponible'), to:'/floor' },
    { icon:<LuArmchair />, label:tr('Chairs available','Sillas disponibles'), value:String(ready)+'/'+String(chairs.length), meta:tr('See the live floor','Ver el local en vivo'), to:'/floor' },
    ...(can('money') ? [{icon:<LuWallet />, label:tr('Services today','Servicios de hoy'), value:money(numbers.services), meta:tr('Record-based sales','Ventas registradas'),to:'/payments'}] : []),
  ];
  return <div className="barber-home">
    <div className="barber-welcome">
      <div>
        <p className="barber-eyebrow"><LuScissors aria-hidden="true" /> {tr('BARBERSHOP WORKSPACE','ESPACIO DE BARBERÍA')}</p>
        <h1>{tr('Your shop. One clear view.','Su barbería. Todo a la vista.')}</h1>
        <p>{tr('Welcome to ','Bienvenido a ')}<strong>{data.company.name}</strong>{tr('. Here is what needs attention today.','. Esto es lo importante para hoy.')}</p>
      </div>
      <div className="barber-quick">
        {can('appointments') && <A className="btn primary" to="/appointments"><LuCalendarClock aria-hidden="true" />{tr('New appointment','Nueva cita')}</A>}
        {can('appointments') && <A className="btn" to="/floor"><LuArmchair aria-hidden="true" />{tr('Open shop queue','Abrir la fila')}</A>}
      </div>
    </div>

    <div className="barber-kpis" aria-label={tr('Shop at a glance','El local de un vistazo')}>
      {metrics.map(m => <A key={m.label} to={m.to} className="barber-kpi">
        <span className="barber-kpi-label">{m.icon}<span>{m.label}</span></span>
        <strong>{m.value}</strong><small>{m.meta} <LuArrowUpRight aria-hidden="true"/></small>
      </A>)}
    </div>

    <div className="barber-grid">
      <section className="card barber-schedule" aria-labelledby="barber-appt-title">
        <header className="barber-card-header"><div><h2 id="barber-appt-title">{tr("Today's appointments","Citas de hoy")}</h2><p>{tr('Keep every barber and guest on schedule.','El equipo y los clientes, siempre organizados.')}</p></div><A to="/appointments">{tr('All bookings','Todas las citas')} <LuArrowUpRight aria-hidden="true" /></A></header>
        {!appts.length ? <p className="barber-empty">{tr('No bookings yet. Create one from Appointments.','Todavía no hay citas. Cree una en Citas.')}</p> : <ol className="barber-appointments">
          {appts.slice(0,5).map(a => {
            const guest=data.clients.find(c=>c.id===a.clientId)?.name || tr('Walk-in guest','Cliente sin cita');
            const service=data.apptTypes.find(x=>x.id===a.typeId)?.name;
            const barber=data.users.find(x=>x.id===a.staffId)?.name;
            const serviceText=service ? (es ? service.es || service.en : service.en) : tr('Service','Servicio');
            return <li key={a.id}><time>{atTime(a.time)}</time><span className="barber-appt-person"><strong>{guest}</strong><small>{serviceText}{barber ? ' · '+barber : ''}</small></span><span className="barber-appt-status">{a.status.replace(/_/g,' ')}</span></li>;
          })}
        </ol>}
      </section>

      <section className="card barber-queue" aria-labelledby="barber-queue-title">
        <header className="barber-card-header"><div><h2 id="barber-queue-title">{tr('Shop floor & queue','Local y fila de espera')}</h2><p>{tr('Real chair and guest status, not estimates of sales.','Estado real de sillas y clientes.')}</p></div><A to="/floor">{tr('Manage','Gestionar')} <LuArrowUpRight aria-hidden="true" /></A></header>
        <div className="barber-floor-summary">
          <span><strong>{line.length}</strong><small>{tr('Waiting','En espera')}</small></span>
          <span><strong>{busy.length}</strong><small>{tr('In a chair','En silla')}</small></span>
          <span><strong>{ready}</strong><small>{tr('Ready chairs','Sillas listas')}</small></span>
        </div>
        {line.length ? <ol className="barber-queue-list">{line.slice(0,4).map((w,i)=><li key={w.id}><span className="barber-ticket">{w.ticket}</span><strong>{w.name}</strong><small>{tr('Position','Posición')} {i+1}</small></li>)}</ol> : <p className="barber-empty">{tr('Queue clear. Ready for the next walk-in.','Fila vacía. Lista para el próximo cliente.')}</p>}
      </section>

      {(can('clients') || can('automations')) && <section className="card barber-retention" aria-labelledby="barber-retention-title">
        <header className="barber-card-header"><div><h2 id="barber-retention-title">{tr('Keep guests coming back','Haga que sus clientes regresen')}</h2><p>{tr('Retention and memberships without the CRM clutter.','Fidelización y membresías sin complejidad.')}</p></div>{can('clients') && <A to="/clients">{tr('Clients','Clientes')} <LuArrowUpRight aria-hidden="true" /></A>}</header>
        <div className="barber-insights">
          {can('clients') && <A to="/clients"><LuClockAlert aria-hidden="true" /><strong>{due}</strong><span>{tr('Due for a fresh cut','Necesitan un corte')}</span></A>}
          {can('clients') && <A to="/memberships"><LuCrown aria-hidden="true"/><strong>{pastDue}</strong><span>{tr('Memberships need attention','Membresías pendientes')}</span></A>}
          {can('automations') && <A to="/automations"><LuZap aria-hidden="true"/><strong>{rules.length}</strong><span>{tr('Active shop rules','Reglas activas')}</span></A>}
        </div>
      </section>}

      {can('automations') && <section className="card barber-automation" aria-labelledby="barber-automation-title">
        <header className="barber-card-header"><div><h2 id="barber-automation-title">{tr('Automations working for you','Automatizaciones que le ayudan')}</h2><p>{tr('See what happens, what is drafted and what needs approval.','Sepa qué sucede y qué necesita aprobación.')}</p></div><A to="/automations">{tr('View all','Ver todas')} <LuArrowUpRight aria-hidden="true" /></A></header>
        <div className="barber-auto-cards">
          <A to="/automations"><LuCircleCheckBig aria-hidden="true" /><strong>{tr('Booking reminders','Recordatorios de citas')}</strong><small>{tr('Confirmations and follow-ups','Confirmaciones y seguimientos')}</small></A>
          <A to="/automations"><LuZap aria-hidden="true" /><strong>{tr('Queue notifications','Avisos de fila')}</strong><small>{tr('Guest position and chair-ready drafts','Turnos y avisos para la silla')}</small></A>
          <A to="/automations"><LuCrown aria-hidden="true" /><strong>{tr('Rebooking & retention','Retención y nuevas citas')}</strong><small>{tr('Due-for-cut and review drafts','Recordatorios y solicitudes de reseña')}</small></A>
        </div>
        <p className="barber-auto-note">{tr('In the demo, outbound messages stay in draft mode. No real guest is contacted.','En la demo, los mensajes quedan como borradores. No se contacta a clientes reales.')}</p>
      </section>}
    </div>
  </div>;
}

