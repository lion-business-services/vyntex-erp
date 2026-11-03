// Maintenance agreements (HVAC) / inspection plans (plumbing): the recurring revenue. Members, what they pay, the visits
// they are owed and when they renew, plus the clients who should be offered a plan. Members are the edition's repeating
// jobs, so enrolling a client here creates a real repeating job and the dashboard counts it.
import { LuCrown, LuRefreshCw, LuUserPlus } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { createJob } from '@/domain/actions/jobs';
import { addDays, addDaysFrom } from '@/lib/dates';
import { money } from '@/lib/money';
import { Badge, Button, Card, Empty, PageHeader, Stat, toast } from '@/ui';
import { DemoNote, daysTo, useTrade } from './common';

export default function AgreementsPage(_: PageProps) {
  const { tx, data, pack, client, date, task, can } = useTrade();
  const plumbing = pack.id === 'plumbing';
  const planType = plumbing ? 'plan' : 'maintenance';
  const plan = data.catalog.find((x) => x.category === planType && x.tiers.some((t) => t.unit === 'year'));
  const yearly = plan?.tiers.find((t) => t.unit === 'year')?.price ?? 0;
  const monthly = plan?.tiers.find((t) => t.unit === 'month')?.price ?? 0;
  const once = (r?: string) => !r || r === 'once';
  const members = data.jobs.filter((j) => !once(j.repeat) && j.status === 'progress');
  const memberIds = new Set(members.map((j) => j.clientId));
  const perYear = members.reduce((n, j) => n + j.price, 0);
  const visitsPerYear = (r?: string) => (r === 'quarterly' ? 4 : r === 'monthly' && plumbing ? 1 : 2);
  const nextVisit = (start?: string, r?: string) => {
    if (!start) return undefined; const step = Math.round(365 / visitsPerYear(r));
    let d = start; for (let i = 0; i < 12 && (daysTo(d) ?? 0) < 0; i++) d = addDaysFrom(d, step);
    return d;
  };
  const due = members.filter((j) => (daysTo(nextVisit(j.start, j.repeat)) ?? 99) <= 30);
  const renewing = members.filter((j) => { const n = daysTo(j.end); return n !== undefined && n <= 60; });
  // who should be offered a plan: clients with finished repair or install work who are not members yet
  const prospects = data.clients.filter((c) => !memberIds.has(c.id) && data.jobs.some((j) => j.clientId === c.id && j.status === 'done' && once(j.repeat)));
  const billing = (r?: string) => (r === 'monthly' ? tx('Monthly', 'Mensual') : r === 'quarterly' ? tx('Quarterly', 'Trimestral') : tx('Yearly', 'Anual'));
  const enroll = (clientId: string) => {
    const c = client(clientId); if (!c || !plan) return;
    try {
      act(createJob, { name: tx(`${plan.name}, ${c.name}`, `${plan.name}, ${c.name}`), clientId, type: planType, status: 'progress', price: yearly, repeat: 'yearly', start: addDays(0), end: addDays(365),
        scope: plan.highlights?.join('. ') ?? '', payTerms: tx(`${money(yearly)} a year, renews automatically.`, `${money(yearly)} al año, se renueva automáticamente.`) });
      task(tx(`Book the first ${plumbing ? 'inspection' : 'tune-up'} for ${c.name}`, `Agendar ${plumbing ? 'la primera inspección' : 'el primer mantenimiento'} de ${c.name}`), { clientId, type: 'call', due: 2 });
      toast(tx(`${c.name} is now a plan member`, `${c.name} ya es miembro del plan`));
    } catch { toast(tx('You cannot add jobs with this role', 'Con este rol no puede agregar trabajos'), true); }
  };
  const title = plumbing ? tx('Inspection plans', 'Planes de inspección') : tx('Maintenance plans', 'Planes de mantenimiento');
  return (
    <div className="trade">
      <PageHeader title={title} sub={tx('The recurring revenue: members, the visits they are owed, renewals, and who to offer a plan next.', 'Los ingresos recurrentes: miembros, las visitas que se les deben, renovaciones y a quién ofrecer un plan.')} />
      <DemoNote />
      <div className="kpis">
        <Stat label={tx('Active members', 'Miembros activos')} value={String(members.length)} hint={plan ? tx(`${plan.name}: ${money(monthly)}/mo or ${money(yearly)}/yr`, `${plan.name}: ${money(monthly)}/mes o ${money(yearly)}/año`) : undefined} />
        <Stat label={tx('Recurring revenue a year', 'Ingresos recurrentes al año')} value={money(perYear)} hint={tx(`About ${money(Math.round(perYear / 12))} a month`, `Unos ${money(Math.round(perYear / 12))} al mes`)} />
        <Stat label={tx('Visits due in 30 days', 'Visitas en los próximos 30 días')} value={String(due.length)} hint={tx('Book them before the rush', 'Agendarlas antes de la temporada alta')} attention={due.length > 0} />
        <Stat label={tx('Renewing in 60 days', 'Se renuevan en 60 días')} value={String(renewing.length)} hint={tx('Remind before the card is charged', 'Avisar antes del cobro')} />
        <Stat label={tx('Clients to offer a plan', 'Clientes para ofrecer el plan')} value={String(prospects.length)} hint={prospects.length && yearly ? tx(`${money(prospects.length * yearly)} a year if they join`, `${money(prospects.length * yearly)} al año si se unen`) : undefined} />
      </div>
      <Card title={<span className="row tight"><LuCrown aria-hidden="true" />{tx('Members', 'Miembros')}</span>} flush>
        {!members.length ? <Empty title={tx('No members yet', 'Todavía no hay miembros')} /> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="plan-members">
            <thead><tr><th>{tx('Member', 'Miembro')}</th><th>{tx('Agreement', 'Contrato')}</th><th>{tx('Billing', 'Cobro')}</th><th className="num">{tx('A year', 'Al año')}</th><th>{tx('Next visit', 'Próxima visita')}</th><th>{tx('Renews', 'Se renueva')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
            <tbody>{members.map((j) => { const nv = nextVisit(j.start, j.repeat); const soon = (daysTo(nv) ?? 99) <= 30; return (
              <tr key={j.id}>
                <td className="t1"><A to={'/clients/' + j.clientId}>{client(j.clientId)?.name}</A>{client(j.clientId)?.company && <div className="xs dim">{client(j.clientId)?.company}</div>}</td>
                <td data-label={tx('Agreement', 'Contrato')}><A to={'/jobs/' + j.id}>{j.name}</A><div className="xs dim">{tx(`${visitsPerYear(j.repeat)} visits a year`, `${visitsPerYear(j.repeat)} visitas al año`)}</div></td>
                <td data-label={tx('Billing', 'Cobro')}>{billing(j.repeat)}</td>
                <td className="num" data-label={tx('A year', 'Al año')}>{money(j.price)}</td>
                <td data-label={tx('Next visit', 'Próxima visita')}>{nv ? <>{date(nv)} {soon && <Badge tone="warn">{tx('Book now', 'Agendar ya')}</Badge>}</> : ''}</td>
                <td data-label={tx('Renews', 'Se renueva')}>{j.end ? date(j.end) : ''}</td>
                <td className="num"><span className="row tight nowrap">
                  <Button size="sm" onClick={() => task(tx(`Book the ${plumbing ? 'inspection' : 'tune-up'} for ${client(j.clientId)?.name ?? ''}`, `Agendar ${plumbing ? 'la inspección' : 'el mantenimiento'} de ${client(j.clientId)?.name ?? ''}`), { clientId: j.clientId, jobId: j.id, type: 'call', due: 1 })}>{tx('Book visit', 'Agendar visita')}</Button>
                  <Button size="sm" variant="ghost" icon={<LuRefreshCw aria-hidden="true" />} onClick={() => task(tx(`Renewal reminder: ${j.name}`, `Recordatorio de renovación: ${j.name}`), { clientId: j.clientId, jobId: j.id, type: 'call', due: 0 })}>{tx('Renewal reminder', 'Recordar renovación')}</Button>
                </span></td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}
      </Card>
      <Card title={<span className="row tight"><LuUserPlus aria-hidden="true" />{tx('Offer the plan to', 'Ofrecer el plan a')}</span>} flush>
        {!prospects.length ? <p className="pad dim">{tx('Every client with finished work is already a member.', 'Todos los clientes con trabajos terminados ya son miembros.')}</p> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="plan-prospects">
            <thead><tr><th>{tx('Client', 'Cliente')}</th><th>{tx('Last work', 'Último trabajo')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
            <tbody>{prospects.map((c) => { const last = data.jobs.filter((j) => j.clientId === c.id && j.status === 'done').sort((a, b) => (b.end ?? '').localeCompare(a.end ?? ''))[0]; return (
              <tr key={c.id}>
                <td className="t1"><A to={'/clients/' + c.id}>{c.name}</A>{(c.tags ?? []).includes('plan prospect') && <Badge tone="violet">{tx('Plan prospect', 'Posible miembro')}</Badge>}</td>
                <td data-label={tx('Last work', 'Último trabajo')}>{last ? <A to={'/jobs/' + last.id}>{last.name}</A> : ''}</td>
                <td className="num">{can('write') && plan && <Button size="sm" variant="primary" onClick={() => enroll(c.id)} data-testid="plan-enroll">{tx(`Enroll, ${money(yearly)}/yr`, `Inscribir, ${money(yearly)}/año`)}</Button>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
