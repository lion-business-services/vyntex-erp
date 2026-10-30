// Small pieces shared by the catalog screens and by the other modules that show a service (engagement forms, opportunities).
import { LuLink2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import type { CatalogService, CatalogTier, Lang, PlaybookStep, Repeat } from '@/domain/types';
import type { TFn } from '@/i18n';
import type { IndustryPack } from '@/packs/types';
import { money, money2 } from '@/lib/money';
import { type Service, bookOf, serviceName } from '@/domain/actions/catalog';

export const REPEAT_OPTIONS: Repeat[] = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

/** A category is the id of one of the edition's service lines when it matches one, otherwise the text the company typed. */
export function categoryLabel(t: TFn, pack: IndustryPack, category: string): string {
  if (!category) return t('catalog.cat.none');
  return pack.serviceTypes.some((x) => x.id === category) ? t('ty_' + category) : category;
}
/**
 * Categories in use, the edition's own order first, then the company's in alphabetical order. An empty category comes last.
 * When services carry `categoryOrder`, categories are sorted by the smallest one of their services first (those without
 * one after), then as above.
 */
export function categoriesOf(pack: IndustryPack, services: CatalogService[]): string[] {
  const used = new Set(services.map((s) => s.category));
  const known = pack.serviceTypes.map((x) => x.id).filter((id) => used.has(id));
  const own = [...used].filter((c) => c && !known.includes(c)).sort((a, b) => a.localeCompare(b));
  const base = [...known, ...own, ...(used.has('') ? [''] : [])];
  const rank = new Map<string, number>();
  for (const s of services) if (typeof s.categoryOrder === 'number' && Number.isFinite(s.categoryOrder)) rank.set(s.category, Math.min(rank.get(s.category) ?? Infinity, s.categoryOrder));
  if (!rank.size) return base;
  return base.map((c, i) => ({ c, i, r: rank.get(c) ?? Infinity })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r)).map((x) => x.c);
}
/** Services of one category: by `order` when they have one (those without after), then by name in the viewer's language. */
export function byServiceOrder(lang: Lang): (a: CatalogService, b: CatalogService) => number {
  const o = (s: CatalogService) => (typeof s.order === 'number' && Number.isFinite(s.order) ? s.order : Infinity);
  return (a, b) => (o(a) !== o(b) ? (o(a) < o(b) ? -1 : 1) : serviceName(a, lang).localeCompare(serviceName(b, lang), lang));
}

/* ---------- books: several catalogs in one company ---------- */
/** The address form of a book name: "VYNTEX ERP" is "vyntex-erp". */
export const bookSlug = (name: string): string => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'book';
/** The sub-tab of services that are in no book. */
export const NO_BOOK = 'other';
export interface Book { name: string; slug: string }
/** The books in use, by the smallest `bookOrder` of their services (those without one after), then by name. */
export function booksOf(services: CatalogService[]): Book[] {
  const rank = new Map<string, number>();
  for (const s of services) {
    const b = bookOf(s); if (!b) continue;
    const r = typeof s.bookOrder === 'number' && Number.isFinite(s.bookOrder) ? s.bookOrder : Infinity;
    rank.set(b, Math.min(rank.get(b) ?? Infinity, r));
  }
  const used = new Set<string>();
  return [...rank.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] - b[1])).map(([name]) => {
    // two names that read the same in an address still get an address each
    let slug = bookSlug(name); for (let n = 2; used.has(slug) || slug === NO_BOOK; n++) slug = bookSlug(name) + '-' + n;
    used.add(slug); return { name, slug };
  });
}
/** Sub-tabs are worth showing with two books or more, or one book and services that are in none. */
export const showBooks = (services: CatalogService[], books: Book[]): boolean => books.length >= 2 || (books.length === 1 && services.some((s) => !bookOf(s)));

type PricedTier = Pick<CatalogTier, 'price' | 'unit'> & Partial<Pick<CatalogTier, 'quote' | 'from' | 'per' | 'kind'>>;
/**
 * "$180", "$220 / month", "$60 / hour", "$25 per form", "From $4,000". A quoted tier reads "Quote" (or "From $X" when it
 * has a starting price), never $0; a tier at zero is quoted for each client. Cents are shown only when there are any.
 * `withKind` adds "Setup" for a setup fee, for places that show the price as plain text (a picker).
 */
export function tierPrice(t: TFn, tier: PricedTier, withKind = false): string {
  const kind = withKind && tier.kind === 'setup' ? ` · ${t('catalog.kind.setup')}` : '';
  if (tier.quote && !(tier.from && tier.price > 0)) return t('catalog.tier.quote') + kind;
  if (!tier.price) return t('catalog.tier.quoted') + kind;
  const amount = Number.isInteger(tier.price) ? money(tier.price) : money2(tier.price);
  const per = tier.per?.trim();
  const shown = (tier.unit === 'flat' ? amount : `${amount} / ${t('catalog.per.' + tier.unit)}`) + (per ? ' ' + per : '');
  return (tier.from ? t('catalog.tier.fromPrice', { price: shown }) : shown) + kind;
}
/** From the lowest tier that has a price: what a list shows when a service has several. A quote without a starting price is not a price. */
export function priceFrom(t: TFn, s: CatalogService): string {
  const priced = s.tiers.filter((x) => x.price > 0 && (!x.quote || x.from));
  if (!priced.length) return s.tiers.some((x) => x.quote) ? t('catalog.tier.quote') : t('catalog.tier.quoted');
  const low = priced.reduce((a, b) => (b.price < a.price ? b : a));
  return s.tiers.length > 1 && !low.from ? t('catalog.from', { price: tierPrice(t, low) }) : tierPrice(t, low);
}

/** Who a playbook step is for, in the words of the edition: the person responsible for the work, or a role as the company names it. */
export const whoLabel = (t: TFn, who: PlaybookStep['for']): string => (who === 'assignee' ? t('catalog.pb.for.assignee') : t('role.' + who));

/** What a person types to find a service: its names in every language, its code, its category and its tier names. */
export function serviceText(t: TFn, pack: IndustryPack, s: Service): string {
  return [s.name, s.i18n?.en?.name, s.i18n?.es?.name, s.i18n?.zh?.name, s.code, s.description, s.book, categoryLabel(t, pack, s.category), ...s.tiers.map((x) => x.name)].filter(Boolean).join(' ').toLowerCase();
}

/** Ids a connected system gave this record. Shown, never edited here: they are written once by the sync that created the record over there. */
export function ExternalChips({ ids, none }: { ids?: Record<string, string>; none?: boolean }) {
  const { t } = useApp();
  const list = Object.entries(ids ?? {});
  if (!list.length) return none ? <span className="dim small">{t('catalog.ext.none')}</span> : null;
  return (
    <span className="row tight catalog-ext">
      {list.map(([provider, id]) => <span key={provider} className="catalog-chip" title={t('catalog.ext.hint')}><LuLink2 aria-hidden="true" /><b>{t('catalog.ext.' + provider) === 'catalog.ext.' + provider ? provider : t('catalog.ext.' + provider)}</b><code>{id}</code></span>)}
    </span>
  );
}

/** The name of a service by id, in the viewer's language; the fallback when it no longer exists. */
export function useServiceName() {
  const { data, lang, t } = useApp();
  return (id: string | undefined): string => { const s = (data.catalog ?? []).find((x) => x.id === id); return s ? serviceName(s, lang) : t('catalog.gone'); };
}
