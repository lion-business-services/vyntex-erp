// Billing and subscription of a live company (VYNTEX ERP only). Shown in Settings, Billing, and on the "paused" screen of
// sign-in, so an owner whose trial ended or whose payment failed can pay without getting into the workspace first.
// Every figure comes from the pricing library; the server prices the plan again and makes the Stripe link
// (api/billing.js). Nothing about cards or banks passes through this page: Stripe's own pages take them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuCreditCard, LuExternalLink, LuShieldCheck } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { get, post } from '@/platform/live/http';
import { planName, plansFor, yearlySavings } from '@/lib/pricing';
import { money } from '@/lib/money';
import { PACKS, isIndustry } from '@/packs';
import { Badge, Button, Card, Note, cx } from '@/ui';
import type { Tone } from '@/ui';
import './billing.css';

export interface BillingStatus {
  tenant: string; slug: string; name: string; industry: string; plan: string; status: string; role: string;
  trialStartedAt: string | null; trialExpiresAt: string | null;
  subscription: null | { status: string; plan: string | null; billing: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null; lastPaymentAt: string | null };
  hasCustomer: boolean; available: boolean; mode: 'test' | 'live' | null;
}

const DAY = 86_400_000;
const LIVE_SUB = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

export function BillingPanel({ tenantId, compact = false }: { tenantId: string; compact?: boolean }) {
  const { t, lang } = useApp();
  const [st, setSt] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const query = useMemo(() => new URLSearchParams(typeof location !== 'undefined' ? location.search : ''), []);
  const outcome = query.get('billing');

  const load = useCallback(async () => {
    const r = await get<{ billing: BillingStatus }>(`/api/billing/status/${tenantId}`, { passive: true });
    if (r.ok) { setSt(r.data.billing); setFailed(false); } else setFailed(true);
    return r.ok ? r.data.billing : null;
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  // back from Stripe: keep asking for a short while until the webhook has made the subscription active
  useEffect(() => {
    if (outcome !== 'success') return;
    let n = 0; let stop = false;
    const tick = async () => {
      if (stop) return;
      const s = await load();
      n += 1;
      if (s && s.subscription && ['active', 'trialing'].includes(s.subscription.status)) return;
      if (n < 20) setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
    return () => { stop = true; };
  }, [outcome, load]);

  const industry = st && isIndustry(st.industry) ? st.industry : null;
  const plans = industry ? plansFor(industry) : [];
  const product = industry ? PACKS[industry].product : 'VYNTEX ERP';
  const owner = st?.role === 'owner';
  const sub = st?.subscription ?? null;
  const subscribed = !!sub && LIVE_SUB.includes(sub.status);
  const date = (v: string | null) => (v ? new Date(v).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

  const statusLine = (): { text: string; tone: Tone } => {
    if (!st) return { text: '', tone: 'neutral' };
    if (sub && sub.status !== 'canceled') return { text: t(`bill.st.${sub.status}`), tone: sub.status === 'active' || sub.status === 'trialing' ? 'ok' : sub.status === 'incomplete' ? 'info' : 'bad' };
    if (st.plan === 'trial' && st.trialExpiresAt) {
      const left = Math.ceil((Date.parse(st.trialExpiresAt) - Date.now()) / DAY);
      if (left <= 0) return { text: t('bill.st.trialEnded'), tone: 'bad' };
      return { text: left === 1 ? t('bill.st.trial1') : t('bill.st.trial', { n: left }), tone: 'warn' };
    }
    if (st.status === 'suspended') return { text: t('bill.st.paused'), tone: 'bad' };
    return { text: t(sub ? 'bill.st.canceled' : 'bill.st.none'), tone: 'neutral' };
  };

  const go = async (path: string, body: Record<string, unknown>, key: string) => {
    setBusy(key); setError('');
    const r = await post<{ url: string }>(path, { tenant: tenantId, lang, ...body });
    if (r.ok && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(r.data.url)) { location.assign(r.data.url); return; }
    setBusy(null);
    setError(r.ok ? t('bill.err.generic') : t(`bill.err.${r.code}`) !== `bill.err.${r.code}` ? t(`bill.err.${r.code}`) : t('bill.err.generic'));
  };

  if (failed && !st) return <Card title={t('bill.title')}><Note tone="bad"><span role="alert">{t('bill.unavailable')}</span></Note><Button onClick={() => { void load(); }}>{t('bill.retry')}</Button></Card>;
  if (!st) return <Card title={t('bill.title')}><div className="page-loading" role="status" aria-live="polite"><span className="sr">{t('bill.loading')}</span></div></Card>;

  const s = statusLine();
  return (
    <Card title={compact ? undefined : t('bill.title')} className={cx('vx-bill', compact && 'compact')}>
      {!compact && <p className="muted settings-lead">{t('bill.intro')}</p>}
      {outcome === 'success' && <Note><span role="status" data-testid="bill-success">{sub && ['active', 'trialing'].includes(sub.status) ? t('bill.success') : t('bill.successWait')}</span></Note>}
      {outcome === 'cancelled' && <Note tone="warn"><span role="status" data-testid="bill-cancelled">{t('bill.cancelled')}</span></Note>}
      {st.mode === 'test' && <p className="xs dim" data-testid="bill-test-mode">{t('bill.testMode')}</p>}

      <dl className="kv vx-bill-kv" data-testid="bill-status">
        <dt>{t('bill.status')}</dt><dd><Badge tone={s.tone}>{s.text}</Badge></dd>
        <dt>{t('bill.plan')}</dt><dd>{(() => { const id = sub?.plan || st.plan; const p = plans.find((x) => x.id === id); return p ? `${product} ${planName(p, lang)}` : product; })()}</dd>
        {sub?.currentPeriodEnd && sub.status !== 'canceled' && <><dt>{sub.cancelAtPeriodEnd ? t('bill.ends') : t('bill.renews')}</dt><dd>{date(sub.currentPeriodEnd)}</dd></>}
        {sub?.lastPaymentAt && <><dt>{t('bill.lastPayment')}</dt><dd>{date(sub.lastPaymentAt)}</dd></>}
      </dl>
      {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd && <Note>{t('bill.cancelsAt', { date: date(sub.currentPeriodEnd) })}</Note>}
      {sub?.graceUntil && <Note tone="bad"><span role="alert" data-testid="bill-grace">{t('bill.grace', { date: date(sub.graceUntil) })}</span></Note>}
      {st.status === 'suspended' && <Note tone="warn">{t('bill.paused')}</Note>}
      {!owner && <p className="small muted" data-testid="bill-owner-only">{t('bill.ownerOnly')}</p>}

      {owner && !st.available && <Note>{t('bill.notReady')}</Note>}

      {owner && st.available && subscribed && (
        <div className="vx-bill-manage">
          <div><b>{t('bill.manage')}</b><p className="small muted">{t('bill.manageSub')}</p></div>
          <Button variant="primary" icon={<LuExternalLink aria-hidden="true" />} disabled={busy !== null} onClick={() => { void go('/api/billing/portal', {}, 'portal'); }} data-testid="bill-manage">{busy === 'portal' ? t('bill.opening') : t('bill.manage')}</Button>
        </div>
      )}

      {owner && st.available && !subscribed && plans.length === 0 && <Note>{t('bill.quoted', { product })}</Note>}

      {owner && st.available && !subscribed && plans.length > 0 && (
        <section className="vx-bill-choose" aria-labelledby="bill-choose-h">
          <div className="row between wrap">
            <div><h3 id="bill-choose-h">{t('bill.choose')}</h3><p className="small muted">{t('bill.chooseSub')}</p></div>
            <div className="vx-bill-switch" role="group" aria-label={t('bill.choose')}>
              <button type="button" aria-pressed={billing === 'monthly'} onClick={() => setBilling('monthly')} data-testid="bill-monthly">{t('bill.monthly')}</button>
              <button type="button" aria-pressed={billing === 'yearly'} onClick={() => setBilling('yearly')} data-testid="bill-yearly">{t('bill.yearly')}</button>
            </div>
          </div>
          <div className="vx-bill-plans">
            {plans.map((p) => {
              const recurring = billing === 'yearly' ? p.yearly : p.monthly;
              const saves = yearlySavings(p);
              return (
                <article key={p.id} className={cx('vx-bill-plan', p.mostPopular && 'popular')} data-testid={`bill-plan-${p.id}`}>
                  <header className="row between nowrap"><h4>{planName(p, lang)}</h4>{p.mostPopular && <Badge tone="accent">{t('bill.popular')}</Badge>}</header>
                  <p className="vx-bill-price"><b>{money(recurring)}</b> <span className="small muted">{t(billing === 'yearly' ? 'bill.perYear' : 'bill.perMonth')}</span></p>
                  {billing === 'yearly' && saves > 0 && <p className="xs vx-bill-save">{t('bill.saves', { amount: money(saves) })}</p>}
                  <dl className="vx-bill-lines">
                    <dt>{t('bill.setup')}</dt><dd>{money(p.setup)}</dd>
                    <dt><b>{t('bill.first')}</b></dt><dd><b>{money(p.setup + recurring)}</b></dd>
                  </dl>
                  <p className="xs muted">{t('bill.then', { amount: money(recurring), period: t(billing === 'yearly' ? 'bill.perYear' : 'bill.perMonth') })}</p>
                  <Button variant={p.mostPopular ? 'primary' : undefined} icon={<LuCreditCard aria-hidden="true" />} disabled={busy !== null} onClick={() => { void go('/api/billing/checkout', { plan: p.id, billing }, p.id); }} data-testid={`bill-pay-${p.id}`}>
                    {busy === p.id ? t('bill.paying') : t('bill.pay')}
                  </Button>
                </article>
              );
            })}
          </div>
          <p className="xs muted row tight"><LuShieldCheck aria-hidden="true" />{t('bill.methods')}</p>
        </section>
      )}
      {error && <Note tone="bad"><span role="alert" data-testid="bill-error">{error}</span></Note>}
    </Card>
  );
}
