// VYNTEX ERP: connect a company's WhatsApp with one button (Meta's Embedded Signup).
// Opened by the Integrations screen as a small window. It loads Meta's script (this page alone may: see vercel.json),
// opens Meta's own sign-in window, and hands what Meta returned (a one-time code and two ids) back to the screen that
// opened it, on this site's origin only. The screen sends it to the server, which exchanges the code. Nothing is
// stored here, and no token ever reaches this page.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var es = q.get('lang') === 'es';
  var appId = q.get('app') || '', configId = q.get('config') || '', version = q.get('v') || '';
  var T = es ? {
    title: 'Conectar WhatsApp', lead: 'Inicie sesión con Facebook y elija su número de WhatsApp Business. El número sigue siendo suyo; VYNTEX ERP solo envía y recibe sus mensajes.',
    nw: 'Conectar un número', app: 'Seguir usando la aplicación WhatsApp Business en este número',
    hint: 'Elija la segunda opción si este número ya está en la aplicación WhatsApp Business de su teléfono. Sus chats siguen en la aplicación y también aparecen en VYNTEX ERP.',
    loading: 'Cargando…', open: 'Complete los pasos en la ventana de Meta…', done: 'Listo. Puede cerrar esta ventana.', cancel: 'Se canceló. Puede cerrar esta ventana o intentarlo de nuevo.', bad: 'No se pudo abrir la ventana de Meta. Cierre esta ventana y vuelva a intentarlo.', setup: 'Esta conexión aún no está configurada.'
  } : {
    title: 'Connect WhatsApp', lead: 'Sign in with Facebook and choose your WhatsApp Business number. Your number stays yours; VYNTEX ERP only sends and receives your messages.',
    nw: 'Connect a number', app: 'Keep using the WhatsApp Business app on this number',
    hint: 'Choose the second option if this number is already in the WhatsApp Business app on your phone. Your chats stay in the app and appear in VYNTEX ERP too.',
    loading: 'Loading…', open: 'Finish the steps in Meta’s window…', done: 'Done. You can close this window.', cancel: 'Cancelled. You can close this window or try again.', bad: 'Meta’s window could not open. Close this window and try again.', setup: 'This connection is not set up yet.'
  };
  var $ = function (id) { return document.getElementById(id); };
  document.documentElement.lang = es ? 'es' : 'en';
  document.title = T.title + ' · VYNTEX ERP';
  $('title').textContent = T.title; $('lead').textContent = T.lead; $('new').textContent = T.nw; $('app').textContent = T.app; $('hint').textContent = T.hint;
  var status = $('status');
  var say = function (text, tone) { status.textContent = text; status.className = 'status' + (tone ? ' ' + tone : ''); };
  var send = function (msg) { if (window.opener) window.opener.postMessage(Object.assign({ type: 'vx-whatsapp' }, msg), location.origin); };

  if (!window.opener || !/^\d{5,30}$/.test(appId) || !/^\d{5,30}$/.test(configId) || !/^v\d{1,3}\.\d$/.test(version)) { say(T.setup, 'bad'); return; }

  // what Meta's window reports as it goes: the outcome and the ids (session logging)
  var session = null;
  window.addEventListener('message', function (e) {
    var host = '';
    try { host = new URL(e.origin).hostname; } catch (_) { return; }
    if (!(host === 'facebook.com' || /\.facebook\.com$/.test(host))) return;
    var d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; }
    if (!d || d.type !== 'WA_EMBEDDED_SIGNUP') return;
    session = { event: String(d.event || ''), wabaId: String((d.data && d.data.waba_id) || ''), phoneId: String((d.data && d.data.phone_number_id) || '') };
    if (session.event === 'CANCEL' || session.event === 'ERROR') { send({ ok: false, reason: 'denied_at_provider' }); say(T.cancel); enable(true); }
  });

  var enable = function (on) { $('new').disabled = !on; $('app').disabled = !on; };
  say(T.loading);
  window.fbAsyncInit = function () {
    FB.init({ appId: appId, autoLogAppEvents: true, xfbml: false, version: version });
    say(''); enable(true);
  };
  var s = document.createElement('script');
  s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
  s.src = 'https://connect.facebook.net/' + (es ? 'es_LA' : 'en_US') + '/sdk.js';
  s.onerror = function () { say(T.bad, 'bad'); };
  document.head.appendChild(s);

  function start(keepApp) {
    enable(false); say(T.open); session = null;
    var extras = keepApp ? { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' } : { setup: {}, sessionInfoVersion: '3' };
    FB.login(function (res) {
      var code = res && res.authResponse && res.authResponse.code;
      if (!code) { send({ ok: false, reason: 'denied_at_provider' }); say(T.cancel); enable(true); return; }
      // the code lasts 30 seconds: hand it over as soon as Meta's ids have arrived (they come just before or after)
      var tries = 0;
      (function wait() {
        if (session && session.wabaId) { send({ ok: true, code: code, wabaId: session.wabaId, phoneId: session.phoneId, event: session.event }); say(T.done, 'ok'); setTimeout(function () { window.close(); }, 900); return; }
        if (++tries > 20) { send({ ok: false, reason: 'no_phone_number' }); say(T.cancel); enable(true); return; }
        setTimeout(wait, 150);
      })();
    }, { config_id: configId, response_type: 'code', override_default_response_type: true, extras: extras });
  }
  $('new').addEventListener('click', function () { start(false); });
  $('app').addEventListener('click', function () { start(true); });
})();
