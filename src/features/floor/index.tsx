// The shop floor: what is happening in the shop right now. Every chair with who is in it and who is next, the walk-in
// line with an honest estimate of each wait, the self check-in kiosk, the display for the waiting area, the insights the
// owner reads in the morning (who is due for a cut, the busy hours, how full each chair is, who misses appointments),
// today's walk-ins, and the chairs and queue settings. The rules live in src/domain/actions/shop.ts.
import { useEffect, useMemo, useState } from 'react';
import {
  LuArmchair, LuBellRing, LuCircleCheck, LuClock, LuCoffee, LuFlame, LuMaximize, LuMonitor, LuPause, LuPencil, LuPlay, LuPlus, LuPower,
  LuSettings2, LuTabletSmartphone, LuTicket, LuTimer, LuUndo2, LuUserCheck, LuUsers, LuX,
} from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { PageProps } from '@/app/routes';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Card, Empty, Field, IconButton, Menu, Modal, Note, PageHeader, Stat, Tabs, confirmDialog, cx, toast } from '@/ui';
import type { Tone } from '@/ui';
import { gateway } from '@/platform/gateway';
import { completeAppointment } from '@/domain/actions/appointments';
import { queueMessage } from '@/domain/actions/messages';
import {
  addWalkIn, atRisk, barberOf, busyHours, callWalkIn, chairLoad, dayNumbers, displayName, dropWalkIn, dueForCut, finishWalkIn, inChair, inLine, minutesFor,
  planQueue, priceOf, quoteWait, requeueWalkIn, saveChair, saveShopSettings, serviceName, setChairStatus, setPreference, setQueueOpen, setVisitExtras,
  shopSettings, startWalkIn, usablePasses, walkinsOn, workingChairs, type ShopRefusal, type ShopSettings,
} from '@/domain/actions/shop';
import type { Appointment, Chair, PayMethod, WalkIn } from '@/domain/types';
import { addDaysFrom, daysBetween, today } from '@/lib/dates';
import { money, money2 } from '@/lib/money';
import './floor.css';

type Tab = 'live' | 'insights' | 'history' | 'setup';
const STATUS_TONE: Record<Chair['status'], Tone> = { open: 'ok', busy: 'info', break: 'warn', off: 'neutral' };
const err = (r: ShopRefusal | string) => 'floor.err.' + (['invalid', 'not_found', 'not_allowed', 'already', 'empty', 'expired', 'not_active', 'not_enough'].includes(r) ? r : 'failed');
const minutesAgo = (iso?: string) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const atTime = (a: Pick<Appointment, 'date' | 'time'>) => { const [y, m, d] = a.date.split('-').map(Number); const [h, mi] = a.time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };

/** Re-draws the screen every 30 seconds, so the waits and the "minutes ago" stay true while it is open. */
function useClock(ms = 30000) {
  const [, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((n) => n + 1), ms); return () => clearInterval(id); }, [ms]);
}

export default function FloorPage(_: PageProps) {
  const { t, data, can, lang } = useApp();
  useClock();
  const [tab, setTab] = useState<Tab>('live');
  const [adding, setAdding] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [screen, setScreen] = useState(false);
  const [checkout, setCheckout] = useState<{ walkin?: WalkIn; appt?: Appointment } | null>(null);
  const s = shopSettings(data);
  const mayWrite = can('write') && can('appointments');
  const plan = useMemo(() => planQueue(data), [data]);
  const line = inLine(data);
  const nums = dayNumbers(data);
  const chairs = data.chairs ?? [];
  // what someone walking in right now would be told
  const nextWait = quoteWait(data);
  const staffed = chairs.filter((c) => c.staffId && c.status !== 'off');
  const busyChairs = new Set([...inChair(data).map((w) => w.chairId), ...chairs.filter((c) => c.status === 'busy').map((c) => c.id)]).size;

  if (!chairs.length && tab === 'live') {
    return (
      <div className="floor">
        <PageHeader title={t('nav.floor')} sub={t('floor.sub')} />
        <Card><Empty title={t('floor.noChairs')} action={can('config') ? <Button variant="primary" icon={<LuPlus />} onClick={() => setTab('setup')} data-testid="floor-empty-add">{t('floor.chairs.add')}</Button> : undefined}>{t('floor.noChairsHint')}</Empty></Card>
        {tab !== 'live' && null}
      </div>
    );
  }

  return (
    <div className="floor">
      <PageHeader title={t('nav.floor')} sub={t('floor.sub')} actions={<>
        {mayWrite && <Button icon={s.queueOpen ? <LuPause aria-hidden="true" /> : <LuPlay aria-hidden="true" />} onClick={() => { act(setQueueOpen, !s.queueOpen); toast(t(s.queueOpen ? 'floor.queue.pausedToast' : 'floor.queue.openedToast')); }} data-testid="floor-queue-toggle">
          {t(s.queueOpen ? 'floor.queue.pause' : 'floor.queue.open')}</Button>}
        <Button icon={<LuMonitor aria-hidden="true" />} onClick={() => setScreen(true)} data-testid="floor-screen">{t('floor.screen')}</Button>
        {mayWrite && <Button icon={<LuTabletSmartphone aria-hidden="true" />} onClick={() => setKiosk(true)} data-testid="floor-kiosk">{t('floor.kiosk')}</Button>}
        {mayWrite && <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setAdding(true)} disabled={!s.queueOpen} data-testid="floor-add">{t('floor.add')}</Button>}
      </>} />

      {!s.queueOpen && <Note tone="warn">{t('floor.queue.pausedNote')}</Note>}

      <div className="kpis floor-kpis">
        <Stat label={t('floor.k.line')} value={String(line.length)} hint={nextWait < 0 ? t('floor.quote.none') : t('floor.k.lineNone', { min: nextWait })} testId="floor-kpi-line" />
        <Stat label={t('floor.k.chairs')} value={`${busyChairs}/${staffed.length}`} hint={t('floor.k.chairsHint')} testId="floor-kpi-chairs" />
        <Stat label={t('floor.k.services')} value={money(nums.services)} hint={t('floor.k.visits', { n: nums.visits })} testId="floor-kpi-services" />
        <Stat label={t('floor.k.tips')} value={money(nums.tips)} hint={t('floor.k.tipsHint')} testId="floor-kpi-tips" />
        <Stat label={t('floor.k.wait')} value={t('floor.min', { n: nums.avgWait })} hint={t('floor.k.waitHint', { served: nums.served, left: nums.left })} testId="floor-kpi-wait" />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'live', label: t('floor.tab.live'), count: line.length }, { id: 'insights', label: t('floor.tab.insights') },
        { id: 'history', label: t('floor.tab.history') }, ...(can('config') ? [{ id: 'setup' as Tab, label: t('floor.tab.setup') }] : []),
      ]} />

      {tab === 'live' && (
        <div className="floor-live">
          <section aria-labelledby="floor-chairs-h">
            <h2 id="floor-chairs-h" className="floor-h">{t('floor.chairs')}</h2>
            <div className="floor-chairs" data-testid="floor-chairs">
              {chairs.map((ch) => <ChairCard key={ch.id} chair={ch} plan={plan} mayWrite={mayWrite} onCheckout={setCheckout} />)}
            </div>
          </section>
          <section aria-labelledby="floor-line-h" className="floor-side">
            <h2 id="floor-line-h" className="floor-h">{t('floor.line')} <span className="floor-h-n">{line.length}</span></h2>
            <Card flush>
              {!line.length ? <Empty title={t('floor.line.empty')}>{t('floor.line.emptyHint')}</Empty> : (
                <ol className="floor-line" data-testid="floor-line">
                  {line.map((w) => <LineRow key={w.id} w={w} plan={plan} mayWrite={mayWrite} />)}
                </ol>
              )}
            </Card>
            <UpNext />
          </section>
        </div>
      )}
      {tab === 'insights' && <Insights />}
      {tab === 'history' && <History />}
      {tab === 'setup' && can('config') && <Setup />}

      {adding && <AddWalkIn onClose={() => setAdding(false)} />}
      {kiosk && <Kiosk onClose={() => setKiosk(false)} />}
      {screen && <WaitingScreen onClose={() => setScreen(false)} />}
      {checkout && <Checkout {...checkout} onClose={() => setCheckout(null)} />}
      <p className="xs dim floor-foot">{t('floor.foot', { lang })}</p>
    </div>
  );
}

/* =====================================================================================================================
   A chair
   ===================================================================================================================== */

function ChairCard({ chair, plan, mayWrite, onCheckout }: { chair: Chair; plan: ReturnType<typeof planQueue>; mayWrite: boolean; onCheckout: (x: { walkin?: WalkIn; appt?: Appointment }) => void }) {
  const { t, data, lang, time } = useApp();
  const barber = barberOf(data, chair.staffId);
  const seated = inChair(data).find((w) => w.chairId === chair.id);
  const called = inLine(data).find((w) => w.status === 'called' && w.chairId === chair.id);
  const now = Date.now();
  const td = today();
  const appts = (data.appointments ?? []).filter((a) => a.staffId === chair.staffId && a.date === td && (a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'awaiting_payment'));
  const current = appts.find((a) => atTime(a) <= now && atTime(a) + a.minutes * 60000 > now - 15 * 60000);
  const nextAppt = appts.filter((a) => atTime(a) > now).sort((a, b) => atTime(a) - atTime(b))[0];
  const nextLine = plan.lines.find((l) => l.chairId === chair.id && data.walkins.find((w) => w.id === l.walkinId)?.status === 'waiting');
  const nextWalk = nextLine ? data.walkins.find((w) => w.id === nextLine.walkinId) : undefined;
  const client = (id?: string) => data.clients.find((c) => c.id === id)?.name ?? '';
  const progress = (start: number, minutes: number) => Math.min(100, Math.max(4, Math.round(((now - start) / (minutes * 60000)) * 100)));
  const status = (st: Chair['status']) => { const r = act(setChairStatus, chair.id, st); if (!r.ok) toast(t(err(r.reason)), true); };
  const call = () => { if (!nextWalk) return; const r = act(callWalkIn, nextWalk.id, chair.id); toast(r.ok ? t('floor.called', { name: nextWalk.name, chair: chair.label }) : t(err(r.reason)), !r.ok); };
  const start = (w: WalkIn) => { const r = act(startWalkIn, w.id); if (!r.ok) toast(t(err(r.reason)), true); };
  const back = (w: WalkIn) => { const r = act(requeueWalkIn, w.id); if (!r.ok) toast(t(err(r.reason)), true); };

  return (
    <article className={cx('floor-chair', chair.status)} data-chair={chair.id} data-status={chair.status} aria-label={`${chair.label}${barber ? ', ' + barber.name : ''}`}>
      <header>
        <span className="floor-chair-ico" aria-hidden="true"><LuArmchair /></span>
        <div className="grow">
          <b>{chair.label}</b>
          <div className="small muted">{barber ? barber.name : t('floor.chair.nobody')}{chair.pay === 'rent' && <> · {t('floor.chair.renter')}</>}{!chair.walkIns && <> · {t('floor.chair.byAppt')}</>}</div>
        </div>
        <Badge tone={STATUS_TONE[chair.status]}>{t('floor.st.' + chair.status)}</Badge>
        {mayWrite && chair.staffId && (
          <Menu label={t('floor.chair.status', { chair: chair.label })} button={<IconButton size="sm" label={t('floor.chair.status', { chair: chair.label })} data-testid="floor-chair-menu"><LuPower /></IconButton>}>
            {(close) => (['open', 'break', 'off'] as Chair['status'][]).filter((x) => x !== chair.status).map((x) => (
              <button key={x} type="button" role="menuitem" onClick={() => { status(x); close(); }}>{x === 'break' ? <LuCoffee aria-hidden="true" /> : x === 'off' ? <LuPower aria-hidden="true" /> : <LuPlay aria-hidden="true" />}{t('floor.set.' + x)}</button>
            ))}
          </Menu>
        )}
      </header>
      <div className="floor-chair-body">
        {seated ? (
          <div className="floor-now">
            <span className="xs dim">{t('floor.now')}</span>
            <b>#{seated.ticket} {seated.name}</b>
            <span className="small muted">{serviceName(data, seated.serviceId, lang) || t('floor.anyService')} · {t('floor.minIn', { n: minutesAgo(seated.startedAt) })}</span>
            <div className="floor-bar" aria-hidden="true"><i style={{ width: progress(new Date(seated.startedAt!).getTime(), minutesFor(data, seated.serviceId)) + '%' }} /></div>
            {mayWrite && <Button size="sm" variant="primary" icon={<LuCircleCheck aria-hidden="true" />} onClick={() => onCheckout({ walkin: seated })} data-testid="floor-finish">{t('floor.finish')}</Button>}
          </div>
        ) : current ? (
          <div className="floor-now">
            <span className="xs dim">{t('floor.nowAppt')}</span>
            <b>{client(current.clientId)}</b>
            <span className="small muted">{time(current.time)} · {t('floor.min', { n: current.minutes })}</span>
            <div className="floor-bar" aria-hidden="true"><i style={{ width: progress(atTime(current), current.minutes) + '%' }} /></div>
            {mayWrite && atTime(current) <= now && <Button size="sm" variant="primary" icon={<LuCircleCheck aria-hidden="true" />} onClick={() => onCheckout({ appt: current })} data-testid="floor-finish-appt">{t('floor.finish')}</Button>}
          </div>
        ) : called ? (
          <div className="floor-now called">
            <span className="xs dim">{t('floor.calledTo')}</span>
            <b>#{called.ticket} {called.name}</b>
            <span className="small muted">{t('floor.calledAgo', { n: minutesAgo(called.calledAt) })}</span>
            {mayWrite && <span className="row tight"><Button size="sm" variant="primary" icon={<LuUserCheck aria-hidden="true" />} onClick={() => start(called)} data-testid="floor-start">{t('floor.start')}</Button><Button size="sm" icon={<LuUndo2 aria-hidden="true" />} onClick={() => back(called)}>{t('floor.backToLine')}</Button></span>}
          </div>
        ) : (
          <div className="floor-now idle"><span className="small muted">{chair.status === 'off' ? t('floor.chair.offHint') : chair.status === 'break' ? t('floor.chair.breakHint') : t('floor.chair.free')}</span></div>
        )}
        <dl className="floor-next">
          {nextWalk && <><dt>{t('floor.nextWalk')}</dt><dd>#{nextWalk.ticket} {nextWalk.name} <span className="dim">· {t('floor.inMin', { n: nextLine!.wait })}</span></dd></>}
          {nextAppt && <><dt>{t('floor.nextAppt')}</dt><dd>{time(nextAppt.time)} {client(nextAppt.clientId)}</dd></>}
        </dl>
        {mayWrite && !seated && !called && !current && nextWalk && chair.status !== 'off' && (
          <Button size="sm" icon={<LuBellRing aria-hidden="true" />} onClick={call} data-testid="floor-call">{t('floor.callNext')}</Button>
        )}
      </div>
    </article>
  );
}

/* =====================================================================================================================
   The line
   ===================================================================================================================== */

function LineRow({ w, plan, mayWrite }: { w: WalkIn; plan: ReturnType<typeof planQueue>; mayWrite: boolean }) {
  const { t, data, lang } = useApp();
  const l = plan.lines.find((x) => x.walkinId === w.id);
  const chair = (data.chairs ?? []).find((c) => c.id === (w.chairId ?? l?.chairId));
  const pref = barberOf(data, w.prefStaffId);
  const drop = async (why: 'left' | 'no_show') => {
    if (!(await confirmDialog(t('floor.drop.' + why + '.ask', { name: w.name }), t('floor.drop.' + why), t('common.cancel'), false))) return;
    const r = act(dropWalkIn, w.id, why); toast(r.ok ? t('floor.drop.' + why + '.done') : t(err(r.reason)), !r.ok);
  };
  const callTo = (chairId: string) => { const r = act(callWalkIn, w.id, chairId); toast(r.ok ? t('floor.called', { name: w.name, chair: data.chairs.find((c) => c.id === chairId)?.label ?? '' }) : t(err(r.reason)), !r.ok); };
  const anyone = () => { const r = act(setPreference, w.id, undefined); if (!r.ok) toast(t(err(r.reason)), true); };
  return (
    <li className={cx('floor-wait', w.status)} data-walkin={w.id} data-status={w.status}>
      <span className="floor-ticket" aria-label={t('floor.ticket', { n: w.ticket })}><LuTicket aria-hidden="true" />{w.ticket}</span>
      <div className="grow">
        <b>{w.clientId ? <A to={'/clients/' + w.clientId}>{w.name}</A> : w.name}</b>
        <div className="small muted">
          {serviceName(data, w.serviceId, lang) || t('floor.anyService')}
          {pref && <> · {t('floor.asked', { name: pref.name })}</>}
          {' · '}{t('floor.joined', { n: minutesAgo(w.joined) })}
          {w.source !== 'desk' && <> · {t('floor.src.' + w.source)}</>}
        </div>
        {w.note && <div className="xs dim">{w.note}</div>}
      </div>
      <div className="floor-wait-r">
        {w.status === 'called' ? <Badge tone="info">{t('floor.calledShort', { chair: chair?.label ?? '' })}</Badge>
          : l && l.wait >= 0 ? <Badge tone={l.wait >= 45 ? 'warn' : 'ok'}><LuTimer aria-hidden="true" /> {t('floor.approx', { n: l.wait })}</Badge>
          : <Badge tone="bad">{t('floor.noBarber')}</Badge>}
        {l?.staffId && w.status === 'waiting' && <span className="xs dim">{t('floor.with', { name: barberOf(data, l.staffId)?.name ?? '' })}</span>}
        {mayWrite && w.status === 'waiting' && (
          <Menu label={t('floor.actionsFor', { name: w.name })} button={<Button size="sm" data-testid="floor-line-menu">{t('common.actions')}</Button>}>
            {(close) => <>
              {workingChairs(data).filter((c) => !inChair(data).some((x) => x.chairId === c.id)).map((c) => (
                <button key={c.id} type="button" role="menuitem" onClick={() => { callTo(c.id); close(); }}><LuBellRing aria-hidden="true" />{t('floor.callTo', { chair: c.label, name: barberOf(data, c.staffId)?.name ?? '' })}</button>
              ))}
              {w.prefStaffId && <button type="button" role="menuitem" onClick={() => { anyone(); close(); }}><LuUsers aria-hidden="true" />{t('floor.anyBarber')}</button>}
              <button type="button" role="menuitem" onClick={() => { void drop('left'); close(); }}><LuX aria-hidden="true" />{t('floor.drop.left')}</button>
            </>}
          </Menu>
        )}
        {mayWrite && w.status === 'called' && <button type="button" className="linkbtn xs" onClick={() => { void drop('no_show'); }}>{t('floor.drop.no_show')}</button>}
      </div>
    </li>
  );
}

function UpNext() {
  const { t, data, time } = useApp();
  const now = Date.now();
  const risky = new Set(atRisk(data).map((x) => x.appointment.id));
  const list = (data.appointments ?? []).filter((a) => a.date === today() && (a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'awaiting_payment') && atTime(a) > now)
    .sort((a, b) => atTime(a) - atTime(b)).slice(0, 6);
  return (
    <Card title={t('floor.upNext')} className="floor-upnext">
      {!list.length ? <p className="small muted">{t('floor.upNext.none')}</p> : (
        <ul className="floor-appts">
          {list.map((a) => (
            <li key={a.id}>
              <span className="floor-appt-t">{time(a.time)}</span>
              <span className="grow"><A to={'/appointments/' + a.id}>{data.clients.find((c) => c.id === a.clientId)?.name ?? ''}</A><span className="xs dim"> · {barberOf(data, a.staffId)?.name}</span></span>
              {risky.has(a.id) && <Badge tone="warn">{t('floor.missedBefore')}</Badge>}
              {a.status === 'confirmed' ? <Badge tone="ok">{t('floor.confirmed')}</Badge> : <Badge>{t('floor.notConfirmed')}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* =====================================================================================================================
   Adding someone to the line
   ===================================================================================================================== */

function AddWalkIn({ onClose }: { onClose: () => void }) {
  const { t, data, lang } = useApp();
  const services = (data.catalog ?? []).filter((s) => s.active && s.appointmentTypeId);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [sv, setSv] = useState(services[0]?.id ?? '');
  const [pref, setPref] = useState(''); const [textOk, setTextOk] = useState(false); const [bad, setBad] = useState('');
  const wait = quoteWait(data, sv || undefined, pref || undefined);
  const save = () => {
    if (!name.trim()) { setBad(t('floor.err.name')); return; }
    const r = act(addWalkIn, { name, phone, serviceId: sv || undefined, prefStaffId: pref || undefined, source: 'desk', textOk });
    if (!r.ok) { setBad(t(err(r.reason))); return; }
    toast(t('floor.added', { n: r.value.ticket, name: r.value.name })); onClose();
  };
  return (
    <Modal title={t('floor.add')} onClose={onClose} labelClose={t('common.close')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="floor-add-save">{t('floor.add.save')}</Button></>}>
      <div className="fgrid">
        <Field label={t('floor.f.name')} error={!!bad && !name.trim()} htmlFor="fw-name"><input id="fw-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="floor-add-name" data-autofocus /></Field>
        <Field label={t('floor.f.phone')} hint={t('floor.f.phoneHint')} htmlFor="fw-phone"><input id="fw-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="floor-add-phone" /></Field>
        <Field label={t('floor.f.service')} htmlFor="fw-sv"><select id="fw-sv" value={sv} onChange={(e) => setSv(e.target.value)} data-testid="floor-add-service">{services.map((s) => <option key={s.id} value={s.id}>{serviceName(data, s.id, lang)} · {money(priceOf(data, s.id))}</option>)}</select></Field>
        <Field label={t('floor.f.barber')} htmlFor="fw-pref"><select id="fw-pref" value={pref} onChange={(e) => setPref(e.target.value)} data-testid="floor-add-barber">
          <option value="">{t('floor.firstAvailable')}</option>
          {workingChairs(data).map((c) => <option key={c.id} value={c.staffId}>{barberOf(data, c.staffId)?.name}</option>)}
        </select></Field>
      </div>
      <label className="check floor-consent"><input type="checkbox" checked={textOk} onChange={(e) => setTextOk(e.target.checked)} disabled={!phone.trim()} data-testid="floor-add-text" /> <span>{t('floor.f.textOk')}</span></label>
      <div className="floor-quote" data-testid="floor-add-quote"><LuClock aria-hidden="true" /> {wait < 0 ? t('floor.quote.none') : t('floor.quote', { n: wait })}</div>
      {bad && <Note tone="bad">{bad}</Note>}
    </Modal>
  );
}

/* =====================================================================================================================
   Checkout at the chair
   ===================================================================================================================== */

function Checkout({ walkin, appt, onClose }: { walkin?: WalkIn; appt?: Appointment; onClose: () => void }) {
  const { t, data, lang } = useApp();
  const clientId = walkin?.clientId ?? appt?.clientId;
  const serviceId = walkin?.serviceId ?? (data.apptTypes ?? []).find((x) => x.id === appt?.typeId)?.serviceId;
  const base = appt ? appt.fee : priceOf(data, serviceId);
  const passes = usablePasses(data, clientId, serviceId);
  const alreadyPaid = !!appt?.paid;
  const [amount, setAmount] = useState(String(base || ''));
  const [tip, setTip] = useState('');
  const [method, setMethod] = useState<PayMethod | 'pass'>(passes.length && !alreadyPaid ? 'pass' : 'card');
  const [passId, setPassId] = useState(passes[0]?.id ?? '');
  const [own, setOwn] = useState(!!appt?.own);
  const [busy, setBusy] = useState(false);
  const amt = Number(amount) || 0;
  const pct = (p: number) => setTip(String(Math.round(amt * p) / 100));
  const passLabel = (id: string) => { const p = passes.find((x) => x.id === id); if (!p) return ''; const plan = (data.passPlans ?? []).find((x) => x.id === p.planId);
    return `${plan?.i18n?.[lang]?.name ?? plan?.name ?? t('mem.kind.gift_card')} · ${p.kind === 'gift_card' ? money2(p.balance) : p.visitsLeft === undefined ? t('mem.unlimited') : t('mem.left', { n: p.visitsLeft })}`; };
  const finish = async () => {
    if (method !== 'pass' && !alreadyPaid && !(amt >= 0)) { toast(t('floor.err.invalid'), true); return; }
    setBusy(true);
    try {
      if (walkin) {
        const r = act(finishWalkIn, walkin.id, { amount: method === 'pass' ? 0 : amt, tip: Number(tip) || 0, method, passId: method === 'pass' ? passId : undefined });
        if (!r.ok) { toast(t(err(r.reason)), true); return; }
        toast(t('floor.done', { name: walkin.name })); onClose(); return;
      }
      if (!appt) return;
      if (method !== 'pass' && !alreadyPaid && appt.fee > 0) {
        const out = await gateway().protected.apptMarkPaid(appt.id, { method, ref: '', amount: Math.max(amt, appt.fee) });
        if (!out.ok) { toast(t('floor.err.' + (out.reason === 'too_small' ? 'tooSmall' : 'failed')), true); return; }
      }
      const extras = act(setVisitExtras, appt.id, { tip: Number(tip) || 0, own, ...(method === 'pass' ? { passId } : {}) });
      if (!extras.ok) { toast(t(err(extras.reason)), true); return; }
      const done = act(completeAppointment, appt.id);
      if (!done.ok) { toast(t('floor.err.notYet'), true); return; }
      toast(t('floor.done', { name: data.clients.find((c) => c.id === appt.clientId)?.name ?? '' })); onClose();
    } finally { setBusy(false); }
  };
  return (
    <Modal title={t('floor.checkout')} onClose={onClose} labelClose={t('common.close')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => { void finish(); }} disabled={busy} data-testid="floor-checkout-save">{t('floor.checkout.save')}</Button></>}>
      <p className="small muted">{walkin ? `#${walkin.ticket} ${walkin.name}` : data.clients.find((c) => c.id === appt?.clientId)?.name} · {serviceName(data, serviceId, lang)}</p>
      <div className="fgrid">
        <Field label={t('floor.pay.method')} htmlFor="co-m"><select id="co-m" value={method} onChange={(e) => setMethod(e.target.value as PayMethod | 'pass')} disabled={alreadyPaid} data-testid="floor-checkout-method">
          {passes.length > 0 && <option value="pass">{t('floor.pay.pass')}</option>}
          {(['card', 'cash', 'zelle', 'transfer', 'check'] as PayMethod[]).map((m) => <option key={m} value={m}>{t('m_' + m)}</option>)}
        </select></Field>
        {method === 'pass' ? (
          <Field label={t('floor.pay.which')} htmlFor="co-p"><select id="co-p" value={passId} onChange={(e) => setPassId(e.target.value)} data-testid="floor-checkout-pass">{passes.map((p) => <option key={p.id} value={p.id}>{passLabel(p.id)}</option>)}</select></Field>
        ) : (
          <Field label={t('floor.pay.amount')} hint={alreadyPaid ? t('floor.pay.paidAlready') : undefined} htmlFor="co-a"><div className="ops-money"><span>$</span><input id="co-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={alreadyPaid} data-testid="floor-checkout-amount" /></div></Field>
        )}
        <Field label={t('floor.pay.tip')} hint={t('floor.pay.tipHint')} htmlFor="co-t" full>
          <div className="floor-tips">
            {[15, 18, 20, 25].map((p) => <button key={p} type="button" className="btn sm" onClick={() => pct(p)}>{p}%</button>)}
            <div className="ops-money"><span>$</span><input id="co-t" inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} data-testid="floor-checkout-tip" /></div>
          </div>
        </Field>
      </div>
      {appt && <label className="check"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> <span>{t('floor.pay.own')}</span></label>}
      {method === 'cash' && <p className="xs dim">{t('floor.pay.cashNote')}</p>}
    </Modal>
  );
}

/* =====================================================================================================================
   The kiosk: a tablet at the door, signed in by the shop, that guests use to join the line themselves
   ===================================================================================================================== */

function Kiosk({ onClose }: { onClose: () => void }) {
  const { t, data, lang } = useApp();
  const services = (data.catalog ?? []).filter((s) => s.active && s.appointmentTypeId && s.category !== 'group');
  const [step, setStep] = useState<'who' | 'what' | 'barber' | 'done'>('who');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [textOk, setTextOk] = useState(true);
  const [sv, setSv] = useState(''); const [ticket, setTicket] = useState<{ n: number; wait: number } | null>(null);
  const join = (pref?: string) => {
    const r = act(addWalkIn, { name, phone, serviceId: sv || undefined, prefStaffId: pref, source: 'kiosk', textOk: !!phone.trim() && textOk });
    if (!r.ok) { toast(t(err(r.reason)), true); return; }
    const wait = planQueue(data).lines.find((l) => l.walkinId === r.value.id)?.wait ?? quoteWait(data, sv, pref);
    setTicket({ n: r.value.ticket, wait }); setStep('done');
  };
  const reset = () => { setStep('who'); setName(''); setPhone(''); setSv(''); setTicket(null); setTextOk(true); };
  useEffect(() => { if (step !== 'done') return; const id = setTimeout(reset, 12000); return () => clearTimeout(id); }, [step]);
  return (
    <div className="floor-kiosk" role="dialog" aria-modal="true" aria-label={t('floor.kiosk')} data-testid="floor-kiosk-screen">
      <div className="floor-kiosk-top">
        <b>{data.company.name}</b>
        <button type="button" className="btn sm" onClick={async () => { if (await confirmDialog(t('floor.kiosk.exitAsk'), t('floor.kiosk.exit'), t('common.cancel'), false)) onClose(); }} data-testid="floor-kiosk-exit">{t('floor.kiosk.exit')}</button>
      </div>
      <div className="floor-kiosk-card">
        {!shopSettings(data).queueOpen ? <h1>{t('floor.kiosk.closed')}</h1> : step === 'who' ? (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep('what'); }}>
            <h1>{t('floor.kiosk.hello')}</h1>
            <p className="muted">{t('floor.kiosk.wait', { n: Math.max(0, quoteWait(data)) })}</p>
            <label className="floor-kiosk-in"><span>{t('floor.kiosk.name')}</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="kiosk-name" data-autofocus /></label>
            <label className="floor-kiosk-in"><span>{t('floor.kiosk.phone')}</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" data-testid="kiosk-phone" /></label>
            {phone.trim() && <label className="check"><input type="checkbox" checked={textOk} onChange={(e) => setTextOk(e.target.checked)} /> <span>{t('floor.f.textOk')}</span></label>}
            <Button variant="primary" type="submit" disabled={!name.trim()} data-testid="kiosk-next">{t('floor.kiosk.next')}</Button>
          </form>
        ) : step === 'what' ? (
          <div>
            <h1>{t('floor.kiosk.what')}</h1>
            <div className="floor-kiosk-tiles">
              {services.map((s) => <button key={s.id} type="button" className={cx('floor-tile', sv === s.id && 'on')} onClick={() => { setSv(s.id); setStep('barber'); }} data-testid={'kiosk-sv-' + s.id}>
                <b>{serviceName(data, s.id, lang)}</b><span>{money(priceOf(data, s.id))} · {t('floor.min', { n: minutesFor(data, s.id) })}</span></button>)}
            </div>
            <button type="button" className="linkbtn" onClick={() => setStep('who')}>{t('floor.kiosk.back')}</button>
          </div>
        ) : step === 'barber' ? (
          <div>
            <h1>{t('floor.kiosk.who')}</h1>
            <div className="floor-kiosk-tiles">
              <button type="button" className="floor-tile on" onClick={() => join()} data-testid="kiosk-first">
                <b>{t('floor.firstAvailable')}</b><span>{t('floor.approx', { n: Math.max(0, quoteWait(data, sv)) })}</span></button>
              {workingChairs(data).filter((c) => !(c.skipServiceIds ?? []).includes(sv)).map((c) => {
                const w = quoteWait(data, sv, c.staffId); const b = barberOf(data, c.staffId);
                return <button key={c.id} type="button" className="floor-tile" onClick={() => join(c.staffId)}><span className="floor-tile-av"><Avatar name={b?.name ?? ''} /></span><b>{b?.name}</b><span>{w < 0 ? '' : t('floor.approx', { n: w })}</span></button>;
              })}
            </div>
            <button type="button" className="linkbtn" onClick={() => setStep('what')}>{t('floor.kiosk.back')}</button>
          </div>
        ) : ticket && (
          <div className="floor-kiosk-done" data-testid="kiosk-done">
            <span className="floor-kiosk-ticket">#{ticket.n}</span>
            <h1>{t('floor.kiosk.in', { name: name.split(' ')[0] })}</h1>
            <p>{ticket.wait < 0 ? t('floor.quote.none') : t('floor.kiosk.approx', { n: ticket.wait })}</p>
            {phone.trim() && textOk && <p className="muted">{t('floor.kiosk.willText')}</p>}
            <Button variant="primary" onClick={reset}>{t('floor.kiosk.another')}</Button>
          </div>
        )}
      </div>
      <p className="floor-kiosk-foot">{t('floor.kiosk.privacy')}</p>
    </div>
  );
}

/* =====================================================================================================================
   The display in the waiting area: first names and an initial only, never a phone number
   ===================================================================================================================== */

function WaitingScreen({ onClose }: { onClose: () => void }) {
  const { t, data } = useApp();
  useClock(15000);
  const plan = planQueue(data);
  const serving = inChair(data);
  const called = inLine(data).filter((w) => w.status === 'called');
  const waiting = inLine(data).filter((w) => w.status === 'waiting').slice(0, 8);
  const full = () => { const el = document.querySelector('.floor-tv') as HTMLElement | null; void el?.requestFullscreen?.().catch(() => undefined); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const clock = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="floor-tv" role="dialog" aria-modal="true" aria-label={t('floor.screen')} data-testid="floor-screen-view">
      <header><b>{data.company.name}</b><span className="floor-tv-clock">{clock}</span>
        <span className="row tight"><IconButton label={t('floor.screen.full')} onClick={full}><LuMaximize /></IconButton><IconButton label={t('common.close')} onClick={onClose}><LuX /></IconButton></span></header>
      <div className="floor-tv-grid">
        <section><h2>{t('floor.tv.now')}</h2>
          {[...called.map((w) => ({ w, called: true })), ...serving.map((w) => ({ w, called: false }))].map(({ w, called: c }) => (
            <div key={w.id} className={cx('floor-tv-row', c && 'call')}><span className="floor-tv-n">#{w.ticket}</span><b>{displayName(w.name)}</b><span>{(data.chairs ?? []).find((x) => x.id === w.chairId)?.label}</span>{c && <em>{t('floor.tv.goTo')}</em>}</div>
          ))}
          {!serving.length && !called.length && <p className="muted">{t('floor.tv.nobody')}</p>}
        </section>
        <section><h2>{t('floor.tv.next')}</h2>
          {waiting.map((w) => { const l = plan.lines.find((x) => x.walkinId === w.id); return (
            <div key={w.id} className="floor-tv-row"><span className="floor-tv-n">#{w.ticket}</span><b>{displayName(w.name)}</b><span>{l && l.wait >= 0 ? t('floor.approx', { n: l.wait }) : ''}</span></div>
          ); })}
          {!waiting.length && <p className="muted">{t('floor.tv.empty')}</p>}
        </section>
      </div>
      <footer>{t('floor.tv.foot')}</footer>
    </div>
  );
}

/* =====================================================================================================================
   Insights
   ===================================================================================================================== */

function Insights() {
  const { t, data, date, time, lang, can } = useApp();
  const due = dueForCut(data);
  const risk = atRisk(data);
  const grid = busyHours(data);
  const hours = Array.from({ length: 12 }, (_, i) => 9 + i);
  const max = Math.max(1, ...grid.flatMap((r) => hours.map((h) => r[h])));
  const days = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang === 'es' ? 'es-US' : lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' }));
  const barbers = (data.chairs ?? []).filter((c) => c.staffId).map((c) => ({ c, u: barberOf(data, c.staffId)!, load: chairLoad(data, c.staffId!) }));
  // what sold best in the last 30 days, from finished visits
  const since = addDaysFrom(today(), -30);
  const top = useMemo(() => {
    const m = new Map<string, { n: number; total: number }>();
    for (const a of data.appointments ?? []) if (a.status === 'completed' && a.date >= since) { const sv = (data.apptTypes ?? []).find((x) => x.id === a.typeId)?.serviceId ?? ''; const e = m.get(sv) ?? { n: 0, total: 0 }; e.n++; e.total += a.fee; m.set(sv, e); }
    for (const w of data.walkins ?? []) if (w.status === 'done' && (w.doneAt ?? '').slice(0, 10) >= since) { const e = m.get(w.serviceId ?? '') ?? { n: 0, total: 0 }; e.n++; e.total += w.amount ?? 0; m.set(w.serviceId ?? '', e); }
    return [...m.entries()].filter(([k]) => k).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  }, [data, since]);
  const topMax = Math.max(1, ...top.map(([, v]) => v.total));
  const draft = (clientId: string, gap: number, barber: string) => {
    const c = data.clients.find((x) => x.id === clientId); if (!c) return;
    const r = act(queueMessage, { channel: 'text', to: '', personal: true, ref: { type: 'client', id: c.id }, clientId: c.id, mode: 'draft', body: t('floor.rebook.body', { name: c.name.split(' ')[0], days: gap, barber, company: data.company.name }) });
    toast(r.ok ? t('floor.rebook.done', { name: c.name }) : t('floor.rebook.no.' + (['no_consent', 'no_address', 'channel_off', 'opted_out'].includes(r.reason) ? r.reason : 'other'), { name: c.name }), !r.ok);
  };
  return (
    <div className="floor-ins">
      <Card title={<><LuUsers aria-hidden="true" /> {t('floor.ins.due')}</>} flush className="floor-due">
        <p className="small muted floor-pad">{t('floor.ins.dueHint')}</p>
        {!due.length ? <Empty title={t('floor.ins.dueNone')} /> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="floor-due">
            <thead><tr><th>{t('floor.col.client')}</th><th>{t('floor.col.last')}</th><th className="num">{t('floor.col.every')}</th><th className="num">{t('floor.col.overdue')}</th><th>{t('floor.col.barber')}</th><th aria-label={t('common.actions')} /></tr></thead>
            <tbody>{due.slice(0, 12).map((x) => (
              <tr key={x.client.id}>
                <td className="t1"><A to={'/clients/' + x.client.id}>{x.client.name}</A></td>
                <td data-label={t('floor.col.last')}>{date(x.last)}</td>
                <td data-label={t('floor.col.every')} className="num">{t('floor.days', { n: x.gap })}</td>
                <td data-label={t('floor.col.overdue')} className="num"><Badge tone={x.overdue > 21 ? 'bad' : x.overdue > 7 ? 'warn' : 'neutral'}>{t('floor.days', { n: x.overdue })}</Badge></td>
                <td data-label={t('floor.col.barber')} className="small">{barberOf(data, x.staffId)?.name ?? ''}</td>
                <td className="num">{can('write') && can('comms') && <Button size="sm" onClick={() => draft(x.client.id, x.gap, barberOf(data, x.staffId)?.name ?? '')} data-testid="floor-rebook">{t('floor.rebook')}</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <div className="grid2">
        <Card title={<><LuFlame aria-hidden="true" /> {t('floor.ins.busy')}</>}>
          <p className="small muted">{t('floor.ins.busyHint')}</p>
          <div className="floor-heat" role="table" aria-label={t('floor.ins.busy')} data-testid="floor-heat">
            <div role="row" className="floor-heat-row head"><span role="columnheader" />{hours.map((h) => <span role="columnheader" key={h}>{time(`${String(h).padStart(2, '0')}:00`).replace(':00', '')}</span>)}</div>
            {grid.map((row, i) => (
              <div role="row" className="floor-heat-row" key={i}><span role="rowheader">{days[i]}</span>
                {hours.map((h) => <span role="cell" key={h} title={`${days[i]} ${h}:00 · ${row[h]}`} style={{ opacity: 0.12 + (row[h] / max) * 0.88 }} className={cx('floor-heat-c', row[h] === 0 && 'zero')}><i className="floor-sr">{row[h]}</i></span>)}
              </div>
            ))}
          </div>
        </Card>
        <Card title={<><LuArmchair aria-hidden="true" /> {t('floor.ins.load')}</>}>
          <p className="small muted">{t('floor.ins.loadHint')}</p>
          <ul className="floor-bars">{barbers.map(({ c, u, load }) => (
            <li key={c.id}><span className="floor-bars-l">{u?.name}</span><span className="floor-bars-b" aria-hidden="true"><i style={{ width: Math.round(load * 100) + '%' }} className={cx(load > 0.85 && 'hot')} /></span><span className="floor-bars-v">{Math.round(load * 100)}%</span></li>
          ))}</ul>
        </Card>
        <Card title={<><LuTimer aria-hidden="true" /> {t('floor.ins.risk')}</>}>
          <p className="small muted">{t('floor.ins.riskHint', { n: shopSettings(data).noShowLimit })}</p>
          {!risk.length ? <p className="small">{t('floor.ins.riskNone')}</p> : (
            <ul className="floor-appts">{risk.slice(0, 8).map(({ appointment: a, misses }) => (
              <li key={a.id}><span className="floor-appt-t">{daysBetween(today(), a.date) === 0 ? time(a.time) : date(a.date)}</span>
                <span className="grow"><A to={'/appointments/' + a.id}>{data.clients.find((c) => c.id === a.clientId)?.name}</A></span>
                <Badge tone={misses >= shopSettings(data).noShowLimit ? 'bad' : 'warn'}>{t('floor.misses', { n: misses })}</Badge></li>
            ))}</ul>
          )}
        </Card>
        <Card title={t('floor.ins.top')}>
          <p className="small muted">{t('floor.ins.topHint')}</p>
          <ul className="floor-bars">{top.map(([id, v]) => (
            <li key={id}><span className="floor-bars-l">{serviceName(data, id, lang)}</span><span className="floor-bars-b" aria-hidden="true"><i style={{ width: Math.round((v.total / topMax) * 100) + '%' }} /></span><span className="floor-bars-v">{money(v.total)} · {v.n}</span></li>
          ))}</ul>
        </Card>
      </div>
    </div>
  );
}

/* =====================================================================================================================
   History
   ===================================================================================================================== */

function History() {
  const { t, data, lang, dateTime } = useApp();
  const [day, setDay] = useState(today());
  const list = walkinsOn(data, day).slice().reverse();
  const waited = (w: WalkIn) => (w.startedAt ? Math.round((new Date(w.startedAt).getTime() - new Date(w.joined).getTime()) / 60000) : null);
  const tone: Record<WalkIn['status'], Tone> = { waiting: 'info', called: 'info', in_service: 'info', done: 'ok', left: 'warn', no_show: 'bad' };
  return (
    <Card flush>
      <div className="filters floor-pad">
        <label className="floor-date"><span>{t('common.date')}</span><input type="date" className="input" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} data-testid="floor-history-day" /></label>
        <span className="grow" />
        <span className="small muted">{t('floor.hist.count', { n: list.length })}</span>
      </div>
      {!list.length ? <Empty title={t('floor.hist.empty')} /> : (
        <div className="table-wrap"><table className="tbl stackable" data-testid="floor-history">
          <thead><tr><th>#</th><th>{t('floor.col.client')}</th><th>{t('floor.f.service')}</th><th>{t('floor.col.barber')}</th><th>{t('floor.col.status')}</th><th className="num">{t('floor.col.waited')}</th><th className="num">{t('floor.pay.amount')}</th><th className="num">{t('floor.pay.tip')}</th></tr></thead>
          <tbody>{list.map((w) => (
            <tr key={w.id}>
              <td className="t1">{w.ticket}</td>
              <td data-label={t('floor.col.client')}>{w.clientId ? <A to={'/clients/' + w.clientId}>{w.name}</A> : w.name}<div className="xs dim">{dateTime(w.joined)} · {t('floor.src.' + w.source)}</div></td>
              <td data-label={t('floor.f.service')}>{serviceName(data, w.serviceId, lang)}</td>
              <td data-label={t('floor.col.barber')}>{barberOf(data, w.staffId)?.name ?? ''}</td>
              <td data-label={t('floor.col.status')}><Badge tone={tone[w.status]}>{t('floor.ws.' + w.status)}</Badge></td>
              <td data-label={t('floor.col.waited')} className="num">{waited(w) === null ? '' : t('floor.min', { n: waited(w)! })}</td>
              <td data-label={t('floor.pay.amount')} className="num">{w.status === 'done' ? (w.method === 'pass' ? <span title={t('floor.pay.pass')}>{money2(w.amount)} *</span> : money2(w.amount)) : ''}</td>
              <td data-label={t('floor.pay.tip')} className="num">{w.status === 'done' ? money2(w.tip) : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="xs dim floor-pad">{t('floor.hist.note')}</p>
    </Card>
  );
}

/* =====================================================================================================================
   Chairs and queue settings
   ===================================================================================================================== */

function Setup() {
  const { t, data, lang } = useApp();
  const [edit, setEdit] = useState<Chair | 'new' | null>(null);
  const s = shopSettings(data);
  const [form, setForm] = useState<ShopSettings>(s);
  const num = (k: keyof ShopSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const saveSettings = () => { const r = act(saveShopSettings, form); toast(r.ok ? t('floor.set.saved') : t(err(r.reason)), !r.ok); };
  return (
    <div className="floor-setup">
      <Card title={t('floor.chairs')} actions={<Button size="sm" icon={<LuPlus aria-hidden="true" />} onClick={() => setEdit('new')} data-testid="floor-chair-new">{t('floor.chairs.add')}</Button>} flush>
        <div className="table-wrap"><table className="tbl stackable" data-testid="floor-chairs-table">
          <thead><tr><th>{t('floor.col.chair')}</th><th>{t('floor.col.barber')}</th><th>{t('floor.col.pay')}</th><th>{t('floor.col.walkins')}</th><th aria-label={t('common.actions')} /></tr></thead>
          <tbody>{(data.chairs ?? []).map((c) => (
            <tr key={c.id}>
              <td className="t1">{c.label}</td>
              <td data-label={t('floor.col.barber')}>{barberOf(data, c.staffId)?.name ?? <span className="muted">{t('floor.chair.nobody')}</span>}</td>
              <td data-label={t('floor.col.pay')} className="small">{c.pay === 'rent' ? t('floor.pay.rentLine', { amount: money(c.rent) }) : t('floor.pay.splitLine', { split: c.split, own: c.ownSplit })}{c.skipServiceIds?.length ? <div className="xs dim">{t('floor.skips', { list: c.skipServiceIds.map((x) => serviceName(data, x, lang)).join(', ') })}</div> : null}</td>
              <td data-label={t('floor.col.walkins')}>{c.walkIns ? t('common.yes') : t('common.no')}</td>
              <td className="num"><IconButton size="sm" label={`${t('common.edit')}: ${c.label}`} onClick={() => setEdit(c)}><LuPencil /></IconButton></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card title={<><LuSettings2 aria-hidden="true" /> {t('floor.set.title')}</>}>
        <div className="fgrid">
          {(['buffer', 'defaultMinutes', 'rebookDays', 'noShowLimit', 'pointsPerDollar', 'rewardPoints', 'rewardValue', 'lowVisits', 'lowBalance'] as (keyof ShopSettings)[]).map((k) => (
            <Field key={k} label={t('floor.set.' + k)} hint={t('floor.set.' + k + '.hint')} htmlFor={'fs-' + k}><input id={'fs-' + k} className="input" type="number" min={0} value={String(form[k])} onChange={num(k)} data-testid={'floor-set-' + k} /></Field>
          ))}
        </div>
        <div className="row"><span className="grow" /><Button variant="primary" onClick={saveSettings} data-testid="floor-set-save">{t('common.save')}</Button></div>
      </Card>
      {edit && <ChairForm chair={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ChairForm({ chair, onClose }: { chair?: Chair; onClose: () => void }) {
  const { t, data, lang } = useApp();
  const [v, setV] = useState({ label: chair?.label ?? t('floor.chair.n', { n: (data.chairs ?? []).length + 1 }), staffId: chair?.staffId ?? '', walkIns: chair?.walkIns ?? true, pay: chair?.pay ?? 'commission' as Chair['pay'],
    split: chair?.split ?? 50, ownSplit: chair?.ownSplit ?? 90, rent: chair?.rent ?? 0, skip: chair?.skipServiceIds ?? [] as string[] });
  const people = data.users.filter((u) => u.active !== false);
  const save = () => { const r = act(saveChair, { id: chair?.id, ...v, staffId: v.staffId || undefined }); if (!r.ok) { toast(t(err(r.reason)), true); return; } toast(t('common.saved')); onClose(); };
  return (
    <Modal title={chair ? t('floor.chairs.edit', { chair: chair.label }) : t('floor.chairs.add')} onClose={onClose} labelClose={t('common.close')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="floor-chair-save">{t('common.save')}</Button></>}>
      <div className="fgrid">
        <Field label={t('floor.col.chair')} htmlFor="cf-l"><input id="cf-l" className="input" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <Field label={t('floor.col.barber')} htmlFor="cf-b"><select id="cf-b" value={v.staffId} onChange={(e) => setV({ ...v, staffId: e.target.value })}><option value="">{t('floor.chair.nobody')}</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label={t('floor.col.pay')} htmlFor="cf-p"><select id="cf-p" value={v.pay} onChange={(e) => setV({ ...v, pay: e.target.value as Chair['pay'] })}><option value="commission">{t('floor.pay.commission')}</option><option value="rent">{t('floor.pay.rent')}</option></select></Field>
        {v.pay === 'commission' ? <>
          <Field label={t('floor.pay.split')} hint={t('floor.pay.splitHint')} htmlFor="cf-s"><input id="cf-s" className="input" type="number" min={0} max={100} value={v.split} onChange={(e) => setV({ ...v, split: Number(e.target.value) })} /></Field>
          <Field label={t('floor.pay.ownSplit')} hint={t('floor.pay.ownSplitHint')} htmlFor="cf-o"><input id="cf-o" className="input" type="number" min={0} max={100} value={v.ownSplit} onChange={(e) => setV({ ...v, ownSplit: Number(e.target.value) })} /></Field>
        </> : <Field label={t('floor.pay.rentWeek')} htmlFor="cf-r"><div className="ops-money"><span>$</span><input id="cf-r" inputMode="decimal" value={String(v.rent)} onChange={(e) => setV({ ...v, rent: Number(e.target.value) || 0 })} /></div></Field>}
      </div>
      <label className="check"><input type="checkbox" checked={v.walkIns} onChange={(e) => setV({ ...v, walkIns: e.target.checked })} /> <span>{t('floor.chair.takesWalkins')}</span></label>
      <fieldset className="floor-skip"><legend className="small">{t('floor.chair.skip')}</legend>
        {(data.catalog ?? []).filter((s) => s.active && s.appointmentTypeId).map((s) => (
          <label key={s.id} className="check"><input type="checkbox" checked={v.skipServiceIds.includes(s.id)} onChange={(e) => setV({ ...v, skipServiceIds: e.target.checked ? [...v.skipServiceIds, s.id] : v.skipServiceIds.filter((x) => x !== s.id) })} /> <span>{serviceName(data, s.id, lang)}</span></label>
        ))}
      </fieldset>
    </Modal>
  );
}

