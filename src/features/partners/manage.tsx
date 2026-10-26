// Partners (a utility for VYNTEX partner staff): create a partner, invite its people (a one-time link, emailed),
// record its W-9 and agreement state (administrators only), suspend, reinstate or revoke it with a reason. Suspension
// ends every session of the partner's people at once; nothing financial is ever deleted.
import { useMemo, useState } from 'react';
import { LuBan, LuFileCheck, LuPause, LuPencil, LuPlay, LuPlus, LuSearchX, LuSend, LuUsers } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Button, Field, Modal, Note, SearchBox, toast } from '@/ui';
import { api, type Context, type PartnerOrg } from './api';
import { Failed, Loading, Status, useErrorText, useLoad } from './shared';
import { AsyncButton, AvatarStack, Chips, CopyField, EmptyState, Initials, PageHead, Panel, RowMenu, SortTh, useSort } from './ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ManagePage({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const admin = ctx.role === 'partner_admin';
  const data = useLoad(() => api.admin.get<{ partners: PartnerOrg[] }>('partners'), []);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'all' | 'active' | 'suspended' | 'revoked'>('all');
  const [editing, setEditing] = useState<PartnerOrg | 'new' | null>(null);
  const [inviting, setInviting] = useState<PartnerOrg | null>(null);
  const [compliance, setCompliance] = useState<PartnerOrg | null>(null);
  const [status, setStatus] = useState<{ p: PartnerOrg; to: string } | null>(null);
  const all = data.data?.partners ?? [];
  const list = useMemo(() => all.filter((p) => (show === 'all' || p.status === show)
    && (!q.trim() || `${p.name} ${p.code} ${p.contact_email} ${p.users.map((u) => u.email).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))), [all, q, show]);
  const { sorted, sort, toggle } = useSort(list, { name: (p) => p.name, lane: (p) => t('pp.lane.' + p.kind), people: (p) => p.users.length, status: (p) => p.status });
  const done = () => { setEditing(null); setInviting(null); setCompliance(null); setStatus(null); void data.reload(); };
  const n = (s: string) => all.filter((p) => p.status === s).length;
  return (
    <div className="pp-stack">
      <PageHead title={t('pp.nav.partners')} sub={t('pp.mg.sub')}
        actions={<Button variant="primary" icon={<LuPlus />} onClick={() => setEditing('new')} data-testid="pp-partner-new">{t('pp.mg.new')}</Button>} />
      {data.error && <Failed text={data.error} retry={data.reload} />}
      <Panel flush title={t('pp.mg.list')} count={data.data ? all.length : undefined}
        tools={<>
          <Chips label={t('pp.filter.status')} value={show} onChange={setShow} options={[{ value: 'all', label: t('pp.cat.all'), count: all.length },
            { value: 'active', label: t('pp.st.active'), count: n('active') }, { value: 'suspended', label: t('pp.st.suspended'), count: n('suspended') }, { value: 'revoked', label: t('pp.st.revoked'), count: n('revoked') }]} />
          <div className="pp-search"><SearchBox value={q} onChange={setQ} placeholder={t('pp.mg.search')} label={t('pp.mg.search')} /></div>
        </>}>
        {!data.data && !data.error ? <Loading kind="table" /> : !all.length ? (
          <EmptyState icon={<LuUsers />} title={t('pp.mg.none')} body={t('pp.mg.noneBody')} action={<Button variant="primary" icon={<LuPlus />} onClick={() => setEditing('new')}>{t('pp.mg.new')}</Button>} />
        ) : !list.length ? (
          <EmptyState icon={<LuSearchX />} title={t('pp.noMatch')} action={<Button size="sm" onClick={() => { setQ(''); setShow('all'); }}>{t('pp.clearFilters')}</Button>} />
        ) : (
          <div className="pp-tw"><table className="tbl pp-table stackable" data-testid="pp-partners">
            <thead><tr>
              <SortTh k="name" sort={sort} onSort={toggle} className="w-partner">{t('pp.col.partner')}</SortTh>
              <SortTh k="lane" sort={sort} onSort={toggle}>{t('pp.mg.lane')}</SortTh>
              <SortTh k="people" sort={sort} onSort={toggle} className="w-people">{t('pp.mg.people')}</SortTh>
              <th>{t('pp.mg.compliance')}</th>
              <SortTh k="status" sort={sort} onSort={toggle}>{t('pp.col.status')}</SortTh>
              <th className="pp-actions-h"><span className="sr">{t('pp.col.actions')}</span></th>
            </tr></thead>
            <tbody>{sorted.map((p) => (
                <tr key={p.id}>
                  <td className="t1 w-partner">
                    <div className="pp-who-cell"><Initials name={p.name} />
                      <div className="pp-who-t"><span className="pp-who-n"><b>{p.name}</b><span className="pp-code">{p.code}</span></span>
                        <span className="xs dim pp-who-c">{[p.contact_name, p.contact_email, p.contact_phone].filter(Boolean).join(' · ')}</span></div></div>
                  </td>
                  <td data-label={t('pp.mg.lane')}><span className="pp-lane" data-lane={p.kind}>{t('pp.lane.' + p.kind)}</span></td>
                  <td className="w-people" data-label={t('pp.mg.people')}>
                    {p.users.length ? (
                      <div className="pp-people"><AvatarStack names={p.users.map((u) => u.name || u.email)} />
                        <span className="small">{p.users.length === 1 ? <>{p.users[0].name || p.users[0].email} <span className="xs dim">{t('pp.role.' + p.users[0].role)}</span></> : t('pp.mg.nPeople', { n: p.users.length })}</span>
                        {p.users.some((u) => u.status !== 'active') && <span className="xs dim">{p.users.filter((u) => u.status !== 'active').map((u) => `${u.name || u.email}: ${t('pp.st.' + u.status)}`).join(', ')}</span>}</div>
                    ) : <span className="small dim">{t('pp.mg.nobody')}</span>}
                    {p.invitations.map((i) => <div key={i.id} className={'xs pp-inv' + (i.expired ? ' expired' : '')}>{t(i.expired ? 'pp.mg.invExpired' : 'pp.mg.invOpen', { email: i.email, date: dateTime(i.expires_at) })}</div>)}
                  </td>
                  <td data-label={t('pp.mg.compliance')}>
                    <div className="pp-comp"><Status value={p.w9} prefix={t('pp.mg.w9')} /><Status value={p.agreement} prefix={t('pp.mg.agreementShort')} />
                      {p.payout_eligible && <span className="pp-st ok"><i aria-hidden="true" />{t('pp.mg.payoutReady')}</span>}</div>
                  </td>
                  <td data-label={t('pp.col.status')}><Status value={p.status} />{p.status_reason && <div className="xs dim pp-reason" title={p.status_reason}>{p.status_reason}</div>}</td>
                  <td className="pp-actions">
                    <div className="pp-rowact">
                      {p.status === 'active'
                        ? <Button size="sm" icon={<LuSend />} onClick={() => setInviting(p)}>{t('pp.mg.invite')}</Button>
                        : <Button size="sm" icon={<LuPencil />} onClick={() => setEditing(p)}>{t('pp.adm.edit')}</Button>}
                      <RowMenu label={t('pp.more')} items={[
                        { label: t('pp.adm.edit'), icon: <LuPencil aria-hidden="true" />, onSelect: () => setEditing(p), hidden: p.status !== 'active' },
                        { label: t('pp.mg.compliance'), icon: <LuFileCheck aria-hidden="true" />, onSelect: () => setCompliance(p), hidden: !admin },
                        { label: t('pp.mg.reinstate'), icon: <LuPlay aria-hidden="true" />, onSelect: () => setStatus({ p, to: 'active' }), hidden: !(admin && p.status === 'suspended') },
                        { label: t('pp.mg.suspend'), icon: <LuPause aria-hidden="true" />, onSelect: () => setStatus({ p, to: 'suspended' }), hidden: !(admin && p.status === 'active') },
                        { label: t('pp.mg.revoke'), icon: <LuBan aria-hidden="true" />, danger: true, onSelect: () => setStatus({ p, to: 'revoked' }), hidden: !(admin && p.status !== 'revoked') },
                      ]} />
                    </div>
                  </td>
                </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="xs dim pp-foot-note">{t('pp.mg.privacy')}</p>
      {editing && <EditPartner p={editing === 'new' ? null : editing} admin={admin} onClose={() => setEditing(null)} onDone={done} />}
      {inviting && <Invite p={inviting} onClose={() => setInviting(null)} onDone={() => void data.reload()} />}
      {compliance && <Compliance p={compliance} onClose={() => setCompliance(null)} onDone={done} />}
      {status && <StatusChange p={status.p} to={status.to} onClose={() => setStatus(null)} onDone={done} />}
    </div>
  );
}

function EditPartner({ p, admin, onClose, onDone }: { p: PartnerOrg | null; admin: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ name: p?.name ?? '', legal_name: p?.legal_name ?? '', kind: p?.kind ?? 'referral', contact_name: p?.contact_name ?? '', contact_email: p?.contact_email ?? '',
    contact_phone: p?.contact_phone ?? '', lang: p?.lang ?? 'en', internal_notes: p?.internal_notes ?? '' });
  const [err, setErr] = useState(''); const [tried, setTried] = useState(false);
  const badEmail = !!f.contact_email.trim() && !EMAIL.test(f.contact_email.trim());
  const go = async () => {
    setTried(true);
    if (!f.name.trim() || badEmail) return;
    const r = await api.admin.post('partners', { id: p?.id, ...f }); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r));
  };
  return (
    <Modal title={p ? p.name : t('pp.mg.new')} onClose={onClose} size="wide" labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" onClick={go} data-testid="mp-save">{t('pp.save')}</AsyncButton></>}>
      <div className="fgrid">
        <Field label={t('pp.mg.name')} htmlFor="mp-n" error={tried && !f.name.trim()} hint={tried && !f.name.trim() ? t('pp.v.required') : undefined}><input id="mp-n" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="mp-name" /></Field>
        <Field label={t('pp.mg.legal')} htmlFor="mp-l"><input id="mp-l" value={f.legal_name} maxLength={200} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></Field>
        <Field label={t('pp.mg.lane')} htmlFor="mp-k" hint={t('pp.mg.laneHint')}>
          <select id="mp-k" value={f.kind} disabled={!!p && !admin} onChange={(e) => setF({ ...f, kind: e.target.value as 'referral' | 'revshare' })}>
            <option value="referral">{t('pp.lane.referral')}</option><option value="revshare">{t('pp.lane.revshare')}</option>
          </select>
        </Field>
        <Field label={t('pp.f.lang')} htmlFor="mp-g"><select id="mp-g" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as 'en' | 'es' })}><option value="en">English</option><option value="es">Español</option></select></Field>
        <Field label={t('pp.f.contact')} htmlFor="mp-c"><input id="mp-c" value={f.contact_name} maxLength={200} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
        <Field label={t('pp.f.email')} htmlFor="mp-e" error={badEmail && (tried || f.contact_email.length > 5)} hint={badEmail && (tried || f.contact_email.length > 5) ? t('pp.v.email') : undefined}><input id="mp-e" type="email" value={f.contact_email} maxLength={320} onChange={(e) => setF({ ...f, contact_email: e.target.value })} data-testid="mp-email" /></Field>
        <Field label={t('pp.f.phone')} htmlFor="mp-p"><input id="mp-p" value={f.contact_phone} maxLength={40} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        <Field label={t('pp.mg.notes')} htmlFor="mp-x" full hint={t('pp.mg.notesHint')}><textarea id="mp-x" rows={3} maxLength={4000} value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} /></Field>
      </div>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

function Invite({ p, onClose, onDone }: { p: PartnerOrg; onClose: () => void; onDone: () => void }) {
  const { t, dateTime } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ email: '', name: '', role: p.users.some((u) => u.role === 'partner_owner') ? 'partner_member' : 'partner_owner', lang: p.lang });
  const [out, setOut] = useState<{ link: string; delivery: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState('');
  const badEmail = !!f.email.trim() && !EMAIL.test(f.email.trim());
  const go = async () => { const r = await api.admin.post<{ link: string; delivery: string; expiresAt: string }>(`partners/${p.id}/invite`, f); if (r.ok) { setOut(r.data); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.mg.inviteTitle', { name: p.name })} onClose={onClose} labelClose={t('pp.close')}
      footer={out ? <Button variant="primary" onClick={onClose}>{t('pp.close')}</Button>
        : <><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" icon={<LuSend />} onClick={go} disabled={!f.email.trim() || badEmail} data-testid="mi-send">{t('pp.mg.send')}</AsyncButton></>}>
      {out ? (
        <div className="pp-stack tight">
          <Note>{t(out.delivery === 'sent' ? 'pp.mg.inviteSent' : 'pp.mg.inviteManual', { email: f.email })}</Note>
          <Field label={t('pp.mg.link')} htmlFor="mi-l" hint={t('pp.mg.linkHint', { date: dateTime(out.expiresAt) })}>
            <CopyField id="mi-l" value={out.link} label={t('pp.mg.link')} />
          </Field>
        </div>
      ) : (
        <>
          <p className="small muted">{t('pp.mg.inviteIntro')}</p>
          <div className="fgrid">
            <Field label={t('pp.f.email')} htmlFor="mi-e" error={badEmail && f.email.length > 5} hint={badEmail && f.email.length > 5 ? t('pp.v.email') : undefined}><input id="mi-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="mi-email" /></Field>
            <Field label={t('pp.mg.personName')} htmlFor="mi-n"><input id="mi-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('pp.mg.role')} htmlFor="mi-r"><select id="mi-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="partner_owner">{t('pp.role.partner_owner')}</option><option value="partner_member">{t('pp.role.partner_member')}</option></select></Field>
            <Field label={t('pp.f.lang')} htmlFor="mi-g"><select id="mi-g" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as 'en' | 'es' })}><option value="en">English</option><option value="es">Español</option></select></Field>
          </div>
          {err && <p className="pp-err" role="alert">{err}</p>}
        </>
      )}
    </Modal>
  );
}

function Compliance({ p, onClose, onDone }: { p: PartnerOrg; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ w9: p.w9, agreement: p.agreement, version: p.agreement_version }); const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post(`partners/${p.id}/compliance`, f); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.mg.complianceTitle', { name: p.name })} onClose={onClose} labelClose={t('pp.cancel')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant="primary" onClick={go}>{t('pp.save')}</AsyncButton></>}>
      <Note>{t('pp.mg.complianceNote')}</Note>
      <div className="fgrid">
        <Field label={t('pp.mg.w9')} htmlFor="mc-w"><select id="mc-w" value={f.w9} onChange={(e) => setF({ ...f, w9: e.target.value })}>{['missing', 'received', 'verified'].map((s) => <option key={s} value={s}>{t('pp.st.' + s)}</option>)}</select></Field>
        <Field label={t('pp.mg.agreement')} htmlFor="mc-a"><select id="mc-a" value={f.agreement} onChange={(e) => setF({ ...f, agreement: e.target.value })}>{['none', 'sent', 'signed', 'terminated'].map((s) => <option key={s} value={s}>{t('pp.st.' + s)}</option>)}</select></Field>
        <Field label={t('pp.mg.agreementVersion')} htmlFor="mc-v" full><input id="mc-v" value={f.version} maxLength={60} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
      </div>
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}

function StatusChange({ p, to, onClose, onDone }: { p: PartnerOrg; to: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post(`partners/${p.id}/status`, { status: to, reason }); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.mg.statusTitle', { name: p.name, to: t('pp.st.' + to) })} onClose={onClose} labelClose={t('pp.cancel')} size="narrow"
      footer={<><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><AsyncButton variant={to === 'active' ? 'primary' : 'danger'} onClick={go}>{t('pp.confirm')}</AsyncButton></>}>
      <Note tone={to === 'active' ? undefined : 'warn'}>{t('pp.mg.statusNote.' + to)}</Note>
      {to !== 'active' && <Field label={t('pp.com.reason')} htmlFor="ms-r"><textarea id="ms-r" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Modal>
  );
}
