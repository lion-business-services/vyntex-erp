// The VYNTEX Partner Portal: erp.vyntexusa.com/partners. Invite-only, the authenticator app always required, no trial.
// Three business modules (Catalog & Offers, Client Orders, Commissions & Payouts); VYNTEX partner staff see the same three
// with their administration inside, plus the Partners utility. Every screen reads from /api/partners, where the
// database decides what the person may see and do; hiding a button here is never the protection.
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { LuBookOpen, LuBriefcase, LuGauge, LuLogOut, LuShieldCheck, LuUsers, LuWallet } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, navigate, useRoute } from '@/app/router';
import { Lockup } from '@/brand';
import { Badge, Button, Card, Note, Stat, cx } from '@/ui';
import { post } from '@/platform/live/http';
import { setSessionEnd } from '@/platform/session';
import { setPrefs } from '@/store/store';
import { AuthFlow } from '@/features/auth/flow';
import { StepUpHost } from '@/features/auth/stepup';
import { Invite } from '@/features/auth/pages';
import { api, type Context } from './api';
import { Loading, usd, useLoad } from './shared';
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
  const signOut = async () => { await post('/api/auth/signout', {}, { session: false, stepUp: false }); setSessionEnd(null); navigate('/partners/signin', { replace: true }); };

  if (gate.at === 'checking') return <div className="pp-shell"><Loading /></div>;
  if (gate.at === 'auth') return <div className="pp-auth"><p className="pp-auth-tag"><LuShieldCheck aria-hidden="true" />{t('pp.signin.tag')}</p><AuthFlow onReady={() => { void check(); }} /></div>;
  if (gate.at === 'offline') return <div className="pp-shell pp-pad"><Card><p role="alert">{t('pp.err.offline')}</p><Button onClick={() => void check()}>{t('pp.retry')}</Button></Card></div>;
  if (gate.at === 'denied') {
    return (
      <div className="pp-shell pp-pad">
        <Card><Note tone="warn"><span role="alert" data-testid="pp-denied">{t('pp.denied')}</span></Note>
          <div className="row"><Button variant="primary" icon={<LuLogOut />} onClick={() => void signOut()}>{t('pp.signout')}</Button></div></Card>
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
  else body = <Card><p>{t('pp.notFound')}</p><Link to="/partners" className="btn">{t('pp.nav.home')}</Link></Card>;

  return (
    <div className="pp-shell" data-testid="partners">
      <a href="#pp-main" className="skip">{t('pp.skip')}</a>
      <header className="pp-top">
        <Link to="/partners" className="pp-logo" aria-label="VYNTEX"><Lockup size="sm" /></Link>
        <span className="pp-tag">{t('pp.brand')}</span>
        {staff && <Badge tone="accent">{t(admin ? 'pp.role.admin' : 'pp.role.manager')}</Badge>}
        <nav className="pp-nav" aria-label={t('pp.nav.label')}>
          {nav.map((n) => <Link key={n.id} to={n.to} className={cx('pp-nav-a', sub === n.id && 'on')} aria-current={sub === n.id ? 'page' : undefined}>{n.icon}<span>{n.label}</span></Link>)}
        </nav>
        <span className="grow" />
        {staff && <Link to="/partners/manage" className={cx('pp-util', sub === 'manage' && 'on')} aria-current={sub === 'manage' ? 'page' : undefined}><LuUsers aria-hidden="true" />{t('pp.nav.partners')}</Link>}
        <LangSwitch />
        <span className="small muted pp-who" title={ctx.email}>{ctx.partner ? ctx.partner.name : ctx.name || ctx.email}</span>
        <Button size="sm" variant="ghost" icon={<LuLogOut />} onClick={() => void signOut()} data-testid="pp-signout">{t('pp.signout')}</Button>
      </header>
      <main className="pp-main" id="pp-main">
        <Suspense fallback={<Loading />}>{body}</Suspense>
      </main>
      <StepUpHost />
    </div>
  );
}

function LangSwitch() {
  const { lang } = useApp();
  return (
    <div className="seg pp-lang" role="group" aria-label="Language / Idioma">
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setPrefs({ lang: 'en' })}>EN</button>
      <button type="button" aria-pressed={lang === 'es'} onClick={() => setPrefs({ lang: 'es' })}>ES</button>
    </div>
  );
}

function Overview({ ctx }: { ctx: Context }) {
  const { t } = useApp();
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
    ? [...o.filter((x) => x.status === 'pending_approval').map((x) => ({ to: `/partners/catalog/offers/${x.id}`, text: t('pp.todo.approveOffer', { ref: x.ref, client: x.client_name, partner: x.partner }) })),
       ...r.filter((x) => x.status === 'submitted').map((x) => ({ to: `/partners/orders/${x.id}`, text: t('pp.todo.reviewOrder', { ref: x.ref, client: x.client_name, partner: x.partner }) }))]
    : [...o.filter((x) => x.status === 'changes_requested').map((x) => ({ to: `/partners/catalog/offers/${x.id}`, text: t('pp.todo.changes', { ref: x.ref, client: x.client_name }) })),
       ...o.filter((x) => x.status === 'accepted').map((x) => ({ to: `/partners/catalog/offers/${x.id}`, text: t('pp.todo.toOrder', { ref: x.ref, client: x.client_name }) })),
       ...r.filter((x) => x.status === 'info_required').map((x) => ({ to: `/partners/orders/${x.id}`, text: t('pp.todo.info', { ref: x.ref, client: x.client_name }) }))];
  return (
    <div className="pp-stack">
      <div className="pp-hero">
        <h1>{staff ? t('pp.home.staffTitle') : t('pp.home.title', { name: ctx.partner?.name ?? '' })}</h1>
        <p className="muted">{staff ? t('pp.home.staffSub') : t('pp.home.sub')}</p>
      </div>
      {!staff && ctx.partner && (ctx.partner.w9 !== 'verified' || ctx.partner.agreement !== 'signed') && <Note tone="warn">{t('pp.home.compliance')}</Note>}
      <div className="pp-stats">
        <Stat label={t('pp.home.openOffers')} value={o.filter((x) => ['draft', 'pending_approval', 'changes_requested', 'approved', 'sent', 'viewed'].includes(x.status)).length} />
        <Stat label={t('pp.home.openOrders')} value={r.filter((x) => !['draft', 'completed', 'rejected', 'cancelled', 'refunded'].includes(x.status)).length} />
        <Stat label={t('pp.st.eligible')} value={usd(sum('eligible_cents')) || '...'} hint={t('pp.home.eligibleHint')} />
        <Stat label={t('pp.st.paid')} value={usd(sum('paid_cents')) || '...'} hint={t('pp.home.paidHint')} />
      </div>
      <Card title={t('pp.home.todo')}>
        {!todo.length ? <p className="small muted">{t('pp.home.nothing')}</p> : (
          <ul className="pp-todo">{todo.slice(0, 12).map((x) => <li key={x.to}><Link to={x.to}>{x.text}</Link></li>)}</ul>
        )}
      </Card>
      <div className="pp-quick">
        <Link to="/partners/catalog" className="card pp-q"><LuBookOpen aria-hidden="true" /><b>{t('pp.nav.catalog')}</b><span className="small muted">{t('pp.home.qCatalog')}</span></Link>
        <Link to="/partners/orders" className="card pp-q"><LuBriefcase aria-hidden="true" /><b>{t('pp.nav.orders')}</b><span className="small muted">{t('pp.home.qOrders')}</span></Link>
        <Link to="/partners/commissions" className="card pp-q"><LuWallet aria-hidden="true" /><b>{t('pp.nav.commissions')}</b><span className="small muted">{t('pp.home.qCommissions')}</span></Link>
      </div>
    </div>
  );
}
