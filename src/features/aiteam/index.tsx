// AI employees: VYNTEX USA's Grok bots inside the company's own workspace (supabase/migrations/0084_ai_employees.sql).
//   Approvals    what the bots ask a person to decide, with What / Why / Risk if we do / Risk if we don't / Recommendation /
//                Deadline. An owner or a manager decides. "Approve and send" sends a bot's draft from here, through the same
//                consent and opt-out checks as the Messages screen; anything else is carried out by the person, then marked done
//   AI employees each bot, its access per section (none, view, edit), its key (created here, shown once), pause and revoke
//   Activity     every call each bot made, refused ones too
//   Connection   what to give a bot's server: the MCP address, the plain address and the header
// Only in the VYNTEX USA workspace (plan internal), signed in, for people who manage access (owner, manager).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuBot, LuCheck, LuCopy, LuKeyRound, LuMessagesSquare, LuPause, LuPencil, LuPlay, LuPlus, LuSend, LuX } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Badge, Button, Card, Empty, Field, Modal, Note, PageHeader, Seg, Tabs, confirmDialog, toast, type Tone } from '@/ui';
import { botApi, SECTIONS, type Access, type Activity, type Approval, type Bot, type Level, type Section } from './api';
import { MAX_LOGO_BYTES, readLogo } from '@/features/settings/helpers';
import { storeImage, useStoredImage } from '@/features/settings/image';
import './aiteam.css';

type Tab = 'approvals' | 'team' | 'activity' | 'connect';
const LEVELS: Level[] = ['none', 'view', 'edit'];
const LEVEL_TONE: Record<Level, Tone> = { none: 'neutral', view: 'info', edit: 'accent' };
const STATUS_TONE: Record<Approval['status'], Tone> = { pending: 'warn', approved: 'info', rejected: 'bad', done: 'ok', cancelled: 'neutral' };
const RECORD_PATH: Record<string, string> = { lead: '/leads/', client: '/clients/', job: '/jobs/', message: '/messages/', task: '/tasks/' };
const slugOf = (name: string) => name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'bot';

export default function AiTeamPage(_: PageProps) {
  const { t, user } = useApp();
  const owner = user?.role === 'owner';
  const [tab, setTab] = useState<Tab>('approvals');
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [b, a] = await Promise.all([botApi.list(), botApi.approvals()]);
    if (b.ok) setBots(b.data); if (a.ok) setApprovals(a.data);
    setFailed(!b.ok || !a.ok);
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(id); }, [load]);

  const pending = (approvals ?? []).filter((x) => x.status === 'pending');
  return (
    <div className="page aiteam" data-testid="aiteam">
      <PageHeader title={<><LuBot aria-hidden="true" /> {t('nav.aiteam')}</>} sub={t('ai.sub')} />
      <Note>{t('ai.rule')}</Note>
      {failed && <Note tone="bad">{t('ai.error')}</Note>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'approvals', label: t('ai.tab.approvals'), count: pending.length },
        { id: 'team', label: t('ai.tab.team'), count: bots?.length },
        { id: 'activity', label: t('ai.tab.activity') },
        { id: 'connect', label: t('ai.tab.connect') },
      ]} />
      {tab === 'approvals' && <Approvals list={approvals} reload={load} />}
      {tab === 'team' && <Team bots={bots} owner={owner} reload={load} />}
      {tab === 'activity' && <ActivityLog bots={bots ?? []} />}
      {tab === 'connect' && <Connect />}
    </div>
  );
}

const reasonText = (t: (k: string, p?: Record<string, string | number>) => string, reason: string) => {
  const k = 'ai.reason.' + reason;
  const s = t(k);
  return s === k ? t('ai.reason.generic') : s;
};

// ---------------------------------------------------------------------------------------------------------------------
function Approvals({ list, reload }: { list: Approval[] | null; reload: () => Promise<void> }) {
  const { t, data, date, dateTime } = useApp();
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!list) return <Card><p className="muted">{t('ai.loading')}</p></Card>;
  const pending = list.filter((x) => x.status === 'pending');
  const toDo = list.filter((x) => x.status === 'approved');
  const decided = list.filter((x) => x.status !== 'pending' && x.status !== 'approved').slice(0, 15);
  const draftOf = (a: Approval) => (a.kind === 'message.send' && a.target.type === 'message' ? data.messages.find((m) => m.id === a.target.id && m.status === 'draft') : undefined);

  const decide = async (a: Approval, decision: 'approved' | 'rejected') => {
    setBusy(a.id);
    // approving a bot's draft queues it on the server, in the approver's name; delivery checks consent and opt-outs again
    const r = await botApi.decide(a.id, decision, notes[a.id]?.trim() || undefined);
    setBusy('');
    if (!r.ok) toast(reasonText(t, r.reason), true);
    else if (!r.data.decided) toast(t('ai.ap.gone'), true);
    else toast(t(decision === 'rejected' ? 'ai.ap.rejected' : r.data.queued ? 'ai.ap.sent' : draftOf(a) ? 'ai.ap.sendFailed' : 'ai.ap.approvedTodo'), decision === 'approved' && !r.data.queued && !!draftOf(a));
    await reload();
  };
  const markDone = async (a: Approval) => { setBusy(a.id); const r = await botApi.done(a.id); setBusy(''); toast(r.ok ? t('ai.ap.doneOk') : reasonText(t, r.reason), !r.ok); await reload(); };
  const link = (a: Approval) => (a.target.type && a.target.id && RECORD_PATH[a.target.type] ? <A to={RECORD_PATH[a.target.type] + a.target.id}>{t('ai.ap.open')}</A> : null);

  const Row = ({ a, open }: { a: Approval; open: boolean }) => (
    <div className={'item ai-ap' + (open ? ' open' : '')} data-approval={a.id}>
      <div className="grow">
        <div className="row tight wrap">
          <Badge tone={a.level === 3 ? 'bad' : 'warn'}>{t('ai.ap.level', { n: a.level })}</Badge>
          <Badge tone="violet">{t('ai.kind.' + a.kind)}</Badge>
          {a.bot && <span className="small muted">{t('ai.ap.from', { bot: a.bot })}{a.botTitle ? ` · ${a.botTitle}` : ''}</span>}
          {!open && <Badge tone={STATUS_TONE[a.status]}>{t('ai.ap.status.' + a.status)}</Badge>}
          <span className="xs dim">{dateTime(a.created_at)}</span>
        </div>
        <div className="ai-what">{a.what}</div>
        {open && (
          <dl className="ai-facts">
            {a.why && <><dt>{t('ai.ap.why')}</dt><dd>{a.why}</dd></>}
            {a.riskDo && <><dt>{t('ai.ap.riskDo')}</dt><dd>{a.riskDo}</dd></>}
            {a.riskDont && <><dt>{t('ai.ap.riskDont')}</dt><dd>{a.riskDont}</dd></>}
            {a.recommendation && <><dt>{t('ai.ap.rec')}</dt><dd>{a.recommendation}</dd></>}
            {a.deadline && <><dt>{t('ai.ap.deadline')}</dt><dd>{date(a.deadline)}</dd></>}
          </dl>
        )}
        {draftOf(a) && open && (
          <div className="ai-draft"><div className="small"><b>{draftOf(a)!.to}</b>{draftOf(a)!.subject ? ` · ${draftOf(a)!.subject}` : ''}</div><div className="small muted pre">{draftOf(a)!.body}</div></div>
        )}
        {a.decidedBy && <div className="xs dim">{t('ai.ap.by', { name: a.decidedBy, when: dateTime(a.decidedAt ?? undefined) })}{a.note ? ` · ${a.note}` : ''}</div>}
        {a.status === 'pending' && (
          <div className="ai-decide">
            <input className="input" aria-label={t('ai.ap.note')} placeholder={t('ai.ap.note')} maxLength={1000} value={notes[a.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} />
            <div className="row tight">
              <Button variant="primary" icon={draftOf(a) ? <LuSend /> : <LuCheck />} disabled={busy === a.id} onClick={() => void decide(a, 'approved')} data-testid="ai-approve">{t(draftOf(a) ? 'ai.ap.approveSend' : 'ai.ap.approve')}</Button>
              <Button variant="ghost" icon={<LuX />} disabled={busy === a.id} onClick={() => void decide(a, 'rejected')} data-testid="ai-reject">{t('ai.ap.reject')}</Button>
              {link(a)}
            </div>
          </div>
        )}
        {a.status === 'approved' && (
          <div className="row tight"><Button size="sm" icon={<LuCheck />} disabled={busy === a.id} onClick={() => void markDone(a)}>{t('ai.ap.markDone')}</Button>{link(a)}</div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Card title={<>{t('ai.tab.approvals')}{pending.length > 0 && <span className="count">{pending.length}</span>}</>}>
        {!pending.length ? <Empty title={t('ai.ap.none')} /> : <div className="list">{pending.map((a) => <Row key={a.id} a={a} open />)}</div>}
      </Card>
      {toDo.length > 0 && <Card title={t('ai.ap.status.approved')}><div className="list">{toDo.map((a) => <Row key={a.id} a={a} open={false} />)}</div></Card>}
      {decided.length > 0 && <Card title={t('ai.ap.decided')}><div className="list">{decided.map((a) => <Row key={a.id} a={a} open={false} />)}</div></Card>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
function Team({ bots, owner, reload }: { bots: Bot[] | null; owner: boolean; reload: () => Promise<void> }) {
  const { t, dateTime } = useApp();
  const [editing, setEditing] = useState<Partial<Bot> | null>(null);
  const [shown, setShown] = useState<{ name: string; secret: string } | null>(null);
  const [hook, setHook] = useState<Bot | null>(null);
  const [busy, setBusy] = useState('');
  if (!bots) return <Card><p className="muted">{t('ai.loading')}</p></Card>;

  const run = async <T,>(id: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; reason: string }>, okText?: string) => {
    setBusy(id); const r = await fn(); setBusy('');
    if (!r.ok) toast(reasonText(t, r.reason), true); else if (okText) toast(okText);
    await reload(); return r;
  };
  const issue = async (b: Bot) => {
    if (b.hasKey && !(await confirmDialog(t('ai.bot.replaceConfirm', { name: b.name }), t('ai.bot.replace'), t('ai.form.cancel')))) return;
    const r = await run(b.id, () => botApi.issueKey(b.id));
    if (r.ok) setShown({ name: b.name, secret: r.data.key });
  };
  const revoke = async (b: Bot) => {
    if (!(await confirmDialog(t('ai.bot.revokeConfirm', { name: b.name }), t('ai.bot.revoke'), t('ai.form.cancel')))) return;
    await run(b.id, () => botApi.revokeKey(b.id), t('ai.bot.revoked'));
  };
  const toggle = async (b: Bot) => {
    const next = b.status === 'active' ? 'paused' : 'active';
    if (next === 'paused' && !(await confirmDialog(t('ai.bot.pauseConfirm', { name: b.name }), t('ai.bot.pause'), t('ai.form.cancel')))) return;
    await run(b.id, () => botApi.setStatus(b.id, next), t(next === 'paused' ? 'ai.bot.paused' : 'ai.bot.resumed', { name: b.name }));
  };

  return (
    <>
      <Card title={t('ai.tab.team')} actions={owner ? <Button size="sm" icon={<LuPlus />} onClick={() => setEditing({ access: {} })}>{t('ai.bot.add')}</Button> : undefined}>
        <p className="xs dim">{t('ai.never')}</p>
        {!bots.length ? <Empty title={t('ai.bot.none')} /> : (
          <div className="ai-bots">
            {bots.map((b) => (
              <section className={'ai-bot' + (b.status === 'paused' ? ' paused' : '')} key={b.id} data-bot={b.slug}>
                <header className="row tight wrap">
                  <BotPhoto bot={b} onDone={reload} />
                  <div className="grow"><div className="t">{b.name}</div><div className="small muted">{b.title}</div></div>
                  <Badge tone={b.status === 'active' ? 'ok' : 'warn'}>{t('ai.bot.status.' + b.status)}</Badge>
                  {b.pending > 0 && <Badge tone="warn">{t('ai.bot.pending', { n: b.pending })}</Badge>}
                </header>
                <div className="ai-access" role="list">
                  {SECTIONS.map((s) => { const lv = b.access[s] ?? 'none'; return (
                    <span role="listitem" key={s} className={'ai-chip lv-' + lv}><span>{t('ai.sec.' + s)}</span><Badge tone={LEVEL_TONE[lv]} outline={lv === 'none'}>{t('ai.lv.' + lv)}</Badge></span>
                  ); })}
                </div>
                <div className="xs dim row tight wrap">
                  <LuKeyRound aria-hidden="true" />
                  <span>{b.hasKey ? t('ai.bot.keyHint', { hint: b.keyHint ?? '' }) : t('ai.bot.noKey')}</span>
                  <span>·</span>
                  <span>{b.lastUsedAt ? t('ai.bot.lastUsed', { when: dateTime(b.lastUsedAt) }) : t('ai.bot.never')}</span>
                  <span>·</span>
                  <LuMessagesSquare aria-hidden="true" />
                  <span>{b.webhookUrl ? t('ai.hook.on', { hint: b.webhookHint ?? '' }) + (b.webhookAuth ? ' · ' + t('ai.hook.authOn') : '') : t('ai.hook.off')}</span>
                </div>
                {b.webhookUrl && <PushStatus bot={b} onDone={reload} />}
                <div className="row tight wrap">
                  <Button size="sm" variant="ghost" icon={b.status === 'active' ? <LuPause /> : <LuPlay />} disabled={busy === b.id} onClick={() => void toggle(b)}>{t(b.status === 'active' ? 'ai.bot.pause' : 'ai.bot.resume')}</Button>
                  {owner && <Button size="sm" variant="ghost" icon={<LuKeyRound />} disabled={busy === b.id} onClick={() => void issue(b)} data-testid="ai-issue">{t(b.hasKey ? 'ai.bot.replace' : 'ai.bot.issue')}</Button>}
                  {b.hasKey && <Button size="sm" variant="ghost" icon={<LuX />} disabled={busy === b.id} onClick={() => void revoke(b)}>{t('ai.bot.revoke')}</Button>}
                  {owner && <Button size="sm" variant="ghost" icon={<LuMessagesSquare />} onClick={() => setHook(b)} data-testid="ai-hook">{t('ai.hook.set')}</Button>}
                  {owner && <Button size="sm" variant="ghost" icon={<LuPencil />} onClick={() => setEditing(b)}>{t('ai.bot.edit')}</Button>}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>
      {editing && <BotForm bot={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); toast(t('ai.bot.saved')); await reload(); }} />}
      {shown && <KeyShown name={shown.name} secret={shown.secret} onClose={() => setShown(null)} />}
      {hook && <HookForm bot={hook} onClose={() => setHook(null)} onDone={async (secret) => { const name = hook.name; setHook(null); await reload(); if (secret) setShown({ name: name + ' · ' + t('ai.hook.title'), secret }); else toast(t('ai.hook.cleared')); }} />}
    </>
  );
}

function BotForm({ bot, onClose, onSaved }: { bot: Partial<Bot>; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useApp();
  const [f, setF] = useState({ name: bot.name ?? '', title: bot.title ?? '', department: bot.department ?? '', reportsTo: bot.reportsTo ?? '', mission: bot.mission ?? '' });
  const [access, setAccess] = useState<Access>({ ...(bot.access ?? {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!f.name.trim()) { setErr(t('ai.form.required')); return; }
    setBusy(true);
    const full = Object.fromEntries(SECTIONS.map((s) => [s, access[s] ?? 'none'])) as Access;
    const r = await botApi.save({ ...(bot.id ? { id: bot.id } : { slug: slugOf(f.name) }), ...f, name: f.name.trim(), access: full });
    setBusy(false);
    if (!r.ok) { setErr(reasonText(t, r.reason)); return; }
    await onSaved();
  };
  const text = (k: keyof typeof f, max: number) => (
    <Field label={t('ai.form.' + k)} htmlFor={'ai-f-' + k}><input id={'ai-f-' + k} className="input" maxLength={max} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></Field>
  );
  return (
    <Modal title={bot.id ? bot.name : t('ai.bot.add')} onClose={onClose} size="wide" labelClose={t('ai.form.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('ai.form.cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{t('ai.form.save')}</Button></>}>
      <div className="grid2">{text('name', 60)}{text('title', 120)}{text('department', 120)}{text('reportsTo', 120)}</div>
      {text('mission', 400)}
      <h3 className="ai-h">{t('ai.form.access')}</h3>
      <div className="ai-grid">
        {SECTIONS.map((s: Section) => (
          <div className="ai-grid-row" key={s}>
            <span>{t('ai.sec.' + s)}</span>
            <Seg value={access[s] ?? 'none'} onChange={(v) => setAccess((a) => ({ ...a, [s]: v }))} label={t('ai.sec.' + s)} options={LEVELS.map((l) => ({ value: l, label: t('ai.lv.' + l) }))} />
          </div>
        ))}
      </div>
      <p className="xs dim">{t('ai.never')}</p>
      {err && <Note tone="bad">{err}</Note>}
    </Modal>
  );
}

/** 0093: the last push to this bot's webhook, and a test push that shows the answer it gets. */
function PushStatus({ bot, onDone }: { bot: Bot; onDone: () => Promise<void> | void }) {
  const { t, dateTime } = useApp();
  const [busy, setBusy] = useState(false);
  const d = bot.lastDelivery;
  const good = !!d && d.status !== null && d.status >= 200 && d.status < 300;
  const test = async () => {
    setBusy(true); const r = await botApi.testPush(bot.id); setBusy(false);
    if (!r.ok) { toast(t('ai.reason.generic'), true); return; }
    const x = r.data;
    toast(x.ok ? t('ai.push.testOk', { name: bot.name, code: x.status ?? '' }) : t('ai.push.testBad', { name: bot.name, code: x.status ?? '-', error: x.error ?? '' }), !x.ok);
    await onDone();
  };
  return (
    <div className="xs row tight wrap ai-push" data-testid="ai-push">
      {d ? <Badge tone={good ? 'ok' : 'bad'}>{d.status ?? '-'}</Badge> : <Badge tone="neutral">{t('ai.push.none')}</Badge>}
      {d && <span className="dim">{t(d.kind === 'test' ? 'ai.push.lastTest' : 'ai.push.last', { when: dateTime(d.at), n: d.attempts })}{!good && d.error ? ': ' + d.error : ''}</span>}
      <Button size="sm" variant="ghost" icon={<LuSend />} disabled={busy} onClick={() => void test()} data-testid="ai-push-test">{t('ai.push.test')}</Button>
    </div>
  );
}

/** 0094: an AI employee's photo; any team member may change it (the bot can also set its own with profile_photo_set). */
function BotPhoto({ bot, onDone }: { bot: Bot; onDone: () => Promise<void> | void }) {
  const { t } = useApp();
  const src = useStoredImage(bot.photo || undefined);
  const [busy, setBusy] = useState(false);
  const change = async (file: File) => {
    let pic: string;
    try { pic = await readLogo(file); } catch { toast(t('ai.photo.bad', { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) }), true); return; }
    setBusy(true);
    const path = await storeImage(pic, true, 'profiles');
    const r = path ? await botApi.setPhoto(bot.id, path) : null;
    setBusy(false);
    if (!r || !r.ok) { toast(t('ai.photo.failed'), true); return; }
    toast(t('ai.photo.saved', { name: bot.name })); await onDone();
  };
  return (
    <label className={'ai-avatar ai-photo-edit' + (src ? ' pic' : '') + (busy ? ' busy' : '')} title={t('ai.photo.change', { name: bot.name })}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{bot.name.slice(0, 1)}</span>}
      <span className="sr-only">{t('ai.photo.change', { name: bot.name })}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} data-testid="ai-photo" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void change(f); }} />
    </label>
  );
}

function HookForm({ bot, onClose, onDone }: { bot: Bot; onClose: () => void; onDone: (secret: string | null) => Promise<void> }) {
  const { t } = useApp();
  const [url, setUrl] = useState(bot.webhookUrl ?? '');
  // 0091: the Authorization header the bot's routine expects. Empty: the saved one stays (or none if none was saved)
  const [auth, setAuth] = useState(''); const [dropAuth, setDropAuth] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    if (value && !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/\S*)?$/.test(value)) { setErr(t('ai.hook.bad')); return; }
    const a = auth.trim();
    if (a && (a.length > 2000 || /[^\x20-\x7e]/.test(a))) { setErr(t('ai.hook.authBad')); return; }
    setBusy(true); const r = await botApi.setWebhook(bot.id, value, a ? a : dropAuth ? '' : undefined); setBusy(false);
    if (!r.ok) { setErr(t('ai.reason.generic')); return; }
    await onDone(r.data.secret);
  };
  return (
    <Modal title={t('ai.hook.title') + ': ' + bot.name} onClose={onClose} labelClose={t('common.close')}
      footer={<>{bot.webhookUrl && <Button variant="ghost" disabled={busy} onClick={() => void save('')}>{t('ai.hook.clear')}</Button>}
        <Button variant="primary" disabled={busy || !url.trim()} onClick={() => void save(url.trim())} data-testid="ai-hook-save">{t('ai.form.save')}</Button></>}>
      <p className="small">{t('ai.hook.lead', { name: bot.name })}</p>
      <Field label={t('ai.hook.url')} htmlFor="ai-hook-url" hint={t('ai.hook.hint')}><input id="ai-hook-url" name="vx-bot-webhook-url" className="input" type="url" inputMode="url" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" spellCheck={false} placeholder="https://" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} data-testid="ai-hook-url" /></Field>
      <Field label={t('ai.hook.auth')} htmlFor="ai-hook-auth" hint={bot.webhookAuth ? t('ai.hook.authSaved', { hint: bot.webhookAuthHint ?? '' }) : t('ai.hook.authHint')}>
        <input id="ai-hook-auth" name="vx-bot-webhook-authorization" className="input ai-secret" type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" data-1p-ignore data-lpignore="true" data-form-type="other" spellCheck={false} placeholder={bot.webhookAuth ? '••••••••' : 'Bearer …'} value={auth} maxLength={2000}
          onChange={(e) => { setAuth(e.target.value); setDropAuth(false); }} data-testid="ai-hook-auth" />
      </Field>
      {bot.webhookAuth && !auth && <label className="row tight small"><input type="checkbox" checked={dropAuth} onChange={(e) => setDropAuth(e.target.checked)} data-testid="ai-hook-auth-drop" />{t('ai.hook.authDrop')}</label>}
      <p className="xs dim">{t('ai.hook.sign')}</p>
      {err && <Note tone="bad">{err}</Note>}
    </Modal>
  );
}

function KeyShown({ name, secret: value, onClose }: { name: string; secret: string; onClose: () => void }) {
  const { t } = useApp();
  const copy = async () => { try { await navigator.clipboard.writeText(value); toast(t('ai.key.copied')); } catch { /* the field below can be copied by hand */ } };
  return (
    <Modal title={t('ai.key.title', { name })} onClose={onClose} size="narrow" labelClose={t('common.close')}
      footer={<><Button icon={<LuCopy />} onClick={() => void copy()}>{t('ai.key.copy')}</Button><Button variant="primary" onClick={onClose}>{t('ai.key.close')}</Button></>}>
      <Note tone="warn">{t('ai.key.once')}</Note>
      <input className="input ai-key" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={t('ai.bot.key')} data-testid="ai-key" />
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
function ActivityLog({ bots }: { bots: Bot[] }) {
  const { t, dateTime } = useApp();
  const [who, setWho] = useState('');
  const [rows, setRows] = useState<Activity[] | null>(null);
  useEffect(() => { let live = true; setRows(null); void botApi.activity(who || undefined).then((r) => { if (live) setRows(r.ok ? r.data : []); }); return () => { live = false; }; }, [who]);
  const tone = (o: Activity['outcome']): Tone => (o === 'ok' ? 'ok' : o === 'denied' ? 'warn' : 'bad');
  return (
    <Card title={t('ai.tab.activity')} actions={
      <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('ai.tab.team')}>
        <option value="">{t('ai.act.all')}</option>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>}>
      {!rows ? <p className="muted">{t('ai.loading')}</p> : !rows.length ? <Empty title={t('ai.act.none')} /> : (
        <div className="list ai-log">
          {rows.map((r) => (
            <div className="item" key={r.id}>
              <span className="xs dim ai-when">{dateTime(r.at)}</span>
              <b className="small">{r.bot ?? '·'}</b>
              <code className="small">{r.tool.replace('.', '_')}</code>
              <Badge tone={tone(r.outcome)}>{t('ai.act.' + r.outcome)}</Badge>
              {r.summary.reason && <span className="xs dim">{r.summary.reason}</span>}
              {typeof r.summary.count === 'number' && <span className="xs dim">{t('ai.act.count', { n: r.summary.count })}</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Connect() {
  const { t } = useApp();
  const origin = useMemo(() => window.location.origin, []);
  const Line = ({ label, value }: { label: string; value: string }) => (
    <div className="ai-cn"><span className="small muted">{label}</span><code>{value}</code>
      <Button size="sm" variant="ghost" icon={<LuCopy />} onClick={() => void navigator.clipboard.writeText(value).then(() => toast(t('ai.key.copied')), () => undefined)}>{t('ai.copy')}</Button></div>
  );
  return (
    <Card title={t('ai.tab.connect')}>
      <p>{t('ai.cn.lead')}</p>
      <Line label={t('ai.cn.mcp')} value={`${origin}/api/bot/mcp`} />
      <Line label={t('ai.cn.plain')} value={`${origin}/api/bot/call`} />
      <div className="ai-cn"><span className="small muted">&nbsp;</span><code>{'{"tool": "leads_list", "args": {}}'}</code></div>
      <Line label={t('ai.cn.header')} value="Authorization: Bearer vxb_…" />
      <p className="xs dim">{t('ai.cn.limits')}</p>
    </Card>
  );
}
