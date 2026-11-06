// Invoices (supabase/migrations/0086_invoices.sql, api/_lib/invoices.js): a tab of Payments, in a live workspace.
//   * an invoice is made from a project: client, email and the balance still owed are filled in; lines can come from
//     Services; the 2.9% card service fee is one switch and is computed by the database, never typed
//   * "Save and send" emails it with a secure pay link (VYNTEX USA's workspace: Stripe). A sent invoice is never edited:
//     it is reminded about, voided (owner or manager, fresh identity check) or duplicated
//   * the payment arrives from Stripe on its own and shows here and in Payments; reminders go out on their own
// Every action goes through the database functions with the person's own session: the database decides who may.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuBell, LuCopy, LuFileText, LuPencil, LuPlus, LuSend, LuTrash2, LuX } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Badge, Button, Card, Empty, Field, Modal, Note, PageHeader, Seg, Stat, confirmDialog, toast, type Tone } from '@/ui';
import { rpc } from '@/platform/live/ops';
import { session } from '@/platform/session';
import { INTERNAL_PLAN } from '@/config/plans';
import { addDaysFrom, today } from '@/lib/dates';
import { money2 } from '@/lib/money';
import { byId } from '@/domain/selectors';
import './invoices.css';

interface Line { text: string; qty: number; unitCents: number }
export interface Invoice {
  id: string; number: string; jobId: string; clientId: string | null; status: 'draft' | 'sent' | 'paid' | 'void';
  issueDate: string; dueDate: string; lang: 'en' | 'es'; lines: Line[]; feePct: number; subtotalCents: number; feeCents: number; totalCents: number; paidCents: number;
  notes: string; sendTo: string | null; sentAt: string | null; reminders: number; lastReminder: string | null; paidAt: string | null; voidReason: string | null;
  hasPayLink: boolean; createdAt: string; project: string | null; client: string | null; overdue: boolean;
}
type Filter = 'all' | 'draft' | 'sent' | 'overdue' | 'paid' | 'void';
const FEE = 2.9;
const usd = (c: number) => money2(c / 100);
const shown = (i: Invoice): 'draft' | 'sent' | 'overdue' | 'paid' | 'partial' | 'void' =>
  i.status === 'sent' ? (i.overdue ? 'overdue' : i.paidCents > 0 ? 'partial' : 'sent') : i.status;
const TONE: Record<ReturnType<typeof shown>, Tone> = { draft: 'neutral', sent: 'info', overdue: 'bad', paid: 'ok', partial: 'warn', void: 'neutral' };

async function call<T>(name: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try { const a = await rpc<T>(name, args); return a.ok ? { ok: true, data: a.data.result } : { ok: false, reason: a.code || 'generic' }; } catch { return { ok: false, reason: 'generic' }; }
}

export default function InvoicesPage(_: PageProps) {
  const { t, can } = useApp();
  const [list, setList] = useState<Invoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Partial<Invoice> | null>(null);
  const online = session()?.planId === INTERNAL_PLAN;
  const load = useCallback(async () => { const r = await call<Invoice[]>('invoice_list', {}); if (r.ok) setList(r.data); setFailed(!r.ok); }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(id); }, [load]);

  const month = today().slice(0, 7);
  const stats = useMemo(() => {
    const l = list ?? [];
    const open = l.filter((i) => i.status === 'sent');
    return {
      open: open.reduce((n, i) => n + i.totalCents - i.paidCents, 0),
      overdue: open.filter((i) => i.overdue).reduce((n, i) => n + i.totalCents - i.paidCents, 0),
      paid: l.filter((i) => i.paidAt?.slice(0, 7) === month).reduce((n, i) => n + i.paidCents, 0),
    };
  }, [list, month]);
  const rows = (list ?? []).filter((i) => filter === 'all' || (filter === 'overdue' ? shown(i) === 'overdue' : filter === 'sent' ? i.status === 'sent' : i.status === filter));
  const count = (f: Filter) => (list ?? []).filter((i) => (f === 'overdue' ? shown(i) === 'overdue' : f === 'sent' ? i.status === 'sent' : i.status === f)).length;

  return (
    <div className="page invoices" data-testid="invoices">
      <PageHeader title={t('nav.invoices')} sub={t(online ? 'inv.sub' : 'inv.subOffline')}
        actions={can('money') && can('write') ? <Button variant="primary" icon={<LuPlus />} onClick={() => setEditing({})} data-testid="inv-new">{t('inv.new')}</Button> : undefined} />
      {failed && <Note tone="bad">{t('inv.error')}</Note>}
      <div className="kpis">
        <Stat label={t('inv.stat.open')} value={usd(stats.open)} onClick={() => setFilter('sent')} />
        <Stat label={t('inv.stat.overdue')} value={usd(stats.overdue)} attention={stats.overdue > 0} onClick={() => setFilter('overdue')} />
        <Stat label={t('inv.stat.paid')} value={usd(stats.paid)} onClick={() => setFilter('paid')} />
      </div>
      <Card>
        <div className="row wrap inv-bar">
          <Seg value={filter} onChange={setFilter} label={t('nav.invoices')}
            options={(['all', 'draft', 'sent', 'overdue', 'paid', 'void'] as Filter[]).map((f) => ({ value: f, label: t('inv.f.' + f), count: f === 'all' || !count(f) ? undefined : count(f) }))} />
        </div>
        {!list ? <p className="muted">{t('inv.loading')}</p> : !rows.length ? <Empty title={t('inv.none')}>{t('inv.noneHint')}</Empty> : (
          <div className="list inv-list">
            {rows.map((i) => <Row key={i.id} inv={i} reload={load} onEdit={(x) => setEditing(x)} online={online} />)}
          </div>
        )}
        <p className="xs dim inv-auto">{t('inv.auto')}</p>
      </Card>
      {editing && <InvoiceForm draft={editing} online={online} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await load(); }} />}
    </div>
  );
}

const reasonText = (t: (k: string, p?: Record<string, string | number>) => string, r: string) => { const k = 'inv.reason.' + r; const s = t(k); return s === k ? t('inv.reason.generic') : s; };

function Row({ inv, reload, onEdit, online }: { inv: Invoice; reload: () => Promise<void>; onEdit: (x: Partial<Invoice>) => void; online: boolean }) {
  const { t, date, dateTime, can } = useApp();
  const [busy, setBusy] = useState(false);
  const st = shown(inv);
  const write = can('money') && can('write');
  const send = async () => {
    const to = inv.sendTo ?? '';
    if (!(await confirmDialog(t(inv.status === 'sent' ? 'inv.confirm.remind' : 'inv.confirm.send', { n: inv.number, total: usd(inv.totalCents - inv.paidCents), to: to || '·' }), t(inv.status === 'sent' ? 'inv.act.remind' : 'inv.act.send'), t('inv.form.cancel'), false))) return;
    setBusy(true); const r = await call<{ to: string; online: boolean }>('invoice_send', { p_id: inv.id }); setBusy(false);
    if (r.ok) toast(t(inv.status === 'sent' ? 'inv.ok.reminded' : r.data.online ? 'inv.ok.sentOnline' : 'inv.ok.sent', { to: r.data.to })); else toast(reasonText(t, r.reason), true);
    await reload();
  };
  const del = async () => { if (!(await confirmDialog(t('inv.confirm.delete', { n: inv.number }), t('inv.act.delete'), t('inv.form.cancel')))) return; const r = await call<boolean>('invoice_discard', { p_id: inv.id }); toast(r.ok ? t('inv.ok.deleted') : reasonText(t, r.reason), !r.ok); await reload(); };
  const voidIt = async () => { if (!(await confirmDialog(t('inv.confirm.void', { n: inv.number }), t('inv.act.void'), t('inv.form.cancel')))) return; const r = await call<boolean>('invoice_void', { p_id: inv.id, p_reason: '' }); toast(r.ok && r.data ? t('inv.ok.voided') : reasonText(t, r.ok ? 'generic' : r.reason), !(r.ok && r.data)); await reload(); };
  const copy = () => onEdit({ jobId: inv.jobId, lines: inv.lines, feePct: inv.feePct, lang: inv.lang, notes: inv.notes, sendTo: inv.sendTo });
  return (
    <div className="item inv-row" data-invoice={inv.number}>
      <span className="inv-ic" aria-hidden="true"><LuFileText /></span>
      <div className="grow">
        <div className="row tight wrap"><b>{inv.number}</b><Badge tone={TONE[st]}>{t('inv.s.' + st)}</Badge>{inv.hasPayLink && online && inv.status === 'sent' && <Badge outline>{t('inv.meta.online')}</Badge>}</div>
        <div className="small muted">{inv.client ?? '·'}{inv.project ? <> · <A to={'/jobs/' + inv.jobId}>{inv.project}</A></> : null}</div>
        <div className="xs dim">
          {t('inv.col.due')} {date(inv.dueDate)}
          {inv.sentAt && <> · {t('inv.meta.sent', { when: dateTime(inv.sentAt), to: inv.sendTo ?? '' })}</>}
          {inv.reminders > 0 && <> · {t('inv.meta.reminders', { n: inv.reminders })}</>}
          {inv.paidAt && <> · {t('inv.meta.paid', { when: dateTime(inv.paidAt) })}</>}
        </div>
      </div>
      <div className="inv-amt">
        <div className="t">{usd(inv.totalCents)}</div>
        {inv.status === 'sent' && inv.paidCents > 0 && <div className="xs dim">{t('inv.col.balance')} {usd(inv.totalCents - inv.paidCents)}</div>}
      </div>
      {write && (
        <div className="row tight inv-acts">
          {inv.status === 'draft' && <><Button size="sm" variant="primary" icon={<LuSend />} disabled={busy} onClick={() => void send()} data-testid="inv-send">{t('inv.act.send')}</Button>
            <Button size="sm" variant="ghost" icon={<LuPencil />} onClick={() => onEdit(inv)}>{t('inv.act.edit')}</Button>
            <Button size="sm" variant="ghost" icon={<LuTrash2 />} onClick={() => void del()} aria-label={t('inv.act.delete')} /></>}
          {inv.status === 'sent' && <><Button size="sm" variant="ghost" icon={<LuBell />} disabled={busy} onClick={() => void send()} data-testid="inv-remind">{t('inv.act.remind')}</Button>
            {inv.paidCents === 0 && <Button size="sm" variant="ghost" icon={<LuX />} onClick={() => void voidIt()}>{t('inv.act.void')}</Button>}</>}
          <Button size="sm" variant="ghost" icon={<LuCopy />} onClick={copy} aria-label={t('inv.act.copy')} />
        </div>
      )}
    </div>
  );
}

function InvoiceForm({ draft, online, onClose, onDone }: { draft: Partial<Invoice>; online: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { t, data, lang } = useApp();
  const jobs = useMemo(() => [...data.jobs].filter((j) => j.status !== 'estimate' || j.id === draft.jobId).sort((a, b) => a.name.localeCompare(b.name)), [data.jobs, draft.jobId]);
  const [jobId, setJobId] = useState(draft.jobId ?? '');
  const job = byId(data.jobs, jobId);
  const client = job ? byId(data.clients, job.clientId) : undefined;
  const [issue, setIssue] = useState(draft.issueDate ?? today());
  const [terms, setTerms] = useState<number>(draft.dueDate && draft.issueDate ? Math.max(0, Math.round((Date.parse(draft.dueDate) - Date.parse(draft.issueDate)) / 86_400_000)) : 15);
  const [ilang, setIlang] = useState<'en' | 'es'>(draft.lang ?? (client?.lang === 'es' ? 'es' : (lang === 'es' ? 'es' : 'en')));
  const [to, setTo] = useState(draft.sendTo ?? '');
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [fee, setFee] = useState((draft.feePct ?? 0) > 0);
  const [lines, setLines] = useState<{ text: string; qty: string; price: string }[]>(
    (draft.lines ?? []).map((l) => ({ text: l.text, qty: String(l.qty), price: (l.unitCents / 100).toFixed(2) })));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  // a project picked: its client's email, and its balance as the first line of a new invoice
  useEffect(() => {
    if (!job) return;
    if (!draft.sendTo && client?.email) setTo(client.email);
    if (!draft.lang && client?.lang) setIlang(client.lang === 'es' ? 'es' : 'en');
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromProject = () => {
    if (!job) return;
    const paid = (job.received ?? []).reduce((n, p) => n + Number(p.amount || 0), 0);
    const balance = Math.max(0, Number(job.price || 0) - paid);
    if (balance > 0) setLines((l) => [...l.filter((x) => x.text || x.price), { text: t('inv.form.balanceLine', { name: job.name }), qty: '1', price: balance.toFixed(2) }]);
  };
  const services = useMemo(() => data.catalog.filter((s) => s.active).flatMap((s) => s.tiers.filter((x) => x.price > 0).map((x) => ({ id: s.id + ':' + x.id, label: `${s.name}${s.tiers.length > 1 ? ' · ' + x.name : ''}`, price: x.price }))), [data.catalog]);
  const parsed = lines.map((l) => ({ text: l.text.trim(), qty: Number(l.qty), unitCents: Math.round(Number(l.price) * 100) }));
  const valid = parsed.length > 0 && parsed.every((l) => l.text && l.qty > 0 && Number.isFinite(l.unitCents) && l.unitCents >= 0);
  const subtotal = parsed.reduce((n, l) => n + (Number.isFinite(l.qty * l.unitCents) ? Math.round(l.qty * l.unitCents) : 0), 0);
  const feeCents = fee ? Math.round(subtotal * FEE / 100) : 0;
  const due = addDaysFrom(issue, terms);

  const save = async (andSend: boolean) => {
    setErr('');
    if (!job) return setErr(t('inv.err.project'));
    if (!valid) return setErr(t('inv.err.lines'));
    if (subtotal + feeCents <= 0) return setErr(t('inv.err.total'));
    if (andSend && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) return setErr(t('inv.err.email'));
    setBusy(true);
    const r = await call<Invoice>('invoice_save', { p_invoice: { ...(draft.id ? { id: draft.id } : {}), jobId, issueDate: issue, dueDate: due, lang: ilang, lines: parsed, feePct: fee ? FEE : 0, notes, sendTo: to.trim() } });
    if (!r.ok) { setBusy(false); return setErr(reasonText(t, r.reason)); }
    if (andSend) {
      const s = await call<{ to: string; online: boolean }>('invoice_send', { p_id: r.data.id });
      setBusy(false);
      if (!s.ok) { toast(reasonText(t, s.reason), true); await onDone(); return; }
      toast(t(s.data.online ? 'inv.ok.sentOnline' : 'inv.ok.sent', { to: s.data.to }));
    } else { setBusy(false); toast(t('inv.ok.saved')); }
    await onDone();
  };

  return (
    <Modal title={draft.number ?? t('inv.new')} onClose={onClose} size="wide" labelClose={t('common.close')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('inv.form.cancel')}</Button>
        <Button disabled={busy} onClick={() => void save(false)}>{t('inv.form.saveDraft')}</Button>
        <Button variant="primary" icon={<LuSend />} disabled={busy} onClick={() => void save(true)} data-testid="inv-save-send">{t('inv.form.send')}</Button></>}>
      <div className="grid2">
        <Field label={t('inv.form.project')} htmlFor="inv-job">
          <select id="inv-job" className="input" value={jobId} onChange={(e) => setJobId(e.target.value)} data-testid="inv-job">
            <option value="">{t('inv.form.pick')}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}{byId(data.clients, j.clientId) ? ' · ' + byId(data.clients, j.clientId)!.name : ''}</option>)}
          </select>
        </Field>
        <Field label={t('inv.form.to')} htmlFor="inv-to"><input id="inv-to" className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} maxLength={254} data-testid="inv-to" /></Field>
        <Field label={t('inv.form.issue')} htmlFor="inv-issue"><input id="inv-issue" className="input" type="date" value={issue} onChange={(e) => setIssue(e.target.value || today())} /></Field>
        <Field label={t('inv.form.terms')} htmlFor="inv-terms" hint={`${t('inv.form.due')}: ${due}`}>
          <select id="inv-terms" className="input" value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
            {[0, 7, 15, 30, 45].map((n) => <option key={n} value={n}>{n === 0 ? t('inv.form.onReceipt') : t('inv.form.net', { n })}</option>)}
          </select>
        </Field>
      </div>
      <div className="row tight wrap inv-lines-head">
        <h3 className="inv-h">{t('inv.form.lines')}</h3>
        <span className="grow" />
        {job && <Button size="sm" variant="ghost" onClick={fromProject}>{t('inv.form.fromProject')}</Button>}
        {services.length > 0 && (
          <select className="input inv-cat" aria-label={t('inv.form.fromCatalog')} value="" onChange={(e) => { const s = services.find((x) => x.id === e.target.value); if (s) setLines((l) => [...l, { text: s.label, qty: '1', price: s.price.toFixed(2) }]); }}>
            <option value="">{t('inv.form.fromCatalog')}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.label} · {money2(s.price)}</option>)}
          </select>
        )}
      </div>
      <div className="inv-lines">
        <div className="inv-line head xs dim"><span>{t('inv.form.text')}</span><span>{t('inv.form.qty')}</span><span>{t('inv.form.price')}</span><span>{t('inv.form.amount')}</span><span /></div>
        {lines.map((l, i) => (
          <div className="inv-line" key={i}>
            <input className="input" aria-label={t('inv.form.text')} value={l.text} maxLength={300} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} data-testid="inv-line-text" />
            <input className="input" aria-label={t('inv.form.qty')} inputMode="decimal" value={l.qty} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
            <input className="input" aria-label={t('inv.form.price')} inputMode="decimal" value={l.price} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))} data-testid="inv-line-price" />
            <span className="inv-num">{usd(Math.round((Number(l.qty) || 0) * (Number(l.price) || 0) * 100))}</span>
            <Button size="sm" variant="ghost" icon={<LuTrash2 />} aria-label={t('inv.form.remove')} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<LuPlus />} onClick={() => setLines((l) => [...l, { text: '', qty: '1', price: '' }])} data-testid="inv-add-line">{t('inv.form.addLine')}</Button>
      </div>
      <label className="row tight inv-fee"><input type="checkbox" checked={fee} onChange={(e) => setFee(e.target.checked)} /> {t('inv.form.fee')}</label>
      <div className="inv-totals">
        <div><span>{t('inv.form.subtotal')}</span><b>{usd(subtotal)}</b></div>
        {fee && <div><span>{t('inv.form.feeLine', { pct: FEE })}</span><b>{usd(feeCents)}</b></div>}
        <div className="total"><span>{t('inv.form.total')}</span><b data-testid="inv-total">{usd(subtotal + feeCents)}</b></div>
      </div>
      <div className="grid2">
        <Field label={t('inv.form.lang')} htmlFor="inv-lang"><Seg value={ilang} onChange={setIlang} label={t('inv.form.lang')} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }]} /></Field>
        <Field label={t('inv.form.notes')} htmlFor="inv-notes"><textarea id="inv-notes" className="input" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {!online && <p className="xs dim">{t('inv.subOffline')}</p>}
      {err && <Note tone="bad">{err}</Note>}
    </Modal>
  );
}
