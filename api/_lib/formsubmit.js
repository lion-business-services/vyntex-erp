// FormSubmit (https://formsubmit.co) settings for the demo request notification (api/demo-request.js, api/health.js).
// Owner decision: every valid "Request a demo" submission notifies VYNTEX through FormSubmit, whatever else is configured.

const FORMSUBMIT_DEFAULT_EMAIL = 'info@vyntexusa.com';

/** Where FormSubmit notifications go, or '' when FormSubmit is off. */
export function formSubmitTarget(env) {
  const flag = String(env.FORMSUBMIT_ENABLED || '').trim().toLowerCase();
  if (flag === 'false') return '';
  // the LBS deployment has no sales pages: it only notifies when that is asked for explicitly
  if (String(env.VX_DEPLOY || '').trim().toLowerCase() === 'lbs' && flag !== 'true') return '';
  const email = String(env.FORMSUBMIT_EMAIL || '').trim().toLowerCase();
  // only a plain address can become part of the URL; anything else falls back to the default inbox
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) ? email : FORMSUBMIT_DEFAULT_EMAIL;
}
