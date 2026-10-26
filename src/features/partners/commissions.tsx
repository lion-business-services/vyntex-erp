// Commissions & Payouts. A partner sees its statement: estimated (not earned), eligible, approved, payable, paid,
// held, reversed, each line with its order, service, policy version, base, rate, written calculation and history, and
// the payouts with their method, reference and dates. Nothing here can change a commission: a partner can only ask a
// question about a line. VYNTEX administrators approve, hold, reverse and adjust lines and run payouts (draft, approved,
// sent with a reference, settled with a reconciliation reference); the database requires a fresh identity check for money.
import { Fragment, useState } from 'react';
import { LuBadgeCheck, LuChevronRight, LuCircleDollarSign, LuClock, LuHandCoins, LuMessageCircleQuestion, LuPause, LuPlay, LuReceipt, LuReply, LuUndo2, LuWallet, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { Badge, Button, Field, Modal, Note, Tabs, confirmDialog, cx, toast } from '@/ui';
import { api, type Commission, type Context, type PartnerOrg, type Statement } from './api';
import { Failed, Loading, Status, pct, tx, usd, useErrorText, useLoad } from './shared';
import { AsyncButton, Chips, EmptyState, Kpi, PageHead, Panel, RowMenu } from './ui';

export default function CommissionsPage({ ctx }: { ctx: Context }) {
  const { t } = useApp();
  const staff = ctx.kind === 'staff';
  const [tab, setTab] = useState<'statement' | 'liability' | 'payouts'>(staff ? 'liability' : 'statement');
  return (
    <div className="pp-stack">
      <PageHead title={t('pp.nav.commissions')} sub={t(staff ? 'pp.com.staffSub' : 'pp.com.sub')} />
      {staff && <Tabs value={tab} onChange={setTab} tabs={[{ id: 'liability', label: t('pp.com.liability') }, { id: 'payouts', label: t('pp.com.payouts') }, { id: 'statement', label: t('pp.com.preview') }]} />}
      {tab === 'statement' && <StatementView ctx={ctx} />}
      {tab === 'liability' && staff && <Liability ctx={ctx} />}
      {tab === 'payouts' && staff && <Payouts ctx={ctx} />}
    </div>
  );
}

function StatementView({ ctx }: { ctx: Context }) {
  const { t } = useApp();
  const staff = ctx.kind === 'staff';
  const [as, setAs] = useState('');
  const partners = useLoad(() => (staff ? api.admin.get<{ partners: PartnerOrg[] }>('partners') : Promise.resolve({ ok: true as const, status: 200, data: { partners: [] as PartnerOrg[] } })), [staff]);
  const st = useLoad(() => (staff && !as ? Promise.resolve({ ok: true as const, status: 200, data: { statement: null as unknown as Statement } }) : api.statement(as || undefined)), [as, staff]);
  return (
    <div className="pp-stack">
      {staff && (
        <Field label={t('pp.cat.previewAs')} htmlFor="pc-as" full>
          <select id="pc-as" value={as} onChange={(e) => setAs(e.target.value)}><option value="">{t('pp.cat.previewNone')}</option>
            {(partners.data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select>
        </Field>
      )}
      {st.error && <Failed text={st.error} retry={st.reload} />}
      {!st.error && !st.data && <Loading kind="page" />}
      {staff && !as && <EmptyState icon={<LuReceipt />} title={t('pp.com.pickPartner')} />}
      {st.data?.statement && <StatementBody s={st.data.statement} canAsk={!staff} reload={st.reload} />}
    </div>
  );
}

function StatementBody({ s, canAsk, reload }: { s: Statement; canAsk: boolean; reload: () => void }) {
  const { t, dateTime, lang } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState<Commission | null>(null);
  const tt = s.totals;
  return (
    <>
      {(!s.partner.payout_eligible) && <div className="pp-callout warn" role="note"><LuClock aria-hidden="true" /><p className="grow">{t('pp.com.notEligible')}</p></div>}
      <div className="pp-kpis six">
        <Kpi label={t('pp.com.estimated')} value={tt.estimated_once_cents} format={usd} icon={<LuCircleDollarSign />} tone="accent" hint={tt.estimated_monthly_cents ? `+ ${usd(tt.estimated_monthly_cents)} ${t('pp.per.month')}` : t('pp.com.estimatedHint')} />
        <Kpi label={t('pp.st.eligible')} value={tt.eligible_cents} format={usd} icon={<LuHandCoins />} tone="warn" hint={t('pp.com.eligibleHint')} />
        <Kpi label={t('pp.st.approved')} value={tt.approved_cents} format={usd} icon={<LuBadgeCheck />} tone="ok" />
        <Kpi label={t('pp.st.payable')} value={tt.payable_cents} format={usd} icon={<LuReceipt />} tone="violet" />
        <Kpi label={t('pp.st.paid')} value={tt.paid_cents} format={usd} icon={<LuWallet />} tone="ok" hint={t('pp.com.paidHint')} />
        <Kpi label={t('pp.com.heldReversed')} value={tt.held_cents + tt.reversed_cents} format={usd} icon={<LuPause />} tone="bad" />
      </div>
      <Panel flush title={t('pp.com.lines')} count={s.lines.length}>
        {!s.lines.length ? <EmptyState icon={<LuReceipt />} title={t('pp.com.none')} body={t('pp.com.noneBody')} /> : (
          <div className="pp-tw">
            <table className="tbl pp-table stackable" data-testid="pp-com-lines">
              <thead><tr><th className="pp-exp-h"><span className="sr">{t('pp.details')}</span></th><th>{t('pp.col.order')}</th><th>{t('pp.col.kind')}</th><th>{t('pp.col.calc')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.col.status')}</th><th className="pp-actions-h"><span className="sr">{t('pp.col.actions')}</span></th></tr></thead>
              <tbody>
                {s.lines.map((c) => (
                  <Fragment key={c.id}>
                    <tr className={cx('click', open === c.id && 'open')} onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td className="pp-exp"><button type="button" className="pp-exp-b" aria-expanded={open === c.id} aria-label={t('pp.details')} onClick={(e) => { e.stopPropagation(); setOpen(open === c.id ? null : c.id); }}><LuChevronRight aria-hidden="true" /></button></td>
                      <td className="t1"><span className="pp-cell2">{c.order ? <Link to={'/partners/orders/' + c.order.id} className="pp-ref" onClick={(e) => e.stopPropagation()}>{c.order.ref}</Link> : '-'}<span className="xs dim">{c.order?.client}</span></span></td>
                      <td data-label={t('pp.col.kind')}><span className="pp-cell2"><span>{t('pp.ck.' + c.kind)}</span>{c.item ? <span className="xs dim">{tx(c.item, lang)}</span> : null}</span></td>
                      <td className="small" data-label={t('pp.col.calc')}>{c.calculation}</td>
                      <td className={'num pp-money ' + (c.amount_cents < 0 ? 'neg' : '')} data-label={t('pp.col.amount')}>{usd(c.amount_cents)}</td>
                      <td data-label={t('pp.col.status')}><span className="pp-cell2"><Status value={c.status} /><span className="xs dim">{dateTime(c.status_at)}</span></span></td>
                      <td className="pp-actions">{canAsk && <Button size="sm" variant="ghost" icon={<LuMessageCircleQuestion />} onClick={(e) => { e.stopPropagation(); setAsking(c); }}>{t('pp.com.ask')}</Button>}</td>
                    </tr>
                    {open === c.id && (
                      <tr className="pp-detail-row"><td colSpan={7}><LineDetail c={c} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel flush title={t('pp.com.payouts')} count={s.payouts.length}>
        {!s.payouts.length ? <EmptyState compact icon={<LuWallet />} title={t('pp.com.noPayouts')} /> : (
          <div className="pp-tw"><table className="tbl pp-table stackable"><thead><tr><th>{t('pp.col.ref')}</th><th>{t('pp.col.status')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.pay.method')}</th><th>{t('pp.pay.reference')}</th><th>{t('pp.com.sentOn')}</th><th>{t('pp.com.settledOn')}</th></tr></thead>
            <tbody>{s.payouts.map((p) => <tr key={p.id}><td className="t1"><span className="pp-ref">{p.ref}</span></td><td data-label={t('pp.col.status')}><Status value={p.status} /></td><td className="num pp-money" data-label={t('pp.col.amount')}>{usd(p.total_cents)}</td><td data-label={t('pp.pay.method')}>{p.method}</td><td data-label={t('pp.pay.reference')}>{p.reference}</td><td data-label={t('pp.com.sentOn')}>{p.sent_on ?? ''}</td><td data-label={t('pp.com.settledOn')}>{p.settled_on ?? ''}</td></tr>)}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title={t('pp.com.policies')} count={s.policies.length}>
        {!s.policies.length ? <EmptyState compact title={t('pp.com.noPolicies')} /> : (
          <ul className="pp-rules">{s.policies.map((p) => <li key={p.policy}><span className="pp-rule-v">{p.amount_cents !== null ? usd(p.amount_cents) : pct(p.rate_bps)}</span>
            <span className="pp-cell2"><b>{p.policy} <span className="pp-code">v{p.version}</span></b><span className="xs muted">{p.applies_to.join(', ')}{p.min_order_cents ? ` · ${t('pp.earn.min', { amount: usd(p.min_order_cents) })}` : ''}{p.clawback_days ? ` · ${t('pp.earn.clawback', { n: p.clawback_days })}` : ''}</span>
            {p.trigger ? <span className="xs dim">{p.trigger}</span> : null}</span></li>)}</ul>
        )}
        <p className="xs dim pp-gap">{t('pp.com.rules')}</p>
      </Panel>
      {asking && <Ask c={asking} onClose={() => setAsking(null)} onDone={() => { setAsking(null); reload(); }} />}
    </>
  );
}

function LineDetail({ c }: { c: Commission }) {
  const { t, dateTime } = useApp();
  return (
    <div className="pp-line-detail small">
      <dl className="kv pp-kv">
        {c.policy && <><dt>{t('pp.com.policy')}</dt><dd>{c.policy.id} v{c.policy.version} ({t('pp.model.' + c.policy.model)})</dd></>}
        {c.basis_cents !== null && <><dt>{t('pp.com.base')}</dt><dd>{usd(c.basis_cents)}{c.rate_bps !== null ? ` x ${pct(c.rate_bps)}` : ''}</dd></>}
        {c.period && <><dt>{t('pp.pay.period')}</dt><dd>{c.period.slice(0, 7)}</dd></>}
        {c.clawback_until && <><dt>{t('pp.com.clawbackUntil')}</dt><dd>{c.clawback_until}</dd></>}
        {c.reason && <><dt>{t('pp.com.reason')}</dt><dd>{c.reason}</dd></>}
        {c.payout && <><dt>{t('pp.com.payout')}</dt><dd>{c.payout.ref} · <Status value={c.payout.status} />{c.payout.reference ? ` · ${c.payout.method} ${c.payout.reference}` : ''}{c.payout.settled_on ? ` · ${c.payout.settled_on}` : ''}</dd></>}
      </dl>
      <ol className="pp-timeline">{c.history.map((h, n) => <li key={n}><span className="xs dim">{dateTime(h.at)} · {t('pp.by.' + h.by)}</span><b>{t('pp.st.' + h.status)}</b>{h.note ? <p>{h.note}</p> : null}</li>)}</ol>
    </div>
  );
}

function Ask({ c, onClose, onDone }: { c: Commission; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const go = async () => { const r = await api.inquiry(c.id, note); if (r.ok) { toast(t('pp.com.asked')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.com.askTitle')} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" onClick={go} disabled={note.trim().length < 3}>{t('pp.order.send')}</AsyncButton></>}>
      <p className="small muted">{c.calculation}</p>
      <Field label={t('pp.com.question')} htmlFor="ca-n"><textarea id="ca-n" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

interface AdminCommissions { lines: Commission[]; liability: { partner_id: string; partner: string; code: string; payout_eligible: boolean; eligible_cents: number; approved_cents: number; payable_cents: number; held_cents: number; paid_cents: number }[];
  payouts: { id: string; ref: string; partner: string; partner_id: string; status: string; total_cents: number; created_at: string; method: string; reference: string; sent_on: string | null; settled_on: string | null; settlement_reference: string; lines: number }[] }

function Liability({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const admin = ctx.role === 'partner_admin';
  const errText = useErrorText();
  const [status, setStatus] = useState('eligible');
  const data = useLoad(() => api.admin.get<{ commissions: AdminCommissions }>('commissions' + (status === 'all' ? '' : '?status=' + status)), [status]);
  const [acting, setActing] = useState<{ c: Commission; action: string } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const approve = async (c: Commission) => {
    const r = await api.admin.post(`commissions/${c.id}/set`, { action: 'approve' });
    if (r.ok) { toast(t('pp.done')); void data.reload(); } else toast(errText(r), true);
  };
  const payout = async (partnerId: string, name: string) => {
    if (!(await confirmDialog(t('pp.com.payoutAsk', { name }), t('pp.com.createPayout'), t('pp.cancel'), false))) return;
    const r = await api.admin.post('payouts', { partner: partnerId });
    if (r.ok) { toast(t('pp.com.payoutMade')); void data.reload(); } else toast(errText(r), true);
  };
  const d = data.data?.commissions;
  const total = (k: 'eligible_cents' | 'approved_cents' | 'payable_cents' | 'held_cents' | 'paid_cents') => (d ? d.liability.reduce((a, x) => a + (Number(x[k]) || 0), 0) : null);
  return (
    <div className="pp-stack">
      {data.error && <Failed text={data.error} retry={data.reload} />}
      <div className="pp-kpis five">
        <Kpi label={t('pp.st.eligible')} value={total('eligible_cents')} format={usd} icon={<LuHandCoins />} tone="warn" />
        <Kpi label={t('pp.st.approved')} value={total('approved_cents')} format={usd} icon={<LuBadgeCheck />} tone="ok" />
        <Kpi label={t('pp.st.payable')} value={total('payable_cents')} format={usd} icon={<LuReceipt />} tone="violet" />
        <Kpi label={t('pp.st.held')} value={total('held_cents')} format={usd} icon={<LuPause />} tone="bad" />
        <Kpi label={t('pp.st.paid')} value={total('paid_cents')} format={usd} icon={<LuWallet />} tone="ok" />
      </div>
      <Panel flush title={t('pp.com.byPartner')} count={d?.liability.length}>
        {!d ? <Loading kind="table" /> : !d.liability.length ? <EmptyState compact icon={<LuWallet />} title={t('pp.com.noLiability')} /> : (
        <div className="pp-tw"><table className="tbl pp-table stackable">
          <thead><tr><th>{t('pp.col.partner')}</th><th className="num">{t('pp.st.eligible')}</th><th className="num">{t('pp.st.approved')}</th><th className="num">{t('pp.st.payable')}</th><th className="num">{t('pp.st.held')}</th><th className="num">{t('pp.st.paid')}</th><th className="pp-actions-h"><span className="sr">{t('pp.col.actions')}</span></th></tr></thead>
          <tbody>{d.liability.map((p) => (
            <tr key={p.partner_id}><td className="t1"><span className="pp-inline"><b>{p.partner}</b><span className="pp-code">{p.code}</span>{!p.payout_eligible && <Badge tone="warn">{t('pp.com.w9Missing')}</Badge>}</span></td>
              <td className="num pp-money" data-label={t('pp.st.eligible')}>{usd(p.eligible_cents)}</td><td className="num pp-money" data-label={t('pp.st.approved')}>{usd(p.approved_cents)}</td><td className="num pp-money" data-label={t('pp.st.payable')}>{usd(p.payable_cents)}</td>
              <td className="num pp-money" data-label={t('pp.st.held')}>{usd(p.held_cents)}</td><td className="num pp-money" data-label={t('pp.st.paid')}>{usd(p.paid_cents)}</td>
              <td className="pp-actions">{admin && p.approved_cents > 0 && <AsyncButton size="sm" variant="primary" disabled={!p.payout_eligible} onClick={() => payout(p.partner_id, p.partner)}>{t('pp.com.createPayout')}</AsyncButton>}</td></tr>
          ))}</tbody>
        </table></div>)}
      </Panel>
      <Panel flush title={t('pp.com.lines')} count={d?.lines.length} tools={admin ? <Button icon={<LuCircleDollarSign />} onClick={() => setAdjusting(true)}>{t('pp.com.adjust')}</Button> : undefined}>
        <div className="pp-panel-bar"><Chips label={t('pp.filter.status')} value={status} onChange={setStatus}
          options={['eligible', 'approved', 'payable', 'held', 'disputed', 'paid', 'reversed', 'all'].map((s) => ({ value: s, label: s === 'all' ? t('pp.cat.all') : t('pp.st.' + s) }))} /></div>
        {!d ? <Loading kind="table" /> : !d.lines.length ? <EmptyState icon={<LuReceipt />} title={t('pp.com.none')} /> : (
          <div className="pp-tw"><table className="tbl pp-table stackable">
            <thead><tr><th>{t('pp.col.partner')}</th><th>{t('pp.col.order')}</th><th>{t('pp.col.calc')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.col.status')}</th><th className="pp-actions-h"><span className="sr">{t('pp.col.actions')}</span></th></tr></thead>
            <tbody>{d.lines.map((c) => (
              <tr key={c.id}>
                <td className="t1">{c.partner?.name}</td>
                <td data-label={t('pp.col.order')}><span className="pp-cell2">{c.order ? <Link to={'/partners/orders/' + c.order.id} className="pp-ref">{c.order.ref}</Link> : '-'}<span className="xs dim">{c.order?.client}</span></span></td>
                <td className="small" data-label={t('pp.col.calc')}><span className="pp-cell2"><span>{c.calculation}</span>{c.history.some((h) => h.status === 'inquiry') && <span className="pp-inline"><Badge tone="info">{t('pp.com.hasQuestion')}</Badge><span className="xs">{c.history.filter((h) => h.status === 'inquiry').slice(-1)[0]?.note}</span></span>}</span></td>
                <td className={'num pp-money ' + (c.amount_cents < 0 ? 'neg' : '')} data-label={t('pp.col.amount')}>{usd(c.amount_cents)}</td>
                <td data-label={t('pp.col.status')}><span className="pp-cell2"><Status value={c.status} /><span className="xs dim">{dateTime(c.status_at)}</span></span></td>
                <td className="pp-actions">{admin && <div className="pp-rowact">
                  {c.status === 'eligible' && <AsyncButton size="sm" variant="primary" onClick={() => approve(c)}>{t('pp.com.approve')}</AsyncButton>}
                  {['held', 'disputed'].includes(c.status) && <Button size="sm" icon={<LuPlay />} onClick={() => setActing({ c, action: 'release' })}>{t('pp.com.release')}</Button>}
                  <RowMenu label={t('pp.more')} items={[
                    { label: t('pp.com.hold'), icon: <LuPause aria-hidden="true" />, onSelect: () => setActing({ c, action: 'hold' }), hidden: !['eligible', 'approved'].includes(c.status) },
                    { label: t('pp.com.reply'), icon: <LuReply aria-hidden="true" />, onSelect: () => setActing({ c, action: 'reply' }) },
                    { label: t('pp.com.reverse'), icon: <LuUndo2 aria-hidden="true" />, danger: true, onSelect: () => setActing({ c, action: 'reverse' }), hidden: !(c.amount_cents > 0 && !['payable', 'reversed'].includes(c.status)) },
                  ]} />
                </div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {acting && <Act c={acting.c} action={acting.action} onClose={() => setActing(null)} onDone={() => { setActing(null); void data.reload(); }} />}
      {adjusting && <Adjust onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); void data.reload(); }} />}
    </div>
  );
}

function Act({ c, action, onClose, onDone }: { c: Commission; action: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post(`commissions/${c.id}/set`, { action, note }); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.com.act.' + action)} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant={action === 'reverse' ? 'danger' : 'primary'} onClick={go}>{t('pp.confirm')}</AsyncButton></>}>
      <p className="small muted">{c.calculation} · {usd(c.amount_cents)}</p>
      {action === 'reverse' && <Note tone="warn">{t('pp.com.reverseNote')}</Note>}
      <Field label={t('pp.com.reason')} htmlFor="ac-n"><textarea id="ac-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

function Adjust({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const partners = useLoad(() => api.admin.get<{ partners: PartnerOrg[] }>('partners'), []);
  const [f, setF] = useState({ partner: '', amount: '', reason: '' }); const [err, setErr] = useState('');
  const go = async () => {
    const cents = Math.round(Number(f.amount.replace(/[$,\s]/g, '')) * 100);
    if (!f.partner || !Number.isSafeInteger(cents) || cents === 0) { setErr(t('pp.err.bad_amount')); return; }
    const r = await api.admin.post('commissions/adjust', { partner: f.partner, amount_cents: cents, reason: f.reason });
    if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.com.adjust')} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" onClick={go}>{t('pp.confirm')}</AsyncButton></>}>
      <p className="small muted">{t('pp.com.adjustNote')}</p>
      <div className="fgrid">
        <Field label={t('pp.col.partner')} htmlFor="aj-p"><select id="aj-p" value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })}><option value="" />{(partners.data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={t('pp.com.adjustAmount')} htmlFor="aj-a"><input id="aj-a" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="-25.00" /></Field>
        <Field label={t('pp.com.reason')} htmlFor="aj-r" full><textarea id="aj-r" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

function Payouts({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const admin = ctx.role === 'partner_admin';
  const data = useLoad(() => api.admin.get<{ commissions: AdminCommissions }>('commissions?status=paid'), []);
  const [step, setStep] = useState<{ id: string; ref: string; step: string } | null>(null);
  const list = data.data?.commissions.payouts ?? [];
  return (
    <div className="pp-stack">
      <div className="pp-callout" role="note"><LuWallet aria-hidden="true" /><p className="grow">{t('pp.com.payoutNote')}</p></div>
      {data.error && <Failed text={data.error} retry={data.reload} />}
      <Panel flush title={t('pp.com.payouts')} count={data.data ? list.length : undefined}>
        {!data.data && !data.error ? <Loading kind="table" /> : !list.length ? <EmptyState icon={<LuWallet />} title={t('pp.com.noPayouts')} body={t('pp.com.noPayoutsBody')} /> : (
          <div className="pp-tw"><table className="tbl pp-table stackable">
            <thead><tr><th>{t('pp.col.ref')}</th><th>{t('pp.col.partner')}</th><th>{t('pp.col.status')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.pay.reference')}</th><th>{t('pp.col.updated')}</th><th className="pp-actions-h"><span className="sr">{t('pp.col.actions')}</span></th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}><td className="t1"><span className="pp-ref">{p.ref}</span></td><td data-label={t('pp.col.partner')}>{p.partner}</td><td data-label={t('pp.col.status')}><Status value={p.status} /></td>
                <td className="num" data-label={t('pp.col.amount')}><span className="pp-cell2 end"><span className="pp-money">{usd(p.total_cents)}</span><span className="xs dim">{t('pp.com.nLines', { n: p.lines })}</span></span></td>
                <td className="small" data-label={t('pp.pay.reference')}><span className="pp-cell2"><span>{p.method} {p.reference}</span>{p.settlement_reference ? <span className="xs dim">{p.settlement_reference}</span> : null}</span></td>
                <td className="xs dim" data-label={t('pp.col.updated')}>{p.settled_on ?? p.sent_on ?? dateTime(p.created_at)}</td>
                <td className="pp-actions">{admin && <div className="pp-rowact">
                  {p.status === 'draft' && <Button size="sm" variant="primary" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'approve' })}>{t('pp.com.step.approve')}</Button>}
                  {p.status === 'approved' && <Button size="sm" variant="primary" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'sent' })}>{t('pp.com.step.sent')}</Button>}
                  {p.status === 'sent' && <Button size="sm" variant="primary" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'settled' })}>{t('pp.com.step.settled')}</Button>}
                  <RowMenu label={t('pp.more')} items={[{ label: t('pp.com.step.cancel'), icon: <LuX aria-hidden="true" />, danger: true, onSelect: () => setStep({ id: p.id, ref: p.ref, step: 'cancel' }), hidden: !['draft', 'approved'].includes(p.status) }]} />
                </div>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {step && <PayoutStep {...step} onClose={() => setStep(null)} onDone={() => { setStep(null); void data.reload(); }} />}
    </div>
  );
}

function PayoutStep({ id, ref, step, onClose, onDone }: { id: string; ref: string; step: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ method: '', reference: '', date: new Date().toISOString().slice(0, 10), reason: '' }); const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post(`payouts/${id}/${step}`, f); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={`${t('pp.com.step.' + step)} · ${ref}`} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant={step === 'cancel' ? 'danger' : 'primary'} onClick={go}>{t('pp.confirm')}</AsyncButton></>}>
      <p className="small muted">{t('pp.com.stepNote.' + step)}</p>
      <div className="fgrid">
        {step === 'sent' && <Field label={t('pp.pay.method')} htmlFor="ps-m"><input id="ps-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="ACH, Zelle, check" /></Field>}
        {(step === 'sent' || step === 'settled') && <Field label={t(step === 'sent' ? 'pp.pay.reference' : 'pp.com.settlementRef')} htmlFor="ps-r"><input id="ps-r" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
        {(step === 'sent' || step === 'settled') && <Field label={t('pp.com.date')} htmlFor="ps-d"><input id="ps-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
        {step === 'cancel' && <Field label={t('pp.com.reason')} htmlFor="ps-c" full><input id="ps-c" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
      </div>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}
