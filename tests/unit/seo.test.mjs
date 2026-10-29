// Unit tests for the readable public pages (src/seo/pages.ts, written into the build by scripts/prerender.mjs): every plan
// price comes from the pricing file and shows up in the HTML, the private addresses are closed to crawlers, AI training
// crawlers follow the same rules as search crawlers, the text is escaped, and the page shell is filled the same way the build fills it.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './bundle.mjs';
import { pageHtml } from '../../scripts/prerender.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/vyntex-build-pricing.json'), 'utf8'));
const m = await load(`export * from '@/seo/entry';`);
const pages = m.publicPages();
const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const usd = (n) => '$' + n.toLocaleString('en-US');

test('the five public addresses, each with its own file, title and description', () => {
  assert.deepEqual(pages.map((p) => [p.path, p.file]), [['/', 'index.html'], ['/pricing', 'pricing.html'], ['/demo', 'demo.html'], ['/request-demo', 'request-demo.html'], ['/start-trial', 'start-trial.html']]);
  assert.equal(new Set(pages.map((p) => p.title)).size, 5, 'titles differ');
  for (const p of pages) {
    assert.ok(p.title.length <= 70, `${p.path} title fits a result line (${p.title.length})`);
    assert.ok(p.description.length >= 70 && p.description.length <= 300, `${p.path} description length ${p.description.length}`);
    assert.match(p.body, /<h1>[^<]+<\/h1>/, `${p.path} has one heading`);
    assert.equal(p.body.match(/<h1>/g).length, 1);
    assert.match(p.body, /href="\/demo"/); assert.match(p.body, /href="\/pricing"/); assert.match(p.body, /href="\/request-demo"/);
    assert.ok(p.body.includes('609-780-3218') && p.body.includes('info@vyntexusa.com'), `${p.path} has the contact line`);
    assert.ok(!p.body.includes('609-813-0633'), 'never the other company\'s number');
  }
});

test('pricing page: every plan of the pricing file with its monthly, yearly and setup price', () => {
  const body = text(byPath['/pricing'].body);
  for (const p of [...pricing.plans, ...pricing.other_industries.plans]) {
    assert.ok(body.includes(p.name), p.name);
    for (const n of [p.monthly_usd, p.yearly_usd, p.setup_usd]) assert.ok(body.includes(usd(n)), `${p.name} ${usd(n)}`);
  }
  for (const a of pricing.add_ons.filter((x) => typeof x.price_usd === 'number')) assert.ok(body.includes(usd(a.price_usd)), a.id);
  assert.match(body, /Extra training session/);
  assert.match(body, new RegExp(`Pricing version ${pricing.version}`));
  assert.ok(!/Stripe Tax|Daysi/.test(body), 'internal pricing instructions stay out');
});

test('structured data: SoftwareApplication with one offer per plan, prices from the pricing file', () => {
  const ld = byPath['/pricing'].jsonLd.find((o) => o['@type'] === 'SoftwareApplication');
  assert.equal(ld.offers.length, pricing.plans.length + pricing.other_industries.plans.length);
  for (const o of ld.offers) {
    const plan = [...pricing.plans, ...pricing.other_industries.plans].find((p) => o.name.startsWith(p.name + ' ('));
    assert.ok(plan, o.name);
    assert.equal(o.price, plan.monthly_usd); assert.equal(o.priceCurrency, 'USD');
    assert.deepEqual(o.priceSpecification.map((s) => s.price), [plan.monthly_usd, plan.yearly_usd, plan.setup_usd]);
  }
  assert.ok(!byPath['/'].jsonLd[0].offers, 'prices are marked up on the pricing page only');
});

test('robots.txt: public pages open, private addresses closed, AI training crawlers (approved) get the same rules', () => {
  assert.equal(m.AI_TRAINING_CRAWLERS_ALLOWED, true, 'approved by management October 22, 2026');
  const robots = m.robotsTxt({ trainingAllowed: m.AI_TRAINING_CRAWLERS_ALLOWED, search: m.SEARCH_CRAWLERS, training: m.AI_TRAINING_CRAWLERS });
  const groups = robots.split('\n\n');
  const groupOf = (agent) => groups.find((g) => g.split('\n').includes(`User-agent: ${agent}`));
  const rules = (g) => g.split('\n').filter((l) => !l.startsWith('User-agent:')).join('\n');
  const searchRules = rules(groupOf('Googlebot'));
  for (const bot of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', '*',
    'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot']) {
    const g = groupOf(bot); assert.ok(g, bot);
    assert.match(g, /^Allow: \/$/m, bot);
    for (const p of ['/api/', '/admin', '/signin', '/signup', '/invite/', '/sign/', '/review/', '/demo/']) assert.ok(g.includes(`Disallow: ${p}`), `${bot} ${p}`);
    assert.ok(!g.includes('Disallow: /pricing') && !/^Disallow: \/$/m.test(g), `${bot} may read the public pages`);
    assert.equal(rules(g), searchRules, `${bot} has the same rules as the search crawlers`);
  }
  assert.match(robots, /^Sitemap: https:\/\/erp\.vyntexusa\.com\/sitemap\.xml$/m);
  // the switch still works the other way: without approval the training crawlers are kept out entirely
  const held = m.robotsTxt({ trainingAllowed: false, search: m.SEARCH_CRAWLERS, training: m.AI_TRAINING_CRAWLERS });
  const heldGroups = held.split('\n\n');
  for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot']) assert.match(heldGroups.find((g) => g.split('\n').includes(`User-agent: ${bot}`)), /^Disallow: \/$/m, bot);
  assert.match(heldGroups.find((g) => g.split('\n').includes('User-agent: Googlebot')), /^Allow: \/$/m);
});

test('sitemap and llms.txt list the public pages only, with the demo, pricing and booking links', () => {
  const xml = m.sitemapXml(pages);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]), ['https://erp.vyntexusa.com/', 'https://erp.vyntexusa.com/pricing', 'https://erp.vyntexusa.com/demo', 'https://erp.vyntexusa.com/request-demo', 'https://erp.vyntexusa.com/start-trial']);
  const llms = m.llmsTxt();
  for (const link of ['https://erp.vyntexusa.com/demo', 'https://erp.vyntexusa.com/pricing', 'https://erp.vyntexusa.com/request-demo', 'https://erp.vyntexusa.com/start-trial', 'https://www.vyntexusa.com/llms.txt']) assert.ok(llms.includes(link), link);
  for (const p of pricing.plans) assert.ok(llms.includes(`${p.name}: ${usd(p.setup_usd)} one-time setup, then ${usd(p.monthly_usd)} per month or ${usd(p.yearly_usd)} per year`), p.name);
  assert.ok(!/Stripe Tax|Daysi/.test(llms));
});

test('quoted editions (VYNTEX BARBER among them) show "Quoted on request" and never a price', () => {
  const quoted = m.quotedEditions();
  const barber = quoted.find((p) => p.id === 'barber');
  assert.ok(barber, 'the barber edition is quoted, not priced');
  assert.equal(barber.product, 'VYNTEX BARBER');
  const llms = m.llmsTxt();
  for (const p of quoted) {
    const line = llms.split('\n').find((l) => l.startsWith(`- ${p.id}: ${p.product},`));
    assert.ok(line, `${p.id} listed in llms.txt`);
    assert.match(line, /Quoted on request/, `${p.id} quoted in llms.txt`);
    assert.ok(!/\$\d/.test(line), `${p.id} has no price in llms.txt`);
    assert.ok(byPath['/pricing'].body.includes(`<h2>${p.product} (`) && new RegExp(`<h2>${p.product} \\([^<]*\\): Quoted on request</h2>`).test(byPath['/pricing'].body), `${p.id} is "Quoted on request" on the pricing page`);
    assert.ok(text(byPath['/'].body).includes(p.product), `${p.id} on the overview`);
  }
  // the edition list links each quoted edition to "Quoted on request" instead of "Plans and prices"
  const li = byPath['/demo'].body.split('<li>').find((x) => x.includes('<strong>VYNTEX BARBER</strong>'));
  assert.ok(li && li.includes('Quoted on request') && !li.includes('Plans and prices'), 'barber edition link text');
  // no offer in the structured data names a quoted edition
  const ld = byPath['/pricing'].jsonLd.find((o) => o['@type'] === 'SoftwareApplication');
  for (const o of ld.offers) for (const p of quoted) assert.ok(!o.name.includes(p.product), `${o.name} ${p.product}`);
});

test('the invitation-only trial sign-up stays out of the sitemap and the page text', () => {
  const xml = m.sitemapXml(pages);
  assert.ok(!xml.includes('/signup'));
  for (const p of pages) assert.ok(!p.body.includes('/signup'), p.path);
  assert.ok(!m.llmsTxt().includes('/signup'));
});

test('the page shell is filled in place: title, description, canonical, data, text inside the root; nothing can break out', () => {
  const shell = '<!doctype html><html><head><title>x</title>\n<meta name="description" content="y">\n</head><body><div id="root"></div></body></html>';
  const page = { ...byPath['/pricing'], title: 'A "quoted" <title>', jsonLd: [{ a: '</script><script>alert(1)</script>' }] };
  const html = pageHtml(shell, page, 'https://erp.vyntexusa.com');
  assert.match(html, /<title>A &quot;quoted&quot; &lt;title&gt;<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/erp\.vyntexusa\.com\/pricing">/);
  assert.ok(!html.includes('</script><script>alert(1)'), 'structured data cannot close its element');
  assert.match(html, /<div id="root"><div id="vx-static"><nav/);
  assert.throws(() => pageHtml('<html><head></head><body></body></html>', page, 'https://erp.vyntexusa.com'), /no <title>/);
});
