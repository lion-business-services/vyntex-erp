// The offer builder. The partner picks published catalog items and quantities, may ask for a discount on one-time
// charges, and saves: the server prices the offer, estimates the partner's pay and says whether VYNTEX must approve it.
// Nothing typed here is a price. Approved offers are shared by a private link (or emailed to the client), and an
// accepted offer becomes an order without retyping it.
import { useEffect, useMemo, useState } from 'react';
import { LuCopy, LuEye, LuLink, LuPlus, LuSend, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate, useRoute } from '@/app/router';
import { Badge, Button, Card, Field, Modal, Note, confirmDialog, toast } from '@/ui';
import { api, type CatalogItem, type Context, type Offer } from './api';
import { ProposalDocument } from './proposal';
import { Failed, Loading, Status, isoDate, newKey, pct, tx, usd, useErrorText, useLoad } from './shared';

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
  if (!offer.data || !cat.data) return <Loading />;
  const o = offer.data.offer;
  if (!isNew && !o) return <Loading />;
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

  return (
    <div className="pp-stack" data-testid="pp-builder">
      <div className="pp-hero">
        <p className="xs"><Link to="/partners/catalog/offers">{t('pp.cat.offers')}</Link></p>
        <h1>{saved ? `${t('pp.offer.title')} ${saved.ref}` : t('pp.offer.new')}</h1>
        <p className="muted">{t('pp.offer.builderSub')}</p>
        {saved && <div className="row"><Status value={saved.status} />{saved.status === 'changes_requested' && <span className="small">{saved.events.filter((e) => e.kind === 'changes_requested').slice(-1)[0]?.note}</span>}</div>}
      </div>
      <div className="pp-builder">
        <div className="pp-stack">
          <Card title={t('pp.offer.client')}>
            <div className="fgrid">
              <Field label={t('pp.f.clientName')} htmlFor="ob-cn" error={!!err && !d.client_name.trim()}><input id="ob-cn" value={d.client_name} maxLength={200} onChange={(e) => set({ client_name: e.target.value })} data-testid="ob-client" /></Field>
              <Field label={t('pp.f.contact')} htmlFor="ob-cc"><input id="ob-cc" value={d.client_contact} maxLength={200} onChange={(e) => set({ client_contact: e.target.value })} /></Field>
              <Field label={t('pp.f.email')} htmlFor="ob-ce"><input id="ob-ce" type="email" value={d.client_email} maxLength={320} onChange={(e) => set({ client_email: e.target.value })} /></Field>
              <Field label={t('pp.f.phone')} htmlFor="ob-cp"><input id="ob-cp" value={d.client_phone} maxLength={40} onChange={(e) => set({ client_phone: e.target.value })} /></Field>
              <Field label={t('pp.f.industry')} htmlFor="ob-ci"><input id="ob-ci" value={d.industry} maxLength={80} onChange={(e) => set({ industry: e.target.value })} /></Field>
              <Field label={t('pp.f.lang')} htmlFor="ob-cl"><select id="ob-cl" value={d.lang} onChange={(e) => set({ lang: e.target.value as 'en' | 'es' })}><option value="en">English</option><option value="es">Español</option></select></Field>
              <Field label={t('pp.f.requirements')} htmlFor="ob-cr" full hint={t('pp.f.requirementsHint')}><textarea id="ob-cr" rows={3} maxLength={4000} value={d.requirements} onChange={(e) => set({ requirements: e.target.value })} /></Field>
            </div>
          </Card>
          <Card title={t('pp.offer.services')}>
            {!d.lines.length && <p className="small muted">{t('pp.offer.noLines')}</p>}
            <ul className="pp-lines">
              {d.lines.map((l, n) => {
                const it = byId.get(l.item);
                return (
                  <li key={l.item}>
                    <div className="grow"><b>{it ? tx(it.name, lang) : l.item}</b>{it?.quote && <> <Badge tone="warn">{t('pp.cat.quote')}</Badge></>}<br /><span className="xs dim">{it ? tx(it.tagline, lang) : ''}</span></div>
                    <label className="xs">{t('pp.f.qty')} <input type="number" min={1} max={50} value={l.quantity} className="pp-qty"
                      onChange={(e) => set({ lines: d.lines.map((x, i) => (i === n ? { ...x, quantity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) } : x)) })} /></label>
                    <Button size="sm" variant="ghost" icon={<LuTrash2 />} aria-label={t('pp.remove')} onClick={() => set({ lines: d.lines.filter((_, i) => i !== n) })} />
                  </li>
                );
              })}
            </ul>
            <div className="row">
              <select aria-label={t('pp.offer.add')} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="ob-pick">
                <option value="">{t('pp.offer.choose')}</option>
                {items.filter((i) => !d.lines.some((l) => l.item === i.id)).map((i) => <option key={i.id} value={i.id}>{tx(i.name, lang)}{i.quote ? ` (${t('pp.cat.quote')})` : ''}</option>)}
              </select>
              <Button icon={<LuPlus />} onClick={addLine} disabled={!pick} data-testid="ob-add">{t('pp.offer.add')}</Button>
            </div>
          </Card>
          <Card title={t('pp.offer.presentation')}>
            <div className="fgrid">
              <Field label={t('pp.f.title')} htmlFor="ob-t" full><input id="ob-t" value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder={t('pp.f.titlePh')} /></Field>
              <Field label={t('pp.f.summary')} htmlFor="ob-s" full hint={t('pp.f.summaryHint')}><textarea id="ob-s" rows={4} maxLength={4000} value={d.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
              <Field label={t('pp.f.discount')} htmlFor="ob-d" hint={t('pp.f.discountHint')}><input id="ob-d" inputMode="decimal" value={d.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="0" /></Field>
              <Field label={t('pp.f.validDays')} htmlFor="ob-v"><input id="ob-v" type="number" min={1} max={90} value={d.valid_days} onChange={(e) => set({ valid_days: Math.max(1, Math.min(90, Number(e.target.value) || 30)) })} /></Field>
            </div>
          </Card>
        </div>
        <aside className="pp-stack pp-side">
          <Totals offer={saved} dirty={dirty} partner />
          {err && <Note tone="bad"><span role="alert" data-testid="ob-error">{err}</span></Note>}
          <div className="pp-side-actions">
            <Button onClick={() => void save(true)} disabled={busy} data-testid="ob-save">{t('pp.offer.save')}</Button>
            <Button variant="primary" icon={<LuSend />} onClick={() => void submit()} disabled={busy || !d.lines.length} data-testid="ob-submit">{t('pp.offer.submit')}</Button>
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
  if (!offer) return <Card title={t('pp.offer.totals')}><p className="small muted">{t('pp.offer.saveToPrice')}</p></Card>;
  const blocking = offer.approval_reasons.filter((r) => r.blocking !== false);
  const uncovered = offer.approval_reasons.find((r) => r.code === 'pay_not_approved');
  return (
    <Card title={t('pp.offer.totals')}>
      {dirty && <Note tone="warn">{t('pp.offer.dirty')}</Note>}
      <dl className="pp-prices">
        <div className="pp-price-row"><dt>{t('pp.price.setup')}</dt><dd>{usd(offer.setup_cents + offer.one_time_cents)}</dd></div>
        {offer.discount_cents > 0 && <div className="pp-price-row"><dt>{t('pp.offer.discount', { pct: pct(offer.discount_bps) })}</dt><dd>-{usd(offer.discount_cents)}</dd></div>}
        <div className="pp-price-row"><dt>{t('pp.price.recurring')}</dt><dd>{usd(offer.recurring_cents)} {t('pp.per.month')}</dd></div>
        <div className="pp-price-row strong"><dt>{t('pp.offer.deposit')}</dt><dd>{usd(offer.deposit_cents)}</dd></div>
      </dl>
      {partner && (
        <div className="pp-earn">
          <p className="xs strong">{t('pp.earn.estimateTitle')}</p>
          <p><b data-testid="ob-est">{usd(offer.estimate?.once_cents ?? 0)}</b>{(offer.estimate?.monthly_cents ?? 0) > 0 && <> + <b>{usd(offer.estimate.monthly_cents)}</b> {t('pp.per.month')}</>}</p>
          {uncovered && <p className="xs"><Badge tone="warn">{t('pp.st.needs_approval')}</Badge> {t('pp.earn.uncovered', { items: (uncovered.items ?? []).join(', ') })}</p>}
          <p className="xs dim">{t('pp.earn.disclaimer')}</p>
        </div>
      )}
      {blocking.length > 0 && <Note tone="warn"><b>{t('pp.offer.needsApproval')}</b><ul className="xs">{blocking.map((r, n) => <li key={n}>{t('pp.reason.' + r.code, { item: r.item ?? '' })}</li>)}</ul></Note>}
    </Card>
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
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast(t('pp.copied')); } catch { toast(t('pp.copyFailed'), true); } };
  const decide = async (decision: 'accepted' | 'declined') => {
    if (!(await confirmDialog(t(decision === 'accepted' ? 'pp.offer.recordAccepted' : 'pp.offer.recordDeclined'), t('pp.confirm'), t('pp.cancel'), decision === 'declined'))) return;
    void act('decision', { decision });
  };
  return (
    <div className="pp-stack" data-testid="pp-offer">
      <div className="pp-hero">
        <p className="xs"><Link to="/partners/catalog/offers">{t('pp.cat.offers')}</Link></p>
        <h1>{t('pp.offer.title')} {o.ref}</h1>
        <div className="row"><Status value={o.status} /><span className="small muted">{o.client_name}{staff ? ` · ${o.partner.name} (${o.partner.code})` : ''}</span></div>
      </div>
      <div className="pp-builder">
        <div className="pp-stack">
          <Card title={t('pp.offer.services')}>
            <ul className="pp-lines">{o.lines.map((l, n) => <li key={n}><div className="grow"><b>{l.quantity > 1 ? `${l.quantity} x ` : ''}{tx(l.name, o.lang)}</b>{l.quote && <> <Badge tone="warn">{t('pp.cat.quote')}</Badge></>}</div>
              <span className="small">{[l.setup_cents + l.one_time_cents ? usd(l.setup_cents + l.one_time_cents) : '', l.recurring_cents ? `${usd(l.recurring_cents)} ${t('pp.per.month')}` : ''].filter(Boolean).join(' + ')}</span></li>)}</ul>
          </Card>
          {staff && o.status === 'pending_approval' && <Decide offer={o} onDone={setOffer} />}
          <Card title={t('pp.offer.history')}>
            <ol className="pp-timeline">{o.events.map((e, n) => <li key={n}><span className="xs dim">{dateTime(e.at)}</span> <b>{t('pp.ev.' + e.kind) !== 'pp.ev.' + e.kind ? t('pp.ev.' + e.kind) : e.kind}</b>{e.note ? `: ${e.note}` : ''}</li>)}</ol>
          </Card>
          {!!o.shares.length && (
            <Card title={t('pp.offer.links')}>
              <ul className="small">{o.shares.map((s) => <li key={s.id} className="row between">
                <span>{t('pp.offer.linkMade', { date: dateTime(s.created_at) })} · {t('pp.offer.views', { n: s.views })}{s.revoked ? ` · ${t('pp.offer.revoked')}` : ` · ${t('pp.offer.until', { date: dateTime(s.expires_at) })}`}</span>
                {!s.revoked && !staff && <Button size="sm" variant="ghost" onClick={() => void act('share-revoke', { share: s.id }).then(reload)}>{t('pp.offer.revoke')}</Button>}
              </li>)}</ul>
            </Card>
          )}
        </div>
        <aside className="pp-stack pp-side">
          <Totals offer={o} partner />
          <div className="pp-side-actions">
            <Button variant="ghost" icon={<LuEye />} onClick={() => setPreview(true)}>{t('pp.offer.preview')}</Button>
            {!staff && ['approved', 'sent', 'viewed'].includes(o.status) && <Button variant="primary" icon={<LuLink />} onClick={() => void share(false)} data-testid="ob-share">{t('pp.offer.share')}</Button>}
            {!staff && ['approved', 'sent', 'viewed'].includes(o.status) && o.client_email && <Button icon={<LuSend />} onClick={() => void share(true)}>{t('pp.offer.email', { email: o.client_email })}</Button>}
            {!staff && ['approved', 'sent', 'viewed'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => void decide('declined')}>{t('pp.offer.markDeclined')}</Button>}
            {!staff && ['sent', 'viewed'].includes(o.status) && <p className="xs dim">{t('pp.offer.clientAccepts')}</p>}
            {staff && ['sent', 'viewed'].includes(o.status) && <Button size="sm" onClick={() => setAccepting(true)} data-testid="ob-staff-accept">{t('pp.offer.staffAccept')}</Button>}
            {!staff && o.status === 'accepted' && <Button variant="primary" onClick={() => setOrdering(true)} data-testid="ob-order">{t('pp.offer.toOrder')}</Button>}
            {!staff && o.order_id && <Link to={'/partners/orders/' + o.order_id} className="btn">{t('pp.offer.seeOrder')}</Link>}
            {!staff && <Button size="sm" variant="ghost" icon={<LuCopy />} onClick={() => void act('duplicate')}>{t('pp.offer.duplicate')}</Button>}
            {!staff && !['accepted', 'ordered', 'withdrawn', 'declined', 'expired'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => void act('withdraw')}>{t('pp.offer.withdraw')}</Button>}
          </div>
          {link && (
            <Card title={t('pp.offer.linkTitle')}>
              <p className="xs muted">{t(link.delivery === 'sent' ? 'pp.offer.linkSent' : 'pp.offer.linkOnce', { date: dateTime(link.expiresAt) })}</p>
              <div className="row nowrap"><input readOnly value={link.link} aria-label={t('pp.offer.linkTitle')} onFocus={(e) => e.currentTarget.select()} data-testid="ob-link" /><Button size="sm" icon={<LuCopy />} onClick={() => void copy(link.link)}>{t('pp.copy')}</Button></div>
            </Card>
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
    <Modal title={t('pp.offer.staffAccept')} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.offer.staffAcceptNote')}</p>
      <Field label={t('pp.mg.personName')} htmlFor="sa-n"><input id="sa-n" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('pp.offer.staffAcceptHow')} htmlFor="sa-r"><textarea id="sa-r" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()}>{t('pp.confirm')}</Button></div>
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
    <Card title={t('pp.offer.decideTitle')}>
      <ul className="xs">{offer.approval_reasons.map((r, n) => <li key={n}>{t('pp.reason.' + r.code, { item: r.item ?? '' })}</li>)}</ul>
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
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><Button variant="primary" onClick={() => void go('approve')} data-testid="od-approve">{t('pp.offer.approve')}</Button><Button onClick={() => void go('changes')}>{t('pp.offer.changes')}</Button></div>
    </Card>
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
    <Modal title={t('pp.offer.toOrder')} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.order.fromOffer', { ref: offer.ref, client: offer.client_name })}</p>
      <OrderContactFields f={f} setF={(p) => setF({ ...f, ...p })} />
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => void go()} data-testid="oo-submit">{t('pp.order.submit')}</Button></div>
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
      <label className="pp-check small full"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ consent: e.target.checked })} data-testid="oc-consent" /> {t('pp.f.consent')}</label>
      <Field label={t('pp.f.consentNote')} htmlFor="oc-cn" full><input id="oc-cn" value={f.consent_note} maxLength={400} onChange={(e) => setF({ consent_note: e.target.value })} placeholder={t('pp.f.consentNotePh')} /></Field>
    </div>
  );
}

export { isoDate };
