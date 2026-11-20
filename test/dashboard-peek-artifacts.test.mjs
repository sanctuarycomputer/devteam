// The artifacts a goal's, ticket's, feature's and thread's side peek lists (kit-320): the peek-artifacts block
// (peekArtifacts, peekArtSection) run alone in vm beside the library-items block it reuses, over
// libraryFixture()'s /api/data parts; then the four peeks in real headless Chrome over a real dashboard on a
// bare project whose /api/data is patched in the page with libraryFixture() (skipped where Chrome can't run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, libraryFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};
const NOW = Date.parse('2026-11-19T12:00:00Z');
const plain = (x) => JSON.parse(JSON.stringify(x));

// The fixture's artifacts by what ties them (test/lib/kit.mjs libraryFixture): feat1 is 'pay', goal1's
// feature; tBuilding and tHeld are pay tickets, tHighRisk a receipts one (goal2).
function expected(ids) {
  return {
    goal1: ['checkout-mock', 'pay-flow', 'refund-screen', 'wallet-mock', 'coupons-mock', 'slow-one', 'coupon-sketch', 'pay-guide'],
    feat1: ['pay-flow', 'refund-screen', 'coupons-mock', 'coupon-sketch', 'pay-guide'],
    tHeld: ['coupons-mock', 'coupon-sketch'],
    ids,
  };
}

// the page's own helpers the blocks call, stubbed so a value that isn't theirs shows
function loadBlocks() {
  const vctx = vm.createContext({ URL, URLSearchParams });
  const pre = `
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const psect = (title, html) => '<div class="card psect"><div class="card-head"><span class="grow">' + esc(title) + '</span></div><div class="psect-body">' + html + '</div></div>';
    const artHref = (s, at) => '#artifact/' + (at === 'main' ? 'main' : 'wt/' + encodeURIComponent(at)) + '/' + encodeURIComponent(s);
    const artViewer = (s, at) => '/view/artifact/' + s + '?at=' + at;
    const pvViewer = (n) => '/view/preview/' + n;
    const fileHref = (l) => '#file?path=' + l.path;
  `;
  vm.runInContext(`${pre}\n${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\n${block(INDEX, 'peek-artifacts')}
    this.libraryItems = libraryItems; this.peekArtifacts = peekArtifacts; this.peekArtSection = peekArtSection;
    this.ctx = { previewState, artHref, artViewer, pvViewer, fileHref };`, vctx);
  return vctx;
}

test('peek-artifacts: what ties an artifact to each peek', () => {
  const { libraryItems, peekArtifacts, ctx } = loadBlocks();
  const { patch: data, ids } = libraryFixture({ now: NOW });
  const want = expected(ids);
  const before = JSON.stringify(data);
  const slugs = (ref, d = data) => plain(peekArtifacts(d, ref, ctx)).map((x) => x.art.slug);
  const sorted = (xs) => [...xs].sort();

  // a goal: exactly the Library's Goal filter, artifacts only
  const lib = plain(libraryItems(data, NOW, ctx));
  const goalOf = (g) => lib.filter((x) => ['mock', 'diagram', 'docs'].includes(x.kind) && x.goals.includes(g)).map((x) => x.art.slug);
  assert.deepEqual(slugs(`goal:${ids.goal1}`), goalOf(ids.goal1), 'goal1: the Library under its Goal filter, in its order');
  assert.deepEqual(sorted(slugs(`goal:${ids.goal1}`)), sorted(want.goal1), 'goal1: the fixture\'s list');
  assert.deepEqual(slugs(`goal:${ids.goal2}`), goalOf(ids.goal2), 'goal2: the Library under its Goal filter');
  assert.ok(!slugs(`goal:${ids.goal2}`).includes('checkout-mock') && slugs(`goal:${ids.goal2}`).includes('receipt-flow'), 'goal2 is not goal1');
  assert.ok(lib.some((x) => x.kind !== 'mock' && x.kind !== 'diagram' && x.kind !== 'docs' && x.goals.includes(ids.goal1)), 'the fixture has a non-artifact item for goal1');

  // a feature: feature:<f>, plan-<f>, or a ticket whose feature is <f>; never a goal ref alone
  assert.deepEqual(sorted(slugs(`feature:${ids.feat1}`)), sorted(want.feat1), 'feat1: feature refs and its tickets\' refs');
  assert.ok(!slugs(`feature:${ids.feat1}`).includes('checkout-mock'), 'a goal:<g> ref does not tie to its feature');
  assert.ok(!slugs(`feature:${ids.feat1}`).includes('odd-kind'), 'another feature\'s ticket does not tie');
  // a ticket: ticket:<t> or a bare <t>, whole
  assert.deepEqual(sorted(slugs(`ticket:${ids.tHeld}`)), sorted(want.tHeld), 'tHeld: its ticket refs');
  assert.deepEqual(slugs(`ticket:${ids.tBuilding}`), ['pay-flow'], 'tBuilding: its one');

  // more refs, on rows added to the fixture: a planner, a bare ticket id, a draft adding a ref the landed row lacks
  const row = (slug, at, forRefs) => ({ slug, at, title: `The ${slug}`, summary: null, by: 'supervisor', for: forRefs, error: null, fp: slug, updated_at: '2026-11-18T00:00:00Z', ...(at === 'main' ? { tree: 'f'.repeat(40), published: null } : {}) });
  const more = { ...data, library: { ...data.library, artifacts: [...data.library.artifacts,
    row('by-planner', 'main', [`plan-${ids.feat1}`]),
    row('bare-ticket', 'main', [ids.tHeld]),
    row('prefix-ticket', 'main', [`ticket:${ids.tHeld}-x`, `${ids.tHeld}x`]),
    row('draft-adds', 'main', []),
    row('draft-adds', ids.wt2, [`ticket:${ids.tMerged}`]),
    // the reverse: the landed row names a ticket, the newest draft (what opens) dropped it
    row('draft-drops', 'main', [`ticket:${ids.tMerged}`]),
    { ...row('draft-drops', ids.wt2, []), updated_at: '2026-11-19T00:00:00Z' },
    row('odd-refs', 'main', [null, 7, { x: 1 }]),
  ] } };
  assert.ok(slugs(`feature:${ids.feat1}`, more).includes('by-planner'), 'plan-<f> ties to its feature');
  assert.ok(slugs(`feature:${ids.feat1}`, more).includes('bare-ticket'), 'a bare ticket id ties to its feature');
  assert.ok(slugs(`ticket:${ids.tHeld}`, more).includes('bare-ticket'), 'a bare ticket id ties to its ticket');
  assert.ok(!slugs(`ticket:${ids.tHeld}`, more).includes('prefix-ticket'), 'refs compare whole, never by prefix');
  assert.ok(!slugs(`feature:${ids.feat1}`, more).includes('prefix-ticket'), 'a near-miss ticket id is no ticket');
  assert.ok(slugs(`ticket:${ids.tMerged}`, more).includes('draft-adds'), 'the newest draft\'s ref counts');
  assert.ok(!slugs(`ticket:${ids.tMerged}`, more).includes('draft-drops'), 'a landed row\'s ref the newest draft dropped does not (kit-92 reads the shown row)');
  assert.ok(!slugs(`feature:${ids.feat1}`, more).includes('draft-drops'), 'nor through its ticket\'s feature');
  for (const r of [`goal:${ids.goal1}`, `feature:${ids.feat1}`, `ticket:${ids.tHeld}`]) assert.ok(!slugs(r, more).includes('odd-refs'), `odd refs tie to nothing (${r})`);
  // a ticket the board lists but not progress, and one progress lists but not the board, each reach its feature (task-1 F3)
  const split = { ...more, tickets: [...(more.tickets ?? []), { id: 'pay-90-board-only', feature: ids.feat1 }], progress: { ...more.progress, tickets: [...more.progress.tickets, { ...more.progress.tickets[0], id: 'pay-91-progress-only', feature: ids.feat1 }] },
    library: { ...more.library, artifacts: [...more.library.artifacts, row('board-only', 'main', ['ticket:pay-90-board-only']), row('progress-only', 'main', ['pay-91-progress-only'])] } };
  assert.ok(slugs(`feature:${ids.feat1}`, split).includes('board-only'), 'a ticket only in data.tickets reaches its feature');
  assert.ok(slugs(`feature:${ids.feat1}`, split).includes('progress-only'), 'a ticket only in progress.tickets reaches its feature');

  // nothing for anything else, or with no library
  assert.deepEqual(slugs(`ticket:${ids.tMerged}`), [], 'a ticket no artifact names: none');
  assert.deepEqual(slugs('story:PAY-S1'), [], 'an unknown ref kind: none');
  assert.deepEqual(slugs('nonsense'), [], 'not a ref: none');
  assert.deepEqual(slugs(`goal:${ids.goal1}`, { ...data, library: undefined }), [], 'no library: none');
  assert.equal(JSON.stringify(data), before, 'the data is not changed');
});

test('peek-artifacts: the section is links, or nothing', () => {
  const { peekArtifacts, peekArtSection, ctx } = loadBlocks();
  const { patch: data, ids } = libraryFixture({ now: NOW });
  assert.equal(peekArtSection([]), '', 'none: nothing at all');
  assert.equal(peekArtSection(peekArtifacts(data, `ticket:${ids.tMerged}`, ctx)), '', 'a ticket with none: nothing');

  const items = plain(peekArtifacts(data, `feature:${ids.feat1}`, ctx));
  const html = peekArtSection(peekArtifacts(data, `feature:${ids.feat1}`, ctx));
  assert.match(html, /^<div class="card psect" data-peek-arts/, 'a section card marked data-peek-arts');
  assert.match(html, /<span class="grow">Artifacts<\/span>/, 'headed Artifacts');
  const links = [...html.matchAll(/<a class="linkish" href="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, items.map((x) => [x.href.replace(/&/g, '&amp;'), x.title]), 'one link per item, its href and title');
  assert.ok(links.some(([h]) => h === `#artifact/wt/${ids.wt2}/refund-screen`), 'the drafted one opens its newest draft');
  assert.match(html, new RegExp(`draft in ${ids.wt2}`), 'a draft says so');
  const liOf = (h, slug) => (h.match(new RegExp(`<li><a [^>]*${slug}"[^<]*</a>[^]*?</li>`)) ?? [''])[0];
  const landed = liOf(html, 'pay-guide');
  assert.ok(landed && !/draft in/.test(landed), `a landed one says no draft: ${landed}`);
  assert.match(html, /Diagram/, 'the kind word');

  // a broken one links to its Library peek, by its slug, badged; titles are escaped
  const odd = { ...data, library: { ...data.library, artifacts: [
    { slug: 'bad-one', at: 'main', tree: 'a'.repeat(40), published: null, title: null, summary: null, by: null, for: [`ticket:${ids.tMerged}`], error: 'manifest.json: title is missing', fp: 'b', updated_at: null },
    { slug: 'bad<i>', at: 'main', tree: 'c'.repeat(40), published: null, title: null, summary: null, by: null, for: [`ticket:${ids.tMerged}`], error: 'broken', fp: 'bi', updated_at: null },
    { slug: 'wt-draft', at: 'wt<b>', title: 'In a draft', summary: null, by: null, for: [`ticket:${ids.tMerged}`], error: null, fp: 'wd', updated_at: '2026-11-18T00:00:00Z' },
    { slug: 'sharp', at: 'main', tree: 'b'.repeat(40), published: null, title: '<b>x</b> & y', summary: null, by: null, for: [`ticket:${ids.tMerged}`], error: null, fp: 's', updated_at: null },
  ] } };
  const h2 = peekArtSection(peekArtifacts(odd, `ticket:${ids.tMerged}`, ctx));
  assert.ok(h2.includes('<a class="linkish" href="#lib/artifact%3Abad-one">bad-one</a>'), `broken: its Library peek: ${h2}`);
  assert.match(h2, /<span class="badge[^"]*">broken<\/span>/, 'broken: badged');
  assert.ok(h2.includes('&lt;b&gt;x&lt;/b&gt; &amp; y') && !h2.includes('<b>x</b>'), 'the title escaped');
  assert.ok(h2.includes('>bad&lt;i&gt;</a>') && !h2.includes('bad<i>'), `a broken slug escaped: ${h2}`);
  assert.ok(h2.includes('draft in wt&lt;b&gt;') && !h2.includes('wt<b>'), `the draft's worktree escaped: ${h2}`);
});

// ---- the peeks in Chrome ----

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) {
      // what the peek showed, to say why it never got there
      const shown = await p.ev("(document.getElementById('drawer') || {}).textContent || ''").catch(() => '');
      assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}; the peek: ${JSON.stringify(String(shown).replace(/\s+/g, ' ').slice(0, 600))}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};
// a ticket's /api/peek, answered in the page for the fixture's tickets (the bare project has no records)
const TICKET_PEEK_INIT = `(() => {
  const f = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    if (url.startsWith('/api/peek?')) {
      const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const t = q.get('kind') === 'ticket' && (window.__fx.progress?.tickets || []).find((x) => x.id === q.get('id'));
      if (t) return new Response(JSON.stringify({ ticket: { id: t.id, title: t.title, feature: t.feature }, files: [], reviews: [], deps: { waits_on: [], blocks: [] }, history: [], spend: null, handoff: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return f(u, o);
  };
})();`;

async function peeksOn(t, patch) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-peek-arts-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, 'peekarts');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `${dataPatchInit(patch)}\n${TICKET_PEEK_INIT}` });
  const soon = soonIn(p, 20000, () => dash.out());
  const at = `http://127.0.0.1:${port}`;
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `${at}/${hash}` });
    await soon("!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA", 'the page with its data');
  };
  return { p, soon, go };
}

// what the open peek shows: its Artifacts links, whether that section comes before History, any "Artifacts" heading
const SHOWN = `(() => {
  const d = document.getElementById('drawer'), s = d.querySelector('[data-peek-arts]');
  const heads = [...d.querySelectorAll('.psect .card-head')].map((h) => h.textContent.trim());
  return { links: s ? [...s.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent.trim()]) : null,
    next: heads.indexOf('Artifacts') >= 0 ? heads[heads.indexOf('Artifacts') + 1] : null, artHeads: heads.filter((h) => h === 'Artifacts').length };
})()`;

test('each of the four peeks lists its artifacts, a link opens the viewer', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture({ now: NOW });
  const { peekArtifacts, ctx } = loadBlocks();
  const linksOf = (ref) => plain(peekArtifacts(patch, ref, ctx)).map((x) => [x.href, x.title]);
  const { p, soon, go } = await peeksOn(t, patch);
  const thread = `m-20261110-000000009-${ids.tHeld}`;
  for (const [hash, ref, what] of [[`#goal/${ids.goal1}`, `goal:${ids.goal1}`, 'goal'], [`#feature/${ids.feat1}`, `feature:${ids.feat1}`, 'feature'], [`#ticket/${ids.tHeld}`, `ticket:${ids.tHeld}`, 'ticket'], [`#thread/${thread}`, `ticket:${ids.tHeld}`, 'thread']]) {
    await go(hash);
    await soon("!document.getElementById('drawer').hidden && !!document.querySelector('#drawer [data-peek-arts]')", `the ${what} peek's artifacts`);
    const s = await p.ev(SHOWN);
    assert.ok(linksOf(ref).length > 0, `${what}: the fixture ties some`);
    assert.deepEqual(s.links, linksOf(ref), `${what}: exactly its artifacts, as links, in order`);
    assert.equal(s.next, what === 'feature' ? 'Progress' : 'History', `${what}: just above ${what === 'feature' ? 'Progress (openTicketSet draws extra, Progress, History)' : 'History'}`);
    assert.equal(s.artHeads, 1, `${what}: one section`);
  }
  // a link opens the large viewer on what it names (the drafted one: its newest draft)
  await go(`#feature/${ids.feat1}`);
  await soon("!!document.querySelector('#drawer [data-peek-arts]')", 'the feature peek');
  // the link clicked in the page (a real anchor click: the page's own hash routing follows its href), not at
  // screen coordinates: the drawer slides in and its Dependencies diagram is drawn later, both moving the link
  // between a coordinate click's measure and its press (plan-1 F1, plan-2 F2-1)
  assert.equal(await p.ev(`(() => { const a = document.querySelector('#drawer [data-peek-arts] a[href="#artifact/wt/${ids.wt2}/refund-screen"]'); if (!a) return 'no link'; a.click(); return 'clicked'; })()`), 'clicked', 'the drafted artifact\'s link is in the feature peek');
  await soon(`!document.getElementById('artifact-view').hidden && document.getElementById('av-frame').getAttribute('src').endsWith('/artifact/wt/${ids.wt2}/refund-screen/')`, 'the link opens the viewer on the draft');
});

test('a peek with no artifacts shows nothing extra', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture({ now: NOW });
  const { p, soon, go } = await peeksOn(t, { ...patch, library: { ...patch.library, artifacts: patch.library.artifacts.filter((a) => !(a.for || []).includes(`goal:${ids.goal2}`) && a.slug !== 'odd-kind') } });
  for (const [hash, what, ready] of [
    [`#ticket/${ids.tMerged}`, 'a ticket with none', `[...document.querySelectorAll('#drawer .psect .card-head')].some((h) => h.textContent.trim() === 'History')`],
    [`#goal/${ids.goal2}`, 'a goal with none', `[...document.querySelectorAll('#drawer .psect .card-head')].some((h) => h.textContent.trim() === 'History')`],
    [`#feature/${ids.feat2}`, 'a feature with none', `[...document.querySelectorAll('#drawer .psect .card-head')].some((h) => h.textContent.trim() === 'History')`],
    [`#thread/${ids.msgSupervisor}`, 'a message with no ticket', `[...document.querySelectorAll('#drawer .psect .card-head')].some((h) => h.textContent.trim() === 'History')`],
  ]) {
    await go(hash);
    await soon(`!document.getElementById('drawer').hidden && ${ready}`, `${what}: the peek drawn`);
    const s = await p.ev(SHOWN);
    assert.equal(s.links, null, `${what}: no artifacts section`);
    assert.equal(s.artHeads, 0, `${what}: no Artifacts heading`);
    assert.ok(!/\bArtifacts\b/.test(await p.ev("document.getElementById('drawer').textContent")), `${what}: the word isn't drawn`);
  }
});
