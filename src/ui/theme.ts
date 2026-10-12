// Day and night. `applyTheme` puts a theme on the page; `switchTheme` is what a toggle calls: it saves the choice and
// animates the change. Browsers with view transitions reveal the new theme in a circle growing from the toggle; others
// cross-fade colours for a moment; with reduced motion the swap is instant. public/theme-init.js applies the saved
// theme before the first paint, so a page never flashes the other one while the bundle loads.
import { flushSync } from 'react-dom';
import { setPrefs, type Prefs } from '@/store/store';

export type Theme = Prefs['theme'];
const REVEAL_MS = 550;
const FADE_MS = 350;
const EASE = 'cubic-bezier(.22,1,.36,1)';

/** Sets the theme on <html> and gives the browser chrome (mobile address bar) the page's own ground colour. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  // read from the stylesheet, so each brand (VYNTEX, LBS) reports its own ground
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg && meta.content !== bg) meta.content = bg;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
interface Transition { ready: Promise<void>; finished: Promise<void> }
/** View transitions, typed here so the code does not depend on the DOM typings of a given TypeScript version. */
interface VTDocument { startViewTransition?: (cb: () => void) => Transition }

/** Saves and shows `next`. `origin` is the control that asked, so the reveal starts where the visitor clicked. */
export function switchTheme(next: Theme, origin?: Element | null): void {
  const root = document.documentElement;
  const commit = () => { flushSync(() => setPrefs({ theme: next })); applyTheme(next); };
  if (root.dataset.theme === next || reduced()) { commit(); return; }
  const doc = document as unknown as VTDocument;
  if (typeof doc.startViewTransition === 'function') {
    const r = origin?.getBoundingClientRect();
    const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : 0;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-vt');
    let vt: Transition;
    try { vt = doc.startViewTransition(commit); } catch { root.classList.remove('theme-vt'); commit(); return; }
    vt.ready.then(() => {
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] }, { duration: REVEAL_MS, easing: EASE, pseudoElement: '::view-transition-new(root)' } as KeyframeAnimationOptions);
    }, () => undefined);
    vt.finished.finally(() => root.classList.remove('theme-vt'));
    return;
  }
  // no view transitions: colours ease across for a moment (gradients cannot, they simply change)
  root.classList.add('theme-fade');
  commit();
  window.setTimeout(() => root.classList.remove('theme-fade'), FADE_MS + 30);
}
