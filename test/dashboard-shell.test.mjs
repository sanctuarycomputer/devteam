// The dashboard shell (dashboard-shell@1, docs/devteam/dashboard/shell.md): its two blocks are
// byte-identical in index.html and hub.html, scoped so today's pages can't change, and their
// builders, binders and URL rules do what the contract says (run in vm, over a tiny DOM of their
// own HTML); and the measure check (test/lib/measure.mjs) passes on the fixture page built only from
// the blocks, at three sizes, and fails, check by check, on broken copies (headless Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { CHECKS, SIZES, measure, measureAt } from './lib/measure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.join(here, '..', 'docs', 'devteam', 'dashboard');
const read = (f) => fs.readFileSync(path.join(DASH, f), 'utf8');
const INDEX = read('index.html');
const HUB = read('hub.html');
const SHELL_MD = read('shell.md');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};
const LAYOUT = block(INDEX, 'devteam-layout');
const JS = block(INDEX, 'devteam-shell-js');
const ROUTES_SRC = block(INDEX, 'shell-routes');
const without = (src, ...names) => names.reduce((s, n) => s.replace(block(s, n), ''), src);

// ---- a tiny DOM: the builders' own HTML, parsed, with the few calls the binders make ----
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr']);
class El {
  constructor(tag, attrs = {}, parent = null) { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = parent; this.children = []; this.text = ''; this.focused = false; this.isConnected = true; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  get dataset() { const d = {}; for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) d[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; return d; }
  get classList() { return (this.attrs.class || '').split(/\s+/).filter(Boolean); }
  get disabled() { return Object.hasOwn(this.attrs, 'disabled'); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  matchesOne(sel) {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m) throw new Error(`the tiny DOM can't read ${sel}`);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.includes(c)) return false;
    for (const a of m[3].match(/\[[^\]]+\]/g) || []) { const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a); if (!Object.hasOwn(this.attrs, k) || (v !== undefined && this.attrs[k] !== v)) return false; }
    return true;
  }
  matches(sel) {
    return sel.split(',').some((s) => {
      const parts = s.trim().split(/\s+/);
      if (!this.matchesOne(parts.pop())) return false;
      let at = this.parentElement;
      while (parts.length) { while (at && !at.matchesOne(parts[parts.length - 1])) at = at.parentElement; if (!at) return false; parts.pop(); at = at.parentElement; }
      return true;
    });
  }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (e.matches(sel)) return e; return null; }
  contains(o) { for (let e = o; e; e = e.parentElement) if (e === this) return true; return false; }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  focus() { this.focused = true; }
  addEventListener(type, fn) { (this.on ??= {})[type] = [...(this.on?.[type] || []), fn]; }
  set innerHTML(html) {
    for (const c of this.children) c.isConnected = false;
    this.children = [];
    let at = this;
    for (const m of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)) {
      if (m[4] !== undefined) { at.text += m[4]; continue; }
      if (m[1]) { at = at.parentElement || this; continue; }
      const attrs = {};
      for (const a of m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
      const e = new El(m[2], attrs, at);
      at.children.push(e);
      if (!VOID.has(m[2].toLowerCase())) at = e;
    }
  }
}
// an event at target, through the root's delegated listeners
const fire = (root, type, target, extra = {}) => { const e = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of root.on?.[type] || []) fn(e); return e; };
const rootWith = (html) => { const r = new El('div'); r.innerHTML = html; return r; };

// the JS block (and the router's table) in a context of its own
const load = (ctx = {}) => {
  const c = vm.createContext({ URLSearchParams, ...ctx });
  vm.runInContext(`${JS}\n${ROUTES_SRC}\n;globalThis.S = { withPage, escHtml, tabBar, tabStep, bindTabBar, dbTable, sortRows, nextSort, bindDbTable, props, goalSteps, heartbeat, PULSE_STATES, statusPill, fleetSwitch, bindFleetSwitch, registerPage, shellPages, threadsTabs, STATE_KEYS, parseHead, headFor, stampFor, closeTarget, REMEMBERED, rememberedFilters, saveFilters, SHELL_ROUTES };`, c);
  return c.S;
};
const S = load();
const R = S.SHELL_ROUTES;

test('shell.md says @1 and defines what the design lists', () => {
  assert.match(SHELL_MD, /dashboard-shell@1/);
  for (const t of ['--page-max', '--page-top', '--page-pad', '--header-pad', '--panel-pad', '--head-h', '--backdrop', '--gap', '--ease', '--dur', '--threads-w', '--bar-h', '--measure']) {
    assert.ok(SHELL_MD.includes(`\`${t}\``), `shell.md defines ${t}`);
    assert.match(LAYOUT, new RegExp(`${t}:`), `the layout block sets ${t}`);
  }
  for (const n of ['.g12', '.cards', 'registerPage', 'tabBar', 'bindTabBar', 'dbTable', 'bindDbTable', 'props', 'goalSteps', 'heartbeat', 'statusPill', 'fleetSwitch', 'bindFleetSwitch', 'threadsTabs.register', 'parseHead', 'headFor', 'stampFor', 'closeTarget', 'rememberedFilters', 'history.state', 'redirects', '#<page>[?<state>]']) assert.ok(SHELL_MD.includes(n), `shell.md defines ${n}`);
  for (const k of ['th', 't', 'goal', 'feat', 'repo', 'att', 'gt', 'narrow', 'show', 'kind', 'st', 'lt', 'orient']) assert.ok(SHELL_MD.includes(`\`${k}\``), `shell.md names the state key ${k}`);
  assert.match(SHELL_MD, /no ticket before the copy sweep \(`kit-95`\) changes either block/);
});

test('both blocks are byte-identical in index.html and hub.html', () => {
  assert.equal(block(HUB, 'devteam-layout'), LAYOUT, 'the layout block');
  assert.equal(block(HUB, 'devteam-shell-js'), JS, 'the JS block');
  // the layout block sits right after the tokens block, so each page's own CSS comes after it
  for (const [name, src] of [['index.html', INDEX], ['hub.html', HUB]]) {
    const after = src.slice(src.indexOf('/* devteam-ui tokens end */') + '/* devteam-ui tokens end */'.length);
    assert.match(after, /^\s*\/\* devteam-layout start \*\//, `${name}: the layout block follows the tokens block`);
  }
});

test("every layout rule is scoped to .shell: index adopts it with its old regions fenced, the hub has none yet", () => {
  // every selector, inside @media or not, is :root or starts with :where(.shell)
  const css = LAYOUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const sels = [];
  const splitTop = (h) => { const out = []; let d = 0, cur = ''; for (const c of h) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c; } out.push(cur.trim()); return out; };
  const walk = (s) => { let i = 0; while (i < s.length) { const o = s.indexOf('{', i); if (o < 0) break; const head = s.slice(i, o).trim(); let d = 1, j = o + 1; while (d && j < s.length) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } const body = s.slice(o + 1, j - 1); if (head.startsWith('@media')) walk(body); else sels.push(...splitTop(head)); i = j; } };
  walk(css);
  assert.ok(sels.length > 50, 'the selectors were read');
  // and its subject sits outside any .no-shell region (the lower boundary), with no weight added
  const B = ':not(:where(.no-shell, .no-shell *))';
  for (const s of sels) assert.ok(s === ':root' || (/^:where\(\.shell\)(\.peek-open|\.threads-open)?[ :]/.test(s) && /:not\(:where\(\.no-shell, \.no-shell \*\)\)(::[\w-]+)?$/.test(s)), `scoped and fenced: ${s}`);
  assert.ok(sels.filter((s) => s.includes(B)).length === sels.filter((s) => s !== ':root').length);
  const frames = [...LAYOUT.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(frames, ['shell-ring'], 'its one animation has a name of its own');
  // index adopts the shell (kit-87): .shell on <body>, every region it doesn't port fenced with .no-shell;
  // the hub has no .shell until its own ticket (kit-94)
  const IDX = without(INDEX, 'devteam-layout', 'devteam-shell-js');
  assert.match(IDX, /<body class="shell">/, 'index.html adopts the shell on <body>');
  for (const id of ['overview', 'goals', 'inbox', 'progress', 'board', 'library', 'loop', 'trust', 'retros', 'health', 'monitoring', 'review-view', 'drawer', 'scrim', 'artifact-view', 'tl']) {
    const tag = IDX.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `index.html has #${id}`);
    assert.match(tag, /\bclass="[^"]*(?<![\w-])no-shell(?![\w-])/, `#${id} carries no-shell: ${tag}`);
  }
  assert.doesNotMatch(without(HUB, 'devteam-layout', 'devteam-shell-js'), /class="[^"]*(?<![\w-])shell(?![\w-])|classList\.(add|toggle)\(\s*['"]shell['"]|className\s*=\s*['"][^'"]*(?<![\w-])shell(?![\w-])/, 'hub.html has no .shell yet');
  for (const [name, src] of [['index.html', INDEX], ['hub.html', HUB]]) {
    const rest = without(src, 'devteam-layout', 'devteam-shell-js');
    for (const f of frames) assert.doesNotMatch(rest, new RegExp(`@keyframes\\s+${f}\\b|animation(-name)?:[^;]*\\b${f}\\b`), `${name} has no animation of the block's name ${f}`);
  }
  // index's own --measure (78ch) still comes after the block, so it still wins there
  assert.ok(INDEX.indexOf('--measure: 78ch') > INDEX.indexOf('/* devteam-layout end */'), "index's --measure still wins on index");
});

test("the JS block's names are its own: neither page declares one outside it", () => {
  const names = [...JS.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(names.includes('tabBar') && names.includes('parseHead') && names.includes('goalSteps'), 'its names were read');
  for (const [name, src] of [['index.html', INDEX], ['hub.html', HUB]]) {
    const rest = without(src, 'devteam-shell-js');
    for (const n of names) assert.doesNotMatch(rest, new RegExp(`(?:^|[\\s;(])(?:const|let|var|function|class)\\s+${n.replace('$', '\\$')}\\b`, 'm'), `${name} declares ${n} outside the block`);
  }
  // and it runs alone: no page global, no DOM at load
  assert.doesNotThrow(() => vm.runInContext(JS, vm.createContext({})));
  // each page's scripts still compile with the block in them (a second top-level const or let of a name is an early error)
  for (const [name, src] of [['index.html', INDEX], ['hub.html', HUB]]) {
    const scripts = [...src.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.some((x) => x.includes('/* devteam-shell-js start */')), `${name}: the block is in a script`);
    for (const x of scripts) assert.doesNotThrow(() => new vm.Script(x), `${name}: a script compiles`);
  }
  // index's own step bar keeps its markup under its new name
  assert.match(INDEX, /function goalStepper\(g, s, R\)/);
  assert.doesNotMatch(without(INDEX, 'devteam-shell-js'), /\bgoalSteps\(g, s, R\)/);
});

test('tabBar: counts, disabled tabs, roving tabindex; arrows, Home and End skip disabled tabs', () => {
  const tabs = [{ id: 'a', label: 'A', count: 2 }, { id: 'b', label: 'B', disabled: true }, { id: 'c', label: 'C <x>', count: 1, waiting: true }, { id: 'd', label: 'D' }];
  const html = S.tabBar({ tabs, selected: 'c' });
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-tab="c" aria-selected="true" tabindex="0"/);
  assert.match(html, /data-tab="a" aria-selected="false" tabindex="-1"/);
  assert.match(html, /data-tab="b"[^>]*aria-disabled="true"/);
  assert.match(html, /C &lt;x&gt; <span class="n blue">1<\/span>/, 'a waiting count is blue, and a label is text');
  assert.match(html, /A <span class="n">2<\/span>/);
  assert.match(S.tabBar({ tabs, selected: 'b' }), /data-tab="a" aria-selected="true"/, 'a disabled selection falls to the first enabled tab');
  assert.equal(S.tabStep(tabs, 'a', 'ArrowRight'), 'c', 'skips the disabled tab');
  assert.equal(S.tabStep(tabs, 'c', 'ArrowLeft'), 'a');
  assert.equal(S.tabStep(tabs, 'd', 'ArrowRight'), 'a', 'wraps');
  assert.equal(S.tabStep(tabs, 'a', 'ArrowLeft'), 'd', 'wraps back');
  assert.equal(S.tabStep(tabs, 'c', 'Home'), 'a');
  assert.equal(S.tabStep([{ id: 'x', disabled: true }, ...tabs.slice(0, 2)], 'a', 'Home'), 'a', 'Home skips a disabled first tab');
  assert.equal(S.tabStep(tabs, 'a', 'End'), 'd');
  assert.equal(S.tabStep(tabs, 'a', 'Enter'), null);
  assert.equal(S.tabStep(tabs, 'gone', 'ArrowRight'), 'a', 'from a tab that is gone, Right goes to the first');
  assert.equal(S.tabStep(tabs, 'gone', 'ArrowLeft'), 'd', 'and Left to the last');
  // bound: keys and clicks select through onSelect, focus the tab again after a redraw, never a disabled one
  const root = rootWith(html);
  let sel = 'c';
  const said = [];
  S.bindTabBar(root, { onSelect: (id) => { said.push(id); sel = id; root.innerHTML = S.tabBar({ tabs, selected: sel }); } });
  const tab = (id) => root.querySelectorAll('[role="tab"]').find((b) => b.dataset.tab === id);
  const k = fire(root, 'keydown', tab('c'), { key: 'ArrowRight' });
  assert.ok(k.defaultPrevented);
  assert.deepEqual(said, ['d']);
  assert.ok(tab('d').focused, 'the selected tab has focus after the redraw');
  fire(root, 'keydown', tab('d'), { key: 'ArrowRight' });
  fire(root, 'keydown', tab('a'), { key: 'ArrowRight' });
  fire(root, 'keydown', tab('c'), { key: 'Home' });
  fire(root, 'keydown', tab('a'), { key: 'End' });
  fire(root, 'keydown', tab('d'), { key: 'ArrowLeft' });
  assert.deepEqual(said, ['d', 'a', 'c', 'a', 'd', 'c']);
  fire(root, 'click', tab('b'));
  fire(root, 'keydown', tab('c'), { key: 'x' });
  assert.equal(said.length, 6, 'a disabled tab and another key select nothing');
  fire(root, 'click', tab('a').children.length ? tab('a').children[0] : tab('a'));
  assert.equal(said.at(-1), 'a', 'a click on an enabled tab (or inside it) selects it');
});

test('dbTable: numeric sort, a second press reverses, None when empty; onOpen gets the index as passed', () => {
  const rows = [['kit-10', '<b>ten</b>'], ['kit-2', 'two'], ['kit-1', 'one'], { cells: ['kit-x', 'x'], sort: ['kit-3', 'x'] }];
  const order = (html) => [...html.matchAll(/data-row="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(order(S.dbTable(['Id', 'Title'], rows)), [0, 1, 2, 3], 'unsorted: as passed');
  let sort = S.nextSort(null, 0);
  assert.deepEqual({ ...sort }, { col: 0, dir: 1 });
  const up = S.dbTable(['Id', { label: 'Title' }], rows, { sort });
  assert.deepEqual(order(up), [2, 1, 3, 0], 'numeric-aware: 1, 2, 3 (a sort key), 10');
  assert.match(up, /aria-sort="ascending"><button type="button" class="sort" data-col="0">Id ↑/);
  assert.match(up, /<tr class="click" data-row="2" tabindex="0"><td><div class="cell">kit-1<\/div><\/td>/, 'each row is focusable, its cells in .cell');
  sort = S.nextSort(sort, 0);
  assert.deepEqual(order(S.dbTable(['Id', 'Title'], rows, { sort })), [0, 3, 1, 2], 'the same column again reverses');
  assert.deepEqual({ ...S.nextSort(sort, 1) }, { col: 1, dir: 1 }, 'another column starts ascending');
  assert.deepEqual(order(S.dbTable(['Id', 'Title'], rows, { sort: { col: 1, dir: 1 } })), [2, 0, 1, 3], 'by the cell text, tags stripped: one, ten, two, x');
  assert.deepEqual(S.sortRows([['a'], ['a'], ['a']], { col: 0, dir: -1 }).map(([i]) => i), [0, 1, 2], 'stable');
  const none = S.dbTable(['Id', 'Title'], []);
  assert.match(none, /<tr class="none"><td colspan="2"><div class="cell">None<\/div><\/td><\/tr>/);
  assert.doesNotMatch(none, /data-row/);
  // bound, through a page that keeps the sort and redraws
  const root = rootWith('');
  let st = null;
  const opened = [];
  const draw = () => { root.innerHTML = S.dbTable(['Id', 'Title'], rows, { sort: st }); };
  draw();
  S.bindDbTable(root, { onSort: (c) => { st = S.nextSort(st, c); draw(); }, onOpen: (i) => opened.push(i) });
  const row = (n) => root.querySelectorAll('tr[data-row]')[n];
  fire(root, 'click', row(1).children[0].children[0]);
  assert.deepEqual(opened, [1], 'a click on a row opens its index');
  fire(root, 'click', root.querySelectorAll('button.sort')[0]);
  assert.equal(row(0).dataset.row, '2', 'sorted');
  fire(root, 'click', row(0));
  const ent = fire(root, 'keydown', row(3), { key: 'Enter' });
  assert.ok(ent.defaultPrevented);
  assert.deepEqual(opened, [1, 2, 0], 'after a sort, the index in rows as passed, on a click and on Enter');
  fire(root, 'click', root.querySelectorAll('button.sort')[0]);
  assert.equal(row(0).dataset.row, '0', 'a second press reverses');
  fire(root, 'keydown', row(0), { key: ' ' });
  fire(root, 'keydown', row(0).children[0], { key: 'Enter' });
  assert.deepEqual(opened, [1, 2, 0], 'other keys, and Enter not on the row itself, open nothing');
  root.innerHTML = S.dbTable(['Id'], [['<a href="#x">x</a>']]);
  fire(root, 'click', root.querySelectorAll('a')[0]);
  assert.deepEqual(opened, [1, 2, 0], "a link in a row is the link's");
  root.innerHTML = S.dbTable(['Id'], [['<button type="button">b</button>'], ['<label><input type="checkbox"> l</label>']]);
  fire(root, 'click', root.querySelectorAll('td button')[0]);
  fire(root, 'click', root.querySelectorAll('td label')[0]);
  fire(root, 'keydown', root.querySelectorAll('td button')[0], { key: 'Enter' });
  assert.deepEqual(opened, [1, 2, 0], "a button, a label or Enter on a control in a row is the control's");
  // numbers as numbers: decimals and negatives; a null sort key as empty
  const nums = [{ cells: ['a'], sort: ['1.5'] }, { cells: ['b'], sort: ['1.25'] }, { cells: ['c'], sort: ['-2'] }, { cells: ['d'], sort: [null] }, { cells: ['e'], sort: ['10'] }];
  assert.deepEqual(S.sortRows(nums, { col: 0, dir: 1 }).map(([i]) => i), [3, 2, 1, 0, 4], 'empty, -2, 1.25, 1.5, 10');
  // a mixed column is text throughout: the same order from any input order
  const mixed = ['1.9', '1.9a', '1.10'].map((k) => ({ cells: [k], sort: [k] }));
  const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0]].map((o) => S.sortRows(o.map((i) => mixed[i]), { col: 0, dir: 1 }).map(([, r]) => r.sort[0]).join(' '));
  assert.equal(new Set(orders).size, 1, `one order: ${orders.join(' | ')}`);
});

test('every builder escapes the text it is given, in attributes too', () => {
  const evil = `x"&<y>'z`;
  const esc = 'x&quot;&amp;&lt;y&gt;&#39;z';
  assert.equal(S.escHtml(evil), esc);
  const has = (html, what) => { assert.ok(html.includes(esc), `${what} escapes all five`); assert.ok(!html.includes(evil) && !html.includes('x"'), `${what} lets nothing raw through`); };
  has(S.tabBar({ tabs: [{ id: evil, label: evil, count: evil }], selected: evil }), 'tabBar (id, label, count)');
  has(S.dbTable([evil], []), 'dbTable (a column)');
  has(S.props([[evil, 'v', evil]]), 'props (a key and its tip)');
  has(S.goalSteps({ step: 3, built: { frac: 0.5, text: evil, title: evil } }), 'goalSteps (text and title)');
  has(S.heartbeat([{ day: '2026-11-02', items: [evil], failed: false }]), 'heartbeat (an item, in its title)');
  has(S.fleetSwitch({ scope: evil, mode: 'run', busy: evil }), 'fleetSwitch (scope and busy)');
  has(S.fleetSwitch({ mode: 'run', error: evil }), 'fleetSwitch (error)');
});

test('props, goalSteps and heartbeat render their fixtures', () => {
  assert.equal(S.props([['ID', '<code>k</code>', 'What Copy ID copies'], ['Status <x>', 'ok']]), '<dl class="props"><dt title="What Copy ID copies" tabindex="0">ID</dt><dd><code>k</code></dd><dt>Status &lt;x&gt;</dt><dd>ok</dd></dl>');
  const words = (html) => [...html.matchAll(/<li class="([^"]*)"[^>]*>([^<]+)/g)].map((m) => `${m[1] || '-'}:${m[2]}`);
  assert.deepEqual(words(S.goalSteps({ step: 0 })), ['now:Defining', '-:Planning', '-:Approval', '-:Built', '-:Met']);
  assert.deepEqual(words(S.goalSteps({ step: 2 })), ['done:Defined', 'done:Planned', 'now:Waiting on you', '-:Built', '-:Met']);
  const built = S.goalSteps({ step: 3, built: { frac: 0.4, text: '4 of 10 points' }, met: { frac: 0.25, text: '1 now → 4', title: 'Users: 1 now' } });
  assert.deepEqual(words(built), ['done:Defined', 'done:Planned', 'done:Approved', 'now:Building', 'part:Met']);
  assert.match(built, /<li class="now" style="--fill:40%" title="4 of 10 points">Building<span class="step-sub">4 of 10 points<\/span><\/li>/);
  assert.match(built, /<li class="part" style="--fill:25%" title="Users: 1 now">Met<span class="step-sub">1 now → 4<\/span>/);
  assert.deepEqual(words(S.goalSteps({ step: 4, built: { frac: 1, text: 'done' }, met: null })), ['done:Defined', 'done:Planned', 'done:Approved', 'done:Built', 'now:Met?']);
  assert.match(S.goalSteps({ step: 4, built: { frac: 1, text: 'done' } }), /<li class="done" title="done">Built<span class="step-sub">done<\/span>/, 'a done step is not refilled');
  assert.deepEqual(words(S.goalSteps({ step: 5 })), ['done:Defined', 'done:Planned', 'done:Approved', 'done:Built', 'done:Met']);
  // upkeep_days: 14 days, oldest first, today last
  const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(2 + i).padStart(2, '0')}`, items: [], failed: false }));
  days[3].items = ['chore merged'];
  days[9].items = ['chore merged', 'kit sync', 'retro', 'recurring check ran', 'chore merged'];
  days[11] = { ...days[11], items: ['recurring check failed: hub down'], failed: true };
  const hb = S.heartbeat(days);
  const cells = [...hb.matchAll(/<i class="([^"]*)" title="([^"]*)"><\/i>/g)];
  assert.equal(cells.length, 14);
  assert.equal(cells[0][1], '', 'a quiet day is empty');
  assert.match(cells[0][2], /: quiet$/);
  assert.equal(cells[3][1], 'l1');
  assert.equal(cells[9][1], 'l4', 'shade caps at 4');
  assert.match(cells[9][2], /chore merged, kit sync, retro, recurring check ran, chore merged$/, 'the hover lists the day');
  assert.equal(cells[11][1], 'bad', 'a failed day is red');
  assert.match(cells[13][2], /\(today\): quiet$/, 'today last');
  assert.match(hb, /<div class="hb-labels"><span>Nov 2<\/span><span>today<\/span><\/div>$/, 'the first day as the date it names, in any locale');
  assert.match(hb, /aria-label="Upkeep, the last 14 days"/);
});

// hub.html's STATES as it was before it moved into the block (kit main ad139e1), so a word or tone lost in the move fails
const HUB_STATES_BEFORE = {
  building: { label: 'Building', tone: 'green', rank: 3 },
  moving: { label: 'Moving', tone: 'blue', rank: 3 },
  blocked: { label: 'Fully blocked', tone: 'red', rank: 0 },
  waiting: { label: 'Waiting on you', tone: 'amber', rank: 1 },
  stalled: { label: 'Stalled', tone: 'red', rank: 0 },
  idle: { label: 'Idle', tone: '', rank: 4 },
  parked: { label: 'Parked', tone: '', rank: 4 },
  gone: { label: 'Not answering', tone: 'red', rank: 0 },
  starting: { label: 'Starting', tone: '', rank: 5 },
  unknown: { label: 'Running', tone: 'blue', rank: 3 },
};
test('statusPill: every pulse state as the hub draws it, and the hub draws from the block', () => {
  const hubStates = Object.keys(HUB_STATES_BEFORE);
  assert.deepEqual(JSON.parse(JSON.stringify(S.PULSE_STATES)), HUB_STATES_BEFORE, "the hub's table, moved unchanged");
  // the hub's card: el('span', `pill ${S.tone}`, S.label) with S = STATES[state], and STATES is the block's table
  const hubRest = without(HUB, 'devteam-shell-js');
  assert.match(hubRest, /^const STATES = PULSE_STATES;$/m);
  assert.match(hubRest, /el\('span', `pill \$\{S\.tone\}`, S\.label\)/);
  for (const st of hubStates) {
    const { label, tone } = HUB_STATES_BEFORE[st];
    assert.equal(S.statusPill(st), `<span class="pill${tone ? ` ${tone}` : ''}">${label}</span>`, st);
  }
  assert.equal(S.statusPill('blocked'), '<span class="pill red">Fully blocked</span>');
  assert.equal(S.statusPill('nonsense'), S.statusPill('unknown'));
  assert.equal(S.statusPill('toString'), S.statusPill('unknown'), 'an inherited name is unknown');
});

test('fleetSwitch: each mode, mixed, the confirm, busy and error; its binder calls each callback', () => {
  const pressed = (html) => [...html.matchAll(/data-fleet="(\w+)"[^>]*aria-pressed="true"/g)].map((m) => m[1]);
  assert.deepEqual(pressed(S.fleetSwitch({ mode: 'drain' })), ['drain']);
  assert.match(S.fleetSwitch({ scope: 'project', mode: 'run' }), /<span class="dot green"><\/span>Fleet<\/span>/);
  assert.match(S.fleetSwitch({ scope: 'row', mode: 'park' }), /<span class="dot "><\/span><\/span>/, 'a row has no label');
  const mixed = S.fleetSwitch({ scope: 'machine', mode: 'mixed', counts: { running: 3, draining: 1, parked: 2 } });
  assert.deepEqual(pressed(mixed), []);
  assert.match(mixed, /Mixed: 3 running, 1 draining, 2 parked/);
  assert.match(S.fleetSwitch({ scope: 'machine', mode: 'run' }), />Every fleet</);
  assert.match(S.fleetSwitch({ scope: 'project', mode: 'run', confirming: true }), /data-fleet="park" class="confirm" data-confirm="1"[^>]*>Confirm park</);
  assert.match(S.fleetSwitch({ scope: 'machine', mode: 'mixed', confirming: true, counts: { running: 3, draining: 1, parked: 1 } }), />Park 4 projects\?</, 'the projects it would park');
  assert.match(S.fleetSwitch({ scope: 'machine', mode: 'mixed', confirming: true, counts: { running: 1, parked: 4 } }), />Park 1 project\?</);
  const busy = S.fleetSwitch({ mode: 'run', busy: 'parking…', error: 'refused <b>' });
  assert.equal((busy.match(/ disabled>/g) || []).length, 3);
  assert.match(busy, /<span class="msg">parking…<\/span><span class="err">refused &lt;b&gt;<\/span>/);
  // bound
  const root = rootWith(S.fleetSwitch({ mode: 'run' }));
  const calls = [];
  S.bindFleetSwitch(root, { onPress: (m) => calls.push(`press:${m}`), onConfirm: (m) => calls.push(`confirm:${m}`), onCancel: () => calls.push('cancel') });
  const btn = (m) => root.querySelectorAll('[data-fleet]').find((b) => b.dataset.fleet === m);
  fire(root, 'click', btn('park'));
  fire(root, 'click', btn('drain'));
  fire(root, 'keydown', btn('run'), { key: 'Escape' });
  assert.deepEqual(calls, ['press:park', 'press:drain'], 'Escape cancels only a confirming switch');
  root.innerHTML = S.fleetSwitch({ mode: 'run', confirming: true });
  fire(root, 'click', btn('park'));
  fire(root, 'keydown', btn('run'), { key: 'Escape' });
  assert.deepEqual(calls, ['press:park', 'press:drain', 'confirm:park', 'cancel']);
  root.innerHTML = S.fleetSwitch({ mode: 'run', busy: 'working' });
  fire(root, 'click', btn('drain'));
  assert.equal(calls.length, 4, 'a busy switch takes no press');
});

test('pages and Threads tabs register once; a throwing tab shows its error', () => {
  const T = load();
  T.registerPage({ id: 'board', title: 'Board', group: 'project', icon: 'kanban', count: () => 3, render: () => {} });
  assert.throws(() => T.registerPage({ id: 'board', title: 'Again' }), /registered already/);
  assert.throws(() => T.registerPage({ id: 'a/b', title: 'X' }), /lower-case/);
  assert.deepEqual(JSON.parse(JSON.stringify(T.shellPages().map((p) => p.id))), ['board']);
  T.threadsTabs.register({ id: 'inbox', label: 'Inbox', count: () => 2, render: (el) => { el.innerHTML = 'cards'; } });
  T.threadsTabs.register({ id: 'bad', label: 'Bad', count: () => { throw new Error('x'); }, render: () => { throw new Error('it broke'); } });
  T.threadsTabs.register({ id: 'supervisor', label: 'Supervisor', disabled: true });
  assert.throws(() => T.threadsTabs.register({ id: 'inbox', label: 'Again' }), /registered already/);
  assert.deepEqual(JSON.parse(JSON.stringify(T.threadsTabs.list())), [{ id: 'inbox', label: 'Inbox', count: 2, disabled: false }, { id: 'bad', label: 'Bad', count: null, disabled: false }, { id: 'supervisor', label: 'Supervisor', count: null, disabled: true }]);
  const el = { innerHTML: '' };
  assert.equal(T.threadsTabs.render('bad', el), false);
  assert.match(el.innerHTML, /Bad could not draw: it broke/);
  assert.equal(T.threadsTabs.render('inbox', el), true);
  assert.equal(el.innerHTML, 'cards', 'the next tab still draws');
});

test("the router's table: page ids and link kinds disjoint, and every legacy head goes to its home page", () => {
  assert.deepEqual([...R.pages].sort(), ['board', 'goals', 'health', 'inbox', 'library', 'loop', 'overview', 'progress', 'retros', 'sensors', 'settings', 'trust']);
  for (const p of R.pages) { assert.doesNotMatch(p, /[/?]/); assert.ok(!Object.hasOwn(R.links, p), `${p} is not a link kind`); }
  // every link kind today's route() reads
  const route = INDEX.slice(INDEX.indexOf('function route()'), INDEX.indexOf('function hideDrawer()'));
  const kinds = new Set([...route.matchAll(/startsWith\('([a-z-]+)[/?]?'\)/g)].map((m) => m[1]));
  for (const m of route.match(/const PEEKS = \{([^}]*)\}/)[1].matchAll(/([a-z]+):/g)) kinds.add(m[1]);
  assert.ok(kinds.size >= 20, 'the kinds were read');
  for (const k of kinds) assert.ok(Object.hasOwn(R.links, k), `the table has ${k}`);
  const HOME = { ticket: 'board', feature: 'board', story: 'board', release: 'board', wave: 'board', milestone: 'board', planner: 'board', thread: 'board', goal: 'goals', q: 'overview', act: 'loop', decision: 'loop', lesson: 'loop', problem: 'loop', signal: 'loop', learning: 'loop', observation: 'loop', sensor: 'sensors', retro: 'retros', artifact: 'library', preview: 'library', review: 'library', 'review-preview': 'library', talk: 'overview' };
  for (const [k, home] of Object.entries(HOME)) {
    const p = S.parseHead(k === 'review-preview' ? '#review-preview?path=x' : `#${k}/some-id`, R);
    assert.equal(p.kind, k);
    assert.equal(p.home, home, `${k} opens over ${home}`);
  }
  assert.equal(S.parseHead('#artifact/main/the-mock', R).link, 'artifact/main/the-mock', 'the rest of a link is kept');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md&title=Quality', R).home, 'governance');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fprocess%2Fworker.md', R).home, 'governance');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fproject%2Fstrategy.md&title=Strategy', R).home, 'governance');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fproject%2Fdesigns%2Fx.md', R).home, 'library');
  assert.equal(S.parseHead('#nothing-here/x', R).home, 'overview', 'anything else over overview');
  // today's section anchors are page heads, and the two that move redirect
  for (const s of ['overview', 'goals', 'inbox', 'progress', 'board', 'library', 'loop', 'trust', 'retros']) assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead(`#${s}`, R))), { page: s, state: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#monitoring', R))), { page: 'sensors', state: {}, redirected: true });
  // until kit-93: Health is a page of its own, and Governance has none yet (it is over overview)
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#health', R))), { page: 'health', state: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#governance', R))), { page: 'overview', state: {} });
  // until kit-100: every page's Threads tab is the Inbox page
  for (const p of R.pages) assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead(`#${p}?th=inbox`, R))), { page: 'inbox', state: {}, redirected: true }, `${p}?th=inbox`);
  // the old Loop tab subjects are permanent redirects
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#loop/orient', R))), { page: 'loop', state: { lt: 'orient' }, redirected: true });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#loop/observe', R))), { page: 'loop', state: {}, redirected: true });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('', R))), { page: 'overview', state: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#questions', R))), { page: 'inbox', state: {}, redirected: true }, "today's Inbox list anchor (until kit-100)");
});

test('parseHead and headFor round-trip every page head and link head', () => {
  const heads = ['#overview', '#overview?th=open&t=t-1', '#board?goal=g-1&feat=f&repo=kit&att=1&th=resolved', '#progress?goal=g-1&narrow=features&show=all', '#library?kind=Mock&goal=g-2', '#goals?gt=met', '#goals?gt=letgo', '#sensors?st=fleet', '#loop?lt=orient&kind=lesson&orient=1', '#trust', '#retros', '#settings', '#inbox'];
  // ?th=inbox on a page redirects to the Inbox page (until kit-100), so it is not a round-trip head
  for (const p of R.pages) heads.push(`#${p}`, `#${p}?th=open&t=t-20261115-1`);
  for (const k of Object.keys(R.links)) heads.push(k === 'review-preview' ? '#review-preview?path=a.html&ref=ticket%2Fx' : `#${k}/an-id`);
  heads.push('#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md&title=Quality&ref=main', '#artifact/main/slug', '#talk/t-1');
  for (const h of heads) assert.equal(S.headFor(S.parseHead(h, R)), h, h);
  // parseHead keeps only the page's own keys; headFor writes them in STATE_KEYS order, whatever order it is given
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#goals?goal=g&gt=met&lt=act', R))), { page: 'goals', state: { gt: 'met' } });
  assert.equal(S.headFor({ page: 'board', state: { t: 'x', att: '1', goal: 'g' } }), '#board?goal=g&att=1&t=x');
  // only the page's own keys survive, in canonical order
  assert.equal(S.headFor(S.parseHead('#board?t=x&repo=r&gt=met&goal=g', R)), '#board?goal=g&repo=r&t=x');
  assert.equal(S.headFor({ page: 'board', state: { goal: 'a b&c' } }), '#board?goal=a+b%26c');
  assert.equal(S.parseHead(S.headFor({ page: 'board', state: { goal: 'a b&c' } }), R).state.goal, 'a b&c');
});

test('stampFor, closeTarget and rememberedFilters', () => {
  const plain = (o) => JSON.parse(JSON.stringify(o));
  // a page entry, then a peek from it, then a peek from that peek
  const pg = S.stampFor({ hash: '#progress?goal=g-1', state: null }, null, false, R);
  assert.deepEqual(plain(pg), { page: '#progress?goal=g-1', depth: 0, openedHere: true });
  const p1 = S.stampFor({ hash: '#ticket/kit-1', state: null }, pg, false, R);
  assert.deepEqual(plain(p1), { page: '#progress?goal=g-1', depth: 1, openedHere: true }, 'a peek from a page: depth 1, over that page');
  const p2 = S.stampFor({ hash: '#goal/g-1', state: null }, p1, false, R);
  assert.deepEqual(plain(p2), { page: '#progress?goal=g-1', depth: 2, openedHere: true }, 'a peek from a peek: depth + 1, the same page');
  // a peek opened from a cold-loaded peek: the entry below wasn't pushed in this visit, so it closes in place
  const cold1 = S.stampFor({ hash: '#ticket/kit-1', state: null }, null, true, R);
  const cold2 = S.stampFor({ hash: '#goal/g-1', state: null }, cold1, false, R);
  assert.deepEqual(plain(cold2), { page: '#board', depth: 2, openedHere: false });
  assert.deepEqual(plain(S.closeTarget(cold2)), { replace: '#board' });
  assert.deepEqual(plain(S.stampFor({ hash: '#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md', state: null }, null, true, R)), { page: '#overview', depth: 1, openedHere: false }, 'a cold file link by its path (governance is no page until kit-93, so over overview)');
  assert.deepEqual(plain(S.stampFor({ hash: '#file?path=docs%2Fx.md', state: null }, null, true, R)), { page: '#library', depth: 1, openedHere: false });
  // Threads changing under an open peek: the same entry, its page head updated
  assert.deepEqual(plain(S.withPage(p1, '#progress?goal=g-1&th=open')), { page: '#progress?goal=g-1&th=open', depth: 1, openedHere: true });
  // a cold load
  assert.deepEqual(plain(S.stampFor({ hash: '#ticket/kit-1', state: null }, null, true, R)), { page: '#board', depth: 1, openedHere: false }, "a cold link opens over its kind's home page");
  assert.deepEqual(plain(S.stampFor({ hash: '#lesson/k-1', state: null }, pg, true, R)), { page: '#loop', depth: 1, openedHere: false });
  assert.deepEqual(plain(S.stampFor({ hash: '#board', state: null }, null, true, R)), { page: '#board', depth: 0, openedHere: false });
  // a reload or Back keeps the entry's own stamp
  const kept = { page: '#trust', depth: 1, openedHere: true };
  assert.equal(S.stampFor({ hash: '#ticket/kit-1', state: kept }, pg, true, R), kept);
  // closing
  assert.deepEqual(plain(S.closeTarget(p2)), { go: -2 });
  assert.deepEqual(plain(S.closeTarget(p1)), { go: -1 });
  assert.deepEqual(plain(S.closeTarget({ page: '#board', depth: 1, openedHere: false })), { replace: '#board' });
  assert.deepEqual(plain(S.closeTarget({ page: '#progress?goal=g', depth: 3, openedHere: false })), { replace: '#progress?goal=g' }, 'never Overview by default');
  // remembered filters
  const stored = { goal: 'g-1', feat: 'f-1', repo: 'kit', att: '1', kind: 'Mock' };
  assert.deepEqual(plain(S.rememberedFilters('board', [], true, stored)), { goal: 'g-1', feat: 'f-1', repo: 'kit', att: '1' });
  assert.deepEqual(plain(S.rememberedFilters('progress', [], true, stored)), { goal: 'g-1' }, 'only its own keys');
  assert.deepEqual(plain(S.rememberedFilters('library', ['th'], true, stored)), { goal: 'g-1', kind: 'Mock' }, 'th is not a filter');
  assert.equal(S.rememberedFilters('board', [], false, stored), null, 'Back or Forward shows its own keys');
  assert.equal(S.rememberedFilters('board', ['repo'], true, stored), null, 'a fresh entry with a filter key keeps it');
  assert.equal(S.rememberedFilters('loop', [], true, stored), null, "Self Improvement's filters are never remembered");
  assert.equal(S.rememberedFilters('overview', [], true, stored), null);
  assert.equal(S.rememberedFilters('board', [], true, {}), null);
  // the store: through localStorage, and a throwing one gives null and takes nothing
  const mem = {};
  const L = load({ localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } } });
  L.saveFilters('board', { goal: 'g-2', repo: 'kit', th: 'open' });
  L.saveFilters('loop', { kind: 'lesson' });
  assert.deepEqual(JSON.parse(mem['devteam.board.filters']), { goal: 'g-2', repo: 'kit' }, "one flat object, only a page's own keys");
  assert.deepEqual(plain(L.rememberedFilters('progress', [], true)), { goal: 'g-2' }, 'the goal is shared');
  L.saveFilters('library', { kind: 'Mock', goal: 'g-2' });
  L.saveFilters('board', { goal: 'g-2' });
  assert.deepEqual(JSON.parse(mem['devteam.board.filters']), { goal: 'g-2', kind: 'Mock' }, "a cleared filter is cleared, another page's kept");
  assert.equal(L.rememberedFilters('board', [], true).repo, undefined, 'and stays cleared');
  L.saveFilters('progress', {});
  assert.deepEqual(JSON.parse(mem['devteam.board.filters']), { kind: 'Mock' }, 'clearing the goal on one page clears it for all three');
  const X = load({ localStorage: { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } } });
  assert.equal(X.rememberedFilters('board', [], true), null);
  assert.doesNotThrow(() => X.saveFilters('board', { goal: 'g' }));
  assert.equal(load().rememberedFilters('board', [], true), null, 'no localStorage at all');
});

// ---- the measure check, proven on the fixture page (headless Chrome) ----
const FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'dashboard-shell.html'), 'utf8');
const filled = () => FIXTURE
  .replace('/* slot: devteam-ui tokens */', () => block(INDEX, 'devteam-ui tokens'))
  .replace('/* slot: devteam-layout */', () => LAYOUT)
  .replace('/* slot: devteam-shell-js */', () => JS);
// one way to break each check, run in the loaded fixture
const BREAK = {
  prose: "document.querySelector('#right p').style.maxWidth = 'none'; document.querySelector('#pair').style.gridTemplateColumns = '1fr'; document.querySelectorAll('#pair > *').forEach((c) => { c.style.gridColumn = 'span 1'; });",
  overflow: "document.querySelector('#small p').style.width = '2000px';",
  uneven: "document.querySelector('#left').style.alignSelf = 'start';",
  'head-end': "document.querySelector('#left .card-head .end').style.marginRight = '30px';",
  'page-top': "document.querySelector('#view').style.paddingTop = '60px';",
  'head-h': "document.querySelector('#small .card-head').style.height = '36px';",
  'header-pad': "document.querySelector('.pagebar').style.paddingLeft = '24px';",
  'tab-motion': "const s = document.createElement('style'); s.textContent = '.shell .tabbar [role=tab]::after { transition: visibility .2s; }'; document.head.append(s);",
};

const EXTRA = [
  ['overflow', "document.querySelector('#small p').style.marginLeft = '-60px';"],
  ['header-pad', "document.querySelector('.pagebar').style.paddingRight = '24px';"],
];
// a page's own prose and ignore add to the defaults
test('measure options: a page adds to prose and ignore', async () => {
  let got = null;
  await measure({ ev: async (x) => { got = x; return []; } }, { prose: '.turn .tx', ignore: '.mine' });
  const o = JSON.parse(got.slice(got.lastIndexOf(')(') + 2, -1));
  assert.match(o.prose, /^p, \.ctx, .*, \.turn \.tx$/);
  assert.match(o.ignore, /\.no-shell, \.mine$/);
});

test('the measure: every check passes on the fixture at three sizes and fails on a broken copy', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  assert.deepEqual(Object.keys(BREAK).sort(), [...CHECKS].sort(), 'a break for every check');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-shell-'));
  const later = cleanup(t);
  later(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dashboard-shell.html');
  fs.writeFileSync(file, filled());
  const url = `file://${file}`;
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const res = await measureAt(p, url, { ready: 'window.__ready' });
  assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
  for (const [size, fails] of Object.entries(res)) assert.deepEqual(fails, [], `the fixture at ${size}`);
  // the c6 pair side by side at 720
  await p.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url });
  const soon = async (expr) => { for (let i = 0; i < 300; i++) { if (await p.ev(expr).catch(() => false)) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(expr); };
  await soon('window.__ready === true');
  const pair = await p.ev("(() => { const a = document.querySelector('#left').getBoundingClientRect(), b = document.querySelector('#right').getBoundingClientRect(); return { top: Math.abs(a.top - b.top), side: a.right <= b.left, h: Math.abs(a.height - b.height) }; })()");
  assert.ok(pair.top < 1 && pair.side, `the c6 pair is side by side at 720: ${JSON.stringify(pair)}`);
  // the lower boundary: nothing in the block styles a .no-shell region, while the same names outside it are styled
  const fenced = await p.ev("(() => { const cs = (s, pe) => getComputedStyle(document.querySelector(s), pe); return { card: cs('#fenced .card').borderTopStyle, head: cs('#fenced .card-head').height, headLine: cs('#fenced .card-head').borderBottomStyle, pill: cs('#fenced .pill').display, dot: cs('#fenced .pill', '::before').content, seg: cs('#fenced .seg').display, shellHead: cs('#small .card-head').height, shellPill: cs('#peek .pill').display }; })()");
  assert.deepEqual(fenced, { card: 'none', head: fenced.head, headLine: 'none', pill: 'inline', dot: 'none', seg: 'inline', shellHead: '41px', shellPill: 'inline-flex' });
  assert.notEqual(fenced.head, '41px');
  // reduced motion: the red dot stops pulsing
  const pulse = () => p.ev("getComputedStyle(document.querySelector('#peek .dot.red.pulse')).animationName");
  assert.equal(await pulse(), 'shell-ring', 'the red dot pulses');
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await pulse(), 'none', 'and stops under reduced motion');
  assert.equal(await p.ev("getComputedStyle(document.documentElement).getPropertyValue('--dur').trim()"), '0ms');
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  // each check fails, by its name, on a broken copy (two for overflow and header-pad: either side)
  for (const [check, script] of [...Object.entries(BREAK), ...EXTRA]) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.navigate', { url });
    await soon('window.__ready === true');
    assert.deepEqual(await measure(p), [], `clean before breaking ${check}`);
    await p.ev(`(() => { ${script} })()`);
    await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const fails = await measure(p);
    assert.ok(fails.some((f) => f.startsWith(`${check}: `)), `${check} fails on its broken copy: ${JSON.stringify(fails)}`);
  }
});
