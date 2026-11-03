// What a catalog card shows for one service: the price in large type, the second price under it, and the lines of the
// terms (deposit, balance, payments, minimum term, setup, users...). Only from what the service itself says: a line whose
// figure the company never set is left out, nothing is assumed.
//
// Three shapes, from the tiers a service has:
//   plan   a monthly and a yearly price (software plans): the price of the period on screen, the other one under it, and
//          what paying yearly saves
//   build  a setup fee and a monthly fee (packages, CRM, websites): "$X to build", "$Y /mo"
//   single anything else: the first tier large, the others as lines
import type { CatalogService, CatalogTier, Lang } from '@/domain/types';
import type { TFn } from '@/i18n';
import { money, money2 } from '@/lib/money';
import { serviceLeadTime } from '@/domain/actions/catalog';
import { tierPrice } from './parts';

export type Period = 'month' | 'year';
export interface CardLine { label: string; value: string }
export interface CardPrice {
  shape: 'plan' | 'build' | 'single';
  /** The large figure: an amount, or "Quote". */
  big: string;
  /** Next to it: "to build", "per month". */
  suffix?: string;
  /** Under it, in the accent color: the monthly fee and "/mo". */
  second?: string; secondSuffix?: string;
  /** Under the price: "Priced for each client". */
  sub?: string;
  /** What paying yearly saves, or that it costs the same. */
  save?: string;
  lines: CardLine[];
}

const amount = (n: number) => (Number.isInteger(n) ? money(n) : money2(n));
const priced = (x: CatalogTier | undefined): x is CatalogTier => !!x && x.price > 0 && !(x.quote && !x.from);
const isSetup = (x: CatalogTier) => x.kind === 'setup' || (!x.kind && x.unit === 'flat' && /^(setup|set-up|build)$/i.test(x.name.trim()));
/** "Deposit to start: $449" in a tier's note: the deposit, in dollars. */
export function depositOf(tier: CatalogTier | undefined): number | undefined {
  const m = /deposit[^$\d]*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(tier?.note ?? '');
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A software plan: a monthly and a yearly price, both set. */
export const isPlan = (s: CatalogService): boolean => priced(s.tiers.find((x) => x.unit === 'month' && !isSetup(x))) && priced(s.tiers.find((x) => x.unit === 'year'));

function suffixOf(t: TFn, x: CatalogTier): string | undefined {
  if (x.unit !== 'flat') return t('catalog.card.per.' + x.unit);
  if (x.per?.trim()) return x.per.trim();
  if (x.kind === 'one_time') return t('catalog.card.oneTime');
  if (isSetup(x)) return t('catalog.card.setup');
  return undefined;
}

export function cardPrice(t: TFn, s: CatalogService, lang: Lang, period: Period = 'month'): CardPrice {
  const setup = s.tiers.find(isSetup);
  const month = s.tiers.find((x) => x.unit === 'month' && !isSetup(x));
  const year = s.tiers.find((x) => x.unit === 'year');
  const lead = serviceLeadTime(s, lang);
  const used = new Set<string>();
  const lines: CardLine[] = [];
  const rest = () => { for (const x of s.tiers) if (!used.has(x.id)) lines.push({ label: x.name, value: tierPrice(t, x) }); };
  const leadLine = () => { if (lead) lines.push({ label: t('catalog.card.ready'), value: lead }); };

  if (isPlan(s) && month && year) {
    used.add(month.id); used.add(year.id);
    const yearly = period === 'year';
    const save = month.price * 12 - year.price;
    const out: CardPrice = {
      shape: 'plan', big: amount(yearly ? year.price : month.price), suffix: t(yearly ? 'catalog.card.perYear' : 'catalog.card.perMonth') + ((yearly ? year : month).per?.trim() ? ' ' + (yearly ? year : month).per!.trim() : ''),
      sub: t(yearly ? 'catalog.card.orMonth' : 'catalog.card.orYear', { price: amount(yearly ? month.price : year.price) }),
      save: save > 0.004 ? t('catalog.card.saves', { amount: amount(Math.round(save * 100) / 100) }) : Math.abs(save) <= 0.004 ? t('catalog.card.sameTotal') : undefined,
      lines,
    };
    if (setup) { used.add(setup.id); lines.push({ label: t('catalog.card.oneTimeSetup'), value: priced(setup) ? amount(setup.price) : tierPrice(t, setup) }); }
    if (s.users !== undefined) lines.push({ label: t('catalog.card.users'), value: s.users === 'unlimited' ? t('catalog.card.unlimited') : s.users === 1 ? '1' : t('catalog.card.upTo', { n: s.users }) });
    if (typeof s.welcomeCredit === 'number') lines.push({ label: t('catalog.card.credit'), value: s.welcomeCredit > 0 ? amount(s.welcomeCredit) : t('catalog.none') });
    rest(); leadLine();
    return out;
  }

  /** The terms under the price, in the order the Command Center shows them: deposit, balance, payments, the year, term, carrier costs. */
  const terms = (fee: CatalogTier | undefined, monthly: CatalogTier | undefined) => {
    // a quoted fee (even with a starting price) has no deposit or payments: they are agreed with the quote
    if (fee && priced(fee) && !fee.quote) {
      const deposit = depositOf(fee);
      if (deposit && deposit < fee.price) lines.push({ label: t('catalog.card.deposit'), value: amount(deposit) }, { label: t('catalog.card.balance'), value: amount(Math.round((fee.price - deposit) * 100) / 100) });
      if (s.installments && s.installments > 1) {
        const part = fee.price / s.installments;
        lines.push({ label: t('catalog.card.payments', { n: s.installments }), value: amount(Number.isInteger(fee.price) ? Math.round(part) : Math.round(part * 100) / 100) });
      }
    }
    if (monthly && priced(monthly) && !s.carePlan && s.prepayMonths && s.prepayMonths > 0) lines.push({ label: t('catalog.card.payYear'), value: amount(monthly.price * s.prepayMonths) });
    if (s.minTermMonths && !s.carePlan) lines.push({ label: t('catalog.card.term'), value: t('catalog.card.months', { n: s.minTermMonths }) });
    const u = s.usageRange;
    if (Array.isArray(u) && u.length === 2 && u.every((n) => typeof n === 'number')) lines.push({ label: t('catalog.card.usage'), value: `${amount(u[0])}–${amount(u[1])}${t('catalog.card.mo')}` });
  };
  /** "$2,000+" for a starting price, else the amount. */
  const figure = (x: CatalogTier) => (x.from ? amount(x.price) + '+' : amount(x.price));

  if (setup && month) {
    used.add(setup.id); used.add(month.id);
    const quoted = !priced(setup);
    const monthSuffix = t('catalog.card.mo') + (s.carePlan ? ' · ' + t('catalog.card.carePlan') : month.per?.trim() ? ' ' + month.per.trim() : '');
    const out: CardPrice = {
      shape: 'build', big: quoted ? t('catalog.tier.quote') : figure(setup), suffix: quoted ? undefined : t('catalog.card.toBuild'),
      ...(priced(month) && !month.quote ? { second: amount(month.price), secondSuffix: monthSuffix } : { sub: t('catalog.card.monthQuoted') }),
      lines,
    };
    terms(setup, month);
    rest(); leadLine();
    return out;
  }

  const main = s.tiers[0];
  if (!main) return { shape: 'single', big: t('catalog.tier.quote'), lines };
  used.add(main.id);
  const shownPrice = priced(main);
  const out: CardPrice = {
    shape: 'single',
    big: shownPrice ? figure(main) : t('catalog.tier.quote'),
    // a one-time fee with a deposit is a build, as in the Command Center: "$350 to build"
    suffix: !shownPrice ? undefined : (isSetup(main) || depositOf(main)) && main.unit === 'flat' && !main.per?.trim() ? t('catalog.card.toBuild') : suffixOf(t, main),
    sub: shownPrice ? undefined : t('catalog.card.quoteSub'),
    lines,
  };
  terms(main.unit === 'flat' ? main : undefined, main.unit === 'month' ? main : undefined);
  rest(); leadLine();
  return out;
}
