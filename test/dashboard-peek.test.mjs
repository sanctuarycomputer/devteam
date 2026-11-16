// The side peek (kit-88, spec docs/devteam-dev/tickets/kit-88-side-peek/spec.md): the shell's peek
// frame that slides, its header and the shared scrim, the top-right button beside it, and the peeks
// drawn in it. Headless Chrome against a real dashboard on a project of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const RATE = ['--stake', '1', '--urgency', '1'];

// A project, its dashboard and a Chrome tab on it. seed({ root, dt, commit, ids }) makes the records
// (dt: the kit CLI, role null is the owner; commit: everything written so far, on main) before the
// dashboard starts. Gives the tab (p), the ids and helpers: soon (a page expression, waited for),
// load (a fresh visit), size, url.
async function peekPage(t, { seed, name = 'peek' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-dash-${name}-`));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  // DEVTEAM_BOX stays (lib/kit.mjs sets it off): the kit under test sees no box, as on a CI runner
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_BOX'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, name);
  const ids = {};
  const dt = (args, role = 'supervisor') => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (msg = 'the project') => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', msg], { cwd: root });
  };
  if (seed) await seed({ root, dt, commit, ids });
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  // no classic scrollbar: innerWidth is the window's right edge
  await p.send('Emulation.setScrollbarsHidden', { hidden: true });
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  const evNav = (expr) => p.ev(expr).catch((e) => { if (/navigated or closed|Cannot find context|context was destroyed|Execution context/i.test(e.message)) return false; throw e; });
  const soon = (expr, what) => until(() => evNav(expr), what);
  const load = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: url(hash) });
    await soon("location.protocol === 'http:' && !!document.querySelector('main') && !document.querySelector('main.waiting')", 'the dashboard drawn');
  };
  return { p, port, root, ids, dt, size, url, soon, load };
}

// The frame's records: a goal with a feature and a high-risk ticket (its progress block with a pill, and
// the stepper), an answered
// question too long for one line, an artifact on main and a review page.
const LONG = `Should the checkout keep the card form on one page, ${'with every field the processor asks for and every one it may ask for later, '.repeat(3)}or split it?`;
function frameSeed({ root, dt, commit, ids }) {
  const art = path.join(root, 'docs/devteam/project/artifacts/frame-mock');
  fs.mkdirSync(art, { recursive: true });
  fs.writeFileSync(path.join(art, 'artifact.json'), JSON.stringify({ v: 1, title: 'Frame mock', summary: 'A page to view', by: 'supervisor', for: [] }));
  fs.writeFileSync(path.join(art, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Frame mock</title></head><body><p>the mock</p></body></html>\n');
  fs.mkdirSync(path.join(root, 'review'));
  fs.writeFileSync(path.join(root, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head>\n<body>\n<p>Look.</p>\n</body></html>\n');
  commit();
  ids.goal = dt(['goal', 'add', '--title', 'Launch checkout', '--outcome', 'admins pay alone']);
  dt(['feature', 'add', 'pay', '--json', JSON.stringify({ title: 'Pay', goals: [ids.goal], stories: [{ id: 'PAY-S1', text: 'admin adds a card', release: 'v0.2.0' }] })]);
  ids.ticket = 'pay-01-card';
  dt(['ticket', 'add', ids.ticket, '--json', JSON.stringify({ title: 'card capture', feature: 'pay', component: 'pay', kind: 'build', size: 'S', risk: 'high', serves: ['PAY-S1'], depends_on: [], touches: ['pay/**'], done_when: ['the card check passes in CI'] })]);
  ids.long = dt(['ask', '--question', LONG, '--choices', '[{"label":"One page"},{"label":"Split"}]', ...RATE]);
  dt(['answer', ids.long, 'One page'], null);
  ids.artifact = 'frame-mock';
}

// In the page: the drawer's transform transitions as they run, and the closed transform read at the
// moment peek-open is added (after the unhide and the flush, before the class)
const RECORD = `(() => {
  const d = document.getElementById('drawer');
  if (!window.__tr) {
    window.__tr = [];
    for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) d.addEventListener(type, (e) => { if (e.target === d && e.propertyName === 'transform') window.__tr.push({ type, hidden: d.hidden, scrim: document.getElementById('scrim').hidden }); });
    const cl = document.body.classList, add = cl.add.bind(cl);
    cl.add = (...c) => { if (c.includes('peek-open') && !cl.contains('peek-open')) window.__closed = { transform: getComputedStyle(d).transform, width: d.getBoundingClientRect().width, hidden: d.hidden }; return add(...c); };
  }
  window.__tr.length = 0;
  window.__closed = null;
  return true;
})()`;
const TX = (m) => { const v = /^matrix\(([^)]+)\)$/.exec(m); return v ? Number(v[1].split(',')[4]) : NaN; };
const drawerTransform = "getComputedStyle(document.getElementById('drawer')).transform";
const isOpen = `(!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open') && ${drawerTransform} === 'none')`;
// open and at rest: no transition left running on the drawer
const atRest = `(${isOpen} && !document.getElementById('drawer').getAnimations().some((a) => a.transitionProperty === 'transform'))`;
const isClosed = "(document.getElementById('drawer').hidden && document.getElementById('scrim').hidden && !document.body.classList.contains('peek-open'))";
// seen: laid out, visible and not transparent
const SEEN = `const seen = (el) => { if (!el) return false; const c = getComputedStyle(el); return c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0 && el.getClientRects().length > 0; };`;

test('the frame', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, size, soon, load } = await peekPage(t, { seed: frameSeed, name: 'frame' });
  const T = ids.ticket;
  await size(1440, 900);
  await load('#board');
  await soon(`!!document.querySelector('#board [data-ticket="${T}"]')`, 'the ticket on Board');
  const openPeek = async (hash) => {
    await p.ev(`location.hash = ${JSON.stringify(hash)}`);
    await soon(atRest, `${hash} open`);
  };
  const closePeek = async () => {
    await p.ev("document.getElementById('drawer-close').click()");
    await soon(isClosed, 'the peek closed');
  };

  await t.test('it slides in and out on the shell frame', async () => {
    await p.ev(RECORD);
    // opening: the running transition on transform, caught as it runs
    const run = await p.ev(`new Promise((resolve) => {
      const d = document.getElementById('drawer'), t0 = performance.now();
      location.hash = '#ticket/${T}';
      (function poll() {
        const a = d.getAnimations().find((x) => x.transitionProperty === 'transform');
        if (a) { const tm = a.effect.getTiming(); return resolve({ duration: tm.duration, easing: tm.easing, kf: a.effect.getKeyframes().map((k) => k.easing) }); }
        if (performance.now() - t0 > 5000) return resolve(null);
        requestAnimationFrame(poll);
      })();
    })`);
    const closed = await p.ev('window.__closed');
    assert.ok(closed, 'peek-open was added');
    assert.equal(closed.hidden, false, 'the drawer was unhidden before peek-open');
    assert.ok(TX(closed.transform) >= closed.width, `closed, the drawer sits off-screen: ${closed.transform} (width ${closed.width})`);
    assert.ok(run, 'a transform transition runs on the drawer');
    assert.equal(run.duration, 280, '--dur');
    assert.equal(run.easing, 'cubic-bezier(0.32, 0.72, 0, 1)', '--ease');
    await soon("window.__tr.some((x) => x.type === 'transitionend')", 'the slide in ended');
    assert.equal(await p.ev(drawerTransform), 'none', 'open: no transform');
    assert.ok(await p.ev(isOpen));
    // closing: the reverse slide runs while the drawer is still shown; hidden only after it ends
    await p.ev('window.__tr.length = 0');
    await p.ev("document.getElementById('drawer-close').click()");
    await soon("window.__tr.some((x) => x.type === 'transitionrun')", 'the slide out runs');
    const runOut = await p.ev("window.__tr.find((x) => x.type === 'transitionrun')");
    assert.equal(runOut.hidden, false, 'the drawer is shown while it slides out');
    assert.equal(runOut.scrim, false, 'and the scrim');
    await soon("window.__tr.some((x) => x.type === 'transitionend')", 'the slide out ended');
    await soon(isClosed, 'hidden once the slide ends');
    assert.equal(await p.ev("document.getElementById('scrim').hidden"), true);
  });

  await t.test('reopen during close stays open', async () => {
    await openPeek(`#ticket/${T}`);
    await p.ev(`document.getElementById('drawer-close').click(); setTimeout(() => { location.hash = '#ticket/${T}'; }, 100); void 0`);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await p.ev("document.getElementById('drawer').hidden"), false, 'the pending hide was cancelled');
    assert.equal(await p.ev(drawerTransform), 'none', 'the drawer ends open');
    assert.ok(await p.ev("document.body.classList.contains('peek-open')"));
    await closePeek();
  });

  await t.test('a redraw does not re-slide', async () => {
    await openPeek(`#ticket/${T}`);
    await p.ev(RECORD);
    await p.ev("window.__drop = 0; window.__mo = new MutationObserver(() => { if (!document.body.classList.contains('peek-open')) window.__drop++; }); window.__mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); void 0");
    await p.ev('refreshDrawer(); LAST_HTML = ""; redraw(); void 0');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await p.ev('window.__drop'), 0, 'peek-open stays set throughout');
    assert.equal(await p.ev("window.__tr.filter((x) => x.type === 'transitionrun').length"), 0, 'no slide ran');
    assert.equal(await p.ev(drawerTransform), 'none');
    await p.ev('window.__mo.disconnect(); void 0');
    await closePeek();
  });

  await t.test('reduced motion: nothing slides, and close hides at once', async () => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await openPeek(`#ticket/${T}`);
      const durs = await p.ev("getComputedStyle(document.getElementById('drawer')).transitionDuration");
      assert.ok(durs.split(',').every((x) => x.trim() === '0s'), `no transition: ${durs}`);
      const hidden = await p.ev("new Promise((resolve) => { document.getElementById('drawer-close').click(); setTimeout(() => resolve([document.getElementById('drawer').hidden, document.getElementById('scrim').hidden]), 0); })");
      assert.deepEqual(hidden, [true, true], 'hidden within one task');
    } finally {
      await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    }
  });

  await t.test('the header and the page bar are level; the × is --panel-pad in', async () => {
    await openPeek(`#ticket/${T}`);
    const m = await p.ev(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const head = document.querySelector('#drawer .drawer-head').getBoundingClientRect(), bar = document.querySelector('.pagebar').getBoundingClientRect(), x = document.getElementById('drawer-close').getBoundingClientRect();
      return { barH: parseFloat(cs.getPropertyValue('--bar-h')), pad: parseFloat(cs.getPropertyValue('--panel-pad')), headH: head.height, headBottom: head.bottom, headRight: head.right, barHeight: bar.height, barBottom: bar.bottom, xRight: x.right,
        inHead: !!document.querySelector('#drawer .drawer-head #drawer-bar-title') && !!document.querySelector('#drawer .drawer-head .end #drawer-close'), body: document.getElementById('drawer-body').classList.contains('drawer-body'), old: !!document.querySelector('.drawer-bar') };
    })()`);
    assert.ok(m.inHead, 'the title and the × are in .drawer-head, the × in .end');
    assert.ok(m.body, '#drawer-body is .drawer-body');
    assert.equal(m.old, false, 'no .drawer-bar');
    assert.equal(m.headH, m.barH, '.drawer-head is --bar-h tall');
    assert.equal(m.barHeight, m.barH, '.pagebar is --bar-h tall');
    assert.ok(Math.abs(m.headBottom - m.barBottom) <= 1, `bottoms level: ${m.headBottom} vs ${m.barBottom}`);
    assert.ok(Math.abs(m.headRight - m.pad - m.xRight) <= 1, `the × ends --panel-pad from the header's right: ${m.xRight} vs ${m.headRight} - ${m.pad}`);
    await closePeek();
  });

  await t.test('a long title stays on one line in the header', async () => {
    await openPeek(`#q/${ids.long}`);
    const m = await p.ev(`(() => {
      const cs = getComputedStyle(document.documentElement), head = document.querySelector('#drawer .drawer-head'), dt = head.querySelector('.dtitle');
      const c = getComputedStyle(dt), one = document.createElement('span');
      one.textContent = 'x'; dt.appendChild(one); const lineH = one.getBoundingClientRect().height; one.remove();
      return { barH: parseFloat(cs.getPropertyValue('--bar-h')), headH: head.getBoundingClientRect().height, h: dt.getBoundingClientRect().height, lineH, ws: c.whiteSpace, to: c.textOverflow, ov: c.overflow, title: dt.getAttribute('title'), text: dt.textContent, cut: dt.scrollWidth > dt.clientWidth };
    })()`);
    assert.equal(m.headH, m.barH, 'the header stays --bar-h');
    assert.ok(m.h < 2 * m.lineH, `one line: ${m.h} (a line of text is ${m.lineH})`);
    assert.ok(m.cut, 'too long for the header: cut with an ellipsis');
    assert.equal(m.ws, 'nowrap');
    assert.equal(m.to, 'ellipsis');
    assert.equal(m.ov, 'hidden');
    assert.equal(m.title, m.text, 'its full text as its title');
    assert.ok(m.text.startsWith('Should the checkout keep the card form'));
    await closePeek();
  });

  await t.test('the header names the kind: its icon, then its type chip', async () => {
    const hashes = { ticket: `#ticket/${T}`, goal: `#goal/${ids.goal}`, feature: '#feature/pay', story: '#story/PAY-S1', release: '#release/v0.2.0', wave: '#wave/pay/wave-1', milestone: `#milestone/${ids.goal}/M1`,
      act: '#act/a-none', decision: '#decision/d-none', retro: '#retro/r-none', lesson: '#lesson/k-none', problem: '#problem/p-none', thread: '#thread/m-none', planner: '#planner/pay',
      q: `#q/${ids.long}`, file: '#file?path=docs%2Fdevteam%2FREADME.md', sensor: '#sensor/none', observation: '#observation/o-none', signal: '#signal/none', learning: '#learning/l-none' };
    const kinds = await p.ev('Object.keys(TYPE_META)');
    assert.deepEqual([...kinds].sort(), Object.keys(hashes).sort(), 'every TYPE_META kind has a hash here');
    for (const k of kinds) {
      await p.ev("location.hash = '#board'");
      await soon("!document.body.classList.contains('peek-open')", 'back on Board');
      await p.ev(`location.hash = ${JSON.stringify(hashes[k])}`);
      await soon(`!document.getElementById('drawer').hidden && DRAWER.kind === ${JSON.stringify(k)} && !!document.querySelector('#drawer-bar-title .dtype')`, `the ${k} peek`);
      const m = await p.ev(`(() => { const i = document.querySelector('#drawer-bar-title .dtype i'), b = document.querySelector('#drawer-bar-title .dtype .badge');
        return { cls: i?.className, label: b?.textContent, before: !!(i && b && (i.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)), meta: TYPE_META[${JSON.stringify(k)}] }; })()`);
      assert.ok(m.cls?.split(' ').includes(`icon-${m.meta[0]}`), `${k}: icon-${m.meta[0]} (${m.cls})`);
      assert.equal(m.label, m.meta[1], `${k}: its type chip`);
      assert.ok(m.before, `${k}: the icon precedes the chip`);
    }
    await p.ev("location.hash = '#board'");
    await soon(isClosed, 'closed');
  });

  await t.test('the scrim is the block\'s backdrop', async () => {
    await openPeek(`#ticket/${T}`);
    const s = await p.ev("(() => { const c = getComputedStyle(document.getElementById('scrim')); return { bg: c.backgroundColor, bf: c.backdropFilter, op: c.opacity }; })()");
    assert.equal(s.bg, 'rgba(0, 0, 0, 0.7)');
    assert.equal(s.bf, 'blur(4px)');
    await soon("getComputedStyle(document.getElementById('scrim')).opacity === '1'", 'the scrim shown');
    await closePeek();
  });

  await t.test('inner regions not yet ported read as on their pages', async () => {
    const PROPS = ['background-color', 'font-size', 'padding', 'border-radius'];
    const style = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return Object.fromEntries(${JSON.stringify(PROPS)}.map((k) => [k, c.getPropertyValue(k)])); })()`);
    await p.ev("location.hash = '#board'");
    const pillSel = `[data-ticket="${T}"] .pill`;
    await soon(`!!document.querySelector('#board ${pillSel}')`, 'a pill on Board');
    const boardPill = await style(`#board ${pillSel}`);
    await p.ev("location.hash = '#goals'");
    const card = `#goals-list [data-subject="goal:${ids.goal}"]`;
    await soon(`!!document.querySelector('${card} ol.steps li.now')`, 'the goal card\'s steps');
    const cardStep = await style(`${card} ol.steps li.now`);
    const cardStep0 = await style(`${card} ol.steps li`);
    await openPeek(`#goal/${ids.goal}`);
    await soon(`!!document.querySelector('#drawer-body ${pillSel}') && !!document.querySelector('#drawer-body ol.steps li.now')`, 'the goal peek\'s progress and steps');
    assert.deepEqual(await style(`#drawer-body ${pillSel}`), boardPill, 'a ticket pill in the peek is styled as on Board');
    assert.deepEqual(await style('#drawer-body ol.steps li.now'), cardStep, 'the current step as on the goal card');
    assert.deepEqual(await style('#drawer-body ol.steps li'), cardStep0, 'the first step as on the goal card');
    assert.ok(await p.ev("!!document.querySelector('#drawer-body ol.steps').closest('.no-shell')"), 'the stepper is fenced');
    assert.ok(await p.ev(`!!document.querySelector('#drawer-body ${pillSel}').closest('.no-shell')`), 'the progress block is fenced');
    await closePeek();
  });

  await t.test('the shared scrim: the viewer and a review show it and close on it; the viewer leaves a peek it opened over', async () => {
    const scrimShown = "(!document.getElementById('scrim').hidden && getComputedStyle(document.getElementById('scrim')).opacity === '1')";
    const scrimClick = async () => {
      // the window's left edge: the scrim, outside the viewer (80% centred) and the review (96vw at the right)
      const at = await p.ev("(() => { const e = document.elementFromPoint(6, 450); return e && e.id; })()");
      assert.equal(at, 'scrim', 'the scrim takes the click');
      await p.clickAt(6, 450);
    };
    // the viewer over nothing
    await p.ev("location.hash = '#library'");
    await soon(isClosed, 'no peek');
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon(`!document.getElementById('artifact-view').hidden && ${scrimShown}`, 'the viewer over the scrim');
    await scrimClick();
    await soon("document.getElementById('artifact-view').hidden && document.getElementById('scrim').hidden && !document.body.classList.contains('overlay-open')", 'the viewer closed by the scrim');
    // a review over nothing
    await p.ev("location.hash = '#review-preview?path=review%2Fpage.html&ref=main'");
    await soon(`!document.getElementById('review-view').hidden && ${scrimShown}`, 'the review over the scrim');
    await scrimClick();
    await soon("document.getElementById('review-view').hidden && document.getElementById('scrim').hidden && !document.body.classList.contains('overlay-open')", 'the review closed by the scrim');
    // the viewer over a peek: closing it shows the peek again. Each viewer opens in a fresh visit: once a
    // visit's viewer frame has loaded a page, the next page it loads is a history entry of its own, and
    // the viewer's close (history.back()) moves the frame, not the hash
    await load('#board');
    await openPeek(`#ticket/${T}`);
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon("!document.getElementById('artifact-view').hidden", 'the viewer over the peek');
    await p.click('#av-close');
    await soon(`document.getElementById('artifact-view').hidden && location.hash === '#ticket/${T}'`, 'the viewer closed');
    assert.ok(await p.ev(isOpen), 'the peek is still open');
    assert.ok(await p.ev(scrimShown), 'with its scrim');
    await closePeek();
    // the viewer over a review: closing it leaves the review's scrim dark (R1)
    await load('#library');
    await p.ev("location.hash = '#review-preview?path=review%2Fpage.html&ref=main'");
    await soon(`!document.getElementById('review-view').hidden && ${scrimShown}`, 'the review');
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon("!document.getElementById('artifact-view').hidden", 'the viewer over the review');
    await p.click('#av-close');
    await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#review-preview')", 'back to the review');
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(await p.ev(`!document.getElementById('review-view').hidden && document.body.classList.contains('overlay-open') && ${scrimShown}`), 'the review keeps its scrim');
    // (not closed here by the scrim: the viewer's frame left an entry in the joint history, so the review's
    // history.back() would move that frame; a fresh visit instead)
    await load('#board');
  });

  await t.test('the top-right button stays reachable beside the peek', async () => {
    const m = () => p.ev(`(() => { ${SEEN}
      const tt = document.querySelector('.pagebar .tt'), tp = document.getElementById('tt-peek'), d = document.getElementById('drawer');
      const r = tp?.getBoundingClientRect(), tr = tt.getBoundingClientRect(), dr = d.getBoundingClientRect();
      const hit = r && r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { ttSeen: seen(tt), ttVis: getComputedStyle(tt).visibility, tpSeen: seen(tp), right: r?.right, top: r?.top, ttTop: tr.top, drawerLeft: dr.left, hit: !!(hit && hit.closest('#tt-peek')),
        text: tp?.textContent.trim(), ttText: tt.textContent.trim(), onBody: tp?.parentElement === document.body, ids: document.querySelectorAll('#inbox-btn-n').length, tpIds: tp ? tp.querySelectorAll('[id]').length : -1 };
    })()`);
    // no peek: the mirror isn't shown, .tt is
    let v = await m();
    assert.ok(v.onBody, '#tt-peek is on <body>');
    assert.equal(v.tpSeen, false, 'no peek: #tt-peek not shown');
    assert.equal(v.ttSeen, true, 'no peek: .tt shown');
    await openPeek(`#ticket/${T}`);
    await soon(`(() => { ${SEEN} return seen(document.getElementById('tt-peek')) && getComputedStyle(document.getElementById('tt-peek')).opacity === '1'; })()`, '#tt-peek shown');
    v = await m();
    assert.equal(v.ttVis, 'hidden', '.pagebar .tt is visibility: hidden while the mirror shows');
    assert.ok(v.right <= v.drawerLeft - 16 + 1, `its right (${v.right}) is --header-pad left of the drawer (${v.drawerLeft})`);
    assert.ok(Math.abs(v.top - v.ttTop) <= 1, `level with .tt: ${v.top} vs ${v.ttTop}`);
    assert.ok(v.hit, 'above the scrim: its centre is #tt-peek');
    assert.equal(v.text, v.ttText, 'its text is .tt\'s');
    assert.equal(v.ids, 1, 'one #inbox-btn-n: the copy carries no ids');
    assert.equal(v.tpIds, 0, 'no id in the mirror\'s copy');
    // the counts change: the mirror follows within a frame
    await p.ev("document.getElementById('inbox-btn-n').textContent = '42'; void 0");
    await p.ev('new Promise((r) => requestAnimationFrame(() => r(true)))');
    v = await m();
    assert.equal(v.text, v.ttText, 'it follows .tt');
    assert.match(v.text, /42/);
    // fades rather than pops
    const tr = await p.ev("getComputedStyle(document.getElementById('tt-peek')).transitionProperty");
    assert.match(tr, /opacity/, 'it fades');
    // a narrow window: neither shows
    await size(720, 800);
    await new Promise((r) => setTimeout(r, 400));
    v = await m();
    assert.equal(v.tpSeen, false, '720px: #tt-peek not shown');
    assert.equal(v.ttSeen, false, '720px: .tt not shown under the peek');
    await size(1440, 900);
    await soon(`(() => { ${SEEN} return seen(document.getElementById('tt-peek')) && getComputedStyle(document.getElementById('tt-peek')).opacity === '1'; })()`, '#tt-peek shown again');
    // its click is .tt's
    await p.ev("window.__ttc = 0; document.querySelector('.pagebar .tt').addEventListener('click', () => { window.__ttc++; }); void 0");
    await p.click('#tt-peek');
    await soon('window.__ttc === 1', ".tt's click ran");
    await soon(isClosed, 'the Inbox, the peek closed');
    await soon(`(() => { ${SEEN} return !seen(document.getElementById('tt-peek')) && seen(document.querySelector('.pagebar .tt')); })()`, 'no peek: .tt again');
  });
});
