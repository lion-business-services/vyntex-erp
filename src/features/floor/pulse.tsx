// The shop at this moment, on the home screen of a barbershop: the line, the chairs, today's takings, who is due for a
// cut and what needs a hand at the desk. One click opens the Shop floor.
import { LuArmchair, LuCrown, LuTicket, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { moduleOn } from '@/domain/config';
import { dayNumbers, dueForCut, inChair, inLine, quoteWait } from '@/domain/actions/shop';
import { money } from '@/lib/money';
import './floor.css';

export function ShopPulse() {
  const { t, data, pack, can } = useApp();
  if (!moduleOn(data, pack, 'floor') || !can('appointments') || !(data.chairs ?? []).length) return null;
  const line = inLine(data);
  const wait = Math.max(0, quoteWait(data));
  const n = dayNumbers(data);
  const due = dueForCut(data).length;
  const pastDue = (data.passes ?? []).filter((p) => p.status === 'past_due').length;
  const busy = new Set([...inChair(data).map((w) => w.chairId), ...(data.chairs ?? []).filter((c) => c.status === 'busy').map((c) => c.id)]).size;
  return (
    <section className="card floor-pulse" aria-labelledby="floor-pulse-h" data-testid="dash-shop">
      <header><h2 id="floor-pulse-h"><LuArmchair aria-hidden="true" /> {t('floor.pulse.title')}</h2><A to="/floor" className="btn primary sm" data-testid="dash-shop-open">{t('floor.pulse.open')}</A></header>
      <div className="floor-pulse-grid">
        <A to="/floor" className="floor-pulse-k"><LuTicket aria-hidden="true" /><b>{line.length}</b><span>{t('floor.pulse.line', { min: wait })}</span></A>
        <A to="/floor" className="floor-pulse-k"><LuArmchair aria-hidden="true" /><b>{busy}/{(data.chairs ?? []).filter((c) => c.staffId && c.status !== 'off').length}</b><span>{t('floor.k.chairs')}</span></A>
        <div className="floor-pulse-k"><b>{money(n.services)}</b><span>{t('floor.pulse.today', { tips: money(n.tips), n: n.visits })}</span></div>
        <A to="/floor" className="floor-pulse-k"><LuUsers aria-hidden="true" /><b>{due}</b><span>{t('floor.pulse.due')}</span></A>
        {can('clients') && moduleOn(data, pack, 'memberships') && <A to="/memberships" className="floor-pulse-k"><LuCrown aria-hidden="true" /><b>{pastDue}</b><span>{t('floor.pulse.pastDue')}</span></A>}
      </div>
    </section>
  );
}
