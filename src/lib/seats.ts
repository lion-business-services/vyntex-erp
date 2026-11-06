// User seats per plan. The number of users a plan includes is read from the pricing file (lib/pricing.ts), never typed.
// The same rules run in the browser (the Team page: "X of Y users on your plan") and on the server (api/ws.js refuses an
// invitation past the limit; it reads this file through api/_lib/domain.bundle.mjs).
//   * a plan of the pricing file: its `users` (a number, or unlimited)
//   * the seven-day trial: the edition's highest plan
//   * a quoted, internal or custom plan (not in the pricing file): no limit
// Who counts: active office members (owner, manager, staff, read-only) and open office invitations. A field worker's
// portal account is not a user seat. Existing members are never removed: a limit only stops new invitations.
import { plansFor } from './pricing';
import type { IndustryId } from '@/domain/types';

export const TRIAL_PLAN = 'trial';

/** The users a company's plan includes, or null when it has no limit. */
export function seatLimit(industry: string, planId: string | null | undefined): number | null {
  const plans = plansFor(industry as IndustryId);
  if (!plans.length || !planId) return null;
  const plan = planId === TRIAL_PLAN ? plans[plans.length - 1] : plans.find((p) => p.id === planId);
  if (!plan) return null;
  return plan.users === 'unlimited' ? null : Math.max(0, Number(plan.users) || 0);
}

/** Does a person in this role take one of the plan's user seats? */
export const takesSeat = (role: string): boolean => role !== 'worker';

/** Can one more person in `role` be invited? `used` is members plus open invitations that take a seat. */
export function seatAvailable(limit: number | null, used: number, role: string): boolean {
  return limit === null || !takesSeat(role) || used < limit;
}
