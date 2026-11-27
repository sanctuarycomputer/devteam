#!/usr/bin/env node
// apps-src@1 The build's hash step (alpha-build@1): the SHA-256 of every inline script in every exported
// page, written to <out>/csp-hashes.json as { "v": 1, "pages": { "<route>/": ["sha256-…"] } }. Every route's
// script-src trusts this list, so it fails closed: a page it can't read as the HTML parser would (a <script>
// with no end) stops the build, and a hash it lists that a page doesn't need costs nothing.
//   node scripts/csp-hashes.mjs <out dir>     (from an app's folder, after next build; exit 0, 1 refused, 2 usage)
// Prints, as JSON, the number of hashes per route and any inline <style> or style="" it saw (which a
// style-src 'self' policy, the browser view's, refuses).
// Node 18+, built-ins only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class Refused extends Error {}

// The end of the tag that opens at lt: the first ">" outside a quoted attribute value, or -1.
function tagEnd(html, from) {
  let q = null;
  for (let j = from; j < html.length; j++) {
    const c = html[j];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return j;
  }
  return -1;
}

// Where a raw-text element's text ends: the first "</name" (any case) followed by whitespace, "/" or ">",
// as the HTML tokenizer ends script and style data. -1 when there is none.
function rawTextEnd(html, lower, name, from) {
  for (let i = lower.indexOf(`</${name}`, from); i >= 0; i = lower.indexOf(`</${name}`, i + 1)) {
    const c = html[i + name.length + 2];
    if (c === undefined || /[\s/>]/.test(c)) return c === undefined ? -1 : i;
  }
  return -1;
}

/**
 * A page's inline script bodies (exact text between the open tag and its end tag, for every <script>
 * without a src attribute, whatever its type) and its inline styles (each <style> element and each
 * style="" attribute). Comments are skipped. Throws Refused on a script or style with no end tag, or a tag
 * with no ">".
 */
export function scanHtml(html) {
  const scripts = [], styles = [];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt + 4); i = end < 0 ? html.length : end + 3; continue; }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const name = m[1].toLowerCase();
    const j = tagEnd(html, lt + m[0].length);
    if (j < 0) throw new Refused(`a <${name}> tag at ${lt} has no ">"`);
    const tag = html.slice(lt, j + 1);
    if (/\sstyle\s*=/i.test(tag)) styles.push({ kind: 'attribute', tag: tag.slice(0, 120) });
    if (name === 'script' || name === 'style') {
      const close = rawTextEnd(html, lower, name, j + 1);
      if (close < 0) throw new Refused(`a <${name}> at ${lt} has no </${name}>`);
      const body = html.slice(j + 1, close);
      // the parser turns CR and CRLF into LF before a script runs, so a hash of these bytes would never match
      if (body.includes('\r')) throw new Refused(`a <${name}> at ${lt} has a carriage return in its body`);
      if (name === 'script' && !/\ssrc\s*=/i.test(tag)) scripts.push(body);
      if (name === 'style') styles.push({ kind: 'element', tag: tag.slice(0, 120), bytes: Buffer.byteLength(body) });
      i = close + name.length + 2;
      continue;
    }
    i = j + 1;
  }
  return { scripts, styles };
}

/** A CSP source for a script body: 'sha256-' and the base64 SHA-256 of its UTF-8 bytes. */
export const hashOf = (body) => `sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`;

/** The route an exported page is served at, without the base path: index.html → "/", a/b/index.html → "/a/b/". Other .html files (the export's 404.html, a copy of /404/) are no route: null. */
export function routeOf(rel) {
  const r = rel.split(path.sep).join('/');
  if (r === 'index.html') return '/';
  if (r.endsWith('/index.html')) return `/${r.slice(0, -'index.html'.length)}`;
  return null;
}

const htmlFiles = (dir, d = dir) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? htmlFiles(dir, p) : e.isFile() && e.name.endsWith('.html') ? [path.relative(dir, p)] : [];
});

/** The csp-hashes.json object for an export folder, and the inline styles seen per route. Throws Refused when it has no route page. */
export function hashExport(dir) {
  const pages = {}, styled = {};
  for (const rel of htmlFiles(dir).sort()) {
    const route = routeOf(rel);
    if (route === null) continue;
    let scan;
    try { scan = scanHtml(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch (e) { if (e instanceof Refused) throw new Refused(`${rel}: ${e.message}`); throw e; }
    pages[route] = [...new Set(scan.scripts.map(hashOf))];
    if (scan.styles.length) styled[route] = scan.styles;
  }
  if (!Object.keys(pages).length) throw new Refused(`${dir} has no exported page (no index.html)`);
  return { manifest: { v: 1, pages }, styles: styled };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || process.argv.length > 3) { console.error('usage: node scripts/csp-hashes.mjs <out dir>'); process.exit(2); }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error(`csp-hashes: ${dir} is not a folder`); process.exit(2); }
  // fail closed: a refused run leaves no csp-hashes.json, not an earlier build's
  fs.rmSync(path.join(dir, 'csp-hashes.json'), { force: true });
  try {
    const { manifest, styles } = hashExport(dir);
    fs.writeFileSync(path.join(dir, 'csp-hashes.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ pages: Object.fromEntries(Object.entries(manifest.pages).map(([k, v]) => [k, v.length])), styles }, null, 2));
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`csp-hashes: refused: ${e.message}`);
    process.exit(1);
  }
}
