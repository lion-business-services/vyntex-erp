# VYNTEX BARBER: the barbershop edition (work in progress)

Started on October 15, 2026, modeled on the ideas of a barbershop admin portal the owner provided. No name, price, photo
or text of that shop is used; the sample shop "Northline Barber Studio" is fictional. Quoted on request: barbershop is
not in the pricing file.

## What it adds
* **Shop floor** (`/floor`): chairs and their status, the walk-in line with wait estimates that respect booked
  appointments, call, seat, checkout with tips, a self check-in kiosk, the waiting-area display (first name and initial
  only), insights (due for a cut, busy hours, chair load, no-show watch list), walk-in history, chairs and settings.
* **Memberships** (`/memberships`): monthly memberships, packages, gift cards with codes, loyalty points and rewards.
* **Barber pay** (`/barber-pay`): weekly statements (shop-client split, own-client rate, tips to the barber, chair rent),
  paid once after the week ends, frozen.
* Shop automations (place-in-line text, chair ready, long wait, rebooking, lapsed clients, passes low, membership billing,
  reviews after visits). Messages are drafts; nothing is sent by itself.
* Database: `supabase/migrations/0063_barbershop.sql` (chairs, pass_plans, passes, walkins, payouts) with forced RLS,
  guards and gateway registration.

## Verified so far
`npm run check`, unit tests (311), `test:db` (incl. parity and gateway round trip of the barbershop sample), `test:server`,
`test:security`, `test:split`, `test:integrations`, `test:e2e` incl. `tests/e2e/barber.e2e.test.mjs`, `tests/qa_barber.py`
(196 checks), `tests/qa_matrix.py barber`.

## Still to do
Final browser pass after the last wording changes, then merge with the client-workspaces release.
