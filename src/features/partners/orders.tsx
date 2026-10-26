// Client Orders. Partners submit orders (from an accepted offer, or from published catalog items at their published
// prices), follow them, answer VYNTEX's questions and set their own follow-up dates. VYNTEX staff review, move orders
// through the documented states, write internal notes or partner-visible updates, assign an owner and record verified
// payments (administrators, with a fresh identity check). Every move is in the order's history.
import { useMemo, useState } from 'react';
import { LuArrowLeft, LuBriefcase, LuCheck, LuCreditCard, LuLock, LuPackage, LuPlus, LuSearchX, LuSend, LuTrash2, LuTriangleAlert, LuUserCheck } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate } from '@/app/router';
import { Badge, Button, Field, IconButton, Modal, Note, SearchBox, cx, toast } from '@/ui';
import { api, type Context, type Order, type OrderRow } from './api';
import { OrderContactFields } from './offers';
import { Failed, Loading, Status, isoDate, newKey, tx, usd, useErrorText, useLoad } from './shared';
import { AsyncButton, Chips, EmptyState, Facts, PageHead, Panel, SortTh, useSort } from './ui';

const OPEN = ['draft', 'submitted', 'under_review', 'info_required', 'approved', 'awaiting_payment', 'scheduled', 'in_progress', 'live', 'disputed'];
/** The moves VYNTEX can make from each state (the database checks the same list: partner.order_move_allowed). */
const NEXT: Record<string, string[]> = {
  submitted: ['under_review', 'info_required', 'rejected'], under_review: ['info_required', 'approved', 'rejected'], info_required: ['under_review', 'rejected', 'cancelled'],
  approved: ['awaiting_payment', 'cancelled'], awaiting_payment: ['scheduled', 'in_progress', 'cancelled', 'refunded'], scheduled: ['in_progress', 'cancelled', 'refunded'],
  in_progress: ['live', 'cancelled', 'refunded'], live: ['completed', 'cancelled', 'disputed', 'refunded'], completed: ['disputed', 'cancelled', 'refunded'],
  disputed: ['live', 'completed', 'cancelled', 'refunded'],
};
const NEEDS_NOTE = ['info_required', 'rejected', 'cancelled', 'disputed'];
/** The usual road of an order, drawn as steps on its page. A state off this road (rejected, cancelled...) shows only its chip. */
const ROAD = ['submitted', 'under_review', 'approved', 'awaiting_payment', 'in_progress', 'live', 'completed'];
const roadIndex = (s: string) => (s === 'info_required' ? 1 : s === 'scheduled' ? 4 : ROAD.indexOf(s));

export default function OrdersPage({ ctx, id }: { ctx: Context; id?: string }) {
  if (id === 'new' && ctx.kind === 'partner') return <NewOrder />;
  if (id) return <OrderDetail ctx={ctx} id={id} />;
  return <OrderList ctx={ctx} />;
}

function OrderList({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const staff = ctx.kind === 'staff';
  const data = useLoad(() => api.orders(), []);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState('open');
  const all = data.data?.orders ?? [];
  const list = useMemo(() => all.filter((o) => (filter === 'all' || (filter === 'open' ? OPEN.includes(o.status) : o.status === filter))
    && (!q.trim() || `${o.ref} ${o.client_name} ${o.partner} ${o.services}`.toLowerCase().includes(q.trim().toLowerCase()))), [all, q, filter]);
  const { sorted, sort, toggle } = useSort(list, { ref: (o) => o.ref, client: (o) => o.client_name, partner: (o) => o.partner, status: (o) => o.status, amount: (o) => o.setup_cents + o.one_time_cents,
    est: (o) => o.est_once_cents, updated: (o) => o.last_update || o.updated_at });
  const today = new Date().toISOString().slice(0, 10);
  const present = [...OPEN, 'completed', 'rejected', 'cancelled', 'refunded'].filter((s) => all.some((o) => o.status === s));
  return (
    <div className="pp-stack">
      <PageHead title={t('pp.nav.orders')} sub={t(staff ? 'pp.order.staffSub' : 'pp.order.sub')}
        actions={!staff ? <Button variant="primary" icon={<LuPlus />} onClick={() => navigate('/partners/orders/new')} data-testid="pp-order-new">{t('pp.order.new')}</Button> : undefined} />
      {data.error && <Failed text={data.error} retry={data.reload} />}
      <Panel flush title={t('pp.order.list')} count={data.data ? list.length : undefined}
        tools={<div className="pp-search"><SearchBox value={q} onChange={setQ} placeholder={t('pp.order.search')} label={t('pp.order.search')} /></div>}>
        {!data.data && !data.error ? <Loading kind="table" /> : <>
          {all.length > 0 && <div className="pp-panel-bar"><Chips label={t('pp.filter.status')} value={filter} onChange={setFilter} options={[
            { value: 'open', label: t('pp.order.open'), count: all.filter((o) => OPEN.includes(o.status)).length }, { value: 'all', label: t('pp.cat.all'), count: all.length },
            ...present.map((s) => ({ value: s, label: t('pp.st.' + s), count: all.filter((o) => o.status === s).length }))]} /></div>}
          {!all.length ? <EmptyState icon={<LuBriefcase />} title={t('pp.order.none')} body={!staff ? t('pp.order.noneBody') : undefined}
            action={!staff ? <Button variant="primary" icon={<LuPlus />} onClick={() => navigate('/partners/orders/new')}>{t('pp.order.new')}</Button> : undefined} />
          : !list.length ? <EmptyState icon={<LuSearchX />} title={t('pp.noMatch')} action={<Button size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('pp.clearFilters')}</Button>} /> : (
          <div className="pp-tw">
            <table className="tbl pp-table stackable" data-testid="pp-orders">
              <thead><tr><SortTh k="ref" sort={sort} onSort={toggle}>{t('pp.col.ref')}</SortTh><SortTh k="client" sort={sort} onSort={toggle}>{t('pp.col.client')}</SortTh>
                {staff && <SortTh k="partner" sort={sort} onSort={toggle}>{t('pp.col.partner')}</SortTh>}<th>{t('pp.col.services')}</th><SortTh k="status" sort={sort} onSort={toggle}>{t('pp.col.status')}</SortTh>
                <SortTh k="amount" sort={sort} onSort={toggle} num>{t('pp.col.amount')}</SortTh>{!staff && <SortTh k="est" sort={sort} onSort={toggle} num>{t('pp.col.estimate')}</SortTh>}
                <th>{t('pp.col.next')}</th><SortTh k="updated" sort={sort} onSort={toggle}>{t('pp.col.updated')}</SortTh></tr></thead>
              <tbody>
                {sorted.map((o: OrderRow) => (
                  <tr key={o.id} className="click" onClick={() => navigate('/partners/orders/' + o.id)}>
                    <td className="t1"><Link to={'/partners/orders/' + o.id} className="pp-ref">{o.ref}</Link></td>
                    <td data-label={t('pp.col.client')}><span className="pp-inline"><b>{o.client_name}</b>{staff && o.attribution && o.attribution !== 'clear' && o.attribution !== 'confirmed' && <Badge tone="bad">{t('pp.attr.' + o.attribution)}</Badge>}</span></td>
                    {staff && <td data-label={t('pp.col.partner')}>{o.partner}</td>}
                    <td className="small pp-services" data-label={t('pp.col.services')}>{o.services}</td>
                    <td data-label={t('pp.col.status')}><Status value={o.status} /></td>
                    <td className="num" data-label={t('pp.col.amount')}><span className="pp-cell2 end"><span>{usd(o.setup_cents + o.one_time_cents)}</span>{o.recurring_cents ? <span className="xs dim">+ {usd(o.recurring_cents)} {t('pp.per.month')}</span> : null}</span></td>
                    {!staff && <td className="num" data-label={t('pp.col.estimate')}>{o.est_once_cents !== null ? <b className="pp-earned">{usd(o.est_once_cents)}</b> : ''}</td>}
                    <td className="small" data-label={t('pp.col.next')}><span className="pp-cell2">{o.next_action && <span>{o.next_action}</span>}{o.follow_up_at && <span className={cx('xs', o.follow_up_at < today ? 'neg' : 'dim')}>{t('pp.order.followUp', { date: o.follow_up_at })}</span>}</span></td>
                    <td className="xs dim" data-label={t('pp.col.updated')}>{dateTime(o.last_update || o.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}</>}
      </Panel>
    </div>
  );
}

function NewOrder() {
  const { t, lang } = useApp();
  const errText = useErrorText();
  const cat = useLoad(() => api.catalog('partner'), []);
  const [client, setClient] = useState({ client_name: '', industry: '', requirements: '' });
  const [f, setF] = useState({ contact_name: '', contact_email: '', contact_phone: '', lead_source: '', timeline: '', consent: false, consent_note: '' });
  const [lines, setLines] = useState<{ item: string; quantity: number }[]>([]);
  const [pick, setPick] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  if (cat.error) return <Failed text={cat.error} retry={cat.reload} />;
  if (!cat.data) return <Loading kind="page" />;
  const priced = cat.data.catalog.items.filter((i) => !i.quote);
  const go = async (submit: boolean) => {
    if (!client.client_name.trim()) { setErr(t('pp.err.client_required')); return; }
    if (!lines.length) { setErr(t('pp.err.no_lines')); return; }
    if (!f.consent) { setErr(t('pp.err.consent_required')); return; }
    setBusy(true); setErr('');
    const r = await api.createOrder({ ...client, ...f, lines, idem_key: 'or-' + key, submit });
    setBusy(false);
    if (r.ok) { toast(t(submit ? 'pp.order.submitted' : 'pp.order.drafted', { ref: r.data.order.ref })); navigate('/partners/orders/' + r.data.order.id); } else setErr(errText(r));
  };
  return (
    <div className="pp-stack">
      <PageHead back={<Link to="/partners/orders" className="crumb"><LuArrowLeft aria-hidden="true" />{t('pp.nav.orders')}</Link>} title={t('pp.order.new')} sub={t('pp.order.newSub')} />
      <Panel title={t('pp.offer.client')}>
        <div className="fgrid">
          <Field label={t('pp.f.clientName')} htmlFor="no-c"><input id="no-c" value={client.client_name} maxLength={200} onChange={(e) => setClient({ ...client, client_name: e.target.value })} /></Field>
          <Field label={t('pp.f.industry')} htmlFor="no-i"><input id="no-i" value={client.industry} maxLength={80} onChange={(e) => setClient({ ...client, industry: e.target.value })} /></Field>
          <Field label={t('pp.f.requirements')} htmlFor="no-r" full><textarea id="no-r" rows={3} maxLength={4000} value={client.requirements} onChange={(e) => setClient({ ...client, requirements: e.target.value })} /></Field>
        </div>
        <div className="pp-divider" />
        <OrderContactFields f={f} setF={(p) => setF({ ...f, ...p })} />
      </Panel>
      <Panel title={t('pp.offer.services')} count={lines.length}>
        {!lines.length && <EmptyState compact icon={<LuPackage />} title={t('pp.offer.noLines')} />}
        <ul className="pp-lines">{lines.map((l, n) => { const it = priced.find((i) => i.id === l.item); return (
          <li key={l.item}><div className="grow"><b>{it ? tx(it.name, lang) : l.item}</b></div>
            <label className="pp-qtyl xs">{t('pp.f.qty')} <input type="number" min={1} max={50} className="pp-qty" value={l.quantity} onChange={(e) => setLines(lines.map((x, i) => (i === n ? { ...x, quantity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) } : x)))} /></label>
            <IconButton size="sm" label={t('pp.remove')} className="pp-del" onClick={() => setLines(lines.filter((_, i) => i !== n))}><LuTrash2 /></IconButton></li>); })}</ul>
        <div className="row nowrap pp-add">
          <select aria-label={t('pp.offer.add')} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('pp.offer.choose')}</option>
            {priced.filter((i) => !lines.some((l) => l.item === i.id)).map((i) => <option key={i.id} value={i.id}>{tx(i.name, lang)}</option>)}
          </select>
          <Button icon={<LuPlus />} disabled={!pick} onClick={() => { setLines([...lines, { item: pick, quantity: 1 }]); setPick(''); }}>{t('pp.offer.add')}</Button>
        </div>
        <p className="xs dim pp-gap">{t('pp.order.quoteViaOffer')}</p>
      </Panel>
      {err && <Note tone="bad"><span role="alert">{err}</span></Note>}
      <div className="pp-formbar"><span className="grow" /><Button disabled={busy} onClick={() => void go(false)}>{t('pp.order.saveDraft')}</Button><Button variant="primary" icon={<LuSend />} disabled={busy} aria-busy={busy || undefined} onClick={() => void go(true)}>{t('pp.order.submit')}</Button></div>
    </div>
  );
}

function OrderDetail({ ctx, id }: { ctx: Context; id: string }) {
  const { t, lang, dateTime } = useApp();
  const errText = useErrorText();
  const staff = ctx.kind === 'staff'; const admin = ctx.role === 'partner_admin';
  const data = useLoad(() => api.order(id), [id]);
  const [msg, setMsg] = useState(''); const [internal, setInternal] = useState(true);
  const [moving, setMoving] = useState<string | null>(null); const [paying, setPaying] = useState(false);
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading kind="page" />;
  const o: Order = data.data.order;
  const step = roadIndex(o.status);
  const set = (x: Order) => data.setData({ order: x });
  const send = async () => {
    if (!msg.trim()) return;
    const r = staff ? await api.admin.post<{ order: Order }>(`orders/${o.id}/note`, { body: msg, internal }) : await api.orderAction(o.id, 'message', { body: msg });
    if (r.ok) { set(r.data.order); setMsg(''); toast(t('pp.done')); } else toast(errText(r), true);
  };
  const partnerAct = async (action: string, body: Record<string, unknown> = {}) => {
    const r = await api.orderAction(o.id, action, body);
    if (r.ok) { set(r.data.order); toast(t('pp.done')); } else toast(errText(r), true);
  };
  const plan = async (p: Record<string, unknown>) => {
    const r = await api.admin.post<{ order: Order }>(`orders/${o.id}/plan`, p);
    if (r.ok) { set(r.data.order); toast(t('pp.done')); } else toast(errText(r), true);
  };
  return (
    <div className="pp-stack" data-testid="pp-order">
      <PageHead back={<Link to="/partners/orders" className="crumb"><LuArrowLeft aria-hidden="true" />{t('pp.nav.orders')}</Link>}
        eyebrow={o.ref} title={o.client_name}
        meta={<><Status value={o.status} />{staff && <span className="small muted">{o.partner.name} ({o.partner.code})</span>}{o.assigned && <span className="small muted pp-inline"><LuUserCheck aria-hidden="true" />{t('pp.order.owner', { name: o.assigned.name })}</span>}</>} />
      {step >= 0 && (
        <ol className="pp-road" aria-label={t('pp.order.progress')}>
          {ROAD.map((s, i) => <li key={s} className={cx(i < step && 'done', i === step && 'now')} aria-current={i === step ? 'step' : undefined}><span className="pp-road-d" aria-hidden="true">{i < step ? <LuCheck /> : i + 1}</span><span className="pp-road-t">{t('pp.st.' + s)}</span></li>)}
        </ol>
      )}
      {staff && o.duplicate_of && (
        <div className="pp-callout bad" role="note"><LuTriangleAlert aria-hidden="true" /><p className="grow">{t(o.attribution === 'conflict' ? 'pp.order.conflict' : 'pp.order.duplicate', { ref: o.duplicate_of.ref, partner: o.duplicate_of.partner })}</p>
          <AsyncButton size="sm" onClick={() => plan({ attribution: 'confirmed' })}>{t('pp.order.attrConfirm')}</AsyncButton></div>
      )}
      {!staff && o.status === 'info_required' && <div className="pp-callout warn" role="note"><LuTriangleAlert aria-hidden="true" /><p className="grow">{t('pp.order.infoNeeded')}</p></div>}
      <div className="pp-builder">
        <div className="pp-stack">
          <Panel title={t('pp.offer.services')} count={o.lines.length}>
            <ul className="pp-lines">{o.lines.map((l, n) => <li key={n}><div className="grow"><b>{l.quantity > 1 ? `${l.quantity} x ` : ''}{tx(l.name, lang)}</b></div>
              <span className="small pp-money">{[l.setup_cents + l.one_time_cents ? usd(l.setup_cents + l.one_time_cents) : '', l.recurring_cents ? `${usd(l.recurring_cents)} ${t('pp.per.month')}` : ''].filter(Boolean).join(' + ')}</span></li>)}</ul>
            <dl className="pp-prices">
              <div className="pp-price-row"><dt>{t('pp.price.setup')}</dt><dd>{usd(o.setup_cents + o.one_time_cents)}</dd></div>
              <div className="pp-price-row"><dt>{t('pp.price.recurring')}</dt><dd>{usd(o.recurring_cents)} {t('pp.per.month')}</dd></div>
              <div className="pp-price-row strong"><dt>{t('pp.offer.deposit')}</dt><dd>{usd(o.deposit_cents)}</dd></div>
            </dl>
          </Panel>
          <Panel title={t('pp.order.activity')} count={o.events.length}>
            <ol className="pp-timeline">
              {o.events.map((e, n) => (
                <li key={n} className={e.visibility === 'internal' ? 'internal' : undefined}>
                  <span className="xs dim pp-inline">{dateTime(e.at)} · {t('pp.by.' + e.actor_kind)}{e.visibility === 'internal' && <Badge tone="violet"><LuLock aria-hidden="true" />{t('pp.order.internal')}</Badge>}</span>
                  {e.kind === 'status' ? <span className="pp-inline">{t('pp.order.moved')} <Status value={e.to ?? ''} /></span> : null}
                  {e.kind === 'payment' ? <b>{t('pp.order.paymentRecorded')}</b> : null}
                  {e.body ? <p>{e.body}</p> : null}
                </li>
              ))}
            </ol>
            <div className="pp-msg">
              <Field label={staff ? t('pp.order.noteLabel') : t('pp.order.messageLabel')} htmlFor="om-b"><textarea id="om-b" rows={3} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="om-body" /></Field>
              <div className="pp-msg-f">
                {staff && <label className={cx('pp-toggle', internal && 'on')}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><LuLock aria-hidden="true" /><span>{t('pp.order.internalOnly')}</span></label>}
                <span className="grow" /><AsyncButton variant="primary" icon={<LuSend />} onClick={send} disabled={!msg.trim()} data-testid="om-send">{t('pp.order.send')}</AsyncButton>
              </div>
            </div>
          </Panel>
        </div>
        <aside className="pp-stack pp-aside">
          {staff && (
            <Panel title={t('pp.order.manage')} className="pp-manage">
              {(NEXT[o.status] ?? []).length > 0 && <>
                <p className="pp-label">{t('pp.order.nextMoves')}</p>
                <div className="pp-moves">{(NEXT[o.status] ?? []).filter((s) => admin || !['live', 'refunded'].includes(s)).map((s) => <Button key={s} size="sm" variant={s === 'approved' || s === 'live' ? 'primary' : ['rejected', 'cancelled', 'refunded', 'disputed'].includes(s) ? 'ghost' : undefined} className={['rejected', 'cancelled', 'refunded', 'disputed'].includes(s) ? 'pp-warnbtn' : undefined} onClick={() => setMoving(s)} data-testid={`om-move-${s}`}>{t('pp.st.' + s)}</Button>)}</div>
              </>}
              <Field label={t('pp.order.nextAction')} htmlFor="om-na"><input id="om-na" defaultValue={o.next_action} maxLength={400} onBlur={(e) => e.target.value !== o.next_action && void plan({ next_action: e.target.value })} /></Field>
              <Field label={t('pp.order.vyntexFollowUp')} htmlFor="om-vf"><input id="om-vf" type="date" defaultValue={isoDate(o.follow_up_at)} onChange={(e) => void plan({ follow_up_at: e.target.value })} /></Field>
              <div className="pp-btnrow">
                {ctx.user_id && o.assigned_to !== ctx.user_id && <AsyncButton size="sm" icon={<LuUserCheck />} onClick={() => plan({ assigned_to: ctx.user_id })}>{t('pp.order.assignMe')}</AsyncButton>}
                {o.assigned_to && <AsyncButton size="sm" variant="ghost" onClick={() => plan({ assigned_to: '' })}>{t('pp.order.unassign')}</AsyncButton>}
                {admin && !['draft', 'submitted', 'under_review', 'info_required', 'rejected'].includes(o.status) && <Button size="sm" icon={<LuCreditCard />} onClick={() => setPaying(true)} data-testid="om-pay">{t('pp.order.recordPayment')}</Button>}
              </div>
              {!!o.payments.length && (
                <div className="pp-pays"><p className="pp-label">{t('pp.order.payments')}</p>
                  <ul>{o.payments.map((p, n) => <li key={n}><span className="pp-cell2"><b>{t('pp.pay.' + p.kind)}{p.period ? ` ${p.period.slice(0, 7)}` : ''}</b><span className="xs dim">{p.received_on}{p.reference ? ` · ${p.reference}` : ''}</span></span><span className="pp-money">{usd(p.amount_cents)}</span></li>)}</ul></div>
              )}
            </Panel>
          )}
          {!staff && (
            <Panel title={t('pp.order.yourEstimate')} className="pp-totals">
              <div className="pp-earn"><p className="pp-earn-v"><b>{usd(o.est_once_cents ?? 0)}</b>{(o.est_monthly_cents ?? 0) > 0 && <> + <b>{usd(o.est_monthly_cents)}</b> <small>{t('pp.per.month')}</small></>}</p>
                <p className="xs dim">{t('pp.order.estimateNote')}</p></div>
              <Field label={t('pp.order.myFollowUp')} htmlFor="om-fu"><input id="om-fu" type="date" value={isoDate(o.partner_follow_up_at)} onChange={(e) => void partnerAct('follow-up', { date: e.target.value })} /></Field>
              {(o.status === 'draft' || o.status === 'submitted') && <div className="pp-btnrow">
                {o.status === 'draft' && <AsyncButton variant="primary" onClick={() => partnerAct('submit')}>{t('pp.order.submit')}</AsyncButton>}
                <AsyncButton variant="ghost" onClick={() => partnerAct('cancel', { reason: '' })}>{t('pp.order.withdraw')}</AsyncButton>
              </div>}
            </Panel>
          )}
          <Panel title={t('pp.order.client')}>
            <Facts items={[[t('pp.f.contact'), o.contact_name], [t('pp.f.email'), o.contact_email, !!o.contact_email], [t('pp.f.phone'), o.contact_phone, !!o.contact_phone],
              [t('pp.f.industry'), o.industry, !!o.industry], [t('pp.f.timeline'), o.timeline, !!o.timeline], [t('pp.f.source'), o.lead_source, !!o.lead_source],
              [t('pp.f.consentShort'), `${o.consent ? t('pp.yes') : t('pp.no')}${o.consent_note ? ` · ${o.consent_note}` : ''}`], [t('pp.order.liveOn'), o.live_at, !!o.live_at]]} />
            {o.requirements && <p className="small pp-req-text">{o.requirements}</p>}
          </Panel>
        </aside>
      </div>
      {moving && <MoveOrder order={o} to={moving} onClose={() => setMoving(null)} onDone={(x) => { set(x); setMoving(null); }} />}
      {paying && <Payment order={o} onClose={() => setPaying(false)} onDone={(x) => { set(x); setPaying(false); }} />}
    </div>
  );
}

function MoveOrder({ order, to, onClose, onDone }: { order: Order; to: string; onClose: () => void; onDone: (o: Order) => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [note, setNote] = useState(''); const [live, setLive] = useState(new Date().toISOString().slice(0, 10)); const [err, setErr] = useState('');
  const go = async () => {
    if (NEEDS_NOTE.includes(to) && note.trim().length < 3) { setErr(t('pp.err.note_required')); return; }
    const r = await api.admin.post<{ order: Order }>(`orders/${order.id}/move`, { to, note, live_on: to === 'live' ? live : undefined });
    if (r.ok) onDone(r.data.order); else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.order.moveTitle', { to: t('pp.st.' + to) })} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant={['rejected', 'cancelled', 'refunded', 'disputed'].includes(to) ? 'danger' : 'primary'} onClick={go} data-testid="mv-go">{t('pp.confirm')}</AsyncButton></>}>
      <p className="small muted">{t('pp.order.moveNote')}</p>
      {to === 'live' && <Field label={t('pp.order.liveOn')} htmlFor="mv-l"><input id="mv-l" type="date" value={live} onChange={(e) => setLive(e.target.value)} /></Field>}
      {to === 'live' && <p className="xs dim">{t('pp.order.liveNote')}</p>}
      <Field label={NEEDS_NOTE.includes(to) ? t('pp.order.why') : t('pp.order.noteOptional')} htmlFor="mv-n"><textarea id="mv-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

function Payment({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ kind: 'deposit', amount: '', period: '', received_on: new Date().toISOString().slice(0, 10), method: '', reference: '', note: '' });
  const [err, setErr] = useState('');
  const go = async () => {
    const cents = Math.round(Number(f.amount.replace(/[$,\s]/g, '')) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) { setErr(t('pp.err.bad_amount')); return; }
    if (!f.reference.trim()) { setErr(t('pp.err.reference_required')); return; }
    const r = await api.admin.post<{ order: Order }>(`orders/${order.id}/payment`, { kind: f.kind, amount_cents: cents, period: f.kind === 'monthly' ? (f.period || f.received_on) : undefined,
      received_on: f.received_on, method: f.method, reference: f.reference, note: f.note });
    if (r.ok) { toast(t('pp.order.paymentRecorded')); onDone(r.data.order); } else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.order.recordPayment')} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" onClick={go} data-testid="py-go">{t('pp.order.recordPayment')}</AsyncButton></>}>
      <Note>{t('pp.order.paymentNote')}</Note>
      <div className="fgrid">
        <Field label={t('pp.col.kind')} htmlFor="py-k"><select id="py-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['deposit', 'balance', 'one_time', 'monthly', 'refund', 'chargeback'].map((k) => <option key={k} value={k}>{t('pp.pay.' + k)}</option>)}</select></Field>
        <Field label={t('pp.col.amount')} htmlFor="py-a"><input id="py-a" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="py-amount" /></Field>
        {f.kind === 'monthly' && <Field label={t('pp.pay.period')} htmlFor="py-p"><input id="py-p" type="month" value={f.period.slice(0, 7)} onChange={(e) => setF({ ...f, period: e.target.value + '-01' })} /></Field>}
        <Field label={t('pp.pay.received')} htmlFor="py-r"><input id="py-r" type="date" value={f.received_on} onChange={(e) => setF({ ...f, received_on: e.target.value })} /></Field>
        <Field label={t('pp.pay.method')} htmlFor="py-m"><input id="py-m" value={f.method} maxLength={60} onChange={(e) => setF({ ...f, method: e.target.value })} /></Field>
        <Field label={t('pp.pay.reference')} htmlFor="py-f"><input id="py-f" value={f.reference} maxLength={200} onChange={(e) => setF({ ...f, reference: e.target.value })} data-testid="py-ref" /></Field>
        <Field label={t('pp.pol.noteLabel')} htmlFor="py-n" full><input id="py-n" value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}
