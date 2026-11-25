// kit-146: the artifact-annotations design's §End to end, run against the real kit in headless Chrome.
// One top-level test, a subtest per step, each reading what the last left (a failed step fails the rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, FRAMES, VIEWER_UP } from './fixtures/artifact-viewer/harness.mjs';
import { buildStack, ok, logLines, SLUG, FAQ, PLAN, CHORE, OLD } from './fixtures/artifact-annotations-e2e/stack.mjs';

const WIN = { width: 1100, height: 800 };
const HEAD_P = `#artifact/wt/${PLAN}/${SLUG}`;

test('artifact annotations, end to end', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const H = await harness(t, 'ann-e2e');
  const { F, visit, AV_A, AV_B, PV } = H;
  const times = {};
  const step = (name, fn, opts = {}) => t.test(name, { timeout: 120000, ...opts }, async (s) => {
    const at = Date.now();
    try { await fn(s); } finally { times[name] = Date.now() - at; t.diagnostic(`${name}: ${times[name]} ms`); }
  });
  const stack = buildStack(F);

  // the four rows the library lists: pricing only in the planner's worktree, faq on main and in two drafts
  const ROWS = [[SLUG, PLAN], [FAQ, 'main'], [FAQ, CHORE], [FAQ, OLD]].map(([slug, at]) => `${slug} ${at}`).sort();
  const rows = (list) => list.map((a) => `${a.slug} ${a.at}`).sort();

  await step('step 1: pricing at plan-pricing only, faq on main and in two drafts', async () => {
    const listed = JSON.parse(ok(F, 'owner', ['artifacts', '--json'])).filter((a) => [SLUG, FAQ].includes(a.slug));
    assert.deepEqual(rows(listed), ROWS, 'artifacts --json lists the four rows');
    // the dashboard was up before the stack was built: a fresh visit lists the same four
    const V = await visit('#library', WIN);
    const listed5 = await V.settle(`JSON.stringify(DATA.library.artifacts.filter((a) => ['${SLUG}', '${FAQ}'].includes(a.slug)).map((a) => a.slug + ' ' + a.at).sort()) === ${J(J(ROWS))}`, 5000);
    assert.ok(listed5, `the dashboard's library lists the same four rows within 5 s: ${await V.p.ev("JSON.stringify(DATA.library.artifacts.map((a) => a.slug + ' ' + a.at))")}`);
  });

  // ---- the viewer helpers (the probe's, moved in) ----
  const said = (from, page, hash = null) => `window.__own.slice(${from}).some((m) => m.own === 'at' && m.page === ${J(page)}${hash === null ? '' : ` && m.hash === ${J(hash)}`})`;
  // the draft opened over the library, its lens ready and its index loaded in the frame
  const openDraft = async (V) => {
    const n = await V.mark();
    await V.p.ev(`location.hash = ${J(HEAD_P)}; void 0`);
    await V.soon(`${VIEWER_UP} && TS.kind === 'artifact' && TS.slug === ${J(SLUG)} && TS.at === ${J(PLAN)} && TS.ready`, 'setup: the viewer up on the draft, its lens ready');
    await V.soon(said(n, 'pricing/index.html'), "setup: the draft's index loaded in the frame");
  };
  const threads = () => JSON.parse(ok(F, 'owner', ['thread', 'list', '--all', '--json']));
  const notes = {}, widths = {};
  // a note placed by real input (the Threads panel closed): Shift held, the pointer moved there, the lens's hit heard,
  // Shift+click, the draft typed and sent (Enter); the frame's width at that moment kept for C2a
  const place = async (V, key, where, text) => {
    const { p, soon } = V;
    await p.ev('TS.waitMs = 2000');
    const at = await p.ev(`(() => { const f = tsFrame(), r = f.getBoundingClientRect(); const w = ${J(where)}; let x, y; if (w.id) { const m = window.__own.filter((m) => m.own === 'at' && m.rects && m.rects[w.id]).pop(); const e = m.rects[w.id]; x = e.x + e.w / 2; y = e.y + e.h / 2; } else { x = w.x; y = w.y; } return { x: r.left + f.clientLeft + x, y: r.top + f.clientTop + y }; })()`);
    await p.ev('(() => { document.activeElement?.blur?.(); window.focus(); return true; })()');
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'setup: Shift raised the overlay');
    await p.move(at.x, at.y, 8);
    await soon(where.id ? `TS.hit?.anchor?.selector === ${J('#' + where.id)}` : 'TS.hit !== undefined && TS.hit !== null', `setup: the lens's hit for ${key}`);
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.kind === 'artifact'`, `setup: a note about to start (${key})`);
    widths[key] = await p.ev(`document.getElementById('av-frame').clientWidth`);
    const before = new Set(threads().map((x) => x.id));
    await p.type(text);
    await p.key('Enter', 8);
    let th = null;
    for (let i = 0; i < 200 && !th; i++) { th = threads().find((x) => !before.has(x.id) && x.subject?.kind === 'artifact'); if (!th) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(th, `setup: the note ${key} was written`);
    await p.ev('tlClose(); TS.waitMs = 150; void 0');
    notes[key] = th;
    t.diagnostic(`${key} ${th.id} subject ${J(th.subject)}`);
    return th;
  };
  const pins = (V) => V.p.ev(`[...document.querySelectorAll('#av-pins [data-tl-pin]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).display !== 'none'; }).map((b) => b.dataset.tlPin).sort()`);
  const pinsAre = async (V, keys, what) => {
    const want = keys.map((k) => notes[k].id).sort();
    await V.settle(`(() => { const s = [...document.querySelectorAll('#av-pins [data-tl-pin]')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.dataset.tlPin).sort(); return ${J(want.join())} === s.join(); })()`, 4000);
    await V.p.ev(FRAMES);
    assert.deepEqual(await pins(V), want, `${what}: exactly ${keys.join(', ') || 'no'} pins`);
  };

  await step('step 2: four notes placed by real input on the draft', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    await V.frameClick('to-a', 'pricing/a.html');
    await place(V, 'N1', { id: 'plan-monthly' }, 'Make the monthly plan stand out');
    await V.frameClick('to-tab2', 'pricing/a.html', { hash: '#tab2', load: false });
    await place(V, 'N2', { id: 'annual-price' }, 'Show the saving on the annual price');
    await place(V, 'N3', { x: 800, y: 420 }, 'This half of the annual view is empty');
    await V.frameClick('to-b', 'pricing/b.html');
    await V.frameClick('to-section-2', 'pricing/b.html', { hash: '#section-2', load: false });
    await place(V, 'N4', { id: 'faq-cancel' }, 'Answer the cancel question first');
  });

  await step('C2a: each note has its subject and the frame it was placed over', async () => {
    const want = { N1: ['a.html', '#plan-monthly', ''], N2: ['a.html', '#annual-price', '#tab2'], N3: ['a.html#tab2', undefined, '#tab2'], N4: ['b.html', '#faq-cancel', '#section-2'] };
    for (const [key, [path, selector, hash]] of Object.entries(want)) {
      assert.ok(notes[key], `C2a: ${key} was placed in step 2`);
      const th = JSON.parse(ok(F, 'owner', ['thread', 'show', notes[key].id, '--json']));
      const sub = th.subject, frame = th.frame;
      assert.equal(sub.kind, 'artifact', `C2a: ${key} is an artifact note`);
      assert.equal(sub.slug, SLUG, `C2a: ${key} is about ${SLUG}`);
      assert.equal(sub.at, PLAN, `C2a: ${key} is at ${PLAN}`);
      assert.equal(sub.path, path, `C2a: ${key}'s path`);
      assert.equal(sub.anchor?.selector, selector, `C2a: ${key}'s anchor selector`);
      assert.ok(frame, `C2a: ${key} carries the frame it was placed over: ${J(th)}`);
      if (key === 'N2' || key === 'N4') assert.equal(frame.hash, hash, `C2a: ${key}'s frame.hash`);
      assert.ok(Number.isInteger(widths[key]) && widths[key] > 0, `C2a: ${key}'s placement width was read (${widths[key]})`);
      assert.equal(frame.w, widths[key], `C2a: ${key}'s frame.w equals #av-frame's clientWidth at its placement`);
    }
  });

  await step('step 3: each view shows only its own pins', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    await V.frameClick('to-a', 'pricing/a.html');
    await pinsAre(V, ['N1'], 'a.html');
    await V.frameClick('to-tab2', 'pricing/a.html', { hash: '#tab2', load: false });
    await pinsAre(V, ['N2', 'N3'], 'a.html#tab2');
    await V.frameClick('to-b', 'pricing/b.html');
    await pinsAre(V, ['N4'], 'b.html');
    await V.frameClick('to-section-2', 'pricing/b.html', { hash: '#section-2', load: false });
    await pinsAre(V, ['N4'], 'b.html#section-2');
  });

  // step 4: every close closes; each case from a fresh visit, so one failing closer leaves nothing for the next
  for (const kind of ['x', 'escape-dash', 'escape-frame', 'scrim']) {
    await step(`step 4: ${kind} after an in-frame move closes the viewer`, async () => {
      const V = await visit('#library', WIN);
      await openDraft(V);
      await V.frameClick('to-a', 'pricing/a.html');
      await V.close(kind);
      await V.closedOn('#library', `${kind} after an in-frame move`);
    });
  }
  await step('step 4: open A, close, open B, close', async () => {
    const V = await visit('#library', WIN);
    await V.open(AV_A);
    await V.close('x');
    await V.closedOn('#library', 'open A, close');
    await V.open(AV_B);
    await V.close('x');
    await V.closedOn('#library', 'open A, close, open B, close');
  });
  await step("step 4: a preview's route change, then close", async () => {
    const V = await visit('#library', WIN);
    await V.open(PV);
    await V.appLink();
    await V.close('x');
    await V.closedOn('#library', 'a preview after a route change');
  });

  // ---- step 5: the reminder and Hand over ----
  const centre = (V, id) => V.p.ev(`(() => { const r = document.getElementById(${J(id)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const shown = `(() => { const c = document.getElementById('av-remind'); return !!c && !c.hidden; })()`;
  // a real press on a control the press guard holds (kit-145): wait, by polling the page's own avStep.ready, until the
  // control has sat still and uncovered for the guard's second; never on time
  const pressGuarded = async (V, id) => {
    await V.soon(`avStep.ready(document.getElementById(${J(id)})) !== null`, `setup: #${id} settled under the press guard`);
    const at = await centre(V, id);
    await V.press(at.x, at.y, id);
  };
  // the reminder shows as the close lands; a window of polls in which it would have, if it were going to
  const staysHidden = async (V, what) => assert.equal(await V.settle(shown, 1500), false, what);

  await step('step 5: the first close shows the reminder; Not now hides it and the next close shows none', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    await V.soon(`document.getElementById('av-handover').textContent === 'Hand over (4)'`, 'setup: the bar reads Hand over (4) before the close');
    await V.close('x');
    await V.closedOn('#library', 'step 5 first close');
    // merged avRemindShow's template for 4 notes: the title the Library's, plan-pricing the draft's session
    const sentence = "4 notes on Pricing mock aren't handed over. plan-pricing, the session drawing it, won't start on them until you do.";
    assert.ok(await V.settle(shown, 3000), 'C4a: the first close of pricing shows #av-remind');
    assert.equal(await V.p.ev("document.querySelector('#av-remind .tx').textContent"), sentence, "C4a: the reminder's sentence");
    await V.p.ev(FRAMES);
    const at = await centre(V, 'av-remind-later');
    await V.press(at.x, at.y, 'av-remind-later');
    assert.ok(await V.settle(`!(${shown})`, 3000), 'C4b: Not now hides the reminder');
    await openDraft(V);
    await V.soon(`document.getElementById('av-handover').textContent === 'Hand over (4)'`, 'setup: the draft opened again with its four notes');
    await V.close('x');
    await V.closedOn('#library', 'step 5 second close');
    await staysHidden(V, 'C4b: after Not now the next close shows no reminder');
  });

  await step('step 5: Hand over (4) sends one message to plan-pricing; no reminder after', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    await V.soon(`document.getElementById('av-handover').textContent === 'Hand over (4)'`, 'C5a: the bar reads Hand over (4) on a fresh visit');
    await pressGuarded(V, 'av-handover');
    // before anything on the page: the log, then the planner's own read of the notes
    const NAMES = 'artifact notes pricing --at plan-pricing';
    const mine = () => logLines(F).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m && m.type === 'message' && m.kind === 'info' && m.to === PLAN && String(m.text).includes(NAMES));
    let msgs = [];
    for (let i = 0; i < 200 && !msgs.length; i++) { msgs = mine(); if (!msgs.length) await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(msgs.length, 1, `C5a: exactly one info message to ${PLAN} naming \`${NAMES}\` is in the log (${msgs.length})`);
    assert.equal(msgs[0].by, 'owner', "C5a: the message is the owner's");
    const list = JSON.parse(ok(F, 'planner', ['artifact', 'notes', SLUG, '--at', PLAN, '--json']));
    assert.deepEqual(list.map((n) => n.id).sort(), Object.values(notes).map((n) => n.id).sort(), 'C5a: the planner lists N1-N4');
    for (const n of list) assert.equal(n.state, `with ${PLAN}`, `C5a: ${n.id} is with ${PLAN}`);
    await V.soon(`document.getElementById('av-with').textContent === 'With ${PLAN}'`, 'step 5: #av-with reads With plan-pricing');
    await V.close('x');
    await V.closedOn('#library', 'step 5 close after Hand over');
    await staysHidden(V, 'C4c: a close after Hand over shows no reminder');
  });

  void stack;
});
