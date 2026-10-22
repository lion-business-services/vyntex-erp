// Memberships, packages, gift cards and loyalty: what the shop sells ahead of the visit, who holds what, what is left on
// each, and the points clients earn. Every use is a line in the pass's own ledger, never an edit. A visit is paid with a
// pass at checkout on the Shop floor; this screen sells, renews, pauses, cancels and looks things up.
import { useMemo, useState } from 'react';
import { LuCrown, LuGift, LuPackage, LuPause, LuPencil, LuPlay, LuPlus, LuReceipt, LuRefreshCw, LuStar, LuTicket, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { PageProps } from '@/app/routes';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, IconButton, Modal, Note, PageHeader, SearchBox, Stat, Tabs, confirmDialog, cx, toast } from '@/ui';
import type { Tone } from '@/ui';
import {
  planOf, pointsOf, redeemPass, redeemPoints, renewMembership, savePassPlan, sellPass, serviceName, setPassStatus, shopSettings, type ShopRefusal,
} from '@/domain/actions/shop';
import type { Pass, PassPlan, PayMethod } from '@/domain/types';
import { today } from '@/lib/dates';
import { money, money2 } from '@/lib/money';
import './memberships.css';

type Tab = 'members' | 'packages' | 'gifts' | 'rewards' | 'plans';
const TONE: Record<Pass['status'], Tone> = { active: 'ok', paused: 'warn', past_due: 'bad', cancelled: 'neutral', used_up: 'neutral', expired: 'neutral' };
const err = (r: ShopRefusal | string) => 'floor.err.' + (['invalid', 'not_found', 'not_allowed', 'already', 'empty', 'expired', 'not_active', 'not_enough'].includes(r) ? r : 'failed');
const METHODS: PayMethod[] = ['card', 'cash', 'zelle', 'transfer', 'check'];

export default function MembershipsPage(_: PageProps) {
  const { t, data, can, lang, date } = useApp();
  const [tab, setTab] = useState<Tab>('members');
  const [q, setQ] = useState('');
  const [selling, setSelling] = useState<PassPlan['kind'] | null>(null);
  const [plan, setPlan] = useState<PassPlan | 'new' | null>(null);
  const [open, setOpen] = useState<Pass | null>(null);
  const mayWrite = can('write') && can('clients');
  const passes = data.passes ?? [];
  const plans = data.passPlans ?? [];
  const name = (p: Pass) => (p.clientId ? data.clients.find((c) => c.id === p.clientId)?.name ?? '' : p.holder ?? '');
  const planName = (id?: string) => { const p = planOf(data, id); return p ? p.i18n?.[lang]?.name ?? p.name : t('mem.kind.gift_card'); };
  const s = q.trim().toLowerCase();
  const match = (p: Pass) => !s || [name(p), planName(p.planId), p.code ?? ''].some((v) => v.toLowerCase().includes(s));
  const members = passes.filter((p) => p.kind === 'membership' && match(p));
  const packages = passes.filter((p) => p.kind === 'package' && match(p));
  const gifts = passes.filter((p) => p.kind === 'gift_card' && match(p));
  const live = (p: Pass) => p.status === 'active' || p.status === 'paused' || p.status === 'past_due';
  const mrr = passes.filter((p) => p.kind === 'membership' && p.status === 'active').reduce((n, p) => n + (planOf(data, p.planId)?.price ?? 0), 0);
  const giftOut = passes.filter((p) => p.kind === 'gift_card' && p.status === 'active').reduce((n, p) => n + Math.round((p.balance ?? 0) * 100), 0) / 100;
  const visitsOut = passes.filter((p) => p.kind === 'package' && p.status === 'active').reduce((n, p) => n + (p.visitsLeft ?? 0), 0);
  const pastDue = passes.filter((p) => p.status === 'past_due');

  const status = async (p: Pass, st: 'active' | 'paused' | 'cancelled') => {
    if (st === 'cancelled' && !(await confirmDialog(t('mem.cancelAsk', { name: name(p), plan: planName(p.planId) }), t('mem.cancel'), t('common.back')))) return;
    const r = act(setPassStatus, p.id, st); toast(r.ok ? t('mem.status.' + st) : t(err(r.reason)), !r.ok);
  };
  const renew = (p: Pass) => { const r = act(renewMembership, p.id, 'card'); toast(r.ok ? t('mem.renewed', { date: r.value.renews ? date(r.value.renews) : '' }) : t(err(r.reason)), !r.ok); };

  const kindLabel = (k: PassPlan['kind']) => t('mem.kind.' + k);
  return (
    <div className="mem">
      <PageHeader title={t('nav.memberships')} sub={t('mem.sub')} actions={<>
        {mayWrite && can('catalog') && <Button icon={<LuPlus aria-hidden="true" />} onClick={() => setPlan('new')} data-testid="mem-plan-new">{t('mem.plan.new')}</Button>}
        {mayWrite && <Button variant="primary" icon={<LuReceipt aria-hidden="true" />} onClick={() => setSelling(tab === 'packages' ? 'package' : tab === 'gifts' ? 'gift_card' : 'membership')} data-testid="mem-sell">{t('mem.sell')}</Button>}
      </>} />
      {pastDue.length > 0 && <Note tone="warn">{t(pastDue.length === 1 ? 'mem.pastDueNote.one' : 'mem.pastDueNote', { n: pastDue.length })}</Note>}
      <div className="kpis mem-kpis">
        <Stat label={t('mem.k.members')} value={String(passes.filter((p) => p.kind === 'membership' && p.status === 'active').length)} hint={t('mem.k.membersHint', { n: passes.filter((p) => p.kind === 'membership' && p.status === 'paused').length })} onClick={() => setTab('members')} testId="mem-kpi-members" />
        <Stat label={t('mem.k.monthly')} value={money(mrr)} hint={t('mem.k.monthlyHint')} testId="mem-kpi-monthly" />
        <Stat label={t('mem.k.visits')} value={String(visitsOut)} hint={t('mem.k.visitsHint')} onClick={() => setTab('packages')} testId="mem-kpi-visits" />
        <Stat label={t('mem.k.gift')} value={money2(giftOut)} hint={t('mem.k.giftHint')} onClick={() => setTab('gifts')} testId="mem-kpi-gift" />
        <Stat label={t('mem.k.pastDue')} value={String(pastDue.length)} hint={pastDue.length ? t('mem.k.pastDueHint') : t('mem.k.pastDueNone')} attention={pastDue.length > 0} onClick={() => setTab('members')} testId="mem-kpi-pastdue" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'members', label: t('mem.tab.members'), count: members.filter(live).length }, { id: 'packages', label: t('mem.tab.packages'), count: packages.filter(live).length },
        { id: 'gifts', label: t('mem.tab.gifts'), count: gifts.filter(live).length }, { id: 'rewards', label: t('mem.tab.rewards') }, { id: 'plans', label: t('mem.tab.plans'), count: plans.length },
      ]} />
      {tab !== 'plans' && tab !== 'rewards' && <div className="filters"><SearchBox value={q} onChange={setQ} placeholder={t('mem.search')} /></div>}

      {tab === 'members' && (
        <Card flush>{!members.length ? <Empty title={t('mem.none.members')} action={mayWrite ? <Button onClick={() => setSelling('membership')}>{t('mem.sell')}</Button> : undefined}>{t('mem.none.membersHint')}</Empty> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="mem-members">
            <thead><tr><th>{t('mem.col.client')}</th><th>{t('mem.col.plan')}</th><th>{t('mem.col.status')}</th><th className="num">{t('mem.col.left')}</th><th>{t('mem.col.renews')}</th><th aria-label={t('common.actions')} /></tr></thead>
            <tbody>{members.map((p) => (
              <tr key={p.id} data-pass={p.id}>
                <td className="t1">{p.clientId ? <A to={'/clients/' + p.clientId}>{name(p)}</A> : name(p)}<div className="xs dim">{t('mem.since', { date: date(p.start) })}</div></td>
                <td data-label={t('mem.col.plan')}><button type="button" className="linkbtn" onClick={() => setOpen(p)}>{planName(p.planId)}</button><div className="xs dim">{money(planOf(data, p.planId)?.price)}/{t('mem.month')}</div></td>
                <td data-label={t('mem.col.status')}><Badge tone={TONE[p.status]}>{t('mem.st.' + p.status)}</Badge></td>
                <td data-label={t('mem.col.left')} className="num">{p.visitsLeft === undefined ? t('mem.unlimited') : t('mem.left', { n: p.visitsLeft })}</td>
                <td data-label={t('mem.col.renews')} className={cx(p.renews && p.renews < today() && 'neg')}>{p.renews ? date(p.renews) : ''}</td>
                <td className="num mem-act">{mayWrite && live(p) && <span className="row tight nowrap">
                  {(p.status === 'past_due' || (p.renews && p.renews <= today())) && <Button size="sm" variant="primary" icon={<LuRefreshCw aria-hidden="true" />} onClick={() => renew(p)} data-testid="mem-renew">{t('mem.renew')}</Button>}
                  {p.status === 'active' && <IconButton size="sm" label={`${t('mem.pause')}: ${name(p)}`} onClick={() => { void status(p, 'paused'); }}><LuPause /></IconButton>}
                  {p.status === 'paused' && <IconButton size="sm" label={`${t('mem.resume')}: ${name(p)}`} onClick={() => { void status(p, 'active'); }}><LuPlay /></IconButton>}
                  <IconButton size="sm" label={`${t('mem.cancel')}: ${name(p)}`} onClick={() => { void status(p, 'cancelled'); }}><LuX /></IconButton>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}</Card>
      )}

      {tab === 'packages' && (
        <Card flush>{!packages.length ? <Empty title={t('mem.none.packages')} /> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="mem-packages">
            <thead><tr><th>{t('mem.col.client')}</th><th>{t('mem.col.plan')}</th><th>{t('mem.col.status')}</th><th>{t('mem.col.progress')}</th><th>{t('mem.col.expires')}</th><th aria-label={t('common.actions')} /></tr></thead>
            <tbody>{packages.map((p) => { const total = planOf(data, p.planId)?.visits ?? 0; const used = total - (p.visitsLeft ?? 0); return (
              <tr key={p.id} data-pass={p.id}>
                <td className="t1">{p.clientId ? <A to={'/clients/' + p.clientId}>{name(p)}</A> : name(p)}</td>
                <td data-label={t('mem.col.plan')}><button type="button" className="linkbtn" onClick={() => setOpen(p)}>{planName(p.planId)}</button></td>
                <td data-label={t('mem.col.status')}><Badge tone={TONE[p.status]}>{t('mem.st.' + p.status)}</Badge></td>
                <td data-label={t('mem.col.progress')}><span className="mem-dots" aria-label={t('mem.usedOf', { used, total })}>{Array.from({ length: total }, (_, i) => <i key={i} className={cx(i < used && 'on')} />)}</span> <span className="xs dim">{t('mem.left', { n: p.visitsLeft ?? 0 })}</span></td>
                <td data-label={t('mem.col.expires')}>{p.expires ? date(p.expires) : t('mem.never')}</td>
                <td className="num mem-act">{mayWrite && p.status === 'active' && <IconButton size="sm" label={`${t('mem.cancel')}: ${name(p)}`} onClick={() => { void status(p, 'cancelled'); }}><LuX /></IconButton>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}</Card>
      )}

      {tab === 'gifts' && (
        <Card flush>{!gifts.length ? <Empty title={t('mem.none.gifts')} /> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="mem-gifts">
            <thead><tr><th>{t('mem.col.code')}</th><th>{t('mem.col.holder')}</th><th>{t('mem.col.status')}</th><th className="num">{t('mem.col.balance')}</th><th className="num">{t('mem.col.sold')}</th><th>{t('mem.col.expires')}</th><th aria-label={t('common.actions')} /></tr></thead>
            <tbody>{gifts.map((p) => (
              <tr key={p.id} data-pass={p.id}>
                <td className="t1"><button type="button" className="linkbtn mem-code" onClick={() => setOpen(p)}>{p.code ?? t('mem.noCode')}</button>{p.note?.startsWith('reward:') && <div className="xs dim">{t('mem.rewardCard')}</div>}</td>
                <td data-label={t('mem.col.holder')}>{p.clientId ? <A to={'/clients/' + p.clientId}>{name(p)}</A> : name(p)}</td>
                <td data-label={t('mem.col.status')}><Badge tone={TONE[p.status]}>{t('mem.st.' + p.status)}</Badge></td>
                <td data-label={t('mem.col.balance')} className="num strong">{money2(p.balance)}</td>
                <td data-label={t('mem.col.sold')} className="num">{money2(p.sold.amount)}</td>
                <td data-label={t('mem.col.expires')}>{p.expires ? date(p.expires) : t('mem.never')}</td>
                <td className="num mem-act">{mayWrite && p.status === 'active' && <IconButton size="sm" label={`${t('mem.cancel')}: ${p.code}`} onClick={() => { void status(p, 'cancelled'); }}><LuX /></IconButton>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}</Card>
      )}

      {tab === 'rewards' && <Rewards mayWrite={mayWrite} />}

      {tab === 'plans' && (
        <div className="mem-plans" data-testid="mem-plans">
          {plans.map((p) => {
            const Icon = p.kind === 'membership' ? LuCrown : p.kind === 'package' ? LuPackage : LuGift;
            const holders = passes.filter((x) => x.planId === p.id && live(x)).length;
            return (
              <article key={p.id} className={cx('mem-plan', !p.active && 'off')}>
                <header><span className="mem-plan-ico" aria-hidden="true"><Icon /></span><div className="grow"><b>{p.i18n?.[lang]?.name ?? p.name}</b><div className="xs dim">{kindLabel(p.kind)}</div></div>
                  {mayWrite && can('catalog') && <IconButton size="sm" label={`${t('common.edit')}: ${p.name}`} onClick={() => setPlan(p)}><LuPencil /></IconButton>}</header>
                <div className="mem-plan-price">{p.kind === 'gift_card' ? t('mem.anyAmount') : money(p.price)}{p.kind === 'membership' && <small>/{t('mem.month')}</small>}</div>
                <ul className="mem-plan-facts">
                  {p.kind === 'membership' && <li>{p.visits ? t('mem.fact.visits', { n: p.visits }) : t('mem.fact.unlimited')}</li>}
                  {p.kind === 'package' && <li>{t('mem.fact.package', { n: p.visits ?? 0, each: money2((p.price || 0) / (p.visits || 1)) })}</li>}
                  {p.serviceIds.length > 0 && <li>{t('mem.fact.covers', { list: p.serviceIds.map((id) => serviceName(data, id, lang)).join(', ') })}</li>}
                  {p.discount ? <li>{t('mem.fact.discount', { n: p.discount })}</li> : null}
                  {p.validDays ? <li>{t('mem.fact.valid', { n: p.validDays })}</li> : null}
                  {(p.i18n?.[lang]?.perks ?? p.perks) && <li>{p.i18n?.[lang]?.perks ?? p.perks}</li>}
                </ul>
                <footer><span className="small muted">{t('mem.holders', { n: holders })}</span>{!p.active && <Badge>{t('mem.planOff')}</Badge>}</footer>
              </article>
            );
          })}
        </div>
      )}

      {selling && <SellModal kind={selling} onClose={() => setSelling(null)} />}
      {plan && <PlanModal plan={plan === 'new' ? undefined : plan} onClose={() => setPlan(null)} />}
      {open && <PassModal pass={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Rewards({ mayWrite }: { mayWrite: boolean }) {
  const { t, data } = useApp();
  const s = shopSettings(data);
  const rows = useMemo(() => data.clients.map((c) => ({ c, p: pointsOf(data, c.id) })).filter((x) => x.p.earned > 0).sort((a, b) => b.p.balance - a.p.balance), [data]);
  const give = async (clientId: string, name: string) => {
    if (!(await confirmDialog(t('mem.reward.ask', { name, points: s.rewardPoints, amount: money2(s.rewardValue) }), t('mem.reward.give'), t('common.cancel'), false))) return;
    const r = act(redeemPoints, clientId); toast(r.ok ? t('mem.reward.done', { name, code: r.value.code ?? '' }) : t(err(r.reason)), !r.ok);
  };
  return (
    <Card flush>
      <p className="small muted mem-pad">{t('mem.reward.how', { per: s.pointsPerDollar, points: s.rewardPoints, amount: money2(s.rewardValue) })}</p>
      {!rows.length ? <Empty title={t('mem.reward.none')} /> : (
        <div className="table-wrap"><table className="tbl stackable" data-testid="mem-rewards">
          <thead><tr><th>{t('mem.col.client')}</th><th className="num">{t('mem.col.visits')}</th><th className="num">{t('mem.col.spent')}</th><th>{t('mem.col.points')}</th><th aria-label={t('common.actions')} /></tr></thead>
          <tbody>{rows.map(({ c, p }) => (
            <tr key={c.id}>
              <td className="t1"><A to={'/clients/' + c.id}>{c.name}</A></td>
              <td data-label={t('mem.col.visits')} className="num">{p.visits}</td>
              <td data-label={t('mem.col.spent')} className="num">{money(p.spentMoney)}</td>
              <td data-label={t('mem.col.points')}><span className="mem-pts"><span className="mem-pts-b" aria-hidden="true"><i style={{ width: Math.min(100, Math.round((p.balance / Math.max(1, s.rewardPoints)) * 100)) + '%' }} /></span><b>{p.balance}</b><span className="xs dim">/ {s.rewardPoints}</span></span></td>
              <td className="num">{mayWrite && p.balance >= s.rewardPoints && <Button size="sm" variant="primary" icon={<LuStar aria-hidden="true" />} onClick={() => { void give(c.id, c.name); }} data-testid="mem-reward-give">{t('mem.reward.give')}</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function SellModal({ kind: start, onClose }: { kind: PassPlan['kind']; onClose: () => void }) {
  const { t, data, lang } = useApp();
  const [kind, setKind] = useState<PassPlan['kind']>(start);
  const options = (data.passPlans ?? []).filter((p) => p.kind === kind && p.active);
  const [planId, setPlanId] = useState(options[0]?.id ?? '');
  const [clientId, setClientId] = useState(''); const [holder, setHolder] = useState('');
  const [amount, setAmount] = useState(String(options[0]?.price ?? 50)); const [method, setMethod] = useState<PayMethod>('card');
  const clients = [...data.clients].filter((c) => c.lifecycle !== 'former').sort((a, b) => a.name.localeCompare(b.name));
  const pick = (k: PassPlan['kind']) => { setKind(k); const o = (data.passPlans ?? []).filter((p) => p.kind === k && p.active); setPlanId(o[0]?.id ?? ''); setAmount(String(o[0]?.price ?? 50)); };
  const save = () => {
    const r = act(sellPass, { planId: planId || undefined, kind, clientId: clientId || undefined, holder, amount: Number(amount), method });
    if (!r.ok) { toast(t(r.reason === 'already' ? 'mem.err.hasMembership' : err(r.reason)), true); return; }
    toast(r.value.code ? t('mem.soldGift', { code: r.value.code }) : t('mem.sold')); onClose();
  };
  return (
    <Modal title={t('mem.sell')} onClose={onClose} labelClose={t('common.close')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="mem-sell-save">{t('mem.sell.save')}</Button></>}>
      <div className="mem-kinds" role="radiogroup" aria-label={t('mem.col.plan')}>
        {(['membership', 'package', 'gift_card'] as PassPlan['kind'][]).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={cx('btn sm', kind === k && 'primary')} onClick={() => pick(k)} data-testid={'mem-sell-' + k}>{t('mem.kind.' + k)}</button>)}
      </div>
      <div className="fgrid">
        {options.length > 0 && kind !== 'gift_card' && <Field label={t('mem.col.plan')} htmlFor="ms-p"><select id="ms-p" value={planId} onChange={(e) => setPlanId(e.target.value)}>{options.map((p) => <option key={p.id} value={p.id}>{(p.i18n?.[lang]?.name ?? p.name)} · {money(p.price)}</option>)}</select></Field>}
        <Field label={t('mem.col.client')} hint={kind === 'gift_card' ? t('mem.sell.giftHint') : undefined} htmlFor="ms-c"><select id="ms-c" value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="mem-sell-client"><option value="">{kind === 'gift_card' ? t('mem.sell.notClient') : t('mem.sell.pick')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        {kind === 'gift_card' && !clientId && <Field label={t('mem.col.holder')} htmlFor="ms-h"><input id="ms-h" className="input" value={holder} onChange={(e) => setHolder(e.target.value)} placeholder={t('mem.sell.holderPh')} data-testid="mem-sell-holder" /></Field>}
        {kind === 'gift_card' && <Field label={t('floor.pay.amount')} htmlFor="ms-a"><div className="ops-money"><span>$</span><input id="ms-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mem-sell-amount" /></div></Field>}
        <Field label={t('floor.pay.method')} htmlFor="ms-m"><select id="ms-m" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{METHODS.map((m) => <option key={m} value={m}>{t('m_' + m)}</option>)}</select></Field>
      </div>
      {kind === 'membership' && <p className="xs dim">{t('mem.sell.memberNote')}</p>}
    </Modal>
  );
}

function PlanModal({ plan, onClose }: { plan?: PassPlan; onClose: () => void }) {
  const { t, data, lang } = useApp();
  const [v, setV] = useState({ kind: plan?.kind ?? 'membership' as PassPlan['kind'], name: plan?.name ?? '', price: String(plan?.price ?? ''), visits: String(plan?.visits ?? 2), serviceIds: plan?.serviceIds ?? [] as string[],
    discount: String(plan?.discount ?? ''), validDays: String(plan?.validDays ?? ''), perks: plan?.perks ?? '', active: plan?.active ?? true });
  const services = (data.catalog ?? []).filter((s) => s.active && s.appointmentTypeId);
  const save = () => {
    const r = act(savePassPlan, { id: plan?.id, kind: v.kind, name: v.name, price: Number(v.price) || 0, visits: Number(v.visits) || 0, serviceIds: v.serviceIds, discount: v.discount ? Number(v.discount) : undefined, validDays: v.validDays ? Number(v.validDays) : undefined, perks: v.perks, active: v.active });
    if (!r.ok) { toast(t(err(r.reason)), true); return; } toast(t('common.saved')); onClose();
  };
  return (
    <Modal title={plan ? t('mem.plan.edit') : t('mem.plan.new')} onClose={onClose} labelClose={t('common.close')} size="wide" footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="mem-plan-save">{t('common.save')}</Button></>}>
      <div className="fgrid">
        <Field label={t('mem.plan.kind')} htmlFor="mp-k"><select id="mp-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as PassPlan['kind'] })} disabled={!!plan}>{(['membership', 'package', 'gift_card'] as const).map((k) => <option key={k} value={k}>{t('mem.kind.' + k)}</option>)}</select></Field>
        <Field label={t('mem.plan.name')} htmlFor="mp-n"><input id="mp-n" className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="mem-plan-name" /></Field>
        <Field label={v.kind === 'membership' ? t('mem.plan.priceMonth') : v.kind === 'gift_card' ? t('mem.plan.priceDefault') : t('mem.plan.price')} htmlFor="mp-p"><div className="ops-money"><span>$</span><input id="mp-p" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} data-testid="mem-plan-price" /></div></Field>
        {v.kind !== 'gift_card' && <Field label={v.kind === 'membership' ? t('mem.plan.visitsMonth') : t('mem.plan.visits')} hint={v.kind === 'membership' ? t('mem.plan.visitsHint') : undefined} htmlFor="mp-v"><input id="mp-v" className="input" type="number" min={0} value={v.visits} onChange={(e) => setV({ ...v, visits: e.target.value })} /></Field>}
        {v.kind === 'membership' && <Field label={t('mem.plan.discount')} htmlFor="mp-d"><input id="mp-d" className="input" type="number" min={0} max={100} value={v.discount} onChange={(e) => setV({ ...v, discount: e.target.value })} /></Field>}
        {v.kind !== 'membership' && <Field label={t('mem.plan.valid')} hint={t('mem.plan.validHint')} htmlFor="mp-x"><input id="mp-x" className="input" type="number" min={0} value={v.validDays} onChange={(e) => setV({ ...v, validDays: e.target.value })} /></Field>}
        <Field label={t('mem.plan.perks')} full htmlFor="mp-k2"><input id="mp-k2" className="input" value={v.perks} onChange={(e) => setV({ ...v, perks: e.target.value })} /></Field>
      </div>
      {v.kind !== 'gift_card' && <fieldset className="floor-skip"><legend className="small">{t('mem.plan.covers')}</legend>
        {services.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={v.serviceIds.includes(s.id)} onChange={(e) => setV({ ...v, serviceIds: e.target.checked ? [...v.serviceIds, s.id] : v.serviceIds.filter((x) => x !== s.id) })} /> <span>{serviceName(data, s.id, lang)}</span></label>)}
      </fieldset>}
      <label className="check mem-active"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> <span>{t('mem.plan.active')}</span></label>
    </Modal>
  );
}

function PassModal({ pass, onClose }: { pass: Pass; onClose: () => void }) {
  const { t, data, dateTime, lang, can, date } = useApp();
  const p = (data.passes ?? []).find((x) => x.id === pass.id) ?? pass;
  const plan = planOf(data, p.planId);
  const [amount, setAmount] = useState('');
  const redeem = () => { const r = act(redeemPass, p.id, { amount: Number(amount) }); toast(r.ok ? t('mem.redeemed', { amount: money2(r.value.value) }) : t(err(r.reason)), !r.ok); if (r.ok) setAmount(''); };
  return (
    <Modal title={`${plan?.i18n?.[lang]?.name ?? plan?.name ?? t('mem.kind.gift_card')}${p.code ? ' · ' + p.code : ''}`} onClose={onClose} labelClose={t('common.close')}>
      <dl className="mem-facts">
        <dt>{t('mem.col.status')}</dt><dd><Badge tone={TONE[p.status]}>{t('mem.st.' + p.status)}</Badge></dd>
        <dt>{t('mem.col.sold')}</dt><dd>{money2(p.sold.amount)} · {t('m_' + p.sold.method)} · {dateTime(p.sold.at)}</dd>
        {p.kind === 'gift_card' ? <><dt>{t('mem.col.balance')}</dt><dd className="strong">{money2(p.balance)}</dd></> : <><dt>{t('mem.col.left')}</dt><dd>{p.visitsLeft === undefined ? t('mem.unlimited') : t('mem.left', { n: p.visitsLeft })}</dd></>}
        {p.renews && <><dt>{t('mem.col.renews')}</dt><dd>{date(p.renews)}</dd></>}
        {p.expires && <><dt>{t('mem.col.expires')}</dt><dd>{date(p.expires)}</dd></>}
        {p.note && !p.note.startsWith('reward:') && <><dt>{t('mem.note')}</dt><dd>{p.note}</dd></>}
      </dl>
      {p.kind === 'gift_card' && p.status === 'active' && can('write') && (
        <div className="mem-redeem"><Field label={t('mem.redeemAmount')} htmlFor="pm-a"><div className="ops-money"><span>$</span><input id="pm-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mem-redeem-amount" /></div></Field>
          <Button onClick={redeem} disabled={!Number(amount)} icon={<LuTicket aria-hidden="true" />} data-testid="mem-redeem">{t('mem.redeem')}</Button></div>
      )}
      <h3 className="mem-h">{t('mem.history')}</h3>
      {!p.uses.length ? <p className="small muted">{t('mem.noUses')}</p> : (
        <ul className="mem-uses">{[...p.uses].reverse().map((u) => (
          <li key={u.id}><span className="xs dim">{dateTime(u.at)}</span><span className="grow">{u.note === 'renewal' ? t('mem.use.renewal') : u.apptId ? t('mem.use.appt') : u.walkinId ? t('mem.use.walkin') : t('mem.use.desk')}</span><span className="num">{u.note === 'renewal' ? '+' + money2(Math.abs(u.amount ?? 0)) : money2(u.amount)}</span></li>
        ))}</ul>
      )}
      <p className="xs dim">{t('mem.ledgerNote')}</p>
    </Modal>
  );
}
