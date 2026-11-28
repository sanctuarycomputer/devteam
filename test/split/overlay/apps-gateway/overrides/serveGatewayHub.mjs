// override serveGatewayHub sha256:01f1ee1059b526c94f35c5bed4b816ef0cec55d6635611b0a55ddcf090194663
// apps@1 Serving in the gateway (kit-1021): the hub route answers with the build's index.html, read on
// each request, under alphaCsp(policy.csp, <the / route's hashes>): hubCsp with script-src 'self' and
// those hashes, style-src 'self' 'unsafe-inline', font-src 'self' (the /next/ route's policy). No
// folder or no index.html (ENOENT): 503, the built-in notice under the same policy with no hashes. An
// index.html whose real path is outside the folder's, isn't a regular file or can't be read, or a
// csp-hashes.json alphaHashes refuses: 500, never a page without its hashes. The headers are main's, in
// main's order, with content-length.
export function serveGatewayHub(req, res, hub, policy) {
  const send = (code, type, body, csp) => {
    const h = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...policy.hsts };
    if (csp) h['content-security-policy'] = csp;
    res.writeHead(code, { ...h, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-length': body.length });
    res.end(body);
  };
  const bad = () => send(500, 'text/plain; charset=utf-8', Buffer.from('this page could not be read\n'));
  let html;
  try {
    // the static rules' own test (alphaServe): the file's real path inside the folder's, a regular file
    const top = fs.realpathSync(hub.dir);
    const real = fs.realpathSync(path.join(top, 'index.html'));
    if (!real.startsWith(top + path.sep) || !fs.statSync(real).isFile()) return bad();
    html = fs.readFileSync(real);
  } catch (e) {
    if (e?.code !== 'ENOENT') return bad();
    return send(503, 'text/html; charset=utf-8', Buffer.from("<!doctype html><meta charset=\"utf-8\"><title>devteam</title><p>This kit's pages aren't installed. They return at its next sync.</p>"), alphaCsp(policy.csp, []));
  }
  let hashes;
  try { hashes = alphaHashes(hub.dir, '/'); } catch { return bad(); }
  return send(200, 'text/html; charset=utf-8', html, alphaCsp(policy.csp, hashes));
}
