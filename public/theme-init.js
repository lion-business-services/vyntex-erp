// Puts the day/night theme on the page before the first paint, so it never flashes the other one while the app loads.
// A separate file because the Content-Security-Policy allows no inline script. Mirrors loadPrefs in src/store/store.ts:
// every visit opens in night, on every device and whatever the system appearance. Only a ?theme=light|dark handed over
// by vyntexusa.com for the visit in progress changes that. A day/night switch is never remembered between visits, so an
// old remembered "day" (saved preference or the vx_mode cookie of earlier versions) is cleared here.
(function () {
  var theme = 'dark';
  try {
    var host = location.hostname, parent = host === 'vyntexusa.com' || host.endsWith('.vyntexusa.com');
    document.cookie = 'vx_mode=; Path=/; Max-Age=0; SameSite=Lax';
    if (parent) document.cookie = 'vx_mode=; Path=/; Max-Age=0; SameSite=Lax; Domain=.vyntexusa.com';
  } catch (e) { /* cookies blocked */ }
  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q === 'light' || q === 'dark') theme = q;
  } catch (e) { /* no URLSearchParams: keep night */ }
  document.documentElement.setAttribute('data-theme', theme);
  // The app is about to start: the readable copy of the page that the server sent for readers without scripts
  // (scripts/prerender.mjs) stays hidden, so the first thing a visitor sees is the app, exactly as before.
  document.documentElement.setAttribute('data-js', '');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111829' : '#D6E8F8');
})();
