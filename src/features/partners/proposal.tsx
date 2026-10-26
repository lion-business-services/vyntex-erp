// The client proposal: the premium document a client opens from a private link (erp.vyntexusa.com/proposal/<token>),
// and the preview a partner sees before sharing. It shows only what the server put in the frozen, client-safe snapshot:
// never partner pay, floors, notes, policies or partner identifiers. Printable to PDF from the browser.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LuCheck, LuCircleCheck, LuLink2Off, LuPrinter, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Lockup } from '@/brand';
import { BRAND } from '@/config/brand';
import { Button, Field, Note } from '@/ui';
import { get, post } from '@/platform/live/http';
import type { Lang } from '@/domain/types';
import type { L10n, L10nList } from './api';
import { tl, tx, usd } from './shared';
import { Skeleton } from './ui';
import './partners.css';

export interface ProposalData {
  ref: string; title: string; summary: string; client_name: string; client_contact: string; industry: string; requirements: string; lang: Lang; valid_until: string;
  setup_cents: number; one_time_cents: number; recurring_cents: number; deposit_cents: number; discount_cents: number;
  lines: { item: string; quantity: number; quote: boolean; name: L10n; tagline: L10n; includes: L10nList; excludes: L10nList; lead_time: L10n; setup_cents: number; one_time_cents: number; recurring_cents: number; minimum_term_months: number | null }[];
  terms: { title: L10n; body: L10n }[];
  status?: string; expired?: boolean;
}

/** The words of the proposal follow the proposal's own language, not the reader's settings. */
const W = {
  en: { proposal: 'Proposal', for: 'Prepared for', valid: 'Valid until', context: 'Your business', solution: 'Recommended solution', scope: 'What is included',
    excluded: 'Not included', investment: 'Investment', setup: 'One-time setup', once: 'One-time work', monthly: 'Monthly', perMonth: 'per month', first: 'Due to start (deposit)',
    discount: 'Discount applied to one-time charges', quote: 'Priced by VYNTEX on request', term: 'Minimum term: {n} months', lead: 'Delivery: {time}', terms: 'Terms', next: 'Next steps',
    nextBody: 'Accept below and VYNTEX will contact you to confirm the details, send the deposit invoice and schedule the start.',
    third: 'Third-party usage (phone numbers, carrier registration, messages, call minutes and AI usage) is billed at cost and is not included above.',
    print: 'Print or save as PDF', accept: 'Accept this proposal', decline: 'Decline', name: 'Your full name', submit: 'Confirm', accepted: 'Accepted. Thank you: VYNTEX will contact you shortly.',
    declined: 'Declined. Thank you for letting us know.', expired: 'This proposal has expired. Ask your VYNTEX contact for an updated one.', contact: 'Questions? Call or WhatsApp {phone}, or write to {email}.',
    quantity: '{n} x', nameNeeded: 'Type your full name to confirm.', failed: 'That did not work. Try again in a moment.', back: 'Back' },
  es: { proposal: 'Propuesta', for: 'Preparada para', valid: 'Válida hasta', context: 'Su negocio', solution: 'Solución recomendada', scope: 'Qué incluye',
    excluded: 'No incluye', investment: 'Inversión', setup: 'Instalación única', once: 'Trabajo único', monthly: 'Mensual', perMonth: 'al mes', first: 'Para empezar (anticipo)',
    discount: 'Descuento aplicado a los cargos únicos', quote: 'VYNTEX lo cotiza a pedido', term: 'Plazo mínimo: {n} meses', lead: 'Entrega: {time}', terms: 'Condiciones', next: 'Siguientes pasos',
    nextBody: 'Acepte abajo y VYNTEX le contactará para confirmar los detalles, enviar la factura del anticipo y programar el inicio.',
    third: 'El uso de terceros (números de teléfono, registro con la operadora, mensajes, minutos de llamada y uso de IA) se cobra al costo y no está incluido arriba.',
    print: 'Imprimir o guardar como PDF', accept: 'Aceptar esta propuesta', decline: 'Rechazar', name: 'Su nombre completo', submit: 'Confirmar', accepted: 'Aceptada. Gracias: VYNTEX le contactará muy pronto.',
    declined: 'Rechazada. Gracias por avisarnos.', expired: 'Esta propuesta venció. Pida una actualizada a su contacto de VYNTEX.', contact: '¿Preguntas? Llame o escriba por WhatsApp al {phone}, o escriba a {email}.',
    quantity: '{n} x', nameNeeded: 'Escriba su nombre completo para confirmar.', failed: 'No funcionó. Intente de nuevo en un momento.', back: 'Volver' },
};
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));

export function ProposalDocument({ p, actions }: { p: ProposalData; actions?: React.ReactNode }) {
  const lang: Lang = p.lang === 'es' ? 'es' : 'en';
  const w = W[lang];
  const date = (v: string) => new Date(v + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <article className="pp-doc" lang={lang} data-testid="pp-proposal">
      <header className="pp-doc-h">
        <Lockup size="md" />
        <div className="pp-doc-meta">
          <p className="pp-doc-kicker"><span>{w.proposal}</span> {p.ref}</p>
          <p>{w.for} <b>{p.client_name}</b>{p.client_contact ? `, ${p.client_contact}` : ''}</p>
          <p className="small">{w.valid} {date(p.valid_until)}</p>
        </div>
      </header>
      {p.title && <h1 className="pp-doc-title">{p.title}</h1>}
      {(p.requirements || p.industry) && (
        <section><h2>{w.context}</h2>{p.industry && <p className="small muted">{p.industry}</p>}{p.requirements && p.requirements.split('\n').map((l, n) => <p key={n}>{l}</p>)}</section>
      )}
      {p.summary && <section><h2>{w.solution}</h2>{p.summary.split('\n').map((l, n) => <p key={n}>{l}</p>)}</section>}
      <section>
        <h2>{w.scope}</h2>
        {p.lines.map((l, n) => (
          <div key={n} className="pp-doc-line">
            <h3>{l.quantity > 1 ? fill(w.quantity, { n: l.quantity }) + ' ' : ''}{tx(l.name, lang)}</h3>
            {tx(l.tagline, lang) && <p className="muted">{tx(l.tagline, lang)}</p>}
            <ul className="pp-inc">{tl(l.includes, lang).map((x, i) => <li key={i}><LuCheck aria-hidden="true" />{x}</li>)}</ul>
            {!!tl(l.excludes, lang).length && <p className="small muted"><b>{w.excluded}:</b> {tl(l.excludes, lang).join('; ')}</p>}
            <p className="small muted">{tx(l.lead_time, lang) ? fill(w.lead, { time: tx(l.lead_time, lang) }) : ''}{l.minimum_term_months ? ` · ${fill(w.term, { n: l.minimum_term_months })}` : ''}</p>
          </div>
        ))}
      </section>
      <section className="pp-doc-money">
        <h2>{w.investment}</h2>
        <table className="tbl">
          <tbody>
            {p.lines.map((l, n) => (
              <tr key={n}>
                <td>{tx(l.name, lang)}</td>
                <td className="num">{l.quote ? w.quote : [l.setup_cents ? `${usd(l.setup_cents)} ${w.setup.toLowerCase()}` : '', l.one_time_cents ? usd(l.one_time_cents) : '', l.recurring_cents ? `${usd(l.recurring_cents)} ${w.perMonth}` : ''].filter(Boolean).join(' + ')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {p.discount_cents > 0 && <tr><th>{w.discount}</th><td className="num">-{usd(p.discount_cents)}</td></tr>}
            <tr><th>{w.setup}</th><td className="num">{usd(p.setup_cents + p.one_time_cents)}</td></tr>
            <tr><th>{w.monthly}</th><td className="num">{usd(p.recurring_cents)} {w.perMonth}</td></tr>
            <tr className="pp-doc-due"><th>{w.first}</th><td className="num">{usd(p.deposit_cents)}</td></tr>
          </tfoot>
        </table>
        <p className="xs muted">{w.third}</p>
      </section>
      {!!p.terms.length && (
        <section><h2>{w.terms}</h2><ul className="small">{p.terms.map((x, n) => <li key={n}><b>{tx(x.title, lang)}.</b> {tx(x.body, lang)}</li>)}</ul></section>
      )}
      <section><h2>{w.next}</h2><p>{w.nextBody}</p>{actions}</section>
      <footer className="pp-doc-f small muted">{fill(w.contact, { phone: BRAND.phone, email: BRAND.email })}<br />{BRAND.address}</footer>
    </article>
  );
}

/** The public page at /proposal/<token>. No account. */
export default function ProposalPage({ token: fromAddress }: { token?: string }) {
  const { t } = useApp();
  const [token] = useState(() => fromAddress ?? '');
  const [state, setState] = useState<{ at: 'loading' } | { at: 'gone' } | { at: 'offline' } | { at: 'ready'; p: ProposalData }>({ at: 'loading' });
  const [deciding, setDeciding] = useState<'accepted' | 'declined' | null>(null);
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return; asked.current = true;
    void (async () => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setState({ at: 'gone' }); return; }
      const a = await get<{ proposal: ProposalData }>('/api/partners/proposal/' + token, { session: false, passive: true });
      if (a.ok) {
        // the view is recorded by this script once the page is drawn, never by fetching the link
        void post('/api/partners/proposal/' + token + '/viewed', {}, { session: false, stepUp: false });
        setState({ at: 'ready', p: a.data.proposal }); document.title = `${W[a.data.proposal.lang === 'es' ? 'es' : 'en'].proposal} ${a.data.proposal.ref} · VYNTEX`; }
      else setState({ at: a.status === 0 || a.status >= 500 ? 'offline' : 'gone' });
    })();
  }, [token]);
  if (state.at === 'loading') return <div className="pp-doc-page"><div className="pp-doc"><Skeleton kind="doc" /></div></div>;
  if (state.at !== 'ready') return <div className="pp-doc-page"><div className="pp-doc pp-doc-gone"><Lockup size="sm" /><span className="pp-empty-ic" aria-hidden="true"><LuLink2Off /></span><p role="alert">{t(state.at === 'gone' ? 'pp.prop.gone' : 'pp.err.offline')}</p></div></div>;
  const p = state.p; const w = W[p.lang === 'es' ? 'es' : 'en'];
  const decided = p.status === 'accepted' || p.status === 'declined';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { setErr(w.nameNeeded); return; }
    setBusy(true); setErr('');
    const a = await post<{ status: string }>(`/api/partners/proposal/${token}/respond`, { decision: deciding, name: name.trim() }, { session: false, stepUp: false });
    setBusy(false);
    if (a.ok) setState({ at: 'ready', p: { ...p, status: a.data.status } }); else setErr(w.failed);
  };
  const actions = (
    <div className="pp-doc-actions no-print">
      {p.expired && !decided && <Note tone="warn">{w.expired}</Note>}
      {decided && <div className={'pp-doc-done ' + (p.status === 'accepted' ? 'ok' : '')}>{p.status === 'accepted' ? <LuCircleCheck aria-hidden="true" /> : <LuX aria-hidden="true" />}<span role="status">{p.status === 'accepted' ? w.accepted : w.declined}</span></div>}
      {!decided && !p.expired && !deciding && (
        <div className="pp-doc-cta">
          <Button variant="primary" size="lg" icon={<LuCheck />} onClick={() => setDeciding('accepted')} data-testid="pp-accept">{w.accept}</Button>
          <Button variant="ghost" onClick={() => setDeciding('declined')}>{w.decline}</Button>
        </div>
      )}
      {deciding && !decided && (
        <form onSubmit={submit} className="pp-doc-sign" noValidate>
          <Field label={w.name} htmlFor="pp-sign" error={!!err}><input id="pp-sign" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} autoFocus aria-invalid={!!err || undefined} /></Field>
          <div className="pp-doc-cta">
            <Button type="submit" variant={deciding === 'accepted' ? 'primary' : 'danger'} disabled={busy} aria-busy={busy || undefined}>{w.submit}: {deciding === 'accepted' ? w.accept : w.decline}</Button>
            <Button variant="ghost" onClick={() => { setDeciding(null); setErr(''); }}>{w.back}</Button>
          </div>
          {err && <p className="pp-err" role="alert">{err}</p>}
        </form>
      )}
      <div><Button variant="ghost" size="sm" icon={<LuPrinter />} onClick={() => window.print()}>{w.print}</Button></div>
    </div>
  );
  return <div className="pp-doc-page"><ProposalDocument p={p} actions={actions} /></div>;
}
