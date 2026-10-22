// The Partner Portal's calls to /api/partners (api/partners.js). Every answer is decided by the database: these helpers
// only send what a person typed and show what comes back. Amounts are integer cents everywhere.
import { get, post, type Answer } from '@/platform/live/http';

export type L10n = { en?: string; es?: string };
export type L10nList = { en?: string[]; es?: string[] };

export interface Price { kind: string; amount_cents: number | null; period: string; optional: boolean; minimum_term_months: number | null; label: L10n }
export interface CompLine { policy: string; version: number; model: string; amount_cents: number | null; rate_bps: number | null; min_order_cents: number | null;
  clawback_days: number | null; payout_days: number | null; trigger: string; estimate_cents: number | null; per: 'order' | 'month' }
export interface CatalogItem {
  id: string; category: string; kind: string; version: number; popular: boolean; quote: boolean;
  name: L10n; tagline: L10n; best_for: L10n; includes: L10nList; excludes: L10nList; lead_time: L10n; prices: Price[];
  partner_notes?: string; floors?: Record<string, number>; deposit_cents?: number | null;
  compensation?: { lane: string; status: 'approved' | 'needs_approval'; estimate: boolean; lines: CompLine[] } | null;
}
export interface Catalog { view: 'client' | 'partner'; categories: { id: string; name: L10n }[]; items: CatalogItem[];
  resources: { slug: string; kind: string; version: number; title: L10n; body: L10n; updated_at: string }[] }

export interface Context { kind: 'staff' | 'partner' | null; user_id?: string; role?: string; name?: string; email?: string; aal: string; live: boolean;
  partner?: { id: string; code: string; name: string; kind: 'referral' | 'revshare'; w9: string; agreement: string } }

export interface OfferRow { id: string; ref: string; status: string; title: string; client_name: string; partner: string; setup_cents: number; one_time_cents: number;
  recurring_cents: number; est_once_cents: number | null; est_monthly_cents: number | null; valid_until: string; needs_approval: boolean; updated_at: string }
export interface OfferLine { item: string; quantity: number; quote: boolean; name: L10n; tagline: L10n; includes: L10nList; excludes: L10nList; lead_time: L10n;
  setup_cents: number; one_time_cents: number; recurring_cents: number; minimum_term_months: number | null }
export interface Offer extends Omit<OfferRow, 'partner'> {
  summary: string; client_contact: string; client_email: string; client_phone: string; industry: string; requirements: string; lang: 'en' | 'es';
  discount_bps: number; discount_cents: number; deposit_cents: number; first_payment_cents: number; lines: OfferLine[];
  line_ids: { id: string; item: string; quote: boolean }[]; approval_reasons: { code: string; item?: string; items?: string[]; blocking?: boolean }[];
  estimate: { once_cents: number; monthly_cents: number; uncovered: string[]; basis: { item?: string; policy: string; cents: number; rate_bps?: number; base_cents?: number; per?: string; flat?: boolean; below_minimum?: number }[] };
  partner: { id: string; name: string; code: string; kind: string }; order_id: string | null; decided_name: string;
  shares: { id: string; created_at: string; expires_at: string; revoked: boolean; views: number; last_viewed_at: string | null }[];
  events: { at: string; kind: string; actor_kind: string; note: string }[]; terms: { title: L10n; body: L10n }[];
}

export interface OrderRow { id: string; ref: string; status: string; client_name: string; partner: string; services: string; setup_cents: number; one_time_cents: number;
  recurring_cents: number; est_once_cents: number | null; est_monthly_cents: number | null; submitted_at: string | null; created_at: string; updated_at: string;
  next_action: string; follow_up_at: string | null; last_update: string | null; attribution?: string; assigned_to?: string | null }
export interface Order extends Omit<OrderRow, 'partner'> {
  offer_id: string | null; contact_name: string; contact_email: string; contact_phone: string; industry: string; lead_source: string; timeline: string; requirements: string;
  consent: boolean; consent_note: string; deposit_cents: number; partner_follow_up_at: string | null; live_at: string | null;
  partner: { id: string; name: string; code: string; kind: string }; assigned: { name: string } | null;
  lines: { item: string; name: L10n; quantity: number; setup_cents: number; one_time_cents: number; recurring_cents: number }[];
  events: { at: string; kind: string; actor_kind: string; from: string | null; to: string | null; body: string; visibility: 'partner' | 'internal' }[];
  payments: { id?: string; kind: string; amount_cents: number; period: string | null; received_on: string; reference?: string; method?: string }[];
  duplicate_of?: { id: string; ref: string; partner: string; submitted_at: string } | null;
}

export interface Commission { id: string; kind: string; amount_cents: number; basis_cents: number | null; rate_bps: number | null; period: string | null; calculation: string;
  reason: string; clawback_until: string | null; created_at: string; status: string; status_at: string; reverses: string | null;
  order: { id: string; ref: string; client: string; live_at: string | null } | null; item: L10n | null; policy: { id: string; version: number; model: string } | null;
  payout: { ref: string; status: string; sent_on: string | null; settled_on: string | null; method: string; reference: string } | null;
  history: { at: string; status: string; note: string; by: string }[]; partner?: { id: string; name: string; code: string } }
export interface Statement {
  partner: { id: string; name: string; code: string; kind: string; w9: string; agreement: string; payout_eligible: boolean };
  totals: Record<'eligible_cents' | 'approved_cents' | 'payable_cents' | 'paid_cents' | 'held_cents' | 'reversed_cents' | 'lifetime_cents' | 'estimated_once_cents' | 'estimated_monthly_cents', number>;
  lines: Commission[]; payouts: { id: string; ref: string; status: string; total_cents: number; created_at: string; sent_on: string | null; method: string; reference: string; settled_on: string | null }[];
  policies: { policy: string; version: number; model: string; amount_cents: number | null; rate_bps: number | null; applies_to: string[]; min_order_cents: number | null; clawback_days: number | null; payout_days: number | null; trigger: string }[];
}

export interface PartnerOrg { id: string; code: string; name: string; legal_name: string; kind: 'referral' | 'revshare'; status: string; contact_name: string; contact_email: string;
  contact_phone: string; lang: 'en' | 'es'; w9: string; agreement: string; agreement_signed_at: string | null; agreement_version: string; payout_eligible: boolean; created_at: string;
  internal_notes?: string; status_reason?: string; users: { user_id: string; name: string; email: string; role: string; status: string }[];
  invitations: { id: string; email: string; role: string; expires_at: string; expired: boolean }[] }

const B = '/api/partners';
const opt = { session: true } as const;
export const api = {
  context: () => get<{ context: Context }>(`${B}/context`, opt),
  catalog: (view: 'client' | 'partner', as?: string) => get<{ catalog: Catalog }>(`${B}/catalog?view=${view}${as ? '&as=' + as : ''}`, opt),
  offers: () => get<{ offers: OfferRow[] }>(`${B}/offers`, opt),
  offer: (id: string) => get<{ offer: Offer }>(`${B}/offers/${id}`, opt),
  saveOffer: (body: Record<string, unknown>) => post<{ offer: Offer }>(`${B}/offers`, body, opt),
  offerAction: <T = { offer: Offer }>(id: string, action: string, body: Record<string, unknown> = {}) => post<T>(`${B}/offers/${id}/${action}`, body, opt),
  orders: (q = '') => get<{ orders: OrderRow[] }>(`${B}/orders${q}`, opt),
  order: (id: string) => get<{ order: Order }>(`${B}/orders/${id}`, opt),
  createOrder: (body: Record<string, unknown>) => post<{ order: Order }>(`${B}/orders`, body, opt),
  orderAction: (id: string, action: string, body: Record<string, unknown> = {}) => post<{ order: Order }>(`${B}/orders/${id}/${action}`, body, opt),
  statement: (as?: string) => get<{ statement: Statement }>(`${B}/commissions${as ? '?as=' + as : ''}`, opt),
  inquiry: (id: string, note: string) => post(`${B}/commissions/${id}/inquiry`, { note }, opt),
  admin: {
    get: <T>(path: string) => get<T>(`${B}/admin/${path}`, opt),
    post: <T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}) => post<T>(`${B}/admin/${path}`, body, opt),
  },
};
export type { Answer };

/** The reason the database gave (one word), or the error code. */
export const why = (a: { ok: false; code: string; data: Record<string, unknown> }) => (typeof a.data.reason === 'string' ? a.data.reason : a.code);
