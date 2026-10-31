// Small pieces every Partner Portal screen uses.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/app/hooks';
import { LuCircleAlert, LuRotateCcw } from 'react-icons/lu';
import { Button, cx } from '@/ui';
import type { Tone } from '@/ui';
import { Skeleton } from './ui';
import type { Lang } from '@/domain/types';
import type { L10n, L10nList } from './api';

/** Integer cents as dollars and cents. Never a float in arithmetic: this is display only. */
export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const neg = cents < 0; const abs = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(abs / 100).toLocaleString('en-US'); const part = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}$${whole}.${part}`;
}
export const pct = (bps: number | null | undefined) => (bps === null || bps === undefined ? '' : `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`);
export const tx = (v: L10n | null | undefined, lang: Lang): string => (v ? (lang === 'es' ? v.es || v.en || '' : v.en || v.es || '') : '');
export const tl = (v: L10nList | null | undefined, lang: Lang): string[] => (v ? (lang === 'es' ? v.es || v.en || [] : v.en || v.es || []) : []);

const TONES: Record<string, Tone> = {
  draft: 'neutral', pending_approval: 'warn', changes_requested: 'warn', approved: 'ok', sent: 'info', viewed: 'info', accepted: 'ok', declined: 'bad',
  expired: 'neutral', withdrawn: 'neutral', ordered: 'violet', submitted: 'info', under_review: 'info', info_required: 'warn', awaiting_payment: 'warn',
  scheduled: 'info', in_progress: 'info', live: 'ok', completed: 'ok', rejected: 'bad', cancelled: 'neutral', disputed: 'bad', refunded: 'bad',
  eligible: 'info', payable: 'violet', paid: 'ok', held: 'warn', reversed: 'bad', settled: 'ok', active: 'ok', suspended: 'warn', revoked: 'bad',
  published: 'ok', needs_approval: 'warn', retired: 'neutral', approved_source: 'ok', informational_estimate: 'neutral',
};
// compliance words have their own colours: what is missing warns, what is on file is calm, what is verified is good
const COMPLIANCE: Record<string, Tone> = { missing: 'warn', received: 'info', verified: 'ok', none: 'neutral', signed: 'ok', terminated: 'bad' };
export const toneOf = (value: string): Tone => TONES[value] ?? COMPLIANCE[value] ?? 'neutral';
/** A status chip: a coloured dot and the word, the same everywhere in the portal. */
export function Status({ value, prefix }: { value: string; prefix?: string }) {
  const { t } = useApp();
  const k = 'pp.st.' + value;
  const label = t(k);
  const tone = toneOf(value);
  return <span className={cx('pp-st', tone)} data-status={value}><i aria-hidden="true" />{prefix && <span className="pp-st-p">{prefix}</span>}{label === k ? value.replace(/_/g, ' ') : label}</span>;
}

/** Turns the database's one-word reason into a sentence, or a general one. */
export function useErrorText() {
  const { t } = useApp();
  return (a: { ok: false; code: string; status: number; data: Record<string, unknown> }) => {
    const reason = typeof a.data.reason === 'string' ? a.data.reason : '';
    for (const k of [reason && 'pp.err.' + reason, 'pp.err.' + a.code]) if (k && t(k) !== k) return t(k);
    if (a.status === 0 || a.status >= 500) return t('pp.err.offline');
    return t('pp.err.generic');
  };
}

/** Loads something once and on demand. */
export function useLoad<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; code: string; status: number; data: Record<string, unknown> }>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');
  const errText = useErrorText();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    const r = await fn();
    if (!alive.current) return;
    if (r.ok) { setData(r.data); setError(''); } else setError(errText(r));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load, setData };
}

export function Loading({ kind }: { kind?: 'page' | 'table' | 'cards' | 'doc' }) { return <Skeleton kind={kind} />; }
export function Failed({ text, retry }: { text: string; retry: () => void }) {
  const { t } = useApp();
  return (
    <div className="pp-failed"><LuCircleAlert aria-hidden="true" /><span role="alert" className="grow">{text}</span>
      <Button size="sm" icon={<LuRotateCcw aria-hidden="true" />} onClick={retry}>{t('pp.retry')}</Button></div>
  );
}
export function Section({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="pp-section">
      <header className="pp-section-h"><div><h2>{title}</h2>{sub && <p className="small muted">{sub}</p>}</div>{actions && <div className="pp-tools">{actions}</div>}</header>
      {children}
    </section>
  );
}
export const isoDate = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
