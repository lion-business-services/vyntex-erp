// The public pages of VYNTEX ERP as plain HTML, written into the build by scripts/prerender.mjs.
//
// Why: the sales pages are drawn by the app in the browser. Search engines that run scripts (Google, Bing) see them, but
// most AI search crawlers (ChatGPT search, Perplexity, Claude) and sales tools read the HTML only, and found nothing but
// "This app needs JavaScript". Each public address now arrives with its own title, description, canonical address,
// structured data and readable text: what the software does, the editions, the plans and prices, how to try the demo
// and how to buy. The app replaces that text the moment it starts, so visitors see exactly what they saw before.
//
// Nothing here is new information: prices, plan names, features, add-ons and rules come from lib/pricing.ts and
// lib/pricing-view.ts (the pricing file), editions from the packs, and every sentence from the dictionaries the pages
// already use. Framework free (no React, no DOM), so it runs in Node at build time.
import { PACK_LIST, PACKS } from '@/packs';
import type { IndustryPack } from '@/packs/types';
import { makeT, pick } from '@/i18n';
import { BRAND } from '@/config/brand';
import { PRICING_VERSION, isPriced, planName, plansFor, yearlySavings, type Plan } from '@/lib/pricing';
import { addOnViews, planFeatures, planSupport, publicRules } from '@/lib/pricing-view';
import { money } from '@/lib/money';
import { GET_STARTED } from '@/features/marketing/get-started';

export const ORIGIN = 'https://erp.vyntexusa.com';
export const COMPANY_SITE = 'https://www.vyntexusa.com';

export interface PublicPage {
  /** The address, e.g. /pricing. */
  path: string;
  /** The file in the build that serves it. */
  file: string;
  title: string;
  description: string;
  /** Readable page text (HTML), placed inside the app's root element. */
  body: string;
  jsonLd: object[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

const base = PACKS.build;
const t = makeT('en', base);
const tFor = (pack: IndustryPack) => makeT('en', pack);
const name = BRAND.platformName;
const usersText = (p: Plan) => (p.users === 'unlimited' ? t('mk.pr.usersU') : p.users === 1 ? t('mk.pr.users1') : t('mk.pr.usersN', { n: p.users }));

/** Editions grouped by the plan ladder they are sold with: VYNTEX BUILD has its own plan names, the others share one. */
function ladders() {
  const priced = PACK_LIST.filter((p) => isPriced(p.id));
  const groups: { packs: IndustryPack[]; plans: Plan[] }[] = [];
  for (const pack of priced) {
    const plans = plansFor(pack.id);
    const key = plans.map((p) => p.id).join(',');
    const g = groups.find((x) => x.plans.map((p) => p.id).join(',') === key);
    if (g) g.packs.push(pack); else groups.push({ packs: [pack], plans });
  }
  return { groups, quoted: PACK_LIST.filter((p) => !isPriced(p.id)) };
}

/** Editions with no published plan or price (for example VYNTEX BARBER): each one is "Quoted on request". */
export const quotedEditions = (): IndustryPack[] => ladders().quoted;

const nav = () => `<nav aria-label="VYNTEX ERP">${ul([
  a('/', `${name} overview`), a('/demo', t('mk.p2.gs.demo')), a('/pricing', t('mk.nav.pricing')), a('/request-demo', t('mk.nav.request')),
  a('/start-trial', t('mk.tr.title')), a(COMPANY_SITE + '/', 'VYNTEX USA'),
])}</nav>`;

const contact = () => `<section><h2>Contact</h2><p>${esc(t('mk.p2.gs.help', { phone: BRAND.phone, email: BRAND.email }))}</p>
<p>${a('tel:+16097803218', BRAND.phone)} · ${a('mailto:' + BRAND.email, BRAND.email)} · ${a(COMPANY_SITE + '/', 'www.vyntexusa.com')}</p></section>`;

const steps = () => `<section><h2>${esc(t('mk.p2.gs.h'))}</h2><p>${esc(t('mk.p2.gs.sub'))}</p><ol>${GET_STARTED.map((k) =>
  `<li><h3>${esc(t(`mk.p2.gs.${k}.h`))}</h3><p>${esc(t(`mk.p2.gs.${k}.p`))}</p></li>`).join('')}</ol>
<p>${a('/demo', t('mk.p2.gs.demo'))} · ${a('/pricing', t('mk.nav.pricing'))} · ${a('/request-demo', t('mk.p2.cta.request'))}</p></section>`;

function editionsList() {
  return ul(PACK_LIST.map((p) => {
    const links = [a(`/demo?industry=${p.id}`, 'Live demo'), a(`/pricing?industry=${p.id}`, isPriced(p.id) ? 'Plans and prices' : t('mk.p2.pr.quoted.h'))];
    return `<strong>${esc(p.product)}</strong> (${esc(pick(p.label, 'en'))}): ${esc(pick(p.blurb, 'en'))} ${links.join(' · ')}`;
  }));
}

function planTable(plans: Plan[], pack: IndustryPack) {
  const tp = tFor(pack);
  // a setup column only when some plan has a setup fee
  const setup = plans.some((p) => p.setup > 0);
  const rows = plans.map((p) => {
    const save = yearlySavings(p);
    return `<tr><th scope="row">${esc(planName(p, 'en'))}${p.mostPopular ? ` (${esc(t('mk.pr.popular'))})` : ''}</th>`
      + `<td>${money(p.monthly)} ${esc(t('mk.pr.perMonth'))}</td>`
      + `<td>${money(p.yearly)} ${esc(t('mk.pr.perYear'))}${save > 0 ? `<br>${esc(t('mk.pr.saves', { amount: money(save) }))}` : ''}</td>`
      + `${setup ? `<td>${money(p.setup)}</td>` : ''}<td>${esc(usersText(p))}</td><td>${esc(planSupport(p, pack.id, 'en', tp))}</td></tr>`;
  }).join('');
  return `<table><caption>${esc(t('mk.p2.pr.plans'))}, US dollars, before taxes</caption><thead><tr><th scope="col">Plan</th><th scope="col">${esc(t('mk.pr.monthly'))}</th><th scope="col">${esc(t('mk.pr.yearly'))}</th>${setup ? `<th scope="col">${esc(t('mk.pr.setup'))}</th>` : ''}<th scope="col">${esc(t('mk.p2.pr.users'))}</th><th scope="col">Support</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function planDetails(plans: Plan[], pack: IndustryPack) {
  const tp = tFor(pack);
  return plans.map((p) => {
    const credit = p.welcomeCredit
      ? `<p>${esc(t('mk.pr.credit', { amount: money(p.welcomeCredit.amount_usd) }))}. ${esc(t('mk.pr.creditDays', { days: p.welcomeCredit.expires_days }))} ${esc(t('mk.pr.credit.excludes', { product: pack.product }))}</p>`
      : '';
    return `<h4>${esc(planName(p, 'en'))}: ${esc(t('mk.pr.includes'))}</h4>${ul(planFeatures(p, pack.id, 'en', tp).map(esc))}${credit}`;
  }).join('');
}

/** Structured data for the software and its plans (schema.org SoftwareApplication with one Offer per plan and edition group). */
function softwareLd(withOffers: boolean): object {
  const { groups } = ladders();
  const offers = withOffers ? groups.flatMap((g) => g.plans.map((p) => ({
    '@type': 'Offer',
    name: `${planName(p, 'en')} (${g.packs.map((x) => x.product).join(', ')})`,
    url: `${ORIGIN}/pricing?industry=${g.packs[0].id}`,
    price: p.monthly, priceCurrency: 'USD', availability: 'https://schema.org/InStock',
    priceSpecification: [
      { '@type': 'UnitPriceSpecification', price: p.monthly, priceCurrency: 'USD', unitText: 'month', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' } },
      { '@type': 'UnitPriceSpecification', price: p.yearly, priceCurrency: 'USD', unitText: 'year', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'ANN' } },
      ...(p.setup > 0 ? [{ '@type': 'PriceSpecification', name: 'One-time setup', price: p.setup, priceCurrency: 'USD' }] : []),
    ],
  }))) : undefined;
  return {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', '@id': `${ORIGIN}/#software`,
    name, alternateName: 'VYNTEX Business Software', url: `${ORIGIN}/`,
    applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser', inLanguage: ['en', 'es'],
    description: pick(BRAND.descriptor, 'en') + '. ' + t('mk.hero.lede'),
    publisher: { '@type': 'Organization', '@id': `${COMPANY_SITE}/#organization`, name: BRAND.company, url: `${COMPANY_SITE}/`, email: BRAND.email, telephone: '+1-609-780-3218' },
    potentialAction: { '@type': 'ViewAction', name: t('mk.p2.gs.demo'), target: `${ORIGIN}/demo` },
    ...(offers ? { offers } : {}),
  };
}

const crumbs = (items: [string, string][]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([n, path], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: ORIGIN + path })),
});

export function publicPages(): PublicPage[] {
  const { groups, quoted } = ladders();
  const heading = `${t('mk.hero.h1a')} ${t('mk.hero.h1b').replace(/ /g, ' ')}`;
  const plansSummary = groups.map((g) => `<h3>${esc(g.packs.map((p) => p.product).join(', '))}</h3>${planTable(g.plans, g.packs[0])}`).join('');

  const home: PublicPage = {
    path: '/', file: 'index.html',
    title: `${name} | Business software with a live demo, plans and pricing`,
    description: `${name} by VYNTEX USA: leads, clients, jobs, scheduling, documents, e-signature, payments, automations and reports in one place, with an edition for each industry. Try the live demo with no account, compare plans and prices, or book a free guided demo.`,
    body: `${nav()}<main><h1>${esc(name)}: ${esc(heading)}</h1><p>${esc(t('mk.hero.lede'))}</p>
<p>${a('/demo', t('mk.p2.gs.demo'))} · ${a('/pricing', t('mk.cta.pricing'))} · ${a('/request-demo', t('mk.cta.request'))}</p>
<section><h2>${esc(t('mk.hero.fact1', { n: PACK_LIST.length }))}</h2>${editionsList()}</section>
<section><h2>Plans and prices</h2><p>${esc(t('mk.pr.sub'))}</p>${plansSummary}${quoted.length ? `<p>${esc(quoted.map((p) => p.product).join(', '))}: ${esc(t('mk.p2.pr.quoted.h'))}, no published price. ${a('/request-demo', t('mk.p2.pr.quoted.cta'))}</p>` : ''}<p>${a('/pricing', 'Full plan comparison, add-ons and rules')}</p></section>
${steps()}${contact()}</main>`,
    jsonLd: [softwareLd(false)],
  };

  const pricing: PublicPage = {
    path: '/pricing', file: 'pricing.html',
    title: `${name} | Plans and pricing: monthly and yearly prices`,
    description: `${name} plans compared: monthly and yearly prices with no setup fee, users, support, features, add-ons including extra training, and the rules behind the prices. US dollars, before taxes.`,
    body: `${nav()}<main><h1>${esc(t('mk.pr.h'))} ${esc(name)}</h1><p>${esc(t('mk.pr.sub'))}</p>
${groups.map((g) => `<section><h2>${esc(g.packs.map((p) => `${p.product} (${pick(p.label, 'en')})`).join(', '))}</h2>${planTable(g.plans, g.packs[0])}${planDetails(g.plans, g.packs[0])}</section>`).join('')}
${quoted.map((p) => `<section><h2>${esc(p.product)} (${esc(pick(p.label, 'en'))}): ${esc(t('mk.p2.pr.quoted.h'))}</h2><p>${esc(tFor(p)('mk.p2.pr.quoted.p', { product: p.product }))} ${a('/request-demo', t('mk.p2.pr.quoted.cta'))}</p></section>`).join('')}
<section><h2>${esc(t('mk.pr.addons.h'))}</h2>${ul(addOnViews('build', 'en', t).map((x) => `<strong>${esc(x.name)}</strong>: ${esc(x.price ?? (x.kind === 'usage' ? t('mk.p2.pr.varies') : t('mk.p2.pr.quoted')))}${x.billing ? ` (${esc(x.billing)})` : ''}${x.note ? `. ${esc(x.note)}` : ''}${x.notBuilt && !(x.note ?? '').includes(t('mk.p2.pr.notBuilt')) ? ` (${esc(t('mk.p2.pr.notBuilt'))})` : ''}`))}</section>
<section><h2>${esc(t('mk.pr.rules.h'))}</h2>${ul(publicRules('build', 'en', t).map(esc))}</section>
${steps()}${contact()}<p>${esc(t('mk.pr.version', { v: PRICING_VERSION }))}</p></main>`,
    jsonLd: [softwareLd(true), crumbs([[name, '/'], [t('mk.nav.pricing'), '/pricing']])],
  };

  const demo: PublicPage = {
    path: '/demo', file: 'demo.html',
    title: `${name} | Live demo with sample data, no account needed`,
    description: `Open the ${name} live demo right away: a sample business of your industry with made-up records, in English or Spanish. No account, no appointment, and nothing you enter is sent anywhere.`,
    body: `${nav()}<main><h1>${esc(name)}: ${esc(t('mk.p2.gs.s1.h'))}</h1><p>${esc(t('mk.p2.gs.s1.p'))}</p>
<section><h2>Choose your edition</h2>${editionsList()}<p>Spanish: add ?lang=es to any link.</p></section>
<p>The demo is an app and needs JavaScript. ${a('/pricing', t('mk.cta.pricing'))} · ${a('/request-demo', t('mk.cta.request'))}</p>${contact()}</main>`,
    jsonLd: [softwareLd(false), crumbs([[name, '/'], [t('mk.nav.demo'), '/demo']])],
  };

  const request: PublicPage = {
    path: '/request-demo', file: 'request-demo.html',
    title: `${name} | Book a free guided demo`,
    description: `Book a free guided demo of ${name}. We contact you the way you choose, in English or Spanish, show you the edition for your industry and go over plans and setup.`,
    body: `${nav()}<main><h1>${esc(t('mk.p2.rd.h', { name }))}</h1><p>${esc(t('mk.p2.rd.lede'))}</p>
<section><h2>${esc(t('mk.p2.rd.why.h'))}</h2>${ul(['b1', 'b2', 'b3', 'b4'].map((k) => `<strong>${esc(t(`mk.p2.rd.${k}.h`))}</strong>: ${esc(t(`mk.p2.rd.${k}.p`, { n: PACK_LIST.length }))}`))}</section>
<section><h2>${esc(t('mk.p2.rd.next.h'))}</h2><ol>${['n1', 'n2', 'n3'].map((k) => `<li>${esc(t(`mk.p2.rd.${k}`))}</li>`).join('')}</ol></section>
<p>The request form needs JavaScript. You can also call, WhatsApp or email us.</p>${contact()}</main>`,
    jsonLd: [softwareLd(false), crumbs([[name, '/'], [t('mk.nav.request'), '/request-demo']])],
  };

  const tops = ladders().groups.map((g) => `${g.packs.map((p) => p.product).join(', ')}: ${planName(g.plans[g.plans.length - 1], 'en')}`);
  const trial: PublicPage = {
    path: '/start-trial', file: 'start-trial.html',
    title: `${name} | Start your 7-day free trial, no credit card`,
    description: `Start a 7-day free trial of ${name} for your industry: your own workspace in a few minutes, the top plan of your edition during the trial, no credit card needed. Choose a plan and pay in Settings when you are ready.`,
    body: `${nav()}<main><h1>${esc(t('mk.tr.h', { name }))}</h1><p>${esc(t('mk.tr.lede'))}</p>
<section><h2>${esc(t('mk.tr.get.h'))}</h2>${ul([
      `<strong>${esc(t('mk.tr.g1.h'))}</strong>: ${esc(t('mk.tr.g1.p'))}`,
      `<strong>${esc(t('mk.tr.g2.h'))}</strong>: ${esc(t('mk.tr.g2.p'))}`,
      `<strong>${esc(t('mk.tr.g3.h'))}</strong>: ${esc(t('mk.tr.g3.pAny'))} ${esc(tops.join('; '))}.`,
      `<strong>${esc(t('mk.tr.g4.h'))}</strong>: ${esc(t('mk.tr.g4.p', { address: 'erp.vyntexusa.com/your-business' }))}`,
      `<strong>${esc(t('mk.tr.g5.h'))}</strong>: ${esc(t('mk.tr.g5.p'))}`,
      `<strong>${esc(t('mk.tr.g6.h'))}</strong>: ${esc(t('mk.tr.g6.p'))}`,
    ])}</section>
<section><h2>${esc(t('mk.tr.done.next'))}</h2><ol>${(['s1', 's2', 's3', 's4'] as const).map((k) => `<li>${esc(t(`mk.tr.done.${k}`))}</li>`).join('')}</ol></section>
${quotedEditions().length ? `<p>${esc(quotedEditions().map((p) => p.product).join(', '))}: ${esc(t('mk.p2.pr.quoted.h'))}. ${a('/request-demo', t('mk.tr.quoted.cta'))}</p>` : ''}
<p>The trial form needs JavaScript. ${a('/pricing', t('mk.tr.see'))} · ${a('/request-demo', t('mk.cta.request'))}</p>${contact()}</main>`,
    jsonLd: [softwareLd(false), crumbs([[name, '/'], [t('mk.tr.title'), '/start-trial']])],
  };

  return [home, pricing, demo, request, trial];
}

/** robots.txt: search, AI-search and (approved) AI training crawlers read the public pages; private addresses stay closed. */
export function robotsTxt(opts: { trainingAllowed: boolean; search: readonly string[]; training: readonly string[] }): string {
  // Workspaces live at /<company>/..., which cannot be listed here: they are closed by sign-in and by the noindex header
  // (vercel.json). These are the addresses the site keeps for itself. /signup (an old address that now opens /start-trial)
  // is closed here, left out of the sitemap and marked noindex like every other non-public address.
  const closed = ['/api/', '/admin', '/signin', '/signup', '/invite/', '/reset-password', '/mfa', '/sign/', '/review/', '/demo/'];
  const group = (agents: readonly string[], lines: string[]) => agents.map((x) => `User-agent: ${x}`).join('\n') + '\n' + lines.join('\n');
  const open = ['Allow: /', ...closed.map((p) => `Disallow: ${p}`)];
  return [
    '# VYNTEX ERP. Public pages: /, /pricing, /demo, /request-demo, /start-trial. Workspaces and sign-in are private.',
    group(opts.search, open),
    opts.trainingAllowed ? group(opts.training, open) : group(opts.training, ['Disallow: /']),
    group(['*'], open),
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    '',
  ].join('\n\n');
}

export function sitemapXml(pages: PublicPage[]): string {
  const urls = pages.map((p) => `  <url><loc>${ORIGIN}${p.path}</loc><changefreq>${p.path === '/pricing' ? 'weekly' : 'monthly'}</changefreq><priority>${p.path === '/' ? '1.0' : '0.8'}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** llms.txt: a plain summary with every link an AI assistant or sales agent needs. Prices come from the pricing file. */
export function llmsTxt(): string {
  const { groups, quoted } = ladders();
  const line = (p: Plan) => `${planName(p, 'en')}: ${p.setup > 0 ? `${money(p.setup)} one-time setup, then ` : 'no setup fee, '}${money(p.monthly)} per month or ${money(p.yearly)} per year; ${usersText(p).toLowerCase()}`;
  return [
    `# ${name}`,
    '',
    `> ${name} is the business software of VYNTEX USA (Vyntex LLC, Northfield, New Jersey). ${t('mk.hero.lede')} English and Spanish.`,
    '',
    '## Links',
    '',
    `- [Overview](${ORIGIN}/)`,
    `- [Live demo](${ORIGIN}/demo): ${t('mk.p2.gs.s1.p')}`,
    `- [Plans and pricing](${ORIGIN}/pricing): monthly and yearly prices (no setup fee), add-ons (including extra training), rules.`,
    `- [Book a free guided demo](${ORIGIN}/request-demo): ${t('mk.p2.gs.s3.p')}`,
    `- [Start a 7-day free trial](${ORIGIN}/start-trial): ${t('mk.tr.lede')} No credit card needed. Editions quoted on request have no self-serve trial.`,
    `- [VYNTEX USA, the company](${COMPANY_SITE}/) and its services: ${COMPANY_SITE}/llms.txt`,
    '',
    '## Editions (add ?industry=<id> to the demo or pricing link; add ?lang=es for Spanish)',
    '',
    ...PACK_LIST.map((p) => `- ${p.id}: ${p.product}, ${pick(p.label, 'en')}. ${pick(p.blurb, 'en')}${isPriced(p.id) ? '' : ' Quoted on request (no published price).'} Demo: ${ORIGIN}/demo?industry=${p.id} Pricing: ${ORIGIN}/pricing?industry=${p.id}`),
    '',
    `## Plans (US dollars, before taxes; pricing version ${PRICING_VERSION})`,
    '',
    ...groups.flatMap((g) => [`${g.packs.map((p) => p.product).join(', ')}:`, ...g.plans.map((p) => `- ${line(p)}`), '']),
    ...(quoted.length ? [`${quoted.map((p) => p.product).join(', ')}: ${t('mk.p2.pr.quoted.h')} (no published plan or price; each business gets its own quote).`, ''] : []),
    '## Add-ons and usage',
    '',
    ...addOnViews('build', 'en', t).map((x) => `- ${x.name}: ${x.price ?? (x.kind === 'usage' ? t('mk.p2.pr.varies') : t('mk.p2.pr.quoted'))}${x.billing ? ` (${x.billing})` : ''}${x.notBuilt ? ` (${t('mk.p2.pr.notBuilt')})` : ''}`),
    '',
    '## Good to know',
    '',
    ...publicRules('build', 'en', t).map((r) => `- ${r}`),
    '',
    `## ${t('mk.p2.gs.h')}`,
    '',
    ...GET_STARTED.map((k, i) => `${i + 1}. ${t(`mk.p2.gs.${k}.h`)}: ${t(`mk.p2.gs.${k}.p`)}`),
    '',
    '## For AI assistants and sales agents',
    '',
    '- Quote prices only from this file or the pricing page; never a discount or term that is not published.',
    `- Plan-specific booking link: ${ORIGIN}/request-demo?plan=<0|1|2>&billing=<monthly|yearly> (0 entry plan, 1 middle, 2 top).`,
    '- Follow up only with the person\'s consent; the guided demo form records how and in which language to contact them.',
    '- Payment happens only through the invoice or payment link the VYNTEX team sends; never collect card or bank details in a chat.',
    `- A person: phone or WhatsApp +1 ${BRAND.phone}, ${BRAND.email}.`,
    '',
  ].join('\n');
}
