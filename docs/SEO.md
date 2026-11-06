# Search engines and AI assistants on erp.vyntexusa.com

The sales pages are drawn by the app in the browser, so readers that do not run scripts (most AI search crawlers, link
previews, sales tools) used to see only "This app needs JavaScript". The build now writes each public page as real HTML.

| Address | File | What a crawler reads |
| --- | --- | --- |
| `/` | `index.html` | overview, editions, plan summary, how to get started, contact |
| `/pricing` | `pricing.html` | every plan with setup, monthly and yearly price, features, add-ons, rules; SoftwareApplication + Offer data |
| `/demo` | `demo.html` | what the demo is, a link per edition (`?industry=<id>`) |
| `/request-demo` | `request-demo.html` | what the guided demo covers and what happens next |

* Source: `src/seo/pages.ts` (prices from `lib/pricing.ts`, editions from the packs, sentences from the dictionaries).
  Placed into the page shell by `scripts/prerender.mjs`, called from `scripts/build.mjs`.
* The text sits inside `#root`; `public/theme-init.js` marks the page (`data-js`) so it stays hidden while the app starts,
  and the app replaces it. Visitors see the same screens as before.
* `robots.txt`, `sitemap.xml`, `llms.txt` are generated in the same step. Every address other than the four above gets
  `X-Robots-Tag: noindex, nofollow` (`vercel.json`), so workspaces, sign-in, invitations and signing links stay out of search.
* Crawler policy: `src/seo/crawlers.ts`. Search and AI-search crawlers are allowed. AI training crawlers were approved by
  management on October 22, 2026 (`AI_TRAINING_CRAWLERS_ALLOWED = true`) and get exactly the same rules: public pages open,
  private addresses closed. Setting it to `false` closes the whole site to them again.
* `/signup` (the seven-day trial sign-up) is by invitation only: it is not in the sitemap, `robots.txt` disallows it, and it
  gets the noindex header like every other non-public address.
* Editions without a published price (VYNTEX PRACTICE, VYNTEX BARBER) appear everywhere as "Quoted on request" with no
  price; prices only ever come from `config/vyntex-build-pricing.json` through `lib/pricing.ts`.
* The LBS deployment has no public pages: its `robots.txt` closes everything.
* Tests: `tests/unit/seo.test.mjs`, `tests/security/container-server.test.mjs`.
