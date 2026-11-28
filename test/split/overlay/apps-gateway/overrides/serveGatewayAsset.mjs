// override serveGatewayAsset sha256:a9f517ba2fa9c0a3342040e1761f68f6fff40d10b6a4d8b5b19be326808471a7
// apps@1 Serving in the gateway (kit-1021): the rest of the built hub, for a signed-in GET on the box's
// name that no route took, by the gateway's copy of the static rules (alphaServe, at the root). A first
// segment that is one of the gateway's own (decoded once, any case) is never served from the build, so
// a static file can't answer for a route family that passes some of its paths on (/public/…,
// /operator/…, /push/…). An html file carries alphaCsp(policy.csp, <its route's hashes>); every answer
// carries x-frame-options DENY, no referrer and policy.hsts. alphaServe's own 404 is never sent: false,
// and the gateway's 404 goes out as at main, so a path the build has no file for answers as before.
export function serveGatewayAsset(req, res, hub, policy) {
  const RESERVED = ['.devteam', 'alpha.json', 'api', 'auth', 'box.json', 'build', 'c', 'dev', 'instances.json', 'manifest.webmanifest', 'memory.json', 'next', 'operator', 'public', 'push', 'sw.js', 'token', 'upload', 'w'];
  let first;
  try { first = decodeURIComponent(String(req.url).split('?')[0].split('/')[1] ?? '').toLowerCase(); } catch { return false; }
  if (RESERVED.includes(first)) return false;
  let got = null;
  const held = { writeHead(code, headers) { got = { code, headers }; return held; }, end(body) { if (got) got.body = body; } };
  alphaServe(hub.dir, '', req, held, (route) => alphaCsp(policy.csp, alphaHashes(hub.dir, route)), { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', ...policy.hsts });
  if (!got || got.code === 404) return false;
  res.writeHead(got.code, got.headers);
  res.end(got.body);
  return true;
}
