// The offer builder. The partner picks published catalog items and quantities, may ask for a discount on one-time
// charges, and saves: the server prices the offer, estimates the partner's pay and says whether VYNTEX must approve it.
// Nothing typed here is a price. Approved offers are shared by a private link (or emailed to the client), and an
// accepted offer becomes an order without retyping it.
import { useEffect, useMemo, useState } from 'react';
import { LuArrowLeft, LuCopy, LuEye, LuLink, LuLoaderCircle, LuMinus, LuPackage, LuPlus, LuSend, LuTrash2, LuUndo2, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate, useRoute } from '@/app/router';
import { Badge, Button, Field, IconButton, Modal, Note, confirmDialog, toast } from '@/ui';
import { api, type CatalogItem, type Context, type Offer } from './api';
import { ProposalDocument } from './proposal';
import { Failed, Loading, Status, isoDate, newKey, pct, tx, usd, useErrorText, useLoad } from './shared';
import { AsyncButton, CopyField, EmptyState, PageHead, Panel, RowMenu } from './ui';

interface Draft {
  title: string; summary: string; client_name: string; client_contact: string; client_email: string; client_phone: string; industry: string; requirements: string;
  lang: 'en' | 'es'; valid_days: number; discount: string; lines: { item: string; quantity: number }[];
}
const EMPTY: Draft = { title: '', summary: '', client_name: '', client_contact: '', client_email: '', client_phone: '', industry: '', requirements: '', lang: 'en', valid_days: 30, discount: '', lines: [] };

export function OfferPage({ id, ctx }: { id: string; ctx: Context }) {
  const isNew = id === 'new';
  const offer = useLoad(() => (isNew ? Promise.resolve({ ok: true as const, status: 200, data: { offer: null as unknown as Offer } }) : api.offer(id)), [id]);
  const cat = useLoad(() => api.catalog('partner'), []);
  if (offer.error) return <Failed text={offer.error} retry={offer.reload} />;
  if (!offer.data || !cat.data) return <Loading kind="page" />;
  const o = offer.data.offer;
  if (!isNew && !o) return <Loading kind="page" />;
  const editable = ctx.kind === 'partner' && (isNew || ['draft', 'changes_requested'].includes(o.status));
  return editable
    ? <Builder ctx={ctx} offer={isNew ? null : o} items={cat.data.catalog.items} onSaved={(x) => { if (isNew) navigate('/partners/catalog/offers/' + x.id, { replace: true }); else offer.setData({ offer: x }); }} />
    : <OfferView ctx={ctx} offer={o} reload={offer.reload} setOffer={(x) => offer.setData({ offer: x })} />;
}

function Builder({ ctx, offer, items, onSaved }: { ctx: Context; offer: Offer | null; items: CatalogItem[]; onSaved: (o: Offer) => void }) {
  const { t, lang } = useApp();
  const route = useRoute();
  const errText = useErrorText();
  const [d, setD] = useState<Draft>(() => {
    if (!offer) {
      const pre = (route.query.get('items') || '').split(',').filter((x) => items.some((i) => i.id === x));
      return { ...EMPTY, lang: lang === 'es' ? 'es' : 'en', lines: pre.map((item) => ({ item, quantity: 1 })) };
    }
    return { title: offer.title, summary: offer.summary, client_name: offer.client_name, client_contact: offer.client_contact, client_email: offer.client_email, client_phone: offer.client_phone,
      industry: offer.industry, requirements: offer.requirements, lang: offer.lang, valid_days: 30, discount: offer.discount_bps ? String(offer.discount_bps / 100) : '',
      lines: offer.line_ids.map((l, n) => ({ item: l.item, quantity: offer.lines[n]?.quantity ?? 1 })) };
  });
  const [saved, setSaved] = useState<Offer | null>(offer);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [preview, setPreview] = useState(false);
  const set = (p: Partial<Draft>) => { setErr(''); setD((cur) => ({ ...cur, ...p })); };
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const discountBps = d.discount.trim() ? Math.round(Number(d.discount.replace(/[%\s]/g, '')) * 100) : 0;
  const dirty = !saved || JSON.stringify(d.lines) !== JSON.stringify(saved.line_ids.map((l, n) => ({ item: l.item, quantity: saved.lines[n]?.quantity ?? 1 }))) || discountBps !== saved.discount_bps
    || d.client_name !== saved.client_name || d.title !== saved.title || d.summary !== saved.summary || d.requirements !== saved.requirements || d.lang !== saved.lang
    || d.client_email !== saved.client_email || d.client_contact !== saved.client_contact || d.client_phone !== saved.client_phone || d.industry !== saved.industry;

  const save = async (go = true) => {
    if (!d.client_name.trim()) { setErr(t('pp.err.client_required')); return null; }
    if (!d.lines.length) { setErr(t('pp.err.no_lines')); return null; }
    if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 5000) { setErr(t('pp.err.bad_discount')); return null; }
    setBusy(true); setErr('');
    const r = await api.saveOffer({ id: saved?.id, ...d, discount_bps: discountBps });
    setBusy(false);
    if (!r.ok) { setErr(errText(r)); return null; }
    setSaved(r.data.offer); toast(t('pp.offer.saved'));
    if (!offer && go) onSaved(r.data.offer);
    return r.data.offer;
  };
  const submit = async () => {
    const o = dirty ? await save(false) : saved;
    if (!o) return;
    setBusy(true);
    const r = await api.offerAction(o.id, 'submit');
    setBusy(false);
    if (!r.ok) { setErr(errText(r)); return; }
    toast(t(r.data.offer.status === 'pending_approval' ? 'pp.offer.submittedReview' : 'pp.offer.approvedNow'));
    onSaved(r.data.offer);
  };
  const addLine = () => { if (!pick || d.lines.some((l) => l.item === pick)) return; set({ lines: [...d.lines, { item: pick, quantity: 1 }] }); setPick(''); };
  const qty = (n: number, q: number) => set({ lines: d.lines.map((x, i) => (i === n ? { ...x, quantity: Math.max(1, Math.min(50, q || 1)) } : x)) });
  const spin = busy ? <LuLoaderCircle className="pp-spin" aria-hidden="true" /> : undefined;

  return (
    <div className="pp-stack" data-testid="pp-builder">
      <PageHead back={<Link to="/partners/catalog/offers" className="crumb"><LuArrowLeft aria-hidden="true" />{t('pp.cat.offers')}</Link>}
        title={saved ? `${t('pp.offer.title')} ${saved.ref}` : t('pp.offer.new')} sub={t('pp.offer.builderSub')}
        meta={saved ? <><Status value={saved.status} />{saved.status === 'changes_requested' && <span className="small pp-said">{saved.events.filter((e) => e.kind === 'changes_requested').slice(-1)[0]?.note}</span>}</> : undefined} />
      <div className="pp-builder">
        <div className="pp-stack">
          <Panel title={t('pp.offer.client')}>
            <div className="fgrid">
              <Field label={<>{t('pp.f.clientName')}<span className="pp-req" aria-hidden="true"> *</span></>} htmlFor="ob-cn" error={!!err && !d.client_name.trim()} hint={!!err && !d.client_name.trim() ? t('pp.v.required') : undefined}><input id="ob-cn" value={d.client_name} maxLength={200} onChange={(e) => set({ client_name: e.target.value })} data-testid="ob-client" /></Field>
              <Field label={t('pp.f.contact')} htmlFor="ob-cc"><input id="ob-cc" value={d.client_contact} maxLength={200} onChange={(e) => set({ client_contact: e.target.value })} /></Field>
              <Field label={t('pp.f.email')} htmlFor="ob-ce"><input id="ob-ce" type="email" value={d.client_email} maxLength={320} onChange={(e) => set({ client_email: e.target.value })} /></Field>
              <Field label={t('pp.f.phone')} htmlFor="ob-cp"><input id="ob-cp" value={d.client_phone} maxLength={40} onChange={(e) => set({ client_phone: e.target.value })} /></Field>
              <Field label={t('pp.f.industry')} htmlFor="ob-ci"><input id="ob-ci" value={d.industry} maxLength={80} onChange={(e) => set({ industry: e.target.value })} /></Field>
              <Field label={t('pp.f.lang')} htmlFor="ob-cl"><select id="ob-cl" value={d.lang} onChange={(e) => set({ lang: e.target.value as 'en' | 'es' })}><option value="en">English</option><option value="es">Español</option></select></Field>
              <Field label={t('pp.f.requirements')} htmlFor="ob-cr" full hint={t('pp.f.requirementsHint')}><textarea id="ob-cr" rows={3} maxLength={4000} value={d.requirements} onChange={(e) => set({ requirements: e.target.value })} /></Field>
            </div>
          </Panel>
          <Panel title={t('pp.offer.services')} count={d.lines.length}>
            {!d.lines.length && <EmptyState compact icon={<LuPackage />} title={t('pp.offer.noLines')} />}
            <ul className="pp-lines">
              {d.lines.map((l, n) => {
                const it = byId.get(l.item);
                return (
                  <li key={l.item}>
                    <div className="grow pp-cell2"><b>{it ? tx(it.name, lang) : l.item}{it?.quote && <> <Badge tone="warn">{t('pp.cat.quote')}</Badge></>}</b><span className="xs dim">{it ? tx(it.tagline, lang) : ''}</span></div>
                    <div className="pp-stepper" role="group" aria-label={t('pp.f.qty')}>
                      <IconButton size="sm" label={t('pp.qty.less')} disabled={l.quantity <= 1} onClick={() => qty(n, l.quantity - 1)}><LuMinus /></IconButton>
                      <input type="number" min={1} max={50} value={l.quantity} className="pp-qty" aria-label={t('pp.f.qty')} onChange={(e) => qty(n, Number(e.target.value))} />
                      <IconButton size="sm" label={t('pp.qty.more')} disabled={l.quantity >= 50} onClick={() => qty(n, l.quantity + 1)}><LuPlus /></IconButton>
                    </div>
                    <IconButton size="sm" label={t('pp.remove')} className="pp-del" onClick={() => set({ lines: d.lines.filter((_, i) => i !== n) })}><LuTrash2 /></IconButton>
                  </li>
                );
              })}
            </ul>
            <div className="row nowrap pp-add">
              <select aria-label={t('pp.offer.add')} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="ob-pick">
                <option value="">{t('pp.offer.choose')}</option>
                {items.filter((i) => !d.lines.some((l) => l.item === i.id)).map((i) => <option key={i.id} value={i.id}>{tx(i.name, lang)}{i.quote ? ` (${t('pp.cat.quote')})` : ''}</option>)}
              </select>
              <Button icon={<LuPlus />} onClick={addLine} disabled={!pick} data-testid="ob-add">{t('pp.offer.add')}</Button>
            </div>
          </Panel>
          <Panel title={t('pp.offer.presentation')}>
            <div className="fgrid">
              <Field label={t('pp.f.title')} htmlFor="ob-t" full><input id="ob-t" value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder={t('pp.f.titlePh')} /></Field>
              <Field label={t('pp.f.summary')} htmlFor="ob-s" full hint={t('pp.f.summaryHint')}><textarea id="ob-s" rows={4} maxLength={4000} value={d.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
              <Field label={t('pp.f.discount')} htmlFor="ob-d" hint={t('pp.f.discountHint')}><input id="ob-d" inputMode="decimal" value={d.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="0" /></Field>
              <Field label={t('pp.f.validDays')} htmlFor="ob-v"><input id="ob-v" type="number" min={1} max={90} value={d.valid_days} onChange={(e) => set({ valid_days: Math.max(1, Math.min(90, Number(e.target.value) || 30)) })} /></Field>
            </div>
          </Panel>
        </div>
        <aside className="pp-stack pp-aside">
          <Totals offer={saved} dirty={dirty} partner />
          {err && <Note tone="bad"><span role="alert" data-testid="ob-error">{err}</span></Note>}
          <div className="pp-aside-actions">
            <Button variant="primary" icon={spin ?? <LuSend />} onClick={() => void submit()} disabled={busy || !d.lines.length} aria-busy={busy || undefined} data-testid="ob-submit">{t('pp.offer.submit')}</Button>
            <Button onClick={() => void save(true)} disabled={busy} data-testid="ob-save">{t('pp.offer.save')}</Button>
            {saved && !dirty && <Button variant="ghost" icon={<LuEye />} onClick={() => setPreview(true)}>{t('pp.offer.preview')}</Button>}
          </div>
          <p className="xs dim">{t('pp.offer.serverNote')}</p>
          {ctx.partner && <p className="xs dim">{t('pp.offer.lane', { lane: t('pp.lane.' + ctx.partner.kind) })}</p>}
        </aside>
      </div>
      {preview && saved && <Modal title={t('pp.offer.preview')} onClose={() => setPreview(false)} size="wide" labelClose={t('pp.close')}><ProposalDocument p={{ ...saved, terms: saved.terms ?? [] }} /></Modal>}
    </div>
  );
}

function Totals({ offer, dirty, partner }: { offer: Offer | null; dirty?: boolean; partner: boolean }) {
  const { t } = useApp();
  if (!offer) return <Panel title={t('pp.offer.totals')} className="pp-totals"><p className="small muted">{t('pp.offer.saveToPrice')}</p></Panel>;
  const blocking = offer.approval_reasons.filter((r) => r.blocking !== false);
  const uncovered = offer.approval_reasons.find((r) => r.code === 'pay_not_approved');
  return (
    <Panel title={t('pp.offer.totals')} className="pp-totals">
      {dirty && <Note tone="warn">{t('pp.offer.dirty')}</Note>}
      <dl className="pp-prices">
        <div className="pp-price-row"><dt>{t('pp.price.setup')}</dt><dd>{usd(offer.setup_cents + offer.one_time_cents)}</dd></div>
        {offer.discount_cents > 0 && <div className="pp-price-row"><dt>{t('pp.offer.discount', { pct: pct(offer.discount_bps) })}</dt><dd>-{usd(offer.discount_cents)}</dd></div>}
        <div className="pp-price-row"><dt>{t('pp.price.recurring')}</dt><dd>{usd(offer.recurring_cents)} {t('pp.per.month')}</dd></div>
        <div className="pp-price-row strong"><dt>{t('pp.offer.deposit')}</dt><dd>{usd(offer.deposit_cents)}</dd></div>
      </dl>
      {partner && (
        <div className="pp-earn">
          <p className="pp-earn-t">{t('pp.earn.estimateTitle')}</p>
          <p className="pp-earn-v"><b data-testid="ob-est">{usd(offer.estimate?.once_cents ?? 0)}</b>{(offer.estimate?.monthly_cents ?? 0) > 0 && <> + <b>{usd(offer.estimate.monthly_cents)}</b> <small>{t('pp.per.month')}</small></>}</p>
          {uncovered && <p className="xs"><Badge tone="warn">{t('pp.st.needs_approval')}</Badge> {t('pp.earn.uncovered', { items: (uncovered.items ?? []).join(', ') })}</p>}
          <p className="xs dim">{t('pp.earn.disclaimer')}</p>
        </div>
      )}
      {blocking.length > 0 && <Note tone="warn"><b>{t('pp.offer.needsApproval')}</b><ul className="xs">{blocking.map((r, n) => <li key={n}>{t('pp.reason.' + r.code, { item: r.item ?? '' })}</li>)}</ul></Note>}
    </Panel>
  );
}

function OfferView({ ctx, offer: o, reload, setOffer }: { ctx: Context; offer: Offer; reload: () => void; setOffer: (o: Offer) => void }) {
  const { t, dateTime } = useApp();
  const errText = useErrorText();
  const staff = ctx.kind === 'staff';
  const [preview, setPreview] = useState(false);
  const [link, setLink] = useState<{ link: string; expiresAt: string; delivery: string } | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const act = async (action: string, body: Record<string, unknown> = {}) => {
    const r = await api.offerAction(o.id, action, body);
    if (r.ok) { setOffer(r.data.offer); toast(t('pp.done')); if (action === 'duplicate') navigate('/partners/catalog/offers/' + r.data.offer.id); } else toast(errText(r), true);
  };
  const share = async (email: boolean) => {
    const r = await api.offerAction<{ link: string; expiresAt: string; delivery: string }>(o.id, 'share', { email, days: 30 });
    if (r.ok) { setLink(r.data); reload(); } else toast(errText(r), true);
  };
  const decide = async (decision: 'accepted' | 'declined') => {
    if (!(await confirmDialog(t(decision === 'accepted' ? 'pp.offer.recordAccepted' : 'pp.offer.recordDeclined'), t('pp.confirm'), t('pp.cancel'), decision === 'declined'))) return;
    void act('decision', { decision });
  };
  return (
    <div className="pp-stack" data-testid="pp-offer">
      <PageHead back={<Link to="/partners/catalog/offers" className="crumb"><LuArrowLeft aria-hidden="true" />{t('pp.cat.offers')}</Link>}
        title={<>{t('pp.offer.title')} {o.ref}</>}
        meta={<><Status value={o.status} /><span className="small muted">{o.client_name}{staff ? ` · ${o.partner.name} (${o.partner.code})` : ''}</span></>} />
      <div className="pp-builder">
        <div className="pp-stack">
          <Panel title={t('pp.offer.services')} count={o.lines.length}>
            <ul className="pp-lines">{o.lines.map((l, n) => <li key={n}><div className="grow"><b>{l.quantity > 1 ? `${l.quantity} x ` : ''}{tx(l.name, o.lang)}</b>{l.quote && <> <Badge tone="warn">{t('pp.cat.quote')}</Badge></>}</div>
              <span className="small pp-money">{[l.setup_cents + l.one_time_cents ? usd(l.setup_cents + l.one_time_cents) : '', l.recurring_cents ? `${usd(l.recurring_cents)} ${t('pp.per.month')}` : ''].filter(Boolean).join(' + ')}</span></li>)}</ul>
          </Panel>
          {staff && o.status === 'pending_approval' && <Decide offer={o} onDone={setOffer} />}
          <Panel title={t('pp.offer.history')}>
            <ol className="pp-timeline">{o.events.map((e, n) => <li key={n}><span className="xs dim">{dateTime(e.at)}</span><b>{t('pp.ev.' + e.kind) !== 'pp.ev.' + e.kind ? t('pp.ev.' + e.kind) : e.kind}</b>{e.note ? <p>{e.note}</p> : null}</li>)}</ol>
          </Panel>
          {!!o.shares.length && (
            <Panel title={t('pp.offer.links')} count={o.shares.length} flush>
              <ul className="pp-mini">{o.shares.map((s) => <li key={s.id} className="pp-mini-a static">
                <span className="pp-mini-t"><b>{t('pp.offer.linkMade', { date: dateTime(s.created_at) })}</b><small>{t('pp.offer.views', { n: s.views })}{s.revoked ? '' : ` · ${t('pp.offer.until', { date: dateTime(s.expires_at) })}`}</small></span>
                <span className="pp-mini-r">{s.revoked ? <Status value="revoked" /> : !staff ? <AsyncButton size="sm" variant="ghost" icon={<LuX />} onClick={() => act('share-revoke', { share: s.id }).then(reload)}>{t('pp.offer.revoke')}</AsyncButton> : <Status value="active" />}</span>
              </li>)}</ul>
            </Panel>
          )}
        </div>
        <aside className="pp-stack pp-aside">
          <Totals offer={o} partner />
          <div className="pp-aside-actions">
            {!staff && ['approved', 'sent', 'viewed'].includes(o.status) && <AsyncButton variant="primary" icon={<LuLink />} onClick={() => share(false)} data-testid="ob-share">{t('pp.offer.share')}</AsyncButton>}
            {!staff && o.status === 'accepted' && <Button variant="primary" onClick={() => setOrdering(true)} data-testid="ob-order">{t('pp.offer.toOrder')}</Button>}
            {staff && ['sent', 'viewed'].includes(o.status) && <Button onClick={() => setAccepting(true)} data-testid="ob-staff-accept">{t('pp.offer.staffAccept')}</Button>}
            {!staff && ['approved', 'sent', 'viewed'].includes(o.status) && o.client_email && <AsyncButton icon={<LuSend />} onClick={() => share(true)}>{t('pp.offer.email', { email: o.client_email })}</AsyncButton>}
            {!staff && o.order_id && <Link to={'/partners/orders/' + o.order_id} className="btn">{t('pp.offer.seeOrder')}</Link>}
            <div className="pp-aside-row">
              <Button variant="ghost" icon={<LuEye />} onClick={() => setPreview(true)}>{t('pp.offer.preview')}</Button>
              {!staff && <RowMenu label={t('pp.more')} items={[
                { label: t('pp.offer.duplicate'), icon: <LuCopy aria-hidden="true" />, onSelect: () => void act('duplicate') },
                { label: t('pp.offer.withdraw'), icon: <LuUndo2 aria-hidden="true" />, onSelect: () => void act('withdraw'), hidden: ['accepted', 'ordered', 'withdrawn', 'declined', 'expired'].includes(o.status) },
                { label: t('pp.offer.markDeclined'), icon: <LuX aria-hidden="true" />, danger: true, onSelect: () => void decide('declined'), hidden: !['approved', 'sent', 'viewed'].includes(o.status) },
              ]} />}
            </div>
            {!staff && ['sent', 'viewed'].includes(o.status) && <p className="xs dim">{t('pp.offer.clientAccepts')}</p>}
          </div>
          {link && (
            <Panel title={t('pp.offer.linkTitle')} className="pp-linkcard">
              <p className="xs muted">{t(link.delivery === 'sent' ? 'pp.offer.linkSent' : 'pp.offer.linkOnce', { date: dateTime(link.expiresAt) })}</p>
              <CopyField value={link.link} label={t('pp.offer.linkTitle')} testId="ob-link" />
            </Panel>
          )}
        </aside>
      </div>
      {preview && <Modal title={t('pp.offer.preview')} onClose={() => setPreview(false)} size="wide" labelClose={t('pp.close')}><ProposalDocument p={{ ...o, terms: o.terms ?? [] }} /></Modal>}
      {ordering && <OrderFromOffer offer={o} onClose={() => setOrdering(false)} />}
      {accepting && <StaffAccept offer={o} onClose={() => setAccepting(false)} onDone={(x) => { setAccepting(false); setOffer(x); }} />}
    </div>
  );
}

/** VYNTEX staff: record an acceptance the client gave outside the proposal page, with how it was given. */
function StaffAccept({ offer, onClose, onDone }: { offer: Offer; onClose: () => void; onDone: (o: Offer) => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [name, setName] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go = async () => {
    const r = await api.admin.post<{ offer: Offer }>(`offers/${offer.id}/accept`, { name, reason });
    if (r.ok) { toast(t('pp.done')); onDone(r.data.offer); } else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.offer.staffAccept')} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" onClick={go}>{t('pp.confirm')}</AsyncButton></>}>
      <p className="small muted">{t('pp.offer.staffAcceptNote')}</p>
      <Field label={t('pp.mg.personName')} htmlFor="sa-n"><input id="sa-n" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('pp.offer.staffAcceptHow')} htmlFor="sa-r"><textarea id="sa-r" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

/** VYNTEX staff: approve (pricing any quote lines) or ask for changes. */
function Decide({ offer, onDone }: { offer: Offer; onDone: (o: Offer) => void }) {
  const { t, lang } = useApp();
  const errText = useErrorText();
  const quotes = offer.line_ids.filter((l) => l.quote);
  const [prices, setPrices] = useState<Record<string, { setup: string; once: string; month: string }>>(() => Object.fromEntries(quotes.map((q) => [q.id, { setup: '', once: '', month: '' }])));
  const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, '') || '0') * 100);
  const go = async (decision: 'approve' | 'changes') => {
    const body: Record<string, unknown> = { decision, note };
    if (decision === 'approve' && quotes.length) body.prices = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, { setup_cents: cents(v.setup), one_time_cents: cents(v.once), recurring_cents: cents(v.month) }]));
    const r = await api.admin.post<{ offer: Offer }>(`offers/${offer.id}/decide`, body);
    if (r.ok) { onDone(r.data.offer); toast(t('pp.done')); } else setErr(errText(r));
  };
  return (
    <Panel title={t('pp.offer.decideTitle')} className="pp-decide">
      <ul className="xs pp-reasons">{offer.approval_reasons.map((r, n) => <li key={n}>{t('pp.reason.' + r.code, { item: r.item ?? '' })}</li>)}</ul>
      {quotes.map((q) => {
        const line = offer.lines[offer.line_ids.indexOf(q)];
        const p = prices[q.id];
        return (
          <div key={q.id} className="fgrid">
            <p className="full small"><b>{tx(line?.name, lang)}</b>: {t('pp.offer.priceQuote')}</p>
            <Field label={t('pp.price.setup')} htmlFor={'q-s-' + q.id}><input id={'q-s-' + q.id} inputMode="decimal" value={p.setup} onChange={(e) => setPrices({ ...prices, [q.id]: { ...p, setup: e.target.value } })} /></Field>
            <Field label={t('pp.price.recurring')} htmlFor={'q-m-' + q.id}><input id={'q-m-' + q.id} inputMode="decimal" value={p.month} onChange={(e) => setPrices({ ...prices, [q.id]: { ...p, month: e.target.value } })} /></Field>
          </div>
        );
      })}
      <Field label={t('pp.offer.decideNote')} htmlFor="od-note"><textarea id="od-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <p className="pp-err" role="alert">{err}</p>}
      <div className="pp-btnrow"><AsyncButton variant="primary" onClick={() => go('approve')} data-testid="od-approve">{t('pp.offer.approve')}</AsyncButton><AsyncButton onClick={() => go('changes')}>{t('pp.offer.changes')}</AsyncButton></div>
    </Panel>
  );
}

/** An accepted offer becomes an order: the prices and services come from the offer; the partner adds the contact facts. */
function OrderFromOffer({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ contact_name: offer.client_contact || offer.decided_name || '', contact_email: offer.client_email, contact_phone: offer.client_phone, lead_source: '', timeline: '', consent: false, consent_note: '' });
  const [key] = useState(newKey);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => setErr(''), [f]);
  const go = async () => {
    if (!f.consent) { setErr(t('pp.err.consent_required')); return; }
    setBusy(true);
    const r = await api.createOrder({ offer_id: offer.id, ...f, idem_key: 'of-' + key, submit: true });
    setBusy(false);
    if (r.ok) { toast(t('pp.order.submitted', { ref: r.data.order.ref })); navigate('/partners/orders/' + r.data.order.id); } else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.offer.toOrder')} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" disabled={busy} aria-busy={busy || undefined} icon={busy ? <LuLoaderCircle className="pp-spin" aria-hidden="true" /> : undefined} onClick={() => void go()} data-testid="oo-submit">{t('pp.order.submit')}</Button></>}>
      <p className="small muted">{t('pp.order.fromOffer', { ref: offer.ref, client: offer.client_name })}</p>
      <OrderContactFields f={f} setF={(p) => setF({ ...f, ...p })} />
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

export function OrderContactFields({ f, setF }: { f: { contact_name: string; contact_email: string; contact_phone: string; lead_source: string; timeline: string; consent: boolean; consent_note: string }; setF: (p: Partial<typeof f>) => void }) {
  const { t } = useApp();
  return (
    <div className="fgrid">
      <Field label={t('pp.f.contact')} htmlFor="oc-n"><input id="oc-n" value={f.contact_name} maxLength={200} onChange={(e) => setF({ contact_name: e.target.value })} data-testid="oc-name" /></Field>
      <Field label={t('pp.f.email')} htmlFor="oc-e"><input id="oc-e" type="email" value={f.contact_email} maxLength={320} onChange={(e) => setF({ contact_email: e.target.value })} /></Field>
      <Field label={t('pp.f.phone')} htmlFor="oc-p"><input id="oc-p" value={f.contact_phone} maxLength={40} onChange={(e) => setF({ contact_phone: e.target.value })} /></Field>
      <Field label={t('pp.f.source')} htmlFor="oc-s"><input id="oc-s" value={f.lead_source} maxLength={200} onChange={(e) => setF({ lead_source: e.target.value })} /></Field>
      <Field label={t('pp.f.timeline')} htmlFor="oc-t" full><input id="oc-t" value={f.timeline} maxLength={400} onChange={(e) => setF({ timeline: e.target.value })} /></Field>
      <label className="check full pp-consent"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ consent: e.target.checked })} data-testid="oc-consent" /><span>{t('pp.f.consent')}</span></label>
      <Field label={t('pp.f.consentNote')} htmlFor="oc-cn" full><input id="oc-cn" value={f.consent_note} maxLength={400} onChange={(e) => setF({ consent_note: e.target.value })} placeholder={t('pp.f.consentNotePh')} /></Field>
    </div>
  );
}

export { isoDate };
