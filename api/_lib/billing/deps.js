// The outside world of the billing core (api/_lib/billing/core.js), for real: Stripe, the database, system email.
import { appOrigin, env } from '../env.js';
import { serviceRpc } from '../supabase.js';
import { sendSystemEmail } from '../mail.js';
import { stripe } from './stripe.js';

/** Where VYNTEX's own billing notices go (new subscription, failed payment, pause). */
export const notifyTo = () => env('BILLING_NOTIFY_TO') || 'info@vyntexusa.com';

export function billingDeps(request) {
  return {
    stripe: (m, p, params, o) => stripe(m, p, params, o),
    rpc: (name, args) => serviceRpc(name, args),
    mail: (msg) => sendSystemEmail(msg),
    now: () => Date.now(),
    notifyTo: notifyTo(),
    origin: request ? appOrigin(request) : (env('APP_ORIGIN') || 'https://erp.vyntexusa.com'),
  };
}
