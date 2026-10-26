// Catalog & Offers. Client View is what a partner shows a prospect: the server sends only client-safe fields for it.
// Partner View adds the partner's own estimated pay under the approved policies (or "Needs VYNTEX approval").
// VYNTEX staff also maintain the catalog and the commission policies here (publishing and approving need an
// administrator and a fresh identity check, enforced in the database).
import { useMemo, useState } from 'react';
import { LuCheck, LuColumns3, LuExternalLink, LuPlus, LuPresentation, LuShieldAlert } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate } from '@/app/router';
import { Badge, Button, Card, Field, Modal, Note, SearchBox, Seg, Tabs, confirmDialog, cx, toast } from '@/ui';
import { plansFor, planName } from '@/lib/pricing';
import { api, type Catalog, type CatalogItem, type Context, type OfferRow, type PartnerOrg } from './api';
import { Failed, Loading, Section, Status, pct, tl, tx, usd, useErrorText, useLoad } from './shared';

type Tab = 'client' | 'partner' | 'offers' | 'resources' | 'manage' | 'policies';

export default function CatalogPage({ ctx, tab: fromAddress }: { ctx: Context; tab?: string }) {
  const { t } = useApp();
  const staff = ctx.kind === 'staff';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'client', label: t('pp.cat.client') }, { id: 'partner', label: t('pp.cat.partner') }, { id: 'offers', label: t('pp.cat.offers') },
    { id: 'resources', label: t('pp.cat.resources') }, ...(staff ? [{ id: 'manage' as Tab, label: t('pp.cat.manage') }, { id: 'policies' as Tab, label: t('pp.cat.policies') }] : []),
  ];
  const tab: Tab = tabs.some((x) => x.id === fromAddress) ? (fromAddress as Tab) : 'client';
  return (
    <div className="pp-stack">
      <div className="pp-hero"><h1>{t('pp.nav.catalog')}</h1><p className="muted">{t('pp.cat.sub')}</p></div>
      <Tabs value={tab} onChange={(v) => navigate('/partners/catalog/' + v)} tabs={tabs} />
      {tab === 'client' && <CatalogView ctx={ctx} view="client" />}
      {tab === 'partner' && <CatalogView ctx={ctx} view="partner" />}
      {tab === 'offers' && <OfferList ctx={ctx} />}
      {tab === 'resources' && <Resources ctx={ctx} />}
      {tab === 'manage' && staff && <ManageCatalog ctx={ctx} />}
      {tab === 'policies' && staff && <Policies ctx={ctx} />}
    </div>
  );
}

/** For staff: which partner's Partner View to preview (read only, audited by the database). */
function usePreviewPartner(enabled: boolean) {
  const [as, setAs] = useState('');
  const list = useLoad(() => (enabled ? api.admin.get<{ partners: PartnerOrg[] }>('partners') : Promise.resolve({ ok: true as const, status: 200, data: { partners: [] as PartnerOrg[] } })), [enabled]);
  return { as, setAs, partners: list.data?.partners ?? [] };
}

function CatalogView({ ctx, view }: { ctx: Context; view: 'client' | 'partner' }) {
  const { t, lang } = useApp();
  const staff = ctx.kind === 'staff';
  const preview = usePreviewPartner(staff && view === 'partner');
  const cat = useLoad(() => api.catalog(view, preview.as || undefined), [view, preview.as]);
  const [q, setQ] = useState('');
  const [cat1, setCat1] = useState('all');
  const [compare, setCompare] = useState<string[]>([]);
  const [present, setPresent] = useState<CatalogItem | null>(null);
  const [comparing, setComparing] = useState(false);
  const items = useMemo(() => (cat.data?.catalog.items ?? []).filter((i) => (cat1 === 'all' || i.category === cat1)
    && (!q.trim() || `${tx(i.name, lang)} ${tx(i.tagline, lang)} ${tx(i.best_for, lang)} ${tl(i.includes, lang).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))), [cat.data, cat1, q, lang]);
  if (cat.error) return <Failed text={cat.error} retry={cat.reload} />;
  if (!cat.data) return <Loading />;
  const c: Catalog = cat.data.catalog;
  const toggle = (id: string) => setCompare((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id]));
  return (
    <>
      {view === 'client' && <Note>{t('pp.cat.clientNote')}</Note>}
      {view === 'partner' && <Note tone="warn"><LuShieldAlert aria-hidden="true" /> {t('pp.cat.partnerNote')}</Note>}
      {staff && view === 'partner' && (
        <Field label={t('pp.cat.previewAs')} htmlFor="pp-as">
          <select id="pp-as" value={preview.as} onChange={(e) => preview.setAs(e.target.value)} data-testid="pp-preview-as">
            <option value="">{t('pp.cat.previewNone')}</option>
            {preview.partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code}, {t('pp.lane.' + p.kind)})</option>)}
          </select>
        </Field>
      )}
      <div className="pp-filters">
        <div className="pp-search"><SearchBox value={q} onChange={setQ} placeholder={t('pp.cat.search')} label={t('pp.cat.search')} /></div>
        <Seg value={cat1} onChange={setCat1} label={t('pp.cat.category')} options={[{ value: 'all', label: t('pp.cat.all') }, ...c.categories.map((k) => ({ value: k.id, label: tx(k.name, lang) }))]} />
        {compare.length >= 2 && <Button icon={<LuColumns3 />} onClick={() => setComparing(true)} data-testid="pp-compare">{t('pp.cat.compareN', { n: compare.length })}</Button>}
        {ctx.kind === 'partner' && <Button variant="primary" icon={<LuPlus />} onClick={() => navigate('/partners/catalog/offers/new' + (compare.length ? '?items=' + compare.join(',') : ''))}>{t('pp.offer.new')}</Button>}
      </div>
      {!c.items.length && <Card><p className="small muted">{t('pp.cat.empty')}</p></Card>}
      {!!c.items.length && !items.length && <p className="small muted">{t('pp.cat.noMatch')}</p>}
      <div className="pp-grid">
        {items.map((i) => <ItemCard key={i.id} item={i} view={view} checked={compare.includes(i.id)} onCompare={() => toggle(i.id)} onPresent={() => setPresent(i)} />)}
      </div>
      {cat1 === 'all' && !q && <ErpSoftware view={view} />}
      {present && <Present item={present} onClose={() => setPresent(null)} />}
      {comparing && <Compare items={c.items.filter((i) => compare.includes(i.id))} onClose={() => setComparing(false)} />}
    </>
  );
}

function PriceLines({ item }: { item: CatalogItem }) {
  const { t, lang } = useApp();
  if (item.quote && !item.prices.length) return <p className="pp-price"><b>{t('pp.cat.quote')}</b></p>;
  const shown = item.prices.filter((p) => p.kind !== 'deposit');
  return (
    <dl className="pp-prices">
      {shown.map((p, n) => (
        <div key={n} className="pp-price-row">
          <dt>{t('pp.price.' + p.kind)}{p.optional ? ` (${t('pp.price.optional')})` : ''}</dt>
          <dd>{p.amount_cents !== null ? usd(p.amount_cents) : tx(p.label, lang) || t('pp.cat.quote')}{p.period !== 'one_time' ? ` ${t('pp.per.' + p.period)}` : ''}
            {p.minimum_term_months ? <span className="xs dim"> · {t('pp.price.term', { n: p.minimum_term_months })}</span> : null}</dd>
        </div>
      ))}
      {item.quote && <div className="pp-price-row"><dt>{t('pp.cat.quoteNote')}</dt><dd /></div>}
    </dl>
  );
}

function ItemCard({ item, view, checked, onCompare, onPresent }: { item: CatalogItem; view: 'client' | 'partner'; checked: boolean; onCompare: () => void; onPresent: () => void }) {
  const { t, lang } = useApp();
  const [all, setAll] = useState(false);
  const inc = tl(item.includes, lang); const exc = tl(item.excludes, lang);
  return (
    <article className={cx('card pp-item', item.popular && 'popular')} data-testid={`pp-item-${item.id}`}>
      <header className="row between nowrap"><h3>{tx(item.name, lang)}</h3>{item.popular && <Badge tone="accent">{t('pp.cat.popular')}</Badge>}</header>
      {tx(item.tagline, lang) && <p className="pp-tagline">{tx(item.tagline, lang)}</p>}
      {tx(item.best_for, lang) && <p className="xs muted"><b>{t('pp.cat.bestFor')}</b> {tx(item.best_for, lang)}</p>}
      <PriceLines item={item} />
      {!!inc.length && <ul className="pp-inc">{(all ? inc : inc.slice(0, 5)).map((x, n) => <li key={n}><LuCheck aria-hidden="true" />{x}</li>)}</ul>}
      {inc.length > 5 && <button type="button" className="linkbtn xs" onClick={() => setAll(!all)}>{all ? t('pp.cat.less') : t('pp.cat.more', { n: inc.length - 5 })}</button>}
      {all && !!exc.length && <><p className="xs strong">{t('pp.cat.excludes')}</p><ul className="pp-exc xs muted">{exc.map((x, n) => <li key={n}>{x}</li>)}</ul></>}
      {tx(item.lead_time, lang) && <p className="xs dim">{t('pp.cat.lead', { time: tx(item.lead_time, lang) })}</p>}
      {view === 'partner' && <Earnings item={item} />}
      <footer className="row">
        <Button size="sm" icon={<LuPresentation />} onClick={onPresent}>{t('pp.cat.present')}</Button>
        <label className="pp-check xs"><input type="checkbox" checked={checked} onChange={onCompare} /> {t('pp.cat.compare')}</label>
      </footer>
    </article>
  );
}

function Earnings({ item }: { item: CatalogItem }) {
  const { t } = useApp();
  const c = item.compensation;
  return (
    <div className="pp-earn" data-testid={`pp-earn-${item.id}`}>
      <p className="xs strong">{t('pp.earn.title')}</p>
      {!c && <p className="xs muted">{t('pp.earn.choose')}</p>}
      {c && c.status === 'needs_approval' && <p className="xs"><Badge tone="warn">{t('pp.st.needs_approval')}</Badge> {t('pp.earn.none')}</p>}
      {c && c.status === 'approved' && (
        <ul className="xs">
          {c.lines.map((l) => (
            <li key={l.policy}>
              <b>{l.estimate_cents !== null ? usd(l.estimate_cents) : ''}</b>{l.per === 'month' ? ` ${t('pp.per.month')}` : ''} · {l.model === 'referral_flat_fee' ? t('pp.earn.flat') : t('pp.earn.rate', { rate: pct(l.rate_bps) })}
              {l.min_order_cents ? ` · ${t('pp.earn.min', { amount: usd(l.min_order_cents) })}` : ''}
              {l.clawback_days ? ` · ${t('pp.earn.clawback', { n: l.clawback_days })}` : ''}
            </li>
          ))}
        </ul>
      )}
      {item.floors && Object.keys(item.floors).length > 0 && <p className="xs muted">{t('pp.earn.floor')}: {Object.entries(item.floors).map(([k, v]) => `${t('pp.price.' + k.split(':')[0])} ${usd(v)}`).join(', ')}</p>}
      {item.deposit_cents ? <p className="xs muted">{t('pp.earn.deposit', { amount: usd(item.deposit_cents) })}</p> : null}
      {item.partner_notes && <p className="xs muted">{item.partner_notes}</p>}
      <p className="xs dim">{t('pp.earn.disclaimer')}</p>
    </div>
  );
}

function Present({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const { t, lang } = useApp();
  return (
    <Modal title={tx(item.name, lang)} onClose={onClose} size="wide" labelClose={t('pp.close')}>
      <div className="pp-present" data-testid="pp-present">
        {tx(item.tagline, lang) && <p className="pp-present-lead">{tx(item.tagline, lang)}</p>}
        <div className="pp-present-grid">
          <div>
            <h3>{t('pp.cat.includes')}</h3>
            <ul className="pp-inc">{tl(item.includes, lang).map((x, n) => <li key={n}><LuCheck aria-hidden="true" />{x}</li>)}</ul>
          </div>
          <div>
            <h3>{t('pp.cat.investment')}</h3>
            <PriceLines item={item} />
            {tx(item.lead_time, lang) && <p className="small muted">{t('pp.cat.lead', { time: tx(item.lead_time, lang) })}</p>}
            {!!tl(item.excludes, lang).length && <><h3>{t('pp.cat.excludes')}</h3><ul className="small muted">{tl(item.excludes, lang).map((x, n) => <li key={n}>{x}</li>)}</ul></>}
            {tx(item.best_for, lang) && <p className="small"><b>{t('pp.cat.bestFor')}</b> {tx(item.best_for, lang)}</p>}
          </div>
        </div>
        <p className="xs dim">{t('pp.cat.presentFoot')}</p>
      </div>
    </Modal>
  );
}

function Compare({ items, onClose }: { items: CatalogItem[]; onClose: () => void }) {
  const { t, lang } = useApp();
  const price = (i: CatalogItem, kind: string) => { const p = i.prices.find((x) => x.kind === kind && !x.optional); return p && p.amount_cents !== null ? usd(p.amount_cents) : i.quote ? t('pp.cat.quote') : '-'; };
  return (
    <Modal title={t('pp.cat.compareTitle')} onClose={onClose} size="wide" labelClose={t('pp.close')}>
      <div className="table-wrap">
        <table className="tbl pp-compare">
          <thead><tr><th /><>{items.map((i) => <th key={i.id}>{tx(i.name, lang)}</th>)}</></tr></thead>
          <tbody>
            <tr><th>{t('pp.price.setup')}</th>{items.map((i) => <td key={i.id}>{price(i, 'setup')}</td>)}</tr>
            <tr><th>{t('pp.price.recurring')}</th>{items.map((i) => <td key={i.id}>{price(i, 'recurring')}</td>)}</tr>
            <tr><th>{t('pp.price.one_time')}</th>{items.map((i) => <td key={i.id}>{price(i, 'one_time')}</td>)}</tr>
            <tr><th>{t('pp.cat.bestFor')}</th>{items.map((i) => <td key={i.id} className="small">{tx(i.best_for, lang)}</td>)}</tr>
            <tr><th>{t('pp.cat.includes')}</th>{items.map((i) => <td key={i.id} className="small"><ul className="pp-inc">{tl(i.includes, lang).map((x, n) => <li key={n}><LuCheck aria-hidden="true" />{x}</li>)}</ul></td>)}</tr>
            <tr><th>{t('pp.cat.leadTime')}</th>{items.map((i) => <td key={i.id} className="small">{tx(i.lead_time, lang)}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** VYNTEX ERP software: prices from src/lib/pricing.ts only (the published price file), never from the partner catalog. */
function ErpSoftware({ view }: { view: 'client' | 'partner' }) {
  const { t, lang } = useApp();
  const plans = plansFor('build');
  return (
    <Section title={t('pp.erp.title')} sub={t('pp.erp.sub')}>
      <div className="pp-grid">
        {plans.map((p) => (
          <article key={p.id} className="card pp-item">
            <h3>VYNTEX BUILD {planName(p, lang)}</h3>
            <dl className="pp-prices">
              <div className="pp-price-row"><dt>{t('pp.price.recurring')}</dt><dd>{usd(p.monthly * 100)} {t('pp.per.month')}</dd></div>
              <div className="pp-price-row"><dt>{t('pp.price.setup')}</dt><dd>{usd(p.setup * 100)}</dd></div>
            </dl>
            {view === 'partner' && <p className="xs"><Badge tone="warn">{t('pp.st.needs_approval')}</Badge> {t('pp.erp.pay')}</p>}
          </article>
        ))}
      </div>
      <p className="small"><a href="/pricing" target="_blank" rel="noopener" className="pp-link">{t('pp.erp.more')}<LuExternalLink aria-hidden="true" /></a></p>
    </Section>
  );
}

function OfferList({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const offers = useLoad(() => api.offers(), []);
  const [status, setStatus] = useState('all');
  if (offers.error) return <Failed text={offers.error} retry={offers.reload} />;
  if (!offers.data) return <Loading />;
  const list: OfferRow[] = offers.data.offers.filter((o) => status === 'all' || o.status === status);
  const staff = ctx.kind === 'staff';
  return (
    <Card flush title={t('pp.cat.offers')} actions={<div className="row">
      <select aria-label={t('pp.filter.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        {['all', 'draft', 'pending_approval', 'changes_requested', 'approved', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'ordered', 'withdrawn'].map((s) => <option key={s} value={s}>{s === 'all' ? t('pp.cat.all') : t('pp.st.' + s)}</option>)}
      </select>
      {!staff && <Button variant="primary" icon={<LuPlus />} onClick={() => navigate('/partners/catalog/offers/new')} data-testid="pp-offer-new">{t('pp.offer.new')}</Button>}
    </div>}>
      {!list.length ? <div className="pp-pad"><p className="small muted">{t(staff ? 'pp.offer.noneStaff' : 'pp.offer.none')}</p></div> : (
        <div className="table-wrap">
          <table className="tbl" data-testid="pp-offers">
            <thead><tr><th>{t('pp.col.ref')}</th><th>{t('pp.col.client')}</th>{staff && <th>{t('pp.col.partner')}</th>}<th>{t('pp.col.status')}</th><th className="num">{t('pp.col.setup')}</th><th className="num">{t('pp.col.monthly')}</th>{!staff && <th className="num">{t('pp.col.estimate')}</th>}<th>{t('pp.col.validUntil')}</th></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="click" onClick={() => navigate('/partners/catalog/offers/' + o.id)}>
                  <td><Link to={'/partners/catalog/offers/' + o.id}>{o.ref}</Link></td><td>{o.client_name}{o.title ? <><br /><span className="xs dim">{o.title}</span></> : null}</td>
                  {staff && <td>{o.partner}</td>}
                  <td><Status value={o.status} /></td><td className="num">{usd(o.setup_cents + o.one_time_cents)}</td><td className="num">{usd(o.recurring_cents)}</td>
                  {!staff && <td className="num">{o.est_once_cents !== null ? usd(o.est_once_cents) : ''}{o.est_monthly_cents ? <span className="xs dim"> + {usd(o.est_monthly_cents)} {t('pp.per.month')}</span> : null}</td>}
                  <td>{dateTime(o.valid_until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Resources({ ctx }: { ctx: Context }) {
  const { t, lang } = useApp();
  const cat = useLoad(() => api.catalog('partner'), []);
  const [open, setOpen] = useState<string | null>(null);
  if (cat.error) return <Failed text={cat.error} retry={cat.reload} />;
  if (!cat.data) return <Loading />;
  const list = cat.data.catalog.resources;
  return (
    <div className="pp-stack">
      {!list.length && <Card><p className="small muted">{t(ctx.kind === 'staff' ? 'pp.res.noneStaff' : 'pp.res.none')}</p></Card>}
      {list.map((r) => (
        <Card key={r.slug}>
          <button type="button" className="pp-res-h" aria-expanded={open === r.slug} onClick={() => setOpen(open === r.slug ? null : r.slug)}>
            <Badge tone="info">{t('pp.res.' + r.kind)}</Badge> <b>{tx(r.title, lang)}</b>
          </button>
          {open === r.slug && <div className="pp-res-body">{(tx(r.body, lang) || '').split('\n').map((l, n) => <p key={n}>{l}</p>)}
            {lang === 'es' && !r.body.es && <p className="xs dim">{t('pp.res.enOnly')}</p>}</div>}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Staff: catalog maintenance and policy approval
// ---------------------------------------------------------------------------------------------------------------------
interface AdminVersion { id: string; version: number; status: string; quote_only: boolean; client_facing: boolean; name: { en?: string; es?: string }; tagline: { en?: string; es?: string };
  priced: boolean; provenance: Record<string, unknown>; prices: { id: string; kind: string; amount_cents: number | null; period: string; status: string; optional: boolean; floor_cents: number | null; minimum_term_months: number | null; provenance: Record<string, unknown> }[] }
interface AdminItem { id: string; category: string; kind: string; active: boolean; versions: AdminVersion[] }

function ManageCatalog({ ctx }: { ctx: Context }) {
  const { t, lang } = useApp();
  const admin = ctx.role === 'partner_admin';
  const errText = useErrorText();
  const data = useLoad(() => api.admin.get<{ catalog: { items: AdminItem[] } }>('catalog'), []);
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const [busy, setBusy] = useState(false);
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const items = data.data.catalog.items;
  const ready = items.filter((i) => !i.versions.some((v) => v.status === 'published') && i.versions.some((v) => v.status === 'draft' && !v.quote_only && v.prices.every((p) => p.status !== 'needs_approval'))).length;
  const publishReady = async () => {
    if (!(await confirmDialog(t('pp.adm.publishReadyAsk', { n: ready }), t('pp.adm.publishReady'), t('pp.cancel'), false))) return;
    setBusy(true);
    const r = await api.admin.post<{ published: { items: number; resources: number } }>('catalog/publish-ready');
    setBusy(false);
    if (r.ok) { toast(t('pp.adm.published', { n: r.data.published.items })); void data.reload(); } else toast(errText(r), true);
  };
  const publish = async (v: AdminVersion) => {
    const r = await api.admin.post(`catalog/versions/${v.id}/publish`);
    if (r.ok) { toast(t('pp.adm.publishedOne')); void data.reload(); } else toast(errText(r), true);
  };
  return (
    <div className="pp-stack">
      <Note>{t('pp.adm.catalogNote')}</Note>
      {admin && ready > 0 && <div className="row"><Button variant="primary" disabled={busy} onClick={() => void publishReady()} data-testid="pp-publish-ready">{t('pp.adm.publishReadyN', { n: ready })}</Button></div>}
      <Card flush title={t('pp.adm.items')}>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{t('pp.col.item')}</th><th>{t('pp.col.published')}</th><th>{t('pp.col.draft')}</th><th>{t('pp.col.source')}</th><th /></tr></thead>
            <tbody>
              {items.map((i) => {
                const pub = i.versions.find((v) => v.status === 'published');
                const draft = i.versions.find((v) => v.status === 'draft' || v.status === 'needs_approval');
                const needs = draft?.prices.filter((p) => p.status === 'needs_approval') ?? [];
                const src = (draft || pub)?.provenance as { status?: string; notes?: string[] } | undefined;
                return (
                  <tr key={i.id}>
                    <td><b>{tx((pub || draft || i.versions[0]).name, lang)}</b><br /><span className="xs dim">{i.id} · {t('pp.kind.' + i.kind)}</span></td>
                    <td>{pub ? <><Status value="published" /> <span className="xs dim">v{pub.version}{pub.quote_only ? ' · ' + t('pp.cat.quote') : ''}</span></> : <span className="xs dim">{t('pp.adm.notPublished')}</span>}</td>
                    <td>{draft ? <><Status value={draft.status} /> <span className="xs dim">v{draft.version}</span>{needs.length > 0 && <><br /><span className="xs neg">{t('pp.adm.pricesNeed', { n: needs.length })}</span></>}</> : ''}</td>
                    <td className="xs muted">{src?.notes?.length ? src.notes.join(' ') : src?.status ? t('pp.st.' + src.status) : ''}</td>
                    <td className="nowrap">
                      <Button size="sm" onClick={() => setEditing(i)}>{t('pp.adm.edit')}</Button>
                      {admin && draft && (draft.quote_only || !needs.length) && <Button size="sm" variant="primary" onClick={() => void publish(draft)}>{t('pp.adm.publish')}</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <EditItem item={editing} admin={admin} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void data.reload(); }} />}
    </div>
  );
}

function EditItem({ item, admin, onClose, onSaved }: { item: AdminItem; admin: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const base = item.versions.find((v) => v.status === 'draft' || v.status === 'needs_approval') || item.versions.find((v) => v.status === 'published') || item.versions[0];
  const [f, setF] = useState({ nameEn: base.name.en ?? '', nameEs: base.name.es ?? '', tagEn: base.tagline.en ?? '', tagEs: base.tagline.es ?? '', quote: base.quote_only });
  const [prices, setPrices] = useState(base.prices.map((p) => ({ ...p, amount: p.amount_cents === null ? '' : (p.amount_cents / 100).toFixed(2), floor: p.floor_cents === null ? '' : (p.floor_cents / 100).toFixed(2) })));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const cents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v.replace(/[$,\s]/g, '')) * 100));
  const save = async () => {
    setBusy(true); setErr('');
    const full = base as unknown as Record<string, unknown>;
    const version = { name: { en: f.nameEn, es: f.nameEs }, tagline: { en: f.tagEn, es: f.tagEs }, quote_only: f.quote, client_facing: base.client_facing,
      best_for: full.best_for, includes: full.includes, excludes: full.excludes, lead_time: full.lead_time, provenance: base.provenance,
      prices: prices.map((p) => ({ kind: p.kind, amount_cents: cents(p.amount), period: p.period, optional: p.optional, minimum_term_months: p.minimum_term_months, floor_cents: cents(p.floor), status: p.status, provenance: p.provenance })) };
    const r = await api.admin.post(`catalog/items/${item.id}/draft`, { version });
    setBusy(false);
    if (r.ok) { toast(t('pp.adm.draftSaved')); onSaved(); } else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.adm.editTitle', { id: item.id })} onClose={onClose} size="wide" labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.adm.editIntro')}</p>
      <div className="fgrid">
        <Field label={t('pp.adm.nameEn')} htmlFor="pe-ne"><input id="pe-ne" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={t('pp.adm.nameEs')} htmlFor="pe-ns"><input id="pe-ns" value={f.nameEs} onChange={(e) => setF({ ...f, nameEs: e.target.value })} /></Field>
        <Field label={t('pp.adm.tagEn')} htmlFor="pe-te" full><input id="pe-te" value={f.tagEn} onChange={(e) => setF({ ...f, tagEn: e.target.value })} /></Field>
        <Field label={t('pp.adm.tagEs')} htmlFor="pe-ts" full><input id="pe-ts" value={f.tagEs} onChange={(e) => setF({ ...f, tagEs: e.target.value })} /></Field>
      </div>
      <label className="pp-check small"><input type="checkbox" checked={f.quote} onChange={(e) => setF({ ...f, quote: e.target.checked })} /> {t('pp.adm.quoteOnly')}</label>
      <table className="tbl pp-edit-prices">
        <thead><tr><th>{t('pp.col.kind')}</th><th>{t('pp.col.amount')}</th><th>{t('pp.col.floor')}</th><th>{t('pp.col.status')}</th></tr></thead>
        <tbody>{prices.map((p, n) => (
          <tr key={p.id}>
            <td>{t('pp.price.' + p.kind)}{p.period !== 'one_time' ? ` ${t('pp.per.' + p.period)}` : ''}</td>
            <td><input aria-label={t('pp.col.amount')} inputMode="decimal" value={p.amount} onChange={(e) => setPrices(prices.map((x, i) => (i === n ? { ...x, amount: e.target.value } : x)))} /></td>
            <td><input aria-label={t('pp.col.floor')} inputMode="decimal" value={p.floor} onChange={(e) => setPrices(prices.map((x, i) => (i === n ? { ...x, floor: e.target.value } : x)))} /></td>
            <td><select aria-label={t('pp.col.status')} value={p.status} onChange={(e) => setPrices(prices.map((x, i) => (i === n ? { ...x, status: e.target.value } : x)))}>
              {['approved_source', 'approved', 'needs_approval', 'informational_estimate'].map((s) => <option key={s} value={s} disabled={!admin && s === 'approved'}>{t('pp.st.' + s)}</option>)}
            </select></td>
          </tr>
        ))}</tbody>
      </table>
      {!admin && <p className="xs dim">{t('pp.adm.managerPrices')}</p>}
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{t('pp.adm.saveDraft')}</Button></div>
    </Modal>
  );
}

interface PolicyVersion { id: string; version: number; status: string; model: string; lane: string | null; amount_cents: number | null; rate_bps: number | null; applies_to: string[];
  min_order_cents: number | null; clawback_days: number | null; payout_days: number | null; trigger_rule: string; note: string; approved_at: string | null }
interface Policy { id: string; name: { en?: string; es?: string }; provenance: { source?: string; ref?: string; source_status?: string }; conflicts: string[]; versions: PolicyVersion[];
  assignments: { id: string; partner: string; partner_id: string; version: number; note: string }[] | null }

function Policies({ ctx }: { ctx: Context }) {
  const { t, lang, dateTime } = useApp();
  const admin = ctx.role === 'partner_admin';
  const errText = useErrorText();
  const data = useLoad(() => api.admin.get<{ policies: Policy[] }>('policies'), []);
  const [editing, setEditing] = useState<Policy | null>(null);
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const approve = async (p: Policy, v: PolicyVersion) => {
    const what = v.model === 'referral_flat_fee' ? usd(v.amount_cents) : pct(v.rate_bps);
    if (!(await confirmDialog(t('pp.pol.approveAsk', { name: tx(p.name, lang), what }), t('pp.pol.approve'), t('pp.cancel'), false))) return;
    const r = await api.admin.post(`policy-versions/${v.id}/approve`);
    if (r.ok) { toast(t('pp.pol.approved')); void data.reload(); } else toast(errText(r), true);
  };
  return (
    <div className="pp-stack">
      <Note tone="warn">{t('pp.pol.note')}</Note>
      {data.data.policies.map((p) => {
        const latest = p.versions[0]; const live = p.versions.find((v) => v.status === 'approved');
        return (
          <Card key={p.id}>
            <div className="row between">
              <div><b>{tx(p.name, lang)}</b> <span className="xs dim">{p.id}</span></div>
              <div className="row">{live ? <Status value="approved" /> : <Status value={latest.status} />}</div>
            </div>
            <dl className="kv small pp-kv">
              <dt>{t('pp.pol.model')}</dt><dd>{t('pp.model.' + latest.model)}{latest.lane ? ` · ${t('pp.lane.' + latest.lane)}` : ''}</dd>
              {(latest.amount_cents !== null || latest.rate_bps !== null) && <><dt>{t('pp.pol.amount')}</dt><dd>{latest.amount_cents !== null ? usd(latest.amount_cents) : pct(latest.rate_bps)}</dd></>}
              {!!latest.applies_to.length && <><dt>{t('pp.pol.applies')}</dt><dd className="xs">{latest.applies_to.join(', ')}</dd></>}
              {latest.min_order_cents !== null && <><dt>{t('pp.pol.min')}</dt><dd>{usd(latest.min_order_cents)}</dd></>}
              {latest.clawback_days !== null && <><dt>{t('pp.pol.clawback')}</dt><dd>{t('pp.pol.days', { n: latest.clawback_days })}</dd></>}
              {latest.trigger_rule && <><dt>{t('pp.pol.trigger')}</dt><dd className="xs">{latest.trigger_rule}</dd></>}
              {latest.note && <><dt>{t('pp.pol.noteLabel')}</dt><dd className="xs">{latest.note}</dd></>}
              <dt>{t('pp.col.source')}</dt><dd className="xs dim">{p.provenance.source} {p.provenance.ref}</dd>
              {live && <><dt>{t('pp.pol.since')}</dt><dd className="xs">v{live.version} · {dateTime(live.approved_at ?? '')}</dd></>}
            </dl>
            {!!p.conflicts.length && <Note tone="bad"><b>{t('pp.pol.conflicts')}</b> {p.conflicts.join(' · ')}</Note>}
            {admin && (
              <div className="row">
                <Button size="sm" onClick={() => setEditing(p)}>{t('pp.pol.edit')}</Button>
                {(latest.status === 'draft' || latest.status === 'needs_approval') && <Button size="sm" variant="primary" onClick={() => void approve(p, latest)} data-testid={`pp-approve-${p.id}`}>{t('pp.pol.approve')}</Button>}
              </div>
            )}
          </Card>
        );
      })}
      {editing && <EditPolicy policy={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void data.reload(); }} />}
    </div>
  );
}

function EditPolicy({ policy, onClose, onSaved }: { policy: Policy; onClose: () => void; onSaved: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const v = policy.versions[0];
  const [f, setF] = useState({ amount: v.amount_cents === null ? '' : (v.amount_cents / 100).toFixed(2), rate: v.rate_bps === null ? '' : String(v.rate_bps / 100),
    min: v.min_order_cents === null ? '' : (v.min_order_cents / 100).toFixed(2), claw: v.clawback_days === null ? '' : String(v.clawback_days), applies: v.applies_to.join(', '), note: v.note });
  const [err, setErr] = useState('');
  const save = async () => {
    const num = (s: string, mult: number) => (s.trim() === '' ? null : Math.round(Number(s.replace(/[$,%\s]/g, '')) * mult));
    const changes = { amount_cents: num(f.amount, 100), rate_bps: num(f.rate, 100), min_order_cents: num(f.min, 100), clawback_days: num(f.claw, 1),
      applies_to: f.applies.split(',').map((x) => x.trim()).filter(Boolean), note: f.note };
    const r = await api.admin.post(`policies/${policy.id}/draft`, { changes });
    if (r.ok) { toast(t('pp.adm.draftSaved')); onSaved(); } else setErr(errText(r));
  };
  return (
    <Modal title={t('pp.pol.editTitle', { id: policy.id })} onClose={onClose} labelClose={t('pp.cancel')}>
      <p className="small muted">{t('pp.pol.editIntro')}</p>
      <div className="fgrid">
        <Field label={t('pp.pol.flat')} htmlFor="pp-pa"><input id="pp-pa" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t('pp.pol.rate')} htmlFor="pp-pr"><input id="pp-pr" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label={t('pp.pol.min')} htmlFor="pp-pm"><input id="pp-pm" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label={t('pp.pol.clawback')} htmlFor="pp-pc"><input id="pp-pc" inputMode="numeric" value={f.claw} onChange={(e) => setF({ ...f, claw: e.target.value })} /></Field>
        <Field label={t('pp.pol.applies')} htmlFor="pp-pp" full><input id="pp-pp" value={f.applies} onChange={(e) => setF({ ...f, applies: e.target.value })} /></Field>
        <Field label={t('pp.pol.noteLabel')} htmlFor="pp-pn" full><textarea id="pp-pn" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void save()}>{t('pp.adm.saveDraft')}</Button></div>
    </Modal>
  );
}
