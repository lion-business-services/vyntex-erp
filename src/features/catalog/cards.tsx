// The catalog as cards, one per service, the way the VYNTEX Command Center shows its catalog: the category as tabs, the
// price in large type, the terms line by line, then what the service includes. Software plans (a monthly and a yearly
// price) get a Monthly / Yearly switch and read like the pricing page. The list view stays one click away.
import { useState } from 'react';
import { LuArrowRight, LuCheck, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { Badge, cx } from '@/ui';
import { money, money2 } from '@/lib/money';
import { type Service, serviceBestFor, serviceDescription, serviceExcludes, serviceHighlights, serviceName } from '@/domain/actions/catalog';
import { type Period, cardPrice, isPlan } from './cardModel';
import { categoryLabel } from './parts';

/** Items of "What you get" shown before "Show all". */
const SHOWN = 10;

export interface CardGroup { id: string; list: Service[] }

/** Category tabs over the cards. `active` is the category on screen; none is chosen while a search shows every category. */
export function CategoryTabs({ groups, active, onPick }: { groups: CardGroup[]; active?: string; onPick: (id: string) => void }) {
  const { t, pack } = useApp();
  if (groups.length < 2) return null;
  return (
    <div className="cc-cats" role="group" aria-label={t('catalog.f.category')} data-testid="catalog-cats">
      {groups.map((g) => (
        <button key={g.id || '-'} type="button" aria-pressed={g.id === active} onClick={() => onPick(g.id)} data-cat={g.id}>
          {categoryLabel(t, pack, g.id)}<span className="cc-cat-n">{g.list.length}</span>
        </button>
      ))}
    </div>
  );
}

export function ServiceCards({ groups, headings }: { groups: CardGroup[]; headings: boolean }) {
  const { t, pack } = useApp();
  const [period, setPeriod] = useState<Period>('month');
  return (
    <div className="stack cc-sections" data-testid="catalog-cards">
      {groups.map((g) => {
        const plans = g.list.filter(isPlan);
        const best = plans.length ? Math.max(...plans.map((s) => { const m = s.tiers.find((x) => x.unit === 'month')!.price; const y = s.tiers.find((x) => x.unit === 'year')!.price; return m * 12 - y; })) : 0;
        return (
          <section key={g.id || '-'} className="cc-section" aria-label={categoryLabel(t, pack, g.id)} data-testid="catalog-section">
            {(headings || plans.length > 0) && (
              <div className="cc-section-h">
                {headings ? <h2>{categoryLabel(t, pack, g.id)} <span className="count">{g.list.length}</span></h2> : <span />}
                {plans.length > 0 && (
                  <div className="cc-period">
                    {best > 0 && <span className="cc-period-save">{t('catalog.card.saveUpTo', { amount: Number.isInteger(best) ? money(best) : money2(best) })}</span>}
                    <div className="seg" role="group" aria-label={t('catalog.card.billing')}>
                      <button type="button" aria-pressed={period === 'month'} onClick={() => setPeriod('month')} data-testid="catalog-period-month">{t('catalog.card.monthly')}</button>
                      <button type="button" aria-pressed={period === 'year'} onClick={() => setPeriod('year')} data-testid="catalog-period-year">{t('catalog.card.yearly')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="cc-grid">{g.list.map((s) => <ServiceCard key={s.id} s={s} period={period} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

function ServiceCard({ s, period }: { s: Service; period: Period }) {
  const { t, lang } = useApp();
  const [all, setAll] = useState(false);
  const p = cardPrice(t, s, lang, period);
  const about = serviceDescription(s, lang);
  const has = serviceHighlights(s, lang);
  const not = serviceExcludes(s, lang);
  const best = serviceBestFor(s, lang);
  const shown = all ? has : has.slice(0, SHOWN);
  const quote = p.big === t('catalog.tier.quote');
  return (
    <article className={cx('cc-card', s.popular && 'is-popular', !s.active && 'retired')} data-service={s.id} data-shape={p.shape} data-testid="catalog-card">
      {s.popular && <span className="cc-pop">{t('catalog.card.popular')}</span>}
      <header className="cc-head">
        <h3><A to={`/catalog/${s.id}`}>{serviceName(s, lang)}</A></h3>
        {!s.active && <Badge>{t('catalog.retired')}</Badge>}
      </header>
      {about && <p className="cc-tag">{about}</p>}
      <div className="cc-price" data-testid="catalog-card-price">
        <span className={cx('cc-big', quote && 'quote')}>{p.big}</span>{p.suffix && <span className="cc-suf">{p.suffix}</span>}
      </div>
      {p.second && <div className="cc-second"><b>{p.second}</b><span>{p.secondSuffix}</span></div>}
      {p.sub && <p className="cc-sub">{p.sub}</p>}
      {p.save && <p className="cc-save">{p.save}</p>}
      {p.lines.length > 0 && (
        <dl className="cc-lines">
          {p.lines.map((x, i) => <div key={i}><dt>{x.label}</dt><dd>{x.value}</dd></div>)}
        </dl>
      )}
      {has.length > 0 && (
        <div className="cc-block">
          <h4 className="cc-h">{t('catalog.card.get')}</h4>
          <ul className="cc-list">{shown.map((x, i) => <li key={i}><LuCheck aria-hidden="true" className="yes" /><span>{x}</span></li>)}</ul>
          {has.length > SHOWN && <button type="button" className="linkbtn small cc-all" aria-expanded={all} onClick={() => setAll(!all)}>{all ? t('catalog.card.less') : t('catalog.card.all', { n: has.length })}</button>}
        </div>
      )}
      {not.length > 0 && (
        <details className="cc-block cc-not">
          <summary>{t('catalog.inc.excluded')} <span className="count">{not.length}</span></summary>
          <ul className="cc-list">{not.map((x, i) => <li key={i}><LuX aria-hidden="true" className="no" /><span>{x}</span></li>)}</ul>
        </details>
      )}
      {best && <p className="cc-best"><b>{t('catalog.inc.bestFor')}</b> {best}</p>}
      <footer className="cc-foot"><A to={`/catalog/${s.id}`} className="cc-more">{t('catalog.card.details')}<LuArrowRight aria-hidden="true" /></A></footer>
    </article>
  );
}
