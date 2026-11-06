// What the AI employees screen asks of the server (supabase/migrations/0084_ai_employees.sql, api/_lib/rpc-allowlist.js).
// Every call goes through /api/ws/rpc with the person's own session; the database decides who may do what. A "confirm it
// is you" answer opens the identity check and repeats the call once.
import { rpc } from '@/platform/live/ops';
import { askStepUp } from '@/features/security/stepup';
import { needsStepUp } from '@/features/security/ops';

export const SECTIONS = ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'messages', 'payments', 'catalog', 'reports', 'automations', 'team'] as const;
export type Section = (typeof SECTIONS)[number];
export type Level = 'none' | 'view' | 'edit';
export type Access = Partial<Record<Section, Level>>;

export interface Bot {
  id: string; slug: string; name: string; title: string; department: string; reportsTo: string; mission: string;
  access: Access; status: 'active' | 'paused'; hasKey: boolean; keyHint: string | null; keyCreatedAt: string | null; lastUsedAt: string | null; pending: number; webhookUrl?: string | null; webhookHint?: string | null; webhookAuth?: boolean; webhookAuthHint?: string | null; lastDelivery?: { status: number | null; error: string | null; attempts: number; kind: 'chat' | 'test'; at: string } | null; photo?: string | null;
}
export interface Approval {
  id: string; kind: string; level: 2 | 3; what: string; why: string; riskDo: string; riskDont: string; recommendation: string; deadline: string | null;
  target: { type?: string; id?: string }; status: 'pending' | 'approved' | 'rejected' | 'done' | 'cancelled';
  decidedBy: string | null; decidedAt: string | null; note: string | null; doneAt: string | null; created_at: string; bot: string | null; botTitle: string | null;
}
export interface Activity { id: number; at: string; tool: string; outcome: 'ok' | 'denied' | 'invalid' | 'error'; summary: { reason?: string; id?: string; count?: number }; bot: string | null }

export type Res<T> = { ok: true; data: T } | { ok: false; reason: string };

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<Res<T>> {
  const once = async (): Promise<Res<T>> => {
    try {
      const a = await rpc<T>(name, args);
      return a.ok ? { ok: true, data: a.data.result } : { ok: false, reason: a.code || 'not_available' };
    } catch { return { ok: false, reason: 'not_available' }; }
  };
  // rpc() already asks for the identity check when the server wants one and repeats the call; this covers a check that
  // was asked for while another dialog was open
  let r = await once();
  if (!r.ok && needsStepUp(r.reason) && (await askStepUp())) r = await once();
  return r;
}

export const botApi = {
  list: () => call<Bot[]>('bot_list'),
  save: (bot: Partial<Bot>) => call<string>('bot_save', { p_bot: bot }),
  setStatus: (id: string, status: 'active' | 'paused') => call<boolean>('bot_set_status', { p_bot: id, p_status: status }),
  issueKey: (id: string) => call<{ key: string; hint: string }>('bot_key_issue', { p_bot: id }),
  testPush: (id: string) => call<{ ok: boolean; status: number | null; error: string | null; ms?: number }>('bot_webhook_test', { p_bot: id }),
  setPhoto: (id: string, path: string) => call<boolean>('bot_photo_set', { p_bot: id, p_photo: path }),
  setWebhook: (id: string, url: string, auth?: string) => call<{ secret: string | null; hint: string | null }>('bot_webhook_set', { p_bot: id, p_url: url, ...(auth === undefined ? {} : { p_auth: auth }) }),
  revokeKey: (id: string) => call<boolean>('bot_key_revoke', { p_bot: id }),
  activity: (bot?: string) => call<Activity[]>('bot_activity_list', bot ? { p_bot: bot } : {}),
  approvals: () => call<Approval[]>('approvals_list'),
  decide: (id: string, decision: 'approved' | 'rejected', note?: string) => call<{ decided: boolean; queued: boolean }>('approval_decide', { p_id: id, p_decision: decision, ...(note ? { p_note: note } : {}) }),
  done: (id: string) => call<boolean>('approval_done', { p_id: id }),
};
