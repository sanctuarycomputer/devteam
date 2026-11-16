// The side peek (kit-88, spec docs/devteam-dev/tickets/kit-88-side-peek/spec.md): the shell's peek
// frame that slides, its header and the shared scrim, the top-right button beside it, and the peeks
// drawn in it. Headless Chrome against a real dashboard on a project of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, bareProject, dashboardOnFreePort, peekFixture, until } from './lib/kit.mjs';
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
    assert.ok(await p.ev("!!document.querySelector('#drawer-body ol.steps').closest('.no-shell')"), 'the stepper is fenced');
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
      await soon("window.__tr.some((x) => x.type === 'transitionrun')", `${how}: the slide out runs`);
      const run = await p.ev("window.__tr.find((x) => x.type === 'transitionrun')");
      assert.equal(run.hidden, false, `${how}: shown while it slides out`);
      await soon("window.__tr.some((x) => x.type === 'transitionend')", `${how}: the slide out ended`);
      await soon(isClosed, `${how}: hidden once the slide ends`);
    }
  });

  await t.test('a preview over the scrim: overlay-open shows it, and its close clears it', async () => {
    // a fresh visit (see the viewer cases below)
    await load('#library');
    await p.ev("location.hash = '#preview/calm-river'");
    await soon("!document.getElementById('artifact-view').hidden && document.body.classList.contains('overlay-open') && !document.getElementById('scrim').hidden && getComputedStyle(document.getElementById('scrim')).opacity === '1'", 'the preview over the scrim');
    await p.click('#av-close');
    await soon("document.getElementById('artifact-view').hidden && !document.body.classList.contains('overlay-open') && document.getElementById('scrim').hidden", 'the preview closed, overlay-open cleared');
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
    await soon(isClosed, 'the Inbox, the peek closed');
    await soon(`(() => { ${SEEN} return !seen(document.getElementById('tt-peek')) && seen(document.querySelector('.pagebar .tt')); })()`, 'no peek: .tt again');
  });
});

// Every peek on test/lib/kit.mjs's peekFixture: the hash that opens each of its records, and the
// peek kind it draws (an open question and an artifact open no peek, so they are not here).
const peekHashes = (ids) => {
  const e = encodeURIComponent;
  return {
    ticket: ['ticket', `#ticket/${e(ids.ticket)}`], goal: ['goal', `#goal/${e(ids.goal)}`], feature: ['feature', `#feature/${e(ids.feature)}`], story: ['story', `#story/${e(ids.story)}`],
    release: ['release', `#release/${e(ids.release)}`], wave: ['wave', `#wave/${e(ids.wave)}`], milestone: ['milestone', `#milestone/${e(ids.milestone)}`],
    act: ['act', `#act/${e(ids.act)}`], actUnderDecision: ['act', `#act/${e(ids.actUnderDecision)}`], actCorrected: ['act', `#act/${e(ids.actCorrected)}`],
    decision: ['decision', `#decision/${e(ids.decision)}`], decisionNotMine: ['decision', `#decision/${e(ids.decisionNotMine)}`],
    lesson: ['lesson', `#lesson/${e(ids.lesson)}`], problem: ['problem', `#problem/${e(ids.problem)}`], incident: ['problem', `#problem/${e(ids.incident)}`],
    signal: ['signal', `#signal/${e(ids.signal)}`], observation: ['observation', `#observation/${e(ids.observation)}`], learning: ['learning', `#learning/${e(ids.learning)}`],
    retro: ['retro', `#retro/${e(ids.retro)}`], thread: ['thread', `#thread/${e(ids.thread)}`], planner: ['planner', `#planner/${e(ids.planner)}`],
    qAnswered: ['q', `#q/${e(ids.qAnswered)}`], qDefaulted: ['q', `#q/${e(ids.qDefaulted)}`], qWithdrawn: ['q', `#q/${e(ids.qWithdrawn)}`], qLong: ['q', `#q/${e(ids.qLong)}`],
    file: ['file', `#file?path=${e(ids.file)}`], governanceFile: ['file', `#file?path=${e(ids.governanceFile)}`],
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
    problem: thread(`problem:${ids.problem}`), incident: thread(`problem:${ids.incident}`), observation: thread(`observation:${ids.observation}`),
    ...Object.fromEntries(['feature', 'story', 'release', 'wave', 'milestone', 'signal', 'learning', 'retro', 'sensorHttp', 'sensorReader', 'file'].map((k) => [k, { text: SHIFT, sel: 'a[href^="#"]' }])),
  };
};
// the peek drawn in full: its kind, its properties first, its History card last and loaded
const peekDrawn = (kind) => `(() => { const b = document.getElementById('drawer-body'), last = b.lastElementChild;
  return !document.getElementById('drawer').hidden && DRAWER.kind === ${JSON.stringify(kind)} && !!b.querySelector('section.attrs') && !!last && last.matches('.psect') && /^History$/.test(last.querySelector('.card-head')?.textContent.trim() ?? '') && !last.querySelector('.loading'); })()`;

test('the peeks', { skip: SKIP, timeout: 600000 }, async (t) => {
  const { p, ids, size, soon, load } = await peekPage(t, { fixture: peekFixture, name: 'peeks' });
  await size(1440, 900);
  await load('#board');
  const H = peekHashes(ids);
  const open = async (key) => {
    const [kind, hash] = H[key];
    await p.ev("location.hash = '#board'");
    await soon("!document.body.classList.contains('peek-open')", 'back on Board');
    // set until it takes: Chrome drops a same-document navigation now and then when a page makes many
    // in a row (the hash stays as it was, with no hashchange), which a walk over thirty peeks does
    await soon(`location.hash === ${JSON.stringify(hash)} || (location.hash = ${JSON.stringify(hash)}, false)`, `${key}: its hash`);
    return kind;
  };

  await t.test('the fixture draws every kind', async () => {
    const kinds = new Set(Object.values(H).map(([k]) => k));
    assert.deepEqual([...kinds].sort(), (await p.ev('Object.keys(TYPE_META)')).sort(), 'every peek kind has a record');
    for (const key of Object.keys(H)) {
      const kind = await open(key);
      await soon(`!document.getElementById('drawer').hidden && DRAWER.kind === ${JSON.stringify(kind)} && !!document.querySelector('#drawer-body section.attrs')`, `${key}: its peek`);
      // drawn from its record, not "not found" (whose title is the id); a planner, a file and a sensor are titled by their id
      if (!['planner', 'file', 'governanceFile', 'sensorHttp', 'sensorReader', 'decisionNotMine'].includes(key)) {
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
