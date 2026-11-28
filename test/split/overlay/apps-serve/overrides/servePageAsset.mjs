// override servePageAsset sha256:ff2a1e5dd2ca919b643f017ab0eba719195dacbc69495d50fda8adde94afe3d6
// apps@1 Serving (kit-984): the rest of a built app's export, for a request no route took, GET and
// HEAD only (anything else is DASH_NEXT). The dashboard: the review pages' helpers from the build's
// review/ to a GET as before; a reserved first segment (the dashboard's own route prefixes, decoded,
// any case) is DASH_NEXT, so a static file of that name never answers for a route; every other path is
// serveAppFiles on the dashboard build under pageCsp()'s base with the route's hashes. The hub: every
// path, under the hub's / policy (startHub's, built here from PORT_RANGE) with the route's hashes. The
// browser view: only /_next/…, never a page. A route with no good hashes entry is a 500, through
// serveAppFiles; with no build it serves 404s. The dashboard's style-src (and font-src where it has one)
// also names the shell's font and icon origins (kit-1033).
function servePageAsset(req, res, server) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return DASH_NEXT;
  // policy builder start
  // base with script-src 'self' plus the hashes, style-src with 'self' first ('self' alone for the
  // browser view), each appended if absent; under default-src 'none', font-src 'self' and img-src
  // 'self' data: appended if absent, but never on the browser view; a dashboard route's style-src, and its
  // font-src where it has one, also name the shell's font and icon origins (kit-1033)
  const ORIGINS = { 'style-src': ['https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'], 'font-src': ['https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'] };
  const build = (base, hashes, browser, dashboard = false) => {
    const ds = base.split(';').map((d) => d.trim()).filter(Boolean);
    const has = (n) => ds.some((d) => d.split(/\s+/)[0] === n);
    const script = ['script-src', "'self'", ...hashes.map((h) => `'${h}'`)].join(' ');
    const out = ds.map((d) => {
      const [n, ...v] = d.split(/\s+/);
      if (n === 'script-src') return script;
      if (n === 'style-src') return browser ? "style-src 'self'" : ['style-src', "'self'", ...v.filter((x) => x !== "'self'")].join(' ');
      return d;
    });
    if (!has('script-src')) out.push(script);
    if (!has('style-src')) out.push(browser ? "style-src 'self'" : "style-src 'self' 'unsafe-inline'");
    if (!browser && ds.includes("default-src 'none'")) {
      if (!has('font-src')) out.push("font-src 'self'");
      if (!has('img-src')) out.push("img-src 'self' data:");
    }
    if (dashboard) for (let i = 0; i < out.length; i++) { const [n, ...v] = out[i].split(/\s+/); if (ORIGINS[n]) out[i] = [n, ...v, ...ORIGINS[n].filter((o) => !v.includes(o))].join(' '); }
    return out.join('; ');
  };
  // a route's hashes from a build's csp-hashes.json text, or null when they can't be trusted
  const hashesFor = (text, route) => {
    let j;
    try { j = JSON.parse(text); } catch { return null; }
    const hs = j && j.v === 1 && j.pages && typeof j.pages === 'object' ? j.pages[route] : null;
    return Array.isArray(hs) && hs.every((h) => typeof h === 'string' && /^sha256-[A-Za-z0-9+/]{43}=$/.test(h)) ? hs : null;
  };
  // policy builder end
  const p = String(req.url).split('?')[0];
  // a route's policy for the build in dir: base with its hashes, or a throw (serveAppFiles' 500)
  const policyIn = (dir, base, dashboard = false) => (route) => {
    const hashes = hashesFor(fs.readFileSync(path.join(dir, 'csp-hashes.json'), 'utf8'), route);
    if (!hashes) throw new Error(`no hashes for ${route}`);
    return build(base, hashes, false, dashboard);
  };
  if (server === 'dashboard') {
    let u;
    try { u = new URL(req.url, 'http://x').pathname; } catch { return DASH_NEXT; }
    const m = req.method === 'GET' ? /^\/review\/[^/]+\/(devteam-ui\.(?:css|js))$/.exec(u) : null;
    if (m) {
      // read before any header, so a file that is gone is a 500 (as servePage's), never a throw after a 200
      let body;
      try { body = fs.readFileSync(path.join(kitDir, 'apps', 'dashboard', 'review', m[1])); } catch {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end('this file could not be read\n');
      }
      res.writeHead(200, { 'content-type': m[1].endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(body);
    }
    // the first segment as serveAppFiles reads it (decoded once), in any case
    let first;
    try { first = decodeURIComponent(p.split('/')[1] ?? '').toLowerCase(); } catch { return DASH_NEXT; }
    if (['api', 'upload', 'public', 'review', 'view', 'browser', 'artifact', 'public-manifest', 'presence'].includes(first)) return DASH_NEXT;
    const dir = path.join(kitDir, 'apps', 'dashboard');
    return serveAppFiles(dir, '', req, res, policyIn(dir, `frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB_PORT}`, true));
  }
  if (server === 'hub') {
    const dir = path.join(kitDir, 'apps', 'hub');
    return serveAppFiles(dir, '', req, res, policyIn(dir, `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; frame-src ${PORT_RANGE.map((x) => `http://127.0.0.1:${x}`).join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`));
  }
  if (server === 'browser') {
    if (!p.startsWith('/_next/')) return DASH_NEXT;
    return serveAppFiles(path.join(kitDir, 'apps', 'dashboard'), '', req, res, () => { throw new Error('the browser view serves no page here'); });
  }
  return DASH_NEXT;
}
