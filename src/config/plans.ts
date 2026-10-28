// Plan ids that are not a priced plan of the pricing file (src/lib/pricing.ts) but a state of the company.
//   trial     the 7-day trial, given only by invitation (docs/BILLING.md)
//   quoted    an edition priced by quotation
//   internal  VYNTEX's own workspace: free, for good. No edition line in the sidebar, no billing page, no checkout.
export const INTERNAL_PLAN = 'internal';
