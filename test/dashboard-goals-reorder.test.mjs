// The goals reordered on the dashboard (kit-234): the Goals page's Active tab draws a drag handle and
// Move up / Move down on each goal's card, never on Upkeep's or a closed goal's. In real headless Chrome
// over a real dashboard on a fixture project seeded with the kit's own commands (skipped where Chrome
// can't run). One top-level test per group, each with its own fixture, dashboard and Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };

// The fixture project: A, B and C approved by the owner (priorities 1, 2, 3), D a draft with no priority,
// M met and L let go. { root, env, ids: { A, B, C, D, M, L }, dt } (dt runs a kit command as role, null
// for the owner).
function reorderFixture(base, name = 'goals-reorder') {
  const root = bareProject(base, name);
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 0), DEVTEAM_PORT_BASE: String(PORTS + 1), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const dt = (args, role = 'supervisor') => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const mk = (args) => dt(args).split('\n')[0].trim();
  const full = (title, priority) => ['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
  const ids = {};
  ids.A = mk(full('Admins pay alone', 1));
  ids.B = mk(full('Receipts for every payment', 2));
  ids.C = mk(full('Invoices in one click', 3));
  ids.D = mk(['goal', 'add', '--title', 'Faster onboarding', '--outcome', 'new admins set up alone']);
  ids.M = mk(full('Cards on file', 5));
  ids.L = mk(full('A hosted billing page', 6));
  for (const k of ['A', 'B', 'C', 'M']) dt(['goal', 'decide', ids[k], 'approve', '--force', '--notes', 'go'], null);
  dt(['goal', 'status', ids.M, 'met', '--force'], null);
  dt(['goal', 'decide', ids.L, 'let-go', '--notes', 'the processor\'s page covers it'], null);
  for (const id of Object.values(ids)) assert.match(id, /^[A-Za-z0-9_-]+$/, 'a goal id fits in a selector as is');
  return { root, env, ids, dt };
}

// Run in each load before the page's own: the 10 s refresh at 300 ms and a poll counter (window.__polls);
// every POST /api/goal-order body recorded in window.__orders; and while window.__holdOrder is true, the
// next one is parked (and __holdOrder set back to false) as window.__held = { body, resolve(toServer,
// status, body) }: resolve(true) sends it on to the server, resolve(false, status, body) answers it with
// that status and JSON body without the server.
function initScript() {
  return `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__polls = 0;
  window.__orders = [];
  window.__holdOrder = false;
  window.__held = null;
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    if (method === 'POST' && url.startsWith('/api/goal-order')) {
      const body = (() => { try { return JSON.parse(o.body || 'null'); } catch { return o.body; } })();
      window.__orders.push(body);
      if (window.__holdOrder) {
        window.__holdOrder = false;
        return new Promise((done, fail) => {
          window.__held = {
            body,
            resolve(toServer, status = 400, json = { error: 'refused' }) {
              window.__held = null;
              if (toServer) real(u, o).then(done, fail);
              else done(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
            },
          };
        });
      }
    }
    const r = await real(u, o);
    if (method === 'GET' && url.startsWith('/api/data') && r.ok) window.__polls++;
    return r;
  };
})();`;
}

// a wait on a condition in the page
const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The dashboard on the fixture, Chrome on it with the init script, at a size: { p, soon, dash, port, go,
// reload }. later is the test's cleanup(t), so all of it is stopped before the fixture is removed.
async function openOn(later, root, env, { width = 1440, height = 900 } = {}) {
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript() });
  const soon = soonIn(p, 20000, () => dash.out());
  const loaded = "!window.__old && !document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA";
  // a fresh document at a head (from about:blank, so a head that differs only in its hash loads anew)
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon(loaded, 'the page with its data');
  };
  // the same head, reloaded
  const reload = async () => { await p.ev('window.__old = 1'); await p.send('Page.reload'); await soon(loaded, 'the page reloaded, with its data'); };
  return { p, soon, dash, port, go, reload };
}

// The Goals page's cards in the order shown: 'upkeep', then goal ids.
const order = (p) => p.ev(`[...document.querySelectorAll('#goals .card.goal[data-subject]')].map((c) => c.dataset.subject.replace(/^goal:/, ''))`);
// An active goal's card (one with the reorder controls), as a selector.
const card = (id) => `#goals [data-goal-card="${id}"]`;
// The active goals in priority order (no priority last, ties as given), from a data object.
const activeOf = (d) => {
  const pri = (g) => (typeof g.priority === 'number' ? g.priority : Infinity);
  return d.ooda.goals.filter((g) => !['met', 'abandoned'].includes(g.status)).sort((a, b) => pri(a) - pri(b)).map((g) => g.id);
};
// Settled on ids: the server's /api/data gives the active goals in that order, the page's DATA agrees,
// and the page has polled once more since.
async function settled(p, port, ids, what = 'the order') {
  const soon = soonIn(p);
  const want = JSON.stringify(ids);
  const end = Date.now() + 20000;
  for (let last = null; ; ) {
    try { last = JSON.stringify(activeOf(await (await fetch(`http://127.0.0.1:${port}/api/data`)).json())); } catch (e) { last = e.message; }
    if (last === want) break;
    if (Date.now() > end) assert.fail(`timed out: the server's ${what}: ${last}, not ${want}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  await soon(`typeof DATA !== 'undefined' && !!DATA && JSON.stringify((${activeOf.toString()})(DATA)) === ${JSON.stringify(want)}`, `the page's DATA on ${what}`);
  const n = await p.ev('window.__polls');
  await soon(`window.__polls > ${n}`, 'one more poll');
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('the reorder controls: on active goal cards only', { ...CHROME, timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-goals-reorder-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env, ids } = reorderFixture(base);
  const { A, B, C, D, M, L } = ids;
  const { p, soon, port, go } = await openOn(later, root, env);
  await go('#goals');
  await settled(p, port, [A, B, C, D], 'the seeded order');

  await t.test('AC1: a handle and Move up / Move down on each goal card, none on Upkeep', async () => {
    await go('#goals');
    await soon(`[${[A, B, C, D].map((x) => JSON.stringify(card(x))).join(', ')}].every((s) => !!document.querySelector(s)) && !!document.querySelector('#goals .card.goal[data-subject="goal:upkeep"]')`, 'the goal cards and Upkeep');
    assert.deepEqual(await order(p), ['upkeep', A, B, C, D]);
    for (const [i, id] of [A, B, C, D].entries()) {
      const c = await p.ev(`(() => {
        const c = document.querySelector(${JSON.stringify(card(id))});
        const grips = [...c.querySelectorAll('.goal-grip')];
        const btn = (d) => { const b = c.querySelectorAll('details.menu .pop [data-goal-move="' + d + '"]'); return { n: b.length, text: b[0]?.textContent.trim(), disabled: b[0]?.disabled, id: b[0]?.dataset.goalId }; };
        return { grips: grips.length, label: grips[0]?.getAttribute('aria-label'), gripId: grips[0]?.dataset.goalGrip, inHead: !!grips[0]?.closest('.card-head'), up: btn('up'), down: btn('down') };
      })()`);
      assert.equal(c.grips, 1, `one handle on card ${i}`);
      assert.ok(c.label.startsWith('Reorder '), `the handle's label: ${c.label}`);
      assert.equal(c.gripId, id);
      assert.ok(c.inHead, 'the handle is in the card head');
      assert.deepEqual(c.up, { n: 1, text: 'Move up', disabled: i === 0, id }, `Move up on card ${i}`);
      assert.deepEqual(c.down, { n: 1, text: 'Move down', disabled: i === 3, id }, `Move down on card ${i}`);
    }
    const up = await p.ev(`(() => { const c = document.querySelector('#goals .card.goal[data-subject="goal:upkeep"]'); return { grips: c.querySelectorAll('.goal-grip').length, moves: c.querySelectorAll('[data-goal-move]').length, card: c.hasAttribute('data-goal-card') }; })()`);
    assert.deepEqual(up, { grips: 0, moves: 0, card: false }, 'Upkeep has no reorder controls');
    assert.equal(await p.ev(`document.querySelectorAll('#goals .goal-grip').length`), 4, 'four handles in all');
    assert.equal(await p.ev(`!!document.querySelector('#goals #e-goal-order.err')`), true, 'the reorder error line on the Active tab');
  });

  await t.test('AC5: a click on a handle, or on Move up, opens no peek', async () => {
    await go('#goals');
    await soon(`!!document.querySelector(${JSON.stringify(`${card(B)} .goal-grip`)})`, "B's handle");
    await p.click(`${card(B)} .goal-grip`);
    await pause(400);
    assert.equal(await p.ev('location.hash'), '#goals', 'a click on the handle keeps #goals');
    // Move up, held and refused (once saving exists): the fixture's order is unchanged
    await p.ev('window.__holdOrder = true');
    await p.click(`${card(B)} details.menu > summary`);
    await soon(`!!document.querySelector(${JSON.stringify(`${card(B)} details.menu[open]`)})`, "B's menu open");
    await p.click(`${card(B)} [data-goal-move="up"]`);
    await pause(400);
    assert.equal(await p.ev('location.hash'), '#goals', 'a click on Move up keeps #goals');
    await soon('!!window.__held', 'the Move up post, held');
    await p.ev("window.__held.resolve(false, 400, { error: 'x' })");
    await p.ev('window.__holdOrder = false');
    await settled(p, port, [A, B, C, D], 'the order after a refused move');
    await soon(`JSON.stringify([...document.querySelectorAll('#goals .card.goal[data-subject]')].map((c) => c.dataset.subject.replace(/^goal:/, ''))) === ${JSON.stringify(JSON.stringify(['upkeep', A, B, C, D]))}`, 'the cards back in the fixture order');
  });

  await t.test('AC7: no controls on the Met and Let go tabs', async () => {
    for (const [hash, id] of [['#goals?gt=met', M], ['#goals?gt=letgo', L]]) {
      await go(hash);
      await soon(`!!document.querySelector('#goals .card.goal[data-subject="goal:${id}"]')`, `${hash}: its card`);
      assert.equal(await p.ev(`document.querySelectorAll('#goals .goal-grip, #goals [data-goal-move], #goals [data-goal-card]').length`), 0, `${hash}: no controls`);
      const text = await p.ev(`document.querySelector('#goals').textContent`);
      assert.doesNotMatch(text, /Move up|Move down/, `${hash}: no Move up or Move down`);
    }
  });
});

// Enter, as a keyboard sends it (with its character, so a focused button or summary is activated)
const enter = async (p) => {
  const common = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common, text: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
};
// The log's lines, every file of it
const logOf = (root) => {
  const dir = path.join(root, 'docs/devteam/run/log');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
};
const dashOrderActs = (root) => logOf(root).filter((l) => l.type === 'act' && l.class === 'goal-order' && l.by === 'owner' && l.channel === 'dashboard').length;
// what document.activeElement is: a goal's handle or ⋯ summary ({ grip | menu: id }), the body, or other
const focusOf = (p) => p.ev(`(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'body';
  if (a.matches('.goal-grip')) return { grip: a.dataset.goalGrip };
  if (a.matches('details.menu > summary') && a.closest('[data-goal-card]')) return { menu: a.closest('[data-goal-card]').dataset.goalCard };
  return a.outerHTML.slice(0, 80);
})()`);

test('saving the goal order: the menu and the keyboard', { ...CHROME, timeout: 400000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-goals-reorder-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { root, env, ids, dt } = reorderFixture(base);
  const { A, B, C, D } = ids;
  const { p, soon, port, go, reload } = await openOn(later, root, env);
  const shows = (ids, what) => soon(`JSON.stringify([...document.querySelectorAll('#goals .card.goal[data-subject]')].map((c) => c.dataset.subject.replace(/^goal:/, ''))) === ${JSON.stringify(JSON.stringify(['upkeep', ...ids]))}`, what);
  // each check starts from A, B, C, D, put back by the owner from the command line
  const fresh = async () => {
    dt(['goal', 'order', A, B, C, D], null);
    await go('#goals');
    await shows([A, B, C, D], 'the cards in the order A, B, C, D');
    await settled(p, port, [A, B, C, D], 'the order put back');
  };
  // Move up or down on a goal by keyboard: its ⋯ summary focused, Enter, Tab to the button, Enter
  const keyMove = async (id, dir) => {
    await p.ev(`document.querySelector(${JSON.stringify(`${card(id)} details.menu > summary`)}).focus()`);
    await enter(p);
    await soon(`!!document.querySelector(${JSON.stringify(`${card(id)} details.menu[open]`)})`, 'the menu open');
    let on = false;
    for (let n = 0; n < 6 && !on; n++) {
      await p.key('Tab');
      on = await p.ev(`document.activeElement?.dataset?.goalMove === ${JSON.stringify(dir)} && document.activeElement?.dataset?.goalId === ${JSON.stringify(id)}`);
    }
    assert.ok(on, `Move ${dir} on the goal reached by Tab within 6`);
    await enter(p);
  };
  // Move up or down on a goal by the pointer: a click on its ⋯, then on the button
  const clickMove = async (id, dir) => {
    await p.click(`${card(id)} details.menu > summary`);
    await soon(`!!document.querySelector(${JSON.stringify(`${card(id)} details.menu[open]`)})`, 'the menu open');
    await p.click(`${card(id)} [data-goal-move="${dir}"]`);
  };

  await t.test('AC3: Move up by keyboard saves one order, keeps focus, and persists', async () => {
    await fresh();
    const acts = dashOrderActs(root);
    await keyMove(B, 'up');
    await settled(p, port, [B, A, C, D], 'the order after Move up');
    assert.deepEqual(await p.ev('window.__orders'), [{ ids: [B, A, C, D] }], 'one post, the whole order');
    assert.equal(dashOrderActs(root), acts + 1, 'one goal-order act by the owner on the dashboard');
    assert.deepEqual(await focusOf(p), { menu: B }, "focus on the moved card's ⋯ summary");
    assert.equal(await p.ev(`!!document.querySelector(${JSON.stringify(`${card(B)} details.menu[open]`)})`), false, 'the menu closed');
    await reload();
    await shows([B, A, C, D], 'the cards after reload');
    assert.deepEqual(await order(p), ['upkeep', B, A, C, D]);
  });

  await t.test('AC4: ArrowUp on the grip saves one order and keeps focus on the grip', async () => {
    await fresh();
    await p.ev(`document.querySelector(${JSON.stringify(`${card(C)} .goal-grip`)}).focus()`);
    await p.key('ArrowUp');
    await settled(p, port, [A, C, B, D], 'the order after ArrowUp');
    assert.deepEqual(await p.ev('window.__orders'), [{ ids: [A, C, B, D] }], 'one post');
    assert.deepEqual(await order(p), ['upkeep', A, C, B, D]);
    assert.deepEqual(await focusOf(p), { grip: C }, "focus on the moved card's handle");
    // and ArrowDown, back
    await p.key('ArrowDown');
    await settled(p, port, [A, B, C, D], 'the order after ArrowDown');
    assert.deepEqual(await p.ev('window.__orders'), [{ ids: [A, C, B, D] }, { ids: [A, B, C, D] }], 'one more post');
    assert.deepEqual(await focusOf(p), { grip: C }, 'focus still on the handle');
  });

  await t.test('focus that moved on stays where the owner put it', async () => {
    await fresh();
    await keyMove(A, 'down');
    await p.ev(`document.querySelector(${JSON.stringify(`${card(D)} .goal-grip`)}).focus()`);
    await settled(p, port, [B, A, C, D], 'the order after Move down');
    // a redraw that replaces the cards keeps D's handle focused
    await p.ev(`(() => { GOALS_HTML = ''; renderGoals(); })()`);
    assert.deepEqual(await focusOf(p), { grip: D }, "D's handle, not A's summary");
    // and the moved goal's record is gone: focus dropped to the page stays there through a redraw
    await p.ev('document.activeElement.blur()');
    await p.ev(`(() => { GOALS_HTML = ''; renderGoals(); })()`);
    assert.equal(await focusOf(p), 'body', "no jump back to A's summary");
  });

  await t.test('AC6: a refused order goes back and says why', async () => {
    await fresh();
    await p.ev('window.__holdOrder = true');
    await clickMove(C, 'down');
    await soon('!!window.__held', 'the post, held');
    await shows([A, B, D, C], 'the moved order while held (the overlay)');
    await p.ev("window.__held.resolve(false, 400, { error: 'nope' })");
    await shows([A, B, C, D], "the cards back in the server's order");
    await soon(`document.querySelector('#e-goal-order')?.textContent === 'Not saved: nope'`, 'the reason');
    await settled(p, port, [A, B, C, D], 'the order after the refusal');
    await p.ev(`(() => { GOALS_HTML = ''; renderGoals(); })()`);
    assert.equal(await p.ev(`document.querySelector('#e-goal-order').textContent`), 'Not saved: nope', 'a redraw keeps the reason');
    assert.equal((await p.ev('window.__orders')).length, 1);
  });

  await t.test('AC12: two quick moves post their own orders', async () => {
    await fresh();
    await p.ev('window.__holdOrder = true');
    await clickMove(A, 'down');
    await soon('!!window.__held', 'the first post, held');
    await shows([B, A, C, D], 'the first move shown');
    await p.ev('window.__holdOrder = true');
    await clickMove(A, 'down');
    await shows([B, C, A, D], 'the second move shown');
    assert.equal((await p.ev('window.__orders')).length, 1, 'the second waits for the first');
    await p.ev('window.__held.resolve(true)');
    await soon('!!window.__held && window.__orders.length === 2', 'the second post, held');
    await p.ev('window.__held.resolve(true)');
    await settled(p, port, [B, C, A, D], 'the order after both');
    assert.deepEqual(await p.ev('window.__orders'), [{ ids: [B, A, C, D] }, { ids: [B, C, A, D] }], 'each the order shown when it was made');
    assert.deepEqual(await order(p), ['upkeep', B, C, A, D]);
    assert.equal(await p.ev(`document.querySelector('#e-goal-order').textContent`), '', 'no error');
  });
});
