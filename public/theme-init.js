// Puts the day/night theme on the page before the first paint, so it never flashes the other one while the app loads.
// A separate file because the Content-Security-Policy allows no inline script. Mirrors loadPrefs in src/store/store.ts:
// a ?theme=light|dark handed over by vyntexusa.com wins; otherwise night only when the visitor picked it (themeSet);
// day is the default.
(function () {
  var theme = 'light';
  try {
    var p = JSON.parse(localStorage.getItem('vyntex.prefs') || '{}') || {};
    if (p.theme === 'dark' && p.themeSet === true) theme = 'dark';
  } catch (e) { /* storage blocked: keep the default */ }
  try {
    // shared with vyntexusa.com (a cookie on .vyntexusa.com): a switch on either site carries over to the other
    var c = /(?:^|;\s*)vx_theme=(light|dark)/.exec(document.cookie);
    if (c) theme = c[1];
  } catch (e) { /* cookies blocked */ }
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q === 'light' || q === 'dark') theme = q;
  } catch (e) { /* no URLSearchParams: keep what storage said */ }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111829' : '#EEF3F9');
})();
