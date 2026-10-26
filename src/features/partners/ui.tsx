// Presentation pieces of the Partner Portal: page heads, panels with a toolbar, KPI tiles, filter chips, sortable
// headers, an accessible row menu, skeletons, empty states, a copy field and a button that shows it is busy.
// Nothing here calls the server or decides what a person may do: they only draw what the screens hand them.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LuArrowDown, LuArrowUp, LuCheck, LuChevronsUpDown, LuCopy, LuEllipsis, LuInbox, LuLoaderCircle } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Button, cx, toast } from '@/ui';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The head of a page: an optional way back and eyebrow, the title, one line under it, and the page's actions. */
export function PageHead({ title, sub, actions, back, eyebrow, meta }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="pp-head">
      {back && <div className="pp-back">{back}</div>}
      <div className="pp-head-row">
        <div className="pp-head-t">
          {eyebrow && <p className="pp-eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {sub && <p className="pp-head-sub">{sub}</p>}
          {meta && <div className="pp-head-meta">{meta}</div>}
        </div>
        {actions && <div className="pp-head-actions">{actions}</div>}
      </div>
    </header>
  );
}

/** A section with a title (and a count) on the left and its tools on the right, on one line that wraps when narrow. */
export function Panel({ title, count, sub, tools, children, flush, className, testId }: {
  title?: ReactNode; count?: number; sub?: ReactNode; tools?: ReactNode; children: ReactNode; flush?: boolean; className?: string; testId?: string;
}) {
  return (
    <section className={cx('pp-panel', flush && 'flush', className)} data-testid={testId}>
      {(title || tools) && (
        <header className="pp-panel-h">
          <div className="pp-panel-t">
            {title && <h2>{title}{count !== undefined && <span className="pp-count" aria-hidden="true">{count}</span>}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {tools && <div className="pp-tools">{tools}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Counts up to a real figure once, when it first arrives. Off with reduced motion. */
export function useCountUp(target: number | null, ms = 650): number | null {
  const [v, setV] = useState<number | null>(target === null || reduced() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === null) { setV(null); return; }
    if (reduced() || target === 0) { setV(target); from.current = target; return; }
    const start = performance.now(); const a = from.current; let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms); const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** A KPI tile. `value` is a real number (cents when `format` is money) or null while it loads. */
export function Kpi({ label, value, format, hint, icon, tone, testId, onClick }: {
  label: ReactNode; value: number | null; format: (n: number) => string; hint?: ReactNode; icon?: ReactNode; tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'violet'; testId?: string; onClick?: () => void;
}) {
  const shown = useCountUp(value);
  const body = (
    <>
      <div className="pp-kpi-top"><span className="pp-kpi-k">{label}</span>{icon && <span className={cx('pp-kpi-ic', tone)} aria-hidden="true">{icon}</span>}</div>
      {value === null ? <span className="pp-skel pp-skel-num" aria-hidden="true" /> : <div className="pp-kpi-v"><span aria-hidden="true">{format(shown ?? value)}</span><span className="sr">{format(value)}</span></div>}
      {hint && <div className="pp-kpi-h">{hint}</div>}
    </>
  );
  return onClick
    ? <button type="button" className={cx('pp-kpi', 'click', tone)} onClick={onClick} data-testid={testId}>{body}</button>
    : <div className={cx('pp-kpi', tone)} data-testid={testId}>{body}</div>;
}
export const count = (n: number) => n.toLocaleString('en-US');

/** Filter chips: one choice from a short list, each with its count. Instant. */
export function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div className="pp-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="pp-chipbtn" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Sorting a list by one column. `get` reads the value a column sorts by. */
export type Sort = { key: string; dir: 'asc' | 'desc' } | null;
export function useSort<T>(rows: T[], get: Record<string, (r: T) => string | number | null | undefined>, initial: Sort = null) {
  const [sort, setSort] = useState<Sort>(initial);
  const sorted = useMemo(() => {
    if (!sort || !get[sort.key]) return rows;
    const f = get[sort.key]; const m = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = f(a); const y = f(b);
      if (x === y) return 0; if (x === null || x === undefined || x === '') return 1; if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })) * m;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
  return { sorted, sort, toggle };
}
export function SortTh({ k, sort, onSort, children, num, className }: { k: string; sort: Sort; onSort: (k: string) => void; children: ReactNode; num?: boolean; className?: string }) {
  const on = sort?.key === k;
  return (
    <th className={cx(num && 'num', className)} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={cx('pp-sort', on && 'on')} onClick={() => onSort(k)}>
        {children}{on ? (sort!.dir === 'asc' ? <LuArrowUp aria-hidden="true" /> : <LuArrowDown aria-hidden="true" />) : <LuChevronsUpDown aria-hidden="true" />}
      </button>
    </th>
  );
}

export interface MenuItem { label: string; onSelect: () => void; icon?: ReactNode; danger?: boolean; testId?: string; hidden?: boolean }
/**
 * The "more actions" menu of a row: a small button that opens a menu of its own (arrow keys, Home, End, Esc returns to
 * the button, a click outside closes it). Drawn above the page so a table that scrolls sideways never cuts it off.
 */
export function RowMenu({ label, items, testId, button, buttonClass, header, width = 220 }: { label: string; items: MenuItem[]; testId?: string; button?: ReactNode; buttonClass?: string; header?: ReactNode; width?: number }) {
  const shown = items.filter((i) => !i.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const w = width; const up = r.bottom + 8 + shown.length * 40 + 16 > window.innerHeight && r.top > shown.length * 40 + 24;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)), up });
  };
  useLayoutEffect(() => { if (open) place(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  useEffect(() => {
    if (!open) return;
    const items2 = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    requestAnimationFrame(() => items2()[0]?.focus());
    const off = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      const list = items2(); const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === 'Tab') setOpen(false);
    };
    const away = () => setOpen(false);
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', away); window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
  }, [open]);
  if (!shown.length) return null;
  return (
    <>
      <button ref={btn} type="button" className={buttonClass ?? 'pp-more'} aria-label={button ? undefined : label} title={button ? undefined : label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} data-testid={testId}>{button ?? <LuEllipsis aria-hidden="true" />}</button>
      {open && pos && createPortal(
        <div ref={menu} id={id} role="menu" aria-label={label} className={cx('pp-menu', pos.up && 'up')} style={{ top: pos.top, left: pos.left, width }}>
          {header && <div className="pp-menu-h">{header}</div>}
          {shown.map((i) => (
            <button key={i.label} type="button" role="menuitem" className={cx(i.danger && 'danger')} data-testid={i.testId}
              onClick={() => { setOpen(false); btn.current?.focus(); i.onSelect(); }}>{i.icon}<span>{i.label}</span></button>
          ))}
        </div>, document.body)}
    </>
  );
}

/** A button for something that talks to the server: it shows it is working and cannot be pressed twice meanwhile. */
export function AsyncButton({ onClick, children, icon, disabled, ...rest }: { onClick: () => unknown | Promise<unknown>; children?: ReactNode; icon?: ReactNode; disabled?: boolean } & Omit<ComponentProps<typeof Button>, 'onClick' | 'icon'>) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try { await onClick(); } finally { if (alive.current) setBusy(false); }
  };
  return <Button {...rest} icon={busy ? <LuLoaderCircle className="pp-spin" aria-hidden="true" /> : icon} disabled={disabled || busy} aria-busy={busy || undefined} onClick={() => void go()}>{children}</Button>;
}

/** A read-only value with a copy button that confirms in place. */
export function CopyField({ value, label, id, testId }: { value: string; label: string; id?: string; testId?: string }) {
  const { t } = useApp();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const h = setTimeout(() => setDone(false), 1800); return () => clearTimeout(h); }, [done]);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setDone(true); toast(t('pp.copied')); } catch { toast(t('pp.copyFailed'), true); } };
  return (
    <div className="pp-copy">
      <input id={id} readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} data-testid={testId} />
      <Button size="sm" variant={done ? 'outline' : 'default'} icon={done ? <LuCheck aria-hidden="true" /> : <LuCopy aria-hidden="true" />} onClick={() => void copy()} aria-live="polite">{done ? t('pp.copied') : t('pp.copy')}</Button>
    </div>
  );
}

/** Shimmering placeholders in the shape of what is loading. */
export function Skeleton({ kind = 'page' }: { kind?: 'page' | 'table' | 'cards' | 'doc' }) {
  const { t } = useApp();
  const rows = (n: number) => Array.from({ length: n }, (_, i) => <div key={i} className="pp-skel-row"><span className="pp-skel w30" /><span className="pp-skel w20" /><span className="pp-skel w15" /><span className="pp-skel w10" /></div>);
  return (
    <div className="pp-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr">{t('pp.loading')}</span>
      {kind === 'page' && <><span className="pp-skel h-title" /><span className="pp-skel h-sub" /><div className="pp-skel-kpis">{[0, 1, 2, 3].map((i) => <span key={i} className="pp-skel h-kpi" />)}</div><div className="pp-skel-card">{rows(4)}</div></>}
      {kind === 'table' && <div className="pp-skel-card">{rows(6)}</div>}
      {kind === 'cards' && <div className="pp-skel-grid">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="pp-skel h-item" />)}</div>}
      {kind === 'doc' && <div className="pp-skel-doc"><span className="pp-skel h-title" /><span className="pp-skel h-sub" />{rows(5)}</div>}
    </div>
  );
}

/** What a list says when it has nothing, with a way forward when there is one. */
export function EmptyState({ icon, title, body, action, compact }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('pp-empty', compact && 'compact')}>
      <span className="pp-empty-ic" aria-hidden="true">{icon ?? <LuInbox />}</span>
      <b>{title}</b>
      {body && <p>{body}</p>}
      {action && <div className="pp-empty-a">{action}</div>}
    </div>
  );
}

/** Initials in a circle, and a short stack of them. */
export function Initials({ name, size }: { name: string; size?: 'sm' | 'xs' }) {
  const s = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  return <span className={cx('pp-av', size)} aria-hidden="true">{s}</span>;
}
export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  return (
    <span className="pp-avs" title={names.join(', ')}>
      {names.slice(0, max).map((n, i) => <Initials key={i} name={n} size="sm" />)}
      {names.length > max && <span className="pp-av sm more" aria-hidden="true">+{names.length - max}</span>}
    </span>
  );
}

/** A dl of label and value pairs in two columns. */
export function Facts({ items }: { items: [ReactNode, ReactNode, boolean?][] }) {
  return <dl className="pp-facts">{items.filter((x) => x[2] !== false).map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
