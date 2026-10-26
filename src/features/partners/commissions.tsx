// Commissions & Payouts. A partner sees its statement: estimated (not earned), eligible, approved, payable, paid,
// held, reversed, each line with its order, service, policy version, base, rate, written calculation and history, and
// the payouts with their method, reference and dates. Nothing here can change a commission: a partner can only ask a
// question about a line. VYNTEX administrators approve, hold, reverse and adjust lines and run payouts (draft, approved,
// sent with a reference, settled with a reconciliation reference); the database requires a fresh identity check for money.
import { Fragment, useState } from 'react';
import { LuMessageCircleQuestion } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { Badge, Button, Card, Field, Modal, Note, Stat, Tabs, confirmDialog, toast } from '@/ui';
import { api, type Commission, type Context, type PartnerOrg, type Statement } from './api';
import { Failed, Loading, Status, pct, tx, usd, useErrorText, useLoad } from './shared';

export default function CommissionsPage({ ctx }: { ctx: Context }) {
  const { t } = useApp();
  const staff = ctx.kind === 'staff';
  const [tab, setTab] = useState<'statement' | 'liability' | 'payouts'>(staff ? 'liability' : 'statement');
  return (
    <div className="pp-stack">
      <div className="pp-hero"><h1>{t('pp.nav.commissions')}</h1><p className="muted">{t(staff ? 'pp.com.staffSub' : 'pp.com.sub')}</p></div>
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
        <Field label={t('pp.cat.previewAs')} htmlFor="pc-as">
          <select id="pc-as" value={as} onChange={(e) => setAs(e.target.value)}><option value="">{t('pp.cat.previewNone')}</option>
            {(partners.data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select>
        </Field>
      )}
      {st.error && <Failed text={st.error} retry={st.reload} />}
      {!st.error && !st.data && <Loading />}
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
      {(!s.partner.payout_eligible) && <Note tone="warn">{t('pp.com.notEligible')}</Note>}
      <div className="pp-stats six">
        <Stat label={t('pp.com.estimated')} value={usd(tt.estimated_once_cents)} hint={tt.estimated_monthly_cents ? `+ ${usd(tt.estimated_monthly_cents)} ${t('pp.per.month')}` : t('pp.com.estimatedHint')} />
        <Stat label={t('pp.st.eligible')} value={usd(tt.eligible_cents)} hint={t('pp.com.eligibleHint')} />
        <Stat label={t('pp.st.approved')} value={usd(tt.approved_cents)} />
        <Stat label={t('pp.st.payable')} value={usd(tt.payable_cents)} />
        <Stat label={t('pp.st.paid')} value={usd(tt.paid_cents)} hint={t('pp.com.paidHint')} />
        <Stat label={t('pp.com.heldReversed')} value={usd(tt.held_cents + tt.reversed_cents)} />
      </div>
      <Card flush title={t('pp.com.lines')}>
        {!s.lines.length ? <div className="pp-pad"><p className="small muted">{t('pp.com.none')}</p></div> : (
          <div className="table-wrap">
            <table className="tbl" data-testid="pp-com-lines">
              <thead><tr><th>{t('pp.col.order')}</th><th>{t('pp.col.kind')}</th><th>{t('pp.col.calc')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.col.status')}</th><th /></tr></thead>
              <tbody>
                {s.lines.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="click" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td>{c.order ? <Link to={'/partners/orders/' + c.order.id}>{c.order.ref}</Link> : '-'}<br /><span className="xs dim">{c.order?.client}</span></td>
                      <td>{t('pp.ck.' + c.kind)}{c.item ? <><br /><span className="xs dim">{tx(c.item, lang)}</span></> : null}</td>
                      <td className="small">{c.calculation}</td>
                      <td className={'num ' + (c.amount_cents < 0 ? 'neg' : '')}>{usd(c.amount_cents)}</td>
                      <td><Status value={c.status} /><br /><span className="xs dim">{dateTime(c.status_at)}</span></td>
                      <td>{canAsk && <Button size="sm" variant="ghost" icon={<LuMessageCircleQuestion />} onClick={(e) => { e.stopPropagation(); setAsking(c); }}>{t('pp.com.ask')}</Button>}</td>
                    </tr>
                    {open === c.id && (
                      <tr><td colSpan={6}><LineDetail c={c} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card flush title={t('pp.com.payouts')}>
        {!s.payouts.length ? <div className="pp-pad"><p className="small muted">{t('pp.com.noPayouts')}</p></div> : (
          <table className="tbl"><thead><tr><th>{t('pp.col.ref')}</th><th>{t('pp.col.status')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.pay.method')}</th><th>{t('pp.pay.reference')}</th><th>{t('pp.com.sentOn')}</th><th>{t('pp.com.settledOn')}</th></tr></thead>
            <tbody>{s.payouts.map((p) => <tr key={p.id}><td>{p.ref}</td><td><Status value={p.status} /></td><td className="num">{usd(p.total_cents)}</td><td>{p.method}</td><td>{p.reference}</td><td>{p.sent_on ?? ''}</td><td>{p.settled_on ?? ''}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title={t('pp.com.policies')}>
        {!s.policies.length ? <p className="small muted">{t('pp.com.noPolicies')}</p> : (
          <ul className="small">{s.policies.map((p) => <li key={p.policy}><b>{p.policy} v{p.version}</b>: {p.amount_cents !== null ? usd(p.amount_cents) : pct(p.rate_bps)} · {p.applies_to.join(', ')}
            {p.min_order_cents ? ` · ${t('pp.earn.min', { amount: usd(p.min_order_cents) })}` : ''}{p.clawback_days ? ` · ${t('pp.earn.clawback', { n: p.clawback_days })}` : ''}{p.trigger ? <><br /><span className="xs muted">{p.trigger}</span></> : null}</li>)}</ul>
        )}
        <p className="xs dim">{t('pp.com.rules')}</p>
      </Card>
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
      <ol className="pp-timeline">{c.history.map((h, n) => <li key={n}><span className="xs dim">{dateTime(h.at)} · {t('pp.by.' + h.by)}</span> <b>{t('pp.st.' + h.status)}</b>{h.note ? `: ${h.note}` : ''}</li>)}</ol>
    </div>
  );
}

function Ask({ c, onClose, onDone }: { c: Commission; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const go = async () => { const r = await api.inquiry(c.id, note); if (r.ok) { toast(t('pp.com.asked')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.com.askTitle')} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{c.calculation}</p>
      <Field label={t('pp.com.question')} htmlFor="ca-n"><textarea id="ca-n" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()} disabled={note.trim().length < 3}>{t('pp.order.send')}</Button></div>
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
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const d = data.data.commissions;
  const approve = async (c: Commission) => {
    const r = await api.admin.post(`commissions/${c.id}/set`, { action: 'approve' });
    if (r.ok) { toast(t('pp.done')); void data.reload(); } else toast(errText(r), true);
  };
  const payout = async (partnerId: string, name: string) => {
    if (!(await confirmDialog(t('pp.com.payoutAsk', { name }), t('pp.com.createPayout'), t('pp.cancel'), false))) return;
    const r = await api.admin.post('payouts', { partner: partnerId });
    if (r.ok) { toast(t('pp.com.payoutMade')); void data.reload(); } else toast(errText(r), true);
  };
  return (
    <div className="pp-stack">
      <Card flush title={t('pp.com.byPartner')}>
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>{t('pp.col.partner')}</th><th className="num">{t('pp.st.eligible')}</th><th className="num">{t('pp.st.approved')}</th><th className="num">{t('pp.st.payable')}</th><th className="num">{t('pp.st.held')}</th><th className="num">{t('pp.st.paid')}</th><th /></tr></thead>
          <tbody>{d.liability.map((p) => (
            <tr key={p.partner_id}><td>{p.partner} <span className="xs dim">{p.code}</span>{!p.payout_eligible && <><br /><Badge tone="warn">{t('pp.com.w9Missing')}</Badge></>}</td>
              <td className="num">{usd(p.eligible_cents)}</td><td className="num">{usd(p.approved_cents)}</td><td className="num">{usd(p.payable_cents)}</td><td className="num">{usd(p.held_cents)}</td><td className="num">{usd(p.paid_cents)}</td>
              <td>{admin && p.approved_cents > 0 && <Button size="sm" variant="primary" disabled={!p.payout_eligible} onClick={() => void payout(p.partner_id, p.partner)}>{t('pp.com.createPayout')}</Button>}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card flush title={t('pp.com.lines')} actions={<div className="row">
        <select aria-label={t('pp.filter.status')} value={status} onChange={(e) => setStatus(e.target.value)}>{['eligible', 'approved', 'payable', 'held', 'disputed', 'paid', 'reversed', 'all'].map((s) => <option key={s} value={s}>{s === 'all' ? t('pp.cat.all') : t('pp.st.' + s)}</option>)}</select>
        {admin && <Button onClick={() => setAdjusting(true)}>{t('pp.com.adjust')}</Button>}
      </div>}>
        {!d.lines.length ? <div className="pp-pad"><p className="small muted">{t('pp.com.none')}</p></div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>{t('pp.col.partner')}</th><th>{t('pp.col.order')}</th><th>{t('pp.col.calc')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.col.status')}</th><th /></tr></thead>
            <tbody>{d.lines.map((c) => (
              <tr key={c.id}>
                <td>{c.partner?.name}</td>
                <td>{c.order ? <Link to={'/partners/orders/' + c.order.id}>{c.order.ref}</Link> : '-'}<br /><span className="xs dim">{c.order?.client}</span></td>
                <td className="small">{c.calculation}{c.history.some((h) => h.status === 'inquiry') && <><br /><Badge tone="info">{t('pp.com.hasQuestion')}</Badge> <span className="xs">{c.history.filter((h) => h.status === 'inquiry').slice(-1)[0]?.note}</span></>}</td>
                <td className={'num ' + (c.amount_cents < 0 ? 'neg' : '')}>{usd(c.amount_cents)}</td>
                <td><Status value={c.status} /><br /><span className="xs dim">{dateTime(c.status_at)}</span></td>
                <td className="nowrap">{admin && <>
                  {c.status === 'eligible' && <Button size="sm" variant="primary" onClick={() => void approve(c)}>{t('pp.com.approve')}</Button>}
                  {['eligible', 'approved'].includes(c.status) && <Button size="sm" onClick={() => setActing({ c, action: 'hold' })}>{t('pp.com.hold')}</Button>}
                  {['held', 'disputed'].includes(c.status) && <Button size="sm" onClick={() => setActing({ c, action: 'release' })}>{t('pp.com.release')}</Button>}
                  {c.amount_cents > 0 && !['payable', 'reversed'].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => setActing({ c, action: 'reverse' })}>{t('pp.com.reverse')}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setActing({ c, action: 'reply' })}>{t('pp.com.reply')}</Button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
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
    <Modal title={t('pp.com.act.' + action)} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{c.calculation} · {usd(c.amount_cents)}</p>
      {action === 'reverse' && <Note tone="warn">{t('pp.com.reverseNote')}</Note>}
      <Field label={t('pp.com.reason')} htmlFor="ac-n"><textarea id="ac-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()}>{t('pp.confirm')}</Button></div>
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
    <Modal title={t('pp.com.adjust')} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.com.adjustNote')}</p>
      <div className="fgrid">
        <Field label={t('pp.col.partner')} htmlFor="aj-p"><select id="aj-p" value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })}><option value="" />{(partners.data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={t('pp.com.adjustAmount')} htmlFor="aj-a"><input id="aj-a" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="-25.00" /></Field>
        <Field label={t('pp.com.reason')} htmlFor="aj-r" full><textarea id="aj-r" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()}>{t('pp.confirm')}</Button></div>
    </Modal>
  );
}

function Payouts({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const admin = ctx.role === 'partner_admin';
  const data = useLoad(() => api.admin.get<{ commissions: AdminCommissions }>('commissions?status=paid'), []);
  const [step, setStep] = useState<{ id: string; ref: string; step: string } | null>(null);
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const list = data.data.commissions.payouts;
  return (
    <Card flush title={t('pp.com.payouts')}>
      <div className="pp-pad"><Note>{t('pp.com.payoutNote')}</Note></div>
      {!list.length ? <div className="pp-pad"><p className="small muted">{t('pp.com.noPayouts')}</p></div> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>{t('pp.col.ref')}</th><th>{t('pp.col.partner')}</th><th>{t('pp.col.status')}</th><th className="num">{t('pp.col.amount')}</th><th>{t('pp.pay.reference')}</th><th>{t('pp.col.updated')}</th><th /></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id}><td>{p.ref}</td><td>{p.partner}</td><td><Status value={p.status} /></td><td className="num">{usd(p.total_cents)}<br /><span className="xs dim">{t('pp.com.nLines', { n: p.lines })}</span></td>
              <td className="small">{p.method} {p.reference}{p.settlement_reference ? <><br /><span className="xs dim">{p.settlement_reference}</span></> : null}</td>
              <td className="xs dim">{p.settled_on ?? p.sent_on ?? dateTime(p.created_at)}</td>
              <td className="nowrap">{admin && <>
                {p.status === 'draft' && <Button size="sm" variant="primary" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'approve' })}>{t('pp.com.step.approve')}</Button>}
                {p.status === 'approved' && <Button size="sm" variant="primary" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'sent' })}>{t('pp.com.step.sent')}</Button>}
                {p.status === 'sent' && <Button size="sm" variant="primary" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'settled' })}>{t('pp.com.step.settled')}</Button>}
                {['draft', 'approved'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => setStep({ id: p.id, ref: p.ref, step: 'cancel' })}>{t('pp.com.step.cancel')}</Button>}
              </>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {step && <PayoutStep {...step} onClose={() => setStep(null)} onDone={() => { setStep(null); void data.reload(); }} />}
    </Card>
  );
}

function PayoutStep({ id, ref, step, onClose, onDone }: { id: string; ref: string; step: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ method: '', reference: '', date: new Date().toISOString().slice(0, 10), reason: '' }); const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post(`payouts/${id}/${step}`, f); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={`${t('pp.com.step.' + step)} · ${ref}`} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.com.stepNote.' + step)}</p>
      <div className="fgrid">
        {step === 'sent' && <Field label={t('pp.pay.method')} htmlFor="ps-m"><input id="ps-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="ACH, Zelle, check" /></Field>}
        {(step === 'sent' || step === 'settled') && <Field label={t(step === 'sent' ? 'pp.pay.reference' : 'pp.com.settlementRef')} htmlFor="ps-r"><input id="ps-r" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
        {(step === 'sent' || step === 'settled') && <Field label={t('pp.com.date')} htmlFor="ps-d"><input id="ps-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
        {step === 'cancel' && <Field label={t('pp.com.reason')} htmlFor="ps-c" full><input id="ps-c" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
      </div>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()}>{t('pp.confirm')}</Button></div>
    </Modal>
  );
}
