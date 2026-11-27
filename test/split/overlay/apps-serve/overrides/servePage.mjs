// override servePage sha256:b37793ebb102f25cdbce6ba82d00e27395e73746cd996238495784e9e434e1b6
// apps@1 Serving (kit-984): a page is its route's index.html in the built app at docs/devteam/apps/<app>/,
// sent under the caller's policy with script-src 'self' plus the route's hashes from the build's
// csp-hashes.json, and style-src with 'self' (the browser view's: 'self' alone, on browser.html's own
// policy). No build: a 503 notice under the same policy with no hashes. A build whose hashes can't be
// read, or hold anything but sha256-<44 base64>, is a 500: never a page without its hashes. D.keep (the
// browser view's) holds the first good build for the server's life; with no res, at the server's
// creation, it only tries to read one, and never throws for a missing build.
function servePage(D, req, res, page, policy, headers = {}) {
  const at = { dashboard: ['dashboard', '/'], hub: ['hub', '/'], browser: ['dashboard', '/browser/'] }[page];
  if (!at) throw new Error(`servePage: no page ${page}`);
  const BROWSER_BASE = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'";
  // policy builder start
  // base with script-src 'self' plus the hashes, style-src with 'self' first ('self' alone for the
  // browser view), each appended if absent; under default-src 'none', font-src 'self' and img-src
  // 'self' data: appended if absent, but never on the browser view
  const build = (base, hashes, browser) => {
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
  const [app, route] = at;
  const dir = path.join(kitDir, 'apps', app);
  const keep = D && 'keep' in D ? D.keep : null;
  // the build: { html, hashes }, 'none' (no index.html), or 'bad'
  const read = () => {
    let html;
    try { html = fs.readFileSync(path.join(dir, ...route.split('/').filter(Boolean), 'index.html')); } catch (e) { return e.code === 'ENOENT' ? 'none' : 'bad'; }
    let text;
    try { text = fs.readFileSync(path.join(dir, 'csp-hashes.json'), 'utf8'); } catch { return 'bad'; }
    const hashes = hashesFor(text, route);
    return hashes ? { html, hashes } : 'bad';
  };
  let got = keep?.[page];
  if (!got) {
    got = read();
    if (keep && typeof got === 'object') keep[page] = got;
  }
  if (!res) return;
  const base = page === 'browser' ? `${BROWSER_BASE}; ${policy}` : policy;
  if (got === 'bad') {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return res.end('this page could not be read\n');
  }
  if (got === 'none') {
    const body = Buffer.from("<!doctype html><meta charset=\"utf-8\"><title>devteam</title><p>This kit's pages aren't installed. They return at its next sync.</p>");
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, ...headers, 'content-security-policy': build(base, [], page === 'browser') });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': got.html.length, ...headers, 'content-security-policy': build(base, got.hashes, page === 'browser') });
  return res.end(req.method === 'HEAD' ? undefined : got.html);
}
