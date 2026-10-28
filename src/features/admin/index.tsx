// The operator console, erp.vyntexusa.com/admin: where VYNTEX staff open a workspace for a client who bought VYNTEX ERP.
// One form makes the company at erp.vyntexusa.com/<business> and the one-time invitation of its first owner; the list
// shows every client company with its owner, or the invitation still waiting, and lets staff resend it or pause the
// workspace. Everything is decided by the server and the database (api/admin.js, 0061_operator_console.sql): this page
// only asks. Only people the database lists as operators get past the first answer, and only after the second sign-in step.
//
// Demo requests: the console also lists who asked for a demo on the sales pages, and "Start 7-day trial" opens the form
// filled in from the request. The notification email links here the same way, with the details after the # of the
// address (never in the query string, so they never reach a server log):
//   /admin#new-trial&business=<name>&owner=<name>&email=<email>&industry=<edition id or name>&lang=en|es
// The page reads that once the operator is signed in (it is kept in this tab's sessionStorage through the sign-in),
// then takes it off the address bar. Nothing is made until the operator presses Create.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { INTERNAL_PLAN } from '@/config/plans';
import { LuBuilding2, LuCircleCheck, LuCopy, LuCreditCard, LuExternalLink, LuInbox, LuLogOut, LuMail, LuMailCheck, LuPause, LuPhone, LuPlay, LuPlus, LuRefreshCw, LuRocket, LuSend, LuShieldCheck } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { Lockup } from '@/brand';
import { Badge, Button, Card, Field, Modal, SearchBox, confirmDialog, cx, toast } from '@/ui';
import { PACK_LIST } from '@/packs';
import { isPriced, planName, plansFor } from '@/lib/pricing';
import { money } from '@/lib/money';
import { RESERVED_SLUGS } from '@/platform/mode';
import type { IndustryId, Lang } from '@/domain/types';
import { get, post } from '@/platform/live/http';
import { AuthFlow } from '@/features/auth/flow';
import { setSessionEnd } from '@/platform/session';
import './admin.css';

export interface AdminCompany {
  id: string; slug: string; name: string; industry: string; plan: string; status: 'onboarding' | 'active' | 'suspended' | 'closed'; created_at: string; members: number;
  owner: { email: string; name: string; since: string } | null;
  invitation: { email: string; expires_at: string; expired: boolean } | null;
}
/** One "Request a demo" submission, as operator_demo_requests (0077) returns it. */
export interface DemoRequest {
  id: string; created_at: string; name: string; business: string | null; industry: string | null; phone: string | null; email: string | null;
  language: string; contact_method: string | null; team_size: string | null; message: string | null; workspace: string | null;
}
/** What the "New client workspace" form opens with, from a demo request or a link. */
export interface Prefill { name: string; ownerName: string; ownerEmail: string; industry: IndustryId | null; lang: Lang }
interface Created { name: string; slug: string; link: string; address: string; delivery: 'sent' | 'not_configured' | 'failed'; email: string; lang: Lang; again?: boolean }

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** An address word from a business name: "Greenline Landscaping LLC" becomes greenline-landscaping. */
export function slugFrom(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/\b(llc|inc|corp|co|ltd|pllc|lp)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
/** Why an address word cannot be used, or '' when it can. */
export function slugProblem(slug: string, taken: string[]): '' | 'short' | 'format' | 'reserved' | 'taken' {
  if (slug.length < 3 || slug.length > 40) return 'short';
  if (!SLUG.test(slug)) return 'format';
  if (RESERVED_SLUGS.includes(slug)) return 'reserved';
  if (taken.includes(slug)) return 'taken';
  return '';
}
/**
 * The edition a demo request or a link names: an edition id ("build"), its product name ("VYNTEX CLEAN", or "clean"),
 * or its industry in English or Spanish ("Construction", "limpieza"), in any letter case. Null when nothing matches.
 */
export function editionFrom(value: string | null | undefined): IndustryId | null {
  const v = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) return null;
  const hit = PACK_LIST.find((p) => [p.id, p.product, p.product.replace(/^vyntex\s+/i, ''), p.label.en, p.label.es].some((x) => String(x ?? '').trim().toLowerCase() === v));
  return hit ? hit.id : null;
}
const clip = (v: string | null | undefined, n: number) => String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, n);
/** The form's opening values from a demo request. */
export function prefillFromRequest(r: Pick<DemoRequest, 'business' | 'name' | 'email' | 'industry' | 'language'>): Prefill {
  return { name: clip(r.business, 200), ownerName: clip(r.name, 200), ownerEmail: clip(r.email, 320), industry: editionFrom(r.industry), lang: r.language === 'es' ? 'es' : 'en' };
}
/** The form's opening values from the part of the address after #, or null when it is not a new-trial link. */
export function prefillFromHash(hash: string): Prefill | null {
  const h = hash.replace(/^#/, '');
  if (!/^new-trial(&|$)/.test(h)) return null;
  let q: URLSearchParams;
  try { q = new URLSearchParams(h); } catch { return null; }
  return prefillFromRequest({ business: q.get('business'), name: q.get('owner') ?? '', email: q.get('email'), industry: q.get('industry'), language: q.get('lang') ?? 'en' });
}
const PENDING = 'vx.admin.newTrial';
const stash = (v: string | null) => { try { if (v) sessionStorage.setItem(PENDING, v); else sessionStorage.removeItem(PENDING); } catch { /* storage blocked: the copy in memory is used */ } };
const stashed = (): string | null => { try { return sessionStorage.getItem(PENDING); } catch { return null; } };
const isTrialHash = (h: string) => /^#new-trial(&|$)/.test(h);

const TRIAL = (lang: Lang) => ({ id: 'trial', label: lang === 'es' ? 'Prueba de 7 días (sin costo, solo por invitación)' : '7-day trial (free, invitation only)' });
const planOptions = (industry: IndustryId, lang: Lang) =>
  [...(isPriced(industry) ? plansFor(industry).map((p) => ({ id: p.id, label: `${planName(p, lang)} · ${money(p.monthly)}${lang === 'es' ? '/mes' : '/mo'}` })) : [{ id: 'quoted', label: lang === 'es' ? 'Cotizado' : 'Quoted' }]), TRIAL(lang)];

interface BillingRow { tenant_id: string; billing_status: string | null; billing: string | null; current_period_end: string | null; grace_until: string | null; trial_expires_at: string | null; paid_cents: number; open_checkout: string | null }
interface BillingOverview { companies: BillingRow[]; available: boolean; mode: 'test' | 'live' | null; webhook: boolean }

type Gate = { at: 'checking' } | { at: 'signin' } | { at: 'mfa' } | { at: 'denied' } | { at: 'ready'; email: string } | { at: 'offline' };

export default function AdminPage() {
  const { t } = useApp();
  const [gate, setGate] = useState<Gate>({ at: 'checking' });
  useEffect(() => { document.title = `${t('admin.title')} · VYNTEX ERP`; }, [t]);
  // a new-trial link: kept through the sign-in (in memory and in this tab's sessionStorage), used once the console is open
  const pending = useRef<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  if (pending.current === null && typeof location !== 'undefined' && isTrialHash(location.hash)) { pending.current = location.hash; stash(location.hash); }
  useEffect(() => {
    if (gate.at !== 'ready' && gate.at !== 'denied') return;
    const raw = isTrialHash(location.hash) ? location.hash : pending.current || stashed();
    pending.current = ''; stash(null);
    if (isTrialHash(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
    if (gate.at === 'ready' && raw) setPrefill(prefillFromHash(raw));
  }, [gate.at]);
  // a link opened in this tab while the console is already on screen
  useEffect(() => {
    const onHash = () => {
      if (!isTrialHash(location.hash)) return;
      if (gate.at !== 'ready') { pending.current = location.hash; stash(location.hash); return; }
      const raw = location.hash;
      history.replaceState(history.state, '', location.pathname + location.search);
      stash(null); setPrefill(prefillFromHash(raw));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [gate.at]);

  const check = useCallback(async () => {
    const s = await get<{ signedIn: boolean; user?: { email: string } }>('/api/auth/session', { session: false, passive: true });
    if (!s.ok) { setGate({ at: s.status === 0 || s.status >= 500 ? 'offline' : 'signin' }); return; }
    if (!s.data.signedIn) { setGate({ at: 'signin' }); return; }
    const c = await get<{ operator: boolean; aal: string }>('/api/admin/context', { session: true });
    if (!c.ok) { setGate({ at: c.code === 'mfa_required' ? 'mfa' : c.status === 0 || c.status >= 500 ? 'offline' : 'signin' }); return; }
    if (!c.data.operator) { setGate({ at: 'denied' }); return; }
    if (c.data.aal !== 'aal2') { setGate({ at: 'mfa' }); return; }
    setGate({ at: 'ready', email: s.data.user?.email ?? '' });
  }, []);
  useEffect(() => { void check(); }, [check]);

  const signOut = async () => { await post('/api/auth/signout', {}, { session: false, stepUp: false }); setSessionEnd(null); setGate({ at: 'signin' }); };

  if (gate.at === 'checking') return <div className="adm-wait" role="status">{t('admin.checking')}</div>;
  if (gate.at === 'signin') return <AuthFlow onReady={() => { void check(); }} />;
  return (
    <div className="adm" data-testid="admin">
      <header className="adm-top">
        <Link to="/" className="adm-logo" aria-label="VYNTEX ERP"><Lockup size="sm" /></Link>
        <span className="adm-tag"><LuShieldCheck aria-hidden="true" />{t('admin.tag')}</span>
        <span className="grow" />
        {gate.at === 'ready' && <span className="small muted adm-who" data-testid="admin-who">{gate.email}</span>}
        <Button size="sm" variant="ghost" icon={<LuLogOut />} onClick={() => void signOut()} data-testid="admin-signout">{t('admin.signout')}</Button>
      </header>
      <main className="adm-main" id="main">
        {gate.at === 'offline' && <Card><p role="alert">{t('admin.offline')}</p><Button onClick={() => void check()}>{t('admin.retry')}</Button></Card>}
        {gate.at === 'denied' && <Card><div className="note warn" role="alert" data-testid="admin-denied">{t('admin.denied')}</div></Card>}
        {gate.at === 'mfa' && <Card><div className="note warn" role="alert" data-testid="admin-mfa">{t('admin.mfa')}</div><div className="row"><Button variant="primary" onClick={() => void signOut()}>{t('admin.mfaAgain')}</Button></div></Card>}
        {gate.at === 'ready' && <Console prefill={prefill} onPrefillUsed={() => setPrefill(null)} />}
      </main>
    </div>
  );
}

/** A plan id as people read it: the plan's name from the pricing file, or the id itself when it is not there. */
function planLabel(industry: string, id: string, lang: Lang): string {
  const p = PACK_LIST.some((x) => x.id === industry) ? plansFor(industry as IndustryId).find((x) => x.id === id) : undefined;
  if (id === INTERNAL_PLAN) return lang === 'es' ? 'Interno de VYNTEX, sin costo' : 'VYNTEX internal, free';
  return p ? planName(p, lang) : id === 'quoted' ? (lang === 'es' ? 'Cotizado' : 'Quoted') : id === 'trial' ? (lang === 'es' ? 'Prueba de 7 días' : '7-day trial') : id;
}

function Console({ prefill, onPrefillUsed }: { prefill: Prefill | null; onPrefillUsed: () => void }) {
  const { t, dateTime, lang } = useApp();
  const [list, setList] = useState<AdminCompany[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState<{ prefill?: Prefill } | null>(null);
  const [demos, setDemos] = useState<DemoRequest[] | null>(null);
  const [demosFailed, setDemosFailed] = useState(false);
  const [done, setDone] = useState<Created | null>(null);
  const [inviting, setInviting] = useState<AdminCompany | null>(null);
  const [q, setQ] = useState('');
  const [bill, setBill] = useState<BillingOverview | null>(null);
  const [paying, setPaying] = useState<AdminCompany | null>(null);

  const load = useCallback(async () => {
    const [a, b, d] = await Promise.all([
      get<{ companies: AdminCompany[] }>('/api/admin/companies', { session: true }),
      get<BillingOverview>('/api/billing/operator', { session: true, passive: true }),
      get<{ requests: DemoRequest[] }>('/api/admin/demo-requests', { session: true, passive: true }),
    ]);
    if (a.ok) { setList(a.data.companies); setFailed(false); } else setFailed(true);
    if (b.ok) setBill(b.data);
    if (d.ok) { setDemos(d.data.requests); setDemosFailed(false); } else setDemosFailed(true);
  }, []);
  // a new-trial link opens the form once, filled in
  useEffect(() => { if (prefill) { setCreating({ prefill }); onPrefillUsed(); } }, [prefill, onPrefillUsed]);
  const billOf = (id: string) => bill?.companies.find((x) => x.tenant_id === id) ?? null;
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const l = list ?? [];
    const paying = (bill?.companies ?? []).filter((x) => x.billing_status === 'active' || x.billing_status === 'trialing').length;
    return { total: l.length, active: l.filter((c) => c.status === 'active' && c.owner).length, waiting: l.filter((c) => !c.owner && c.status !== 'closed').length, paused: l.filter((c) => c.status === 'suspended').length, paying,
      demos: demos ? demos.filter((r) => !r.workspace).length : null };
  }, [list, bill, demos]);
  const shown = (list ?? []).filter((c) => !q.trim() || `${c.name} ${c.slug} ${c.owner?.email ?? ''} ${c.invitation?.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  const setStatus = async (c: AdminCompany, status: 'active' | 'suspended') => {
    if (status === 'suspended' && !(await confirmDialog(t('admin.pauseAsk', { name: c.name }), t('admin.pause'), t('common.cancel')))) return;
    const a = await post(`/api/admin/companies/${c.id}/status`, { status }, { session: true });
    if (a.ok) { toast(t(status === 'suspended' ? 'admin.paused' : 'admin.resumed', { name: c.name })); void load(); } else toast(t('admin.err.generic'), true);
  };

  return (
    <>
      <div className="adm-head">
        <div>
          <h1>{t('admin.h1')}</h1>
          <p className="muted">{t('admin.sub')}</p>
        </div>
        <div className="row">
          <Button icon={<LuRefreshCw />} onClick={() => void load()} data-testid="admin-refresh">{t('admin.refresh')}</Button>
          <Button variant="primary" icon={<LuPlus />} onClick={() => setCreating({})} data-testid="admin-new">{t('admin.new')}</Button>
        </div>
      </div>

      <div className="adm-stats">
        <div className="card adm-stat"><span>{t('admin.stat.total')}</span><b data-testid="admin-stat-total">{stats.total}</b></div>
        <div className="card adm-stat"><span>{t('admin.stat.active')}</span><b>{stats.active}</b></div>
        <div className="card adm-stat"><span>{t('admin.stat.waiting')}</span><b>{stats.waiting}</b></div>
        <div className="card adm-stat"><span>{t('admin.stat.paused')}</span><b>{stats.paused}</b></div>
        <div className="card adm-stat"><span>{t('admin.stat.paying')}</span><b data-testid="admin-stat-paying">{stats.paying}</b></div>
        {stats.demos !== null && <a className="card adm-stat adm-stat-link" href="#demo-requests" onClick={(e) => { e.preventDefault(); document.getElementById('demo-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span>{t('admin.stat.demos')}</span><b data-testid="admin-stat-demos">{stats.demos}</b></a>}
      </div>
      {bill && !bill.available && <p className="small muted adm-note" data-testid="admin-billing-off">{t('admin.bill.off')}</p>}
      {bill?.available && bill.mode === 'test' && <p className="small muted adm-note" data-testid="admin-billing-test">{t('admin.bill.test')}</p>}

      <Card flush title={t('admin.list')} actions={<div className="adm-search"><SearchBox value={q} onChange={setQ} placeholder={t('admin.search')} label={t('admin.search')} /></div>}>
        {failed ? <div className="adm-pad"><p role="alert">{t('admin.loadFailed')}</p><Button onClick={() => void load()}>{t('admin.retry')}</Button></div>
          : !list ? <div className="adm-pad muted" role="status">{t('admin.checking')}</div>
          : !list.length ? <div className="adm-pad adm-empty"><LuBuilding2 aria-hidden="true" /><p className="strong">{t('admin.empty.title')}</p><p className="small muted">{t('admin.empty.body')}</p><Button variant="primary" icon={<LuPlus />} onClick={() => setCreating({})}>{t('admin.new')}</Button></div>
          : (
            <div className="table-wrap">
              <table className="tbl adm-table" data-testid="admin-table">
                <thead><tr><th>{t('admin.col.company')}</th><th>{t('admin.col.edition')}</th><th>{t('admin.col.owner')}</th><th>{t('admin.col.status')}</th><th>{t('admin.col.billing')}</th><th className="adm-actions-h"><span className="sr">{t('admin.col.actions')}</span></th></tr></thead>
                <tbody>
                  {shown.map((c) => {
                    const pack = PACK_LIST.find((p) => p.id === c.industry);
                    return (
                      <tr key={c.id} data-slug={c.slug} data-testid="admin-row">
                        <td><b>{c.name}</b><br /><a className="small adm-addr" href={'/' + c.slug} target="_blank" rel="noopener">{location.host}/{c.slug}<LuExternalLink aria-hidden="true" /></a></td>
                        <td>{pack?.product ?? c.industry}<br /><span className="xs dim">{planLabel(c.industry, c.plan, lang)}</span></td>
                        <td>
                          {c.owner ? <><span>{c.owner.name || c.owner.email}</span><br /><span className="xs dim">{c.owner.email} · {t(c.members === 1 ? 'admin.members1' : 'admin.members', { n: c.members })}</span></>
                            : c.invitation ? <><span>{c.invitation.email}</span><br /><span className={cx('xs', c.invitation.expired ? 'neg' : 'dim')}>{t(c.invitation.expired ? 'admin.inv.expired' : 'admin.inv.waiting', { date: dateTime(c.invitation.expires_at) })}</span></>
                              : <span className="xs dim">{t('admin.inv.none')}</span>}
                        </td>
                        <td>
                          <Badge tone={c.status === 'suspended' ? 'warn' : c.owner ? 'ok' : 'accent'}>{t(c.status === 'suspended' ? 'admin.st.paused' : c.owner ? 'admin.st.live' : 'admin.st.waiting')}</Badge>
                          <br /><span className="xs dim">{t('admin.since', { date: dateTime(c.created_at) })}</span>
                        </td>
                        <td data-testid="admin-billing"><BillingCell company={c} b={billOf(c.id)} /></td>
                        <td className="adm-actions">
                          {!c.owner && c.status !== 'closed' && <Button size="sm" icon={<LuSend />} onClick={() => setInviting(c)} data-testid="admin-reinvite">{t('admin.reinvite')}</Button>}
                          {c.status === 'suspended'
                            ? <Button size="sm" icon={<LuPlay />} onClick={() => void setStatus(c, 'active')} data-testid="admin-resume">{t('admin.resume')}</Button>
                            : <Button size="sm" variant="ghost" icon={<LuPause />} onClick={() => void setStatus(c, 'suspended')} data-testid="admin-pause">{t('admin.pause')}</Button>}
                          {bill?.available && c.status !== 'closed' && c.plan !== INTERNAL_PLAN && !['active', 'trialing', 'past_due', 'unpaid'].includes(billOf(c.id)?.billing_status ?? '') && <Button size="sm" variant="ghost" icon={<LuCreditCard />} onClick={() => setPaying(c)} data-testid="admin-paylink">{t('admin.pay.open')}</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <DemoRequests list={demos} failed={demosFailed} onRetry={() => void load()} onStart={(r) => setCreating({ prefill: prefillFromRequest(r) })} />

      <p className="xs dim adm-foot"><LuShieldCheck aria-hidden="true" /> {t('admin.privacy')}</p>

      {creating && <NewCompany taken={(list ?? []).map((c) => c.slug)} prefill={creating.prefill} onClose={() => setCreating(null)} onDone={(c) => { setCreating(null); setDone(c); void load(); }} />}
      {inviting && <Reinvite company={inviting} onClose={() => setInviting(null)} onDone={(c) => { setInviting(null); setDone(c); void load(); }} />}
      {done && <Result created={done} onClose={() => setDone(null)} />}
      {paying && <PaymentLink company={paying} onClose={() => { setPaying(null); void load(); }} />}
    </>
  );
}

/* ---------- a new client workspace ---------- */
function NewCompany({ taken, prefill, onClose, onDone }: { taken: string[]; prefill?: Prefill; onClose: () => void; onDone: (c: Created) => void }) {
  const { t, lang } = useApp();
  const [f, setF] = useState(() => prefill
    ? { name: prefill.name, slug: slugFrom(prefill.name), industry: prefill.industry ?? ('build' as IndustryId), plan: 'trial', ownerName: prefill.ownerName, ownerEmail: prefill.ownerEmail, lang: prefill.lang }
    : { name: '', slug: '', industry: 'build' as IndustryId, plan: '', ownerName: '', ownerEmail: '', lang: lang as Lang });
  const [ownSlug, setOwnSlug] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [tried, setTried] = useState(false);
  const plans = planOptions(f.industry, lang);
  const plan = plans.some((p) => p.id === f.plan) ? f.plan : (plans.find((p, i) => i === 1)?.id ?? plans[0].id);
  const slugErr = slugProblem(f.slug, taken);
  const set = (patch: Partial<typeof f>) => { setErr(''); setF((cur) => ({ ...cur, ...patch })); };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setTried(true);
    if (!f.name.trim()) { setErr(t('admin.err.bad_name')); return; }
    if (slugErr) { setErr(t('admin.slug.' + slugErr)); return; }
    if (!f.ownerName.trim()) { setErr(t('admin.err.ownerName')); return; }
    if (!EMAIL.test(f.ownerEmail.trim())) { setErr(t('admin.err.bad_email')); return; }
    setBusy(true);
    const a = await post<{ company: { slug: string; name: string }; link: string; address: string; delivery: Created['delivery'] }>('/api/admin/companies',
      { name: f.name.trim(), slug: f.slug, industry: f.industry, plan, ownerName: f.ownerName.trim(), ownerEmail: f.ownerEmail.trim(), lang: f.lang }, { session: true });
    setBusy(false);
    if (a.ok) { onDone({ name: f.name.trim(), slug: a.data.company.slug, link: a.data.link, address: a.data.address, delivery: a.data.delivery, email: f.ownerEmail.trim(), lang: f.lang }); return; }
    const reason = String((a.data as { reason?: string }).reason || '');
    setErr(reason && t('admin.err.' + reason) !== 'admin.err.' + reason ? t('admin.err.' + reason) : a.code === 'conflict' ? t('admin.slug.taken') : t('admin.err.generic'));
  };

  return (
    <Modal title={t('admin.new')} onClose={onClose} labelClose={t('common.cancel')} size="wide">
      <form onSubmit={submit} noValidate data-testid="admin-form">
        {prefill && <p className="note adm-prefilled" data-testid="admin-f-prefilled"><LuInbox aria-hidden="true" />{t('admin.form.prefilled', { name: prefill.ownerName || prefill.name || prefill.ownerEmail })}</p>}
        <p className="small muted">{t('admin.form.intro')}</p>
        <div className="fgrid">
          <Field label={t('admin.f.name')} htmlFor="adm-name" full error={tried && !f.name.trim()}>
            <input id="adm-name" value={f.name} maxLength={200} autoComplete="off" data-autofocus data-testid="admin-f-name"
              onChange={(e) => set({ name: e.target.value, ...(ownSlug ? {} : { slug: slugFrom(e.target.value) }) })} />
          </Field>
          <Field label={t('admin.f.slug')} htmlFor="adm-slug" full error={(tried || !!f.slug) && !!slugErr} hint={<span className={cx(slugErr && f.slug ? 'neg' : 'dim')} data-testid="admin-f-slug-hint">{f.slug && slugErr ? t('admin.slug.' + slugErr) : t('admin.slug.ok')}</span>}>
            <div className="adm-slug"><span className="adm-slug-pre">{location.host}/</span>
              <input id="adm-slug" value={f.slug} maxLength={40} autoComplete="off" spellCheck={false} data-testid="admin-f-slug"
                onChange={(e) => { setOwnSlug(true); set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }); }} />
            </div>
          </Field>
          <Field label={t('admin.f.industry')} htmlFor="adm-ind">
            <select id="adm-ind" value={f.industry} onChange={(e) => set({ industry: e.target.value as IndustryId, plan: '' })} data-testid="admin-f-industry">
              {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.product} · {p.label[lang] ?? p.label.en}</option>)}
            </select>
          </Field>
          <Field label={t('admin.f.plan')} htmlFor="adm-plan">
            <select id="adm-plan" value={plan} onChange={(e) => set({ plan: e.target.value })} data-testid="admin-f-plan">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          {plan === 'trial' && <p className="small muted full" data-testid="admin-f-trial-note">{t('admin.form.trial')}</p>}
          <Field label={t('admin.f.ownerName')} htmlFor="adm-oname" error={tried && !f.ownerName.trim()}>
            <input id="adm-oname" value={f.ownerName} maxLength={200} autoComplete="off" onChange={(e) => set({ ownerName: e.target.value })} data-testid="admin-f-owner-name" />
          </Field>
          <Field label={t('admin.f.ownerEmail')} htmlFor="adm-oemail" error={tried && !EMAIL.test(f.ownerEmail.trim())}>
            <input id="adm-oemail" type="email" value={f.ownerEmail} maxLength={320} autoComplete="off" onChange={(e) => set({ ownerEmail: e.target.value })} data-testid="admin-f-owner-email" />
          </Field>
          <Field label={t('admin.f.lang')} htmlFor="adm-lang" full>
            <select id="adm-lang" value={f.lang} onChange={(e) => set({ lang: e.target.value as Lang })} data-testid="admin-f-lang">
              <option value="en">English</option><option value="es">Español</option>
            </select>
          </Field>
        </div>
        <ul className="adm-what small muted">
          <li><LuCircleCheck aria-hidden="true" />{t('admin.form.what1')}</li>
          <li><LuCircleCheck aria-hidden="true" />{t('admin.form.what2')}</li>
          <li><LuCircleCheck aria-hidden="true" />{t('admin.form.what3')}</li>
        </ul>
        {err && <p className="small neg" role="alert" data-testid="admin-form-error">{err}</p>}
        <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={busy} icon={<LuBuilding2 />} data-testid="admin-f-submit">{t(busy ? 'admin.form.busy' : 'admin.form.submit')}</Button></div>
      </form>
    </Modal>
  );
}

/* ---------- demo requests from the sales pages ---------- */
function DemoRequests({ list, failed, onRetry, onStart }: { list: DemoRequest[] | null; failed: boolean; onRetry: () => void; onStart: (r: DemoRequest) => void }) {
  const { t } = useApp();
  const count = list ? <span className="small muted" data-testid="admin-dr-count">{t(list.length === 1 ? 'admin.dr.count1' : 'admin.dr.count', { n: list.length })}</span> : undefined;
  return (
    <Card flush id="demo-requests" className="adm-dr-card" title={t('admin.dr.title')} actions={count}>
      <p className="small muted adm-dr-sub">{t('admin.dr.sub')}</p>
      {failed && !list ? <div className="adm-pad"><p role="alert">{t('admin.dr.loadFailed')}</p><Button onClick={onRetry}>{t('admin.retry')}</Button></div>
        : !list ? <div className="adm-pad muted" role="status">{t('admin.checking')}</div>
        : !list.length ? <div className="adm-pad adm-empty" data-testid="admin-dr-empty"><LuInbox aria-hidden="true" /><p className="strong">{t('admin.dr.empty.title')}</p><p className="small muted">{t('admin.dr.empty.body')}</p></div>
        : <ul className="adm-dr" data-testid="admin-dr-list">{list.map((r) => <DemoRow key={r.id} r={r} onStart={() => onStart(r)} />)}</ul>}
    </Card>
  );
}

function DemoRow({ r, onStart }: { r: DemoRequest; onStart: () => void }) {
  const { t, lang, dateTime } = useApp();
  const [open, setOpen] = useState(false);
  const ed = editionFrom(r.industry);
  const pack = ed ? PACK_LIST.find((p) => p.id === ed) : undefined;
  const long = !!r.message && (r.message.length > 160 || r.message.split('\n').length > 2);
  const facts = [
    r.team_size ? t(r.team_size === '1' ? 'admin.dr.team1' : 'admin.dr.team', { size: r.team_size }) : '',
    r.contact_method && ['phone', 'whatsapp', 'email'].includes(r.contact_method) ? t('admin.dr.by.' + r.contact_method) : '',
    t(r.language === 'es' ? 'admin.dr.lang.es' : 'admin.dr.lang.en'),
  ].filter(Boolean);
  return (
    <li className="adm-dr-item" data-testid="admin-dr-row" data-email={r.email ?? ''} data-workspace={r.workspace ?? ''}>
      <div className="adm-dr-main">
        <div className="adm-dr-head">
          <b className="adm-dr-biz">{r.business || r.name}</b>
          <Badge tone={pack ? 'info' : 'neutral'}>{pack ? `${pack.product} · ${pack.label[lang] ?? pack.label.en}` : (r.industry && r.industry !== 'other' ? r.industry : t('admin.dr.other'))}</Badge>
        </div>
        <p className="small adm-dr-facts"><span className="strong">{r.name}</span>{facts.map((x) => <span key={x}>{x}</span>)}</p>
        <p className="small adm-dr-contact" aria-label={t('admin.dr.contact')}>
          {r.email && <a href={'mailto:' + r.email} data-testid="admin-dr-email"><LuMail aria-hidden="true" />{r.email}</a>}
          {r.phone && <a href={'tel:' + r.phone.replace(/[^\d+]/g, '')} data-testid="admin-dr-phone"><LuPhone aria-hidden="true" />{r.phone}</a>}
        </p>
        {r.message && <>
          <p className={cx('small muted adm-dr-msg', !open && long && 'clamped')} data-testid="admin-dr-message">{r.message}</p>
          {long && <button type="button" className="adm-dr-more xs" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? 'admin.dr.less' : 'admin.dr.more')}</button>}
        </>}
      </div>
      <div className="adm-dr-side">
        <span className="xs dim">{t('admin.dr.received', { date: dateTime(r.created_at) })}</span>
        {r.workspace
          ? <a className="adm-dr-done small" href={'/' + r.workspace} target="_blank" rel="noopener" data-testid="admin-dr-workspace"><LuCircleCheck aria-hidden="true" />{t('admin.dr.created', { slug: r.workspace })}<LuExternalLink aria-hidden="true" /></a>
          : <Button size="sm" variant="primary" icon={<LuRocket />} onClick={onStart} data-testid="admin-dr-start">{t('admin.dr.start')}</Button>}
      </div>
    </li>
  );
}

/* ---------- a new invitation for the first owner ---------- */
function Reinvite({ company, onClose, onDone }: { company: AdminCompany; onClose: () => void; onDone: (c: Created) => void }) {
  const { t, lang } = useApp();
  const [email, setEmail] = useState(company.invitation?.email ?? '');
  const [name, setName] = useState('');
  const [l, setL] = useState<Lang>(lang);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) { setErr(t('admin.err.bad_email')); return; }
    setBusy(true);
    const a = await post<{ link: string; address: string; delivery: Created['delivery'] }>(`/api/admin/companies/${company.id}/invite`, { ownerEmail: email.trim(), ownerName: name.trim(), lang: l }, { session: true });
    setBusy(false);
    if (a.ok) { onDone({ name: company.name, slug: company.slug, link: a.data.link, address: a.data.address, delivery: a.data.delivery, email: email.trim(), lang: l, again: true }); return; }
    setErr(t(a.code === 'forbidden' ? 'admin.err.has_owner' : 'admin.err.generic'));
  };
  return (
    <Modal title={t('admin.reinviteTitle', { name: company.name })} onClose={onClose} labelClose={t('common.cancel')} size="narrow">
      <form onSubmit={submit} noValidate className="stack tight" data-testid="admin-reinvite-form">
        <p className="small muted">{t('admin.reinviteBody')}</p>
        <Field label={t('admin.f.ownerEmail')} htmlFor="adm-re-email"><input id="adm-re-email" type="email" value={email} onChange={(e) => { setErr(''); setEmail(e.target.value); }} data-autofocus /></Field>
        <Field label={t('admin.f.ownerName')} htmlFor="adm-re-name"><input id="adm-re-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('admin.f.lang')} htmlFor="adm-re-lang"><select id="adm-re-lang" value={l} onChange={(e) => setL(e.target.value as Lang)}><option value="en">English</option><option value="es">Español</option></select></Field>
        {err && <p className="small neg" role="alert">{err}</p>}
        <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={busy} icon={<LuSend />}>{t('admin.reinvite')}</Button></div>
      </form>
    </Modal>
  );
}

/** The message to paste into WhatsApp, a text or an email when the platform did not email it. */
export function inviteMessage(c: Pick<Created, 'name' | 'link' | 'address' | 'lang'>): string {
  return c.lang === 'es'
    ? `Hola: su VYNTEX ERP para ${c.name} está listo.\n\n1. Abra este enlace para crear su contraseña (funciona una sola vez y vence en 72 horas):\n${c.link}\n\n2. Después, su dirección para entrar es:\n${c.address}\n\nAl entrar se le pedirá agregar una aplicación de autenticación, como Google Authenticator. Cualquier pregunta, escríbanos al 609-780-3218.\n\nVYNTEX USA`
    : `Hello, your VYNTEX ERP for ${c.name} is ready.\n\n1. Open this link to create your password (it works once and expires in 72 hours):\n${c.link}\n\n2. After that, your sign-in address is:\n${c.address}\n\nYou will be asked to add an authenticator app, such as Google Authenticator, when you sign in. Any questions, message us at 609-780-3218.\n\nVYNTEX USA`;
}

function Result({ created, onClose }: { created: Created; onClose: () => void }) {
  const { t } = useApp();
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(t('admin.copied', { what })); } catch { toast(t('admin.copyFailed'), true); }
  };
  return (
    <Modal title={t(created.again ? 'admin.done.titleAgain' : 'admin.done.title', { name: created.name })} onClose={onClose} labelClose={t('common.close')} size="wide">
      <div className="stack tight" data-testid="admin-result">
        <p className={cx('note', created.delivery !== 'sent' && 'warn')} data-testid="admin-result-delivery" data-delivery={created.delivery}>
          {created.delivery === 'sent' ? <><LuMailCheck aria-hidden="true" /> {t('admin.done.sent', { email: created.email })}</> : t(created.delivery === 'failed' ? 'admin.done.failed' : 'admin.done.manual', { email: created.email })}
        </p>
        <Field label={t('admin.done.address')} htmlFor="adm-r-addr" full>
          <div className="adm-copy"><input id="adm-r-addr" readOnly value={created.address} onFocus={(e) => e.currentTarget.select()} data-testid="admin-result-address" /><Button icon={<LuCopy />} onClick={() => void copy(created.address, t('admin.done.address'))}>{t('admin.copy')}</Button></div>
        </Field>
        <Field label={t('admin.done.link')} htmlFor="adm-r-link" full hint={t('admin.done.linkHint')}>
          <div className="adm-copy"><input id="adm-r-link" readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} data-testid="admin-result-link" /><Button icon={<LuCopy />} onClick={() => void copy(created.link, t('admin.done.link'))}>{t('admin.copy')}</Button></div>
        </Field>
        <div className="row"><span className="grow" />
          <Button icon={<LuCopy />} onClick={() => void copy(inviteMessage(created), t('admin.done.message'))} data-testid="admin-result-message">{t('admin.done.copyMessage')}</Button>
          <Button variant="primary" onClick={onClose}>{t('admin.done.close')}</Button>
        </div>
      </div>
    </Modal>
  );
}


/* ---------- billing of a company, seen by an operator ---------- */
function BillingCell({ company, b }: { company: AdminCompany; b: BillingRow | null }) {
  const { t, dateTime, lang } = useApp();
  const st = b?.billing_status ?? null;
  if (st && st !== 'none' && st !== 'canceled' && st !== 'incomplete_expired') {
    const tone = st === 'active' || st === 'trialing' ? 'ok' : st === 'incomplete' ? 'info' : 'bad';
    return <><Badge tone={tone}>{t('bill.st.' + st)}</Badge>
      {b?.grace_until && <><br /><span className="xs neg">{t('admin.bill.grace', { date: dateTime(b.grace_until) })}</span></>}
      {!b?.grace_until && b?.current_period_end && <><br /><span className="xs dim">{t('admin.bill.renews', { date: dateTime(b.current_period_end) })}</span></>}
      {!!b?.paid_cents && <><br /><span className="xs dim">{t('admin.bill.paid', { amount: money(b.paid_cents / 100) })}</span></>}</>;
  }
  if (company.plan === INTERNAL_PLAN) return <Badge tone="accent">{lang === 'es' ? 'Sin costo' : 'Free'}</Badge>;
  if (company.plan === 'trial') {
    const end = b?.trial_expires_at ?? null;
    if (!end) return <Badge tone="accent">{t('admin.bill.trialWaiting')}</Badge>;
    const left = Math.ceil((Date.parse(end) - Date.now()) / 86_400_000);
    return <><Badge tone={left > 0 ? 'warn' : 'bad'}>{left > 0 ? t('admin.bill.trial', { n: left }) : t('admin.bill.trialEnded')}</Badge>{b?.open_checkout && <><br /><span className="xs dim">{t('admin.bill.linkOpen')}</span></>}</>;
  }
  return <><Badge tone="neutral">{t(st === 'canceled' ? 'bill.st.canceled' : 'admin.bill.none')}</Badge>{b?.open_checkout && <><br /><span className="xs dim">{t('admin.bill.linkOpen')}</span></>}</>;
}

/* ---------- a Stripe payment link for the owner ---------- */
function PaymentLink({ company, onClose }: { company: AdminCompany; onClose: () => void }) {
  const { t, lang, dateTime } = useApp();
  const priced = PACK_LIST.some((p) => p.id === company.industry) && isPriced(company.industry as IndustryId);
  const plans = priced ? plansFor(company.industry as IndustryId) : [];
  const [plan, setPlan] = useState(plans.some((p) => p.id === company.plan) ? company.plan : (plans[1]?.id ?? plans[0]?.id ?? ''));
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [c, setC] = useState({ recurring: '', interval: 'month' as 'month' | 'year', setup: '', label: '' });
  const [l, setL] = useState<Lang>(lang);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ url: string; expiresAt: number; delivery: Created['delivery'] } | null>(null);
  const chosen = plans.find((p) => p.id === plan);
  const cents = (v: string) => { const n = Number(v.replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    let body: Record<string, unknown>;
    if (priced) body = { tenant: company.id, plan, billing, lang: l };
    else {
      const rec = cents(c.recurring); const setup = c.setup.trim() ? cents(c.setup) : 0;
      if (!Number.isInteger(rec) || rec < 100 || !Number.isInteger(setup)) { setErr(t('admin.pay.err.bad_amount')); return; }
      body = { tenant: company.id, lang: l, custom: { recurringCents: rec, interval: c.interval, setupCents: setup, label: c.label.trim() || undefined } };
    }
    setBusy(true);
    const a = await post<{ url: string; expiresAt: number; delivery: Created['delivery'] }>('/api/billing/operator/link', body, { session: true });
    setBusy(false);
    if (a.ok) { setOut(a.data); return; }
    const k = 'admin.pay.err.' + a.code;
    setErr(t(k) !== k ? t(k) : t('admin.err.generic'));
  };
  const copy = async () => { try { await navigator.clipboard.writeText(out!.url); toast(t('admin.copied', { what: t('admin.pay.link') })); } catch { toast(t('admin.copyFailed'), true); } };

  return (
    <Modal title={t('admin.pay.title', { name: company.name })} onClose={onClose} labelClose={t('common.cancel')}>
      {out ? (
        <div data-testid="admin-pay-done">
          <p className="small" role="status">{t(out.delivery === 'sent' ? 'admin.pay.sent' : 'admin.pay.manual', { email: company.owner?.email ?? company.invitation?.email ?? '' })}</p>
          <Field label={t('admin.pay.link')} htmlFor="adm-pay-url" hint={t('admin.pay.expires', { date: dateTime(new Date(out.expiresAt * 1000).toISOString()) })}>
            <div className="row nowrap"><input id="adm-pay-url" readOnly value={out.url} data-testid="admin-pay-url" onFocus={(e) => e.currentTarget.select()} /><Button icon={<LuCopy />} onClick={() => void copy()}>{t('admin.copy')}</Button></div>
          </Field>
          <div className="row"><span className="grow" /><Button variant="primary" onClick={onClose}>{t('admin.done.close')}</Button></div>
        </div>
      ) : !company.owner ? (
        <><p className="small" role="alert" data-testid="admin-pay-no-owner">{t('admin.pay.err.no_owner')}</p><div className="row"><span className="grow" /><Button onClick={onClose}>{t('admin.done.close')}</Button></div></>
      ) : (
        <form onSubmit={submit} noValidate data-testid="admin-pay-form">
          <p className="small muted">{t('admin.pay.intro', { email: company.owner.email })}</p>
          <div className="fgrid">
            {priced ? <>
              <Field label={t('admin.f.plan')} htmlFor="adm-pay-plan">
                <select id="adm-pay-plan" value={plan} onChange={(e) => setPlan(e.target.value)} data-testid="admin-pay-plan">
                  {plans.map((p) => <option key={p.id} value={p.id}>{planName(p, lang)}</option>)}
                </select>
              </Field>
              <Field label={t('admin.pay.billing')} htmlFor="adm-pay-billing">
                <select id="adm-pay-billing" value={billing} onChange={(e) => setBilling(e.target.value as 'monthly' | 'yearly')} data-testid="admin-pay-billing">
                  <option value="monthly">{t('bill.monthly')}</option><option value="yearly">{t('bill.yearly')}</option>
                </select>
              </Field>
              {chosen && <p className="small full" data-testid="admin-pay-summary">{t('admin.pay.summary', { recurring: money(billing === 'yearly' ? chosen.yearly : chosen.monthly), period: t(billing === 'yearly' ? 'bill.perYear' : 'bill.perMonth'), setup: money(chosen.setup), first: money(chosen.setup + (billing === 'yearly' ? chosen.yearly : chosen.monthly)) })}</p>}
            </> : <>
              <p className="small muted full">{t('admin.pay.quoted')}</p>
              <Field label={t('admin.pay.recurring')} htmlFor="adm-pay-rec"><input id="adm-pay-rec" inputMode="decimal" value={c.recurring} onChange={(e) => setC({ ...c, recurring: e.target.value })} data-testid="admin-pay-recurring" /></Field>
              <Field label={t('admin.pay.interval')} htmlFor="adm-pay-int">
                <select id="adm-pay-int" value={c.interval} onChange={(e) => setC({ ...c, interval: e.target.value as 'month' | 'year' })}><option value="month">{t('bill.monthly')}</option><option value="year">{t('bill.yearly')}</option></select>
              </Field>
              <Field label={t('admin.pay.setup')} htmlFor="adm-pay-setup"><input id="adm-pay-setup" inputMode="decimal" value={c.setup} onChange={(e) => setC({ ...c, setup: e.target.value })} data-testid="admin-pay-setup" /></Field>
              <Field label={t('admin.pay.label')} htmlFor="adm-pay-label"><input id="adm-pay-label" maxLength={120} value={c.label} onChange={(e) => setC({ ...c, label: e.target.value })} /></Field>
            </>}
            <Field label={t('admin.f.lang')} htmlFor="adm-pay-lang" full>
              <select id="adm-pay-lang" value={l} onChange={(e) => setL(e.target.value as Lang)}><option value="en">English</option><option value="es">Español</option></select>
            </Field>
          </div>
          <p className="xs dim">{t('admin.pay.note')}</p>
          {err && <p className="small neg" role="alert" data-testid="admin-pay-error">{err}</p>}
          <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={busy} icon={<LuCreditCard />} data-testid="admin-pay-submit">{t(busy ? 'admin.pay.busy' : 'admin.pay.submit')}</Button></div>
        </form>
      )}
    </Modal>
  );
}
