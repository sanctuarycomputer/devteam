// The reminder when the viewer closes with notes nobody handed over (kit-148), and the thread code's
// third waiting value, 'session' (spec §Acceptance checks R1-R12). Headless Chrome against a real
// dashboard on a project of its own, on kit-141's harness (fixtures/artifact-viewer/harness.mjs),
// skipped where Chrome can't be driven. Each version of viewer-a the cases use is a plain draft folder
// under the fixture's .worktrees/<w>/, with notes made by the real CLI as the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, FRAMES, VIEWER_UP, CLOSED } from './fixtures/artifact-viewer/harness.mjs';
import { oneHarness } from './lib/browser-fixture.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const H = oneHarness(harness, 'artifact-handover-reminder', SKIP);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_A = path.join(HERE, 'fixtures/artifact-viewer/viewer-a');

// The card shown (in the page, drawn, not hidden), and what it says.
const REMIND = "(() => { const r = document.getElementById('av-remind'); return !!r && !r.hidden && r.getBoundingClientRect().height > 0; })()";
const SAYS = `(() => { const r = document.getElementById('av-remind'); if (!r) return null; return {
  shown: ${REMIND}, role: r.getAttribute('role'), live: r.getAttribute('aria-live'),
  tx: r.querySelector('.tx')?.textContent ?? null,
  later: document.getElementById('av-remind-later')?.textContent ?? null,
  hand: document.getElementById('av-remind-hand')?.textContent ?? null,
  err: document.getElementById('e-avr')?.textContent ?? '',
  focusIn: r.contains(document.activeElement) }; })()`;

test('the reminder on close, and notes with a session', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { F, PV, T, visit, sub } = await H(t);

  // A draft of viewer-a in the fixture's worktree w (a plain folder: S5), and n open notes on it, each on
  // a point of its own (one subject per spot).
  let spot = 0;
  const draft = (w) => {
    const to = path.join(F.old, '.worktrees', w, 'docs/devteam/project/artifacts/viewer-a');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(VIEWER_A, to, { recursive: true });
    // a copy identical to main's is not a draft the Library lists (draftArtifacts): one byte of its own
    fs.appendFileSync(path.join(to, 'index.html'), `\n<!-- the draft in ${w} -->\n`);
  };
  const note = (w, title = 'A note') => {
    spot++;
    const out = F.owner(['thread', 'new', title, '--subject', J({ kind: 'artifact', slug: 'viewer-a', at: w, path: 'index.html', point: { x: 20 + (spot % 40) * 9, y: 20 + Math.floor(spot / 40) * 9 } })]);
    return out.split('\n')[0].trim();
  };
  const version = (w, n) => { draft(w); return Array.from({ length: n }, (_, i) => note(w, `Note ${i + 1} on ${w}`)); };
  const V_REM = version('plan-rem', 2);
  version('rem-one', 1);
  version('rem-x', 2);
  const V_SUP = version('rem-sup', 2);
  const V_HOLD = version('rem-hold', 2);
  const V_QUIET = version('rem-quiet', 3);
  version('rem-bar', 2);
  version('rem-busy', 2);
  version('ch-01-tidy-docs', 2);
  version('plan-gone', 2);
  version('rem-u1', 1);
  version('rem-u2', 1);
  const [RES] = version('rem-res', 1);
  const [CARD] = version('rem-card', 1);
  F.owner(['thread', 'resolve', RES, '--outcome', 'Bigger now']);

  // The viewer opened on viewer-a's draft in w (a new entry), up, its lens ready and the threads read.
  const openW = async (V, w) => {
    await V.p.ev(`location.hash = ${J(`#artifact/wt/${w}/viewer-a`)}; void 0`);
    await V.soon(`${VIEWER_UP} && TS.kind === 'artifact' && TS.slug === 'viewer-a' && TS.at === ${J(w)} && TS.ready && TL.have > 0`, `setup: the viewer up on viewer-a@${w}`);
    await V.p.ev(FRAMES);
  };
  // the page's threads hold every id in ids (read now, not at the page's next 5 s poll)
  const hasThreads = async (V, ids) => {
    await V.p.ev('tlRefresh(); void 0');
    await V.soon(`${J(ids)}.every((id) => TL.threads.some((t) => t.id === id))`, `setup: the page has read ${ids.join(', ')}`);
  };
  // Every fetch through a wrapper: POST bodies kept in __posts; a stub per action (window.__stub[action]
  // = {status, body, ms}); /api/threads rows with window.__over[id]'s fields laid over them.
  const wrap = (V) => V.p.ev(`(() => {
    if (window.__wrapped) return true;
    window.__wrapped = true; window.__posts = []; window.__stub = {}; window.__over = {}; window.__pushes = 0;
    const push = History.prototype.pushState;
    History.prototype.pushState = function () { window.__pushes++; return push.apply(this, arguments); };
    const f = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      const url = String(u);
      if ((o.method || 'GET').toUpperCase() === 'POST') {
        let body = null; try { body = JSON.parse(o.body); } catch {}
        const action = url.replace(/^.*\\/api\\//, '').split('?')[0];
        window.__posts.push({ action, body });
        const s = window.__stub[action];
        if (s) { if (s.ms) await new Promise((r) => setTimeout(r, s.ms)); return new Response(JSON.stringify(s.body), { status: s.status || 200, headers: { 'content-type': 'application/json' } }); }
        return f(u, o);
      }
      const r = await f(u, o);
      if (!/\\/api\\/threads(\\?|$)/.test(url) || !Object.keys(window.__over).length) return r;
      const j = await r.json();
      const rows = Array.isArray(j) ? j : j.threads;
      for (const x of rows ?? []) if (window.__over[x.id]) Object.assign(x, window.__over[x.id]);
      return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    return true;
  })()`);
  // fields laid over thread id's row, and the page's threads re-read until they show
  const over = async (V, id, fields) => {
    await wrap(V);
    await V.p.ev(`window.__over[${J(id)}] = ${J(fields)}; tlRefresh(); void 0`);
    await V.soon(`TL.threads.some((t) => t.id === ${J(id)} && ${J(Object.keys(fields))}.every((k) => JSON.stringify(t[k] ?? null) === JSON.stringify(${J(fields)}[k] ?? null)))`, `setup: the row of ${id} shows its laid fields`);
  };
  // a real press on the dashboard's element #id, at its centre
  const pressId = async (V, id) => {
    const at = await V.p.ev(`(() => { const b = document.getElementById(${J(id)}); if (!b) return null; const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, top: !!document.elementFromPoint(x, y)?.closest('#' + ${J(id)}) }; })()`);
    assert.ok(at, `setup: #${id} is not in the page`);
    assert.ok(at.top, `setup: #${id} is covered`);
    await V.press(at.x, at.y, id);
  };
  // A real press on a decision in the viewer's bar (#av-handover). kit-145's guard (avStep.press) takes a pointer press
  // on one only once it has sat in the same box, uncovered, for ASK_ARM_MS (1 s) by the page's own frames, a frame gap
  // over 250 ms starting that second again; any other press it stops before the page's listeners (and WATCH's) see
  // it. The bar is drawn as the viewer comes up, so a press straight after openW is always stopped, and on a loaded
  // box the 1 s retry of V.press can be too (rem2). So: pressed once the page's guard says it has settled (kit-145's
  // own LIVE, fixtures/artifact-notes-viewer), and again, once settled again, if a stalled frame began its second anew.
  const ARMED = (id) => `(() => { const el = document.getElementById(${J(id)}); return !!el && performance.now() - avStep.press.last <= 250 && [...avStep.press.seen.values()].some((r) => r.el === el && avStep.settled(r)); })()`;
  const pressArmed = async (V, id) => {
    for (let k = 0; k < 6; k++) {
      await V.soon(ARMED(id), `setup: #${id} settled, by kit-145's press guard`);
      const at = await V.p.ev(`(() => { const b = document.getElementById(${J(id)}), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, top: !!document.elementFromPoint(x, y)?.closest('#' + ${J(id)}) }; })()`);
      assert.ok(at.top, `setup: #${id} is covered`);
      const n = await V.p.ev('window.__clicks.length');
      await V.p.move(at.x, at.y);
      await V.p.clickAt(at.x, at.y);
      if (await V.settle(`window.__clicks.slice(${n}).includes(${J(id)})`, 1500)) return;
      t.diagnostic(`the press on #${id} once settled never reached the page: pressed again once it settles`);
    }
    assert.fail(`setup: six presses on #${id}, each once it had settled, never reached the page`);
  };
  const closeBy = async (V, kind) => {
    if (kind === 'back') await V.p.ev('history.back(); void 0');
    else if (kind === 'link') await V.p.ev("location.hash = '#board'; void 0");
    else await V.close(kind);
    await V.settle(CLOSED, 3000);
    assert.equal(await V.p.ev(CLOSED), true, `setup: the viewer closed (${kind})`);
  };
  const shownSoon = async (V, what) => { await V.settle(REMIND, 3000); const s = await V.p.ev(SAYS); assert.ok(s?.shown, `${what}: #av-remind is not shown`); return s; };
  const notShown = async (V, what) => { await V.settle(REMIND, 1000); assert.equal(await V.p.ev(REMIND), false, `${what}: #av-remind is shown`); };
  const TWO_REM = "2 notes on Viewer A aren't handed over. plan-rem, the session drawing it, won't start on them until you do.";

  // R1: every closer shows it, its words, and it takes no focus.
  for (const kind of ['x', 'escape-dash', 'escape-frame', 'scrim', 'back', 'link']) {
    await sub(`R1: ${kind} shows the reminder`, async () => {
      const V = await visit('#library');
      await openW(V, 'plan-rem');
      await hasThreads(V, V_REM);
      await closeBy(V, kind);
      const s = await shownSoon(V, `R1 ${kind}`);
      assert.equal(s.tx, TWO_REM, `R1 ${kind}: the words`);
      assert.deepEqual([s.role, s.live], ['status', 'polite'], `R1 ${kind}: role status, aria-live polite`);
      assert.deepEqual([s.later, s.hand], ['Not now', 'Hand over to plan-rem'], `R1 ${kind}: the buttons`);
      assert.equal(s.focusIn, false, `R1 ${kind}: the focus is not in the reminder`);
    });
  }

  // R2: one note, and the supervisor as recipient.
  await sub('R2: one note, and the supervisor', async () => {
    const V = await visit('#library');
    await openW(V, 'rem-one');
    await closeBy(V, 'x');
    let s = await shownSoon(V, 'R2 one');
    assert.equal(s.tx, "1 note on Viewer A isn't handed over. The supervisor won't start on it until you do.", 'R2: one note, the supervisor');
    assert.equal(s.hand, 'Hand over to the supervisor', 'R2: the button names the supervisor');
    await openW(V, 'rem-x');
    await closeBy(V, 'x');
    s = await shownSoon(V, 'R2 two');
    assert.equal(s.tx, "2 notes on Viewer A aren't handed over. The supervisor won't start on them until you do.", 'R2: two notes, the supervisor');
    // a ticket in the graph (the harness's TK) with its worktree: that ticket's session
    await openW(V, 'ch-01-tidy-docs');
    await closeBy(V, 'x');
    s = await shownSoon(V, 'R2 a ticket');
    assert.equal(s.tx, "2 notes on Viewer A aren't handed over. ch-01-tidy-docs, the session drawing it, won't start on them until you do.", 'R2: a ticket worktree');
    assert.equal(s.hand, 'Hand over to ch-01-tidy-docs', 'R2: the button names the ticket');
    // a planner whose worktree is gone (the Library no longer lists it): the supervisor
    await openW(V, 'plan-gone');
    fs.rmSync(path.join(F.old, '.worktrees', 'plan-gone'), { recursive: true, force: true });
    // the dashboard serves a finished data build again for 20 s unless the log moves (DATA_REUSE_MS, dataEpoch), and
    // a folder removed moves nothing: a line in the log (the harness's own thread T, which no case here reads) makes
    // the page's next read a fresh build, not one up to 20 s old
    F.owner(['thread', 'say', T, 'The Library reads again']);
    await V.soon("!(DATA?.library?.artifacts ?? []).some((x) => x.at === 'plan-gone')", 'setup: the Library no longer lists plan-gone');
    await closeBy(V, 'x');
    s = await shownSoon(V, 'R2 a planner gone');
    assert.equal(s.tx, "2 notes on Viewer A aren't handed over. The supervisor won't start on them until you do.", 'R2: a planner whose worktree is gone');
  });

  // R3: nothing open (handed, resolved, to check), and an artifact with no notes: no card.
  await sub('R3: nothing open shows nothing', async () => {
    const V = await visit('#library');
    const at = new Date().toISOString();
    await over(V, V_QUIET[0], { handed: { to: 'supervisor', at }, waiting: 'session', with: 'supervisor' });
    await over(V, V_QUIET[1], { status: 'resolved', outcome: 'done' });
    await over(V, V_QUIET[2], { check: 'addressed', addressed: { by: 'supervisor', at, note: 'The button is primary now', sha: null, draft: null }, waiting: 'owner' });
    await openW(V, 'rem-quiet');
    await closeBy(V, 'x');
    await notShown(V, 'R3 handed, resolved, to check');
    await V.open('#artifact/main/viewer-b');
    await closeBy(V, 'x');
    await notShown(V, 'R3 viewer-b, no notes');
  });

  // R4: Hand over from the card: one POST (a second press while it is on its way posts nothing), the
  // bar's body, its result, the notes handed, and the next close quiet; a refusal shown.
  await sub('R4: Hand over from the reminder', async () => {
    let V = await visit('#library');
    await openW(V, 'rem-busy');
    await closeBy(V, 'x');
    await shownSoon(V, 'R4 busy');
    await wrap(V);
    await V.p.ev("window.__stub['artifact-handoff'] = { status: 200, body: { to: 'supervisor', typed: false, count: 2 }, ms: 1500 }; void 0");
    await pressArmed(V, 'av-remind-hand');
    await V.p.ev(`document.getElementById('av-remind-hand')?.click(); void 0`);
    await V.settle("document.getElementById('av-remind')?.querySelector('.tx')?.textContent === 'With supervisor'", 4000);
    // past the stub's own wait: a second press queued behind the first (press chains them) has posted by now (plan-1 F8)
    await V.settle('false', 2000);
    assert.deepEqual(await V.p.ev("window.__posts.filter((p) => p.action === 'artifact-handoff').map((p) => p.body)"), [{ slug: 'viewer-a', at: 'rem-busy' }], 'R4: one post, {slug, at}');
    assert.equal(await V.p.ev("document.getElementById('av-remind').querySelector('.tx').textContent"), 'With supervisor', 'R4: the result');

    // the real action: handed to the supervisor, the card gone, and the next close quiet
    V = await visit('#library');
    await openW(V, 'rem-sup');
    await closeBy(V, 'x');
    await shownSoon(V, 'R4 real');
    await wrap(V);
    await pressArmed(V, 'av-remind-hand');
    await V.settle("document.getElementById('av-remind')?.querySelector('.tx')?.textContent === 'With supervisor'", 4000);
    assert.equal(await V.p.ev("document.getElementById('av-remind').querySelector('.tx').textContent"), 'With supervisor', 'R4: the real result');
    assert.deepEqual(await V.p.ev("window.__posts.filter((p) => p.action === 'artifact-handoff').map((p) => p.body)"), [{ slug: 'viewer-a', at: 'rem-sup' }], 'R4: the real post');
    await V.settle(`!${REMIND}`, 6000);
    assert.equal(await V.p.ev(REMIND), false, 'R4: hidden within 6 s');
    for (const id of V_SUP) assert.equal(JSON.parse(F.owner(['thread', 'show', id, '--json'])).handed?.to, 'supervisor', `R4: ${id} handed to the supervisor`);
    await V.soon(`${J(V_SUP)}.every((id) => TL.threads.find((t) => t.id === id)?.handed)`, 'R4: the page read the notes as handed');
    await openW(V, 'rem-sup');
    await closeBy(V, 'x');
    await notShown(V, 'R4 after Hand over');

    // a refusal
    V = await visit('#library');
    await openW(V, 'rem-x');
    await closeBy(V, 'x');
    await shownSoon(V, 'R4 refusal');
    await wrap(V);
    await V.p.ev("window.__stub['artifact-handoff'] = { status: 400, body: { error: 'x' } }; void 0");
    await pressArmed(V, 'av-remind-hand');
    await V.settle("document.getElementById('e-avr')?.textContent === 'Not saved: x'", 3000);
    const s = await V.p.ev(SAYS);
    assert.equal(s.err, 'Not saved: x', 'R4: the refusal');
    assert.equal(s.hand, 'Hand over to the supervisor', 'R4: the buttons stay');

    // the bar's own press posts the same body
    V = await visit('#library');
    await openW(V, 'rem-bar');
    await wrap(V);
    await V.p.ev("window.__stub['artifact-handoff'] = { status: 200, body: { to: 'supervisor', typed: false, count: 2 } }; void 0");
    await pressArmed(V, 'av-handover');
    await V.soon("window.__posts.some((p) => p.action === 'artifact-handoff')", "R4: the bar's press posted");
    assert.deepEqual(await V.p.ev("window.__posts.find((p) => p.action === 'artifact-handoff').body"), { slug: 'viewer-a', at: 'rem-bar' }, "R4: the bar's body is the reminder's");
  });

  // R4b (final-1 F1): the card's Hand over is under kit-145's press guard (spec §2.1). The card comes up as the
  // viewer closes, which a framed page can bring about, so a real press as it appears, or just after it moved,
  // posts nothing and says the guard's words; once it has sat ASK_ARM_MS (the guard's own armed state) it posts.
  // Each held press is one press, never V.press's retry a second later.
  await sub('R4b: the card\'s Hand over is under the press guard', async () => {
    const V = await visit('#library');
    await openW(V, 'rem-busy');
    await wrap(V);
    await V.p.ev("window.__stub['artifact-handoff'] = { status: 200, body: { to: 'supervisor', typed: false, count: 2 } }; void 0");
    await V.p.ev("window.__downAt = null; window.addEventListener('pointerdown', () => { window.__downAt ??= performance.now(); }, true); void 0");
    const HELD = "(() => { const e = document.getElementById('av-held'); return !!e && !e.hidden && e.textContent === 'That moved just now. Press again in a second.'; })()";
    const POSTS = "window.__posts.filter((p) => p.action === 'artifact-handoff').map((p) => p.body)";
    const centre = "(() => { const b = document.getElementById('av-remind-hand'), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, top: !!document.elementFromPoint(x, y)?.closest('#av-remind-hand') }; })()";
    // (a) the close (as the X's own first way: the entry replaced by the page, then routed), and in the same turn
    // where the card's Hand over is; one real press there at once
    const at = await V.p.ev(`(() => { history.replaceState({ page: '#library', depth: 0, openedHere: false }, '', '#library'); route(); const c = ${centre}; return { ...c, closed: performance.now(), shown: ${REMIND} }; })()`);
    assert.ok(at.shown, 'setup: R4b the card came up with the close');
    assert.ok(at.top, 'setup: R4b #av-remind-hand is covered');
    await V.p.clickAt(at.x, at.y);
    await V.settle(HELD, 2000);
    await V.p.ev(FRAMES);
    assert.deepEqual(await V.p.ev(POSTS), [], 'R4b: a press as the card appears posts nothing');
    assert.equal(await V.p.ev(HELD), true, 'R4b: a press as the card appears shows the held words');
    const down = await V.p.ev('window.__downAt');
    assert.ok(down !== null && down - at.closed < await V.p.ev('ASK_ARM_MS'), `setup: R4b pressed within ASK_ARM_MS of the close (${down === null ? 'no press' : Math.round(down - at.closed) + ' ms'})`);
    // (b) settled, then moved (bottom 24px to 200px), then one real press on it at once
    await V.soon(ARMED('av-remind-hand'), 'setup: R4b #av-remind-hand settled, by the press guard');
    const moved = await V.p.ev(`(() => { document.getElementById('av-remind').style.bottom = '200px'; return ${centre}; })()`);
    assert.ok(moved.top, 'setup: R4b #av-remind-hand is covered after the move');
    await V.p.ev("document.getElementById('av-held').textContent = ''; void 0");
    await V.p.clickAt(moved.x, moved.y);
    await V.settle(HELD, 2000);
    await V.p.ev(FRAMES);
    assert.deepEqual(await V.p.ev(POSTS), [], 'R4b: a press just after the card moved posts nothing');
    assert.equal(await V.p.ev(HELD), true, 'R4b: a press just after the card moved shows the held words');
    // (c) once armed, it posts once, with the bar's body
    await pressArmed(V, 'av-remind-hand');
    await V.settle("document.getElementById('av-remind')?.querySelector('.tx')?.textContent === 'With supervisor'", 4000);
    assert.deepEqual(await V.p.ev(POSTS), [{ slug: 'viewer-a', at: 'rem-busy' }], 'R4b: a settled press posts once, {slug, at}');
    // (d) a person who may only look: View only's words, as the bar's Hand over gets, and nothing posted
    const W = await visit('#library');
    await openW(W, 'rem-busy');
    await closeBy(W, 'x');
    await shownSoon(W, 'R4b view only');
    await wrap(W);
    // (kept at view through the page's polls, as kit-145's A24 does)
    await W.p.ev("window.__stub['artifact-handoff'] = { status: 200, body: { to: 'supervisor', typed: false, count: 2 } }; window.__vo = viewOnly; viewOnly = () => window.__vo('view'); viewOnly(); void 0");
    await pressArmed(W, 'av-remind-hand');
    await W.settle("document.getElementById('view-only-toast')?.textContent === 'View only: you can look, but not change anything'", 2000);
    assert.equal(await W.p.ev("document.getElementById('view-only-toast')?.textContent ?? null"), 'View only: you can look, but not change anything', 'R4b: view only gets its own words');
    assert.deepEqual(await W.p.ev(POSTS), [], 'R4b: view only posts nothing');
  });


  // R13 (kit-916): the guard's words ("That moved just now. Press again in a second.", #av-held) and View only's
  // (#view-only-toast) never cover the card's buttons while it shows, at 1280 and 375 px wide, and stay inside the
  // window. A sampler in the page reads, every frame once the frame's own callbacks have run (what is drawn),
  // whether either message's box meets Not now's or Hand over's, or leaves the window. Three ways in, each its own
  // case: (a) held, as the card appears; (b) View only's words up, then the card comes up under them; (c) View
  // only, pressed on the card's own Hand over.
  const SAMPLE = `(() => {
    window.__hits = []; window.__out = []; window.__seen = { 'av-held': 0, 'view-only-toast': 0 }; window.__sampling = true;
    const box = (e) => { if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const tick = () => {
      if (!window.__sampling) return;
      const c = document.getElementById('av-remind');
      if (c && !c.hidden) for (const id of ['av-held', 'view-only-toast']) {
        const m = box(document.getElementById(id));
        if (!m) continue;
        window.__seen[id]++;
        if (m.top < 0 || m.left < 0 || m.right > innerWidth || m.bottom > innerHeight) window.__out.push([id, Math.round(m.top), Math.round(m.bottom)]);
        for (const b of ['av-remind-later', 'av-remind-hand']) { const r = box(document.getElementById(b)); if (r && meet(m, r)) window.__hits.push([id, b, Math.round(m.top), Math.round(m.bottom), Math.round(r.top), Math.round(r.bottom)]); }
      }
      requestAnimationFrame(() => setTimeout(tick));
    };
    requestAnimationFrame(() => setTimeout(tick));
    return true;
  })()`;
  const SAMPLED = '(() => { window.__sampling = false; return { hits: window.__hits.slice(0, 3), n: window.__hits.length, out: window.__out.slice(0, 3), seen: window.__seen }; })()';
  // the close as the X's own first way (the entry replaced by the page, then routed): the card comes up in this turn
  const CLOSE_NOW = "history.replaceState({ page: '#library', depth: 0, openedHere: false }, '', '#library'); route();";
  const STUB = "window.__stub['artifact-handoff'] = { status: 200, body: { to: 'supervisor', typed: false, count: 2 } };";
  // (kept at view through the page's polls, as R4b (d) does)
  const VIEW = `${STUB} window.__vo = viewOnly; viewOnly = () => window.__vo('view'); viewOnly(); void 0`;
  const clear = (s, id, what, w) => {
    assert.ok(s.seen[id] > 0, `setup: R13 ${w} ${what} showed with the card (${J(s)})`);
    assert.deepEqual(s.hits, [], `R13: at ${w} px ${what} never meet the card's buttons (${s.n} frames)`);
    assert.deepEqual(s.out, [], `R13: at ${w} px ${what} stay inside the window`);
  };
  for (const [w, h] of [[1280, 800], [375, 700]]) {
    await sub(`R13a: at ${w} px the held words clear the card's buttons`, async () => {
      const V = await visit('#library', { width: w, height: h });
      await openW(V, 'rem-busy');
      await wrap(V);
      await V.p.ev(`${STUB} void 0`);
      await V.p.ev(SAMPLE);
      // one real press on the card's Hand over as it appears (as R4b (a))
      const at = await V.p.ev(`(() => { ${CLOSE_NOW} const b = document.getElementById('av-remind-hand'), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, shown: ${REMIND}, top: !!document.elementFromPoint(x, y)?.closest('#av-remind-hand') }; })()`);
      assert.ok(at.shown && at.top, `setup: R13a ${w} the card came up with its Hand over bare (${J(at)})`);
      await V.p.clickAt(at.x, at.y);
      await V.settle("(() => { const e = document.getElementById('av-held'); return !!e && !e.hidden && e.textContent === 'That moved just now. Press again in a second.'; })()", 2000);
      await new Promise((r) => setTimeout(r, 1500));
      clear(await V.p.ev(SAMPLED), 'av-held', 'the held words', w);
      assert.deepEqual(await V.p.ev("window.__posts.filter((p) => p.action === 'artifact-handoff')"), [], 'setup: R13a the held press posted nothing');
    });
    await sub(`R13b: at ${w} px View only's words, up as the card comes, clear its buttons`, async () => {
      const W = await visit('#library', { width: w, height: h });
      await openW(W, 'rem-busy');
      await wrap(W);
      await W.p.ev(VIEW);
      await W.p.ev(SAMPLE);
      // View only's words up, as a press on the bar's Hand over shows them; then the close, and the card under them
      await W.p.ev(`viewToast(); ${CLOSE_NOW} void 0`);
      await shownSoon(W, `R13b ${w}`);
      await new Promise((r) => setTimeout(r, 1000));
      clear(await W.p.ev(SAMPLED), 'view-only-toast', "View only's words", w);
    });
    await sub(`R13c: at ${w} px View only's words, pressed on the card, clear its buttons`, async () => {
      const W = await visit('#library', { width: w, height: h });
      await openW(W, 'rem-busy');
      await closeBy(W, 'x');
      await shownSoon(W, `R13c ${w}`);
      await wrap(W);
      await W.p.ev(VIEW);
      await W.p.ev(SAMPLE);
      await pressArmed(W, 'av-remind-hand');
      await W.settle("document.getElementById('view-only-toast')?.hidden === false", 2000);
      await new Promise((r) => setTimeout(r, 1500));
      clear(await W.p.ev(SAMPLED), 'view-only-toast', "View only's words", w);
      assert.deepEqual(await W.p.ev("window.__posts.filter((p) => p.action === 'artifact-handoff')"), [], 'setup: R13c view only posted nothing');
    });
  }
  // R5: Not now holds; a new note shows it again; Hand over ends the hold; a reload ends it; no storage.
  await sub('R5: Not now and the hold', async () => {
    let V = await visit('#library');
    await openW(V, 'rem-hold');
    await closeBy(V, 'x');
    await shownSoon(V, 'R5 first');
    await pressId(V, 'av-remind-later');
    await V.settle(`!${REMIND}`, 2000);
    assert.equal(await V.p.ev(REMIND), false, 'R5: Not now hides it');
    await openW(V, 'rem-hold');
    await closeBy(V, 'x');
    await notShown(V, 'R5 held');
    const C = note('rem-hold', 'Note 3 on rem-hold');
    await hasThreads(V, [C]);
    await openW(V, 'rem-hold');
    await closeBy(V, 'x');
    let s = await shownSoon(V, 'R5 a new note');
    assert.match(s.tx, /^3 notes on Viewer A aren't handed over\./, 'R5: a new note');
    await pressId(V, 'av-remind-later');
    await openW(V, 'rem-hold');
    await wrap(V);
    await pressArmed(V, 'av-handover');
    await V.soon(`${J([...V_HOLD, C])}.every((id) => TL.threads.find((t) => t.id === id)?.handed)`, 'R5: handed from the bar');
    F.owner(['thread', 'say', V_HOLD[0], 'Not quite: bigger still']);
    // (read now, not at the page's next 5 s poll)
    await V.p.ev('tlRefresh(); void 0');
    await V.soon(`TL.threads.find((t) => t.id === ${J(V_HOLD[0])})?.handed == null`, 'R5: the reply sent A back');
    await closeBy(V, 'x');
    s = await shownSoon(V, 'R5 sent back');
    assert.match(s.tx, /^1 note on Viewer A isn't handed over\./, 'R5: the note sent back');
    assert.deepEqual(await V.p.ev("[...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => /remind/i.test(k))"), [], 'R5: nothing stored');
    await pressId(V, 'av-remind-later');
    await V.reload();
    await openW(V, 'rem-hold');
    await closeBy(V, 'x');
    await shownSoon(V, 'R5 after a reload');
  });

  // R5b: a second Not now on another version of the artifact adds to the hold, never replaces it.
  await sub('R5b: the hold adds up across versions', async () => {
    const V = await visit('#library');
    await openW(V, 'rem-u1');
    await closeBy(V, 'x');
    await shownSoon(V, 'R5b first');
    await pressId(V, 'av-remind-later');
    await openW(V, 'rem-u2');
    await closeBy(V, 'x');
    await shownSoon(V, 'R5b the other version');
    await pressId(V, 'av-remind-later');
    await openW(V, 'rem-u1');
    await closeBy(V, 'x');
    await notShown(V, 'R5b the first version, still held');
  });

  // R6: never in the way: the page behind navigates, no history entry, a viewer opening hides it.
  await sub('R6: never in the way', async () => {
    const V = await visit('#library');
    await openW(V, 'plan-rem');
    await wrap(V);
    const len0 = await V.p.ev('history.length');
    await closeBy(V, 'x');
    await shownSoon(V, 'R6');
    await pressId(V, 'av-remind-later');
    assert.deepEqual(await V.p.ev('[history.length, window.__pushes, location.hash]'), [len0, 0, '#library'], 'R6: showing it and Not now add no entry');
    await openW(V, 'rem-x');
    await closeBy(V, 'x');
    await shownSoon(V, 'R6 again');
    const len = await V.p.ev('history.length');
    const link = await V.p.ev(`(() => { const a = [...document.querySelectorAll('nav.nav a[href^="#"]')].find((x) => x.getAttribute('href') !== location.hash && x.getBoundingClientRect().width > 0); if (!a) return null; const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert.ok(link, 'setup: a nav link to press');
    await V.p.clickAt(link.x, link.y);
    await V.settle(`location.hash.startsWith(${J(link.href)})`, 3000);
    assert.ok((await V.p.ev('location.hash')).startsWith(link.href), 'R6: the page behind navigates');
    assert.equal(await V.p.ev(REMIND), true, 'R6: the reminder stays');
    assert.equal(await V.p.ev('history.length'), len, 'R6: the nav click took the forward entry X left');
    await V.p.ev('history.back(); void 0');
    await V.settle(`location.hash === '#library'`, 3000);
    assert.equal(await V.p.ev('location.hash'), '#library', 'R6: only the nav link added an entry');
    // a viewer opening hides it
    const W = await visit('#library');
    await openW(W, 'plan-rem');
    await closeBy(W, 'x');
    await shownSoon(W, 'R6 before a viewer opens');
    await W.open('#artifact/main/viewer-b');
    assert.equal(await W.p.ev(REMIND), false, 'R6: an artifact opening hides it');
    const X = await visit('#library');
    await openW(X, 'plan-rem');
    await closeBy(X, 'x');
    await shownSoon(X, 'R6 before a preview opens');
    await X.open(PV);
    assert.equal(await X.p.ev(REMIND), false, 'R6: a preview opening hides it');
    // with the Threads panel open at desktop width: beside it, never over it, and on top where it is. At
    // 1000 px the panel's left is 620, so a card centred in the window (280-720) would cross it (plan-1 F1).
    const Y = await visit('#library?th=open', { width: 1000, height: 800 });
    await Y.soon("document.body.classList.contains('threads-open')", 'setup: the Threads panel open');
    await openW(Y, 'plan-rem');
    await closeBy(Y, 'x');
    await shownSoon(Y, 'R6 with the panel open');
    const g = await Y.p.ev("(() => { const r = document.getElementById('av-remind').getBoundingClientRect(), p = document.querySelector('.threads').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { right: r.right, panel: p.left, top: !!document.elementFromPoint(x, y)?.closest('#av-remind'), z: [getComputedStyle(document.getElementById('av-remind')).zIndex, getComputedStyle(document.querySelector('.threads')).zIndex].map(Number) }; })()");
    assert.ok(g.right <= g.panel, `R6: the card ${J(g)} is left of the panel`);
    assert.ok(g.top, 'R6: the card is on top at its centre');
    assert.ok(g.z[0] < g.z[1], `R6: the card is under the panel (${J(g.z)})`);
    // Y is the one tab in this file opened with the Threads panel, which the page remembers in localStorage
    // (devteam.threads.open), so the next tab's WATCH would clear a stored key as its first document starts. Three
    // times on CI (kit-924) that next tab, R7's first, never committed its navigation. Not reproduced off CI and
    // not shown to be the cause: Y leaves nothing stored, so the next tab's clear finds nothing.
    await Y.p.ev('localStorage.clear(); void 0');
    assert.equal(await Y.p.ev('localStorage.length'), 0, 'setup: Y leaves nothing in localStorage (kit-924)');
  });

  // R7: a preview, and a viewer replaced, show none; at 375 px it fits.
  await sub('R7: previews, replacing, and 375 px', async () => {
    // A tab that got its response and never committed (CI, kit-924): Chrome holds every call to a tab while its
    // navigation is pending, so the visit's first wait gets "no answer from Chrome in 30 s", the tab not yet at a URL
    // and the answer to Page.navigate the last thing its socket heard (kit-914's diagnosis). That shape alone is said
    // as such (kit-924); the diagnosis's processes line names each Chrome process's state and CPU (kit-930). Any other
    // failure is thrown as it was.
    const NEVER_COMMITTED = /no answer from Chrome in 30 s; tab \S+ at ; last heard on its socket: [^;]*the answer to Page\.navigate [\d.]+ s ago; /;
    const visit7 = async (hash, opts) => {
      try { return await visit(hash, opts); } catch (e) {
        if (NEVER_COMMITTED.test(e.message)) assert.fail(`R7: the tab sent to ${hash} got its response and never committed its navigation: a stall inside Chrome, not this case's (kit-924; its processes line says which Chrome process was doing what, kit-930). ${e.message}`);
        throw e;
      }
    };
    let V = await visit7('#library');
    await V.open(PV);
    await closeBy(V, 'x');
    await notShown(V, 'R7 a preview');
    V = await visit7('#library');
    await openW(V, 'plan-rem');
    await V.open('#artifact/main/viewer-b');
    await notShown(V, 'R7 replaced by another artifact');
    await V.open(PV);
    await notShown(V, 'R7 replaced by a preview');
    V = await visit7('#library', { width: 375, height: 700 });
    await openW(V, 'plan-rem');
    await closeBy(V, 'x');
    await shownSoon(V, 'R7 375');
    const box = await V.p.ev("(() => { const r = document.getElementById('av-remind').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.scrollingElement.scrollWidth }; })()");
    assert.ok(box.l >= 0 && box.r <= box.w, `R7: the box ${J(box)} inside the window`);
    assert.ok(box.sw <= box.w, `R7: no horizontal scroll (${J(box)})`);
  });

  // R9-R12: the thread code, called in the page on rows shaped like kit-143's views.
  const T0 = '2026-11-20T10:00:00.000Z';
  const row = (o = {}) => ({ id: 't-20261120-100000000-owner', title: 'A note', subject: { kind: 'artifact', slug: 'viewer-a', at: 'plan-rem', path: 'index.html', point: { x: 5, y: 5 } }, status: 'open', outcome: null, ready: null, turns: [{ id: 'u-1', by: 'owner', at: T0, text: 'Make it bigger', refs: [], question: null, files: [] }], questions: [], waiting: 'owner', created_at: T0, resolved_at: null, activity_at: T0, first_reply_ms: null, handed: null, addressed: null, check: null, shot: null, noshot: null, unready: null, frame: null, source: null, ...o });
  const withRow = (to, extra = {}) => row({ handed: { to, at: T0 }, waiting: 'session', with: to, ...extra });
  const plain = row({ subject: null, waiting: 'owner' });
  const ev = (V, js) => V.p.ev(`(() => { ${js} })()`);
  const where = (V, r) => ev(V, `const d = document.createElement('ul'); d.innerHTML = thRow(${J(r)}, new Map()); return d.querySelector('.th-where')?.textContent ?? null;`);

  await sub('R9: the row says not handed over, or with whom', async () => {
    const V = await visit('#library');
    assert.match(await where(V, row()) ?? '', /Open · not handed over yet$/, 'R9: an open note');
    assert.match(await where(V, withRow('plan-pricing')) ?? '', /With plan-pricing$/, 'R9: a with note');
    assert.doesNotMatch(await where(V, plain) ?? '', /handed|With /, 'R9: another thread');
  });

  await sub("R10: 'with' has no dot and no number", async () => {
    const V = await visit('#library');
    const w = withRow('plan-pricing');
    assert.equal(await ev(V, `return tState(${J(w)});`), 'with', "R10: tState of a with row");
    assert.ok(await ev(V, 'return Array.isArray(TH_MARK.with);'), 'R10: TH_MARK.with');
    const mark = await ev(V, `const d = document.createElement('ul'); document.body.append(d); d.innerHTML = thRow(${J(w)}, new Map()); const m = d.querySelector('.th-st'); const c = m && getComputedStyle(m); const o = m ? { cls: [...m.classList], bg: c.backgroundColor, border: c.borderTopStyle } : null; d.remove(); return o;`);
    assert.ok(mark && !mark.cls.includes('you') && !mark.cls.includes('ok') && !mark.cls.includes('wait'), `R10: the mark ${J(mark)} has no dot`);
    assert.deepEqual([mark.bg, mark.border], ['rgba(0, 0, 0, 0)', 'none'], 'R10: the mark draws nothing');
    const c1 = await ev(V, `const c = tCounts([${J(w)}]); return { c, b: tButton(c) };`);
    assert.deepEqual([c1.c.with, c1.c.you, c1.b.n], [1, 0, 0], 'R10: counted under with, in no number');
    const c2 = await ev(V, `return tButton(tCounts([${J(w)}, ${J(row({ id: 't-20261120-100000001-owner' }))}])).n;`);
    assert.equal(c2, 1, 'R10: with and your move: 1');
  });

  await sub('R11: the instant update', async () => {
    const V = await visit('#library');
    const r = withRow('plan-pricing', { check: 'addressed', ready: { at: T0, outcome: 'x' }, addressed: { by: 'plan-pricing', at: T0, note: 'The button is primary now', sha: null, draft: null } });
    const pend = { thread: r.id, had: 1, turn: { id: null, by: 'owner', at: '2026-11-20T10:05:00.000Z', text: 'Not yet', refs: [], question: null, pending: true, files: [] } };
    const got = await ev(V, `const t = tOverlay([${J(r)}], [${J(pend)}])[0]; return { waiting: t.waiting, ready: t.ready, check: t.check, handed: t.handed, has: 'with' in t };`);
    assert.deepEqual(got, { waiting: 'owner', ready: null, check: null, handed: null, has: false }, 'R11: the owner\'s move, nothing standing');
    const pl = await ev(V, `return tOverlay([${J({ ...plain, waiting: 'supervisor' })}], [${J({ ...pend, thread: plain.id })}])[0].waiting;`);
    assert.equal(pl, 'supervisor', 'R11: another thread waits on the supervisor');
    const res = row({ id: 't-20261120-100000002-owner', status: 'resolved', outcome: 'x', waiting: 'supervisor' });
    const re = await ev(V, `const t = tOverlay([${J(res)}], [${J({ thread: res.id, real: res.id, status: 'open', confirmed: false })}])[0]; return { status: t.status, waiting: t.waiting, check: t.check, handed: t.handed };`);
    assert.deepEqual(re, { status: 'open', waiting: 'owner', check: null, handed: null }, 'R11: a pending reopen is the owner\'s move');
    const fresh = await ev(V, `return tPendingThread('t-new', 'New', ${J(row().subject)}, ${J(pend.turn)}).waiting;`);
    assert.equal(fresh, 'owner', 'R11: a new note is the owner\'s move');
  });

  await sub("R12: an artifact note's card line", async () => {
    const V = await visit('#library');
    await V.soon("(DATA?.library?.artifacts ?? []).some((x) => x.slug === 'viewer-a' && x.at === 'plan-rem')", 'setup: the Library lists plan-rem');
    const at = (min) => Date.parse(T0) + min * 60000;
    const line = (r, now, pane = true) => ev(V, `return tCardState(${J(r)}, ${now}, null, ${pane}, null, null);`);
    const pendRow = row({ turns: [{ id: null, by: 'owner', at: T0, text: 'x', refs: [], question: null, pending: true, files: [] }] });
    assert.equal(await line(row(), at(1)), 'Not handed over yet. Hand over sends it to plan-rem.', 'R12: open');
    assert.equal(await line(pendRow, at(1)), 'Sending…', 'R12: pending');
    assert.equal(await line(withRow('plan-pricing'), at(1)), 'With plan-pricing.', 'R12: with a session');
    const sup = withRow('supervisor', { waiting: 'supervisor' });
    assert.equal(await line(sup, at(5)), 'With supervisor.', 'R12: with the supervisor, 5 min');
    assert.equal(await line(sup, at(11)), "The supervisor hasn't replied yet.", 'R12: the supervisor, 11 min, pane');
    assert.equal(await line(sup, at(11), false), "The supervisor hasn't replied yet.", 'R12: the supervisor, 11 min, no pane');
    const said = withRow('supervisor', { waiting: 'session', turns: [...row().turns, { id: 'u-2', by: 'supervisor', at: '2026-11-20T10:01:00.000Z', text: 'On it', refs: [], question: null, files: [] }] });
    assert.equal(await line(said, at(11)), 'With supervisor.', 'R12: the supervisor said On it');
    assert.equal(await line(withRow('plan-x'), at(11)), 'With plan-x.', 'R12: with plan-x, 11 min');
    // a resolved note's card, opened in the viewer: today's words stay
    await openW(V, 'rem-res');
    await V.soon(`TL.threads.some((t) => t.id === ${J(RES)} && t.status === 'resolved')`, 'setup: the page has the resolved note');
    await V.p.ev(`tlOpen(${J(RES)}); void 0`);
    await V.settle(`document.getElementById('tl-c-state')?.textContent === 'Resolved: Bigger now. Writing reopens it.'`, 3000);
    assert.equal(await V.p.ev("document.getElementById('tl-c-state')?.textContent"), 'Resolved: Bigger now. Writing reopens it.', 'R12: resolved');
    assert.equal(await line(row({ check: 'addressed', addressed: { by: 'plan-rem', at: T0, note: 'The button is primary now', sha: null, draft: null } }), at(1)), null, 'R12: to check');
  });

  // R12b: the card itself, in the viewer: an open note whose newest turn is the owner's says the line, not
  // kit-145's "Kept with the note" (catchup.md D-1; a-20261125-063728613's ruling)
  await sub("R12b: an open note's card says it isn't handed over", async () => {
    const V = await visit('#library');
    await openW(V, 'rem-card');
    await hasThreads(V, [CARD]);
    await V.p.ev(`TL.typed[${J(CARD)}] = false; tlOpen(${J(CARD)}); void 0`);
    await V.settle(`document.getElementById('tl-c-state')?.textContent === 'Not handed over yet. Hand over sends it to the supervisor.'`, 3000);
    assert.equal(await V.p.ev("document.getElementById('tl-c-state')?.textContent"), 'Not handed over yet. Hand over sends it to the supervisor.', 'R12b: the open card');
  });
});
