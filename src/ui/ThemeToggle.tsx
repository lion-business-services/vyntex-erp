// The day/night switch, the same one everywhere (sales pages, sign-in, workspace). A chrome knob slides along a small
// track; the sun and the moon turn into each other inside it. Its look follows the theme on <html>, not React state, so
// it is right in the very frame the theme changes. The button is a 44px target; the drawn pill is smaller. Styles: ui/theme.css.
import { LuMoon, LuSun } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { cx } from '@/ui';
import { switchTheme } from './theme';

export function ThemeToggle({ className }: { className?: string }) {
  const { t, prefs } = useApp();
  const dark = prefs.theme === 'dark';
  const label = t(dark ? 'theme.toLight' : 'theme.toDark');
  return (
    <button type="button" className={cx('tt', className)} aria-label={label} title={label} data-testid="theme-toggle"
      onClick={(e) => switchTheme(dark ? 'light' : 'dark', e.currentTarget.querySelector('.tt-knob'))}>
      <span className="tt-track" aria-hidden="true">
        <span className="tt-knob"><LuSun className="tt-sun" /><LuMoon className="tt-moon" /></span>
      </span>
    </button>
  );
}
