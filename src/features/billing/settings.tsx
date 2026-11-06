// Settings, Billing: the billing panel for the company that is open.
import { session } from '@/platform/session';
import { BillingPanel } from './panel';

export default function BillingSettings() {
  const s = session();
  return s && s.tenantId ? <BillingPanel tenantId={s.tenantId} /> : null;
}
