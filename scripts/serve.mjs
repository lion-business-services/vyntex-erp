// Local preview server: serves dist/ with single-page fallback and runs the functions in api/ the way Vercel does,
// including the rewrites of vercel.json that send /api/<name>/<anything> to the one function file api/<name>.js.
//
//   PORT              port to listen on (default 4173; also the first argument)
//   DIST              folder to serve (default dist/)
//   VX_HEADERS=1      also send the response headers of vercel.json (the Content-Security-Policy and the others)
//   VX_REWRITE_STYLE  "destination" hands the function the rewritten address (/api/auth?vxpath=signin) instead of the
//                     original one (/api/auth/signin). The functions understand both; this is how that is tested.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.DIST ? path.resolve(process.env.DIST) : path.join(root, 'dist');
const port = Number(process.env.PORT || process.argv[2] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };

// A test run only (VX_ENV=test with VX_TEST_MAIL_FILE): system email goes to a file instead of Resend, one JSON line per
// message, so a browser test can open the link a person would have received (tests/e2e/stack.mjs, `mail: true`).
// Never active on a real deployment: Vercel does not run this file, and the test switch is required.
if (process.env.VX_TEST_MAIL_FILE && process.env.VX_ENV === 'test') {
  const sink = path.resolve(process.env.VX_TEST_MAIL_FILE);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') {
      const body = JSON.parse(String(init.body || '{}'));
      const id = 'email_' + Math.random().toString(16).slice(2, 14);
      fs.appendFileSync(sink, JSON.stringify({ id, at: new Date().toISOString(), to: body.to, subject: body.subject, text: body.text }) + '\n');
      return new Response(JSON.stringify({ id }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith('https://api.resend.com/')) return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    return realFetch(url, init);
  };
}

let vercel = { rewrites: [], headers: [] };
try { vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); } catch { /* served without rewrites */ }

/** The api rewrites of vercel.json as { test, file, param }: "/api/auth/:path*" -> "/api/auth?vxpath=:path*". */
const apiRewrites = (vercel.rewrites || [])
  .map((r) => /^\/api\/([a-z0-9-]+)\/:path\*$/.exec(r.source) && /^\/api\/([a-z0-9-]+)(?:\?([a-z]+)=:path\*)?$/.exec(r.destination) ? { r, s: /^\/api\/([a-z0-9-]+)\/:path\*$/.exec(r.source), d: /^\/api\/([a-z0-9-]+)(?:\?([a-z]+)=:path\*)?$/.exec(r.destination) } : null)
  .filter(Boolean)
  .map(({ s, d }) => ({ prefix: `/api/${s[1]}/`, file: d[1], param: d[2] || 'vxpath' }));

/** vercel.json "headers" rules as regular expressions over the path. */
const headerRules = process.env.VX_HEADERS === '1'
  ? (vercel.headers || []).map((h) => ({ test: new RegExp('^' + h.source.replace(/\(\.\*\)/g, '.*') + '$'), headers: h.headers }))
  : [];
function extraHeaders(pathname) {
  const out = {};
  for (const rule of headerRules) if (rule.test.test(pathname)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  return out;
}

/** Which function file answers an /api address, and the address the function is given. */
function resolveApi(url) {
  const hit = apiRewrites.find((r) => url.pathname.startsWith(r.prefix));
  if (hit) {
    const rest = url.pathname.slice(hit.prefix.length);
    const rewritten = new URL(url);
    rewritten.pathname = '/api/' + hit.file;
    rewritten.searchParams.set(hit.param, rest);
    return { file: hit.file, url: process.env.VX_REWRITE_STYLE === 'destination' ? rewritten : url };
  }
  return { file: url.pathname.slice(5).replace(/[^a-z0-9-]/gi, ''), url };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    const target = resolveApi(url);
    const file = path.join(root, 'api', target.file + '.js');
    if (!target.file || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"not_found"}'); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(target.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    try {
      const mod = await import(pathToFileURL(file).href + '?t=' + fs.statSync(file).mtimeMs);
      const handler = mod[req.method] || mod.default;
      if (typeof handler !== 'function') { res.writeHead(405, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"method_not_allowed"}'); }
      const out = await handler(request);
      // A response may carry several Set-Cookie headers. They must stay separate, so they are read on their own.
      const headers = { ...extraHeaders(url.pathname) };
      for (const [k, v] of out.headers) if (k.toLowerCase() !== 'set-cookie') headers[k] = v;
      const cookies = out.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(out.status, headers);
      return res.end(Buffer.from(await out.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"server_error"}'); }
  }
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  // the public pages have their own files (scripts/prerender.mjs), as vercel.json maps them: /pricing -> pricing.html
  if (!fs.existsSync(file) && /^\/(pricing|request-demo|demo|start-trial)$/.test(url.pathname) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...extraHeaders(url.pathname) });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('preview on http://localhost:' + port));
