// Start a 7-day free trial (/start-trial, VYNTEX ERP only). The form posts to /api/auth/trial/request (api/_lib/trial.js),
// which makes the workspace in onboarding and emails the owner a one-time activation link. The page only ever says what
// really happened: "check your email" (the same answer whether or not the address already had a trial), the email could
// not be sent (nothing was reserved), too many attempts, trials not open, or a failure. A quoted edition (no published
// plans) has no self-serve trial: the page says so and links to Request a demo.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuCalendarCheck, LuCircleAlert, LuCreditCard, LuCrown, LuGlobe, LuReceipt, LuShieldCheck, LuTriangleAlert, LuUndo2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Link, PREVIEW } from '@/app/router';
import { PACKS, PACK_LIST, isIndustry } from '@/packs';
import type { IndustryId, Lang } from '@/domain/types';
import { isPriced, planName, plansFor } from '@/lib/pricing';
import { get, post } from '@/platform/live/http';
import { BRAND } from '@/config/brand';
import { Arrow, Reveal } from '@/brand';
import { Badge, cx } from '@/ui';
import { MkPage, mailHref, usePageTitle } from './parts';
import './pages.css';

type Field = 'business' | 'owner' | 'email' | 'edition' | 'consent';
const ORDER: Field[] = ['business', 'owner', 'email', 'edition', 'consent'];
interface FormState { business: string; owner: string; email: string; edition: string; language: Lang; consent: boolean; website: string }
type Outcome = 'unavailable' | 'email' | 'limited' | 'failed';

/** The legal pages of VYNTEX USA (the ERP has none of its own). */
export const TERMS_URL = 'https://www.vyntexusa.com/terms';
export const PRIVACY_URL = 'https://www.vyntexusa.com/privacy';
/** Where the workspaces live. The page shows the real host it is served from. */
const host = () => (typeof location !== 'undefined' && location.host ? location.host : 'erp.vyntexusa.com');

/** The address word the server will try first (api/_lib/trial.js slugFrom, same rules). */
export function slugPreview(name: string): string {
  let s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 40) s = s.slice(0, 40).replace(/-[^-]*$/, '') || s.slice(0, 40);
  s = s.replace(/-+$/g, '');
  if (s.length < 3) s = s ? `${s}-co` : '';
  return s;
}

function problems(f: FormState): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (f.business.trim().length < 2) e.business = 'mk.tr.err.business';
  if (f.owner.trim().length < 2) e.owner = 'mk.tr.err.owner';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'mk.tr.err.email';
  if (!f.consent) e.consent = 'mk.tr.err.consent';
  return e;
}

/** The platform name set like the lockup, inside a sentence. */
function PlatformName() {
  const [first, ...rest] = BRAND.platformName.split(' ');
  return <span className="mkp-product"><span className="chrome-text">{first}</span>{rest.length > 0 && <> <span className="brand-text">{rest.join(' ')}</span></>}</span>;
}

/** Drawn once when the link was sent: a circuit line runs into an envelope node, then stays still. */
function SentMark() {
  return (
    <svg className="mkp-done-fig" viewBox="0 0 272 64" width="272" height="64" fill="none" aria-hidden="true">
      <path className="ln" pathLength={100} d="M5 32 H78 L98 12 H158 L178 32 H210" />
      <circle className="nd" cx="5" cy="32" r="3.5" />
      <circle className="ring" cx="240" cy="32" r="23" />
      <path className="ck" pathLength={100} d="M228 24 h24 v17 h-24 z M228 24 l12 9 l12 -9" />
    </svg>
  );
}

export function StartTrial() {
  const { t, pack, lang } = useApp();
  usePageTitle(t('mk.tr.title'));
  const blank = (): FormState => ({ business: '', owner: '', email: '', edition: pack.id, language: lang, consent: false, website: '' });
  const [f, setF] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [open, setOpen] = useState<boolean | null>(PREVIEW ? false : null);
  const resultRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (outcome) resultRef.current?.focus(); }, [outcome]);
  useEffect(() => { if (sentTo) doneRef.current?.focus(); }, [sentTo]);
  // Is the trial open on this site? Asked once; until the answer comes the form is shown as usual.
  useEffect(() => {
    if (PREVIEW) return;
    let live = true;
    void get<{ available?: boolean }>('/api/auth/trial/status', { passive: true, session: false }).then((a) => { if (live) setOpen(a.ok && a.data.available === true); });
    return () => { live = false; };
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((s) => ({ ...s, [k]: v })); if (errors[k as Field]) setErrors((e) => { const n = { ...e }; delete n[k as Field]; return n; }); };
  const focusFirst = (e: Partial<Record<Field, string>>) => { const first = ORDER.find((k) => e[k]); if (first) document.getElementById('tr-f-' + first)?.focus(); };

  const edition = isIndustry(f.edition) ? PACKS[f.edition as IndustryId] : pack;
  const quoted = !isPriced(edition.id);
  const top = plansFor(edition.id).at(-1);
  const slug = slugPreview(f.business);
  const address = `${host()}/${slug || t('mk.tr.slugSample')}`;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || quoted) return;
    const found = problems(f);
    setErrors(found);
    if (Object.keys(found).length) { setOutcome(null); focusFirst(found); return; }
    if (open === false) { setOutcome('unavailable'); return; }
    setBusy(true); setOutcome(null);
    const a = await post<{ sent?: boolean }>('/api/auth/trial/request', {
      business: f.business.trim(), owner: f.owner.trim(), email: f.email.trim(), edition: f.edition, language: f.language, consent: f.consent, website: f.website,
    }, { stepUp: false, session: false });
    setBusy(false);
    if (a.ok && a.data.sent) { setSentTo(f.email.trim()); return; }
    if (!a.ok && a.code === 'quoted_edition') { set('edition', f.edition); setOutcome(null); return; }
    if (!a.ok && a.code === 'invalid' && a.data.fields && typeof a.data.fields === 'object') {
      const fromServer: Partial<Record<Field, string>> = {};
      for (const k of Object.keys(a.data.fields as object)) if ((ORDER as string[]).includes(k)) fromServer[k as Field] = `mk.tr.err.${k === 'edition' ? 'business' : k}`;
      if (Object.keys(fromServer).length) { setErrors(fromServer); focusFirst(fromServer); return; }
    }
    if (!a.ok && (a.code === 'trial_unavailable' || a.code === 'not_found' || a.code === 'not_configured')) { setOpen(false); setOutcome('unavailable'); return; }
    setOutcome(!a.ok && a.code === 'email_failed' ? 'email' : !a.ok && (a.status === 429 || a.code === 'rate_limited') ? 'limited' : 'failed');
  };

  const err = (k: Field) => (errors[k] ? <span className="mkp-err" id={`tr-e-${k}`} data-testid={`tr-error-${k}`}><LuCircleAlert aria-hidden="true" />{t(errors[k]!)}</span> : null);
  const aria = (k: Field) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `tr-e-${k}` : undefined });
  const field = (k: Field, label: ReactNode, control: ReactNode, full?: boolean, extra?: ReactNode, cls?: string) => (
    <div className={cx('mkp-field', errors[k] && 'err', full && 'full', cls)}><label htmlFor={`tr-f-${k}`}>{label}</label>{control}{extra}{err(k)}</div>
  );
  const hasErrors = Object.keys(errors).length > 0;

  const mark = '\u0001';
  const head = t('mk.tr.h', { name: mark }).split(mark);
  const gets: { icon: ReactNode; h: string; p: ReactNode; note?: string }[] = [
    { icon: <LuCalendarCheck aria-hidden="true" />, h: t('mk.tr.g1.h'), p: t('mk.tr.g1.p') },
    { icon: <LuCreditCard aria-hidden="true" />, h: t('mk.tr.g2.h'), p: t('mk.tr.g2.p') },
    { icon: <LuCrown aria-hidden="true" />, h: t('mk.tr.g3.h'), p: top && !quoted ? t('mk.tr.g3.p', { plan: planName(top, lang), product: edition.product }) : t('mk.tr.g3.pAny') },
    { icon: <LuGlobe aria-hidden="true" />, h: t('mk.tr.g4.h'), p: <>{t('mk.tr.g4.p', { address: '' })}<b className="mkp-tr-addr" data-testid="tr-address">{address}</b></>, note: t('mk.tr.g4.note') },
    { icon: <LuReceipt aria-hidden="true" />, h: t('mk.tr.g5.h'), p: t('mk.tr.g5.p') },
    { icon: <LuUndo2 aria-hidden="true" />, h: t('mk.tr.g6.h'), p: t('mk.tr.g6.p') },
  ];

  const fail = outcome && (
    <div className="mkp-result" role="alert" tabIndex={-1} ref={resultRef} data-testid="tr-result" data-state={outcome}>
      <p className="mkp-result-tag"><Badge tone="warn" outline><LuTriangleAlert aria-hidden="true" />{t(`mk.tr.fail.${outcome}.h`)}</Badge></p>
      <p>{t(`mk.tr.fail.${outcome}.p`, { phone: BRAND.phone })}</p>
      {outcome === 'unavailable' && <p className="mkp-tr-alt"><Link to="/request-demo" className="btn" data-testid="tr-unavailable-request">{t('mk.tr.quoted.cta')}<Arrow /></Link></p>}
    </div>
  );

  return (
    <MkPage current="trial">
      <div className="mkp">
        <div className="mkp-rd-bg" aria-hidden="true" />
        <div className="mkp-wrap mkp-rd mkp-tr">
          <header className="mkp-rd-intro">
            <p className="mkp-tr-eyebrow">{t('mk.tr.eyebrow')}</p>
            <h1>{head.length === 2 ? <>{head[0]}<PlatformName />{head[1]}</> : t('mk.tr.h', { name: BRAND.platformName })}</h1>
            <p className="mkp-lede">{t('mk.tr.lede')}</p>
          </header>

          <div className="mkp-rd-form">
            <Reveal kind="panel" delay={60}>
              <div className="mkp-premium mkp-form" data-testid="tr-panel">
                {sentTo ? (
                  <div className="mkp-done" role="status" tabIndex={-1} ref={doneRef} data-testid="tr-done">
                    <SentMark />
                    <h2>{t('mk.tr.done.h')}</h2>
                    <p className="mkp-tr-sent" data-testid="tr-done-email">{t('mk.tr.done.p', { email: sentTo })}</p>
                    <h3>{t('mk.tr.done.next')}</h3>
                    <ol className="mkp-steps">
                      {(['s1', 's2', 's3', 's4'] as const).map((k) => <li key={k}>{t(`mk.tr.done.${k}`)}</li>)}
                    </ol>
                    <p className="mkp-tr-resend" data-testid="tr-resend">{t('mk.tr.done.resend', { phone: BRAND.phone, mail: BRAND.email })}</p>
                    <div className="mkp-done-act">
                      <Link to="/" className="btn lg" data-testid="tr-home">{t('mk.tr.done.home')}</Link>
                      <button type="button" className="linkbtn" onClick={() => { setF(blank()); setErrors({}); setOutcome(null); setSentTo(''); }} data-testid="tr-again">{t('mk.tr.done.again')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <header className="mkp-form-h">
                      <h2 id="tr-form-h">{t('mk.tr.form.h')}</h2>
                      <p>{t('mk.tr.form.p')}</p>
                    </header>
                    <form onSubmit={submit} noValidate data-testid="tr-form" aria-labelledby="tr-form-h">
                      <div className="mkp-fgrid">
                        {field('business', t('mk.tr.business'), <input id="tr-f-business" type="text" autoComplete="organization" maxLength={120} value={f.business} onChange={(e) => set('business', e.target.value)} data-testid="tr-business" {...aria('business')} />, true,
                          <span className="mkp-tr-hint" aria-live="polite">{t('mk.tr.address')}: <b data-testid="tr-slug">{host()}/{slug || '...'}</b></span>)}
                        {field('owner', t('mk.tr.owner'), <input id="tr-f-owner" type="text" autoComplete="name" maxLength={100} value={f.owner} onChange={(e) => set('owner', e.target.value)} data-testid="tr-owner" {...aria('owner')} />)}
                        {field('email', t('mk.tr.email'), <input id="tr-f-email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={f.email} onChange={(e) => set('email', e.target.value)} data-testid="tr-email" {...aria('email')} />)}
                        {field('edition', t('mk.tr.edition'),
                          <select id="tr-f-edition" value={f.edition} onChange={(e) => set('edition', e.target.value)} data-testid="tr-edition" {...aria('edition')}>
                            {PACK_LIST.map((p) => <option key={p.id} value={p.id}>{p.product}: {p.label[lang]}</option>)}
                          </select>, false, undefined, 'ed')}
                        <fieldset className="mkp-choice lang" data-testid="tr-language">
                          <legend>{t('mk.tr.language')}</legend>
                          <div>{(['en', 'es'] as Lang[]).map((l) => (
                            <label key={l}><input type="radio" name="tr-language" value={l} checked={f.language === l} onChange={() => set('language', l)} data-testid={`tr-language-${l}`} /><span>{t('mk.tr.lang.' + l)}</span></label>
                          ))}</div>
                        </fieldset>
                        {quoted ? (
                          <div className="full mkp-tr-quoted" role="status" data-testid="tr-quoted">
                            <h3>{t('mk.tr.quoted.h', { product: edition.product })}</h3>
                            <p>{t('mk.tr.quoted.p', { product: edition.product })}</p>
                            <Link to={`/request-demo?industry=${edition.id}`} className="btn primary lg block" data-testid="tr-quoted-request">{t('mk.tr.quoted.cta')}<Arrow /></Link>
                          </div>
                        ) : (
                          <div className={cx('mkp-consent full', errors.consent && 'err')}>
                            <label><input id="tr-f-consent" type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} data-testid="tr-consent" aria-required="true" {...aria('consent')} />
                              <span>{t('mk.tr.consent.a')} <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" data-testid="tr-terms">{t('mk.tr.consent.terms')}</a> {t('mk.tr.consent.and')} <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" data-testid="tr-privacy">{t('mk.tr.consent.privacy')}</a>{t('mk.tr.consent.b')}</span>
                            </label>
                            {err('consent')}
                          </div>
                        )}
                        <div className="mkp-hp" aria-hidden="true">
                          <label htmlFor="tr-f-website">{t('mk.tr.hp')}</label>
                          <input id="tr-f-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} data-testid="tr-website" />
                        </div>
                      </div>
                      {!quoted && <>
                        {hasErrors && <p className="mkp-err mkp-err-sum" role="alert" data-testid="tr-errors"><LuCircleAlert aria-hidden="true" />{t('mk.tr.err.summary')}</p>}
                        {fail}
                        <div className="mkp-send">
                          <button type="submit" className="btn primary lg block" disabled={busy} aria-busy={busy || undefined} data-testid="tr-submit">{t(busy ? 'mk.tr.sending' : 'mk.tr.submit')}{!busy && <Arrow />}</button>
                          <p className="mkp-tr-fine">{t('mk.tr.fine')}</p>
                        </div>
                      </>}
                    </form>
                  </>
                )}
              </div>
            </Reveal>
          </div>

          <aside className="mkp-rd-aside">
            <Reveal as="section" aria-labelledby="tr-get-h">
              <h2 id="tr-get-h">{t('mk.tr.get.h')}</h2>
              <ul className="mkp-benefits" data-testid="tr-gets">
                {gets.map((g, i) => (
                  <li key={i}>{g.icon}<div><h3>{g.h}</h3><p>{g.p}</p>{g.note && <p className="mkp-tr-note">{g.note}</p>}</div></li>
                ))}
              </ul>
              <p className="mkp-tr-secure"><LuShieldCheck aria-hidden="true" />{t('mk.tr.secure')}</p>
              <p className="mkp-tr-links">
                <Link to="/pricing" className="mkp-quiet" data-testid="tr-see-pricing">{t('mk.tr.see')}<Arrow /></Link>
                <a className="mkp-quiet" href={mailHref()}>{BRAND.email}</a>
              </p>
            </Reveal>
          </aside>
        </div>
      </div>
    </MkPage>
  );
}
