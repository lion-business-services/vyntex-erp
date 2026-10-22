// Writes the public pages of VYNTEX ERP as real HTML into a finished build, plus robots.txt, sitemap.xml and llms.txt.
// Called by scripts/build.mjs before the build is swapped in. The page text comes from src/seo/pages.ts (pricing file,
// editions, dictionaries); this file only places it into the page shell the build produced.
//
//   index.html          the overview (/) and, as before, the page every other address falls back to
//   pricing.html        /pricing        (vercel.json rewrites /pricing to it)
//   demo.html           /demo
//   request-demo.html   /request-demo
//
// The text sits inside the app's root element. The app replaces it as soon as it starts, and public/theme-init.js marks
// the page so the text is hidden while it does: visitors see the same screens as before; readers that do not run
// scripts (most AI search crawlers, link previews, sales tools) get the full text.
// The LBS deployment has no public pages: it gets a robots.txt that closes everything and plain copies of its shell.
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON inside a script element: "<" is written as < so the text can never close the element. */
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

async function loadSeo(root) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-seo-'));
  const file = path.join(out, 'seo.mjs');
  try {
    await build({
      entryPoints: [path.join(root, 'src/seo/entry.ts')], outfile: file, bundle: true, platform: 'node', format: 'esm',
      target: ['node20'], logLevel: 'warning', loader: { '.json': 'json' }, alias: { '@': path.join(root, 'src') },
      define: { __VX_DEPLOY__: '"vyntex"', __VX_SAMPLE_PREVIEW__: 'false', 'process.env.NODE_ENV': '"production"', __VX_LINK_BOOKKEEPING__: '""', __VX_LINK_PAYROLL__: '""' },
    });
    return await import(pathToFileURL(file).href);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

/** The page shell with this page's head and text. */
export function pageHtml(shell, page, origin) {
  const url = origin + page.path;
  const image = origin + '/brand/vyntex-logo.jpg';
  const head = [
    `<link rel="canonical" href="${esc(url)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="VYNTEX ERP">',
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:locale" content="en_US">',
    '<meta property="og:locale:alternate" content="es_US">',
    '<meta name="twitter:card" content="summary">',
    ...page.jsonLd.map((o) => `<script type="application/ld+json">${json(o)}</script>`),
  ].join('\n');
  let html = shell;
  const swap = (re, to, what) => { if (!re.test(html)) throw new Error(`prerender: the page shell has no ${what}`); html = html.replace(re, () => to); };
  swap(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`, '<title>');
  swap(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(page.description)}">\n${head}`, 'description');
  swap(/<div id="root"><\/div>/, `<div id="root"><div id="vx-static">${page.body}</div></div>`, 'root element');
  return html;
}

/**
 * Adds the public pages to the build folder `dir`, whose index.html is the finished page shell.
 * @param {{ dir: string, root: string, deploy: 'vyntex' | 'lbs' }} o
 */
export async function prerender({ dir, root, deploy }) {
  const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (deploy === 'lbs') {
    // one company, nothing public: every crawler stays out, and the addresses vercel.json maps keep showing the app
    fs.writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    for (const f of ['pricing.html', 'demo.html', 'request-demo.html']) fs.writeFileSync(path.join(dir, f), shell);
    return { pages: 0 };
  }
  const seo = await loadSeo(root);
  const pages = seo.publicPages();
  for (const p of pages) fs.writeFileSync(path.join(dir, p.file), pageHtml(shell, p, seo.ORIGIN));
  fs.writeFileSync(path.join(dir, 'robots.txt'), seo.robotsTxt({ trainingAllowed: seo.AI_TRAINING_CRAWLERS_ALLOWED, search: seo.SEARCH_CRAWLERS, training: seo.AI_TRAINING_CRAWLERS }));
  fs.writeFileSync(path.join(dir, 'sitemap.xml'), seo.sitemapXml(pages));
  fs.writeFileSync(path.join(dir, 'llms.txt'), seo.llmsTxt());
  return { pages: pages.length };
}
