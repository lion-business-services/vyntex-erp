// Team chat (supabase/migrations/0087_team_chat.sql, api/_lib/chat): a tab of Team, in a live workspace.
//   rooms       direct chats with a teammate or an AI employee, and groups (named, with admins)
//   messages    replies, @mentions, reactions, files, edit and delete of one's own, read ticks, translation
//   AI          a direct chat with an AI employee, or an @mention of one in a group, reaches it at once (signed delivery);
//               its answer arrives in the same chat
// The screen asks the server for what changed every few seconds while it is open (chat_sync). Every action goes through
// the database functions with the person's own session: the database checks the room membership each time.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LuBellOff, LuBot, LuCheck, LuCheckCheck, LuCornerUpLeft, LuLanguages, LuLogOut, LuPaperclip, LuPencil, LuPlus, LuSearch, LuSend, LuSettings, LuSmilePlus, LuTrash2, LuUsers, LuX } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { useApp } from '@/app/hooks';
import { Badge, Button, Field, IconButton, Modal, Note, confirmDialog, cx, toast } from '@/ui';
import { rpc } from '@/platform/live/ops';
import { gateway } from '@/platform/gateway';
import { storeFile } from '@/features/documents/upload';
import { MAX_LOGO_BYTES, readLogo } from '@/features/settings/helpers';
import { storeImage, useStoredImage } from '@/features/settings/image';
import './teamchat.css';

type Who = { type: 'member' | 'bot'; id: string; name: string; title?: string | null; role?: string; lastReadAt?: string; live?: boolean; photo?: string | null };
interface Room { id: string; kind: 'group' | 'direct'; name: string; topic: string; photo?: string | null; lastAt: string; role: 'admin' | 'member'; muted: boolean; lastReadAt: string; unread: number; mentioned: boolean;
  last: { body: string; files: number; name: string; at: string } | null; members: Who[] }
interface ChatFile { name: string; size: number; mime: string; path: string }
interface Msg { id: string; roomId: string; at: string; author: { type: 'member' | 'bot'; id: string; name: string; title?: string }; body: string; deleted: boolean; editedAt: string | null;
  replyTo: { id: string; body: string; name: string } | null; mentions: { type: string; id: string }[]; files: ChatFile[]; translations: Record<string, string>;
  reactions: { emoji: string; n: number; who: string[]; ids: string[] }[] }
interface Sync { me: string; mePhoto?: string | null; now: string; rooms: Room[]; people: Who[]; bots: Who[]; messages: Msg[] }
// 0094: every photo the screen knows, by person or AI employee id
const Photos = createContext<Map<string, string>>(new Map());
const EMOJI = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '✅', '🔥'];

async function call<T>(name: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try { const a = await rpc<T>(name, args); return a.ok ? { ok: true, data: a.data.result } : { ok: false, reason: a.code || 'generic' }; } catch { return { ok: false, reason: 'generic' }; }
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '?';
const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export default function TeamChatPage(_: PageProps) {
  const { t, lang } = useApp();
  const [sync, setSync] = useState<Sync | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(window.location.search).get('room'));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState<'chat' | 'group' | null>(null);
  const [settings, setSettings] = useState(false);
  const since = useRef<string | null>(null);
  const roomRef = useRef<string | null>(open);

  const merge = (incoming: Msg[]) => setMsgs((cur) => {
    const map = new Map(cur.map((m) => [m.id, m]));
    for (const m of incoming) map.set(m.id, m);
    return [...map.values()].sort((a, b) => a.at.localeCompare(b.at));
  });
  const pull = useCallback(async () => {
    const room = roomRef.current;
    const r = await call<Sync>('chat_sync', { ...(room ? { p_room: room } : {}), ...(room && since.current ? { p_since: since.current } : {}) });
    if (!r.ok) { setFailed(true); return; }
    setFailed(false); setSync(r.data);
    if (room && roomRef.current === room) { merge(r.data.messages); since.current = r.data.now; }
  }, []);
  useEffect(() => { void pull(); const id = window.setInterval(() => { if (!document.hidden) void pull(); }, 3000); return () => window.clearInterval(id); }, [pull]);
  // a room opened: start from its latest messages, and mark it read
  useEffect(() => {
    roomRef.current = open; since.current = null; setMsgs([]);
    if (open) { void pull().then(() => call('chat_read', { p_room: open })); const u = new URL(window.location.href); u.searchParams.set('room', open); window.history.replaceState(null, '', u); }
  }, [open, pull]);
  const room = sync?.rooms.find((r) => r.id === open) ?? null;
  // read as it arrives while the room is on screen
  const lastId = msgs.at(-1)?.id;
  useEffect(() => { if (open && lastId && !document.hidden) void call('chat_read', { p_room: open }); }, [open, lastId]);

  const titleOf = (r: Room) => (r.kind === 'group' ? r.name : r.members.find((m) => !(m.type === 'member' && m.id === sync?.me))?.name ?? '·');
  const otherOf = (r: Room) => r.members.find((m) => !(m.type === 'member' && m.id === sync?.me));
  const rooms = (sync?.rooms ?? []).filter((r) => !q || titleOf(r).toLowerCase().includes(q.toLowerCase()));

  const startDirect = async (w: Who) => {
    setPicker(null);
    const r = await call<string>('chat_room_open', { p_room: { kind: 'direct', with: { type: w.type, id: w.id } } });
    if (r.ok) setOpen(r.data); else toast(t('tc.reason.generic'), true);
  };

  const photos = useMemo(() => {
    const m = new Map<string, string>();
    const add = (w: Who) => { if (w.photo) m.set(w.id, w.photo); };
    if (sync) { sync.people.forEach(add); sync.bots.forEach(add); sync.rooms.forEach((r) => r.members.forEach(add)); if (sync.mePhoto) m.set(sync.me, sync.mePhoto); }
    return m;
  }, [sync]);

  return (
    <Photos.Provider value={photos}>
    <div className={cx('page tc', open && 'tc-has-room')} data-testid="teamchat">
      {failed && <Note tone="warn">{t('tc.error')}</Note>}
      <div className="tc-shell">
        <aside className="tc-list" aria-label={t('nav.teamchat')}>
          <div className="tc-list-top">
            <div className="tc-search"><LuSearch aria-hidden="true" /><input className="input" placeholder={t('tc.search')} aria-label={t('tc.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <IconButton label={t('tc.newChat')} onClick={() => setPicker('chat')} data-testid="tc-new-chat"><LuPlus /></IconButton>
            <IconButton label={t('tc.newGroup')} onClick={() => setPicker('group')} data-testid="tc-new-group"><LuUsers /></IconButton>
          </div>
          {!sync ? <p className="muted tc-pad">{t('tc.loading')}</p> : !rooms.length ? <p className="muted tc-pad">{t('tc.none')}</p> : (
            <ul className="tc-rooms">
              {rooms.map((r) => {
                const other = otherOf(r); const bot = r.kind === 'direct' && other?.type === 'bot';
                return (
                  <li key={r.id}>
                    <button type="button" className={cx('tc-room', r.id === open && 'on', r.unread > 0 && 'unread')} onClick={() => setOpen(r.id)} data-room={titleOf(r)}>
                      <Avatar name={titleOf(r)} id={r.kind === 'group' ? r.id : other?.id ?? r.id} bot={bot} group={r.kind === 'group'} photo={r.kind === 'group' ? r.photo : undefined} />
                      <span className="grow tc-room-main">
                        <span className="row tight"><b className="tc-room-name">{titleOf(r)}</b>{bot && <Badge tone="violet">{t('tc.aiBadge')}</Badge>}{r.muted && <LuBellOff aria-hidden="true" className="dim" />}</span>
                        <span className="tc-room-last">{r.last ? `${r.last.name}: ${r.last.body || (r.last.files ? '📎' : '')}` : r.topic}</span>
                      </span>
                      <span className="tc-room-side">
                        {r.last && <span className="xs dim">{stamp(r.last.at, lang, t)}</span>}
                        {r.unread > 0 && <span className={cx('tc-unread', r.mentioned && 'at')}>{r.mentioned ? '@' : r.unread}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
        <section className="tc-room-pane">
          {!room || !sync ? <div className="tc-empty"><LuUsers aria-hidden="true" /><p>{t('tc.pick')}</p></div> : (
            <Conversation key={room.id} room={room} me={sync.me} title={titleOf(room)} other={otherOf(room)} msgs={msgs} setMsgs={setMsgs} merge={merge} pull={pull}
              onBack={() => setOpen(null)} onSettings={() => setSettings(true)} />
          )}
        </section>
      </div>
      {picker && sync && <Picker kind={picker} sync={sync} onClose={() => setPicker(null)} onDirect={startDirect}
        onGroup={async (name, topic, members) => {
          const r = await call<string>('chat_room_open', { p_room: { kind: 'group', name, topic, members: members.map((m) => ({ type: m.type, id: m.id })) } });
          if (!r.ok) return toast(t('tc.reason.generic'), true);
          setPicker(null); setOpen(r.data);
        }} />}
      {settings && room && sync && <GroupSettings room={room} sync={sync} onClose={() => setSettings(false)} onDone={async (left) => { setSettings(false); if (left) setOpen(null); await pull(); }} />}
    </div>
    </Photos.Provider>
  );
}

function stamp(at: string, lang: string, t: (k: string) => string) {
  const d = new Date(at); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t('tc.yesterday');
  return d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric' });
}

function Avatar({ name, id, bot, group, small, photo }: { name: string; id: string; bot?: boolean; group?: boolean; small?: boolean; photo?: string | null }) {
  const known = useContext(Photos);
  const src = useStoredImage((group ? photo : photo ?? known.get(id)) || undefined);
  return (
    <span className={cx('tc-av', small && 'sm', bot && 'bot', src && 'pic')} style={bot || src ? undefined : { background: `hsl(${hue(id)} 45% 28%)` }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : bot ? <LuBot /> : group ? <LuUsers /> : initials(name)}
    </span>
  );
}

const reasonOf = (t: (k: string) => string, r: string) => { const k = 'tc.reason.' + r; const s = t(k); return s === k ? t('tc.reason.generic') : s; };

function Conversation({ room, me, title, other, msgs, setMsgs, merge, pull, onBack, onSettings }: {
  room: Room; me: string; title: string; other?: Who; msgs: Msg[]; setMsgs: (f: (m: Msg[]) => Msg[]) => void; merge: (m: Msg[]) => void; pull: () => Promise<void>; onBack: () => void; onSettings: () => void;
}) {
  const { t, lang } = useApp();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Msg | null>(null);
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [mentions, setMentions] = useState<{ type: string; id: string; name: string }[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [shownTr, setShownTr] = useState<Record<string, string>>({});
  const [older, setOlder] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const others = room.members.filter((m) => !(m.type === 'member' && m.id === me));
  const bot = room.kind === 'direct' && other?.type === 'bot';
  const target = lang === 'es' ? 'es' : 'en';

  // stay at the bottom when new messages arrive, unless the person scrolled up to read
  const nearBottom = useRef(true);
  useEffect(() => { const el = box.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, [msgs.length]);

  const candidates = at === null ? [] : others.filter((m) => m.name.toLowerCase().startsWith(at.toLowerCase())).slice(0, 6);
  const onType = (v: string) => {
    setText(v);
    const m = /(^|\s)@([\p{L}\p{N}_-]{0,30})$/u.exec(v.slice(0, input.current?.selectionStart ?? v.length));
    setAt(m ? m[2] : null);
  };
  const pickMention = (w: Who) => {
    const caret = input.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}_-]{0,30})$/u, '@' + w.name + ' ');
    setText(before + text.slice(caret)); setAt(null);
    setMentions((x) => (x.some((y) => y.id === w.id) ? x : [...x, { type: w.type, id: w.id, name: w.name }]));
    input.current?.focus();
  };
  const send = async () => {
    const body = text.trim();
    if (!body && !files.length) return;
    setBusy(true);
    const r = await call<{ message: Msg }>('chat_send', { p_room: room.id, p_body: body, ...(reply ? { p_reply_to: reply.id } : {}),
      p_mentions: mentions.filter((m) => body.includes('@' + m.name)).map((m) => ({ type: m.type, id: m.id })), p_files: files });
    setBusy(false);
    if (!r.ok) return toast(reasonOf(t, r.reason), true);
    nearBottom.current = true; merge([r.data.message]); setText(''); setReply(null); setFiles([]); setMentions([]);
  };
  const attach = async (list: FileList | null) => {
    for (const f of [...(list ?? [])].slice(0, 10 - files.length)) {
      const s = await storeFile(f, { folder: 'chat' });
      if (s.ok && s.file.path) setFiles((x) => [...x, { name: s.file.name, size: s.file.size, mime: s.file.mime, path: s.file.path! }]);
      else if (!s.ok) toast(reasonOf(t, s.reason), true);
    }
  };
  const openFile = async (f: ChatFile) => { const u = await gateway().files.url({ name: f.name, size: f.size, mime: f.mime, path: f.path }); if (u.ok) window.open(u.data, '_blank', 'noopener'); };
  const translate = async (m: Msg) => {
    if (shownTr[m.id]) { setShownTr((x) => { const y = { ...x }; delete y[m.id]; return y; }); return; }
    const cached = m.translations?.[target];
    if (cached) { setShownTr((x) => ({ ...x, [m.id]: cached })); return; }
    const r = await call<{ text: string }>('chat_translate', { p_message: m.id, p_lang: target });
    if (r.ok) setShownTr((x) => ({ ...x, [m.id]: r.data.text })); else toast(reasonOf(t, r.reason), true);
  };
  const react = async (m: Msg, e: string) => { await call('chat_react', { p_message: m.id, p_emoji: e }); await pull(); };
  const del = async (m: Msg) => { if (!(await confirmDialog(t('tc.confirmDelete'), t('tc.delete'), t('tc.cancel')))) return; const r = await call<boolean>('chat_delete', { p_message: m.id }); if (r.ok) setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, deleted: true, body: '', files: [] } : y))); };
  const saveEdit = async (m: Msg, body: string) => { const r = await call<boolean>('chat_edit', { p_message: m.id, p_body: body }); if (r.ok) setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, body, editedAt: new Date().toISOString() } : y))); setEditing(null); };
  const loadOlder = async () => {
    const first = msgs[0]; if (!first) return;
    const r = await call<Msg[]>('chat_history', { p_room: room.id, p_before: first.at });
    if (r.ok) { if (r.data.length < 100) setOlder(false); nearBottom.current = false; merge(r.data); }
  };
  const ticks = (m: Msg) => {
    const readers = others.filter((o) => o.lastReadAt && o.lastReadAt >= m.at).length;
    if (room.kind === 'direct') return readers > 0 ? <LuCheckCheck className="tc-read" aria-label={t('tc.read')} /> : <LuCheck aria-label={t('tc.sent')} />;
    return readers > 0 ? <span className="xs" title={t('tc.readBy', { n: readers })}><LuCheckCheck className={cx(readers === others.length && 'tc-read')} aria-label={t('tc.readBy', { n: readers })} /></span> : <LuCheck aria-label={t('tc.sent')} />;
  };
  const renderBody = (m: Msg, body: string) => {
    const names = room.members.map((x) => x.name).filter(Boolean).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!names.length) return body;
    const re = new RegExp(`(@(?:${names.join('|')}))`, 'g');
    return body.split(re).map((part, i) => (re.test(part) && part.startsWith('@') ? <span key={i} className="tc-at">{part}</span> : part));
  };

  // 0094: any member of a group may change its photo
  const changeGroupPhoto = async (file: File) => {
    let pic: string;
    try { pic = await readLogo(file); } catch { toast(t('tc.photo.bad', { max: Math.round(MAX_LOGO_BYTES / 1024 / 1024) }), true); return; }
    const path = await storeImage(pic, true, 'chat');
    if (!path) { toast(t('tc.photo.failed'), true); return; }
    const r = await call('chat_room_photo_set', { p_room: room.id, p_photo: path });
    if (!r.ok) { toast(t('tc.photo.failed'), true); return; }
    toast(t('tc.photo.saved')); await pull();
  };

  let lastDay = '';
  return (
    <div className="tc-conv">
      <header className="tc-head">
        <IconButton label={t('tc.cancel')} className="tc-back" onClick={onBack}><LuCornerUpLeft /></IconButton>
        {room.kind === 'group'
          ? <label className="tc-photo-edit" title={t('tc.photo.change')}><Avatar name={title} id={room.id} group photo={room.photo} /><span className="sr-only">{t('tc.photo.change')}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" data-testid="tc-group-photo" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void changeGroupPhoto(f); }} /></label>
          : <Avatar name={title} id={other?.id ?? room.id} bot={bot} />}
        <div className="grow">
          <div className="row tight"><b>{title}</b>{bot && <Badge tone="violet">{t('tc.aiBadge')}</Badge>}</div>
          <div className="xs dim">{room.kind === 'group' ? (room.topic || t('tc.members', { n: room.members.length })) : (other?.title ?? '')}
            {bot && <> · {other?.live ? t('tc.botLive') : t('tc.botInbox')}</>}</div>
        </div>
        <IconButton label={room.muted ? t('tc.unmute') : t('tc.mute')} onClick={async () => { await call('chat_mute', { p_room: room.id, p_muted: !room.muted }); await pull(); }}><LuBellOff /></IconButton>
        {room.kind === 'group' && <IconButton label={t('tc.settings')} onClick={onSettings}><LuSettings /></IconButton>}
      </header>
      <div className="tc-msgs" ref={box} onScroll={(e) => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="tc-messages">
        {bot && <p className="tc-hint xs">{t('tc.botHint', { name: other?.name ?? '' })}</p>}
        {older && msgs.length >= 50 && <button type="button" className="tc-older xs" onClick={() => void loadOlder()}>{t('tc.older')}</button>}
        {msgs.map((m) => {
          const mine = m.author.type === 'member' && m.author.id === me;
          const day = new Date(m.at).toDateString();
          const sep = day !== lastDay ? (lastDay = day, <div className="tc-day" key={'d' + m.id}><span>{stamp(m.at, lang, t).includes(':') ? t('tc.today') : stamp(m.at, lang, t)}</span></div>) : null;
          const tr = shownTr[m.id];
          return [sep, (
            <div key={m.id} className={cx('tc-msg', mine && 'mine', m.author.type === 'bot' && 'bot')} data-msg={m.id}>
              {!mine && <Avatar small name={m.author.name} id={m.author.id} bot={m.author.type === 'bot'} />}
              <div className="tc-bubble">
                {!mine && room.kind === 'group' && <div className="tc-author" style={m.author.type === 'bot' ? undefined : { color: `hsl(${hue(m.author.id)} 70% 70%)` }}>{m.author.name}{m.author.type === 'bot' && <Badge tone="violet">{t('tc.aiBadge')}</Badge>}</div>}
                {m.replyTo && <div className="tc-quote"><b>{m.replyTo.name}</b><span>{m.replyTo.body || t('tc.deleted')}</span></div>}
                {m.deleted ? <i className="dim">{t('tc.deleted')}</i> : editing === m.id ? <EditBox initial={m.body} onSave={(b) => void saveEdit(m, b)} onCancel={() => setEditing(null)} /> : (
                  <div className="tc-text">{renderBody(m, tr ?? m.body)}</div>
                )}
                {tr && <div className="tc-tr xs dim"><LuLanguages aria-hidden="true" /> {t('tc.translated')}</div>}
                {m.files.length > 0 && <div className="tc-files">{m.files.map((f) => <button type="button" key={f.path} className="tc-file" onClick={() => void openFile(f)}><LuPaperclip aria-hidden="true" />{f.name}</button>)}</div>}
                <div className="tc-meta xs">{m.editedAt && !m.deleted && <span>{t('tc.edited')}</span>}<span>{new Date(m.at).toLocaleTimeString(lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' })}</span>{mine && !m.deleted && ticks(m)}</div>
                {m.reactions.length > 0 && <div className="tc-reacts">{m.reactions.map((r) => (
                  <button type="button" key={r.emoji} className={cx('tc-react', r.ids.includes(me) && 'mine')} title={r.who.join(', ')} onClick={() => void react(m, r.emoji)}>{r.emoji} {r.n}</button>
                ))}</div>}
                {!m.deleted && (
                  <div className="tc-tools">
                    <button type="button" aria-label={t('tc.reply')} title={t('tc.reply')} onClick={() => { setReply(m); input.current?.focus(); }}><LuCornerUpLeft /></button>
                    <span className="tc-emoji-wrap"><button type="button" aria-label={t('tc.react')} title={t('tc.react')}><LuSmilePlus /></button>
                      <span className="tc-emoji">{EMOJI.map((e) => <button type="button" key={e} onClick={() => void react(m, e)} aria-label={e}>{e}</button>)}</span></span>
                    {m.body && <button type="button" aria-label={tr ? t('tc.original') : t('tc.translate')} title={tr ? t('tc.original') : t('tc.translate')} onClick={() => void translate(m)} data-testid="tc-translate"><LuLanguages /></button>}
                    {mine && <><button type="button" aria-label={t('tc.edit')} title={t('tc.edit')} onClick={() => setEditing(m.id)}><LuPencil /></button>
                      <button type="button" aria-label={t('tc.delete')} title={t('tc.delete')} onClick={() => void del(m)}><LuTrash2 /></button></>}
                  </div>
                )}
              </div>
            </div>
          )];
        })}
      </div>
      <footer className="tc-compose">
        {reply && <div className="tc-replying xs"><LuCornerUpLeft aria-hidden="true" /> {t('tc.replyTo', { name: reply.author.name })}: <span className="dim">{reply.body.slice(0, 80)}</span>
          <IconButton label={t('tc.cancelReply')} onClick={() => setReply(null)}><LuX /></IconButton></div>}
        {files.length > 0 && <div className="tc-files">{files.map((f) => <span key={f.path} className="tc-file"><LuPaperclip aria-hidden="true" />{f.name}<button type="button" aria-label={t('tc.cancel')} onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}><LuX /></button></span>)}</div>}
        {candidates.length > 0 && (
          <ul className="tc-mention-list" role="listbox" aria-label={t('tc.mention')}>
            {candidates.map((w) => <li key={w.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(w); }}><Avatar small name={w.name} id={w.id} bot={w.type === 'bot'} />{w.name}{w.type === 'bot' && <Badge tone="violet">{t('tc.aiBadge')}</Badge>}<span className="xs dim">{w.title}</span></button></li>)}
          </ul>
        )}
        <div className="tc-compose-row">
          <label className="tc-attach" title={t('tc.attach')}><LuPaperclip aria-hidden="true" /><span className="sr-only">{t('tc.attach')}</span>
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx" onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} /></label>
          <textarea ref={input} className="input" rows={1} value={text} maxLength={8000} placeholder={room.kind === 'direct' ? t('tc.writeTo', { name: title }) : t('tc.write')} aria-label={t('tc.write')}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (candidates.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(candidates[0]); return; }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            }} data-testid="tc-input" />
          <Button variant="primary" icon={<LuSend />} disabled={busy || (!text.trim() && !files.length)} onClick={() => void send()} aria-label={t('tc.send')} data-testid="tc-send" />
        </div>
      </footer>
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (b: string) => void; onCancel: () => void }) {
  const { t } = useApp();
  const [v, setV] = useState(initial);
  return (
    <div className="tc-edit">
      <textarea className="input" rows={2} value={v} maxLength={8000} onChange={(e) => setV(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (v.trim()) onSave(v); } if (e.key === 'Escape') onCancel(); }} />
      <div className="row tight"><Button size="sm" variant="primary" onClick={() => v.trim() && onSave(v)}>{t('tc.save')}</Button><Button size="sm" variant="ghost" onClick={onCancel}>{t('tc.cancel')}</Button></div>
    </div>
  );
}

function Picker({ kind, sync, onClose, onDirect, onGroup }: { kind: 'chat' | 'group'; sync: Sync; onClose: () => void; onDirect: (w: Who) => void; onGroup: (name: string, topic: string, members: Who[]) => Promise<void> }) {
  const { t } = useApp();
  const [name, setName] = useState(''); const [topic, setTopic] = useState(''); const [sel, setSel] = useState<Who[]>([]); const [q, setQ] = useState('');
  const match = (w: Who) => !q || w.name.toLowerCase().includes(q.toLowerCase());
  const row = (w: Who) => {
    const on = sel.some((x) => x.id === w.id);
    return (
      <li key={w.id}><button type="button" className={cx('tc-pick', on && 'on')} onClick={() => (kind === 'chat' ? onDirect(w) : setSel((x) => (on ? x.filter((y) => y.id !== w.id) : [...x, w])))} data-pick={w.name}>
        <Avatar small name={w.name} id={w.id} bot={w.type === 'bot'} /><span className="grow"><b>{w.name}</b><span className="xs dim"> {w.title ?? ''}</span></span>
        {w.type === 'bot' && <Badge tone="violet">{t('tc.aiBadge')}</Badge>}{kind === 'group' && on && <LuCheck aria-hidden="true" />}
      </button></li>
    );
  };
  return (
    <Modal title={t(kind === 'chat' ? 'tc.newChat' : 'tc.newGroup')} onClose={onClose} labelClose={t('common.close')}
      footer={kind === 'group' ? <><Button variant="ghost" onClick={onClose}>{t('tc.cancel')}</Button><Button variant="primary" disabled={!name.trim()} onClick={() => void onGroup(name.trim(), topic.trim(), sel)} data-testid="tc-group-create">{t('tc.group.create')}</Button></> : undefined}>
      {kind === 'group' && <><Field label={t('tc.group.name')} htmlFor="tc-gname"><input id="tc-gname" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} data-testid="tc-group-name" /></Field>
        <Field label={t('tc.group.topic')} htmlFor="tc-gtopic"><input id="tc-gtopic" className="input" maxLength={300} value={topic} onChange={(e) => setTopic(e.target.value)} /></Field></>}
      <input className="input" placeholder={t('tc.search')} aria-label={t('tc.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {sync.bots.filter(match).length > 0 && <><h4 className="tc-h">{t('tc.ai')}</h4><ul className="tc-picks">{sync.bots.filter(match).map(row)}</ul></>}
      {sync.people.filter(match).length > 0 && <><h4 className="tc-h">{t('tc.people')}</h4><ul className="tc-picks">{sync.people.filter(match).map(row)}</ul></>}
    </Modal>
  );
}

function GroupSettings({ room, sync, onClose, onDone }: { room: Room; sync: Sync; onClose: () => void; onDone: (left: boolean) => Promise<void> }) {
  const { t } = useApp();
  const admin = room.role === 'admin';
  const [name, setName] = useState(room.name); const [topic, setTopic] = useState(room.topic);
  const inRoom = new Set(room.members.map((m) => m.id));
  const addable = useMemo(() => [...sync.bots, ...sync.people].filter((w) => !inRoom.has(w.id)), [sync, room]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = async (c: Record<string, unknown>) => { const r = await call<boolean>('chat_room_update', { p_room: room.id, p_change: c }); if (!r.ok) toast(reasonOf(t, r.reason), true); return r.ok; };
  return (
    <Modal title={t('tc.settings')} onClose={onClose} labelClose={t('common.close')}
      footer={<><Button variant="ghost" icon={<LuLogOut />} onClick={async () => { if (await confirmDialog(t('tc.confirmLeave', { name: room.name }), t('tc.leave'), t('tc.cancel')) && await change({ leave: true })) await onDone(true); }}>{t('tc.leave')}</Button>
        {admin && <Button variant="primary" onClick={async () => { if (await change({ name, topic })) await onDone(false); }}>{t('tc.group.save')}</Button>}</>}>
      <Field label={t('tc.group.name')} htmlFor="tc-sname"><input id="tc-sname" className="input" disabled={!admin} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('tc.group.topic')} htmlFor="tc-stopic"><input id="tc-stopic" className="input" disabled={!admin} value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} /></Field>
      <h4 className="tc-h">{t('tc.group.members')}</h4>
      <ul className="tc-picks">
        {room.members.map((m) => (
          <li key={m.id} className="tc-pick">
            <Avatar small name={m.name} id={m.id} bot={m.type === 'bot'} /><span className="grow"><b>{m.name}</b> <span className="xs dim">{m.title ?? ''}</span></span>
            {m.role === 'admin' && <Badge>{t('tc.group.admin')}</Badge>}
            {admin && !(m.type === 'member' && m.id === sync.me) && <>
              {m.type === 'member' && m.role !== 'admin' && <Button size="sm" variant="ghost" onClick={async () => { if (await change({ admins: [...room.members.filter((x) => x.role === 'admin' && x.type === 'member').map((x) => x.id), m.id] })) await onDone(false); }}>{t('tc.group.makeAdmin')}</Button>}
              <Button size="sm" variant="ghost" onClick={async () => { if (await change({ remove: [{ id: m.id }] })) await onDone(false); }}>{t('tc.group.remove')}</Button></>}
          </li>
        ))}
      </ul>
      {admin && addable.length > 0 && (
        <select className="input" value="" aria-label={t('tc.newChat')} onChange={async (e) => { const w = addable.find((x) => x.id === e.target.value); if (w && await change({ add: [{ type: w.type, id: w.id }] })) await onDone(false); }}>
          <option value="">+ {t('tc.group.members')}</option>{addable.map((w) => <option key={w.id} value={w.id}>{w.name}{w.type === 'bot' ? ' (' + t('tc.aiBadge') + ')' : ''}</option>)}
        </select>
      )}
    </Modal>
  );
}
