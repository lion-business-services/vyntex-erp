// Partners (a utility for VYNTEX partner staff): create a partner, invite its people (a one-time link, emailed),
// record its W-9 and agreement state (administrators only), suspend, reinstate or revoke it with a reason. Suspension
// ends every session of the partner's people at once; nothing financial is ever deleted.
import { useState } from 'react';
import { LuCopy, LuPlus, LuSend } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Badge, Button, Card, Field, Modal, Note, SearchBox, toast } from '@/ui';
import { api, type Context, type PartnerOrg } from './api';
import { Failed, Loading, Status, useErrorText, useLoad } from './shared';

export default function ManagePage({ ctx }: { ctx: Context }) {
  const { t, dateTime } = useApp();
  const admin = ctx.role === 'partner_admin';
  const data = useLoad(() => api.admin.get<{ partners: PartnerOrg[] }>('partners'), []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PartnerOrg | 'new' | null>(null);
  const [inviting, setInviting] = useState<PartnerOrg | null>(null);
  const [compliance, setCompliance] = useState<PartnerOrg | null>(null);
  const [status, setStatus] = useState<{ p: PartnerOrg; to: string } | null>(null);
  if (data.error) return <Failed text={data.error} retry={data.reload} />;
  if (!data.data) return <Loading />;
  const list = data.data.partners.filter((p) => !q.trim() || `${p.name} ${p.code} ${p.contact_email} ${p.users.map((u) => u.email).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const done = () => { setEditing(null); setInviting(null); setCompliance(null); setStatus(null); void data.reload(); };
  return (
    <div className="pp-stack">
      <div className="pp-hero"><h1>{t('pp.nav.partners')}</h1><p className="muted">{t('pp.mg.sub')}</p></div>
      <Card flush title={t('pp.mg.list')} actions={<div className="row"><div className="pp-search"><SearchBox value={q} onChange={setQ} placeholder={t('pp.mg.search')} label={t('pp.mg.search')} /></div>
        <Button variant="primary" icon={<LuPlus />} onClick={() => setEditing('new')} data-testid="pp-partner-new">{t('pp.mg.new')}</Button></div>}>
        {!list.length ? <div className="pp-pad"><p className="small muted">{t('pp.mg.none')}</p></div> : (
          <div className="table-wrap"><table className="tbl" data-testid="pp-partners">
            <thead><tr><th>{t('pp.col.partner')}</th><th>{t('pp.mg.lane')}</th><th>{t('pp.mg.people')}</th><th>{t('pp.mg.compliance')}</th><th>{t('pp.col.status')}</th><th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b> <span className="xs dim">{p.code}</span><br /><span className="xs dim">{p.contact_name} {p.contact_email} {p.contact_phone}</span></td>
                <td>{t('pp.lane.' + p.kind)}</td>
                <td className="small">{p.users.map((u) => <div key={u.user_id}>{u.name || u.email} <span className="xs dim">{t('pp.role.' + u.role)}</span> {u.status !== 'active' && <Status value={u.status} />}</div>)}
                  {p.invitations.map((i) => <div key={i.id} className="xs dim">{t(i.expired ? 'pp.mg.invExpired' : 'pp.mg.invOpen', { email: i.email, date: dateTime(i.expires_at) })}</div>)}</td>
                <td className="small">{t('pp.mg.w9')}: <Status value={p.w9} /><br />{t('pp.mg.agreement')}: <Status value={p.agreement} />{p.payout_eligible && <><br /><Badge tone="ok">{t('pp.mg.payoutReady')}</Badge></>}</td>
                <td><Status value={p.status} />{p.status_reason && <><br /><span className="xs dim">{p.status_reason}</span></>}</td>
                <td className="nowrap">
                  <Button size="sm" onClick={() => setEditing(p)}>{t('pp.adm.edit')}</Button>
                  {p.status === 'active' && <Button size="sm" icon={<LuSend />} onClick={() => setInviting(p)}>{t('pp.mg.invite')}</Button>}
                  {admin && <Button size="sm" onClick={() => setCompliance(p)}>{t('pp.mg.compliance')}</Button>}
                  {admin && p.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setStatus({ p, to: 'suspended' })}>{t('pp.mg.suspend')}</Button>}
                  {admin && p.status === 'suspended' && <Button size="sm" onClick={() => setStatus({ p, to: 'active' })}>{t('pp.mg.reinstate')}</Button>}
                  {admin && p.status !== 'revoked' && <Button size="sm" variant="danger" onClick={() => setStatus({ p, to: 'revoked' })}>{t('pp.mg.revoke')}</Button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <p className="xs dim">{t('pp.mg.privacy')}</p>
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
  const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post('partners', { id: p?.id, ...f }); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={p ? p.name : t('pp.mg.new')} onClose={onClose} size="wide" labelClose={t('pp.cancel')}>
      <div className="fgrid">
        <Field label={t('pp.mg.name')} htmlFor="mp-n"><input id="mp-n" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="mp-name" /></Field>
        <Field label={t('pp.mg.legal')} htmlFor="mp-l"><input id="mp-l" value={f.legal_name} maxLength={200} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></Field>
        <Field label={t('pp.mg.lane')} htmlFor="mp-k" hint={t('pp.mg.laneHint')}>
          <select id="mp-k" value={f.kind} disabled={!!p && !admin} onChange={(e) => setF({ ...f, kind: e.target.value as 'referral' | 'revshare' })}>
            <option value="referral">{t('pp.lane.referral')}</option><option value="revshare">{t('pp.lane.revshare')}</option>
          </select>
        </Field>
        <Field label={t('pp.f.lang')} htmlFor="mp-g"><select id="mp-g" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as 'en' | 'es' })}><option value="en">English</option><option value="es">Español</option></select></Field>
        <Field label={t('pp.f.contact')} htmlFor="mp-c"><input id="mp-c" value={f.contact_name} maxLength={200} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
        <Field label={t('pp.f.email')} htmlFor="mp-e"><input id="mp-e" type="email" value={f.contact_email} maxLength={320} onChange={(e) => setF({ ...f, contact_email: e.target.value })} data-testid="mp-email" /></Field>
        <Field label={t('pp.f.phone')} htmlFor="mp-p"><input id="mp-p" value={f.contact_phone} maxLength={40} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        <Field label={t('pp.mg.notes')} htmlFor="mp-x" full hint={t('pp.mg.notesHint')}><textarea id="mp-x" rows={3} maxLength={4000} value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} /></Field>
      </div>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()} data-testid="mp-save">{t('pp.save')}</Button></div>
    </Modal>
  );
}

function Invite({ p, onClose, onDone }: { p: PartnerOrg; onClose: () => void; onDone: () => void }) {
  const { t, dateTime } = useApp();
  const errText = useErrorText();
  const [f, setF] = useState({ email: '', name: '', role: p.users.some((u) => u.role === 'partner_owner') ? 'partner_member' : 'partner_owner', lang: p.lang });
  const [out, setOut] = useState<{ link: string; delivery: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post<{ link: string; delivery: string; expiresAt: string }>(`partners/${p.id}/invite`, f); if (r.ok) { setOut(r.data); onDone(); } else setErr(errText(r)); };
  const copy = async () => { try { await navigator.clipboard.writeText(out!.link); toast(t('pp.copied')); } catch { toast(t('pp.copyFailed'), true); } };
  return (
    <Modal title={t('pp.mg.inviteTitle', { name: p.name })} onClose={onClose} labelClose={t('pp.close')}>
      {out ? (
        <div>
          <Note>{t(out.delivery === 'sent' ? 'pp.mg.inviteSent' : 'pp.mg.inviteManual', { email: f.email })}</Note>
          <Field label={t('pp.mg.link')} htmlFor="mi-l" hint={t('pp.mg.linkHint', { date: dateTime(out.expiresAt) })}>
            <div className="row nowrap"><input id="mi-l" readOnly value={out.link} onFocus={(e) => e.currentTarget.select()} /><Button icon={<LuCopy />} onClick={() => void copy()}>{t('pp.copy')}</Button></div>
          </Field>
          <div className="row"><span className="grow" /><Button variant="primary" onClick={onClose}>{t('pp.close')}</Button></div>
        </div>
      ) : (
        <>
          <p className="small muted">{t('pp.mg.inviteIntro')}</p>
          <div className="fgrid">
            <Field label={t('pp.f.email')} htmlFor="mi-e"><input id="mi-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="mi-email" /></Field>
            <Field label={t('pp.mg.personName')} htmlFor="mi-n"><input id="mi-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('pp.mg.role')} htmlFor="mi-r"><select id="mi-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="partner_owner">{t('pp.role.partner_owner')}</option><option value="partner_member">{t('pp.role.partner_member')}</option></select></Field>
            <Field label={t('pp.f.lang')} htmlFor="mi-g"><select id="mi-g" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as 'en' | 'es' })}><option value="en">English</option><option value="es">Español</option></select></Field>
          </div>
          {err && <p className="small neg" role="alert">{err}</p>}
          <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" icon={<LuSend />} onClick={() => void go()} data-testid="mi-send">{t('pp.mg.send')}</Button></div>
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
    <Modal title={t('pp.mg.complianceTitle', { name: p.name })} onClose={onClose} labelClose={t('pp.cancel')}>
      <Note>{t('pp.mg.complianceNote')}</Note>
      <div className="fgrid">
        <Field label={t('pp.mg.w9')} htmlFor="mc-w"><select id="mc-w" value={f.w9} onChange={(e) => setF({ ...f, w9: e.target.value })}>{['missing', 'received', 'verified'].map((s) => <option key={s} value={s}>{t('pp.st.' + s)}</option>)}</select></Field>
        <Field label={t('pp.mg.agreement')} htmlFor="mc-a"><select id="mc-a" value={f.agreement} onChange={(e) => setF({ ...f, agreement: e.target.value })}>{['none', 'sent', 'signed', 'terminated'].map((s) => <option key={s} value={s}>{t('pp.st.' + s)}</option>)}</select></Field>
        <Field label={t('pp.mg.agreementVersion')} htmlFor="mc-v" full><input id="mc-v" value={f.version} maxLength={60} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
      </div>
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant="primary" onClick={() => void go()}>{t('pp.save')}</Button></div>
    </Modal>
  );
}

function StatusChange({ p, to, onClose, onDone }: { p: PartnerOrg; to: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go = async () => { const r = await api.admin.post(`partners/${p.id}/status`, { status: to, reason }); if (r.ok) { toast(t('pp.done')); onDone(); } else setErr(errText(r)); };
  return (
    <Modal title={t('pp.mg.statusTitle', { name: p.name, to: t('pp.st.' + to) })} onClose={onClose} labelClose={t('pp.cancel')}>
      <Note tone={to === 'active' ? undefined : 'warn'}>{t('pp.mg.statusNote.' + to)}</Note>
      {to !== 'active' && <Field label={t('pp.com.reason')} htmlFor="ms-r"><textarea id="ms-r" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {err && <p className="small neg" role="alert">{err}</p>}
      <div className="row"><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('pp.cancel')}</Button><Button variant={to === 'active' ? 'primary' : 'danger'} onClick={() => void go()}>{t('pp.confirm')}</Button></div>
    </Modal>
  );
}
