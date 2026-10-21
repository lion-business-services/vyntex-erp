// "Get your workspace ready": the first thing the owner of a new client company sees, until it is done or put away.
// Each step is checked from the workspace itself (the company details filled in, a second person invited, the services
// written, the first clients in, an app connected), so the list keeps itself up to date and nothing is ticked by hand.
// Only in a live workspace, and only for people who may change the company's setup. The demo has its guided tour instead.
import { LuBuilding2, LuCircleCheck, LuCircle, LuContact, LuListChecks, LuPlug, LuShieldCheck, LuUsers, LuX, LuZap } from 'react-icons/lu';
import type { ComponentType } from 'react';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { mutate } from '@/store/store';
import { session } from '@/platform/session';
import { moduleOn } from '@/domain/config';
import { IconButton, cx } from '@/ui';
import type { DemoState } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';

type Icon = ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>;
interface Step { id: string; icon: Icon; to: string; done: boolean }

export function setupSteps(d: DemoState, pack: IndustryPack, mfa: boolean): Step[] {
  const steps: Step[] = [
    { id: 'business', icon: LuBuilding2, to: '/settings/business', done: !!(d.company.phone && d.company.email) },
    { id: 'security', icon: LuShieldCheck, to: '/settings/team', done: mfa },
    { id: 'team', icon: LuUsers, to: '/settings/team', done: d.users.filter((u) => u.active !== false).length > 1 },
  ];
  if (moduleOn(d, pack, 'catalog')) steps.push({ id: 'services', icon: LuListChecks, to: '/catalog', done: (d.catalog ?? []).length > 0 });
  steps.push({ id: 'clients', icon: LuContact, to: '/clients', done: d.clients.length > 0 });
  if (moduleOn(d, pack, 'integrations')) steps.push({ id: 'apps', icon: LuPlug, to: '/integrations', done: (d.connections ?? []).some((c) => c.state === 'connected') });
  if (moduleOn(d, pack, 'automations')) steps.push({ id: 'rules', icon: LuZap, to: '/automations', done: (d.automation?.runs ?? []).length > 0 });
  return steps;
}

export function SetupChecklist() {
  const { t, data, pack, live, can } = useApp();
  if (!live || !can('config') || (data.settings as { setupDone?: unknown }).setupDone) return null;
  const steps = setupSteps(data, pack, session()?.aal === 'aal2');
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const close = () => mutate((d) => { d.settings = { ...d.settings, setupDone: { at: new Date().toISOString() } }; }, 'config');
  return (
    <section className="card dash-setup" aria-labelledby="dash-setup-h" data-testid="dash-setup">
      <header className="dash-setup-head">
        <div className="grow">
          <h2 id="dash-setup-h">{t(done === steps.length ? 'setup.allDone' : 'setup.title', { company: data.company.name })}</h2>
          <p className="small muted">{t('setup.sub')}</p>
        </div>
        <span className="dash-setup-count" aria-label={t('setup.progress', { done, n: steps.length })}>{done}/{steps.length}</span>
        <IconButton size="sm" label={t('setup.hide')} onClick={close} data-testid="dash-setup-hide"><LuX /></IconButton>
      </header>
      <div className="dash-setup-bar" aria-hidden="true"><i style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></div>
      <ol className="dash-setup-list">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.id} className={cx(s.done && 'done', next?.id === s.id && 'next')} data-step={s.id} data-done={s.done ? 'yes' : 'no'}>
              <span className="dash-setup-mark" aria-hidden="true">{s.done ? <LuCircleCheck /> : <LuCircle />}</span>
              <span className="dash-setup-ico" aria-hidden="true"><Icon /></span>
              <span className="grow"><b>{t('setup.' + s.id + '.title')}</b><br /><span className="small muted">{t('setup.' + s.id + '.body')}</span></span>
              {!s.done && <A to={s.to} className={cx('btn sm', next?.id === s.id && 'primary')} data-testid={'dash-setup-' + s.id}>{t('setup.' + s.id + '.go')}</A>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
