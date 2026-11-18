// The side peek (kit-88, spec docs/devteam-dev/tickets/kit-88-side-peek/spec.md): the shell's peek
// frame that slides, its header and the shared scrim, the top-right button beside it, and the peeks
// drawn in it. Headless Chrome against a real dashboard on a project of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, bareProject, dashboardOnFreePort, kit, peekFixture, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const RATE = ['--stake', '1', '--urgency', '1'];

// A project, its dashboard and a Chrome tab on it. seed({ root, dt, commit, ids }) makes the records
// (dt: the kit CLI, role null is the owner; commit: everything written so far, on main) before the
// dashboard starts; or fixture(base) makes the whole project ({ root, ids }, test/lib/kit.mjs). Gives
// the tab (p), the ids and helpers: soon (a page expression, waited for), load (a fresh visit), size, url.
async function peekPage(t, { seed, fixture, name = 'peek' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-dash-${name}-`));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  // DEVTEAM_BOX stays (lib/kit.mjs sets it off): the kit under test sees no box, as on a CI runner
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_BOX'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const made = fixture ? fixture(base) : null;
  const root = made ? made.root : bareProject(base, name);
  const ids = made ? made.ids : {};
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
  // DEVTEAM_TEST_CPU_THROTTLE=n runs the page n times slower, as on a loaded runner
  if (process.env.DEVTEAM_TEST_CPU_THROTTLE) await p.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DEVTEAM_TEST_CPU_THROTTLE) });
  // no classic scrollbar: innerWidth is the window's right edge
  await p.send('Emulation.setScrollbarsHidden', { hidden: true });
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  const evNav = (expr) => p.ev(expr).catch((e) => { if (/navigated or closed|Cannot find context|context was destroyed|Execution context/i.test(e.message)) return false; throw e; });
  const soon = (expr, what) => until(() => evNav(expr), what);
  const load = async (hash) => {
    // Chrome keeps 50 entries a tab and, when full, prunes the oldest one left without a user gesture (every
    // hash here is set by script). Over a whole test that can be the entry right under a peek, and its close
    // then goes back past the page. Each visit starts the tab's history afresh, with this visit's about:blank
    // right below it, so a close one entry too far still lands off the dashboard and fails
    await p.send('Page.resetNavigationHistory');
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
    const cl = document.body.classList, add = cl.add.bind(cl), remove = cl.remove.bind(cl);
    cl.add = (...c) => { if (c.includes('peek-open') && !cl.contains('peek-open')) window.__closed = { transform: getComputedStyle(d).transform, width: d.getBoundingClientRect().width, hidden: d.hidden }; return add(...c); };
    // closing: at the moment peek-open goes, whether the drawer is shown and its slide out has begun
    // (getAnimations flushes the style), recorded as it happens rather than polled for afterwards
    // and, just after peekHide's own end listener (added in a microtask queued here, inside peekHide before
    // it adds end; the microtask runs once the closing handler or evaluate returns, before any frame), whether
    // the slide out's own transitionend hid the drawer: never the safety net a second later. A stale end from
    // the slide in (a transform transition still running) is skipped. And, for an end or cancel that came while
    // the drawer was shown and a transform transition still ran on it (read in the capture phase, before the
    // page's listeners): __hit, a leftover event from the slide in reached the page during its slide out; __cut,
    // that event hid the drawer, a slide out cut short. Listeners left by a close that was reopened go at the next close or RECORD.
    const slides = () => d.getAnimations().some((a) => a.transitionProperty === 'transform');
    for (const ty of ['transitionend', 'transitioncancel']) addEventListener(ty, (e) => { if (e.target === d && e.propertyName === 'transform') window.__pre = { shown: !d.hidden, sliding: slides() }; }, true);
    cl.remove = (...c) => { const was = c.includes('peek-open') && cl.contains('peek-open'); const r = remove(...c);
      if (was) {
        window.__out = { hidden: d.hidden, scrim: document.getElementById('scrim').hidden, sliding: slides() };
        if (window.__endL) d.removeEventListener('transitionend', window.__endL);
        if (window.__cutL) for (const ty of ['transitionend', 'transitioncancel']) d.removeEventListener(ty, window.__cutL);
        window.__hit = false;
        window.__cut = null;
        queueMicrotask(() => {
          const l = window.__endL = (e) => { if (e.target !== d || e.propertyName !== 'transform' || slides()) return; window.__endHidden = d.hidden; d.removeEventListener('transitionend', l); if (window.__endL === l) window.__endL = null; };
          d.addEventListener('transitionend', l);
          const cut = window.__cutL = (e) => { if (e.target !== d || e.propertyName !== 'transform' || !window.__pre?.shown || !window.__pre.sliding) return; window.__hit = true; if (d.hidden) window.__cut = e.type; };
          for (const ty of ['transitionend', 'transitioncancel']) d.addEventListener(ty, cut);
        });
      }
      return r; };
  }
  if (window.__endL) { d.removeEventListener('transitionend', window.__endL); window.__endL = null; }
  if (window.__cutL) { for (const ty of ['transitionend', 'transitioncancel']) d.removeEventListener(ty, window.__cutL); window.__cutL = null; }
  window.__cut = null;
  window.__hit = false;
  window.__tr.length = 0;
  window.__closed = null;
  window.__out = null;
  window.__endHidden = null;
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

  await t.test('a closing peek lets clicks through', async () => {
    await openPeek(`#ticket/${T}`);
    // close, and in the same task (the slide out just begun, the drawer still shown) ask what is under a point on it
    const m = await p.ev(`(() => {
      const d = document.getElementById('drawer'), r = d.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const before = !!document.elementFromPoint(x, y)?.closest('#drawer');
      document.getElementById('drawer-close').click();
      const e = document.elementFromPoint(x, y);
      return { before, hidden: d.hidden, open: document.body.classList.contains('peek-open'), inDrawer: !!e?.closest('#drawer'), seen: getComputedStyle(d).visibility };
    })()`);
    assert.ok(m.before, 'open: the point is on the drawer');
    assert.equal(m.hidden, false, 'still shown, sliding out');
    assert.equal(m.seen, 'visible', 'still visible');
    assert.equal(m.open, false);
    assert.equal(m.inDrawer, false, 'a click there reaches the page, not the drawer');
    await soon(isClosed, 'closed');
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
    // the step bar is the shell's goalSteps on the card and in the peek alike (kit-90): not fenced
    assert.ok(await p.ev("!document.querySelector('#drawer-body ol.steps').closest('.no-shell')"), 'the stepper is the shell\'s, not fenced');
    assert.ok(await p.ev(`!!document.querySelector('#drawer-body ${pillSel}').closest('.no-shell')`), 'the progress block is fenced');
    await closePeek();
  });

  await t.test('a scrim click and Escape close the peek: it slides out, then hides', async () => {
    for (const how of ['scrim', 'Escape']) {
      await openPeek(`#ticket/${T}`);
      await p.ev(RECORD);
      if (how === 'scrim') {
        assert.equal(await p.ev("(() => { const e = document.elementFromPoint(6, 450); return e && e.id; })()"), 'scrim', 'the scrim takes the click');
        await p.clickAt(6, 450);
      } else await p.key('Escape');
      await soon('!!window.__out', `${how}: peek-open removed`);
      const out = await p.ev('window.__out');
      assert.equal(out.sliding, true, `${how}: the slide out begins as peek-open goes`);
      assert.equal(out.hidden, false, `${how}: shown while it slides out`);
      assert.equal(out.scrim, false, `${how}: and the scrim`);
      await soon("window.__tr.some((x) => x.type === 'transitionrun')", `${how}: the slide out runs`);
      assert.equal(await p.ev("window.__tr.find((x) => x.type === 'transitionrun').hidden"), false, `${how}: still shown when its transitionrun arrives`);
      await soon("window.__tr.some((x) => x.type === 'transitionend')", `${how}: the slide out ended`);
      await soon('window.__endHidden !== null', `${how}: the slide out's own end heard`);
      assert.equal(await p.ev('window.__endHidden'), true, `${how}: hidden by the slide's own end`);
      await soon(isClosed, `${how}: hidden once the slide ends`);
    }
  });

  // A close during the slide in, or in the frame it ends, still slides out (kit-289): the slide in's own
  // transitioncancel (or a late transitionend), sent with the next frame, must not hide the drawer at once.
  // Each close clears __tr in its own task, so the first transitionrun read after it is the slide out's.
  const slidesOut = async (what) => {
    await soon("window.__tr.some((x) => x.type === 'transitionrun')", `${what}: the slide out runs`);
    assert.equal(await p.ev("window.__tr.find((x) => x.type === 'transitionrun').hidden"), false, `${what}: shown when the slide out's transitionrun arrives`);
    await soon(isClosed, `${what}: closed`);
    assert.equal(await p.ev('window.__cut'), null, `${what}: not hidden while its slide out ran`);
    await soon("window.__tr.some((x) => x.type === 'transitionend')", `${what}: the slide out ended`);
    await soon('window.__endHidden !== null', `${what}: the slide out's own end heard`);
    assert.equal(await p.ev('window.__endHidden'), true, `${what}: hidden by the slide's own end`);
  };
  // Open from Board and close from the task in which ready(a) first holds (a: the slide in's animation, or
  // null once it is gone), polled from setTimeout tasks as a CDP evaluate or a key event lands: between frames.
  const closeWhen = async (ready) => {
    await p.ev("location.hash = '#board'");
    await soon(isClosed, 'back on Board');
    await p.ev(RECORD);
    return p.ev(`new Promise((resolve) => {
      const d = document.getElementById('drawer'), t0 = performance.now(), ready = ${ready};
      let began = false;
      location.hash = '#ticket/${T}';
      (function poll() {
        const a = d.getAnimations().find((x) => x.transitionProperty === 'transform') || null;
        if (a) began = true;
        if (began && ready(a)) { window.__tr.length = 0; document.getElementById('drawer-close').click(); return resolve(true); }
        if (performance.now() - t0 > 5000) return resolve(false);
        setTimeout(poll, 0);
      })();
    })`);
  };

  await t.test('slide out survives: a leftover cancel from the slide in', async () => {
    await openPeek(`#ticket/${T}`);
    await p.ev(RECORD);
    const hidden = await p.ev(`(() => {
      const d = document.getElementById('drawer');
      window.__tr.length = 0;
      document.getElementById('drawer-close').click();
      d.dispatchEvent(new TransitionEvent('transitioncancel', { propertyName: 'transform', bubbles: true }));
      return d.hidden;
    })()`);
    assert.equal(hidden, false, 'a leftover cancel from the slide in leaves the slide out running');
    await slidesOut('leftover cancel');
  });

  await t.test('slide out survives: a close mid slide in', async () => {
    // mid slide: drawn (its transitionrun sent) and 40-200 ms into its 280. A try counts once the slide in's
    // cancel reached the page while the slide out ran (__hit). It is tried again when the poll missed the
    // window, or when one slow frame on a loaded runner outlasted the shorter reversed slide out (over before
    // Chrome sent its events, so nothing is left to cut short, and hiding then is right)
    let hit = false;
    for (let i = 0; i < 8 && !hit; i++) {
      if (!(await closeWhen("(a) => !!a && window.__tr.some((x) => x.type === 'transitionrun') && a.currentTime >= 40 && a.currentTime <= 200"))) continue;
      await soon(isClosed, 'closed');
      hit = await p.ev('window.__hit');
    }
    assert.ok(hit, 'closed mid slide in, and its leftover cancel came while the slide out ran');
    await slidesOut('mid slide in');
  });

  await t.test('slide out survives: a close in the frame the slide in ends', async () => {
    for (let i = 1; i <= 5; i++) {
      assert.ok(await closeWhen('(a) => !a'), `round ${i}: closed as the slide in ended`);
      await soon("window.__tr.some((x) => x.type === 'transitionrun')", `round ${i}: the slide out runs`);
      assert.equal(await p.ev("window.__tr.find((x) => x.type === 'transitionrun').hidden"), false, `round ${i}: shown when the slide out's transitionrun arrives`);
      await soon(isClosed, `round ${i}: closed`);
      assert.equal(await p.ev('window.__cut'), null, `round ${i}: not hidden while its slide out ran`);
    }
  });

  await t.test('a slide out that sends neither end nor cancel still hides: the safety net, well past --dur', async () => {
    await openPeek(`#ticket/${T}`);
    // the frame's transitionend and transitioncancel stopped on the way down (a background tab, a frame
    // whose display changed): the slide runs, and nothing tells peekHide it is over
    const r = await p.ev(`new Promise((resolve) => {
      const d = document.getElementById('drawer'), swallowed = [];
      const swallow = (e) => { if (e.target === d) { swallowed.push(e.type); e.stopPropagation(); } };
      for (const ty of ['transitionend', 'transitioncancel']) addEventListener(ty, swallow, true);
      let ran = false;
      d.addEventListener('transitionrun', (e) => { if (e.propertyName === 'transform') ran = true; });
      const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur'));
      let mo = null;
      const done = (hiddenAt) => { for (const ty of ['transitionend', 'transitioncancel']) removeEventListener(ty, swallow, true); mo.disconnect(); resolve({ ran, hiddenAt, swallowed, dur, open: document.body.classList.contains('peek-open') }); };
      const t0 = performance.now();
      mo = new MutationObserver(() => { if (d.hidden) done(Math.round(performance.now() - t0)); });
      mo.observe(d, { attributes: true, attributeFilter: ['hidden'] });
      setTimeout(() => done(null), 6000);
      document.getElementById('drawer-close').click();
    })`);
    assert.ok(r.dur > 0, `a slide to run: --dur ${r.dur}`);
    assert.ok(r.ran, `the slide out ran: ${JSON.stringify(r)}`);
    assert.ok(r.hiddenAt !== null, `hidden, with no end or cancel: ${JSON.stringify(r)}`);
    assert.ok(r.hiddenAt >= r.dur + 900, `by the safety net, not the slide's own timer: ${JSON.stringify(r)}`);
    assert.equal(r.open, false, 'and closed');
    await soon(isClosed, 'the scrim gone too');
  });

  await t.test('a preview over the scrim: overlay-open shows it, and its close clears it', async () => {
    // a fresh visit (see the viewer cases below)
    await load('#library');
    await p.ev("location.hash = '#preview/calm-river'");
    await soon("!document.getElementById('artifact-view').hidden && document.body.classList.contains('overlay-open') && !document.getElementById('scrim').hidden && getComputedStyle(document.getElementById('scrim')).opacity === '1'", 'the preview over the scrim');
    await p.click('#av-close');
    await soon("document.getElementById('artifact-view').hidden && !document.body.classList.contains('overlay-open') && document.getElementById('scrim').hidden", 'the preview closed, overlay-open cleared');
  });

  // the viewer's frame has loaded the artifact (a frame of its own process: the page hears it, as a load in the
  // capture phase on the frame with a src); armed after each visit's load, before the viewer opens
  const armLoad = () => p.ev("window.__avLoaded = false; if (!window.__avArmed) { window.__avArmed = true; document.addEventListener('load', (e) => { if (e.target.id === 'av-frame' && e.target.getAttribute('src')) window.__avLoaded = true; }, true); } true");
  const frameLoaded = () => p.ev('window.__avLoaded === true');
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
    // the viewer over a peek: closing it shows the peek again (a fresh visit, so each case's history is short;
    // see load())
    await load('#board');
    await openPeek(`#ticket/${T}`);
    // DEVTEAM_TEST_FRAME_LATENCY_MS=n holds the viewer's frame back until after the close is pressed, the order
    // CI's speed gives
    const FL = Number(process.env.DEVTEAM_TEST_FRAME_LATENCY_MS) || 0;
    const latency = (ms) => p.send('Network.emulateNetworkConditions', { offline: false, latency: ms, downloadThroughput: -1, uploadThroughput: -1 });
    if (FL) { await p.send('Network.enable'); await latency(FL); }
    // (taken off again however the section ends, so a later subtest's failure is never the knob's)
    try {
      await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
      await soon("!document.getElementById('artifact-view').hidden", 'the viewer over the peek');
      await p.click('#av-close');
      await soon(`document.getElementById('artifact-view').hidden && location.hash === '#ticket/${T}'`, 'the viewer closed');
      assert.ok(await p.ev(isOpen), 'the peek is still open');
      assert.ok(await p.ev(scrimShown), 'with its scrim');
      await closePeek();
    } finally {
      if (FL) await latency(0).catch(() => {});
    }
    // the viewer over a review: closing it leaves the review's scrim dark (R1)
    await load('#library');
    await p.ev("location.hash = '#review-preview?path=review%2Fpage.html&ref=main'");
    await soon(`!document.getElementById('review-view').hidden && ${scrimShown}`, 'the review');
    await armLoad();
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon("!document.getElementById('artifact-view').hidden", 'the viewer over the review');
    await until(frameLoaded, "the viewer's frame loaded");
    await p.click('#av-close');
    await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#review-preview')", 'back to the review');
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(await p.ev(`!document.getElementById('review-view').hidden && document.body.classList.contains('overlay-open') && ${scrimShown}`), 'the review keeps its scrim');
    // and the review's own close then lands on the page under it: the viewer's close, its frame loaded, left no
    // frame entry for its history.back() to step instead (kit-303)
    await scrimClick();
    await soon("document.getElementById('review-view').hidden && document.getElementById('scrim').hidden && !document.body.classList.contains('overlay-open')", 'the review closed by the scrim after the viewer');
    assert.equal(await p.ev('location.hash'), '#library', 'the review closed to #library');
    await load('#board');
  });

  await t.test('a peek under a closed viewer closes to #board, and a reload shows the board (kit-303)', async () => {
    // the viewer's frame has loaded before its ×, as a person's has ('the shared scrim' closes it loaded or not)
    await load('#board');
    await openPeek(`#ticket/${T}`);
    await armLoad();
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon("!document.getElementById('artifact-view').hidden", 'the viewer over the peek');
    await until(frameLoaded, "the viewer's frame loaded");
    await p.click('#av-close');
    await soon(`document.getElementById('artifact-view').hidden && location.hash === '#ticket/${T}'`, 'the viewer closed by ×');
    await closePeek();
    // the peek's close lands on the page it was opened over, not on an entry the viewer's frame left
    // (kit-303): a reload then shows the board, with no peek
    assert.equal(await p.ev('location.hash'), '#board', 'the peek closed to #board');
    await p.ev('window.__beforeReload = true');
    await p.send('Page.reload');
    await soon("!window.__beforeReload && location.protocol === 'http:' && !!document.querySelector('main') && !document.querySelector('main.waiting')", 'the dashboard drawn again');
    assert.equal(await p.ev('location.hash'), '#board', 'reloaded on #board');
    const after = await p.ev(`({ closed: ${isClosed}, board: document.getElementById('board').classList.contains('on') })`);
    assert.deepEqual(after, { closed: true, board: true }, 'the reload shows the board, not the ticket');
    await load('#board');
  });

  await t.test('closing the viewer by its × adds no history entry once its frame has loaded (kit-303)', async () => {
    // back to the peek's entry, with the viewer's entry still ahead of it: an entry the close pushed for the frame
    // would have replaced that one, and the peek's next close would move only the frame
    const nav = () => p.send('Page.getNavigationHistory');
    await load('#board');
    await openPeek(`#ticket/${T}`);
    await armLoad();
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon("!document.getElementById('artifact-view').hidden", 'the viewer over the peek');
    await until(frameLoaded, "the viewer's frame loaded");
    const open = await nav();
    await p.click('#av-close');
    await soon(`document.getElementById('artifact-view').hidden && location.hash === '#ticket/${T}'`, 'the viewer closed by ×');
    await new Promise((r) => setTimeout(r, 400));
    const shut = await nav();
    assert.equal(shut.entries.length, open.entries.length, 'as many entries');
    assert.equal(shut.currentIndex, open.currentIndex - 1, 'one back');
    assert.match(shut.entries[open.currentIndex].url, /#artifact\//, "the viewer's entry is still ahead");
    await closePeek();
    await load('#board');
  });

  await t.test('closing the viewer by a route away adds no history entry once its frame has loaded (kit-303)', async () => {
    // history.length goes up by the new hash's entry, and by none for the frame
    await load('#library');
    await armLoad();
    await p.ev(`location.hash = '#artifact/main/${ids.artifact}'`);
    await soon("!document.getElementById('artifact-view').hidden", 'the viewer');
    await until(frameLoaded, "the viewer's frame loaded");
    const before = await p.ev('history.length');
    await p.ev("location.hash = '#board'");
    await soon("document.getElementById('artifact-view').hidden && document.getElementById('board').classList.contains('on')", 'the viewer closed by a route');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await p.ev('history.length'), before + 1, "the route's entry only");
    await load('#board');
  });

  await t.test('the top-right button stays reachable beside the peek', async () => {
    const m = () => p.ev(`(() => { ${SEEN}
      const tt = document.querySelector('.pagebar .tt'), tp = document.getElementById('tt-peek'), d = document.getElementById('drawer');
      const r = tp?.getBoundingClientRect(), tr = tt.getBoundingClientRect(), dr = d.getBoundingClientRect();
      const hit = r && r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      const ttAt = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
      return { ttSeen: seen(tt), ttVis: getComputedStyle(tt).visibility, tpSeen: seen(tp), right: r?.right, top: r?.top, ttTop: tr.top, drawerLeft: dr.left, hit: !!(hit && hit.closest('#tt-peek')),
        ttOnTop: !!(ttAt && ttAt.closest('.pagebar .tt')), tpPointer: tp ? getComputedStyle(tp).pointerEvents : null, text: tp?.textContent.trim(), ttText: tt.textContent.trim(), onBody: tp?.parentElement === document.body, ids: document.querySelectorAll('#inbox-btn-n').length, tpIds: tp ? tp.querySelectorAll('[id]').length : -1 };
    })()`);
    // no peek: the mirror isn't shown, .tt is
    let v = await m();
    assert.ok(v.onBody, '#tt-peek is on <body>');
    assert.equal(v.tpSeen, false, 'no peek: #tt-peek not shown');
    assert.equal(v.ttSeen, true, 'no peek: .tt shown');
    // and not clickable where it would sit: what is there is not it, and it takes no pointer
    assert.equal(v.hit, false, 'no peek: elementFromPoint where #tt-peek sits is not it');
    assert.equal(v.tpPointer, 'none', 'no peek: #tt-peek takes no pointer');
    assert.ok(v.ttOnTop, 'no peek: .tt takes the click at its place');
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
    // no room beside the peek (840px and below): no mirror, and .tt is left as it is (under the peek)
    for (const [w, h] of [[800, 800], [720, 800]]) {
      await size(w, h);
      await soon(`(() => { ${SEEN} const tp = document.getElementById('tt-peek'); return innerWidth === ${w} && getComputedStyle(tp).display === 'none' && !seen(tp); })()`, `${w}px: #tt-peek not rendered`);
      v = await m();
      assert.equal(v.tpSeen, false, `${w}px: #tt-peek not shown`);
      assert.notEqual(v.ttVis, 'hidden', `${w}px: .tt not visibility: hidden`);
      assert.equal(v.ttOnTop, false, `${w}px: .tt is under the peek`);
    }
    await size(1440, 900);
    await soon(`(() => { ${SEEN} return seen(document.getElementById('tt-peek')) && getComputedStyle(document.getElementById('tt-peek')).opacity === '1'; })()`, '#tt-peek shown again');
    // its click is .tt's
    await p.ev("window.__ttc = 0; document.querySelector('.pagebar .tt').addEventListener('click', () => { window.__ttc++; }); void 0");
    await p.click('#tt-peek');
    await soon('window.__ttc === 1', ".tt's click ran");
    // .tt opens the Threads panel beside the peek (kit-89): the peek closed, then the panel
    await soon("document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'", 'the Threads panel, at rest');
    await p.click('#drawer-close');
    await soon(isClosed, 'the peek closed');
    if (await p.ev("document.body.classList.contains('threads-open')")) await p.click('#th-close');
    await soon("!document.body.classList.contains('threads-open')", 'the panel closed');
    await soon(`(() => { ${SEEN} return !seen(document.getElementById('tt-peek')) && seen(document.querySelector('.pagebar .tt')); })()`, 'no peek: .tt again');
  });
});

// Every peek on test/lib/kit.mjs's peekFixture: the hash that opens each of its records, and the
// peek kind it draws (an open question and an artifact open no peek, so they are not here).
const peekHashes = (ids) => {
  const e = encodeURIComponent;
  return {
    ticket: ['ticket', `#ticket/${e(ids.ticket)}`], ticketMerged: ['ticket', `#ticket/${e(ids.ticketMerged)}`], ticketReplaced: ['ticket', `#ticket/${e(ids.ticketReplaced)}`], goal: ['goal', `#goal/${e(ids.goal)}`], feature: ['feature', `#feature/${e(ids.feature)}`], story: ['story', `#story/${e(ids.story)}`],
    release: ['release', `#release/${e(ids.release)}`], wave: ['wave', `#wave/${e(ids.wave)}`], milestone: ['milestone', `#milestone/${e(ids.milestone)}`],
    act: ['act', `#act/${e(ids.act)}`], actUnderDecision: ['act', `#act/${e(ids.actUnderDecision)}`], actCorrected: ['act', `#act/${e(ids.actCorrected)}`],
    decision: ['decision', `#decision/${e(ids.decision)}`], decisionNotMine: ['decision', `#decision/${e(ids.decisionNotMine)}`],
    lesson: ['lesson', `#lesson/${e(ids.lesson)}`], lessonOwner: ['lesson', `#lesson/${e(ids.lessonOwner)}`], problem: ['problem', `#problem/${e(ids.problem)}`], incident: ['problem', `#problem/${e(ids.incident)}`],
    signal: ['signal', `#signal/${e(ids.signal)}`], observation: ['observation', `#observation/${e(ids.observation)}`], learning: ['learning', `#learning/${e(ids.learning)}`],
    retro: ['retro', `#retro/${e(ids.retro)}`], thread: ['thread', `#thread/${e(ids.thread)}`], planner: ['planner', `#planner/${e(ids.planner)}`],
    qAnswered: ['q', `#q/${e(ids.qAnswered)}`], qDefaulted: ['q', `#q/${e(ids.qDefaulted)}`], qWithdrawn: ['q', `#q/${e(ids.qWithdrawn)}`], qLong: ['q', `#q/${e(ids.qLong)}`],
    file: ['file', `#file?path=${e(ids.file)}`], fileDiagram: ['file', `#file?path=${e(ids.fileDiagram)}`], fileImage: ['file', `#file?path=${e(ids.fileImage)}`],
    fileHtml: ['file', `#file?path=${e(ids.fileHtml)}`], filePdf: ['file', `#file?path=${e(ids.filePdf)}`], governanceFile: ['file', `#file?path=${e(ids.governanceFile)}`],
    sensorHttp: ['sensor', `#sensor/${e(ids.sensorHttp)}`], sensorReader: ['sensor', `#sensor/${e(ids.sensorReader)}`],
  };
};
// What "How it changes" says for each fixture record (spec §2.2): a selector its value holds, or words in it
const SHIFT = 'Shift+click it where it shows on its page';
const howCases = (ids) => {
  const e = encodeURIComponent;
  const thread = (subject) => ({ sel: `button[type="button"][data-thread-on="${subject}"]` });
  return {
    act: { sel: 'a[href="#loop?lt=act"]', text: 'Correct, on its row in Self Improvement' },
    actUnderDecision: { sel: `a[href="#decision/${e(ids.decision)}"]`, text: 'Correct its decision' },
    actCorrected: { text: 'Corrected by' },
    decision: { sel: 'a[href="#loop?lt=decide"]', text: 'Correct, on its row in Self Improvement' },
    decisionNotMine: thread(`decision:${ids.decisionNotMine}`),
    qDefaulted: { sel: `a[href="#inbox"][data-answered-go="${ids.qDefaulted}"]`, text: 'Overrule it from its card in the Inbox' },
    qAnswered: { ...thread(`question:${ids.qAnswered}`), text: 'Settled; to raise it again' },
    qWithdrawn: { ...thread(`question:${ids.qWithdrawn}`), text: 'Settled; to raise it again' },
    qLong: thread(`question:${ids.qLong}`),
    thread: { text: 'Reply in its thread' },
    governanceFile: { text: 'lands with your yes' },
    goal: thread(`goal:${ids.goal}`), ticket: thread(`ticket:${ids.ticket}`), planner: thread(`planner:${ids.planner}`), lesson: thread(`lesson:${ids.lesson}`),
    ticketMerged: thread(`ticket:${ids.ticketMerged}`), ticketReplaced: thread(`ticket:${ids.ticketReplaced}`), lessonOwner: thread(`lesson:${ids.lessonOwner}`),
    problem: thread(`problem:${ids.problem}`), incident: thread(`problem:${ids.incident}`), observation: thread(`observation:${ids.observation}`),
    ...Object.fromEntries(['feature', 'story', 'release', 'wave', 'milestone', 'signal', 'learning', 'retro', 'sensorHttp', 'sensorReader', 'file', 'fileDiagram', 'fileImage', 'fileHtml', 'filePdf'].map((k) => [k, { text: SHIFT, sel: 'a[href^="#"]' }])),
  };
};
// the peek drawn in full: its kind, its properties first, its History card last and loaded
const peekDrawn = (kind) => `(() => { const b = document.getElementById('drawer-body'), last = b.lastElementChild;
  return !document.getElementById('drawer').hidden && DRAWER.kind === ${JSON.stringify(kind)} && !!b.querySelector('section.attrs') && !!last && last.matches('.psect') && /^History$/.test(last.querySelector('.card-head')?.textContent.trim() ?? '') && !last.querySelector('.loading'); })()`;

// The design's peek inventory (project/designs/a-cleaner-more-consistent-dashboard.md, "Every detail
// and widget stays"; spec §2.4), one row per item: kind (the design's kind), item (its words), on (the
// fixture record whose peek draws it, a key of peekHashes) and selectorOrText, read in the peek's body:
//   'dt:<key>'               a property with that key and a value;
//   'sect:<title>'           a section card with that title and a body;
//   either, then ' >> <css>' something in it, or ' >> text:<words>' words in it;
//   '<css>' or 'text:<words>' in the whole body;
//   'stored:<type>'          every stored field: each row the page's stored-field formatter makes of the
//                            record's fields is a key in the first properties list.
// inject (with why): page code run just before a redraw, where the fixture can't carry the item (a
// field the kit never writes in a test project); it patches the page's own data (PEEKS, DATA), and
// the item is read in the same turn, so no refresh can come between.
const PATCH_PEEK = 'const patchPeek = (kind, id, f) => { const k = peekKey(kind, id); const v = structuredClone(PEEKS.get(k)); f(v); PEEKS.set(k, v); };';
const inventory = (ids) => {
  const J = JSON.stringify;
  const row = (kind, on, item, selectorOrText, extra = {}) => ({ kind, on, item, selectorOrText, ...extra });
  // one incident in every stage at once: its decision, its question to you, its fix merged, its
  // verify window and a regression; the kit gets there only through triage, a fix ticket's merge, a
  // deploy and a regression, and one incident's stage is one of them
  const incident = { why: 'an incident reaches decision, question, fix, verify and regressed only through triage, a merged fix, a deploy and a regression',
    inject: `${PATCH_PEEK} patchPeek('problem', ${J(ids.incident)}, (v) => Object.assign(v.incident, { decision: ${J(ids.decision)}, question: { id: ${J(ids.qDefaulted)}, status: 'defaulted', default: '8080', deadline: new Date().toISOString() }, ticket: ${J(ids.ticket)}, merged: 'abcdef1234567890', verify: { until: new Date(Date.now() + 864e5).toISOString(), assumed: true, regressed: ['abcdef1234567890'] } }));` };
  return [
    // ---- ticket: every stored field; computed rows; the handoff; time per phase; gate runs; spend; the graph
    row('ticket', 'ticket', 'every stored field', 'stored:ticket'),
    ...['Title', 'Feature', 'Component', 'Kind', 'Size', 'Risk', 'Serves', 'Waits on', 'Contracts', 'Touches'].map((k) => row('ticket', 'ticket', k.toLowerCase(), `dt:${k}`)),
    row('ticket', 'ticket', 'links', 'dt:Links >> text:docs-site'),
    row('ticket', 'ticket', 'done when', 'dt:Done when >> ul li'),
    row('ticket', 'ticket', 'one-way doors', 'dt:One-way doors'),
    row('ticket', 'ticketReplaced', 'replaced by', `dt:Replaced by >> a[href="#ticket/${encodeURIComponent(ids.ticket)}"]`),
    row('ticket', 'ticket', 'on hold', 'dt:On hold >> text:until the processor is chosen'),
    row('ticket', 'ticket', 'notes', 'dt:Notes'),
    row('ticket', 'ticket', 'created', 'dt:Created'),
    row('ticket', 'ticket', 'last changed', 'dt:Last changed'),
    row('ticket', 'ticket', 'Status', 'dt:Status'),
    row('ticket', 'ticket', 'Documents', 'dt:Documents >> .links a'),
    row('ticket', 'ticket', 'Reviews', 'dt:Reviews >> text:approved'),
    row('ticket', 'ticket', 'Blocks', 'dt:Blocks >> a[href="#ticket/pay-02-receipt"]'),
    row('ticket', 'ticket', 'Wave', 'dt:Wave >> a[href^="#wave/"]'),
    row('ticket', 'ticket', 'Ships in', `dt:Ships in >> a[href="#release/${encodeURIComponent(ids.release)}"]`),
    row('ticket', 'ticket', 'Spent', 'dt:Spent >> text:$2.40'),
    row('ticket', 'ticket', 'Branch', 'dt:Branch >> text:ticket/pay-01-card'),
    row('ticket', 'ticketMerged', 'Merged', 'dt:Merged >> code'),
    row('ticket', 'ticket', 'the handoff', 'sect:Handoff >> text:the expiry field is next'),
    row('ticket', 'ticket', 'time per phase', 'sect:Time per phase so far >> .phase-strip .ph'),
    row('ticket', 'ticket', 'gate runs ✓', 'sect:Gate runs >> .gate-dot.ok'),
    row('ticket', 'ticket', 'gate runs ✗', 'sect:Gate runs >> .gate-dot.fail'),
    row('ticket', 'ticket', 'gate runs ≈', 'sect:Gate runs >> .gate-dot.flaky'),
    row('ticket', 'ticket', 'gate runs slow', 'sect:Gate runs >> .badge.medium'),
    row('ticket', 'ticket', 'gate runs flaky', 'sect:Gate runs >> .badge.high'),
    row('ticket', 'ticket', 'spend over time', 'sect:Spend over time >> svg'),
    row('ticket', 'ticket', 'the dependency graph', 'sect:Dependencies >> .diagram-wrap'),
    // ---- goal
    row('goal', 'goal', 'every stored field', 'stored:goal'),
    row('goal', 'goal', 'outcome', 'dt:Outcome >> text:admins pay alone'),
    row('goal', 'goal', 'horizon', 'dt:Horizon'),
    // the stored measure reads Measured by in the goal peek (kit-90 spec §5)
    row('goal', 'goal', 'measure', 'dt:Measured by >> text:cards taken a day'),
    row('goal', 'goal', 'numbered milestones', `dt:Milestones >> ol li a[href^="#milestone/"]`),
    row('goal', 'goal', 'preconditions with "no plan yet"', 'dt:Preconditions >> ol >> text:no plan yet'),
    row('goal', 'goal', 'not in scope', 'dt:Not in scope >> text:refunds'),
    row('goal', 'goal', 'hold', 'dt:Hold >> text:waiting on the processor'),
    row('goal', 'goal', 'plan after', 'dt:Plan after'),
    row('goal', 'goal', 'approved', `dt:Approved >> a[href="#q/${encodeURIComponent(ids.qGoalChange)}"]`),
    row('goal', 'goal', 'State', 'dt:State >> .badge'),
    row('goal', 'goal', 'Why it matters: level', 'dt:Why it matters >> text:of 4'),
    row('goal', 'goal', 'Why it matters: rationale', 'dt:Why it matters >> text:checkout moves the number'),
    row('goal', 'goal', 'Why it matters: who and when', 'dt:Why it matters >> text:Judged by the supervisor'),
    row('goal', 'goal', 'Why it matters: the decision', 'dt:Why it matters >> a[href^="#decision/"]'),
    row('goal', 'goal', 'Why it matters: the strategy', 'dt:Why it matters >> a[href*="strategy.md"]'),
    row('goal', 'goal', 'Design', 'dt:Design >> a'),
    row('goal', 'goal', 'Forecast per milestone', 'dt:Forecast >> ol li:nth-child(2)'),
    row('goal', 'goal', 'Features', `dt:Features >> a[href="#feature/${encodeURIComponent(ids.feature)}"]`),
    row('goal', 'goal', 'Planners', `dt:Planners >> a[href="#planner/${encodeURIComponent(ids.planner)}"]`),
    row('goal', 'goal', 'Your verdicts', 'dt:Your verdicts >> ul li b >> text:Approve'),
    row('goal', 'goal', 'Questions', `dt:Questions >> a[href="#q/${encodeURIComponent(ids.qAnswered)}"]`),
    row('goal', 'goal', 'the step bar', '.steps'),
    row('goal', 'goal', 'next step', '.goal-next'),
    row('goal', 'goal', 'Readings', 'sect:Readings >> svg'),
    row('goal', 'goal', 'the design\'s TL;DR', 'sect:Design: the TL;DR >> .tldr'),
    row('goal', 'goal', 'Problems that threaten it', `sect:Problems that threaten it >> a[href="#problem/${encodeURIComponent(ids.problem)}"]`),
    row('goal', 'goal', 'Decisions and acts', 'sect:Decisions and acts >> ol.tl li'),
    row('goal', 'goal', 'the progress block', 'sect:Progress >> .no-shell .board'),
    // ---- feature, story, release, wave, milestone
    row('feature', 'feature', 'stored fields', 'stored:feature'),
    ...['Title', 'Goals', 'Stories', 'Design', 'Notes'].map((k) => row('feature', 'feature', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    ...['Status', 'Milestones', 'Releases', 'Waves'].map((k) => row('feature', 'feature', k, `dt:${k}`)),
    row('feature', 'feature', 'Planner', 'dt:Planner', { why: 'a feature is planned before it is on the roadmap, so a planner at work on a feature with a peek takes a re-plan',
      inject: `DATA.planners = [...(DATA.planners || []), { feature: ${J(ids.feature)}, title: 'Pay', goals: [], tickets: 0, branch: 'plan/pay', window: false, waiting_on_supervisor: [], waiting_on_owner: [] }];` }),
    row('feature', 'feature', 'Plan reviews', 'dt:Plan reviews >> text:approved', { why: 'its plan PR\'s reviews are read from a planner\'s branch, which a feature on the roadmap no longer has',
      inject: `${PATCH_PEEK} patchPeek('feature', ${J(ids.feature)}, (v) => { v.plan_reviews = [{ stage: 'plan', pass: 1, verdict: 'APPROVE', reviewer: 'claude' }]; });` }),
    row('feature', 'feature', 'the design\'s TL;DR', 'sect:Design: the TL;DR >> .tldr'),
    row('feature', 'feature', 'the dependency graph grouped by wave', 'sect:Dependencies >> text:Wave'),
    row('feature', 'feature', 'the progress block', 'sect:Progress >> .no-shell'),
    row('story', 'story', 'stored text', 'dt:Text >> text:admin adds a card'),
    row('story', 'story', 'stored release', `dt:Release >> a[href="#release/${encodeURIComponent(ids.release)}"]`),
    row('story', 'story', 'Feature', `dt:Feature >> a[href="#feature/${encodeURIComponent(ids.feature)}"]`),
    row('story', 'story', 'the progress block', 'sect:Progress >> .no-shell'),
    ...['Tagged', 'Stories', 'Features'].map((k) => row('release', 'release', k, `dt:${k}`)),
    row('release', 'release', 'Readiness', 'sect:Readiness >> ul li'),
    row('release', 'release', 'Changelog', `sect:Changelog >> a[href="#ticket/${encodeURIComponent(ids.ticketMerged)}"]`),
    row('release', 'release', 'the progress block', 'sect:Progress >> .no-shell'),
    row('wave', 'wave', 'Features', 'dt:Features'),
    row('wave', 'wave', 'Waiting on', 'dt:Waiting on >> a[href^="#ticket/"]'),
    row('wave', 'wave', 'the progress block', 'sect:Progress >> .no-shell'),
    ...['Title', 'Target', 'Preconditions', 'Tickets'].map((k) => row('milestone', 'milestone', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    ...['Goal', 'Status', 'Features'].map((k) => row('milestone', 'milestone', k, `dt:${k}`)),
    row('milestone', 'milestone', 'Forecast', 'dt:Forecast'),
    row('milestone', 'milestone', 'Readings with the milestone\'s target', 'sect:Readings >> text:this milestone (1)'),
    row('milestone', 'milestone', 'the progress block', 'sect:Progress >> .no-shell'),
    // ---- act and decision
    row('act', 'actUnderDecision', 'every stored field', 'stored:act'),
    ...['What', 'Class', 'Decision', 'Given', 'About', 'Reversible'].map((k) => row('act', 'actUnderDecision', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    row('act', 'actUnderDecision', 'Under', 'dt:Under'),
    row('act', 'actUnderDecision', 'lineage', 'sect:How it came about, and what came of it >> .lineage'),
    row('act', 'actUnderDecision', 'What its instructions carried', `sect:What its instructions carried >> a[href="#lesson/${encodeURIComponent(ids.lesson)}"]`),
    row('act', 'actUnderDecision', 'The decision it carried out', `sect:The decision it carried out >> a[href="#decision/${encodeURIComponent(ids.decision)}"]`),
    row('act', 'actUnderDecision', 'What it cites', `sect:What it cites >> a[href="#goal/${encodeURIComponent(ids.goal)}"]`),
    row('decision', 'decision', 'every stored field', 'stored:decision'),
    ...['What', 'Class', 'Authority', 'Approved by', 'Rests on', 'Rationale', 'About', 'Reversible'].map((k) => row('decision', 'decision', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    row('decision', 'decision', 'Under', 'dt:Under'),
    row('decision', 'decision', 'Its class now', 'dt:Its class now'),
    row('decision', 'decision', 'lineage', 'sect:How it came about, and what came of it >> .lineage'),
    row('decision', 'decision', 'The answer it rests on', `sect:The answer it rests on >> a[href="#q/${encodeURIComponent(ids.qDefaulted)}"]`),
    row('decision', 'decision', 'What it drew on', `sect:What it drew on (not its authority) >> a[href="#lesson/${encodeURIComponent(ids.lesson)}"]`),
    row('decision', 'decision', 'Carried out by', `sect:Carried out by >> a[href="#act/${encodeURIComponent(ids.actUnderDecision)}"]`),
    row('decision', 'decisionRule', 'The standing rule it rests on', `sect:The standing rule it rests on >> a[href="#lesson/${encodeURIComponent(ids.lesson)}"]`),
    // ---- lesson and knowledge (one opener)
    row('lesson', 'lesson', 'every stored field', 'stored:knowledge'),
    ...['Statement', 'Kind', 'Status', 'Scope', 'Evidence'].map((k) => row('lesson', 'lesson', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    row('lesson', 'lesson', 'stored statement, its value', 'dt:Statement >> text:payments time out under load'),
    row('lesson', 'lesson', 'stored evidence, its value', `dt:Evidence >> a[href="#observation/${encodeURIComponent(ids.observation)}"]`),
    row('lesson', 'lessonOwner', 'stored plain', 'dt:In plain words >> text:Ask the owner before the checkout changes processor.'),
    row('lesson', 'lesson', 'Goes to', 'dt:Goes to'),
    row('lesson', 'lessonOwner', 'the plain-words paragraph', 'text:Ask the owner before the checkout changes processor.'),
    row('lesson', 'lessonOwner', 'the Inbox link', 'a.linkish[href="#inbox"]'),
    row('lesson', 'lesson', 'the supervisor-decides note', 'text:the supervisor keeps or retires it itself'),
    row('lesson', 'lesson', 'lineage', 'sect:How it came about, and what came of it >> .lineage'),
    row('lesson', 'lesson', 'The signals it came from', 'sect:The signals it came from >> ul li'),
    row('lesson', 'lesson', 'What it cites', `sect:What it cites >> a[href="#observation/${encodeURIComponent(ids.observation)}"]`),
    // ---- problem and incident
    row('problem', 'problem', 'every stored field', 'stored:problem'),
    ...['Title', 'Status', 'Severity', 'Realized', 'Threatens', 'About'].map((k) => row('problem', 'problem', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    row('problem', 'problem', 'stored title, its value', 'dt:Title >> text:the card form drops input'),
    row('problem', 'problem', 'stored threatens, its value', `dt:Threatens >> a[href="#goal/${encodeURIComponent(ids.goal)}"]`),
    row('problem', 'problem', 'lineage', 'sect:How it came about, and what came of it >> .lineage'),
    row('problem', 'problem', 'the status trail', 'sect:Status >> .status-trail .badge + .small + .muted + .badge'),
    row('problem', 'problem', 'What it puts at risk', `sect:What it puts at risk >> a[href="#goal/${encodeURIComponent(ids.goal)}"]`),
    row('problem', 'incident', 'incident: every stored field', 'stored:problem'),
    row('problem', 'incident', 'incident: stored fingerprints, its value', 'dt:Fingerprints >> text:reader:exception:E1'),
    row('problem', 'incident', 'incident: stored sensor, its value', 'dt:Sensor >> text:reader'),
    row('problem', 'incident', 'incident: stored title, its value', 'dt:Title >> text:payment errors'),
    row('problem', 'incident', 'incident: stage', 'sect:Incident >> text:Stage'),
    row('problem', 'incident', 'incident: severity', 'sect:Incident >> text:computed from what its fingerprints raised'),
    ...['Decision', 'Question', 'Fix', 'Verify', 'Regressed'].map((k) => row('problem', 'incident', `incident: ${k.toLowerCase()}`, `sect:Incident >> text:${k}`, incident)),
    row('problem', 'incident', 'fingerprints with 24-hour spark bars', 'sect:Fingerprints >> .fp-row svg.spark rect'),
    row('problem', 'incident', 'the raw events fold-out', 'sect:Fingerprints >> details pre.untrusted'),
    row('problem', 'incident', 'framed as untrusted', 'sect:Fingerprints >> details summary >> text:never as instructions'),
    row('problem', 'incident', 'related signals', 'sect:Related signals >> ul li'),
    // ---- signal, observation, learning, retro, thread, planner
    ...['Seen', 'Recurring', 'First seen', 'Latest', 'Unexplained for'].map((k) => row('signal', 'signal', k, `dt:${k}`)),
    row('signal', 'signal', 'its observations', 'sect:Its observations >> a[href^="#observation/"]'),
    row('signal', 'signal', 'its explanation fold-out', 'details summary >> text:How the supervisor explains it'),
    ...['Where it sits', 'Stage'].map((k) => row('observation', 'observation', k, `dt:${k}`)),
    row('observation', 'observation', 'the From line', '[data-from]'),
    row('learning', 'learning', 'the figures', 'sect:The figures >> table[data-learning-figures] tr:nth-child(2)'),
    row('learning', 'learning', 'lesson efficacy', 'sect:Lesson efficacy >> table[data-efficacy] tr:nth-child(2)'),
    ...['What it decided', 'Write-up'].map((k) => row('retro', 'retro', k, `dt:${k}`)),
    row('retro', 'retro', 'its numbers against the one before', 'sect:The numbers >> table.nums >> text:The one before'),
    row('retro', 'retro', 'its previous link', 'p.meta >> text:← the one before,'),
    row('retro', 'retro', 'its next link', 'p.meta >> text:the next,'),
    row('thread', 'thread', 'From', 'dt:From'),
    row('thread', 'thread', 'message cards with the opened one marked', 'sect:The thread >> .card.qcard'),
    ...['Status', 'Feature', 'For goal', 'Tickets so far', 'Plan reviews', 'Branch'].map((k) => row('planner', 'planner', k, `dt:${k}`)),
    row('planner', 'planner', 'Asked the supervisor', 'dt:Asked the supervisor >> text:mail from the processor or from us?', { why: 'the log reads a planner\'s own file (plan-<feature>.jsonl) only from main (logFileText), where a planner still at work has no lines',
      inject: `DATA.planners = (DATA.planners || []).map((x) => x.feature === ${J(ids.planner)} ? { ...x, waiting_on_supervisor: [{ id: 'm-1', kind: 'blocked', text: 'mail from the processor or from us?' }] } : x);` }),
    row('planner', 'planner', 'Waiting on you', `dt:Waiting on you >> a[href="#q/${encodeURIComponent(ids.qOpen)}"]`, { why: 'a planner waits on you through an open question linked to its plan branch, which the fixture\'s questions are not',
      inject: `DATA.planners = (DATA.planners || []).map((x) => x.feature === ${J(ids.planner)} ? { ...x, waiting_on_owner: [${J(ids.qOpen)}] } : x);` }),
    row('planner', 'planner', 'its design TL;DR', 'sect:Its design: the TL;DR >> .tldr'),
    row('planner', 'planner', 'its draft board', 'sect:Its draft >> .board .tcard'),
    row('planner', 'planner', 'its graph', 'sect:Its draft >> .diagram-wrap'),
    // ---- question
    row('q', 'qAnswered', 'every stored field', 'stored:question'),
    ...['Question', 'Kind', 'Goal', 'Recommendation', 'Answer', 'Context', 'Blocks'].map((k) => row('q', 'qAnswered', `stored ${k.toLowerCase()}`, `dt:${k}`)),
    row('q', 'qAnswered', 'stored question, its value', 'dt:Question >> text:Keep the receipts?'),
    row('q', 'qAnswered', 'stored context, its value', 'dt:Context >> text:the processor keeps a copy too'),
    row('q', 'qAnswered', 'stored answer, its value', 'dt:Answer >> text:Yes'),
    row('q', 'qAnswered', 'stored blocks, its value', `dt:Blocks >> a[href="#ticket/${encodeURIComponent(ids.ticket)}"]`),
    ...['Status', 'Settled', 'Took', 'Matched'].map((k) => row('q', 'qAnswered', k, `dt:${k}`)),
    row('q', 'qAnswered', 'context', '.ctx >> text:the processor keeps a copy too'),
    row('q', 'qAnswered', 'choices', 'ul.measure li >> text:keep them a year'),
    row('q', 'qAnswered', 'their effect for users', 'ul.measure li >> text:For users'),
    row('q', 'qAnswered', 'link chips with "changed since asked"', 'text:changed since asked', { why: 'the kit marks a link changed only on an open question (resolveQuestionLinks), and an open question opens the Inbox, not a peek',
      inject: `const q = DATA.ooda.answered.find((x) => x.id === ${J(ids.qAnswered)}); q.links = [{ title: 'The mock', artifact: 'peek-mock', at: 'main', href: '#artifact/main/peek-mock', changed: true }];` }),
    row('q', 'qAnswered', 'What it held up', `sect:What it held up >> a[href="#ticket/${encodeURIComponent(ids.ticket)}"]`),
    row('q', 'qAnswered', 'What used it', 'sect:What used it >> li'),
    // ---- file
    row('file', 'file', 'Version', 'dt:Version >> text:main'),
    row('file', 'file', 'Commits', 'dt:Commits'),
    row('file', 'file', 'the view bar', '.viewbar'),
    row('file', 'file', 'Rendered', '.viewbar [data-mdview="rendered"]'),
    row('file', 'file', 'Raw', '.viewbar [data-mdview="raw"]'),
    row('file', 'file', 'sanitized markdown', '.viewer .md[data-md="rendered"] h1'),
    row('file', 'fileDiagram', 'markdown with its diagrams', '.viewer .md[data-md="rendered"] figure.diagram svg'),
    row('file', 'fileImage', 'images', '.viewer img[src*="dot.png"]'),
    row('file', 'fileHtml', 'sandboxed HTML', '.viewer iframe[sandbox=""][src*="page.html"]'),
    row('file', 'fileHtml', 'HTML: Open in a new tab', 'p.meta a[target="_blank"][href*="page.html"] >> text:Open in a new tab'),
    row('file', 'filePdf', 'sandboxed PDF', '.viewer iframe[sandbox=""][src*="brief.pdf"]'),
    row('file', 'filePdf', 'PDF: Open in a new tab', 'p.meta a[target="_blank"][href*="brief.pdf"] >> text:Open in a new tab'),
    row('file', 'file', 'the view remembered in devteam.mdview', 'mdview:remembered', { custom: 'Raw chosen, then the peek opened again and the page loaded again: Raw each time' }),
    row('file', 'file', 'History as its commits', 'sect:History >> code'),
    // ---- sensor
    ...['State', 'Checks', 'Target', 'Uptime', 'Response time', 'Last check', 'Certificate'].map((k) => row('sensor', 'sensorHttp', `URL check: ${k}`, `dt:${k}`)),
    row('sensor', 'sensorHttp', 'URL check: the 24-hour chart', 'sect:Last 24 hours >> svg'),
    row('sensor', 'sensorHttp', 'URL check: the 7-day chart', 'sect:Last 7 days >> svg'),
    row('sensor', 'sensorHttp', 'URL check: p50/p95', 'sect:Last 24 hours >> text:p95'),
    row('sensor', 'sensorHttp', 'URL check: the target line', 'sect:Last 24 hours >> text:target p95 300ms'),
    row('sensor', 'sensorHttp', 'URL check: failed spans', 'sect:Last 24 hours >> text:had a failed check'),
    row('sensor', 'sensorHttp', 'URL check: failed checks', 'sect:Failed checks >> text:HTTP 503'),
    ...['State', 'Reads', 'Triage', 'Last run', 'Today', 'Invalid lines'].map((k) => row('sensor', 'sensorReader', `reader: ${k}`, `dt:${k}`)),
    row('sensor', 'sensorReader', 'reader: the ignored list', 'sect:Ignored >> text:a crawler, not a person'),
    row('sensor', 'sensorReader', 'reader: its CLI command', 'sect:Ignored >> text:sensor unignore reader:exception:E2 --owner'),
    row('sensor', 'sensorReader', 'reader: what it read', 'sect:What it read >> .fp-row'),
  ];
};
// In the page: an inventory row's selectorOrText, true when the peek's body holds it, else why not.
const INV_HAS = `(spec) => {
  const b = document.getElementById('drawer-body');
  if (spec.startsWith('stored:')) {
    const type = spec.slice(7), r = PEEKS.get(peekKey(DRAWER.kind, DRAWER.id))?.record;
    if (!r) return 'no record';
    const want = storedRows(type, r.fields, type, { id: DRAWER.id, record: r, set_by: r.set_by ?? {} }).filter(Boolean).map((x) => x[0]);
    const have = new Set([...(b.querySelector('section.attrs > dl.props')?.children ?? [])].filter((x) => x.tagName === 'DT').map((x) => x.textContent.trim()));
    const missing = want.filter((l) => !have.has(l));
    return want.length && !missing.length ? true : \`missing \${JSON.stringify(missing)} of \${JSON.stringify(want)}\`;
  }
  const parts = spec.split(' >> ');
  let scope = b;
  const head = parts[0];
  if (head.startsWith('dt:') || head.startsWith('sect:')) {
    parts.shift();
    if (head.startsWith('dt:')) {
      const dt = [...b.querySelectorAll('section.attrs dt')].find((x) => x.textContent.trim() === head.slice(3));
      if (!dt) return \`no key \${head.slice(3)}: \${[...b.querySelectorAll('section.attrs dt')].map((x) => x.textContent.trim()).join(', ')}\`;
      scope = dt.nextElementSibling;
    } else {
      const s = [...b.querySelectorAll('.psect')].find((x) => x.querySelector('.card-head')?.textContent.trim() === head.slice(5));
      if (!s) return \`no section \${head.slice(5)}: \${[...b.querySelectorAll('.psect .card-head')].map((x) => x.textContent.trim()).join(', ')}\`;
      scope = s.querySelector('.psect-body');
    }
    if (!parts.length) return scope && (scope.textContent.trim() || scope.querySelector('*')) ? true : 'empty';
  }
  for (const part of parts) {
    if (part.startsWith('text:')) return scope.textContent.includes(part.slice(5)) ? true : \`no "\${part.slice(5)}" in: \${scope.textContent.replace(/\\s+/g, ' ').slice(0, 300)}\`;
    const el = scope.querySelector(part);
    if (!el) return \`no \${part} in: \${scope.innerHTML.slice(0, 300)}\`;
    scope = el;
  }
  return true;
}`;

test('the peeks', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, size, soon, load } = await peekPage(t, { fixture: peekFixture, name: 'peeks' });
  await size(1440, 900);
  // Chrome throttles a page's navigations: past 200 in 10 s it drops the rest until the window ends
  // ("Throttling navigation to prevent the browser from hanging" on the console; the hash stays as it
  // was). Each open() costs 4 (two hash sets, each stamped by the router's replaceState), so a walk
  // over the kinds passes 200 in a few seconds. The page counts its own (the Navigation API's navigate
  // fires for each), and past NAV_BUDGET the walk goes on from a fresh visit.
  const NAV_BUDGET = 120;
  const visit = async () => {
    await load('#board');
    await p.ev("window.__navn = 0; navigation.addEventListener('navigate', () => { window.__navn++; }); void 0");
  };
  await visit();
  const H = peekHashes(ids);
  const open = async (key) => {
    const [kind, hash] = H[key];
    if (await p.ev('window.__navn') > NAV_BUDGET) await visit();
    await p.ev("location.hash = '#board'");
    await soon("!document.body.classList.contains('peek-open')", 'back on Board');
    // a hash that doesn't take is set again, but at most twice: more is the throttle back (or the app
    // moving the hash), told with the count and the hashes read in between ('#board' alone: dropped)
    const h = JSON.stringify(hash);
    const told = async () => `set again ${await p.ev('window.__resets')} times; read in between: ${JSON.stringify(await p.ev('[...window.__seen]'))}; ${await p.ev('window.__navn')} navigations on this visit`;
    await p.ev(`window.__resets = 0; window.__seen = new Set(); location.hash = ${h}; void 0`);
    await soon(`location.hash === ${h} || (window.__resets < 3 && (window.__resets++, window.__seen.add(location.hash), location.hash = ${h}), false) || window.__resets > 2`, `${key}: its hash`);
    if (await p.ev(`location.hash !== ${h}`)) assert.fail(`${key}: ${hash} did not take: ${await told()}`);
    if (await p.ev('window.__resets') > 0) t.diagnostic(`${key}: ${hash} ${await told()}`);
    return kind;
  };

  await t.test('the fixture draws every kind', async () => {
    const kinds = new Set(Object.values(H).map(([k]) => k));
    assert.deepEqual([...kinds].sort(), (await p.ev('Object.keys(TYPE_META)')).sort(), 'every peek kind has a record');
    for (const key of Object.keys(H)) {
      const kind = await open(key);
      await soon(`!document.getElementById('drawer').hidden && DRAWER.kind === ${JSON.stringify(kind)} && !!document.querySelector('#drawer-body section.attrs')`, `${key}: its peek`);
      // drawn from its record, not "not found" (whose title is the id); a planner, a file and a sensor are titled by their id
      if (!['planner', 'file', 'fileDiagram', 'fileImage', 'fileHtml', 'filePdf', 'governanceFile', 'sensorHttp', 'sensorReader', 'decisionNotMine'].includes(key)) {
        await soon(`(() => { const t = document.querySelector('#drawer-bar-title .dtitle')?.textContent.trim(); return !!t && t !== ${JSON.stringify(ids[key])}; })()`, `${key}: drawn from its record, not "not found"`);
      }
    }
  });

  await t.test('properties first', async () => {
    const how = howCases(ids);
    const untipped = [];
    // what a drawn wait that times out reports: the hashes and keys of late
    await p.ev("window.__hl = []; addEventListener('hashchange', () => window.__hl.push(location.hash)); addEventListener('keydown', (e) => window.__hl.push(`key ${e.key} on ${document.activeElement?.tagName}`), true); void 0");
    for (const key of Object.keys(H)) {
      const kind = await open(key);
      await soon(peekDrawn(kind), `${key}: drawn`).catch(async (e) => {
        const at = await p.ev("[(window.__hl || []).slice(-24).join(' | '), location.hash, DRAWER.kind, document.getElementById('drawer').hidden, [...document.getElementById('drawer-body').children].map((c) => `${c.tagName}.${c.className}`).join(' '), document.getElementById('drawer-body').lastElementChild?.textContent.slice(0, 200)]");
        throw new Error(`${e.message}: ${JSON.stringify(at)}`);
      });
      const m = await p.ev(`(() => {
        const b = document.getElementById('drawer-body'), first = b.firstElementChild, a = b.querySelector('section.attrs');
        const dts = [...b.querySelectorAll('dt')], dt0 = a?.querySelector('dl.props dt'), dd0 = dt0?.nextElementSibling;
        const probe = document.createElement('span'); probe.style.fontFamily = 'var(--mono)'; document.body.appendChild(probe);
        const mono = getComputedStyle(probe).fontFamily; probe.remove();
        const hc = dts.find((x) => x.textContent.trim() === 'How it changes');
        const last = b.lastElementChild;
        return { first: first?.matches('section.attrs'), firstDt: a?.querySelector('dl.props dt:first-of-type')?.textContent.trim(),
          untipped: dts.filter((x) => !(x.getAttribute('title') || '').trim()).map((x) => x.textContent.trim()),
          fonts: [...new Set(dts.map((x) => getComputedStyle(x).fontFamily))], mono,
          borders: dt0 && dd0 ? [getComputedStyle(dt0).borderTopWidth, getComputedStyle(dd0).borderTopWidth] : null,
          how: hc ? { html: hc.nextElementSibling.innerHTML, text: hc.nextElementSibling.textContent } : null,
          lastHead: last?.matches('.psect') ? last.querySelector('.card-head')?.textContent.trim() : last?.outerHTML.slice(0, 80) };
      })()`);
      assert.ok(m.first, `${key}: the body's first element is section.attrs`);
      assert.equal(m.firstDt, 'ID', `${key}: ID first`);
      untipped.push(...m.untipped.map((x) => `${key}: ${x}`));
      assert.deepEqual(m.fonts, [m.mono], `${key}: every key in the mono stack`);
      assert.deepEqual(m.borders, ['0px', '0px'], `${key}: no rule above the first row`);
      assert.ok(m.how, `${key}: a How it changes row`);
      const c = how[key];
      if (c.text) assert.ok(m.how.text.includes(c.text), `${key}: How it changes says "${c.text}": ${m.how.text}`);
      if (c.sel) assert.ok(await p.ev(`!![...document.querySelectorAll('#drawer-body dt')].find((x) => x.textContent.trim() === 'How it changes').nextElementSibling.querySelector(${JSON.stringify(c.sel)})`), `${key}: How it changes holds ${c.sel}: ${m.how.html}`);
      assert.equal(m.lastHead, 'History', `${key}: History last`);
      // the ID's tip on keyboard focus: Tab from the close × reaches the first key
      await p.ev("document.getElementById('drawer-close').focus(); void 0");
      await p.key('Tab');
      const tip = await p.ev(`(() => { const dt = document.activeElement; return { isId: dt?.matches('#drawer-body section.attrs dl.props dt') && dt.textContent.trim() === 'ID', title: dt?.getAttribute('title'), after: dt ? getComputedStyle(dt, '::after').content : null }; })()`);
      assert.ok(tip.isId, `${key}: Tab reaches the ID key`);
      assert.equal(tip.after, `"${tip.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`, `${key}: its tip shows on focus`);
      // Escape on a key blurs it (its tip goes) and leaves the peek open
      await p.key('Escape');
      assert.equal(await p.ev("document.activeElement?.matches?.('#drawer-body dt') ?? false"), false, `${key}: Escape blurs the key`);
      assert.equal(await p.ev("document.body.classList.contains('peek-open')"), true, `${key}: and the peek stays`);
    }
    assert.deepEqual(untipped, [], 'every key has a tooltip');
  });

  await t.test('may correct: only a call whose row the Decide tab draws', async () => {
    // the last row the Decide tab draws and the first it doesn't, both the fixture's calls
    const edge = await p.ev('(() => { const rs = DATA.ooda.decisions.filter((r) => !routine(r)); return { n: DECIDE_SHOWN, all: rs.length, last: rs[DECIDE_SHOWN - 1], first: rs[DECIDE_SHOWN], mine: rs.findIndex((r) => r.id === ' + JSON.stringify(ids.decisionNotMine) + ') }; })()');
    assert.equal(edge.n, 80);
    assert.ok(edge.all > edge.n, `more calls than the tab draws: ${edge.all}`);
    assert.ok(edge.mine >= edge.n, `decisionNotMine is past the tab's rows: at ${edge.mine}`);
    for (const r of [edge.last, edge.first]) assert.equal(r.kind, 'decision', `${r.id}: a decision`);
    // on the tab: the last drawn row has its Correct, the first undrawn one has no row
    await p.ev("location.hash = '#loop?lt=decide'");
    await soon(`!!document.querySelector('#decisions-feed [data-correct="dec:${edge.last.id}"]')`, 'the 80th row with its Correct');
    assert.equal(await p.ev(`!!document.querySelector('#decisions-feed [data-dec^="decision:${edge.first.id}:"]')`), false, 'no row for the 81st');
    const howOf = async (id) => {
      await p.ev("location.hash = '#board'");
      await soon("!document.body.classList.contains('peek-open')", 'back on Board');
      await p.ev(`location.hash = ${JSON.stringify(`#decision/${encodeURIComponent(id)}`)}`);
      await soon(`DRAWER.id === ${JSON.stringify(id)} && !!document.querySelector('#drawer-body section.attrs')`, `${id}: its peek`);
      return p.ev("[...document.querySelectorAll('#drawer-body dt')].find((x) => x.textContent.trim() === 'How it changes').nextElementSibling.innerHTML");
    };
    assert.match(await howOf(edge.last.id), /href="#loop\?lt=decide"/, 'the 80th: Correct, on its row');
    assert.match(await howOf(edge.first.id), new RegExp(`data-thread-on="decision:${edge.first.id}"`), 'the 81st: Start a thread');
    await p.ev("location.hash = '#board'");
    await soon("!document.body.classList.contains('peek-open')", 'back on Board');
  });

  await t.test('an answered card is anchored once: in the Inbox, never in a peek', async () => {
    await p.ev("location.hash = '#inbox'");
    await soon(`!!document.getElementById('a-${ids.qDefaulted}')`, 'the defaulted card in the Answered list');
    for (const hash of [`#q/${encodeURIComponent(ids.qDefaulted)}`, `#decision/${encodeURIComponent(ids.decision)}`]) {
      await p.ev(`location.hash = ${JSON.stringify(hash)}`);
      await soon(peekDrawn(hash.startsWith('#q/') ? 'q' : 'decision'), `${hash} over the Inbox`);
      assert.ok(await p.ev(`[...document.querySelectorAll('#drawer-body .card a[href="#q/${encodeURIComponent(ids.qDefaulted)}"]')].length > 0`), `${hash}: the answered card is in the peek`);
      assert.equal(await p.ev(`document.querySelectorAll('#a-${ids.qDefaulted}').length`), 1, `${hash}: one #a-<qid>`);
      assert.equal(await p.ev(`!!document.getElementById('a-${ids.qDefaulted}').closest('#drawer')`), false, `${hash}: and not in the peek`);
      await p.ev("location.hash = '#inbox'");
      await soon("!document.body.classList.contains('peek-open')", 'the peek closed');
    }
  });

  // Nothing permanent in a peek (spec §2.3): every control in every kind's body is one of the writes
  // §2.3 keeps (never clicked here), a thread starter (each clicked below), one that moves the peek or
  // the page (Open in side peek, the Answered link: checked elsewhere), or a click on it writes nothing
  // and leaves the peek on its record: the views (Rendered / Raw), Copy ID and anything else. Each
  // Start a thread drafts a thread on its own record; the lesson's Retire it is one of them.
  await t.test('no permanent action', async () => {
    const ALLOW = '[data-hold-id], [data-correct], [data-correct-send], [data-impact], [data-reason], [data-thread-on], [data-menu-open], [data-answered-go]';
    // a card in the peek that opens its own record's peek (a ticket card on a goal, a problem card): a
    // link (§5's peek inside a peek), not clicked in the loop; one per kind is clicked last, below
    const NAV = '[data-ticket], [data-open]';
    // every non-GET fetch, recorded (again on each fresh visit open() starts)
    const record = () => p.ev(`(() => { if (window.__writes) return; window.__writes = []; const real = window.fetch;
      window.fetch = (u, o) => { const m = String(o?.method ?? (u instanceof Request ? u.method : 'GET')).toUpperCase(); if (m !== 'GET' && m !== 'HEAD') window.__writes.push(\`\${m} \${u?.url ?? u}\`); return real(u, o); }; })(); void 0`);
    const writes = () => p.ev('window.__writes.splice(0)');
    const settle = () => new Promise((r) => setTimeout(r, 150));
    const drafted = [];
    const CONTROLS = '#drawer-body :is(button, input, select, textarea, form)';
    // the controls not on the allow-list, listed once before any click: each by the page's own
    // focusKey (the selector a redraw keeps) and its place among the matches, else its tag and its
    // place, so a redraw a click causes can't make the loop skip or repeat one
    const listControls = () => p.ev(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(CONTROLS)})];
      return all.filter((el) => !el.matches(${JSON.stringify(`${ALLOW}, ${NAV}`)})).map((el) => { const k = focusKey(el); const sel = k ? \`#drawer-body \${k}\` : ${JSON.stringify(CONTROLS)}; return { sel, nth: [...document.querySelectorAll(sel)].indexOf(el), what: el.outerHTML.slice(0, 120) }; }); })()`);
    const clickedPer = {};
    const navClicked = [];
    for (const key of Object.keys(H)) {
      const kind = await open(key);
      await soon(peekDrawn(kind), `${key}: drawn`);
      await record();
      await writes();
      const at = await p.ev('[DRAWER.kind, DRAWER.id]');
      const list = await listControls();
      clickedPer[key] = 0;
      for (const c of list) {
        const ok = await p.ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(c.sel)})[${c.nth}]; if (!el) return false; el.click(); return true; })()`);
        assert.ok(ok, `${key}: ${c.what} is still there to click`);
        clickedPer[key]++;
        await settle();
        assert.deepEqual(await writes(), [], `${key}: a click on ${c.what} writes nothing`);
        assert.deepEqual(await p.ev('[DRAWER.kind, DRAWER.id]'), at, `${key}: a click on ${c.what} leaves the peek on its record`);
      }
      assert.equal(clickedPer[key], list.length, `${key}: every control listed was clicked`);
      // each Start a thread (and Retire it on a lesson): a draft pinned to its record, nothing written
      const refs = await p.ev("[...document.querySelectorAll('#drawer-body [data-thread-on]')].map((b) => b.dataset.threadOn)");
      for (let i = 0; i < refs.length; i++) {
        await p.ev(`document.querySelectorAll('#drawer-body [data-thread-on]')[${i}].click(); void 0`);
        await settle();
        const d = await p.ev('TL.draft && { ref: TL.draft.subject?.kind === "item" ? TL.draft.subject.ref : null, title: TL.draft.title }');
        assert.equal(d?.ref, refs[i], `${key}: ${refs[i]} drafts a thread on its record`);
        assert.ok(d.title, `${key}: the draft has its record's title`);
        assert.deepEqual(await writes(), [], `${key}: ${refs[i]} writes nothing`);
        drafted.push(refs[i]);
        await p.ev('tlClose(); void 0');
      }
      // a card that opens its record: the peek moves to that record, and nothing is written
      const nav = await p.ev(`(() => { const el = [...document.querySelectorAll('#drawer-body :is(${NAV})')].find((x) => x.dataset.open && decodeURIComponent(x.dataset.open) !== decodeURIComponent(location.hash.slice(1))); if (!el) return null; const what = el.outerHTML.slice(0, 120); const open = el.dataset.open; el.click(); return { what, open }; })()`);
      if (nav !== null) {
        const want = decodeURIComponent(nav.open), k = want.startsWith('file?') ? 'file' : want.split('/')[0];
        await soon(`decodeURIComponent(location.hash.slice(1)) === ${JSON.stringify(want)} && DRAWER.kind === ${JSON.stringify(k)} && !document.getElementById('drawer').hidden`, `${key}: ${nav.what} opens its record ${want}`);
        await settle();
        assert.notDeepEqual(await p.ev('[DRAWER.kind, DRAWER.id]'), at, `${key}: the peek moved off its record`);
        assert.deepEqual(await writes(), [], `${key}: a click on ${nav.what} writes nothing`);
        navClicked.push(key);
      }
    }
    assert.ok(navClicked.includes('goal'), `a card in a peek was clicked, the goal peek's at least: ${navClicked.join(' ')}`);
    assert.ok(drafted.includes(`question:${ids.qAnswered}`) && drafted.includes(`decision:${ids.decisionNotMine}`), `the thread starters were clicked: ${drafted.join(' ')}`);
    // the loop clicked something: at least one control in all (the file's views at least), and on
    // each peek every control it listed
    const total = Object.values(clickedPer).reduce((a, b) => a + b, 0);
    assert.ok(total >= 1, `the loop clicked at least one control: ${JSON.stringify(clickedPer)}`);
    t.diagnostic(`non-allowed controls clicked per peek: ${JSON.stringify(clickedPer)}`);

    // the lesson's Retire it: a thread starter, no knowledge post
    await open('lesson');
    await soon(peekDrawn('lesson'), 'the lesson peek');
    await record();
    await writes();
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body [data-know]').length"), 0, 'no [data-know] in the lesson peek');
    const retire = await p.ev("(() => { const b = [...document.querySelectorAll('#drawer-body button')].find((x) => x.textContent.trim() === 'Retire it'); return b ? { on: b.dataset.threadOn ?? null, type: b.type } : null; })()");
    assert.deepEqual(retire, { on: `lesson:${ids.lesson}`, type: 'button' }, 'Retire it starts a thread on the lesson');
    await p.ev("[...document.querySelectorAll('#drawer-body button')].find((x) => x.textContent.trim() === 'Retire it').click(); void 0");
    await settle();
    assert.equal(await p.ev("TL.draft?.subject?.ref ?? null"), `lesson:${ids.lesson}`, 'Retire it: a draft pinned to the lesson');
    assert.deepEqual(await writes(), [], 'Retire it posts nothing');
    await p.ev('tlClose(); void 0');

    // read-only answered cards: no Overrule in the defaulted question's peek, nor in the decision's
    // "The answer it rests on" (the fixture's decision rests on the defaulted question)
    for (const key of ['qDefaulted', 'qAnswered', 'qWithdrawn', 'decision']) {
      const kind = await open(key);
      await soon(peekDrawn(kind), `${key}: drawn`);
      assert.equal(await p.ev("document.querySelectorAll('#drawer-body [data-overrule], #drawer-body [data-overrule-send]').length"), 0, `${key}: no Overrule in the peek`);
    }
    assert.ok(await p.ev(`[...document.querySelectorAll('#drawer-body .psect')].some((s) => s.querySelector('.card-head')?.textContent.trim() === 'The answer it rests on' && !!s.querySelector('a[href="#q/${encodeURIComponent(ids.qDefaulted)}"]'))`), 'the decision rests on the defaulted question');

    // the defaulted question's How it changes: the panel's Inbox tab beside the peek (kit-100), its Answered list
    // open, its card's Overrule focused
    await open('qDefaulted');
    await soon(peekDrawn('q'), 'the defaulted question');
    await p.ev(`document.querySelector('#drawer-body [data-answered-go="${ids.qDefaulted}"]').click(); void 0`);
    await soon(`document.body.classList.contains('threads-open') && document.querySelector('#th-tabs [role="tab"][data-tab="inbox"]')?.getAttribute('aria-selected') === 'true' && !document.getElementById('th-inbox').hidden && !!document.querySelector('#answered-wrap[open]') && document.activeElement === document.querySelector('input[data-overrule="${ids.qDefaulted}"]')`, 'the panel on Inbox, the Answered list open, the card\'s Overrule focused');
    assert.equal(await p.ev("document.body.classList.contains('peek-open')"), true, 'the peek stays open');
    assert.ok(await p.ev(`(() => { const r = document.getElementById('a-${ids.qDefaulted}').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })()`), 'the card in view');
    await p.ev("document.getElementById('answered-wrap').open = false; document.getElementById('th-close').click(); void 0");
    await soon("!document.body.classList.contains('threads-open')", 'the panel closed');

    // an open question's link: the panel's Inbox tab at its card, no peek
    await p.ev("location.hash = '#board'");
    await soon("location.hash === '#board' && !document.body.classList.contains('peek-open')", 'back on Board');
    await p.ev(`location.hash = ${JSON.stringify(`#q/${encodeURIComponent(ids.qOpen)}`)}`);
    await soon(`location.hash === '#board?th=inbox' && (() => { const c = document.getElementById(${JSON.stringify(`q-${ids.qOpen}`)}); if (!c) return false; const r = c.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; })()`, 'the panel\'s Inbox at the open question\'s card');
    assert.equal(await p.ev("document.body.classList.contains('peek-open')"), false, 'no peek');
    await p.ev("document.getElementById('th-close').click(); void 0");
    await soon("!document.body.classList.contains('threads-open')", 'the panel closed');
  });

  // Every detail stays (spec §2.4): one assertion per item of the design's peek inventory (the table
  // above), read on the peek of the fixture record that draws it. A row the page draws after the peek
  // (a thread's ticket, a sensor's series, a file's text) is read again for a few seconds first.
  await t.test('every detail stays: the peek inventory, item by item', async () => {
    // a decision on a standing rule, read here only (its How it changes isn't one of §2.2's cases)
    H.decisionRule = ['decision', `#decision/${encodeURIComponent(ids.decisionRule)}`];
    const rows = inventory(ids);
    const kinds = new Set(rows.map((r) => H[r.on]?.[0]));
    assert.deepEqual([...kinds].sort(), (await p.ev('Object.keys(TYPE_META)')).sort(), 'the inventory covers every peek kind');
    const groups = new Map();
    for (const r of rows) {
      assert.ok(H[r.on], `${r.item}: ${r.on} is a fixture record`);
      (groups.get(r.on) ?? groups.set(r.on, []).get(r.on)).push(r);
    }
    const failed = [];
    let asserted = 0;
    for (const [on, rs] of groups) {
      const kind = await open(on);
      await soon(peekDrawn(kind), `${on}: drawn`);
      for (const r of rs.filter((x) => !x.inject && !x.custom)) {
        const end = Date.now() + 8000;
        let got = await p.ev(`(${INV_HAS})(${JSON.stringify(r.selectorOrText)})`);
        while (got !== true && Date.now() < end) {
          await new Promise((res) => setTimeout(res, 250));
          got = await p.ev(`(${INV_HAS})(${JSON.stringify(r.selectorOrText)})`);
        }
        asserted++;
        if (got !== true) failed.push(`${r.kind} (${on}) ${r.item}: ${r.selectorOrText}: ${got}`);
      }
      // injected: the patch, the redraw and the read in one turn of the page
      const injected = rs.filter((x) => x.inject);
      for (const r of injected) {
        const got = await p.ev(`(() => { ${r.inject} redraw(); return (${INV_HAS})(${JSON.stringify(r.selectorOrText)}); })()`);
        asserted++;
        if (got !== true) failed.push(`${r.kind} (${on}) ${r.item} [injected: ${r.why}]: ${r.selectorOrText}: ${got}`);
      }
      // the page's own data back for the rows after: a fresh visit
      if (injected.length) await visit();
      // the view the owner chose is kept (localStorage devteam.mdview): Raw, then the peek again, then
      // a fresh load of the page; Rendered put back after
      for (const r of rs.filter((x) => x.custom)) {
        asserted++;
        const view = "(() => { const b = document.getElementById('drawer-body'); const raw = b.querySelector('pre[data-md=\"raw\"]'), md = b.querySelector('.md[data-md=\"rendered\"]'); return { pressed: b.querySelector('[data-mdview=\"raw\"]')?.getAttribute('aria-pressed'), raw: !!raw && !raw.hidden, md: !!md && md.hidden, stored: localStorage.getItem('devteam.mdview') }; })()";
        const want = { pressed: 'true', raw: true, md: true, stored: 'raw' };
        const seen = [];
        await p.ev("document.querySelector('#drawer-body [data-mdview=\"raw\"]').click(); void 0");
        await soon(`${view}.raw`, 'Raw shown');
        seen.push(['clicked', await p.ev(view)]);
        await open(on);
        await soon(`${peekDrawn('file')} && !!document.querySelector('#drawer-body pre[data-md="raw"]')`, `${on}: drawn again`);
        seen.push(['opened again', await p.ev(view)]);
        await visit();
        await open(on);
        await soon(`${peekDrawn('file')} && !!document.querySelector('#drawer-body pre[data-md="raw"]')`, `${on}: drawn after a load`);
        seen.push(['after a load', await p.ev(view)]);
        for (const [when, v] of seen) if (JSON.stringify(v) !== JSON.stringify(want)) failed.push(`${r.kind} (${on}) ${r.item} (${when}): ${JSON.stringify(v)}`);
        await p.ev("document.querySelector('#drawer-body [data-mdview=\"rendered\"]').click(); void 0");
        await soon("localStorage.getItem('devteam.mdview') === 'rendered'", 'Rendered put back');
      }
    }
    assert.equal(asserted, rows.length, 'every row was read');
    assert.deepEqual(failed, [], `inventory items missing from their peek (${failed.length} of ${rows.length})`);
  });

  // How it changes where the dashboard's own rows don't say (spec §2.2, §5): a correction read from the
  // peek's record, with and without who made it; a defaulted question past the Answered list.
  await t.test('How it changes from the record, and past the Answered list', async () => {
    const howText = "[...document.querySelectorAll('#drawer-body dt')].find((x) => x.textContent.trim() === 'How it changes')?.nextElementSibling.textContent.trim()";
    // a corrected act the dashboard holds no row for (older than its acts): the correction is the
    // record's own, and set_by names who made it
    await open('actCorrected');
    await soon(peekDrawn('act'), 'the corrected act');
    const fromRecord = await p.ev(`(() => { DATA.ooda.acts = DATA.ooda.acts.filter((x) => x.id !== ${JSON.stringify(ids.actCorrected)}); redraw(); return ${howText}; })()`);
    assert.equal(fromRecord, 'Corrected by you: the docs can wait', 'the correction, from the record');
    // a record whose set_by doesn't name the corrector: the correction, without "by"
    const noBy = await p.ev(`(() => { const k = peekKey('act', ${JSON.stringify(ids.actCorrected)}); const v = structuredClone(PEEKS.get(k)); delete v.record.set_by.corrected; PEEKS.set(k, v);
      DATA.ooda.acts = DATA.ooda.acts.filter((x) => x.id !== ${JSON.stringify(ids.actCorrected)}); redraw(); return ${howText}; })()`);
    assert.equal(noBy, 'Corrected: the docs can wait', 'no "by undefined" when the record does not say who');
    await visit();
    // a defaulted question past the Answered list's 80 (the list's length is the server's): it is in
    // no row the Inbox draws, so the fixture's one defaulted question is taken out of the list here.
    // Its peek is read-only and How it changes starts a thread on it, not a link to a card
    // that isn't there.
    await open('qDefaulted');
    await soon(peekDrawn('q'), 'the defaulted question');
    const past = await p.ev(`(() => { DATA.ooda.answered = DATA.ooda.answered.filter((x) => x.id !== ${JSON.stringify(ids.qDefaulted)}); redraw();
      const dd = [...document.querySelectorAll('#drawer-body dt')].find((x) => x.textContent.trim() === 'How it changes')?.nextElementSibling;
      const b = document.getElementById('drawer-body');
      window.__w = []; const real = window.fetch; window.fetch = (u, o) => { const m = String(o?.method ?? 'GET').toUpperCase(); if (m !== 'GET' && m !== 'HEAD') window.__w.push(m + ' ' + (u?.url ?? u)); return real(u, o); };
      const btn = dd?.querySelector('[data-thread-on]');
      const r = { text: dd?.textContent.trim(), on: btn?.dataset.threadOn ?? null, go: !!dd?.querySelector('[data-answered-go]'),
        writing: [...b.querySelectorAll('[data-overrule], [data-overrule-send], input, textarea, select, form')].map((x) => x.outerHTML.slice(0, 80)) };
      btn?.click();
      return r; })()`);
    assert.match(past.text, /^Settled; to raise it again/, `How it changes: ${past.text}`);
    assert.equal(past.on, `question:${ids.qDefaulted}`, 'a Start a thread on the question');
    assert.equal(past.go, false, 'no link to an Answered card that isn\'t there');
    assert.deepEqual(past.writing, [], 'read-only');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await p.ev('TL.draft?.subject?.ref ?? null'), `question:${ids.qDefaulted}`, 'Start a thread drafts a thread pinned to the question');
    assert.deepEqual(await p.ev('window.__w'), [], 'and writes nothing');
    await p.ev('tlClose(); void 0');
    await visit();
  });

  await t.test('notFound and loading keep the frame', async () => {
    const frame = (what, note) => p.ev(`(() => { const b = document.getElementById('drawer-body'), dts = [...b.querySelectorAll('section.attrs dl.props dt')].map((x) => x.textContent.trim()), last = b.lastElementChild;
      return { first: b.firstElementChild?.matches('section.attrs'), id: dts[0], how: dts.includes('How it changes'), history: last?.matches('.psect') && last.querySelector('.card-head')?.textContent.trim() === 'History', note: last?.querySelector('.psect-body')?.textContent.trim() }; })()`).then((m) => {
      assert.ok(m.first, `${what}: properties first`);
      assert.equal(m.id, 'ID', `${what}: ID`);
      assert.ok(m.how, `${what}: How it changes`);
      assert.ok(m.history, `${what}: History last`);
      assert.match(m.note, note, `${what}: History says so`);
    });
    // a record nobody logged: once its peek says so
    await p.ev("location.hash = '#ticket/kit-nope'");
    await soon(`!document.getElementById('drawer').hidden && DRAWER.id === 'kit-nope' && !!PEEKS.get(peekKey('ticket', 'kit-nope'))?.missing && /Nothing logged yet/.test(document.getElementById('drawer-body').lastElementChild?.textContent ?? '')`, 'the missing ticket');
    await frame('a missing record', /Nothing logged yet\./);
    // a peek fetch held open: the frame while it loads
    await load('#board');
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/peek*', requestStage: 'Request' }] });
    try {
      await p.ev(`location.hash = ${JSON.stringify(H.ticket[1])}`);
      await soon("!document.getElementById('drawer').hidden && DRAWER.kind === 'ticket' && !!document.querySelector('#drawer-body section.attrs')", 'the ticket peek, loading');
      await frame('a peek loading', /Loading/);
    } finally {
      await p.send('Fetch.disable');
    }
    await soon(peekDrawn('ticket'), 'the ticket peek, loaded');
  });
});

// Every row and card opens its record (spec §2.5, AC6): Board's ticket cards and Progress rows on a
// click and on Enter; every record card's title link and its ⋯ menu's Open in side peek; the one Copy
// ID; a click on the ⋯, a link or a control inside a card does only its own thing; the ticket and
// incident cards look as they did as buttons; peekFor gives every opener's hash, which route() opens.
test('rows and cards', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, size, soon, load } = await peekPage(t, { fixture: peekFixture, name: 'rows' });
  await size(1440, 900);
  const J = JSON.stringify;
  // Chrome's navigation throttle (see 'the peeks'): past NAV_BUDGET navigations a fresh visit
  const NAV_BUDGET = 120;
  const visit = async (hash) => {
    await load(hash);
    await p.ev("window.__navn = 0; navigation.addEventListener('navigate', () => { window.__navn++; }); void 0");
  };
  await visit('#board');
  // on a page, no peek open
  const on = async (hash) => {
    if (await p.ev('window.__navn') > NAV_BUDGET) await visit(hash);
    else if (await p.ev(`location.hash !== ${J(hash)}`)) await p.ev(`location.hash = ${J(hash)}; void 0`);
    await soon(`location.hash === ${J(hash)} && !document.body.classList.contains('peek-open') && document.getElementById('drawer').hidden`, `on ${hash}`);
  };
  // the peek a data-open value names: its hash (decoded) and its kind's drawer, open
  const opened = (open, what) => soon(`(() => { const want = ${J(open)}; const k = want.startsWith('file?') ? 'file' : want.split('/')[0];
    return decodeURIComponent(location.hash.slice(1)) === decodeURIComponent(want) && DRAWER.kind === k && !document.getElementById('drawer').hidden; })()`, what);
  const settle = () => new Promise((r) => setTimeout(r, 200));
  const enter = (expr) => p.ev(`(() => { const el = ${expr}; el.focus(); if (document.activeElement !== el) return 'not focused';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); return true; })()`);
  const CARDS = '.card[data-open], .tcard[data-open]';
  const T = ids.ticket;
  const tcard = `document.querySelector('#board [data-ticket="${T}"]')`;

  await t.test('Board: a ticket card opens on a click and on Enter', async () => {
    await on('#board');
    await soon(`!!${tcard}`, 'the ticket on Board');
    assert.deepEqual(await p.ev(`(() => { const c = ${tcard}; return [c.tagName, c.getAttribute('role'), c.getAttribute('tabindex'), decodeURIComponent(c.dataset.open ?? '')]; })()`), ['DIV', 'button', '0', `ticket/${T}`]);
    await p.ev(`${tcard}.click(); void 0`);
    await opened(`ticket/${T}`, 'a click on the card');
    await on('#board');
    assert.equal(await enter(tcard), true);
    await opened(`ticket/${T}`, 'Enter on the focused card');
  });

  await t.test('Progress: a row opens on a click and on Enter', async () => {
    await on('#progress');
    await soon("!!document.querySelector('#w-features .row')", 'the feature rows');
    const rows = await p.ev("[...document.querySelectorAll('#w-features .row, #w-stories .row, #w-releases .row, #w-waves .row')].map((r) => [r.dataset.open ?? null, r.getAttribute('tabindex')])");
    assert.ok(rows.length >= 4, `rows: ${J(rows)}`);
    for (const [open, tab] of rows) assert.ok(open && tab === '0', `every Progress row opens its record and takes focus: ${J(rows)}`);
    for (const [box, kind] of [['#w-features', 'feature'], ['#w-stories', 'story'], ['#w-releases', 'release'], ['#w-waves', 'wave']]) {
      await on('#progress');
      const row = `document.querySelector('${box} .row[data-open]')`;
      const open = await p.ev(`${row}.dataset.open`);
      assert.equal(open.split('/')[0], kind, `${box}: its record's kind`);
      await p.ev(`${row}.querySelector('.meter').click(); void 0`);
      await opened(open, `${box}: a click on the row`);
      await on('#progress');
      assert.equal(await enter(row), true);
      await opened(open, `${box}: Enter on the focused row`);
    }
  });

  // each page's record cards, where they are drawn
  const PLACES = [['#goals', '#goals-list'], ['#board', '#board-cols'], ['#loop?lt=observe', '#observations'], ['#loop?lt=orient', '#debt, #clusters, #problems, #knowledge'], ['#loop?lt=decide', '#decisions-feed'], ['#loop?lt=act', '#acts-feed'], ['#sensors', '#incidents, #sensor-feed']];
  const cardsIn = (sel) => `[...document.querySelectorAll(${J(sel)})].flatMap((x) => [...x.querySelectorAll(${J(CARDS)})])`;
  const DEC = 'const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };';

  await t.test('every record card: one ⋯ with Open in side peek and Copy ID, a title link, no Open link', async () => {
    const kinds = new Set();
    for (const [page, sel] of PLACES) {
      await on(page);
      await soon(`${cardsIn(sel)}.length > 0`, `${page}: its cards`);
      const cards = await p.ev(`(() => { ${DEC} return ${cardsIn(sel)}.map((c) => { const own = dec('#' + c.dataset.open);
        const menus = [...c.querySelectorAll('details.menu')].filter((m) => m.closest(${J(CARDS)}) === c);
        const pop = menus[0]?.querySelector('.pop'), mo = pop?.querySelector('[data-menu-open]'), cp = pop?.querySelector('[data-copy]');
        return { open: c.dataset.open, menus: menus.length, openIn: mo ? [mo.textContent.trim(), dec('#' + mo.dataset.menuOpen) === own] : null, copy: cp ? cp.textContent.trim() : null,
          title: (() => { const tl = [...c.querySelectorAll('a.title-link')].filter((a) => a.closest(${J(CARDS)}) === c && !a.closest('details.menu'));
            return tl.length > 0 && tl.every((a) => dec(a.getAttribute('href')) === own && !a.closest('.meta')) && (!!tl[0].closest('h4, .t, .act-head') || !!tl[0].querySelector(':scope > b, :scope > .badge')); })(), openLinks: [...c.querySelectorAll('a')].filter((a) => a.textContent.trim() === 'Open').length }; }); })()`);
      for (const c of cards) {
        kinds.add(decodeURIComponent(c.open).split('/')[0]);
        assert.deepEqual(c, { open: c.open, menus: 1, openIn: ['Open in side peek', true], copy: 'Copy ID', title: true, openLinks: 0 }, `${page}: ${c.open}`);
      }
    }
    for (const k of ['goal', 'ticket', 'observation', 'signal', 'problem', 'lesson', 'act', 'decision']) assert.ok(kinds.has(k), `a ${k} card was checked: ${[...kinds].join(' ')}`);
    // no goal card keeps an Open link (Upkeep's included)
    await on('#goals');
    assert.equal(await p.ev("[...document.querySelectorAll('#goals .card.goal a')].filter((a) => a.textContent.trim() === 'Open').length"), 0, 'no Open link on a goal card');
  });

  await t.test('a card opens on its title, on Open in side peek, and on a click on itself', async () => {
    for (const [page, sel] of PLACES) {
      await on(page);
      const n = await p.ev(`${cardsIn(sel)}.length`);
      for (let i = 0; i < n; i++) {
        const card = `${cardsIn(sel)}[${i}]`;
        await on(page);
        const open = await p.ev(`${card}.dataset.open`);
        await p.ev(`(() => { ${DEC} const c = ${card}; c.querySelector('a.title-link').click(); })(); void 0`);
        await opened(open, `${page}: ${open}, its title link`);
        await on(page);
        await p.ev(`(() => { const d = ${card}.querySelector('details.menu'); d.open = true; window.__menu = d; d.querySelector('[data-menu-open]').click(); })(); void 0`);
        await opened(open, `${page}: ${open}, Open in side peek`);
        assert.equal(await p.ev('window.__menu.open'), false, `${page}: ${open}, the menu closes`);
        if (i === 0) {
          await on(page);
          await p.ev(`${card}.click(); void 0`);
          await opened(open, `${page}: ${open}, a click on the card`);
        }
      }
    }
    // Enter on a focused goal and incident card (a ticket card's: above)
    for (const [page, sel] of [['#goals', '#goals-list .card.goal[data-open]'], ['#sensors', '#incidents .tcard[data-open]']]) {
      await on(page);
      const el = `document.querySelector(${J(sel)})`;
      const open = await p.ev(`${el}.dataset.open`);
      assert.deepEqual(await p.ev(`[${el}.getAttribute('role'), ${el}.getAttribute('tabindex')]`), ['button', '0'], `${sel}: a button to the keyboard`);
      assert.equal(await enter(el), true);
      await opened(open, `${sel}: Enter on the focused card`);
    }
    // a Loop card and a Sensors card (spec §2.5: a card that stands for a record, role=button, tabindex=0)
    for (const [page, sel] of [['#loop?lt=observe', '#observations .card[data-open]'], ['#sensors', '#sensor-feed .card[data-open]']]) {
      await on(page);
      await soon(`!!document.querySelector(${J(sel)})`, `${sel}: drawn`);
      assert.equal(await p.ev(`[...document.querySelectorAll(${J(sel)})].every((c) => c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0')`), true, `${sel}: every card a button to the keyboard`);
      const el = `document.querySelector(${J(sel)})`;
      const open = await p.ev(`${el}.dataset.open`);
      assert.equal(await enter(el), true);
      await opened(open, `${sel}: Enter on the focused card`);
      // Enter on a link inside one: the link's own thing (a link to another record goes there; the
      // title link to its own), never the card's handler; a real Enter on a focused link follows it
      await on(page);
      const link = await p.ev(`(() => { ${DEC} const cs = [...document.querySelectorAll(${J(sel)})];
        for (let i = 0; i < cs.length; i++) { const own = dec('#' + cs[i].dataset.open); const a = [...cs[i].querySelectorAll('a[href^="#"]')].filter((x) => !x.closest('details.menu')).find((x) => dec(x.getAttribute('href')) !== own) || cs[i].querySelector('a.title-link');
          if (a) { window.__a = a; return { own, href: dec(a.getAttribute('href')) }; } }
        return null; })()`);
      assert.ok(link, `${sel}: a card with a link`);
      assert.equal(await p.ev(`(() => { const a = window.__a; a.focus(); if (document.activeElement !== a) return 'not focused';
        const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }); a.dispatchEvent(ev); return ev.defaultPrevented ? 'the card took it' : true; })()`), true, `${sel}: Enter on a link is left to the link`);
      await p.ev('window.__a.click(); void 0');
      await soon(`decodeURIComponent(location.hash) === ${J(link.href)}`, `${sel}: the link's own place: ${link.href}`);
      await settle();
      assert.equal(await p.ev('decodeURIComponent(location.hash)'), link.href, `${sel}: still the link's, not the card's (${link.own})`);
    }
  });

  await t.test('Copy ID copies the id; copy refused says Select and copy', async (st) => {
    await on('#board');
    const copy = (ok) => p.ev(`(async () => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => { window.__copied.push(s); return ${ok ? 'Promise.resolve()' : "Promise.reject(new Error('refused'))"}; } } });
      const d = ${tcard}.querySelector('details.menu'); d.open = true; const b = d.querySelector('[data-copy]'); window.__cp = b; b.click(); return true; })()`);
    await copy(true);
    await soon("window.__cp.textContent === 'Copied'", 'Copied');
    assert.deepEqual(await p.ev('window.__copied'), [T], 'called with the id');
    await settle();
    assert.equal(await p.ev("location.hash === '#board' && !document.body.classList.contains('peek-open')"), true, 'Copy ID opens nothing');
    await st.test('copy refused', async () => {
      await on('#board');
      await copy(false);
      await soon("window.__cp.textContent === 'Select and copy'", 'Select and copy');
      assert.deepEqual(await p.ev('window.__copied'), [T]);
      assert.equal(await p.ev(`${tcard}.querySelector('details.menu .kv code')?.textContent`), T, 'the id is there to select');
    });
  });

  await t.test('inner controls keep their click', async () => {
    const still = async (page, what) => {
      await settle();
      assert.equal(await p.ev(`location.hash === ${J(page)} && !document.body.classList.contains('peek-open') && document.getElementById('drawer').hidden`), true, `${what}: no peek, still on ${page}`);
    };
    // the ⋯: on a ticket card and on a goal card, it only opens its menu
    for (const [page, el] of [['#board', tcard], ['#goals', "document.querySelector('#goals-list .card.goal[data-open]:not(.upkeep)')"]]) {
      await on(page);
      await p.ev(`(() => { const d = ${el}.querySelector('details.menu'); d.open = false; window.__menu = d; d.querySelector('summary').click(); })(); void 0`);
      await still(page, `${page}: the ⋯`);
      assert.equal(await p.ev('window.__menu.open'), true, `${page}: the ⋯ opened its menu`);
      await p.ev('window.__menu.open = false; void 0');
    }
    // a goal's hold control is in its peek (kit-90): its first Let go asks to confirm, and opens nothing else
    await on('#goals');
    const gopen = await p.ev(`document.querySelector('#goals-list .card.goal[data-open]:not(.upkeep)').dataset.open`);
    await p.ev(`location.hash = ${J(gopen)}; void 0`);
    await opened(gopen, 'the goal\'s peek');
    await soon(`!!document.querySelector('#drawer-body [data-hold-id][data-mode="let-go"]')`, 'the peek\'s Hold');
    await p.ev(`(() => { const b = document.querySelector('#drawer-body [data-hold-id][data-mode="let-go"]'); window.__hb = b; b.click(); })(); void 0`);
    await settle();
    assert.equal(await p.ev(`decodeURIComponent(location.hash.slice(1)) === decodeURIComponent(${J(gopen)}) && DRAWER.kind === 'goal' && !document.getElementById('drawer').hidden`), true, 'Let go: still the goal\'s peek, nothing else opened');
    assert.equal(await p.ev('window.__hb.textContent'), 'Confirm let go', 'the hold button did its own thing');
    // a link to another record inside a card: it goes there, not to the card's own peek
    let found = null;
    for (const [page, sel] of PLACES) {
      await on(page);
      found = await p.ev(`(() => { ${DEC} const cs = ${cardsIn(sel)};
        for (let i = 0; i < cs.length; i++) { const own = dec('#' + cs[i].dataset.open); const a = [...cs[i].querySelectorAll('a[href^="#"]')].find((x) => { const h = dec(x.getAttribute('href')); return h !== own && /^#(ticket|goal|feature|lesson|decision|act|problem|observation)\\//.test(h); });
          if (a) { a.click(); return { own, href: dec(a.getAttribute('href')) }; } }
        return null; })()`);
      if (found) break;
    }
    assert.ok(found, 'a card with a link to another record');
    await soon(`decodeURIComponent(location.hash) === ${J(found.href)}`, `the link's own peek: ${found.href}`);
    await settle();
    assert.equal(await p.ev('decodeURIComponent(location.hash)'), found.href, `not the card's own ${found.own}`);
  });

  await t.test('a ticket card and an incident card look as they did as buttons', async () => {
    // the values today's button.tcard rules and the .tcard rule set (index.html, before kit-88's §2.5):
    // padding 8px 10px, font-size 12px, text-align left, cursor pointer, border-radius 6px, width 100%
    const look = (el) => p.ev(`(() => { const c = ${el}, s = getComputedStyle(c), col = c.parentElement, cs = getComputedStyle(col);
      const inner = col.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { padding: s.padding, fontSize: s.fontSize, textAlign: s.textAlign, cursor: s.cursor, borderRadius: s.borderRadius, width: Math.abs(c.getBoundingClientRect().width - inner) < 0.5 }; })()`);
    const WAS = { padding: '8px 10px', fontSize: '12px', textAlign: 'left', cursor: 'pointer', borderRadius: '6px', width: true };
    await on('#board');
    assert.deepEqual(await look(tcard), WAS, 'the Board ticket card');
    await on('#sensors');
    await soon("!!document.querySelector('#incidents .tcard')", 'the incident board');
    assert.deepEqual(await look("document.querySelector('#incidents .tcard')"), WAS, 'the incident card');
  });

  await t.test('peekFor: every opener kind\'s hash, opened through route()', async () => {
    const ON = { ticket: 'ticket', goal: 'goal', feature: 'feature', story: 'story', release: 'release', wave: 'wave', milestone: 'milestone', act: 'act', decision: 'decision', retro: 'retro', lesson: 'lesson', problem: 'problem', thread: 'thread', planner: 'planner', q: 'qAnswered', file: 'file', sensor: 'sensorHttp', observation: 'observation', signal: 'signal', learning: 'learning' };
    assert.deepEqual((await p.ev('Object.keys(OPENERS())')).sort(), Object.keys(ON).sort(), 'a fixture record for every opener kind');
    const H = peekHashes(ids);
    for (const [k, key] of Object.entries(ON)) {
      const h = await p.ev(`peekFor(${J(k)}, ${J(ids[key])})`);
      assert.equal(h, H[key][1], `${k}: the opener's hash`);
      await on('#board');
      await p.ev(`location.hash = peekFor(${J(k)}, ${J(ids[key])}); void 0`);
      await soon(`DRAWER.kind === ${J(k)} && !document.getElementById('drawer').hidden`, `${k}: route() opens its peek`);
    }
    assert.equal(await p.ev("peekFor('file', 'docs/a b.md')"), '#file?path=docs%2Fa%20b.md');
  });
});

// The binder's half of dbTable rows (spec §2.5, AC6): on the shell fixture, filled as
// dashboard-shell.test.mjs fills it, a table bound with an onOpen that opens its row's record in the
// fixture's drawer opens it on a click and on Enter.
test('rows and cards: a dbTable row opens its record on the shell fixture', { skip: SKIP, timeout: 120000 }, async (t) => {
  const INDEX = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  const block = (name) => { const a = INDEX.indexOf(`/* ${name} start */`), b = INDEX.indexOf(`/* ${name} end */`); assert.ok(a >= 0 && b > a, name); return INDEX.slice(a, b + `/* ${name} end */`.length); };
  const filled = fs.readFileSync(new URL('./fixtures/dashboard-shell.html', import.meta.url), 'utf8')
    .replace('/* slot: devteam-ui tokens */', () => block('devteam-ui tokens'))
    .replace('/* slot: devteam-layout */', () => block('devteam-layout'))
    .replace('/* slot: devteam-shell-js */', () => block('devteam-shell-js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dbrows-'));
  const later = cleanup(t);
  later(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dashboard-shell.html');
  fs.writeFileSync(file, filled);
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `file://${file}` });
  await until(() => p.ev('window.__ready === true').catch(() => false), 'the fixture drawn');
  await p.ev(`document.body.classList.remove('peek-open');
    bindDbTable(document.getElementById('table-card'), { onOpen: (i) => { document.querySelector('#drawer h2').textContent = ROWS[i][0]; document.body.classList.add('peek-open'); } }); void 0`);
  const peek = () => p.ev("[document.body.classList.contains('peek-open'), document.querySelector('#drawer h2').textContent]");
  await p.ev("document.querySelector('#table-card tr[data-row=\"1\"] td').click(); void 0");
  assert.deepEqual(await peek(), [true, 'kit-2'], 'a click on a row opens its record');
  await p.ev("document.body.classList.remove('peek-open'); void 0");
  assert.equal(await p.ev(`(() => { const tr = document.querySelector('#table-card tr[data-row="0"]'); tr.focus(); if (document.activeElement !== tr) return false;
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); return true; })()`), true, 'the row takes focus');
  assert.deepEqual(await peek(), [true, 'kit-10'], 'Enter on a focused row opens its record');
});

// Every label an opener draws has a tooltip (spec §2.2): the row labels the openers and ATTR pass, in
// index.html's source, each in KEY_TIPS (read from the page's own source in a vm). A label with no
// entry would draw a key with no title, which the peek test above also catches on the fixture's peeks.
test('every opener label has a tip in KEY_TIPS', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  const KEY_TIPS = vm.runInNewContext(`(${/const KEY_TIPS = (\{[\s\S]*?\n\});/.exec(html)[1]})`);
  const cut = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert.ok(a >= 0 && b > a, `${from} … ${to}`); return html.slice(a, b); };
  const src = cut('const ATTR_COMMON = {', '// ---- peeks: one fetch per object') + cut('function openSensor(', '// Mermaid fenced blocks');
  const labels = new Set();
  // [label, value, tip] rows and attrRow(label, …); a value that is a string or array literal is a
  // learning figure's table row or chart group, not a key
  for (const m of src.matchAll(/(?:\[|attrRow\()\s*'([A-Z][^'\n]*)',(?!\s*['[])/g)) labels.add(m[1]);
  for (const m of src.matchAll(/label: \{([^}]*)\}/g)) for (const v of m[1].matchAll(/:\s*'([^']+)'/g)) labels.add(v[1]);
  for (const l of ['ID', 'How it changes', 'Created', 'Last changed', 'Record', 'Status', 'Under', 'Stage', 'Fix']) assert.ok(labels.has(l), `the scan finds ${l}`);
  assert.ok(labels.size > 60, `labels found: ${labels.size}`);
  assert.deepEqual([...labels].filter((l) => !KEY_TIPS[l]), [], 'labels with no tip');
});
