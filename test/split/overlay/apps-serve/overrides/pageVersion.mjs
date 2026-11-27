// override pageVersion sha256:6f045621ccbb7ea67aa28d917b72707bec92590a5312b8006ea9da94b30e9bb0
// apps@1 Serving (kit-984): the x-devteam-page value of a page is the first 16 hex of the sha256 of its
// route's index.html in the built app (a rebuild changes it: its chunk names are hashed into it), or ''
// when it can't be read.
function pageVersion(page) {
  const at = { dashboard: ['dashboard', '/'], hub: ['hub', '/'], browser: ['dashboard', '/browser/'] }[page];
  if (!at) return '';
  try { return sha256(fs.readFileSync(path.join(kitDir, 'apps', at[0], ...at[1].split('/').filter(Boolean), 'index.html'))).slice(0, 16); } catch { return ''; }
}
