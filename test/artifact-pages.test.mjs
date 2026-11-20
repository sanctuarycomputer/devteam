// Pins per page (kit-142): inside an artifact, a note's pin shows only on the page or view it was placed
// on. The artifact lens reports each move of its page (nav: a #hash, pushState, replaceState, popstate, or
// its 500 ms check), counts a match it finds but that isn't shown as not found, and takes a go order to a
// #hash; the viewer keeps the page's hash (TS.hash), records it in a note placed on empty page, compares it
// for such notes only, and counts each move for the close. The lens is checked in vm against a stand-in
// page (C4 to C7), the kit's subject rules against today's and earlier releases (C8), the guidance (C9),
// and the viewer in headless Chrome against a real dashboard on the shared harness
// (fixtures/artifact-viewer/harness.mjs), with this ticket's own artifact `pages` landed beside its
// (C1 to C4), skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kit, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup } from './lib/chrome.mjs';
import { harness, J, FRAMES, VIEWER_UP } from './fixtures/artifact-viewer/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(kit, '..', '..');
const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const SRC = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
const LENS = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC)[1];
const ANCESTOR = 'http://127.0.0.1:4321';

// --- the lens in vm ---------------------------------------------------------------------------------
// A stand-in element: a box, whether it is shown (checkVisibility, or for a browser without it, client
// rects and the computed visibility), and the calls it got.
function el(tag, { text = '', rect = { x: 10, y: 10, w: 100, h: 20 }, display = true, visibility = 'visible', noCheck = false } = {}) {
  const e = {
    nodeType: 1, localName: tag, textContent: text, scrolled: 0, _vis: visibility,
    getBoundingClientRect: () => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }),
    getClientRects: () => (display ? [rect] : []),
    scrollIntoView() { this.scrolled += 1; },
  };
  if (!noCheck) e.checkVisibility = (o) => display && !(o && o.visibilityProperty && /^(hidden|collapse)$/.test(visibility));
  return e;
}
// The lens's script, run against a stand-in window: a location and a history it moves (pushState and
// replaceState take a path or a #hash), its listeners, its intervals and animation frames run when the test
// says, and what it posts to its parent. by: { '#sel': element } for querySelector, tags: { tag: [elements] }.
function lens({ pathname = '/artifact/main/viewer-mock/index.html', hash = '', by = {}, tags = {}, history = true } = {}) {
  const listeners = {};
  const posted = [];
  const frames = [];
  const intervals = [];
  const parent = { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) };
  const location = { pathname, hash, ancestorOrigins: [ANCESTOR] };
  const moveTo = (url) => {
    if (url === undefined || url === null) return;
    const u = String(url), i = u.indexOf('#');
    const p = i === -1 ? u : u.slice(0, i);
    if (p) location.pathname = p;
    location.hash = i === -1 || i === u.length - 1 ? '' : u.slice(i);
  };
  const hist = { pushState: (s, t, u) => moveTo(u), replaceState: (s, t, u) => moveTo(u) };
  const doc = { title: 'A mock', documentElement: {}, body: {}, activeElement: null, elementFromPoint: () => null, querySelectorAll: (s) => (by[s] ? [by[s]] : []), querySelector: (s) => by[s] ?? null, getElementsByTagName: (t) => tags[t] ?? [], getElementById: () => null };
  const win = {
    document: doc, parent, location, innerWidth: 800, innerHeight: 600,
    addEventListener: (type, f) => { (listeners[type] ??= []).push(f); },
    setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, setTimeout: () => 0, clearTimeout: () => {},
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    getComputedStyle: (e) => ({ visibility: e._vis ?? 'visible', overflowX: '', overflowY: '' }),
    MutationObserver: class { observe() {} }, TextEncoder, CSS: { escape: (s) => s },
  };
  if (history) win.history = hist;
  win.window = win;
  vm.runInNewContext(LENS, win);
  const fire = (type, ev = {}) => { for (const f of listeners[type] ?? []) f({ type, ...ev }); };
  const hear = (m) => fire('message', { data: { lens: 1, ...m }, source: parent, isTrusted: true, origin: ANCESTOR });
  // every animation frame asked for so far, and those they ask for, once
  const frame = () => { const now = frames.splice(0); for (const f of now) f(0); };
  const tick = (ms) => { for (const i of intervals) if (i.ms === ms) i.f(); };
  const navs = () => posted.filter((m) => m.type === 'nav').map(({ path: p, hash: h }) => ({ path: p, hash: h }));
  return { win, location, posted, hear, fire, frame, tick, navs, hist };
}
const P = '/artifact/main/viewer-mock/';

test('C4: the lens tells each move of its page as nav {path, hash}, once a frame, and nothing when nothing moved', () => {
  const L = lens();
  L.hear({ type: 'hello' });
  assert.equal(L.posted[0].type, 'ready');
  // a hash move
  L.location.hash = '#tab2';
  L.fire('hashchange');
  L.frame();
  assert.deepEqual(L.navs(), [{ path: `${P}index.html`, hash: '#tab2' }], 'nav after hashchange');
  // the same event again, nothing moved: nothing
  L.fire('hashchange');
  L.frame();
  assert.equal(L.navs().length, 1, 'no nav when neither path nor hash changed');
  // popstate (a back in the page's own history)
  L.location.hash = '';
  L.fire('popstate');
  L.frame();
  assert.deepEqual(L.navs()[1], { path: `${P}index.html`, hash: '' }, 'nav after popstate');
  // pushState and replaceState, through the page's own history object
  L.win.history.pushState({}, '', `${P}other.html`);
  L.frame();
  assert.deepEqual(L.navs()[2], { path: `${P}other.html`, hash: '' }, 'nav after pushState');
  L.win.history.replaceState({}, '', '#annual');
  L.frame();
  assert.deepEqual(L.navs()[3], { path: `${P}other.html`, hash: '#annual' }, 'nav after replaceState');
  assert.equal(L.location.hash, '#annual', 'the wrapped replaceState still did what the page asked');
  // two moves in one frame: one nav, the latest
  L.win.history.pushState({}, '', '#one');
  L.win.history.pushState({}, '', '#two');
  L.frame();
  assert.deepEqual(L.navs().slice(4), [{ path: `${P}other.html`, hash: '#two' }], 'at most one nav a frame');
  // the 500 ms check, with nothing moved: nothing
  L.tick(500);
  L.frame();
  assert.equal(L.navs().length, 5, 'the check sends nothing when nothing moved');
  // a page that replaced history.pushState with its own, which never calls the lens's: the check sees it
  L.win.history.pushState = (s, t, u) => { L.location.hash = String(u); };
  L.win.history.pushState({}, '', '#mine');
  L.frame();
  assert.equal(L.navs().length, 5, 'its own pushState tells nothing by itself');
  L.tick(500);
  L.frame();
  assert.deepEqual(L.navs()[5], { path: `${P}other.html`, hash: '#mine' }, 'the 500 ms check tells it');
  // before the viewer's hello, nothing is told
  const Q = lens();
  Q.location.hash = '#x';
  Q.fire('hashchange');
  Q.tick(500);
  Q.frame();
  assert.deepEqual(Q.posted, [], 'no nav before hello');
  // a page with no history object still has a lens: it answers hello and its check still runs
  const N = lens({ history: false });
  N.hear({ type: 'hello' });
  assert.equal(N.posted[0]?.type, 'ready', 'no history: the lens still answers');
  N.location.hash = '#y';
  N.tick(500);
  N.frame();
  assert.deepEqual(N.navs(), [{ path: `${P}index.html`, hash: '#y' }], 'no history: the check tells a move');
});

test('C5: the lens counts a match that is not shown as not found, and prefers a shown one by tag and text', () => {
  const shown = el('button', { text: 'Buy', rect: { x: 10, y: 10, w: 100, h: 20 } });
  const none = el('button', { text: 'Buy', display: false });
  const hidden = el('button', { text: 'Buy', visibility: 'hidden', noCheck: true });
  const empty = el('button', { text: 'Buy', rect: { x: 5, y: 5, w: 0, h: 0 } });
  // a wide box with no height (a collapsed container) is still shown: only a box with no size at all is hidden
  const flat = el('div', { text: 'Buy', rect: { x: 5, y: 5, w: 200, h: 0 } });
  const L = lens({ by: { '#shown': shown, '#none': none, '#hidden': hidden, '#empty': empty, '#flat': flat } });
  L.hear({ type: 'hello' });
  const anchor = (selector) => ({ selector, tag: 'button', text: 'Buy', rect: { x: 10, y: 10, w: 100, h: 20 } });
  L.hear({ type: 'resolve', id: 'r1', anchors: ['#shown', '#none', '#hidden', '#empty', '#flat', '#absent'].map((s) => ({ key: s, anchor: anchor(s) })) });
  const said = Object.fromEntries(L.posted.find((m) => m.type === 'rects' && m.id === 'r1').rects.map((r) => [r.key, r]));
  const rects = Object.fromEntries(Object.entries(said).map(([k, r]) => [k, r.rect]));
  // find's mark, on the wire: hidden for a match not shown, never for no match (kit-147's shooter tells them apart)
  for (const k of ['#none', '#hidden', '#empty']) assert.equal(said[k].hidden, true, `${k}: marked hidden`);
  for (const k of ['#shown', '#flat', '#absent']) assert.equal(said[k].hidden, undefined, `${k}: not marked hidden`);
  assert.equal(rects['#absent'], null, 'no match: rect null');
  assert.deepEqual(rects['#flat'], { x: 5, y: 5, w: 200, h: 0 }, 'a 200x0 box is shown');
  assert.deepEqual(rects['#shown'], { x: 10, y: 10, w: 100, h: 20 }, 'a shown element: its rect');
  assert.equal(rects['#none'], null, 'display:none: rect null');
  assert.equal(rects['#hidden'], null, 'visibility:hidden (no checkVisibility): rect null');
  assert.equal(rects['#empty'], null, 'a zero-size box: rect null');
  // find still returns it: scroll-to reaches the element
  L.hear({ type: 'scroll-to', anchor: anchor('#none') });
  assert.equal(none.scrolled, 1, 'find returned the hidden element (marked, not dropped)');
  // by tag and text: a hidden match where it was, a shown one far away: the shown one
  const near = el('button', { text: 'Pay', rect: { x: 0, y: 0, w: 80, h: 20 }, display: false });
  const far = el('button', { text: 'Pay', rect: { x: 500, y: 400, w: 80, h: 20 } });
  const M = lens({ tags: { button: [near, far] } });
  M.hear({ type: 'hello' });
  M.hear({ type: 'resolve', id: 'r2', anchors: [{ key: 'k', anchor: { selector: '#gone', tag: 'button', text: 'Pay', rect: { x: 0, y: 0, w: 80, h: 20 } } }] });
  assert.deepEqual(M.posted.find((m) => m.id === 'r2').rects[0].rect, { x: 500, y: 400, w: 80, h: 20 }, 'the nearest shown match wins over a nearer hidden one');
  // only a hidden one: it is found but reported as not shown
  const O = lens({ tags: { button: [near] } });
  O.hear({ type: 'hello' });
  O.hear({ type: 'resolve', id: 'r3', anchors: [{ key: 'k', anchor: { selector: '#gone', tag: 'button', text: 'Pay', rect: { x: 0, y: 0, w: 80, h: 20 } } }] });
  assert.deepEqual(O.posted.find((m) => m.id === 'r3').rects[0], { key: 'k', rect: null, hidden: true }, 'a hidden match alone: rect null, marked hidden');
});

test('C6: the lens\'s go order sets location.hash to a #hash of at most 200 bytes, and ignores anything else', () => {
  const L = lens();
  L.hear({ type: 'hello' });
  L.hear({ type: 'go', hash: '#tab2' });
  assert.equal(L.location.hash, '#tab2', 'go #tab2 sets the hash');
  for (const bad of ['tab2', 'javascript:x', `#${'x'.repeat(200)}`, 7, null, undefined]) {
    L.hear({ type: 'go', hash: bad });
    assert.equal(L.location.hash, '#tab2', `ignored: ${J(bad)?.slice(0, 20)}`);
  }
  L.hear({ type: 'go' });
  assert.equal(L.location.hash, '#tab2', 'ignored: no hash');
  const max = `#${'y'.repeat(199)}`;
  L.hear({ type: 'go', hash: max });
  assert.equal(L.location.hash, max, 'a 200-byte hash is set');
});

test('C7: a box capability in the hash is cut from ready and nav, as from the path; the hash is cut to 200 bytes', () => {
  // the existing unCap fixture's capability (test/dashboard.artifacts.test.mjs's), in the frame's own address
  const pathname = '/c/1.abc.def/artifact/main/viewer-mock/index.html';
  const L = lens({ pathname, hash: '#see/c/1.abc.def/artifact/main/x' });
  L.hear({ type: 'hello' });
  assert.equal(L.posted[0].type, 'ready');
  assert.equal(L.posted[0].hash, '#see/artifact/main/x', 'ready carries the hash, the token cut');
  assert.equal(L.posted[0].path, '/artifact/main/viewer-mock/index.html');
  L.location.hash = '#to%2Fc%2F1.abc.def%2Fartifact';
  L.fire('hashchange');
  L.frame();
  assert.deepEqual(L.navs(), [{ path: '/artifact/main/viewer-mock/index.html', hash: '#to%2Fartifact' }], 'nav: the token cut, percent-encoded too');
  assert.ok(L.posted.every((m) => !/abc(\.|%2e)def/i.test(J(m))), 'no message carries the token');
  // over 200 bytes: cut, never half a character
  L.location.hash = `#${'é'.repeat(150)}`;
  L.fire('hashchange');
  L.frame();
  const h = L.navs()[1].hash;
  assert.ok(Buffer.byteLength(h) <= 200 && Buffer.byteLength(h) >= 199 && h === `#${'é'.repeat(99)}`, `cut to 200 bytes: ${Buffer.byteLength(h)}`);
  // a page with no hash: ready as it always was
  const N = lens();
  N.hear({ type: 'hello' });
  assert.deepEqual(N.posted[0], { lens: 1, type: 'ready', path: '/artifact/main/viewer-mock/index.html', title: 'A mock', viewport: { w: 800, h: 600 } }, 'no hash: ready unchanged');
});

// --- the kit's subject rules, today's and the releases' ----------------------------------------------
// subjectProblem as a release's kit has it: its own source, from SUBJECT_TYPES to threadLineProblems, with
// the one-line constants it reads, run in vm.
function subjectProblemOf(src) {
  const from = src.indexOf('\nconst SUBJECT_TYPES = '), to = src.indexOf('\nfunction threadLineProblems(');
  assert.ok(from > 0 && to > from, 'the subject rules found in the source');
  const one = (name) => { const m = new RegExp(`^const ${name} = .*$`, 'm').exec(src); assert.ok(m, `${name} found`); return m[0]; };
  const head = ['isObj', 'SUBJECT_MAX', 'ARTIFACT_AT', 'UNSAFE_TEXT', 'LINK_ID', 'PREVIEW_NAME'].map(one).join('\n');
  const ctx = { Buffer };
  vm.runInNewContext(`${head}\n${src.slice(from, to)}\n;globalThis.subjectProblem = subjectProblem;`, ctx);
  return ctx.subjectProblem;
}
// A release's kit source, from its tag: a shallow CI checkout has no tags, so the one needed is fetched
// (as test/lib/machine-fixture.mjs's kitAt does); null when it can't be had.
function sourceAt(tag) {
  const has = () => spawnSync('git', ['rev-parse', '--verify', '-q', `${tag}^{commit}`], { cwd: REPO }).status === 0;
  if (!has()) spawnSync('git', ['fetch', '-q', '--depth=1', 'origin', 'tag', tag], { cwd: REPO, stdio: 'ignore', timeout: 60000 });
  if (!has()) return null;
  const r = spawnSync('git', ['show', `${tag}:docs/devteam/scripts/devteam.mjs`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
// the newest vX.Y.Z tag on origin
function newestRelease() {
  const r = spawnSync('git', ['ls-remote', '--tags', '--refs', 'origin', 'v*'], { cwd: REPO, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) return null;
  const tags = r.stdout.split('\n').map((l) => /refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(l)?.[1]).filter(Boolean);
  const n = (t) => t.slice(1).split('.').map(Number);
  tags.sort((a, b) => { const x = n(a), y = n(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  return tags.pop() ?? null;
}
// what this kit's viewer writes (tsSubject): a note on empty page of a view, and one on an element
const WRITTEN = [
  { kind: 'artifact', slug: 'pages', at: 'main', fp: 'abcdef012345', path: 'a.html#tab2', point: { x: 600, y: 60 } },
  { kind: 'artifact', slug: 'pages', at: 'main', path: 'a.html', anchor: { selector: '#only-tab1', tag: 'button', role: 'button', text: 'Plan A', name: 'Plan A', html: '<button id="only-tab1">Plan A</button>', rect: { x: 40, y: 200, w: 160, h: 40 }, point: { x: 10, y: 10 } }, point: { x: 50, y: 210 } },
];

test('C8: a path with a #hash is a subject this kit and earlier releases accept; one over 300 bytes is refused', (t) => {
  const F = threadsFixture('artifact-pages-subject');
  cleanup(t)(() => F.done());
  const id = F.owner(['thread', 'new', 'On the second view', '--subject', J(WRITTEN[0])]).split('\n')[0].trim();
  assert.equal(JSON.parse(F.owner(['thread', 'show', id, '--json'])).subject.path, 'a.html#tab2', 'thread new keeps the hash in the path');
  const said = F.fails(['thread', 'new', 'Too long', '--subject', J({ ...WRITTEN[0], path: `a.html#${'x'.repeat(294)}` })]);
  assert.match(said, /path is 301 bytes; at most 300/, 'a 301-byte path is refused as today');
  // today's kit, by the same extraction: the extraction itself works
  for (const s of WRITTEN) assert.equal(subjectProblemOf(SRC)(s), null, `today's kit: ${s.path}`);
  const tags = ['v0.51.0', 'v0.52.0'];
  const newest = newestRelease();
  if (newest) tags.push(newest);
  else if (process.env.CI) assert.fail('the newest release tag could not be listed from origin');
  for (const tag of tags) {
    const src = sourceAt(tag);
    if (!src) {
      if (process.env.CI) assert.fail(`${tag} could not be fetched`);
      t.diagnostic(`${tag} not available here: skipped`);
      continue;
    }
    const problem = subjectProblemOf(src);
    for (const s of WRITTEN) assert.equal(problem(s), null, `${tag} accepts ${s.path}`);
    assert.match(problem({ ...WRITTEN[0], path: 'x'.repeat(301) }) ?? '', /at most 300/, `${tag} still refuses 301 bytes (the extraction is its real rule)`);
  }
});

test('C9: supervisor.md §9 Artifacts asks for a file or a #hash per view', () => {
  const doc = fs.readFileSync(path.join(kit, 'process/supervisor.md'), 'utf8');
  const sec = /\n### Artifacts: pages that show an idea\n([\s\S]*?)\n## /.exec(doc)?.[1] ?? '';
  assert.ok(sec, 'the section found');
  assert.ok(sec.includes('A page with more than one view gives each its own file or `#hash`, so pins follow it.'), 'the line on views');
});

// --- the viewer, in Chrome --------------------------------------------------------------------------
// This ticket's artifact, landed on main beside the harness's, and its threads in today's shape.
function landPages(F) {
  fs.cpSync(path.join(HERE, 'fixtures/artifact-pages/pages'), path.join(F.old, 'docs/devteam/project/artifacts/pages'), { recursive: true });
  F.g(['add', '-A', 'docs'], F.old);
  F.g(['commit', '-qm', 'artifacts: pages'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const note = (title, subject) => F.owner(['thread', 'new', title, '--subject', J({ kind: 'artifact', slug: 'pages', at: 'main', ...subject })]).split('\n')[0].trim();
  return {
    // on an element of a.html's first view
    TE: note('Plan A', { path: 'a.html', anchor: { selector: '#only-tab1', tag: 'button', text: 'Plan A', point: { x: 20, y: 10 } } }),
    // on an element of a.html in both views (an old element note follows its element)
    TAL: note('Pricing', { path: 'a.html', anchor: { selector: '#always', tag: 'h2', text: 'Pricing', point: { x: 20, y: 10 } } }),
    // on empty page of a.html, placed on #tab2
    TP2: note('Empty, second view', { path: 'a.html#tab2', point: { x: 600, y: 60 } }),
    // on empty page of a.html, an old one with no hash
    TP: note('Empty, old', { path: 'a.html', point: { x: 600, y: 160 } }),
    // on an element of b.html
    TB: note('Section one', { path: 'b.html', anchor: { selector: '#b-el', tag: 'button', text: 'Section one', point: { x: 20, y: 10 } } }),
  };
}
const PINS = "[...document.querySelectorAll('#av-pins [data-tl-pin]')].map((b) => b.dataset.tlPin).sort()";
const AV_P = '#artifact/main/pages';

test('the viewer: pins per page and view, the close after a move inside the frame, one redraw a frame', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { F, visit, sub } = await harness(t, 'artifact-pages');
  const N = landPages(F);
  // the stage's pins are exactly these, within ms (the lens's answers take a moment)
  const pinsAre = async (V, ids, what) => {
    const want = J([...ids].sort());
    const ok = await V.settle(`JSON.stringify(${PINS}) === ${J(want)}`, 8000);
    assert.ok(ok, `${what}: the pins are ${await V.p.ev(`JSON.stringify(${PINS})`)}, not ${want}`);
  };

  await sub('C1, C3: a.html: an element note hides with its view, a note placed on #tab2 shows only there, old notes stay', async () => {
    const V = await visit('#library');
    await V.open(AV_P);
    await V.frameClick('to-a', 'pages/a.html');
    await pinsAre(V, [N.TE, N.TAL, N.TP], 'on a.html');
    await V.frameClick('go-tab2', 'pages/a.html', { hash: '#tab2', load: false });
    await pinsAre(V, [N.TAL, N.TP, N.TP2], 'on a.html#tab2 (TP2 shows on #tab2; TE hides with its view)');
    // where a new note's hash lives: on empty page, or an anchor with no selector, the path holds it
    const paths = await V.p.ev("[tsSubject(null, 10, 10).path, tsSubject({ tag: 'p', text: 'x', rect: { x: 0, y: 0, w: 5, h: 5 } }, 1, 1).path, tsSubject({ selector: '#only-tab2', tag: 'button', text: 'Plan B', rect: { x: 40, y: 280, w: 160, h: 40 } }, 50, 290).path]");
    assert.deepEqual(paths, ['a.html#tab2', 'a.html#tab2', 'a.html'], 'tsSubject on #tab2: empty page and no selector keep the hash; an element, the plain path');
    // a file#hash past the path cap keeps the plain file, never a cut hash (Review focus 4)
    assert.equal(await V.p.ev("(() => { const h = TS.hash; TS.hash = '#' + 'h'.repeat(299); const p = tsSubject(null, 1, 1).path; TS.hash = h; return p; })()"), 'a.html', 'tsSubject: a.html plus a 300-byte hash is past the cap, so the plain file');
    // back to the first view: as on a.html
    await V.frameClick('go-tab1', 'pages/a.html', { hash: '#tab1', load: false });
    await pinsAre(V, [N.TE, N.TAL, N.TP], 'on a.html#tab1');
  });

  await sub('C4b: the viewer takes nav, and no kind outside T_LENS_SAYS', async () => {
    const V = await visit('#library');
    await V.open(AV_P);
    await V.frameClick('to-a', 'pages/a.html');
    await pinsAre(V, [N.TE, N.TAL, N.TP], 'on a.html');
    // C4b (ruling m-20261120-191501324): nav is a kind the viewer takes because T_LENS_SAYS lists it, and
    // nothing outside that list gets through
    const kinds = await V.p.ev("(() => { const w = tsFrame().contentWindow; return Object.fromEntries(['nav', 'go', 'hello', 'resolve', 'place', 'Nav', 'navs', 'constructor'].map((k) => [k, tLensMessage({ data: { lens: 1, type: k, hash: '#x', path: '/x' }, source: w }, w, new Map())?.type ?? null])); })()");
    assert.deepEqual(kinds, { nav: 'nav', go: null, hello: null, resolve: null, place: null, Nav: null, navs: null, constructor: null }, 'tLensMessage takes nav and no kind outside T_LENS_SAYS');
    assert.deepEqual(await V.p.ev('T_LENS_SAYS'), ['ready', 'route', 'hit-reply', 'rects', 'key', 'errors', 'nav'], "T_LENS_SAYS: today's kinds and nav");
  });

  await sub('C4: a page that floods nav costs one redraw a frame, and the same nav again is no move', async () => {
    const V = await visit('#library');
    await V.open(AV_P);
    await V.frameClick('to-a', 'pages/a.html');
    await pinsAre(V, [N.TE, N.TAL, N.TP], 'on a.html');
    // C4: a page that floods nav costs one redraw a frame (TS.draws, the test hook) and counts each move once.
    // Dispatched to the dashboard's window as the frame's (source: its window) in one task: posted from the frame,
    // 100 messages arrive as 100 tasks, not reliably inside one frame. The viewer checks source, never isTrusted.
    const flood = await V.p.ev(`(() => { const d = TS.draws, n = AV_NAVS, w = tsFrame().contentWindow; const say = (h) => dispatchEvent(new MessageEvent('message', { data: { lens: 1, type: 'nav', path: '/artifact/main/pages/a.html', hash: h }, source: w })); for (let i = 0; i < 100; i++) say('#f' + i); return new Promise((r) => requestAnimationFrame(() => { const one = [TS.draws - d, AV_NAVS - n]; const m = AV_NAVS; for (let i = 0; i < 50; i++) say('#f99'); r([...one, AV_NAVS - m]); })); })()`);
    assert.equal(flood[0], 1, '100 navs in one task: one redraw by the next frame');
    assert.equal(flood[1], 100, 'each a move');
    assert.equal(flood[2], 0, 'the same nav again is no move');
  });

  await sub("C11: the viewer's own guards on nav", async () => {
    const V = await visit('#library');
    await V.open(AV_P);
    await V.frameClick('to-a', 'pages/a.html');
    await pinsAre(V, [N.TE, N.TAL, N.TP], 'on a.html');
    // C11: the viewer's own guards on nav (a page's scripts can post it without the lens)
    const g = await V.p.ev(`(() => { const w = tsFrame().contentWindow, m = (x) => tLensMessage({ data: { lens: 1, type: 'nav', path: '/artifact/main/pages/a.html', ...x }, source: w }, w, new Map()); const cap = '/c/1767225600000.abcdefghijklmnop.abcdefghijklmnopqrstuv'; return { bidi: m({ hash: '#a\u202eb\u0007c' }).hash, cap: m({ hash: '#go' + cap + '/artifact/x' }).hash, long: m({ hash: '#' + 'z'.repeat(299) }).hash, plain: m({ hash: 'tab2' }).hash, num: m({ hash: 7 }).hash, nopath: tLensMessage({ data: { lens: 1, type: 'nav', hash: '#q' }, source: w }, w, new Map()).path }; })()`);
    assert.equal(g.bidi, '#abc', 'no bidi override or control character');
    assert.equal(g.cap, '#go[link removed]/artifact/x', 'the capability cut');
    assert.equal(g.long, '#' + 'z'.repeat(199), 'cut to 200 bytes');
    assert.equal(g.plain, '', 'a hash without # is none');
    assert.equal(g.num, '', 'a number is none');
    assert.equal(g.nopath, null, 'no path: null');
    const held = await V.p.ev(`(() => { const w = tsFrame().contentWindow, say = (h) => dispatchEvent(new MessageEvent('message', { data: { lens: 1, type: 'nav', path: '/artifact/main/pages/a.html', hash: h }, source: w })); const n = AV_NAVS, h0 = TS.hash; TS.ready = false; say('#before-ready'); const dropped = [AV_NAVS - n, TS.hash === h0]; TS.ready = true; const m = AV_NAVS; say('#twice'); say('#twice'); return [...dropped, AV_NAVS - m]; })()`);
    assert.deepEqual(held, [0, true, 1], 'a nav before ready is dropped; the same nav twice counts once');
  });

  await sub('C1: b.html: an element note shows with and without #section-2', async () => {
    const V = await visit('#library');
    await V.open(AV_P);
    await V.frameClick('to-b', 'pages/b.html');
    await pinsAre(V, [N.TB], 'on b.html');
    await V.frameClick('to-section-2', 'pages/b.html', { hash: '#section-2', load: false });
    await V.soon("TS.hash === '#section-2'", 'the viewer heard the move to #section-2');
    await V.p.ev(FRAMES);
    await pinsAre(V, [N.TB], 'on b.html#section-2');
  });

  // C2: a move inside the frame with no load, then each closer: closed, on the head it was opened over
  const MOVES = {
    '#hash link': (V) => V.frameClick('to-tab2', 'pages/index.html', { hash: '#tab2', load: false }),
    pushState: (V) => V.frameClick('push', 'pages/index.html', { hash: '#pushed', load: false }),
  };
  for (const [move, run] of Object.entries(MOVES)) {
    for (const kind of ['x', 'escape-dash', 'escape-frame', 'scrim']) {
      await sub(`C2: ${kind} after a ${move} (no frame load)`, async () => {
        const V = await visit('#library');
        await V.open(AV_P);
        await run(V);
        // (the lens's word comes a frame after the page's own: given a moment, then read)
        await V.settle('AV_NAVS === 1', 3000);
        const navs = await V.p.ev('AV_NAVS');
        assert.equal(await V.p.ev(VIEWER_UP), true, 'setup: the viewer is still up');
        await V.close(kind);
        await V.closedOn('#library', `${kind} after the ${move}`);
        assert.equal(navs, 1, 'the move counted toward AV_NAVS');
      });
    }
  }
});
