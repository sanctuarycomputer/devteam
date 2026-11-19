// The canvas static page (docs/devteam/scripts/canvas.mjs `staticPage`, kit-654): a canvas's first page
// as static escaped HTML, and `resolve`, held to the contract's fake (test/lib/canvas-fake.mjs). The page
// is read by the strict scanner below, never by regular expressions over the bytes. Names start
// `canvas static page:`, never the measure's; this file obeys contract §13's skip rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as canvas from '../docs/devteam/scripts/canvas.mjs';
import * as fake from './lib/canvas-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures', 'canvas');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const FIXTURE_NAMES = ['doc-every-type.json', 'doc-minimal.json', 'hostile.json'];

// ---- helpers: the scanner and what reads its tree (T2's tests reuse these) ----

// The spec's one escape rule, written here by the rule rather than imported from the renderer.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ENTITIES = [['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"]];
const VOID = new Set(['meta', 'img']);
const NAME_RE = /[a-z][a-z0-9-]*/y;
const DOCTYPE = '<!doctype html>';

// Decodes text or an attribute value; every `&` must start one of the five entities.
function decode(raw, at) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '&') { out += raw[i]; continue; }
    const hit = ENTITIES.find(([e]) => raw.startsWith(e, i));
    if (!hit) throw new Error(`scan: at ${at + i}: a bare &`);
    out += hit[1];
    i += hit[0].length - 1;
  }
  return out;
}

// The strict scanner (spec "Acceptance checks"): `<!doctype html>`, then start tags
// `<name( attr="value")*>`, end tags `</name>`, the one kit comment `comment` (exactly; any other `<!--`
// throws), and raw text (inside `<style>` up to `</style>`, elsewhere no `<` or `>`). Throws
// `Error('scan: …')` on anything else. Returns `{ doctype, root, comments }`: `root` the one top-level
// element, each element `{ name, attrs: { [name]: { raw, value } }, children: [element | { text: { raw,
// value } }] }`, `comments` how many times the kit comment occurs. Text in `<style>` is raw: value = raw.
// Whitespace-only text outside the root element is dropped; any other text there throws. No recursion.
function scan(html, comment) {
  if (typeof html !== 'string') throw new Error('scan: not a string');
  if (typeof comment !== 'string' || !comment.startsWith('<!--') || !comment.endsWith('-->')) throw new Error('scan: the comment is not a comment');
  if (!html.startsWith(DOCTYPE)) throw new Error('scan: no <!doctype html>');
  const top = { children: [] };
  const open = [top];
  let comments = 0;
  let i = DOCTYPE.length;
  const name = () => {
    NAME_RE.lastIndex = i;
    const m = NAME_RE.exec(html);
    if (!m) throw new Error(`scan: at ${i}: no name`);
    i += m[0].length;
    return m[0];
  };
  const parent = () => open[open.length - 1];
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      if (!html.startsWith(comment, i)) throw new Error(`scan: at ${i}: a comment that is not the kit's`);
      comments++;
      i += comment.length;
    } else if (html.startsWith('</', i)) {
      i += 2;
      const n = name();
      if (html[i] !== '>') throw new Error(`scan: at ${i}: an end tag not closed by >`);
      i++;
      if (open.length < 2 || parent().name !== n) throw new Error(`scan: at ${i}: </${n}> does not close the open element`);
      open.pop();
    } else if (html[i] === '<') {
      i++;
      const el = { name: name(), attrs: {}, children: [] };
      while (html[i] === ' ') {
        i++;
        const a = name();
        if (Object.hasOwn(el.attrs, a)) throw new Error(`scan: at ${i}: ${a} twice`);
        if (!html.startsWith('="', i)) throw new Error(`scan: at ${i}: ${a} is not ="…" quoted`);
        i += 2;
        const end = html.indexOf('"', i);
        if (end < 0) throw new Error(`scan: at ${i}: ${a}'s value never closes`);
        const raw = html.slice(i, end);
        if (/[<>]/.test(raw)) throw new Error(`scan: at ${i}: < or > in ${a}'s value`);
        el.attrs[a] = { raw, value: decode(raw, i) };
        i = end + 1;
      }
      if (html[i] !== '>') throw new Error(`scan: at ${i}: a start tag not closed by >`);
      i++;
      if (open.length === 1 && top.children.some((c) => c.name)) throw new Error(`scan: at ${i}: a second top-level element`);
      parent().children.push(el);
      if (el.name === 'style') {
        const end = html.indexOf('</style>', i);
        if (end < 0) throw new Error(`scan: at ${i}: <style> never closes`);
        const raw = html.slice(i, end);
        if (raw) el.children.push({ text: { raw, value: raw } });
        i = end + '</style>'.length;
      } else if (!VOID.has(el.name)) {
        open.push(el);
      }
    } else {
      let end = i;
      while (end < html.length && html[end] !== '<') end++;
      const raw = html.slice(i, end);
      if (raw.includes('>')) throw new Error(`scan: at ${i}: > in text`);
      const value = decode(raw, i);
      if (open.length === 1) {
        if (raw.trim()) throw new Error(`scan: at ${i}: text outside the root element`);
      } else {
        parent().children.push({ text: { raw, value } });
      }
      i = end;
    }
  }
  if (open.length !== 1) throw new Error(`scan: <${parent().name}> never closes`);
  const root = top.children.find((c) => c.name);
  if (!root) throw new Error('scan: no root element');
  return { doctype: DOCTYPE, root, comments };
}

// Every element under (and including) `root` in document order for which `pred(el)` holds; `find`
// the first or null. Explicit stack, no recursion.
function all(root, pred = () => true) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    if (pred(el)) out.push(el);
    for (let k = el.children.length - 1; k >= 0; k--) if (el.children[k].name) stack.push(el.children[k]);
  }
  return out;
}
const find = (root, pred) => all(root, pred)[0] ?? null;
// An element's text children joined, raw or decoded.
const rawText = (el) => el.children.filter((c) => c.text).map((c) => c.text.raw).join('');
const textOf = (el) => el.children.filter((c) => c.text).map((c) => c.text.value).join('');

// A style attribute's declarations: split on `;`, then each on its first `:`. Throws on a declaration
// with no `:` or a name twice.
function decls(style) {
  const m = new Map();
  if (style === '') return m;
  for (const d of style.split(';')) {
    const k = d.indexOf(':');
    if (k < 0) throw new Error(`decls: ${JSON.stringify(d)} has no :`);
    const n = d.slice(0, k);
    if (m.has(n)) throw new Error(`decls: ${n} twice`);
    m.set(n, d.slice(k + 1));
  }
  return m;
}

const TAGS = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'main', 'div', 'svg', 'path', 'img']);
const ATTRS = new Set(['lang', 'charset', 'name', 'content', 'data-page', 'data-node', 'data-type', 'data-name', 'data-cut', 'style', 'width', 'height', 'd', 'fill', 'stroke', 'stroke-width', 'src', 'alt', 'xmlns']);
const STYLE_BAD = ['url(', '@import', '@font-face', 'expression(', 'javascript:', '\\'];
const SRC_RE = /^images\/[0-9a-f]{16}\.(png|jpg|webp|gif)$/;
const styleBad = (s) => STYLE_BAD.filter((b) => s.toLowerCase().includes(b));

// S2 and S3 on a scanned page, as a list of problems ([] when clean): tags and attribute names in the
// allow-lists, no attribute starting `on`, at most the skeleton's two metas, at most one `<style>`,
// style attributes and the `<style>` text free of STYLE_BAD (case-insensitive), every `src` an
// `images/<hex16>.<ext>`. With `style` given, the one `<style>` block must equal it exactly.
function hostileProblems(tree, style) {
  const out = [];
  const els = all(tree.root);
  for (const el of els) {
    if (!TAGS.has(el.name)) out.push(`tag <${el.name}>`);
    for (const [a, { raw, value }] of Object.entries(el.attrs)) {
      if (!ATTRS.has(a)) out.push(`<${el.name}> attribute ${a}`);
      if (a.startsWith('on')) out.push(`<${el.name}> handler ${a}`);
      if (a === 'style') for (const b of styleBad(value)) out.push(`<${el.name}> style ${JSON.stringify(raw)} holds ${b}`);
      if (a === 'src' && !SRC_RE.test(value)) out.push(`<${el.name}> src ${JSON.stringify(raw)}`);
    }
  }
  const metas = els.filter((el) => el.name === 'meta');
  if (metas.length > 2) out.push(`${metas.length} <meta> tags`);
  const styles = els.filter((el) => el.name === 'style');
  if (styles.length > 1) out.push(`${styles.length} <style> blocks`);
  for (const el of styles) for (const b of styleBad(rawText(el))) out.push(`<style> holds ${b}`);
  if (style !== undefined && (styles.length !== 1 || rawText(styles[0]) !== style)) out.push('<style> is not the kit\'s');
  return out;
}

// ---- S1: the scanner refuses a broken page ----

const COMMENT = '<!-- Generated from canvas.json. Edit it in the canvas, not by hand. -->';
const STYLE = '*{box-sizing:border-box;margin:0}body>main{position:relative}';
const page = (body, style = STYLE) => `${DOCTYPE}\n${COMMENT}\n<html lang="en"><head><meta charset="utf-8"><title>T</title><style>${style}</style></head><body><main data-page="p1">${body}</main></body></html>\n`;

test('canvas static page: the scanner refuses a broken page', () => {
  // Outside the grammar: the scanner itself throws.
  const thrown = {
    'an attribute broken out of': '<div data-name="a" onerror=x></div>',
    'a stray comment': '<div>a <!-- x --> b</div>',
    'a bare &': '<div>fish & chips</div>',
    'an unquoted handler': '<b onerror=x></b>',
  };
  for (const [what, body] of Object.entries(thrown)) {
    assert.throws(() => scan(page(body), COMMENT), /^Error: scan: /, what);
  }
  // Inside the grammar but hostile: it scans, and hostileProblems lists it.
  const listed = {
    'a script': '<script>alert(1)</script>',
    'a quoted handler': '<b onerror="x">b</b>',
    'a url( style': '<div style="background:url(x)"></div>',
    'an @import style block': ['', '@import "https://evil.example/x.css";'],
    'a javascript: link': '<a href="javascript:x">a</a>',
  };
  for (const [what, v] of Object.entries(listed)) {
    const html = Array.isArray(v) ? page(v[0], v[1]) : page(v);
    const tree = scan(html, COMMENT);
    assert.notDeepEqual(hostileProblems(tree), [], what);
    assert.notDeepEqual(hostileProblems(tree, STYLE), [], `${what}, with the style given`);
  }
  // A good page scans to the expected tree and has no problem.
  const good = page('<div data-node="a" data-type="text" data-name="&lt;b&gt; &amp; &quot;q&quot; &#39;s" style="width:10px;color:#111">x &lt; y</div><img data-node="i" data-type="image" src="images/429be16d0a91e377.png" alt="P"><svg width="16" height="16" style="overflow:visible"><path d="M2 8 L6 12" fill="none"></path></svg>');
  const tree = scan(good, COMMENT);
  const at = (raw, value = raw) => ({ raw, value });
  const el = (name, attrs, children = []) => ({ name, attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, Array.isArray(v) ? at(...v) : at(v)])), children });
  const tx = (raw, value = raw) => ({ text: at(raw, value) });
  assert.deepEqual(tree, {
    doctype: DOCTYPE,
    comments: 1,
    root: el('html', { lang: 'en' }, [
      el('head', {}, [el('meta', { charset: 'utf-8' }), el('title', {}, [tx('T')]), el('style', {}, [tx(STYLE)])]),
      el('body', {}, [el('main', { 'data-page': 'p1' }, [
        el('div', { 'data-node': 'a', 'data-type': 'text', 'data-name': ['&lt;b&gt; &amp; &quot;q&quot; &#39;s', '<b> & "q" \'s'], style: 'width:10px;color:#111' }, [tx('x &lt; y', 'x < y')]),
        el('img', { 'data-node': 'i', 'data-type': 'image', src: 'images/429be16d0a91e377.png', alt: 'P' }),
        el('svg', { width: '16', height: '16', style: 'overflow:visible' }, [el('path', { d: 'M2 8 L6 12', fill: 'none' })]),
      ])]),
    ]),
  });
  assert.deepEqual(hostileProblems(tree, STYLE), []);
  assert.equal(find(tree.root, (e) => e.attrs['data-node']?.value === 'a').attrs['data-name'].raw, esc('<b> & "q" \'s'));
  assert.deepEqual([...decls('width:10px;color:#111')], [['width', '10px'], ['color', '#111']]);
  assert.equal(textOf(find(tree.root, (e) => e.name === 'div')), 'x < y');
});

test('canvas static page: the scanner holds to the grammar', () => {
  const bad = {
    'no doctype': page('').slice(DOCTYPE.length),
    'a self-closing tag': page('<div/>'),
    'an upper-case tag': page('<DIV></DIV>'),
    'a bare attribute': page('<div hidden></div>'),
    'two spaces between attributes': page('<div  a="1"></div>'),
    'a single-quoted attribute': page("<div a='1'></div>"),
    'a > in a value': page('<div a="1>2"></div>'),
    'a > in text': page('<div>1 > 0</div>'),
    'an unknown entity': page('<div>&nbsp;</div>'),
    'a numeric entity other than &#39;': page('<div>&#60;</div>'),
    'a mismatched end tag': page('<div></span>'),
    'an end tag for a void element': page('<img src="images/429be16d0a91e377.png"></img>'),
    'an unclosed element': page('<div>'),
    'an attribute twice': page('<div a="1" a="2"></div>'),
    'a style never closed': `${DOCTYPE}<html><style>x</html>`,
    'text outside the root': `${page('')}tail`,
    'a second root element': `${page('')}<html></html>`,
    'a comment cut short': page('').replace(COMMENT, COMMENT.slice(0, -4)),
  };
  for (const [what, html] of Object.entries(bad)) assert.throws(() => scan(html, COMMENT), /^Error: scan: /, what);
  assert.equal(scan(page(''), COMMENT).comments, 1);
});

// ---- resolve: the fake's ----

// Every instance in the fixtures, and each fixture instance once per variant of its component with its
// own overrides and prop values removed (so each variant's values show through).
function resolveCases() {
  const out = [];
  for (const name of FIXTURE_NAMES) {
    const doc = fixture(name);
    for (const [id, n] of Object.entries(doc.nodes)) {
      if (n.type !== 'instance') continue;
      out.push([`${name} ${id}`, doc, id]);
      const comp = doc.nodes[n.component];
      for (const v of Object.keys(comp.variants || {})) {
        const d = structuredClone(doc);
        d.nodes[id].variant = v;
        delete d.nodes[id].overrides;
        delete d.nodes[id].props;
        out.push([`${name} ${id} variant ${v} alone`, d, id]);
      }
    }
  }
  return out;
}

test('canvas static page: resolve is the fake\'s', () => {
  assert.equal(typeof canvas.resolve, 'function', 'canvas.resolve is exported');
  const cases = resolveCases();
  assert.ok(cases.length >= 5, `${cases.length} cases`);
  for (const [what, doc, id] of cases) {
    assert.deepEqual(canvas.validate(doc), [], `${what} is valid`);
    const before = structuredClone(doc);
    assert.deepEqual(canvas.resolve(doc, id), fake.resolve(doc, id), what);
    assert.deepEqual(doc, before, `${what}: the document is unchanged`);
  }
  const doc = fixture('doc-every-type.json');
  assert.throws(() => canvas.resolve(doc, 'card'), { message: 'resolve: card is not an instance' });
  assert.throws(() => canvas.resolve(doc, 'no-such'), { message: 'resolve: no-such is not an instance' });
  const broken = structuredClone(doc);
  broken.nodes.buy.component = 'card';
  assert.throws(() => canvas.resolve(broken, 'buy'), { message: 'resolve: card is not a component' });
  assert.throws(() => fake.resolve(broken, 'buy'), { message: 'resolve: card is not a component' });
});
