// Client Orders. Partners submit orders (from an accepted offer, or from published catalog items at their published
// prices), follow them, answer VYNTEX's questions and set their own follow-up dates. VYNTEX staff review, move orders
// through the documented states, write internal notes or partner-visible updates, assign an owner and record verified
// payments (administrators, with a fresh identity check). Every move is in the order's history.
import { useMemo, useState } from 'react';
import { LuPlus, LuSend, LuTriangleAlert } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate } from '@/app/router';
import { Badge, Button, Card, Field, Modal, Note, SearchBox, toast } from '@/ui';
import { api, type Context, type Order, type OrderRow } from './api';
import { OrderContactFields } from './offers';
import { Failed, Loading, Status, isoDate, newKey, tx, usd, useErrorText, useLoad } from './shared';

const OPEN = ['draft', 'submitted', 'under_review', 'info_required', 'approved', 'awaiting_payment', 'scheduled', 'in_progress', 'live', 'disputed'];
/** The moves VYNTEX can make from each state (the database checks the same list: partner.order_move_allowed). */
const NEXT: Record<string, string[]> = {
  submitted: ['under_review', 'info_required', 'rejected'], under_review: ['info_required', 'approved', 'rejected'], info_required: ['under_review', 'rejected', 'cancelled'],
  approved: ['awaiting_payment', 'cancelled'], awaiting_payment: ['scheduled', 'in_progress', 'cancelled', 'refunded'], scheduled: ['in_progress', 'cancelled', 'refunded'],
  in_progress: ['live', 'cancelled', 'refunded'], live: ['completed', 'cancelled', 'disputed', 'refunded'], completed: ['disputed', 'cancelled', 'refunded'],
  disputed: ['live', 'completed', 'cancelled', 'refunded'],
};
const NEEDS_NOTE = ['info_required', 'rejected', 'cancelled', 'disputed'];

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
  const list = useMemo(() => (data.data?.orders ?? []).filter((o) => (filter === 'all' || (filter === 'open' ? OPEN.includes(o.status) : o.status === filter))
    && (!q.trim() || `${o.ref} ${o.client_name} ${o.partner} ${o.services}`.toLowerCase().includes(q.trim().toLowerCase()))), [data.data, q, filter]);
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="pp-stack">
      <div className="pp-hero"><h1>{t('pp.nav.orders')}</h1><p className="muted">{t(staff ? 'pp.order.staffSub' : 'pp.order.sub')}</p></div>
      <Card flush title={t('pp.order.list')} actions={<div className="row">
        <div className="pp-search"><SearchBox value={q} onChange={setQ} placeholder={t('pp.order.search')} label={t('pp.order.search')} /></div>
        <select aria-label={t('pp.filter.status')} value={filter} onChange={(e) => setFilter(e.target.value)}>
          {['open', 'all', ...OPEN, 'completed', 'rejected', 'cancelled', 'refunded'].map((s) => <option key={s} value={s}>{s === 'open' ? t('pp.order.open') : s === 'all' ? t('pp.cat.all') : t('pp.st.' + s)}</option>)}
        </select>
        {!staff && <Button variant="primary" icon={<LuPlus />} onClick={() => navigate('/partners/orders/new')} data-testid="pp-order-new">{t('pp.order.new')}</Button>}
      </div>}>
        {!list.length ? <div className="pp-pad"><p className="small muted">{t('pp.order.none')}</p></div> : (
          <div className="table-wrap">
            <table className="tbl" data-testid="pp-orders">
              <thead><tr><th>{t('pp.col.ref')}</th><th>{t('pp.col.client')}</th>{staff && <th>{t('pp.col.partner')}</th>}<th>{t('pp.col.services')}</th><th>{t('pp.col.status')}</th>
                <th className="num">{t('pp.col.amount')}</th>{!staff && <th className="num">{t('pp.col.estimate')}</th>}<th>{t('pp.col.next')}</th><th>{t('pp.col.updated')}</th></tr></thead>
              <tbody>
                {list.map((o: OrderRow) => (
                  <tr key={o.id} className="click" onClick={() => navigate('/partners/orders/' + o.id)}>
                    <td><Link to={'/partners/orders/' + o.id}>{o.ref}</Link></td>
                    <td>{o.client_name}{staff && o.attribution && o.attribution !== 'clear' && o.attribution !== 'confirmed' && <> <Badge tone="bad">{t('pp.attr.' + o.attribution)}</Badge></>}</td>
                    {staff && <td>{o.partner}</td>}
                    <td className="small">{o.services}</td>
                    <td><Status value={o.status} /></td>
                    <td className="num">{usd(o.setup_cents + o.one_time_cents)}{o.recurring_cents ? <span className="xs dim"><br />+ {usd(o.recurring_cents)} {t('pp.per.month')}</span> : null}</td>
                    {!staff && <td className="num small">{o.est_once_cents !== null ? usd(o.est_once_cents) : ''}</td>}
                    <td className="small">{o.next_action}{o.follow_up_at && <span className={o.follow_up_at < today ? 'neg' : 'dim'}><br />{t('pp.order.followUp', { date: o.follow_up_at })}</span>}</td>
                    <td className="xs dim">{dateTime(o.last_update || o.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
  if (!cat.data) return <Loading />;
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
      <div className="pp-hero"><p className="xs"><Link to="/partners/orders">{t('pp.nav.orders')}</Link></p><h1>{t('pp.order.new')}</h1><p className="muted">{t('pp.order.newSub')}</p></div>
      <Card title={t('pp.offer.client')}>
        <div className="fgrid">
          <Field label={t('pp.f.clientName')} htmlFor="no-c"><input id="no-c" value={client.client_name} maxLength={200} onChange={(e) => setClient({ ...client, client_name: e.target.value })} /></Field>
          <Field label={t('pp.f.industry')} htmlFor="no-i"><input id="no-i" value={client.industry} maxLength={80} onChange={(e) => setClient({ ...client, industry: e.target.value })} /></Field>
          <Field label={t('pp.f.requirements')} htmlFor="no-r" full><textarea id="no-r" rows={3} maxLength={4000} value={client.requirements} onChange={(e) => setClient({ ...client, requirements: e.target.value })} /></Field>
        </div>
        <OrderContactFields f={f} setF={(p) => setF({ ...f, ...p })} />
      </Card>
      <Card title={t('pp.offer.services')}>
        <ul className="pp-lines">{lines.map((l, n) => { const it = priced.find((i) => i.id === l.item); return (
          <li key={l.item}><div className="grow"><b>{it ? tx(it.name, lang) : l.item}</b></div>
            <label className="xs">{t('pp.f.qty')} <input type="number" min={1} max={50} className="pp-qty" value={l.quantity} onChange={(e) => setLines(lines.map((x, i) => (i === n ? { ...x, quantity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) } : x)))} /></label>
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== n))}>{t('pp.remove')}</Button></li>); })}</ul>
        <div className="row">
          <select aria-label={t('pp.offer.add')} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('pp.offer.choose')}</option>
            {priced.filter((i) => !lines.some((l) => l.item === i.id)).map((i) => <option key={i.id} value={i.id}>{tx(i.name, lang)}</option>)}
          </select>
          <Button icon={<LuPlus />} disabled={!pick} onClick={() => { setLines([...lines, { item: pick, quantity: 1 }]); setPick(''); }}>{t('pp.offer.add')}</Button>
        </div>
        <p className="xs dim">{t('pp.order.quoteViaOffer')}</p>
      </Card>
      {err && <Note tone="bad"><span role="alert">{err}</span></Note>}
      <div className="row"><span className="grow" /><Button disabled={busy} onClick={() => void go(false)}>{t('pp.order.saveDraft')}</Button><Button variant="primary" icon={<LuSend />} disabled={busy} onClick={() => void go(true)}>{t('pp.order.submit')}</Button></div>
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
  if (!data.data) return <Loading />;
  const o: Order = data.data.order;
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
      <div className="pp-hero">
        <p className="xs"><Link to="/partners/orders">{t('pp.nav.orders')}</Link></p>
        <h1>{o.ref} · {o.client_name}</h1>
        <div className="row"><Status value={o.status} />{staff && <span className="small muted">{o.partner.name} ({o.partner.code})</span>}{o.assigned && <span className="small muted">{t('pp.order.owner', { name: o.assigned.name })}</span>}</div>
      </div>
      {staff && o.duplicate_of && (
        <Note tone="bad"><LuTriangleAlert aria-hidden="true" /> {t(o.attribution === 'conflict' ? 'pp.order.conflict' : 'pp.order.duplicate', { ref: o.duplicate_of.ref, partner: o.duplicate_of.partner })}
          <div className="row"><Button size="sm" onClick={() => void plan({ attribution: 'confirmed' })}>{t('pp.order.attrConfirm')}</Button></div></Note>
      )}
      {!staff && o.status === 'info_required' && <Note tone="warn">{t('pp.order.infoNeeded')}</Note>}
      <div className="pp-builder">
        <div className="pp-stack">
          <Card title={t('pp.offer.services')}>
            <ul className="pp-lines">{o.lines.map((l, n) => <li key={n}><div className="grow"><b>{l.quantity > 1 ? `${l.quantity} x ` : ''}{tx(l.name, lang)}</b></div>
              <span className="small">{[l.setup_cents + l.one_time_cents ? usd(l.setup_cents + l.one_time_cents) : '', l.recurring_cents ? `${usd(l.recurring_cents)} ${t('pp.per.month')}` : ''].filter(Boolean).join(' + ')}</span></li>)}</ul>
            <dl className="pp-prices">
              <div className="pp-price-row"><dt>{t('pp.price.setup')}</dt><dd>{usd(o.setup_cents + o.one_time_cents)}</dd></div>
              <div className="pp-price-row"><dt>{t('pp.price.recurring')}</dt><dd>{usd(o.recurring_cents)} {t('pp.per.month')}</dd></div>
              <div className="pp-price-row"><dt>{t('pp.offer.deposit')}</dt><dd>{usd(o.deposit_cents)}</dd></div>
            </dl>
          </Card>
          <Card title={t('pp.order.activity')}>
            <ol className="pp-timeline">
              {o.events.map((e, n) => (
                <li key={n} className={e.visibility === 'internal' ? 'internal' : undefined}>
                  <span className="xs dim">{dateTime(e.at)} · {t('pp.by.' + e.actor_kind)}</span>{e.visibility === 'internal' && <> <Badge tone="violet">{t('pp.order.internal')}</Badge></>}<br />
                  {e.kind === 'status' ? <>{t('pp.order.moved')} <Status value={e.to ?? ''} /></> : null}
                  {e.kind === 'payment' ? <b>{t('pp.order.paymentRecorded')}</b> : null}
                  {e.body ? <p>{e.body}</p> : null}
                </li>
              ))}
            </ol>
            <div className="pp-msg">
              <Field label={staff ? t('pp.order.noteLabel') : t('pp.order.messageLabel')} htmlFor="om-b"><textarea id="om-b" rows={3} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="om-body" /></Field>
              <div className="row">
                {staff && <label className="pp-check small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> {t('pp.order.internalOnly')}</label>}
                <span className="grow" /><Button variant="primary" icon={<LuSend />} onClick={() => void send()} disabled={!msg.trim()} data-testid="om-send">{t('pp.order.send')}</Button>
              </div>
            </div>
          </Card>
        </div>
        <aside className="pp-stack pp-side">
          <Card title={t('pp.order.client')}>
            <dl className="kv small pp-kv">
              <dt>{t('pp.f.contact')}</dt><dd>{o.contact_name}</dd>
              {o.contact_email && <><dt>{t('pp.f.email')}</dt><dd>{o.contact_email}</dd></>}
              {o.contact_phone && <><dt>{t('pp.f.phone')}</dt><dd>{o.contact_phone}</dd></>}
              {o.industry && <><dt>{t('pp.f.industry')}</dt><dd>{o.industry}</dd></>}
              {o.timeline && <><dt>{t('pp.f.timeline')}</dt><dd>{o.timeline}</dd></>}
              {o.lead_source && <><dt>{t('pp.f.source')}</dt><dd>{o.lead_source}</dd></>}
              <dt>{t('pp.f.consentShort')}</dt><dd>{o.consent ? t('pp.yes') : t('pp.no')}{o.consent_note ? ` · ${o.consent_note}` : ''}</dd>
              {o.live_at && <><dt>{t('pp.order.liveOn')}</dt><dd>{o.live_at}</dd></>}
            </dl>
            {o.requirements && <p className="small">{o.requirements}</p>}
          </Card>
          {!staff && (
            <Card title={t('pp.order.yourEstimate')}>
              <p><b>{usd(o.est_once_cents ?? 0)}</b>{(o.est_monthly_cents ?? 0) > 0 && <> + <b>{usd(o.est_monthly_cents)}</b> {t('pp.per.month')}</>}</p>
              <p className="xs dim">{t('pp.order.estimateNote')}</p>
              <Field label={t('pp.order.myFollowUp')} htmlFor="om-fu"><input id="om-fu" type="date" value={isoDate(o.partner_follow_up_at)} onChange={(e) => void partnerAct('follow-up', { date: e.target.value })} /></Field>
              {o.status === 'draft' && <Button variant="primary" onClick={() => void partnerAct('submit')}>{t('pp.order.submit')}</Button>}
              {(o.status === 'draft' || o.status === 'submitted') && <Button variant="ghost" onClick={() => void partnerAct('cancel', { reason: '' })}>{t('pp.order.withdraw')}</Button>}
            </Card>
          )}
          {staff && (
            <Card title={t('pp.order.manage')}>
              <p className="xs muted">{t('pp.order.nextMoves')}</p>
              <div className="row">{(NEXT[o.status] ?? []).filter((s) => admin || !['live', 'refunded'].includes(s)).map((s) => <Button key={s} size="sm" variant={s === 'approved' || s === 'live' ? 'primary' : undefined} onClick={() => setMoving(s)} data-testid={`om-move-${s}`}>{t('pp.st.' + s)}</Button>)}</div>
              <Field label={t('pp.order.nextAction')} htmlFor="om-na"><input id="om-na" defaultValue={o.next_action} maxLength={400} onBlur={(e) => e.target.value !== o.next_action && void plan({ next_action: e.target.value })} /></Field>
              <Field label={t('pp.order.vyntexFollowUp')} htmlFor="om-vf"><input id="om-vf" type="date" defaultValue={isoDate(o.follow_up_at)} onChange={(e) => void plan({ follow_up_at: e.target.value })} /></Field>
              <div className="row">
                {ctx.user_id && o.assigned_to !== ctx.user_id && <Button size="sm" onClick={() => void plan({ assigned_to: ctx.user_id })}>{t('pp.order.assignMe')}</Button>}
                {o.assigned_to && <Button size="sm" variant="ghost" onClick={() => void plan({ assigned_to: '' })}>{t('pp.order.unassign')}</Button>}
              </div>
              {admin && !['draft', 'submitted', 'under_review', 'info_required', 'rejected'].includes(o.status) && <Button onClick={() => setPaying(true)} data-testid="om-pay">{t('pp.order.recordPayment')}</Button>}
              {!!o.payments.length && (
                <table className="tbl xs"><tbody>{o.payments.map((p, n) => <tr key={n}><td>{t('pp.pay.' + p.kind)}{p.period ? ` ${p.period.slice(0, 7)}` : ''}</td><td className="num">{usd(p.amount_cents)}</td><td>{p.received_on}</td><td className="dim">{p.reference}</td></tr>)}</tbody></table>
              )}
            </Card>
          )}
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
    <Modal title={t('pp.order.moveTitle', { to: t('pp.st.' + to) })} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.order.moveNote')}</p>
      {to === 'live' && <Field label={t('pp.order.liveOn')} htmlFor="mv-l"><input id="mv-l" type="date" value={live} onChange={(e) => setLive(e.target.value)} /></Field>}
      {to === 'live' && <p className="xs dim">{t('pp.order.liveNote')}</p>}
      <Field label={NEEDS_NOTE.includes(to) ? t('pp.order.why') : t('pp.order.noteOptional')} htmlFor="mv-n"><textarea id="mv-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()} data-testid="mv-go">{t('pp.confirm')}</Button></div>
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
    <Modal title={t('pp.order.recordPayment')} onClose={onClose} labelClose={t('pp.cancel')}>
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
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()} data-testid="py-go">{t('pp.order.recordPayment')}</Button></div>
    </Modal>
  );
}
