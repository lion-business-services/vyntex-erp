// What each connection is for in this platform, which group it is listed under, and what the business has to obtain from
// the provider before it can be used. One entry per provider id (ProviderId in src/domain/types.ts): a new provider is one
// more entry here and its wording in ./i18n.ts, nothing in the screen itself.
// The requirements are things to confirm with the provider. Providers change them, and none of them is a promise about
// how long an approval takes.
import type { ComponentType } from 'react';
import { LuBadgeDollarSign, LuBellRing, LuCalculator, LuCalendarDays, LuClipboardList, LuContact, LuCreditCard, LuHardDrive, LuHash, LuInbox, LuMail, LuMapPin, LuMessageCircle, LuMessageSquareText, LuPhone, LuSend, LuShare2, LuSheet, LuSparkles, LuStore, LuVideo, LuWorkflow } from 'react-icons/lu';
import type { Connection, DemoState, ProviderId } from '@/domain/types';

export type GroupId = 'email' | 'calendar' | 'files' | 'money' | 'messaging' | 'social' | 'ai';
export const GROUPS: GroupId[] = ['email', 'calendar', 'files', 'money', 'messaging', 'social', 'ai'];
type Icon = ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>;

export interface ProviderInfo {
  id: ProviderId;
  /** The provider's own name: never translated. */
  name: string;
  /** Where the name is ours and not a brand (text messages, the assistant): the wording key to show instead. */
  nameKey?: string;
  group: GroupId;
  icon: Icon;
  /** How many requirement lines the wording has: integrations.need.<id>.1 .. n */
  needs: number;
  /** The provider has a test mode and a production mode, and it matters which one is in use (money, books). */
  modes?: boolean;
  /** On the roadmap: shown and demonstrated in the sample workspace, not yet connectable in a live workspace. */
  planned?: boolean;
  /** Part of Google Workspace: "Connect Google Workspace" in the demo connects all of these at once. */
  google?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'gmail', name: 'Gmail', group: 'email', icon: LuMail, needs: 4, google: true },
  { id: 'outlook', name: 'Microsoft 365 Outlook', group: 'email', icon: LuInbox, needs: 3, planned: true },
  { id: 'resend', name: 'Resend', group: 'email', icon: LuSend, needs: 3 },
  { id: 'gcal', name: 'Google Calendar', group: 'calendar', icon: LuCalendarDays, needs: 3, google: true },
  { id: 'gmeet', name: 'Google Meet', group: 'calendar', icon: LuVideo, needs: 2, google: true },
  { id: 'gdrive', name: 'Google Drive', group: 'files', icon: LuHardDrive, needs: 3, planned: true, google: true },
  { id: 'gsheets', name: 'Google Sheets', group: 'files', icon: LuSheet, needs: 2, planned: true, google: true },
  { id: 'gcontacts', name: 'Google Contacts', group: 'files', icon: LuContact, needs: 2, planned: true, google: true },
  { id: 'gforms', name: 'Google Forms', group: 'files', icon: LuClipboardList, needs: 2, planned: true, google: true },
  { id: 'square', name: 'Square', group: 'money', icon: LuCreditCard, needs: 4, modes: true },
  { id: 'stripe', name: 'Stripe', group: 'money', icon: LuBadgeDollarSign, needs: 3, modes: true, planned: true },
  { id: 'quickbooks', name: 'QuickBooks Online', group: 'money', icon: LuCalculator, needs: 4, modes: true },
  { id: 'whatsapp', name: 'WhatsApp Business', group: 'messaging', icon: LuMessageCircle, needs: 5 },
  { id: 'sms', name: 'SMS', nameKey: 'integrations.name.sms', group: 'messaging', icon: LuMessageSquareText, needs: 4 },
  { id: 'dialpad', name: 'Dialpad', group: 'messaging', icon: LuPhone, needs: 3 },
  { id: 'slack', name: 'Slack', group: 'messaging', icon: LuHash, needs: 2, planned: true },
  { id: 'meta', name: 'Meta', nameKey: 'integrations.name.meta', group: 'social', icon: LuShare2, needs: 4 },
  { id: 'gbp', name: 'Google Business Profile', group: 'social', icon: LuStore, needs: 3, google: true },
  { id: 'gmaps', name: 'Google Maps', group: 'social', icon: LuMapPin, needs: 2, google: true },
  { id: 'galerts', name: 'Google Alerts', group: 'social', icon: LuBellRing, needs: 2, planned: true, google: true },
  { id: 'ai', name: 'AI', nameKey: 'nav.assistant', group: 'ai', icon: LuSparkles, needs: 2 },
  { id: 'zapier', name: 'Zapier and webhooks', nameKey: 'integrations.name.zapier', group: 'ai', icon: LuWorkflow, needs: 2, planned: true },
];
export const providerById = (id: string): ProviderInfo | undefined => PROVIDERS.find((p) => p.id === id);
/** Every Google Workspace connection, in the order "Connect Google Workspace" lists them. */
export const GOOGLE_IDS: ProviderId[] = PROVIDERS.filter((p) => p.google).map((p) => p.id);

/** The account a simulated connection shows: an address on the reserved .example domain, never a real mailbox. */
export function demoAccount(d: DemoState, id: ProviderId): string {
  const slug = (d.company.name || 'sample').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'sample';
  if (id === 'slack') return `${slug}.slack.example`;
  if (id === 'square' || id === 'stripe' || id === 'quickbooks') return `${d.company.name} (sandbox)`;
  if (id === 'sms' || id === 'whatsapp' || id === 'dialpad') return d.company.phone || '609-555-0100';
  return `office@${slug}.example`;
}

/**
 * What a simulated connection does with the sample company's own records, as lines of the card. Every number is counted
 * from the sample records on screen, never made up: an edition without appointments simply has no appointment line.
 */
export function demoActivity(d: DemoState, id: ProviderId): { key: string; params?: Record<string, string | number> }[] {
  const n = (k: string, v: number) => (v > 0 ? [{ key: `integrations.demo.${id}.${k}`, params: { n: v } }] : []);
  const emails = d.messages.filter((m) => m.channel === 'email').length;
  const calendar = d.leads.filter((l) => l.apptDate).length + d.jobs.filter((j) => j.start).length + (d.appointments ?? []).length;
  const payments = d.jobs.reduce((s, j) => s + (j.received?.length ?? 0), 0) + (d.appointments ?? []).filter((a) => a.paid).length;
  const invoices = d.docs.filter((x) => x.kind === 'invoice').length;
  const docs = d.docs.length;
  const withPhone = d.clients.filter((c) => c.phone).length;
  const optIn = d.clients.filter((c) => c.smsOptIn || c.whatsappOptIn).length;
  const addresses = d.jobs.filter((j) => j.address).length + d.leads.filter((l) => l.address).length;
  switch (id) {
    case 'gmail': case 'outlook': return [...n('emails', emails), { key: 'integrations.demo.mail.reply' }];
    case 'resend': return [...n('drafts', d.messages.filter((m) => m.status === 'draft').length), { key: 'integrations.demo.resend.system' }];
    case 'gcal': return [...n('items', calendar), { key: 'integrations.demo.gcal.busy' }];
    case 'gmeet': return [...n('appts', (d.appointments ?? []).filter((a) => a.mode === 'video').length), { key: 'integrations.demo.gmeet.link' }];
    case 'gdrive': return [...n('docs', docs), ...n('folders', d.clients.length)];
    case 'gsheets': return [...n('rows', d.jobs.length + d.leads.length), { key: 'integrations.demo.gsheets.refresh' }];
    case 'gcontacts': return [...n('contacts', d.clients.filter((c) => c.phone || c.email).length), { key: 'integrations.demo.gcontacts.both' }];
    case 'gforms': return [...n('leads', d.leads.filter((l) => l.source === 'website').length), { key: 'integrations.demo.gforms.rule' }];
    case 'galerts': return [{ key: 'integrations.demo.galerts.watch', params: { company: d.company.name } }, { key: 'integrations.demo.galerts.task' }];
    case 'square': case 'stripe': return [...n('payments', payments), { key: 'integrations.demo.pay.link' }];
    case 'quickbooks': return [...n('invoices', invoices), ...n('clients', d.clients.length)];
    case 'whatsapp': case 'sms': return [...n('optin', optIn), { key: 'integrations.demo.msg.stop' }];
    case 'dialpad': return [...n('phones', withPhone), { key: 'integrations.demo.dialpad.log' }];
    case 'slack': return [{ key: 'integrations.demo.slack.channel' }, ...n('rules', (d.rules ?? []).filter((r) => r.active).length)];
    case 'meta': return [...n('posts', (d.posts ?? []).length), { key: 'integrations.demo.meta.inbox' }];
    case 'gbp': return [...n('reviews', (d.reviews ?? []).length), { key: 'integrations.demo.gbp.reply' }];
    case 'gmaps': return [...n('addresses', addresses), { key: 'integrations.demo.gmaps.route' }];
    case 'ai': return [{ key: 'integrations.demo.ai.answers' }];
    case 'zapier': return [...n('rules', (d.rules ?? []).filter((r) => r.active).length), { key: 'integrations.demo.zapier.hook' }];
    default: return [];
  }
}

/**
 * What the server says about a connection (GET /api/integrations, docs/SERVER.md section 6). The gateway types the answer
 * as `Connection`; the server also sends why the state is what it is, which settings the deployment lacks, whether the
 * provider still has to approve the app, how the last check went, and (where the provider has one) which mode is in use.
 */
export type ConnectionInfo = Connection & {
  reason?: string;
  missing?: string[];
  approval?: { needed?: boolean; note?: string } | null;
  built?: boolean;
  kind?: 'oauth' | 'key' | 'platform';
  health?: string;
  mode?: 'sandbox' | 'production';
};
/** The mode a connection runs in, when the server says. It may also arrive among the connection's settings. */
export function modeOf(c: ConnectionInfo): 'sandbox' | 'production' | null {
  const v = c.mode ?? c.settings?.environment ?? c.settings?.mode;
  return v === 'sandbox' || v === 'production' ? v : null;
}
