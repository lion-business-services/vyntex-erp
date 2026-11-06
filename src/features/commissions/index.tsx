// Barber pay: each barber's week, worked out from the visits themselves. A share of what a shop client paid for the
// service, a higher share for a client the barber brought, every tip to the barber, and the chair rent taken off for a
// barber who rents. A week is paid once it is over, and the figures are frozen on the payout. The arithmetic is in
// src/domain/actions/shop.ts (statementFor), in whole cents.
import { useMemo, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuHandCoins, LuPrinter, LuScale } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { PageProps } from '@/app/routes';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, Field, Modal, Note, PageHeader, Stat, Tabs, cx, toast } from '@/ui';
import { barberOf, chairOf, payStatement, serviceName, setVisitExtras, statementFor, weekOf, type Statement } from '@/domain/actions/shop';
import type { PayMethod } from '@/domain/types';
import { addDaysFrom, today } from '@/lib/dates';
import { money2 } from '@/lib/money';
import './commissions.css';
import { PersonAvatar } from '@/app/person';

type Tab = 'week' | 'history' | 'rules';

export default function CommissionsPage(_: PageProps) {
  const { t, data, can, date } = useApp();
  const [from, setFrom] = useState(weekOf(addDaysFrom(today(), -7)).from);
  const [tab, setTab] = useState<Tab>('week');
  const [open, setOpen] = useState<string | null>(null);
  const to = weekOf(from).to;
  const over = to < today();
  const barbers = (data.chairs ?? []).filter((c) => c.staffId).map((c) => barberOf(data, c.staffId)!).filter(Boolean);
  const rows = useMemo(() => barbers.map((u) => statementFor(data, u.id, from)), [data, from, barbers]);
  const sum = (f: (s: Statement) => number) => rows.reduce((n, s) => n + Math.round(f(s) * 100), 0) / 100;
  const owner = (id: string) => data.users.find((u) => u.id === id)?.role === 'owner';
  const unpaid = rows.filter((s) => !s.paid && (s.visits || s.rent) && !owner(s.staffId));
  const mayPay = can('write') && can('payroll');
  return (
    <div className="pay">
      <PageHeader title={t('nav.commissions')} sub={t('pay.sub')} />
      <div className="pay-week" data-testid="pay-week">
        <Button size="sm" icon={<LuChevronLeft aria-hidden="true" />} onClick={() => setFrom(addDaysFrom(from, -7))} aria-label={t('pay.prev')}>{t('pay.prevShort')}</Button>
        <b>{t('pay.weekOf', { from: date(from), to: date(to) })}</b>
        <Button size="sm" onClick={() => setFrom(addDaysFrom(from, 7))} disabled={from >= weekOf(today()).from} aria-label={t('pay.next')}>{t('pay.nextShort')} <LuChevronRight aria-hidden="true" /></Button>
        {from !== weekOf(today()).from && <button type="button" className="linkbtn small" onClick={() => setFrom(weekOf(today()).from)}>{t('pay.thisWeek')}</button>}
        {!over && <Badge tone="info">{t('pay.inProgress')}</Badge>}
      </div>
      <div className="kpis pay-kpis">
        <Stat label={t('pay.k.services')} value={money2(sum((s) => s.services))} hint={t('pay.k.visits', { n: rows.reduce((n, s) => n + s.visits, 0) })} testId="pay-kpi-services" />
        <Stat label={t('pay.k.share')} value={money2(sum((s) => s.share))} hint={t('pay.k.shareHint')} testId="pay-kpi-share" />
        <Stat label={t('pay.k.shop')} value={money2(sum((s) => s.shop) + sum((s) => s.rent))} hint={t('pay.k.shopHint')} testId="pay-kpi-shop" />
        <Stat label={t('pay.k.tips')} value={money2(sum((s) => s.tips))} hint={t('pay.k.tipsHint')} testId="pay-kpi-tips" />
        <Stat label={t('pay.k.owed')} value={money2(unpaid.reduce((n, s) => n + Math.round(s.amount * 100), 0) / 100)} hint={over ? t('pay.k.owedHint', { n: unpaid.length }) : t('pay.k.owedOpen')} attention={over && unpaid.length > 0} testId="pay-kpi-owed" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'week', label: t('pay.tab.week') }, { id: 'history', label: t('pay.tab.history'), count: (data.payouts ?? []).length }, { id: 'rules', label: t('pay.tab.rules') }]} />
      {tab === 'week' && (
        <Card flush>
          {!rows.length ? <Empty title={t('pay.noBarbers')}>{t('pay.noBarbersHint')}</Empty> : (
            <div className="table-wrap"><table className="tbl stackable pay-tbl" data-testid="pay-table">
              <thead><tr><th>{t('pay.col.barber')}</th><th>{t('pay.col.how')}</th><th className="num">{t('pay.col.visits')}</th><th className="num">{t('pay.col.services')}</th><th className="num">{t('pay.col.share')}</th><th className="num">{t('pay.col.tips')}</th><th className="num">{t('pay.col.rent')}</th><th className="num">{t('pay.col.amount')}</th><th>{t('pay.col.state')}</th></tr></thead>
              <tbody>{rows.map((s) => {
                const u = barberOf(data, s.staffId)!; const ch = chairOf(data, s.staffId);
                return (
                  <tr key={s.staffId} data-barber={s.staffId}>
                    <td className="t1"><button type="button" className="pay-who linkbtn" onClick={() => setOpen(s.staffId)} data-testid="pay-open"><PersonAvatar user={u} name={u.name} size="sm" /><span>{u.name}</span></button></td>
                    <td data-label={t('pay.col.how')} className="small">{ch?.pay === 'rent' ? t('floor.pay.rentLine', { amount: money2(ch.rent) }) : t('floor.pay.splitLine', { split: ch?.split ?? 0, own: ch?.ownSplit ?? 0 })}</td>
                    <td data-label={t('pay.col.visits')} className="num">{s.visits}</td>
                    <td data-label={t('pay.col.services')} className="num">{money2(s.services)}</td>
                    <td data-label={t('pay.col.share')} className="num">{money2(s.share)}</td>
                    <td data-label={t('pay.col.tips')} className="num">{money2(s.tips)}</td>
                    <td data-label={t('pay.col.rent')} className="num">{s.rent ? '−' + money2(s.rent) : ''}</td>
                    <td data-label={t('pay.col.amount')} className={cx('num strong', s.amount < 0 && 'neg')}>{s.amount < 0 ? t('pay.owesShop', { amount: money2(-s.amount) }) : money2(s.amount)}</td>
                    <td data-label={t('pay.col.state')}>{u.role === 'owner' ? <span className="small muted">{t('pay.ownerKeeps')}</span> : s.paid ? <Badge tone="ok">{t('pay.paidOn', { date: date(s.paid.paidAt.slice(0, 10)) })}</Badge>
                      : !over ? <Badge>{t('pay.open')}</Badge>
                      : s.visits || s.rent ? (mayPay ? <Button size="sm" variant="primary" icon={<LuHandCoins aria-hidden="true" />} onClick={() => setOpen(s.staffId)} data-testid="pay-pay">{s.amount < 0 ? t('pay.settle') : t('pay.pay')}</Button> : <Badge tone="warn">{t('pay.notPaid')}</Badge>)
                      : <span className="small muted">{t('pay.nothing')}</span>}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr><td colSpan={2}>{t('common.total')}</td><td className="num">{rows.reduce((n, s) => n + s.visits, 0)}</td><td className="num">{money2(sum((s) => s.services))}</td><td className="num">{money2(sum((s) => s.share))}</td><td className="num">{money2(sum((s) => s.tips))}</td><td className="num">{money2(sum((s) => s.rent))}</td><td className="num">{money2(sum((s) => s.amount))}</td><td /></tr></tfoot>
            </table></div>
          )}
        </Card>
      )}
      {tab === 'history' && <History />}
      {tab === 'rules' && (
        <Card title={<><LuScale aria-hidden="true" /> {t('pay.rules.title')}</>}>
          <ul className="pay-rules">{['1', '2', '3', '4', '5', '6'].map((k) => <li key={k}>{t('pay.rules.' + k)}</li>)}</ul>
          <Note>{t('pay.rules.note')}</Note>
          {can('config') && <p className="small"><A to="/floor">{t('pay.rules.where')}</A></p>}
        </Card>
      )}
      {open && <StatementModal staffId={open} from={from} mayPay={mayPay && over && !owner(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function History() {
  const { t, data, date, dateTime } = useApp();
  const list = [...(data.payouts ?? [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  return (
    <Card flush>{!list.length ? <Empty title={t('pay.hist.none')} /> : (
      <div className="table-wrap"><table className="tbl stackable" data-testid="pay-history">
        <thead><tr><th>{t('pay.col.barber')}</th><th>{t('pay.col.week')}</th><th className="num">{t('pay.col.visits')}</th><th className="num">{t('pay.col.share')}</th><th className="num">{t('pay.col.tips')}</th><th className="num">{t('pay.col.rent')}</th><th className="num">{t('pay.col.amount')}</th><th>{t('pay.col.paid')}</th></tr></thead>
        <tbody>{list.map((p) => (
          <tr key={p.id}>
            <td className="t1">{barberOf(data, p.staffId)?.name}</td>
            <td data-label={t('pay.col.week')}>{t('pay.range', { from: date(p.from), to: date(p.to) })}</td>
            <td data-label={t('pay.col.visits')} className="num">{p.visits}</td>
            <td data-label={t('pay.col.share')} className="num">{money2(p.share)}</td>
            <td data-label={t('pay.col.tips')} className="num">{money2(p.tips)}</td>
            <td data-label={t('pay.col.rent')} className="num">{p.rent ? '−' + money2(p.rent) : ''}</td>
            <td data-label={t('pay.col.amount')} className={cx('num strong', p.amount < 0 && 'neg')}>{p.amount < 0 ? t('pay.owesShop', { amount: money2(-p.amount) }) : money2(p.amount)}</td>
            <td data-label={t('pay.col.paid')} className="small">{dateTime(p.paidAt)} · {t('m_' + p.method)}<div className="xs dim">{t('pay.by', { name: data.users.find((u) => u.id === p.by)?.name ?? '' })}</div></td>
          </tr>
        ))}</tbody>
      </table></div>
    )}</Card>
  );
}

function StatementModal({ staffId, from, mayPay, onClose }: { staffId: string; from: string; mayPay: boolean; onClose: () => void }) {
  const { t, data, date, lang } = useApp();
  const s = statementFor(data, staffId, from);
  const u = barberOf(data, staffId)!;
  const [method, setMethod] = useState<PayMethod>('transfer');
  const pay = () => { const r = act(payStatement, staffId, from, method); toast(r.ok ? t('pay.paidToast', { name: u.name, amount: money2(r.value.amount) }) : t('pay.err.' + r.reason), !r.ok); if (r.ok) onClose(); };
  const toggleOwn = (apptId: string, own: boolean) => { const r = act(setVisitExtras, apptId, { own }); if (!r.ok) toast(t('floor.err.failed'), true); };
  return (
    <Modal title={t('pay.statement', { name: u.name })} onClose={onClose} labelClose={t('common.close')} size="wide" footer={<>
      <Button icon={<LuPrinter aria-hidden="true" />} onClick={() => window.print()}>{t('pay.print')}</Button>
      <span className="grow" />
      {!s.paid && mayPay && (s.visits > 0 || s.rent > 0) && <>
        <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)} aria-label={t('floor.pay.method')}>{(['transfer', 'zelle', 'cash', 'check'] as PayMethod[]).map((m) => <option key={m} value={m}>{t('m_' + m)}</option>)}</select>
        <Button variant="primary" icon={<LuHandCoins aria-hidden="true" />} onClick={pay} data-testid="pay-confirm">{s.amount < 0 ? t('pay.settle') : t('pay.payAmount', { amount: money2(s.amount) })}</Button>
      </>}
    </>}>
      <div className="pay-stmt" data-testid="pay-statement">
        <p className="small muted">{t('pay.weekOf', { from: date(s.from), to: date(s.to) })} · {s.pay === 'rent' ? t('floor.pay.rentLine', { amount: money2(s.rent) }) : t('floor.pay.splitLine', { split: chairOf(data, staffId)?.split ?? 0, own: chairOf(data, staffId)?.ownSplit ?? 0 })}</p>
        {s.paid && <Note>{t('pay.frozen', { date: date(s.paid.paidAt.slice(0, 10)), amount: money2(s.paid.amount) })}</Note>}
        {!s.lines.length ? <p className="small">{t('pay.noVisits')}</p> : (
          <div className="table-wrap"><table className="tbl stackable">
            <thead><tr><th>{t('common.date')}</th><th>{t('floor.col.client')}</th><th>{t('floor.f.service')}</th><th className="num">{t('pay.col.services')}</th><th className="num">{t('pay.col.rate')}</th><th className="num">{t('pay.col.share')}</th><th className="num">{t('pay.col.tips')}</th></tr></thead>
            <tbody>{s.lines.map((l) => (
              <tr key={l.kind + l.id}>
                <td className="t1 nowrap">{date(l.date)}</td>
                <td data-label={t('floor.col.client')}>{l.name}<div className="xs dim">{t(l.kind === 'walkin' ? 'pay.walkin' : 'pay.appt')}{l.passId ? ' · ' + t('pay.byPass') : ''}</div></td>
                <td data-label={t('floor.f.service')}>{serviceName(data, l.serviceId, lang)}</td>
                <td data-label={t('pay.col.services')} className="num">{money2(l.amount)}</td>
                <td data-label={t('pay.col.rate')} className="num">{l.kind === 'appointment' && !s.paid && s.pay === 'commission' && mayPay
                  ? <label className="pay-own" title={t('pay.ownHint')}><input type="checkbox" checked={l.own} onChange={(e) => toggleOwn(l.id, e.target.checked)} /> {l.rate}%{l.own ? ' ' + t('pay.ownShort') : ''}</label>
                  : <>{l.rate}%{l.own ? ' ' + t('pay.ownShort') : ''}</>}</td>
                <td data-label={t('pay.col.share')} className="num">{money2(l.earned)}</td>
                <td data-label={t('pay.col.tips')} className="num">{money2(l.tip)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <dl className="pay-sum">
          <dt>{t('pay.col.services')}</dt><dd>{money2(s.services)}</dd>
          <dt>{t('pay.col.share')}</dt><dd>{money2(s.share)}</dd>
          <dt>{t('pay.col.tips')}</dt><dd>{money2(s.tips)}</dd>
          {s.rent > 0 && <><dt>{t('pay.col.rent')}</dt><dd>−{money2(s.rent)}</dd></>}
          <dt className="strong">{s.amount < 0 ? t('pay.owesShopTitle') : t('pay.col.amount')}</dt><dd className="strong">{money2(Math.abs(s.amount))}</dd>
        </dl>
        <p className="xs dim">{t('pay.stmtNote')}</p>
      </div>
    </Modal>
  );
}
