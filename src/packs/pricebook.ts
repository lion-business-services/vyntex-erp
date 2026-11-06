// A flat-rate price book for a trade edition's sample business: one card per service type (in the edition's order, so
// the field extras can match work to its service), then any extra lines. Sample prices of a fictional company only.
import type { CatalogService, CatalogTier, Lang } from '@/domain/types';

export interface BookTier { en: string; es: string; price: number; unit?: CatalogTier['unit']; from?: boolean; quote?: boolean; noteEn?: string; noteEs?: string; perEn?: string; perEs?: string }
export interface BookItem {
  /** A service type id of the edition: the card's category. */
  type: string;
  en: string; es: string;
  aboutEn: string; aboutEs: string;
  tiers: BookTier[];
  hasEn: string[]; hasEs: string[];
  notEn?: string[]; notEs?: string[];
  bestEn?: string; bestEs?: string;
  popular?: boolean;
}

export function priceBook(lang: Lang, items: BookItem[]): CatalogService[] {
  const es = lang === 'es';
  return items.map((x, i): CatalogService => ({
    id: `fs${i + 1}`, name: es ? x.es : x.en, category: x.type, active: true, order: i + 1,
    docKinds: ['estimate', 'contract', 'invoice'],
    ...(x.popular ? { popular: true } : {}),
    description: es ? x.aboutEs : x.aboutEn,
    highlights: es ? x.hasEs : x.hasEn,
    ...(x.notEn ? { excludes: es ? x.notEs : x.notEn } : {}),
    ...(x.bestEn ? { bestFor: es ? x.bestEs : x.bestEn } : {}),
    i18n: {
      en: { name: x.en, description: x.aboutEn, highlights: x.hasEn, ...(x.notEn ? { excludes: x.notEn } : {}), ...(x.bestEn ? { bestFor: x.bestEn } : {}) },
      es: { name: x.es, description: x.aboutEs, highlights: x.hasEs, ...(x.notEs ? { excludes: x.notEs } : {}), ...(x.bestEs ? { bestFor: x.bestEs } : {}) },
    },
    tiers: x.tiers.map((t, k): CatalogTier => ({
      id: `fs${i + 1}-t${k + 1}`, name: es ? t.es : t.en, price: t.price, unit: t.unit ?? 'flat',
      ...(t.from ? { from: true } : {}), ...(t.quote ? { quote: true } : {}),
      ...(t.noteEn ? { note: es ? t.noteEs : t.noteEn } : {}), ...(t.perEn ? { per: es ? t.perEs : t.perEn } : {}),
    })),
  }) as CatalogService);
}
