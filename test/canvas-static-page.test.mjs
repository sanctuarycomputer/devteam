// The canvas static page (docs/devteam/scripts/canvas.mjs `staticPage`, kit-654): a canvas's first page
// as static escaped HTML, and `resolve`, held to the contract's fake (test/lib/canvas-fake.mjs). The page
// is read by the strict scanner below, never by regular expressions over the bytes. Names start
// `canvas static page:`, never the measure's; this file obeys contract §13's skip rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as canvas from '../docs/devteam/scripts/canvas.mjs';
import * as fake from './lib/canvas-fake.mjs';
import { bareProject, freePort } from './lib/kit.mjs';

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
        // A browser ends the block at `</style` in any case: one before the exact close throws.
        if (raw.toLowerCase().includes('</style')) throw new Error(`scan: at ${i}: </style in another case inside <style>`);
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
  assert.throws(() => scan(page('', 'a{}</STYLE><script>x</script>'), COMMENT), /^Error: scan: /, 'a style block closed in upper case');
  // Inside the grammar but hostile: it scans, and hostileProblems lists it.
  // Each with the problem its own check must list (so turning any one check off fails here).
  const listed = {
    'a script': ['<script>alert(1)</script>', 'tag <script>'],
    'a quoted handler': ['<b onerror="x">b</b>', 'tag <b>'],
    'a handler on an allowed tag': ['<div onerror="x"></div>', '<div> handler onerror'],
    'a handler on an allowed tag, by the allow-list':['<div onerror="x"></div>', '<div> attribute onerror'],
    'a disallowed attribute on an allowed tag': ['<div href="x"></div>', '<div> attribute href'],
    'a url( style': ['<div style="background:url(x)"></div>', 'holds url('],
    'an @import style block': ['', '<style> holds @import', '@import "https://evil.example/x.css";'],
    'a javascript: link': ['<a href="javascript:x">a</a>', 'tag <a>'],
    'a remote src': ['<img src="https://x/y.png" alt="a">', '<img> src'],
    'a third meta': ['<meta name="viewport" content="width=device-width"><meta name="x" content="y">', '3 <meta> tags'],
  };
  for (const [what, [body, want, style]] of Object.entries(listed)) {
    const tree = scan(page(body, style), COMMENT);
    for (const given of [undefined, STYLE]) {
      const problems = hostileProblems(tree, given);
      assert.ok(problems.some((p) => p.includes(want)), `${what}${given ? ', with the style given' : ''}: ${JSON.stringify(problems)} lacks ${want}`);
    }
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

// ---- the page (T2): staticPage on the fixtures, read through the scanner ----

// A deep-frozen deep copy, so a renderer that writes to its input throws.
function frozenCopy(v) {
  const root = structuredClone(v);
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    if (x === null || typeof x !== 'object' || Object.isFrozen(x)) continue;
    Object.freeze(x);
    for (const k of Object.keys(x)) stack.push(x[k]);
  }
  return root;
}
// staticPage's page, asserted ok, and its scan with the kit's comment.
function render(doc, what = 'the document') {
  const r = canvas.staticPage(doc);
  assert.equal(r.ok, true, `${what}: ${JSON.stringify(r.errors)}`);
  return { html: r.html, tree: scan(r.html, canvas.STATIC_COMMENT) };
}
const nodeOf = (el) => el.attrs['data-node']?.value;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Elements not inside an instance's element (an instance's own element is one), in document order.
function topLevel(root) {
  const out = [];
  const stack = [[root, false]];
  while (stack.length) {
    const [el, inside] = stack.pop();
    if (!inside) out.push(el);
    const under = inside || el.attrs['data-type']?.value === 'instance';
    for (let k = el.children.length - 1; k >= 0; k--) if (el.children[k].name) stack.push([el.children[k], under]);
  }
  return out;
}
// The one top-level element for a node id (asserted one).
function topEl(tree, id) {
  const els = topLevel(tree.root).filter((el) => nodeOf(el) === id);
  assert.equal(els.length, 1, `${id}: ${els.length} top-level elements`);
  return els[0];
}
// An element under `el` (not el itself) for a node id (asserted one).
function inside(el, id) {
  const els = all(el).filter((e) => e !== el && nodeOf(e) === id);
  assert.equal(els.length, 1, `${id} inside ${nodeOf(el)}: ${els.length} elements`);
  return els[0];
}
const styleOf = (el) => decls(el.attrs.style ? el.attrs.style.value : '');
// Every id reached from pages[0] through children (not through instances).
function firstPageIds(doc) {
  const out = [];
  const stack = [...doc.pages[0].children].reverse();
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    const kids = doc.nodes[id].children || [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return out;
}
// Declarations a style must hold, each compared exactly.
function holds(el, want, what) {
  const d = styleOf(el);
  for (const [k, v] of Object.entries(want)) assert.equal(d.get(k), v, `${what}: ${k} in ${JSON.stringify(el.attrs.style?.value)}`);
}

test('canvas static page: staticPage gives a stable page and leaves its input alone', () => {
  assert.equal(typeof canvas.staticPage, 'function', 'canvas.staticPage is exported');
  assert.equal(canvas.STATIC_MAX_ELEMENTS, 100000);
  assert.equal(typeof canvas.STATIC_STYLE, 'string');
  assert.equal(typeof canvas.STATIC_COMMENT, 'string');
  assert.ok(canvas.STATIC_COMMENT.startsWith('<!--') && canvas.STATIC_COMMENT.endsWith('-->'));
  for (const name of FIXTURE_NAMES) {
    const doc = frozenCopy(fixture(name));
    const before = structuredClone(doc);
    const r = canvas.staticPage(doc);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.errors)}`);
    assert.equal(typeof r.html, 'string');
    assert.ok(r.html.startsWith('<!doctype html>'), name);
    assert.equal(canvas.staticPage(doc).html, r.html, `${name}: the same bytes twice`);
    assert.equal(canvas.staticPage(structuredClone(before)).html, r.html, `${name}: the same bytes from a copy`);
    assert.deepEqual(doc, before, `${name}: unchanged`);
    assert.equal(scan(r.html, canvas.STATIC_COMMENT).comments, 1, `${name}: one kit comment`);
  }
});

test('canvas static page: every node of the first page appears, typed', () => {
  const types = new Set();
  for (const name of FIXTURE_NAMES) {
    const doc = fixture(name);
    const { tree } = render(doc, name);
    const ids = firstPageIds(doc);
    for (const id of ids) assert.equal(topEl(tree, id).attrs['data-type']?.value, doc.nodes[id].type, `${name}: ${id}'s type`);
    const shown = topLevel(tree.root).map(nodeOf).filter((x) => x !== undefined);
    assert.deepEqual(shown.slice().sort(), ids.slice().sort(), `${name}: the top-level nodes are the first page's`);
    for (const el of all(tree.root)) if (el.attrs['data-type']) types.add(el.attrs['data-type'].value);
  }
  assert.deepEqual([...types].sort(), [...canvas.TYPES].sort());
});

test('canvas static page: instances show their resolved component', () => {
  for (const name of FIXTURE_NAMES) {
    const doc = fixture(name);
    for (const [id, n] of Object.entries(doc.nodes)) if (n.type === 'instance') assert.deepEqual(canvas.resolve(doc, id), fake.resolve(doc, id), `${name} ${id}`);
  }
  const { tree } = render(fixture('doc-every-type.json'));
  const buy = topEl(tree, 'buy');
  assert.equal(buy.attrs['data-type'].value, 'instance');
  assert.equal(buy.attrs['data-name'].value, 'Buy');
  const label = inside(buy, 'button-label');
  const bg = inside(buy, 'button-bg');
  assert.equal(label.attrs['data-type'].value, 'text');
  assert.equal(label.attrs['data-name'].value, 'Label');
  assert.equal(bg.attrs['data-type'].value, 'frame');
  assert.equal(textOf(label), 'Buy now');
  const seen = all(buy).flatMap((el) => [...el.children.filter((c) => c.text).map((c) => c.text.value), ...Object.values(el.attrs).map((a) => a.value)]).join('\n');
  for (const gone of ['Base label', 'Override label', 'Variant label', 'Default label']) assert.ok(!seen.includes(gone), `${gone} inside buy`);
  holds(bg, { 'background-color': 'rgb(59 91 219 / 1)', flex: '1 1 0' }, 'button-bg');
  holds(label, { color: '#ffffff' }, 'button-label');
  // The instance's box is the component root's: a row with its fill, border and radius.
  holds(buy, { display: 'flex', 'flex-direction': 'row', gap: '16px', 'background-color': 'rgb(255 255 255 / 1)', border: '1px solid #d0d4dc', 'border-radius': '4px', overflow: 'hidden' }, 'buy');
});

test('canvas static page: styles come from the properties', () => {
  const { tree } = render(fixture('doc-every-type.json'));
  holds(topEl(tree, 'card'), {
    display: 'flex', 'flex-direction': 'column', width: '360px', 'border-radius': '4px', gap: '16px', overflow: 'hidden',
    'background-color': 'rgb(255 255 255 / 1)', border: '1px solid #d0d4dc', padding: '16px 16px 16px 16px',
    'align-items': 'stretch', 'justify-content': 'space-between', position: 'absolute', left: '0px', top: '0px',
  }, 'card');
  assert.equal(styleOf(topEl(tree, 'card')).has('height'), false, 'card: hug height writes nothing');
  holds(topEl(tree, 'tiles'), { display: 'grid', 'grid-template-columns': '1fr 1fr', 'grid-template-rows': '80px auto', gap: '4px' }, 'tiles');
  holds(topEl(tree, 'loose'), { position: 'absolute', left: '400px', top: '0px', width: '200px', height: '200px' }, 'loose');
  holds(topEl(tree, 'badge'), { position: 'absolute', left: '12px', top: '-8px', width: '24px', height: '24px', 'border-radius': '12px', 'background-color': '#ef4444' }, 'badge');
  holds(topEl(tree, 'dot'), { 'border-radius': '50%', 'background-color': 'rgb(59 91 219 / 1)', border: '0.5px solid #fff', width: '8px', height: '8px' }, 'dot');
  holds(topEl(tree, 'rule'), { 'align-self': 'stretch', height: '1px', 'background-color': '#e5e7eb' }, 'rule');
  assert.equal(styleOf(topEl(tree, 'rule')).has('border'), false, 'rule: no stroke, no border');
  const icon = topEl(tree, 'icon');
  assert.equal(icon.name, 'svg');
  assert.equal(icon.attrs.width.value, '16');
  assert.equal(icon.attrs.height.value, '16');
  holds(icon, { overflow: 'visible' }, 'icon');
  const pathEl = icon.children.filter((c) => c.name);
  assert.equal(pathEl.length, 1);
  assert.equal(pathEl[0].name, 'path');
  assert.equal(pathEl[0].attrs.d.value, 'M2 8 L6 12 L14 4');
  assert.equal(pathEl[0].attrs.fill.value, 'none');
  assert.equal(pathEl[0].attrs.stroke.value, '#111111ff');
  assert.equal(pathEl[0].attrs['stroke-width'].value, '2');
  const photo = topEl(tree, 'photo');
  assert.equal(photo.name, 'img');
  assert.equal(photo.attrs.src.value, 'images/429be16d0a91e377.png');
  assert.equal(photo.attrs.alt.value, 'Photo');
  holds(photo, { 'object-fit': 'cover', 'border-radius': '8px', height: '120px', 'align-self': 'stretch' }, 'photo');
  const title = topEl(tree, 'title');
  assert.equal(textOf(title), 'Order summary');
  holds(title, {
    'white-space': 'pre-wrap', 'font-family': 'sans-serif', 'font-size': '16px', 'font-weight': '400', 'line-height': '1.4',
    'letter-spacing': '0px', color: 'rgb(17 17 17 / 1)', 'text-align': 'left', 'align-self': 'stretch',
  }, 'title');
  holds(topEl(tree, 'actions'), { display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-self': 'stretch' }, 'actions');
  // Review focus 3: button-label's literal font, every part a token reference; no letter spacing.
  const label = inside(topEl(tree, 'buy'), 'button-label');
  holds(label, { 'font-family': 'serif', 'font-size': '16px', 'font-weight': '700', 'line-height': '1.5' }, 'button-label');
  assert.equal(styleOf(label).has('letter-spacing'), false, 'button-label: a literal font has no letter spacing');
});

test('canvas static page: a hidden node stays, with display:none', () => {
  const doc = fixture('doc-every-type.json');
  doc.nodes.card.visible = false;
  assert.deepEqual(canvas.validate(doc), []);
  const { tree } = render(doc);
  const card = topEl(tree, 'card');
  holds(card, { display: 'none', 'flex-direction': 'column' }, 'card');
  assert.equal(inside(card, 'title').attrs['data-type'].value, 'text');
});

test('canvas static page: an empty first page renders an empty main', () => {
  const doc = fixture('doc-minimal.json');
  const { tree } = render(doc);
  const main = find(tree.root, (el) => el.name === 'main');
  assert.equal(main.attrs['data-page'].value, 'p1');
  assert.deepEqual(main.children, []);
  assert.equal(textOf(find(tree.root, (el) => el.name === 'title')), 'Page 1');
  const unnamed = structuredClone(doc);
  unnamed.pages[0].name = '';
  assert.equal(textOf(find(render(unnamed).tree.root, (el) => el.name === 'title')), 'p1', 'the page id when the name is empty');
});

test('canvas static page: a document that is not valid gives no page', () => {
  const broken = fixture('doc-every-type.json');
  broken.nodes.card.fill = 'red; background:url(x)';
  const errors = canvas.validate(broken, { images: null });
  assert.ok(errors.length > 0);
  const r = canvas.staticPage(broken);
  assert.deepEqual(r, { ok: false, errors });
  assert.equal(Object.hasOwn(r, 'html'), false);
  for (const v of [42, null, 'x', [], undefined]) {
    const e = canvas.validate(v, { images: null });
    assert.ok(e.length > 0 && e[0].rule === 'top', String(v));
    assert.deepEqual(canvas.staticPage(v), { ok: false, errors: e }, `${String(v)}`);
  }
});

test('canvas static page: no script and no handler', () => {
  for (const name of FIXTURE_NAMES) {
    const { tree } = render(fixture(name), name);
    assert.deepEqual(hostileProblems(tree, canvas.STATIC_STYLE), [], name);
    const els = all(tree.root);
    for (const bad of ['script', 'iframe', 'object', 'embed', 'link', 'base', 'form', 'a', 'foreignObject', 'foreignobject']) {
      assert.equal(els.filter((el) => el.name === bad).length, 0, `${name}: <${bad}>`);
    }
    const metas = els.filter((el) => el.name === 'meta').map((el) => Object.fromEntries(Object.entries(el.attrs).map(([k, v]) => [k, v.value])));
    assert.deepEqual(metas, [{ charset: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }], `${name}: the skeleton's two metas`);
    for (const el of els) {
      assert.ok(TAGS.has(el.name), `${name}: <${el.name}>`);
      for (const a of Object.keys(el.attrs)) {
        assert.ok(ATTRS.has(a), `${name}: <${el.name}> ${a}`);
        assert.ok(!a.startsWith('on'), `${name}: <${el.name}> ${a}`);
      }
    }
  }
});

test('canvas static page: no url() and no loading', () => {
  assert.deepEqual(styleBad(canvas.STATIC_STYLE), []);
  for (const name of FIXTURE_NAMES) {
    const { tree } = render(fixture(name), name);
    const els = all(tree.root);
    const styles = els.filter((el) => el.name === 'style');
    assert.equal(styles.length, 1, name);
    assert.equal(rawText(styles[0]), canvas.STATIC_STYLE, `${name}: the style block is the kit's`);
    for (const el of els) {
      if (el.attrs.style) assert.deepEqual(styleBad(el.attrs.style.value), [], `${name}: ${nodeOf(el)}'s style`);
      if (el.attrs.src) assert.match(el.attrs.src.value, SRC_RE, `${name}: ${nodeOf(el)}'s src`);
    }
  }
});

test('canvas static page: every free text is there, escaped, field by field', () => {
  const doc = fixture('hostile.json');
  const { html, tree } = render(doc);
  const title = find(tree.root, (el) => el.name === 'title');
  assert.equal(rawText(title), esc(doc.pages[0].name));
  assert.equal(textOf(title), doc.pages[0].name);
  const nameIs = (el, n, what) => {
    assert.equal(el.attrs['data-name']?.raw, esc(n), `${what}: raw data-name`);
    assert.equal(el.attrs['data-name'].value, n, `${what}: data-name`);
  };
  for (const id of ['hf', 'ht', 'hr', 'hv', 'him', 'hc', 'hct', 'hi']) nameIs(topEl(tree, id), doc.nodes[id].name, id);
  const hi = topEl(tree, 'hi');
  const inHi = all(hi).filter((el) => el !== hi && nodeOf(el) !== undefined);
  assert.ok(inHi.length > 0);
  for (const el of inHi) nameIs(el, doc.nodes[nodeOf(el)].name, `${nodeOf(el)} inside hi`);
  const him = topEl(tree, 'him');
  assert.equal(him.attrs.alt.raw, esc(doc.nodes.him.name));
  assert.equal(him.attrs.alt.value, doc.nodes.him.name);
  for (const id of ['ht', 'hct']) {
    assert.equal(rawText(topEl(tree, id)), esc(doc.nodes[id].text), `${id}: raw text`);
    assert.equal(textOf(topEl(tree, id)), doc.nodes[id].text, `${id}: text`);
  }
  const want = canvas.resolve(doc, 'hi').hct.text;
  assert.equal(rawText(inside(hi, 'hct')), esc(want));
  assert.equal(textOf(inside(hi, 'hct')), want);
  for (const { where, value } of fake.freeTexts(doc)) if (value.includes('<')) assert.ok(!html.includes(value), `${where} raw in the page`);
  // The markers holding a `<` occur no more often than in the page of the copy whose free texts are `x`
  // (the skeleton's own `<style>`).
  const count = (s, m) => s.split(m).length - 1;
  const plainHtml = render(plainCopy(doc)).html;
  for (const m of fake.HOSTILE_MARKERS) if (m.includes('<')) assert.equal(count(html, m), count(plainHtml, m), `${JSON.stringify(m)} raw in the page`);
});

// The page as a tree of tag names, attribute names and text markers: what a hostile string must not change.
function structure(root) {
  const out = [];
  const stack = [[root, 0]];
  while (stack.length) {
    const [el, depth] = stack.pop();
    out.push(`${depth} <${el.name} ${Object.keys(el.attrs).join(' ')}>`);
    for (let k = el.children.length - 1; k >= 0; k--) {
      const c = el.children[k];
      if (c.name) stack.push([c, depth + 1]);
      else stack.push([{ name: '#text', attrs: {}, children: [] }, depth + 1]);
    }
  }
  return out;
}
// A copy with every free text (fake.freeTexts' fields) set to `x`.
function plainCopy(doc) {
  const d = structuredClone(doc);
  for (const { where } of fake.freeTexts(doc)) {
    const m = /^pages\[(\d+)\]\.name$/.exec(where);
    if (m) { d.pages[Number(m[1])].name = 'x'; continue; }
    const segs = where.split('.');
    let at = d;
    for (const s of segs.slice(0, -1)) at = at[s];
    at[segs[segs.length - 1]] = 'x';
  }
  return d;
}

test('canvas static page: nothing of the document outside text', () => {
  const doc = fixture('hostile.json');
  const plain = plainCopy(doc);
  assert.deepEqual(canvas.validate(plain), []);
  assert.ok(fake.freeTexts(plain).every((f) => f.value === 'x'));
  assert.deepEqual(structure(render(doc).tree.root), structure(render(plain).tree.root));
});

test('canvas static page: a nested instance takes the enclosing instance\'s values', () => {
  const doc = fixture('doc-every-type.json');
  doc.pages[1].children.push('chip');
  doc.nodes.chip = { type: 'component', parent: 'p-parts', name: 'Chip', children: ['chip-t'] };
  doc.nodes['chip-t'] = { type: 'text', parent: 'chip', name: 'Chip text', text: 'From the chip' };
  doc.nodes.button.children.push('inner');
  doc.nodes.inner = { type: 'instance', parent: 'button', name: 'Inner', component: 'chip' };
  doc.nodes.buy.overrides.inner = { opacity: 0.5, visible: false };
  assert.deepEqual(canvas.validate(doc), []);
  const { tree } = render(doc);
  const inner = inside(topEl(tree, 'buy'), 'inner');
  assert.equal(inner.attrs['data-type'].value, 'instance');
  assert.equal(inner.attrs['data-name'].value, 'Inner');
  holds(inner, { opacity: '0.5', display: 'none' }, 'inner');
  const t = inside(inner, 'chip-t');
  assert.equal(t.attrs['data-type'].value, 'text');
  assert.equal(textOf(t), 'From the chip');
});

test('canvas static page: data-name is left out for an empty name', () => {
  const doc = fixture('doc-every-type.json');
  doc.nodes.card.name = '';
  assert.deepEqual(canvas.validate(doc), []);
  const card = topEl(render(doc).tree, 'card');
  assert.equal(own(card.attrs, 'data-name'), false, `card: ${JSON.stringify(Object.keys(card.attrs))}`);
});

test('canvas static page: zero-width stroke and fill sizing under none', () => {
  const doc = fixture('doc-every-type.json');
  doc.nodes.card.strokeWidth = 0;
  doc.nodes.badge.size.w = 'fill';
  assert.deepEqual(canvas.validate(doc), []);
  const { tree } = render(doc);
  const card = styleOf(topEl(tree, 'card'));
  assert.equal(card.has('border'), false, `card: border ${card.get('border')}`);
  holds(topEl(tree, 'badge'), { width: '100%' }, 'badge');
});

// ---- the cap on instance expansion (T3, C7) ----

// A valid document: page p1 holds one instance of c0; page p2 holds components c0…c(n-1), each ci
// (i < n-1) holding two instances of c(i+1), and c(n-1) holding one rect. Expanded, the top instance
// holds 3 × 2^(n-1) - 2 elements.
function chain(n) {
  const nodes = {};
  nodes.top = { type: 'instance', parent: 'p1', name: 'Top', component: 'c0' };
  const comps = [];
  for (let i = 0; i < n; i++) {
    const id = `c${i}`;
    comps.push(id);
    if (i === n - 1) {
      nodes[id] = { type: 'component', parent: 'p2', name: `C${i}`, children: [`r${i}`] };
      nodes[`r${i}`] = { type: 'rect', parent: id, name: 'Leaf', size: { w: 4, h: 4 }, fill: '#111111' };
    } else {
      nodes[id] = { type: 'component', parent: 'p2', name: `C${i}`, children: [`c${i}-a`, `c${i}-b`] };
      for (const s of ['a', 'b']) nodes[`c${i}-${s}`] = { type: 'instance', parent: id, name: `C${i} ${s}`, component: `c${i + 1}` };
    }
  }
  return {
    canvas: 1,
    rev: 0,
    tokens: {},
    pages: [{ id: 'p1', name: 'Page 1', children: ['top'] }, { id: 'p2', name: 'Parts', children: comps }],
    nodes,
  };
}

test('canvas static page: instance expansion is capped', { timeout: 60000 }, () => {
  const big = chain(20);
  assert.deepEqual(canvas.validate(big), []);
  const t0 = Date.now();
  const r1 = canvas.staticPage(big);
  const ms = Date.now() - t0;
  assert.equal(r1.ok, true, JSON.stringify(r1.errors));
  // An uncapped page fails here, before the scanner reads a million elements.
  assert.ok(r1.html.length < 64 * 1024 * 1024, `the page is ${r1.html.length} bytes`);
  const tree = scan(r1.html, canvas.STATIC_COMMENT);
  const els = all(tree.root);
  const limit = canvas.STATIC_MAX_ELEMENTS + Object.keys(big.nodes).length;
  assert.ok(els.length <= limit, `${els.length} elements, more than ${limit}`);
  assert.ok(els.some((el) => el.attrs['data-cut']?.value === 'true'), 'no data-cut="true"');
  assert.equal(canvas.staticPage(big).html, r1.html, 'two runs differ');
  assert.ok(ms < 30000, `the render took ${ms} ms`);

  const small = chain(3);
  assert.deepEqual(canvas.validate(small), []);
  const s = render(small, 'chain(3)');
  assert.ok(all(s.tree.root).every((el) => !own(el.attrs, 'data-cut')), 'a data-cut in chain(3)');
  const top = topEl(s.tree, 'top');
  const within = all(top).filter((el) => el !== top);
  // c2 = 1 rect; c1 = 2 boxes each holding c2 = 4; c0 = 2 boxes each holding c1 = 10.
  assert.equal(within.length, 10, `${within.length} elements inside the top instance`);
  const boxes = within.filter((el) => /^c[01]-[ab]$/.test(nodeOf(el)));
  assert.equal(boxes.length, 6);
  for (const el of boxes) assert.equal(el.attrs['data-type'].value, 'instance', nodeOf(el));
  assert.equal(within.filter((el) => nodeOf(el) === 'r2' && el.attrs['data-type'].value === 'rect').length, 4);
});

// chain(n) whose last component holds one vector with a path of about 60 KB in place of the rect.
function longChain(n) {
  const doc = chain(n);
  const leaf = `r${n - 1}`;
  doc.nodes[leaf] = { ...vectorNode(`c${n - 1}`, 'Long'), path: `M0 0${' L1 1'.repeat(11999)}` };
  return doc;
}

test('canvas static page: the page\'s length is capped', { timeout: 60000 }, () => {
  const bound = canvas.STATIC_MAX_CHARS + 8 * 1024 * 1024;
  assert.equal(typeof canvas.STATIC_MAX_CHARS, 'number');
  const cutIn = (html) => all(scan(html, canvas.STATIC_COMMENT).root).some((el) => el.attrs['data-cut']?.value === 'true');
  // The cheap case first (about 15 MB uncapped), so a missing cap fails here and never builds 2 G.
  for (const n of [9, 16]) {
    const doc = longChain(n);
    assert.deepEqual(canvas.validate(doc), [], `chain ${n}`);
    const r = canvas.staticPage(doc);
    assert.equal(r.ok, true, `chain ${n}: ${JSON.stringify(r.errors)}`);
    assert.ok(r.html.length <= bound, `chain ${n}: the page is ${r.html.length} characters`);
    assert.ok(cutIn(r.html), `chain ${n}: no data-cut="true"`);
    if (n === 16) assert.equal(canvas.staticPage(doc).html, r.html, 'two runs differ');
  }
  const small = longChain(4);
  assert.deepEqual(canvas.validate(small), []);
  const s = render(small, 'chain 4');
  assert.ok(all(s.tree.root).every((el) => !own(el.attrs, 'data-cut')), 'a data-cut in chain 4');
  assert.equal(all(topEl(s.tree, 'top')).filter((el) => el.name === 'path').length, 8);
});

const vectorNode = (parent, name) => ({ type: 'vector', parent, name, size: { w: 16, h: 16 }, path: 'M2 8 L6 12 L14 4', fill: null, stroke: '#111111ff', strokeWidth: 2 });
// The scanner's element count of a page, asserted within STATIC_MAX_ELEMENTS + the node count.
function cappedTree(doc, what) {
  assert.deepEqual(canvas.validate(doc), [], what);
  const r = canvas.staticPage(doc);
  assert.equal(r.ok, true, `${what}: ${JSON.stringify(r.errors)}`);
  assert.ok(r.html.length < 64 * 1024 * 1024, `${what}: the page is ${r.html.length} bytes`);
  const tree = scan(r.html, canvas.STATIC_COMMENT);
  const els = all(tree.root);
  const limit = canvas.STATIC_MAX_ELEMENTS + Object.keys(doc.nodes).length;
  assert.ok(els.length <= limit, `${what}: ${els.length} elements, more than ${limit}`);
  return { tree, els };
}

test('canvas static page: the cap leaves room for what is written outside instances', { timeout: 60000 }, () => {
  // chain(16)'s top instance expands to 98302 elements; 3000 vectors after it write 6000 more.
  const doc = chain(16);
  for (let k = 0; k < 3000; k++) {
    doc.nodes[`v${k}`] = vectorNode('p1', `V${k}`);
    doc.pages[0].children.push(`v${k}`);
  }
  const { tree, els } = cappedTree(doc, 'chain(16) and 3000 vectors');
  assert.equal(topEl(tree, 'top').attrs['data-cut']?.value, 'true', 'top is not cut');
  assert.equal(els.filter((el) => el.name === 'svg').length, 3000);

  // Fan-out: 150 instances of a component of 500 vectors (1000 elements each, 150150 uncapped).
  const fan = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p1', name: 'Page 1', children: [] }, { id: 'p2', name: 'Parts', children: ['fan'] }], nodes: {} };
  fan.nodes.fan = { type: 'component', parent: 'p2', name: 'Fan', children: [] };
  for (let k = 0; k < 500; k++) {
    fan.nodes[`fv${k}`] = vectorNode('fan', `F${k}`);
    fan.nodes.fan.children.push(`fv${k}`);
  }
  for (let k = 0; k < 150; k++) {
    fan.nodes[`fi${k}`] = { type: 'instance', parent: 'p1', name: `I${k}`, component: 'fan' };
    fan.pages[0].children.push(`fi${k}`);
  }
  const f = cappedTree(fan, 'fan-out');
  const cut = (id) => topEl(f.tree, id).attrs['data-cut']?.value === 'true';
  const flags = fan.pages[0].children.map(cut);
  const firstCut = flags.indexOf(true);
  assert.ok(firstCut > 0, `first cut at ${firstCut}`);
  assert.ok(flags.slice(firstCut).every(Boolean), 'an instance after a cut one is let in');
  for (let k = 0; k < firstCut; k++) assert.equal(all(topEl(f.tree, `fi${k}`)).length, 1001, `fi${k}`);
  for (let k = firstCut; k < 150; k++) assert.equal(all(topEl(f.tree, `fi${k}`)).length, 1, `fi${k}`);
});

// ---- the kit's artifact check (C5): the page, as an artifact in a bare project ----

test('canvas static page: the page passes the kit\'s artifact check', { timeout: 120000 }, async (t) => {
  const savedHome = process.env.HOME;
  const savedDt = {};
  for (const k of Object.keys(process.env)) if (k.startsWith('DEVTEAM_')) { savedDt[k] = process.env[k]; delete process.env[k]; }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-canvas-home-'));
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-canvas-base-'));
  t.after(() => {
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    for (const k of Object.keys(process.env)) if (k.startsWith('DEVTEAM_')) delete process.env[k];
    Object.assign(process.env, savedDt);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  });
  process.env.HOME = home;
  const project = bareProject(base, 'canvas-check');
  const devteam = path.join(project, 'docs', 'devteam', 'scripts', 'devteam.mjs');
  const port = await freePort();
  const env = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(port) };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && k !== 'DEVTEAM_HUB_PORT') delete env[k];
  const put = (slug, title, doc, html) => {
    const dir = path.join(project, 'docs', 'devteam', 'project', 'artifacts', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    fs.writeFileSync(path.join(dir, 'artifact.json'), JSON.stringify({ v: 1, title, summary: `${title}, a canvas page`, by: 'supervisor', for: [] }));
    fs.writeFileSync(path.join(dir, 'canvas.json'), JSON.stringify(doc));
    fs.cpSync(path.join(FIXTURES, 'images'), path.join(dir, 'images'), { recursive: true });
  };
  const check = (slug) => spawnSync(process.execPath, [devteam, 'artifact', 'check', slug], { cwd: project, env, encoding: 'utf8' });
  const pageOf = (name) => {
    const doc = fixture(name);
    const r = canvas.staticPage(doc);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.errors)}`);
    return { doc, html: r.html };
  };

  // the control: a script off the allowed CDNs is flagged on stderr, so a clean stderr below means something
  const every = pageOf('doc-every-type.json');
  put('canvas-control', 'Canvas control', every.doc, every.html.replace('</body>', '<script src="https://evil.example/x.js"></script></body>'));
  assert.ok(every.html.includes('</body>'), 'the page has a body to end');
  const control = check('canvas-control');
  assert.match(control.stderr, /not on an allowed CDN/);

  for (const [slug, name] of [['canvas-every-type', 'doc-every-type.json'], ['canvas-minimal', 'doc-minimal.json'], ['canvas-hostile', 'hostile.json']]) {
    const { doc, html } = pageOf(name);
    put(slug, slug, doc, html);
    const r = check(slug);
    assert.equal(r.status, 0, `${slug}: ${r.stderr}${r.stdout}`);
    assert.match(r.stdout, /1 artifact pass/, slug);
    assert.equal(r.stderr, '', slug);
  }
});
