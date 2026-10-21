// "Works with the tools you already use": every connection the platform lists, from the same catalogue the Integrations
// screen reads (src/features/integrations/catalog.ts), each one marked as ready to connect or on the roadmap. Nothing here
// is a logo or a partnership claim: the names are the providers' own, set in plain type next to an icon of what they do.
import { LuCircleCheck, LuPlug, LuSparkles } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Reveal, useInView } from '@/brand';
import { GROUPS, PROVIDERS } from '@/features/integrations/catalog';
import { cx } from '@/ui';
import { DemoLink, Head } from './shared';
import './integrations.css';

export function IntegrationsSection() {
  const { t } = useApp();
  const { ref, seen } = useInView<HTMLDivElement>('0px 0px -10% 0px');
  const ready = PROVIDERS.filter((p) => !p.planned).length;
  let i = 0;
  return (
    <section className="mks mks-in" aria-labelledby="mks-in-h">
      <Head id="mks-in-h" title={t('mk.s.in.h')} sub={t('mk.s.in.sub')} />
      <div className={cx('mks-in-grid', seen && 'in')} ref={ref} data-testid="mk-integrations">
        {GROUPS.map((g) => (
          <div key={g} className="mks-in-group">
            <h3 className="mks-in-gh">{t('integrations.group.' + g)}</h3>
            <ul>
              {PROVIDERS.filter((p) => p.group === g).map((p) => {
                const Icon = p.icon;
                return (
                  <li key={p.id} className={cx('mks-in-app', p.planned && 'soon')} style={{ ['--i' as string]: i++ }} data-provider={p.id}>
                    <span className="mks-in-ic" aria-hidden="true"><Icon /></span>
                    <span className="mks-in-name">{p.nameKey ? t(p.nameKey) : p.name}</span>
                    <span className="mks-in-state">{p.planned ? t('integrations.planned') : t('mk.s.in.ready')}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <Reveal className="mks-in-foot">
        <p className="mks-in-note"><LuCircleCheck aria-hidden="true" />{t('mk.s.in.count', { n: ready, m: PROVIDERS.length - ready })}</p>
        <p className="mks-in-note"><LuSparkles aria-hidden="true" />{t('mk.s.in.demo')}</p>
        <DemoLink to="/integrations" testId="mk-in-demo"><LuPlug aria-hidden="true" />{t('mk.s.in.link')}</DemoLink>
      </Reveal>
    </section>
  );
}
