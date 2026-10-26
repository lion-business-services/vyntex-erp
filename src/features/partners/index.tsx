// The VYNTEX Partner Portal: erp.vyntexusa.com/partners. Invite-only, the authenticator app always required, no trial.
// Three business modules (Catalog & Offers, Client Orders, Commissions & Payouts); VYNTEX partner staff see the same three
// with their administration inside, plus the Partners utility. Every screen reads from /api/partners, where the
// database decides what the person may see and do; hiding a button here is never the protection.
import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { LuArrowRight, LuBookOpen, LuBriefcase, LuChevronDown, LuCircleCheck, LuFileText, LuGauge, LuHandCoins, LuLogOut, LuMenu, LuPlus, LuShieldCheck, LuUsers, LuWallet, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate, useRoute } from '@/app/router';
import { Lockup } from '@/brand';
import { Button, Note, cx } from '@/ui';
import { post } from '@/platform/live/http';
import { setSessionEnd } from '@/platform/session';
import { setPrefs } from '@/store/store';
import { AuthFlow } from '@/features/auth/flow';
import { StepUpHost } from '@/features/auth/stepup';
import { Invite } from '@/features/auth/pages';
import { api, type Context } from './api';
import { Failed, Loading, Status, usd, useLoad } from './shared';
import { EmptyState, Initials, Kpi, Panel, PageHead, RowMenu, count } from './ui';
import './partners.css';

const CatalogPage = lazy(() => import('./catalog'));
const OfferPage = lazy(() => import('./offers').then((m) => ({ default: m.OfferPage })));
const OrdersPage = lazy(() => import('./orders'));
const CommissionsPage = lazy(() => import('./commissions'));
const ManagePage = lazy(() => import('./manage'));

type Gate = { at: 'checking' } | { at: 'auth' } | { at: 'denied'; email: string } | { at: 'offline' } | { at: 'ready'; ctx: Context };

export default function PartnersApp() {
  const route = useRoute();
  const { t } = useApp();
  const [, sub = '', id, more] = route.parts;
  useEffect(() => { document.title = `${t('pp.brand')} · VYNTEX`; }, [t]);
  if (sub === 'signin') return <SignInPage />;
  if (sub === 'invite') return <Invite token={id} kind="partner" />;
  return <Portal sub={sub} id={id} more={more} />;
}

function SignInPage() {
  const { t } = useApp();
  return (
    <div className="pp-auth">
      <p className="pp-auth-tag"><LuShieldCheck aria-hidden="true" />{t('pp.signin.tag')}</p>
      <AuthFlow onReady={() => navigate('/partners', { replace: true })} />
      <p className="xs dim pp-auth-note">{t('pp.signin.note')}</p>
    </div>
  );
}

function Portal({ sub, id, more }: { sub: string; id?: string; more?: string }) {
  const { t } = useApp();
  const [gate, setGate] = useState<Gate>({ at: 'checking' });
  const [drawer, setDrawer] = useState(false);
  const check = useCallback(async () => {
    const c = await api.context();
    if (c.ok) {
      if (!c.data.context.kind) { setGate({ at: 'denied', email: c.data.context.email ?? '' }); return; }
      setGate({ at: 'ready', ctx: c.data.context }); return;
    }
    if (c.status === 0 || c.status >= 500) { setGate({ at: 'offline' }); return; }
    setGate({ at: 'auth' });
  }, []);
  useEffect(() => { void check(); }, [check]);
  // the drawer closes when the page changes, and with Esc
  useEffect(() => { setDrawer(false); }, [sub, id, more]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', esc);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.pp-side.open .pp-side-nav a')?.focus());
    return () => document.removeEventListener('keydown', esc);
  }, [drawer]);
  const signOut = async () => { await post('/api/auth/signout', {}, { session: false, stepUp: false }); setSessionEnd(null); navigate('/partners/signin', { replace: true }); };

  if (gate.at === 'checking') return <div className="pp-shell pp-gate"><Loading /></div>;
  if (gate.at === 'auth') return <div className="pp-auth"><p className="pp-auth-tag"><LuShieldCheck aria-hidden="true" />{t('pp.signin.tag')}</p><AuthFlow onReady={() => { void check(); }} /></div>;
  if (gate.at === 'offline') return <div className="pp-shell pp-gate"><div className="pp-gate-card"><Lockup size="sm" /><Failed text={t('pp.err.offline')} retry={() => void check()} /></div></div>;
  if (gate.at === 'denied') {
    return (
      <div className="pp-shell pp-gate">
        <div className="pp-gate-card"><Lockup size="sm" /><Note tone="warn"><span role="alert" data-testid="pp-denied">{t('pp.denied')}</span></Note>
          <div className="row"><Button variant="primary" icon={<LuLogOut />} onClick={() => void signOut()}>{t('pp.signout')}</Button></div></div>
      </div>
    );
  }
  const ctx = gate.ctx;
  const staff = ctx.kind === 'staff';
  const admin = ctx.role === 'partner_admin';
  const nav = [
    { to: '/partners', id: '', label: t('pp.nav.home'), icon: <LuGauge aria-hidden="true" /> },
    { to: '/partners/catalog', id: 'catalog', label: t('pp.nav.catalog'), icon: <LuBookOpen aria-hidden="true" /> },
    { to: '/partners/orders', id: 'orders', label: t('pp.nav.orders'), icon: <LuBriefcase aria-hidden="true" /> },
    { to: '/partners/commissions', id: 'commissions', label: t('pp.nav.commissions'), icon: <LuWallet aria-hidden="true" /> },
  ];
  let body;
  if (sub === '') body = <Overview ctx={ctx} />;
  else if (sub === 'catalog' && id === 'offers' && more) body = <OfferPage key={more} id={more} ctx={ctx} />;
  else if (sub === 'catalog') body = <CatalogPage ctx={ctx} tab={id} />;
  else if (sub === 'orders') body = <OrdersPage key={id || 'list'} ctx={ctx} id={id} />;
  else if (sub === 'commissions') body = <CommissionsPage ctx={ctx} />;
  else if (sub === 'manage' && staff) body = <ManagePage ctx={ctx} />;
  else body = <EmptyState title={t('pp.notFound')} action={<Link to="/partners" className="btn">{t('pp.nav.home')}</Link>} />;
  const who = ctx.name || ctx.email || '';
  const role = staff ? t(admin ? 'pp.role.admin' : 'pp.role.manager') : ctx.partner?.name ?? '';
  const navLink = (n: { to: string; id: string; label: string; icon: ReactNode }) => (
    <Link key={n.id} to={n.to} className="pp-nav-a" aria-current={sub === n.id ? 'page' : undefined}>{n.icon}<span>{n.label}</span></Link>
  );

  return (
    <div className={cx('pp-shell pp-app', drawer && 'drawer')} data-testid="partners">
      <a href="#pp-main" className="skip">{t('pp.skip')}</a>
      <aside className={cx('pp-side', drawer && 'open')} aria-label={t('pp.nav.label')}>
        <div className="pp-side-top">
          <Link to="/partners" className="pp-logo" aria-label="VYNTEX"><Lockup size="sm" /></Link>
          <button type="button" className="iconbtn pp-side-x" aria-label={t('pp.close')} onClick={() => setDrawer(false)}><LuX aria-hidden="true" /></button>
        </div>
        <p className="pp-side-tag"><i aria-hidden="true" />{t('pp.nav.label')}</p>
        <nav className="pp-side-nav" aria-label={t('pp.nav.label')}>
          <p className="pp-side-cap">{t('pp.nav.workspace')}</p>
          {nav.map(navLink)}
          {staff && <><p className="pp-side-cap">{t('pp.nav.admin')}</p>{navLink({ to: '/partners/manage', id: 'manage', label: t('pp.nav.partners'), icon: <LuUsers aria-hidden="true" /> })}</>}
        </nav>
        <div className="pp-side-foot">
          {ctx.partner
            ? <div className="pp-org"><Initials name={ctx.partner.name} size="sm" /><div><b>{ctx.partner.name}</b><small>{ctx.partner.code} · {t('pp.lane.' + ctx.partner.kind)}</small></div></div>
            : <div className="pp-org"><span className="pp-org-dot" aria-hidden="true"><LuShieldCheck /></span><div><b>VYNTEX</b><small>{t('pp.nav.staffArea')}</small></div></div>}
        </div>
      </aside>
      <div className="pp-scrim" aria-hidden="true" onClick={() => setDrawer(false)} />
      <div className="pp-body">
        <header className="pp-top">
          <button type="button" className="iconbtn pp-hamb" aria-label={t('pp.nav.open')} aria-expanded={drawer} onClick={() => setDrawer(true)}><LuMenu aria-hidden="true" /></button>
          <Link to="/partners" className="pp-top-logo" aria-label="VYNTEX"><Lockup size="sm" /></Link>
          <span className="grow" />
          <LangSwitch />
          <RowMenu label={t('pp.user.menu')} buttonClass="pp-user" width={260}
            button={<><Initials name={who} size="sm" /><span className="pp-user-t"><b>{who}</b><small>{role}</small></span><LuChevronDown className="pp-user-c" aria-hidden="true" /></>}
            header={<><b>{who}</b>{ctx.email && ctx.email !== who && <span>{ctx.email}</span>}<span className="pp-menu-role">{role}</span></>}
            items={[{ label: t('pp.signout'), icon: <LuLogOut aria-hidden="true" />, onSelect: () => void signOut(), testId: 'pp-signout' }]} />
        </header>
        <main className="pp-main" id="pp-main" tabIndex={-1}>
          <Suspense fallback={<Loading />}><div className="pp-page" key={sub + (id ?? '')}>{body}</div></Suspense>
        </main>
      </div>
      <StepUpHost />
    </div>
  );
}

function LangSwitch() {
  const { lang } = useApp();
  return (
    <div className="pp-lang" role="group" aria-label="Language / Idioma">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setPrefs({ lang: 'en' })} lang="en" title="English">EN</button>
      <button type="button" aria-pressed={lang === 'es'} onClick={() => setPrefs({ lang: 'es' })} lang="es" title="Español">ES</button>
    </div>
  );
}

const OPEN_OFFERS = ['draft', 'pending_approval', 'changes_requested', 'approved', 'sent', 'viewed'];
const CLOSED_ORDERS = ['draft', 'completed', 'rejected', 'cancelled', 'refunded'];
const recent = <T extends { updated_at: string }>(list: T[]) => [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 5);

function Overview({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const staff = ctx.kind === 'staff';
  const offers = useLoad(() => api.offers(), []);
  const orders = useLoad(() => api.orders(), []);
  const money = useLoad<Record<string, unknown>>(() => (staff ? api.admin.get<Record<string, unknown>>('commissions') : api.statement() as unknown as ReturnType<typeof api.admin.get<Record<string, unknown>>>), [staff]);
  const o = offers.data?.offers ?? []; const r = orders.data?.orders ?? [];
  const sum = (k: 'eligible_cents' | 'approved_cents' | 'payable_cents' | 'paid_cents') => {
    const d = money.data as unknown as { statement?: { totals: Record<string, number> }; commissions?: { liability: Record<string, number>[] } } | null;
    if (!d) return null;
    if (d.statement) return d.statement.totals[k] ?? 0;
    return (d.commissions?.liability ?? []).reduce((a, x) => a + (Number(x[k]) || 0), 0);
  };
  const todo = staff
    ? [...o.filter((x) => x.status === 'pending_approval').map((x) => ({ to: `/partners/catalog/offers/${x.id}`, status: x.status, icon: <LuFileText />, text: t('pp.todo.approveOffer', { ref: x.ref, client: x.client_name, partner: x.partner }) })),
       ...r.filter((x) => x.status === 'submitted').map((x) => ({ to: `/partners/orders/${x.id}`, status: x.status, icon: <LuBriefcase />, text: t('pp.todo.reviewOrder', { ref: x.ref, client: x.client_name, partner: x.partner }) }))]
    : [...o.filter((x) => x.status === 'changes_requested').map((x) => ({ to: `/partners/catalog/offers/${x.id}`, status: x.status, icon: <LuFileText />, text: t('pp.todo.changes', { ref: x.ref, client: x.client_name }) })),
       ...o.filter((x) => x.status === 'accepted').map((x) => ({ to: `/partners/catalog/offers/${x.id}`, status: x.status, icon: <LuFileText />, text: t('pp.todo.toOrder', { ref: x.ref, client: x.client_name }) })),
       ...r.filter((x) => x.status === 'info_required').map((x) => ({ to: `/partners/orders/${x.id}`, status: x.status, icon: <LuBriefcase />, text: t('pp.todo.info', { ref: x.ref, client: x.client_name }) }))];
  const openOffers = offers.data ? o.filter((x) => OPEN_OFFERS.includes(x.status)).length : null;
  const openOrders = orders.data ? r.filter((x) => !CLOSED_ORDERS.includes(x.status)).length : null;
  const loading = !offers.data || !orders.data;
  const failed = offers.error || orders.error;
  return (
    <div className="pp-stack">
      <PageHead
        eyebrow={staff ? t('pp.home.eyebrowStaff') : ctx.partner ? `${ctx.partner.code} · ${t('pp.lane.' + ctx.partner.kind)}` : undefined}
        title={staff ? t('pp.home.staffTitle') : t('pp.home.title', { name: ctx.partner?.name ?? '' })}
        sub={staff ? t('pp.home.staffSub') : t('pp.home.sub')}
        actions={!staff ? <><Button icon={<LuBriefcase />} onClick={() => navigate('/partners/orders/new')}>{t('pp.order.new')}</Button><Button variant="primary" icon={<LuPlus />} onClick={() => navigate('/partners/catalog/offers/new')}>{t('pp.offer.new')}</Button></> : undefined} />
      {!staff && ctx.partner && (ctx.partner.w9 !== 'verified' || ctx.partner.agreement !== 'signed') && (
        <div className="pp-callout warn" role="note">
          <LuShieldCheck aria-hidden="true" />
          <div className="grow"><p>{t('pp.home.compliance')}</p><div className="pp-callout-chips"><Status value={ctx.partner.w9} prefix={t('pp.mg.w9') + ':'} /><Status value={ctx.partner.agreement} prefix={t('pp.mg.agreement') + ':'} /></div></div>
        </div>
      )}
      {failed && <Failed text={offers.error || orders.error} retry={() => { void offers.reload(); void orders.reload(); }} />}
      <div className="pp-kpis">
        <Kpi label={t('pp.home.openOffers')} value={openOffers} format={count} icon={<LuFileText />} tone="accent" onClick={() => navigate('/partners/catalog/offers')}
          hint={openOffers === 0 ? t(staff ? 'pp.home.noOffersStaff' : 'pp.home.noOffers') : t('pp.home.seeOffers')} />
        <Kpi label={t('pp.home.openOrders')} value={openOrders} format={count} icon={<LuBriefcase />} tone="violet" onClick={() => navigate('/partners/orders')}
          hint={openOrders === 0 ? t('pp.home.noOrders') : t('pp.home.seeOrders')} />
        {!money.error && <Kpi label={t('pp.st.eligible')} value={sum('eligible_cents')} format={usd} icon={<LuHandCoins />} tone="warn" hint={t('pp.home.eligibleHint')} onClick={() => navigate('/partners/commissions')} />}
        {!money.error && <Kpi label={t('pp.st.paid')} value={sum('paid_cents')} format={usd} icon={<LuWallet />} tone="ok" hint={t('pp.home.paidHint')} onClick={() => navigate('/partners/commissions')} />}
      </div>
      <div className="pp-cols">
        <Panel title={t('pp.home.todo')} count={loading ? undefined : todo.length} flush className="pp-todo-panel">
          {loading ? <Loading kind="table" /> : !todo.length ? (
            <EmptyState compact icon={<LuCircleCheck />} title={t('pp.home.nothing')} body={t(staff ? 'pp.home.nothingStaff' : 'pp.home.nothingPartner')} />
          ) : (
            <ul className="pp-todo">{todo.slice(0, 12).map((x) => (
              <li key={x.to}><Link to={x.to} className="pp-todo-a"><span className="pp-todo-ic" aria-hidden="true">{x.icon}</span><span className="grow">{x.text}</span><Status value={x.status} /><LuArrowRight className="pp-go" aria-hidden="true" /></Link></li>
            ))}</ul>
          )}
        </Panel>
        <Panel title={t('pp.home.shortcuts')} flush className="pp-quick-panel">
          <div className="pp-quick">
            <Link to="/partners/catalog" className="pp-q"><span className="pp-q-ic" aria-hidden="true"><LuBookOpen /></span><span><b>{t('pp.nav.catalog')}</b><small>{t('pp.home.qCatalog')}</small></span><LuArrowRight className="pp-go" aria-hidden="true" /></Link>
            <Link to="/partners/orders" className="pp-q"><span className="pp-q-ic" aria-hidden="true"><LuBriefcase /></span><span><b>{t('pp.nav.orders')}</b><small>{t('pp.home.qOrders')}</small></span><LuArrowRight className="pp-go" aria-hidden="true" /></Link>
            <Link to="/partners/commissions" className="pp-q"><span className="pp-q-ic" aria-hidden="true"><LuWallet /></span><span><b>{t('pp.nav.commissions')}</b><small>{t('pp.home.qCommissions')}</small></span><LuArrowRight className="pp-go" aria-hidden="true" /></Link>
          </div>
        </Panel>
      </div>
      <div className="pp-cols even">
        <Panel title={t('pp.home.recentOffers')} flush tools={<Link to="/partners/catalog/offers" className="pp-link">{t('pp.home.viewAll')}<LuArrowRight aria-hidden="true" /></Link>}>
          {loading ? <Loading kind="table" /> : !o.length ? <EmptyState compact icon={<LuFileText />} title={t(staff ? 'pp.offer.noneStaff' : 'pp.offer.none')} /> : (
            <ul className="pp-mini">{recent(o).map((x) => (
              <li key={x.id}><Link to={'/partners/catalog/offers/' + x.id} className="pp-mini-a">
                <span className="pp-mini-t"><b>{x.client_name}</b><small>{x.ref}{staff ? ` · ${x.partner}` : ''} · {dateTime(x.updated_at)}</small></span>
                <span className="pp-mini-r"><span className="pp-money">{usd(x.setup_cents + x.one_time_cents)}</span><Status value={x.status} /></span>
              </Link></li>
            ))}</ul>
          )}
        </Panel>
        <Panel title={t('pp.home.recentOrders')} flush tools={<Link to="/partners/orders" className="pp-link">{t('pp.home.viewAll')}<LuArrowRight aria-hidden="true" /></Link>}>
          {loading ? <Loading kind="table" /> : !r.length ? <EmptyState compact icon={<LuBriefcase />} title={t('pp.order.none')} /> : (
            <ul className="pp-mini">{recent(r).map((x) => (
              <li key={x.id}><Link to={'/partners/orders/' + x.id} className="pp-mini-a">
                <span className="pp-mini-t"><b>{x.client_name}</b><small>{x.ref}{staff ? ` · ${x.partner}` : ''} · {dateTime(x.last_update || x.updated_at)}</small></span>
                <span className="pp-mini-r"><span className="pp-money">{usd(x.setup_cents + x.one_time_cents)}</span><Status value={x.status} /></span>
              </Link></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
