# VYNTEX Partner Portal: catalog and commercial-data mapping (Phase A)

Date: 2026-10-22. Machine-readable twin: `catalog-import.json` (integer cents; rates in basis points; each figure carries `provenance {source, ref}` and
`status` `approved_source` | `needs_approval` | `informational_estimate`). This file holds **no personal data**: the legacy database has 0 partners, 0 leads and 0 payouts.

Short source keys used below:

| Key | Location |
| --- | --- |
| **MCI** | `lbs-vyntex-mastercommand@d306a48:public/vyntex/index.html`. This is the published copy: Netlify publishes `public/`. The root `vyntex/index.html` is a **different, stale duplicate** and is not a source. |
| **SG** | `…/public/vyntex/seller-guide.html` ("Internal document. Prices approved 17 September 2026", l.351) |
| **UP** | `…/public/vyntex/vx-upgrade.js` |
| **SQL1** | `…/sql/1-vyntex-setup.sql`; **SQL4** `…/sql/4-master-upgrade.sql` |
| **VXC** | `…/public/vyntex/vyntex-catalog.html` |
| **DB** | legacy Supabase `yzdyuyxfsqxfgkroykfr`, table and key |
| **WP** | `vyntex-site@431f971:lib/pricing.ts` ("LEGACY INTERNAL PRICE BOOK", l.4) |
| **WR** | `vyntex-site:lib/pricing-reseller.ts` (`server-only`, CONFIDENTIAL) |
| **WRP** | `vyntex-site:lib/reseller-program.ts` |
| **WSC** | `vyntex-site:lib/services-catalog.ts` (public, price-free, bilingual) |
| **ERPJ** | `vyntex-erp@0e07446:config/vyntex-build-pricing.json` (version `2026-09-26h`) |

Effective dates found: SG prices approved **2026-09-17**. ERPJ / `VXB_BASE` version **2026-09-26h**. Master Command files were uploaded to git on **2026-10-02** (`dfeda94`;
history before that is not available). DB `vx_settings.vyntex_catalog` was saved 2026-09-30 (text patch only). No other effective dates exist.

**Which data is authoritative today.** DB `vx_settings` contains only `vyntex_catalog` (a rev 2 text patch to the VYNTEX BUILD page headline). There is **no
`pricing`, `catalog`, `vyntex_build` or `partner_portal` key**, so the Command Center runs on its hard-coded `PRICING`/`CATALOG`/`VXB_BASE` defaults, and the
live `vx_partner_fee` uses its hard-coded fallbacks. The tables `partners`, `payouts`, `vx_partner_links` and `leads` are empty.

---

## 1. Services and packages (Master Command catalog, 17 items; EN + ES complete for name, tagline, best-for, includes, excludes and lead time)

Text: MCI `CATALOG`. The public wording in WSC is identical for 13 items. The differences are only price-related lines (for `aifront`, `crm-premium`, `web-custom`, `ai-advanced`
and `social-mgmt`, WSC removed "billed at cost" and "quoted" wording) [C, programmatic diff].
Deposit = 50% of setup (MCI l.882, `deposit()` l.890, which rounds to whole dollars; SG l.650). Minimum term 12 months on CRM and packages (MCI l.883; SG l.652).

| id | Name EN / ES | Setup | Deposit (legacy display) | Monthly | MCI PRICING / CATALOG line | SG line | WP line | WSC line | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| starter | Starter / Starter | $897 | $449 | $347 (12-mo term) | 859 / 2385 | 510 | — | 104 | approved_source |
| growth | Growth / Growth | $1,497 | $749 | $547 | 860 / 2394 | 519 | — | 177 | approved_source |
| complete | Complete / Complete | $2,497 | $1,249 | $747 | 861 / 2403 | 528 | — | 258 | approved_source |
| aifront | AI Front Desk / Recepción con IA | $3,497 | $1,749 | $997 (500 AI voice min incl.) | 862 / 2412 | 537 | — | 319 | approved_source |
| crm-basic | Basic CRM / CRM básico | $497 | $249 | $247 | 865 / 2422 | 549 | 66 (**$1,000 + $149**) | 390 | approved_source (conflict C1) |
| crm-standard | Standard CRM / CRM estándar | $897 | $449 | $397 | 866 / 2431 | 556 | 67 (**$1,500 + $225**) | 457 | approved_source (C1) |
| crm-premium | Premium CRM / CRM premium | $1,497 | $749 | $697 | 867 / 2440 | 563 | — | 526 | approved_source |
| web-basic | Basic Website / Sitio web básico | $500 | $250 | $149 care plan, **optional** | 870 / 2450 | 581 | 56 | 597 | approved_source |
| web-std | Standard Website / Sitio web estándar | $1,100 | $550 | $189 care plan, optional | 871 / 2459 | 583 | 57 | 654 | approved_source |
| web-custom | Custom Website / Sitio web a la medida | $2,000+ (quote) | — | — | — / 2468 | 585 | 58 | 715 | **needs_approval → "Request a quote"** |
| ai-simple | Simple AI Tool / Herramienta de IA simple | $500 | $250 | $149 | — / 2478 | 590 | 61 ("maintenance from $149") | 764 | approved_source (partner pay: C11) |
| ai-standard | Standard Automation / Automatización estándar | $1,200 | $600 | $189 | — / 2487 | 592 | 62 | 817 | approved_source (C11) |
| ai-advanced | Advanced AI / IA avanzada | $2,000+ (quote) | — | — | — / 2496 | 594 | 63 | 872 | **needs_approval** |
| brand-logo | Brand Logo / Logo | $125 | $63 | — | 872 / 2506 | 599 | 71 | 921 | approved_source |
| brand-bundle | Brand Bundle / Paquete de marca | $350 | $175 | — | 873 / 2515 | 601 | 72 | 972 | approved_source |
| brand-kit | Full Brand Kit / Kit de marca completo | $600 | $300 | — | 874 / 2524 | 603 | 73 | 1023 | approved_source |
| social-mgmt | Social Media Management / Manejo de redes sociales | **$350** | $175 | $149 | 875 / 2533 | 610 (**no setup**) | 77 (no setup) | 1074 | **needs_approval (C2)** |

Items that appear outside the Master Command catalog:

| id | Name EN / ES | Price | Source | Status |
| --- | --- | --- | --- | --- |
| crm-custom | Custom CRM / CRM a la medida | $4,000+ setup, quote, 50% deposit, maintenance quoted | SG l.570-576; WP l.68 | needs_approval |
| social-setup | Social Media Setup / Configuración de redes | $250 one-time | SG l.608; WP l.76 | needs_approval (C2) |

"Separate-purchase" comparison values in SG (`sepSetup`/`sepMonthly`, l.510-537: Starter $1,122/$396, Growth $2,347/$596, Complete $3,347/$894, AI Front Desk
$4,647/$1,244) and client usage "wallet" ranges are sales talking points, not prices. They are not imported as prices.

## 2. Add-ons and rates (SG only; EN + ES present)

| Item | Setup | Monthly | SG line | Status |
| --- | --- | --- | --- | --- |
| AI voice receptionist added to Basic or Standard CRM | $500 | +$297 | 616 | approved_source (single source) |
| AI chatbot added to Basic or Standard CRM | $300 | +$197 | 617 | approved_source |
| Additional location or business | $297 | +$147 | 618 | approved_source |
| Additional pipeline | $150 | — | 619 | approved_source |
| Additional calendar or staff member | $75 | — | 620 | approved_source |
| Extra landing page | $450 | — | 621 | approved_source |
| Migration from another system | $297–$997 | — | 622 | needs_approval (range → quote) |
| Google or Meta ad management | $500 | $500–$1,500 + ad spend | 623 | needs_approval |
| Search engine optimization | — | $800–$1,500 | 624 | needs_approval |
| Online store | $1,500+ | — | 625 | needs_approval |
| Membership or course setup | $997 | +$97 | 626 | approved_source |
| Extra training session | $150/hr | — | 627 | approved_source (see C13) |
| Rush build (50% faster) | +35% of setup | — | 628 | approved_source (C15) |
| Hourly: build and configuration $125 · strategy and consulting $175 · after-hours emergency $195 · training $150 · changes beyond allowance $125 | — | — | 632-636 (MCI service agreement §5 confirms $125) | approved_source (C14) |

Pass-through usage (billed at cost and never commissionable; SG l.640-646): phone number $2–$5/mo · A2P $15–$20 once + $2–$10/mo · SMS $0.02–$0.03 ·
call minutes $0.05–$0.08 · AI voice minutes $0.15–$0.25 · domain $15–$20/yr · ad spend. These are **informational estimates**, not VYNTEX prices.

## 3. ERP software (VYNTEX BUILD family): published

ERPJ = MCI `VXB_BASE` (l.3603) = VXC l.457 [C]. Plan names have EN + ES. Features are EN only in ERPJ (VXC has ES feature text).

| Plan | Monthly | Yearly | Setup | Welcome credit | Ref |
| --- | --- | --- | --- | --- | --- |
| Foundation / Cimiento (BUILD) · Essential / Esencial (other 7 editions) | $59 | $708 (no discount) | $299 | — | ERPJ `plans[foundation]`, `other_industries.plans[essential]` |
| Builder / Constructor · Pro / Pro | $119 | $1,309 (1 month free) | $499 | $100 toward another VYNTEX service setup, 90 days | ERPJ `plans[builder]` |
| Master Builder / Maestro Constructor · Elite / Élite | $169 | $1,690 (2 months free) | $599 | $250 toward Social Media Management setup, 90 days | ERPJ `plans[master_builder]` |

Add-ons (ERPJ `add_ons`): extra user (Foundation) $15/mo per user · 1099 prep $15/form · 1099 e-file and mail $10/form · extra training $75 one-time · data entry $45/hr ·
Client Portal "quoted, do not publish a price", status "Not built yet" · custom report quoted · SMS usage rebilled.
Editions covered: build, clean, landscape, wash, haul, snow, turnover, events. `practice` and `barber` have no plans and are quoted (`src/lib/pricing.ts` `isPriced`).
**Partner compensation on ERP software: no source defines it → Needs VYNTEX Approval.**

## 4. Commercial terms (clients)

| Term | Value | Source | Status |
| --- | --- | --- | --- |
| Deposit | 50% of setup at signing, balance at go-live; non-refundable once build begins | MCI l.882, 2659-2661; SG l.650 | approved_source |
| Setup split | 3 equal payments on request | SG l.651; MCI l.2661 | approved_source |
| Minimum term | 12 months on CRM and packages, then month to month with 30 days notice | SG l.652; MCI l.883 | approved_source |
| Annual prepay | pay 10 months, get 12 | SG l.653; MCI l.2661 | approved_source |
| Monthly floor | $247/mo; never discount the monthly (discount setup, split payments, or a free month on annual) | SG l.312, 675 | approved_source |
| Early cancellation | 50% of remaining months; failed payment suspends after 10 days | MCI service agreement §10 (l.2661) | approved_source |
| Proposal validity | 30 days | MCI proposal template l.2667 | approved_source |
| Non-refundable fees | deposit, setup after go-live, monthly already paid, usage consumed | MCI §9 (l.2661); proposal §7 | approved_source |
| 2.9% service fee | **only rule found: "No 2.9% service fee line on VYNTEX BUILD or any industry edition: VYNTEX absorbs processing fees."** No source applies a 2.9% fee to services | ERPJ `rules[6]`; MCI l.3739, 3842 (ES) | ERP rule approved. **Any 2.9% fee on services → Needs VYNTEX Approval** |

## 5. Partner models found

### 5.1 Recommended current model: Master Command (VYNTEX bills the client; matches the owner's statement)

**Referral partner** (flat, one time; "no percentage, no volume escalator, no monthly commission"):

| Applies to | Fee | Sources |
| --- | --- | --- |
| Basic CRM, Starter | **$150** | MCI `PRICING.referralFees` l.877-878; referral agreement §2 l.2663 (ES l.2678); SQL1 `vx_partner_fee` fallback l.271-275; SG `COMMISSIONS` l.427 |
| Standard CRM, Growth | **$200** | same; SG l.428 |
| Premium CRM, Complete, AI Front Desk | **$250** | same; SG l.429 |
| Custom builds | quoted case by case → **Needs approval** | MCI l.2663; SG l.430 |
| Websites, AI tools, branding, social | **no amount defined** → **Needs approval** | SG l.426 ("Reseller price instead"), l.590/592 ("Referral fee" without amount) |

**Revenue-share partner** ("VYNTEX PAYS OUT, not a discount", MCI l.879-881):

| Rule | Value | Sources |
| --- | --- | --- |
| CRM, packages, AI tools: setup | **20% of setup** (2000 bps) | MCI l.881 `setupRate:0.20`; reseller agreement §3 l.2665; SQL1 l.268/287; UP l.256-265 |
| CRM, packages, AI tools, social mgmt: monthly | **3% of the monthly** (300 bps), while the client keeps paying | MCI l.881 `monthlyRate:0.03`; agreement §3, §5; MCI l.2928 |
| Websites, branding, social setup: one-time | **35% of the one-time fee** (3500 bps) on orders ≥ **$350, whole order** | MCI l.881 `oneTimeRate:0.35, minimumOrder:350`; agreement §4 |
| Website care plans | earn nothing | agreement §5; code l.1604 |
| Pass-through usage | never commissionable | agreement §6; SG l.465-467 |
| One lane per client | no flat fee plus revenue share on one deal | MCI l.2924 |
| Monthly share stops | client cancels; agreement lapses or is not renewed; minimum missed (30 days notice; earned amounts never clawed back for a missed minimum) | agreement §7, §11 |
| Term and minimum | 1-year term renewing by written agreement; **activation fee: none**; minimum **2 new go-live clients per rolling 12 months** | agreement §11 → **Needs approval (C5/C6)** |
| Partner portal promise | "secure login showing referred clients, status, earned, pending, scheduled payment dates; own accounts only" | agreement §12, which is what the new portal must deliver |

Legacy computed shares (UP `shareCents` and the partner page rounding to whole dollars; the exact value in brackets):
Starter $179 [179.40] + $10/mo [10.41] · Growth $299 [299.40] + $16 [16.41] · Complete $499 + $22 [22.41] · AI Front Desk $699 + $30 [29.91] ·
Basic CRM $99 [99.40] + $7 [7.41] · Standard CRM $179 + $12 [11.91] · Premium CRM $299 + $21 [20.91] · Basic Website $175 · Standard Website $385 ·
Brand Logo alone: under the minimum (35% = $43.75 once the order is ≥ $350) · Brand Bundle $122 [122.50] · Brand Kit $210 · Social Mgmt $122 [122.50] + $4/mo [4.47].
These are **derived** from the rules, not separate source figures. The rounding policy needs approval (C7b).

**Payout triggers and conditions (written terms):**
- Nothing is paid at deposit. A referral fee or setup share becomes payable when the client **goes live and pays the balance**, and is paid **within 15 days of go-live**, by direct deposit or Zelle
  (referral §3; reseller §8; SG `PAYOUT` l.473-485; MCI l.2933).
- The monthly share is paid **in arrears for each month VYNTEX collects**, and never on an uncollected invoice (reseller §8; MCI l.2934).
- **Clawback:** if the client cancels within **90 days of go-live**, the full referral fee or setup share is returned, deducted from the next payout or invoiced (referral §4; reseller §9; SQL1 l.315-322).
- **Attribution:** submitted through the partner form; credited for **90 days** from submission; **first submission wins**; existing pipeline or clients are ineligible; no exclusive territory (referral §5; SG l.474-475).
- **Tax:** W-9 before any payment; 1099-NEC at **$600+** per calendar year (referral §6; reseller §15; MCI l.2936; UP l.268). **Needs approval and tax verification** (the threshold may have changed for 2026).
- **Professional compliance (CPAs):** where a fee cannot be accepted, a **$200 discount** goes to the referral plus a VYNTEX CRM account for the partner while they have an active referred client (referral §7; SG l.332) → Needs approval (non-cash obligation).
- **Volume:** no volume bonus; 10+ referrals in 12 months → invitation to Authorized Reseller with the activation fee waived (SG l.433-438) → Needs approval.

### 5.2 Seller guide "Authorized Reseller" (conflicting; superseded candidate)
The reseller sells, **bills its own client** and gives first-line support. **20% of setup + 10% of the monthly** while the client stays (SG l.421, 452-458; example Growth "$299 + $54.70/mo", l.459-461).
Website, branding and social are bought at a **reseller price 35% off list** on orders ≥ $350 (SG l.322, 426, 440-449: Brand Bundle $228, Brand Kit $390, Basic Website $325, Standard Website $715, Social Setup $163; Brand Logo $81 at l.599 vs "does not qualify" at l.441).
"Activation fee + annual term + minimum sales: set these before recruiting" (l.421). "No reseller has been signed under any earlier wholesale structure" (l.326).

### 5.3 Website wholesale reseller (conflicting; superseded candidate; CONFIDENTIAL figures)
The partner buys at **70% of the suggested resale price (30% margin)** (WR l.36-58). **$199/yr activation**, **minimum 4 resales per year** (WRP l.8-12; agreement v2.0 §2.2).
Its CRM resale prices differ from Master Command (Basic $1,000 + $149, Standard $1,500 + $225, Custom $6,000+). These figures must never be shown publicly.

### 5.4 Legacy implementation vs written terms (do not port)
SQL1 `vx_payouts_maintain` makes fees payable only after 90 days and creates monthly shares for every elapsed month without collection evidence. The minimum is checked per
line, not per order. AI tools are not covered. Details are in AUDIT.md §7.

---

## 6. CONFLICTS

| # | Topic | Source A | Source B (and C) | Notes |
| --- | --- | --- | --- | --- |
| C1 | CRM prices | MCI and SG: Basic $497 + $247, Standard $897 + $397, Premium $1,497 + $697 | WP l.66-68: Basic $1,000 + $149, Standard $1,500 + $225, Custom $4,000+ (no Premium) | WP calls itself a legacy internal price book; SG "approved 17 Sep 2026" |
| C2 | Social media | MCI l.875/2533: Social Media Management **$350 setup** + $149/mo | SG l.608-610 and WP l.76-77: **Social Media Setup $250** (separate) + Management $149/mo with no setup | Different structure and price |
| C3 | Reseller monthly rate | MCI, SQL1, agreement: **3%** | SG l.417-421, 457: **10%** (Authorized Reseller lane) | Owner says 3% |
| C4 | Reseller model | MCI: VYNTEX bills; partner paid a share | SG: reseller bills its own client, 35% off list; WR: wholesale 30% margin | Three incompatible models |
| C5 | Reseller minimum | MCI agreement §11: 2 go-live clients per rolling 12 months | WRP: 4 resales per year; SG: "set before recruiting" | |
| C6 | Activation fee | MCI agreement §11: none | WRP: $199/yr; SG: an activation fee exists, amount unset | |
| C7 | Payout timing | Agreements and SG: payable at go-live + balance paid, paid within 15 days | SQL1 l.337-340: payable only after go-live + 90 days; balance never checked | Code contradicts terms |
| C7b | Rounding | Legacy rounds commissions and deposits to whole dollars (`round`, `Math.round`) | SG example "$54.70/mo" shows cents | Rounding policy needed |
| C8 | Monthly share basis | Agreement: each month **collected**, in arrears | SQL1 l.343-355: every elapsed month from the go-live month, no collection check | |
| C9 | $350 minimum basis | Agreement §4 and SG l.462-464: whole order | SQL1 l.284-286 and UP: single tier per lead | |
| C10 | Social media share | MCI comment l.2886: "Care plans and social management carry no share" | MCI code l.1603-1604, agreement §5, MCI l.2928: social mgmt earns 35% setup + 3% monthly | Internal inconsistency |
| C11 | AI tools partner pay | Agreement §3: 20% + 3% | Not in `PRICING` arrays, so no partner-page row and no payout (MCI l.1586-1592); SG l.590/592 "Referral fee" with no amount | |
| C12 | Brand Logo reseller price | SG l.441: does not qualify (under $350) | SG l.599: partner price $81 | Internal inconsistency |
| C13 | Training | SG l.627/635: $150/hr (services) | ERPJ: extra training session $75 one-time (ERP add-on) | Possibly different product lines; confirm |
| C14 | Hourly labor | SG l.632, 636 and MCI §5: $125/hr | WP l.81-88: $95/hr, rush $145, 30-minute increments, 1 hour minimum | |
| C15 | Rush | SG l.628: +35% of setup | WP l.84: $145/hr | |
| C16 | Custom CRM | SG l.570 and WP l.68: $4,000+ | WR l.50: resale $6,000+; WP l.87: buyout $6,000–$10,000 | |
| C17 | Website and AI monthly | MCI: web monthly optional (`monthlyOptional`), AI monthly not marked optional | WP: "maintenance from $149/$189" for both web and AI | Is the AI monthly mandatory? |
| C18 | Duplicate legacy file | root `vyntex/index.html` | `public/vyntex/index.html` (published) | They differ. Only `public/` is a source |
| C19 | 1099 threshold | All legacy text: $600 | **[A]** current federal threshold for 2026 payments may differ | Verify with a tax advisor |
| C20 | Partner portal "Updated" date | Legacy page shows `published_at` | No `partner_portal` key was ever published | Legacy partner links show "not available" |

---

## 7. Needs VYNTEX Approval

1. **Official partner program(s):** confirm Referral (flat) + Revenue Share (VYNTEX bills) as the only current lanes. Retire the seller guide "Authorized Reseller" (10%, own billing, 35% off list) and the website wholesale (30% margin) models, or define them as separate, versioned policies (C3, C4).
2. **Monthly revenue share rate:** 3% (owner, MCI) vs 10% (SG) (C3).
3. **Social media structure and price:** $350 setup bundled with management, or a separate $250 Social Media Setup (C2). Also the partner share on each.
4. **CRM price set:** confirm MCI/SG ($497/$897/$1,497 + $247/$397/$697) and retire the WP figures (C1).
5. **Referral fees for websites, AI tools, branding and social,** and for custom builds (currently none or "case by case").
6. **AI tools revenue share** (20% + 3% per agreement §3, which the legacy code does not apply) (C11).
7. **Payout timing:** within 15 days of go-live + balance paid (written terms), or after the 90-day clawback window (legacy code) (C7).
8. **Rounding policy** for commissions and deposits (to the cent vs whole dollars) (C7b).
9. **$350 minimum measured on the whole order** across lines of the same client order: confirm the definition of an "order" (C9).
10. **Revenue-share term, activation fee and minimum** (none and 2 per rolling 12 months vs $199/yr and 4 per year) (C5, C6).
11. **CPA non-cash alternative** ($200 client discount + free CRM account) and the **volume upgrade** rule.
12. **Tax rules:** W-9 gating (approve) and the 1099-NEC threshold (verify for 2026) (C19).
13. **Partner compensation on VYNTEX ERP software plans** (BUILD and editions): none defined anywhere.
14. **2.9% service fee:** confirm that none applies to services (only the ERP "no 2.9% fee" rule exists).
15. **Quote-only items** (Custom Website, Advanced AI, Custom CRM, Online Store, SEO, Ads, Migration ranges): confirm they show "Request a quote", and how partner earnings are set per quote.
16. **Hourly rates and rush** ($125/hr and +35% of setup vs $95/$145) and **training** ($150/hr vs $75 session) (C13-C15).
17. **AI Tools monthly:** mandatory or optional (C17).
18. **Brand Logo** partner treatment (C12).
19. **Legacy public partner page** (`/partners/?t=`) and anon-executable legacy RPCs: VYNTEX decision on disabling them (the legacy DB must not be changed without approval).
20. **Effective date** for the first published Partner Portal catalog and policy versions (proposal: the approval date; SG 2026-09-17 kept as `source_effective_date`).

### Engine decisions made in the portal, pending VYNTEX confirmation (PR #18 review)

21. **$350 minimum, line scope:** the engine checks the minimum on the whole order's one-time total (setup + one-time of all
    lines) and then pays the 35% share on each covered line. Confirm that this is the meaning of "measured on the whole order".
22. **Rounding:** every amount is rounded half up to the cent (the legacy code rounded to whole dollars, C7b).
23. **Second-person approval for catalog publishing (recommended option, not built):** today one partner_admin with a
    fresh identity check publishes prices and approves policies. VYNTEX may want a second administrator to confirm each
    publication or policy approval (four-eyes); it can be added as a pending-approval step.

## 8. Import guidance

- Import every item and policy as **draft** with provenance columns (`source`, `ref`, `source_effective_date`). Publish only after an admin approves each `needs_approval` row.
- Client View may show only `client_facing` text and approved client prices. Partner compensation fields are partner-only and never appear in proposals.
- Do not import anything from legacy `partners`, `payouts`, `leads` or `vx_partner_links` (all empty), and do not copy tokens, keys or team data.
