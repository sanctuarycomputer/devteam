// kit-146: the artifact-annotations design's §End to end, run against the real kit in headless Chrome.
// One top-level test, a subtest per step, each reading what the last left (a failed step fails the rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canDrive, chromePath } from './lib/chrome.mjs';
import { harness, J, FRAMES, VIEWER_UP } from './fixtures/artifact-viewer/harness.mjs';
import { buildStack, cli, ok, logLines, markLine, draftChange, writeNoSandboxChrome, png, near, ringAt, SLUG, FAQ, PLAN, CHORE, OLD } from './fixtures/artifact-annotations-e2e/stack.mjs';

const WIN = { width: 1100, height: 800 };
const HEAD_P = `#artifact/wt/${PLAN}/${SLUG}`;

test('artifact annotations, end to end', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const fileAt = Date.now();
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

  // ---- step 6: the pricing marks and the kit's pictures ----
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const frameOf = (key) => JSON.parse(ok(F, 'owner', ['thread', 'show', notes[key].id, '--json'])).frame;
  const noteStates = () => Object.fromEntries(JSON.parse(ok(F, 'planner', ['artifact', 'notes', SLUG, '--at', PLAN, '--json'])).map((n) => [n.id, n.state]));
  // what a mark printed and wrote: the picture's path, the log line naming it by its stamp, the line's shot
  const marked = (key, out) => {
    const m = /^picture: (\S+-light\.png)/m.exec(out);
    assert.ok(m, `C5c ${key}: the mark prints its picture's path: ${out}`);
    const file = m[1];
    const stamp = path.basename(file).replace(/-light\.png$/, '');
    const line = markLine(F, notes[key].id, stamp);
    assert.ok(line?.shot, `C5c ${key}: a log line for ${notes[key].id} carries the shot stamped ${stamp}`);
    return { file, shot: line.shot };
  };
  const shots = {};
  let head = null;

  await step('step 6: the planner marks N2 (without the sandbox) and N4; the supervisor proposes N1 ready', async () => {
    assert.ok(chromePath, 'setup: a Chrome to wrap');
    head = draftChange(F, stack.WT);
    const wrapper = writeNoSandboxChrome(F.base, chromePath);
    const r2 = cli(F, 'planner', ['artifact', 'addressed', notes.N2.id, '--note', 'The annual price now shows the saving'], { CHROME_PATH: wrapper });
    assert.equal(r2.status, 0, `C1b: the planner's mark on N2 through the no-sandbox wrapper succeeds: ${r2.err || r2.out}`);
    assert.match(r2.out, /Chrome's sandbox didn't start here; took the picture without it \(DEVTEAM_CHROME_NO_SANDBOX=1\)/, 'C1b: N2\'s mark says it took the picture without the sandbox');
    shots.N2 = marked('N2', r2.out);
    shots.N4 = marked('N4', ok(F, 'planner', ['artifact', 'addressed', notes.N4.id, '--note', 'The cancel question is answered first now']));
    shots.N1 = marked('N1', ok(F, 'supervisor', ['thread', 'ready', notes.N1.id, '--outcome', 'The monthly plan stands out in draft 2']));
  }, { timeout: 240000 });

  // each mark's picture: the file, its sum, where it was taken from, its width, the ring at the anchor's box (S33)
  const BOX = { N1: { x: 60, y: 60, w: 200, h: 80 }, N2: { x: 60, y: 60, w: 200, h: 80 }, N4: { x: 40, y: 60, w: 240, h: 60 } };
  const FILL = { N1: '#dde3f0', N2: '#1a7f37' };
  await step('C5c: each pricing mark has its picture, from plan-pricing at its HEAD, the frame wide, the ring at the box', async () => {
    for (const key of ['N1', 'N2', 'N4']) {
      const s = shots[key];
      assert.ok(s, `C5c ${key}: marked in step 6`);
      assert.ok(fs.existsSync(s.file), `C5c ${key}: the printed picture ${s.file} exists`);
      const buf = fs.readFileSync(s.file);
      assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), s.shot.sum?.light, `C5c ${key}: the picture's SHA-256 is shot.sum.light`);
      assert.equal(s.shot.src, PLAN, `C5c ${key}: shot.src`);
      assert.equal(s.shot.sha, head, `C5c ${key}: shot.sha is the worktree's HEAD`);
      const fw = frameOf(key).w;
      assert.equal(s.shot.w, fw, `C5c ${key}: shot.w is the note's frame.w`);
      assert.notEqual(s.shot.w, 1400, `C5c ${key}: shot.w isn't the 1400 default`);
      const p = png(buf);
      t.diagnostic(`${key} picture ${p.w}x${p.h} anchor ${s.shot.anchor}`);
      assert.ok(ringAt(p, BOX[key]), `C5c ${key}: the ring is drawn round ${J(BOX[key])} in the ${p.w}x${p.h} picture`);
      // 20px in from the box's bottom right corner: the fill, clear of the element's text at its top left
      if (FILL[key]) { const { x, y, w, h } = BOX[key], px = p.px(x + w - 20, y + h - 20); assert.ok(near(px, rgb(FILL[key])), `C5c ${key}: 20px inside the ring is the element's own ${FILL[key]}, not ${J(px)}`); }
    }
  });

  await step("C5d: N2 pictured on its view, N4's anchor gone", async () => {
    assert.ok(shots.N2 && shots.N4, 'C5d: N2 and N4 were marked in step 6');
    assert.notEqual(shots.N2.shot.anchor, 'hidden', 'C5d N2: shot.anchor is not hidden (pictured on #tab2)');
    const p = png(fs.readFileSync(shots.N2.file)), { x, y, w, h } = BOX.N2, px = p.px(x + w - 20, y + h - 20);
    assert.ok(near(px, rgb('#1a7f37')), `C5d N2: the ring encloses #annual-price's #1a7f37, not ${J(px)}`);
    assert.equal(shots.N4.shot.anchor, 'gone', "C5d N4: shot.anchor is 'gone' (#faq-cancel removed in draft 2)");
  });

  await step('C5e: no Chrome, no mark: N3 is refused and nothing is written for it', async () => {
    const id = notes.N3.id;
    const mine = () => logLines(F).filter((l) => l.includes(id));
    const before = mine();
    const r = cli(F, 'planner', ['artifact', 'addressed', id, '--note', 'The empty half shows the annual terms now'], { CHROME_PATH: '/nonexistent' });
    assert.equal(r.status, 1, `C5e: the mark on N3 with CHROME_PATH=/nonexistent exits 1: ${r.err || r.out}`);
    assert.match(r.err, /Chrome/, 'C5e: stderr names Chrome');
    assert.deepEqual(mine(), before, 'C5e: the log lines naming N3 are the same before and after');
    for (const root of [F.old, stack.WT]) assert.equal(fs.existsSync(path.join(root, 'docs/devteam/run/shots', id)), false, `C5e: no run/shots/${id}/ under ${root}`);
  });

  await step("C5f: the supervisor withdraws N4's mark; the planner is told and marks it again", async () => {
    const id = notes.N4.id;
    const reason = 'the picture shows no cancel answer at all';
    ok(F, 'supervisor', ['thread', 'unready', id, '--reason', reason]);
    const told = logLines(F).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m && m.type === 'message' && m.kind === 'info' && m.to === PLAN && String(m.text).includes(id) && String(m.text).includes(reason));
    assert.equal(told.length, 1, `C5f: one info to ${PLAN} naming N4 and the reason (${told.length})`);
    assert.ok(told[0].text.includes(`artifact notes ${SLUG}`), `C5f: the info names \`artifact notes ${SLUG}\`: ${told[0].text}`);
    assert.equal(noteStates()[id], `with ${PLAN}`, `C5f: N4 is with ${PLAN} in artifact notes`);
    const V = await visit('#library?th=open', WIN);
    const where = `document.querySelector('#tl-list [data-tl-open="${id}"] .th-where')?.textContent ?? null`;
    const ends = await V.settle(`(${where} ?? '').endsWith('With ${PLAN}')`, 5000);
    assert.ok(ends, `C5f: N4's Threads row ends "With ${PLAN}": ${J(await V.p.ev(where))}`);
    ok(F, 'planner', ['artifact', 'addressed', id, '--note', 'The cancel question is answered at the top now']);
    assert.equal(noteStates()[id], 'to check', 'C5f: N4 is to check once the planner marks it again');
  });

  // ---- step 6b: the landed faq artifact, its notes made at main ----
  const L = {};
  // one open note per subject (the kit refuses a second): L1 on the refund question, L2 on the cancel one
  const FAQ_SUBJECT = (selector, text) => ({ kind: 'artifact', slug: FAQ, at: 'main', path: 'index.html', anchor: { selector, tag: 'div', text, point: { x: 60, y: 20 } } });
  const FAQ_ON = { L1: FAQ_SUBJECT('#q-refund', 'Can I get a refund?'), L2: FAQ_SUBJECT('#q-cancel', 'Can I cancel?') };
  await step('step 6b: L1 and L2 on faq at main, handed over; L1 marked from the chore draft, L2 ready after main-2', async () => {
    for (const [key, text] of [['L1', 'Say how long a refund takes'], ['L2', 'Link the refund policy']]) {
      const out = ok(F, 'owner', ['thread', 'new', text, '--title', `Refund ${key}`, '--subject', J(FAQ_ON[key]), '--frame', J({ w: 1068, h: 690, hash: '' })]);
      L[key] = out.split('\n')[0].trim();
      assert.match(L[key], /^t-/, `setup: the owner's note ${key} was made: ${out}`);
    }
    const handed = JSON.parse(ok(F, 'owner', ['artifact', 'handoff', FAQ, '--at', 'main', '--json']));
    assert.equal(handed.to, 'supervisor', 'step 6b: faq at main is handed to the supervisor');
    assert.equal(handed.count, 2, 'step 6b: two notes handed over');
    const keep = (id, out) => { const m = /^picture: (\S+-light\.png)/m.exec(out); assert.ok(m, `step 6b: the mark prints its picture's path: ${out}`); const stamp = path.basename(m[1]).replace(/-light\.png$/, ''); const line = markLine(F, id, stamp); assert.ok(line?.shot, `step 6b: a log line for ${id} carries the shot stamped ${stamp}`); return line.shot; };
    const s1 = keep(L.L1, ok(F, 'supervisor', ['artifact', 'addressed', L.L1, '--note', 'The answer now says refunds take five days', '--draft', CHORE]));
    assert.equal(s1.src, CHORE, `step 6b L1: shot.src is ${CHORE}`);
    stack.landFaq('main-2');
    const tip = F.g(['rev-parse', 'origin/main'], F.old);
    const s2 = keep(L.L2, ok(F, 'supervisor', ['thread', 'ready', L.L2, '--outcome', 'The refund policy is linked on main']));
    assert.equal(s2.src, 'main', 'step 6b L2: shot.src is main');
    assert.equal(s2.sha, tip, "step 6b L2: shot.sha is origin main's head");
  }, { timeout: 240000 });

  // ---- step 7: the stepper, the pictures, the crossings; then Resolve and the replies (step 8 after) ----
  // state after step 6: N1 ready, N2 and N4 to check (N4 marked again in C5f), N3 open with plan-pricing
  const TOCHECK = ['N1', 'N2', 'N4'];
  const idOfKey = (key) => notes[key].id;
  const cardUp = (key) => `TL.open === ${J(idOfKey(key))} && !document.getElementById('tl-card').hidden`;
  // the middle of the element sel finds, as the pointer will meet it: brought into view first (scroll: false for a
  // guarded control, which a scroll would unsettle), and what the page shows at that point named
  const rectOf = (V, sel, scroll = true) => V.p.ev(`(() => { const e = document.querySelector(${J(sel)}); if (!e) return null; if (${scroll}) e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y); return { x, y, on: !!hit && e.contains(hit), hit: hit ? hit.id || hit.className || hit.tagName : null }; })()`);
  // a real press on the first element sel finds (what: the click target's id or tag, as the harness names it); a guarded
  // control (Resolve) is pressed only once avStep.ready says it has sat still, found again by sel on every try
  const pressSel = async (V, sel, what, { guard = null } = {}) => {
    await V.soon(`!!document.querySelector(${J(sel)})`, `setup: ${sel} is there`);
    await rectOf(V, sel);
    if (guard) await V.soon(guard, `setup: ${sel} settled under the press guard`);
    await V.p.ev(FRAMES);
    const at = await rectOf(V, sel, false);
    assert.ok(at, `setup: ${sel} has a box to press`);
    assert.ok(at.on, `setup: the point at ${sel} (${at.x},${at.y}) is covered by ${at.hit}`);
    await V.press(at.x, at.y, what);
  };
  // one real press on ‹ or ›, and the wait for the step to land: the note's card open, its page there, no step under way
  const stepBy = async (V, id, key, what) => {
    await pressSel(V, `#${id}`, id);
    await V.soon(`${cardUp(key)} && TS.ready && !avStep.want`, `${what}: ${id === 'av-next' ? '›' : '‹'} lands on ${key}'s card`);
  };
  const landsOn = async (V, key, file, hash, what) => {
    await V.soon(`TS.ready && TS.path === ${J(file)} && TS.hash === ${J(hash)} && ${cardUp(key)}`, `${what}: the viewer lands on ${file}${hash} with ${key}'s card`);
    const want = idOfKey(key);
    await V.p.ev(FRAMES);
    const seen = await V.settle(`[...document.querySelectorAll('#av-pins [data-tl-pin]')].some((b) => b.dataset.tlPin === ${J(want)} && b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden')`, 5000);
    assert.ok(seen, `${what}: ${key}'s pin is shown on ${file}${hash} (shown: ${J(await pins(V))})`);
    assert.equal(await V.p.ev('TS.path'), file, `${what}: TS.path`);
    assert.equal(await V.p.ev('TS.hash'), hash, `${what}: TS.hash`);
    assert.equal(await V.p.ev('TL.open'), want, `${what}: TL.open is ${key}`);
  };
  // Show me on a note's row in the Threads panel (the panel the page was opened with)
  const showMeOnRow = async (V, key) => {
    const sel = `#tl-list [data-tl-show="${idOfKey(key)}"]`;
    await pressSel(V, sel, 'BUTTON');
  };
  // the draft opened with the Threads panel up (th=open), for the crossing that needs the panel beside the viewer
  const openDraftWithPanel = async () => { const V = await visit('#library?th=open', WIN); await openDraft(V); return V; };

  await step('step 7 (a): the stepper on To check reads "- / 3"', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    await V.soon(`document.getElementById('av-stepn').textContent === '– / 3'`, 'C5b (a): #av-stepn reads – / 3');
    assert.equal(await V.p.ev("document.getElementById('av-filter').value"), 'check', 'C5b (a): #av-filter is To check');
    assert.equal(await V.p.ev("document.getElementById('av-stepn').textContent"), '– / 3', 'C5b (a): the stepper reads – / 3');
  }, { timeout: 180000 });

  await step('step 7 (b): each to-check card shows its picture beside Show me', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    for (const key of TOCHECK) {
      await stepBy(V, 'av-next', key, `C7a (b) ${key}`);
      const img = `#tl-card .tl-shot img`;
      assert.ok(await V.settle(`(() => { const i = document.querySelector(${J(img)}); return !!i && i.complete && i.naturalWidth > 0; })()`, 10000), `C7a (b) ${key}: the card shows a loaded .tl-shot img (${J(await V.p.ev(`(() => { const i = document.querySelector(${J(img)}); return i ? [i.complete, i.naturalWidth] : null; })()`))})`);
      assert.equal(await V.p.ev(`!!document.querySelector('#tl-card .tl-addr [data-tl-show="${idOfKey(key)}"]') && document.querySelector('#tl-card .tl-shot').closest('.tl-addr') === document.querySelector('#tl-card [data-tl-show]').closest('.tl-addr')`), true, `C7a (b) ${key}: the picture is beside [data-tl-show]`);
    }
  }, { timeout: 180000 });

  await step('step 7 (c): a click on each picture opens #av-shot at the PNG\'s width; Escape closes it', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    for (const key of TOCHECK) {
      await stepBy(V, 'av-next', key, `C7b (c) ${key}`);
      await V.soon(`(() => { const i = document.querySelector('#tl-card .tl-shot img'); return !!i && i.complete && i.naturalWidth > 0; })()`, `C7b (c) ${key}: the card's picture loaded`);
      await pressSel(V, '#tl-card .tl-shot img', 'IMG');
      await V.soon(`!!document.getElementById('av-shot')`, `C7b (c) ${key}: a click on the picture opens #av-shot`);
      const want = png(fs.readFileSync(shots[key].file)).w;
      assert.ok(await V.settle(`(() => { const i = document.querySelector('#av-shot img'); return !!i && i.complete && i.naturalWidth === ${want}; })()`, 10000), `C7b (c) ${key}: #av-shot's image is ${want}px wide, the PNG's (it is ${await V.p.ev("document.querySelector('#av-shot img')?.naturalWidth")})`);
      await V.p.key('Escape');
      assert.ok(await V.settle(`!document.getElementById('av-shot')`, 3000), `C7b (c) ${key}: Escape closes #av-shot`);
      assert.equal(await V.p.ev(`${VIEWER_UP}`), true, `C7b (c) ${key}: the viewer is still up after the picture closes`);
    }
  }, { timeout: 180000 });

  await step('step 7 (d): Show me on N2\'s Threads row, the viewer closed, lands on a.html#tab2', async () => {
    const V = await visit('#library?th=open', WIN);
    await pressSel(V, `#tl-list [data-tl-show="${idOfKey('N2')}"]`, 'BUTTON');
    assert.ok(await V.settle(`location.hash === ${J(HEAD_P)}`, 8000), `C6c (d): Show me on N2 opens ${HEAD_P}, not ${await V.p.ev('location.hash')}`);
    await landsOn(V, 'N2', 'a.html', '#tab2', 'C6c (d)');
  }, { timeout: 180000 });

  await step('step 7 (e): from N4\'s card on b.html, ‹ lands on a.html#tab2 with N2\'s pin and card', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    for (const key of TOCHECK) await stepBy(V, 'av-next', key, `C6e (i) (e) stepping to ${key}`);
    await V.soon(`TS.path === 'b.html'`, 'C6e (i) (e): N4\'s card is open on b.html');
    await stepBy(V, 'av-prev', 'N2', 'C6e (i) (e)');
    await landsOn(V, 'N2', 'a.html', '#tab2', 'C6e (i) (e)');
  }, { timeout: 180000 });

  await step('step 7 (f): from b.html, Show me on N2\'s Threads row lands on a.html#tab2 with N2\'s pin and card', async () => {
    const V = await openDraftWithPanel();
    await V.frameClick('to-b', 'pricing/b.html');
    await V.soon(`TS.path === 'b.html' && TL.open === null`, 'C6e (ii) (f): the viewer is up on b.html with no card open');
    await showMeOnRow(V, 'N2');
    await landsOn(V, 'N2', 'a.html', '#tab2', 'C6e (ii) (f)');
  }, { timeout: 180000 });

  // the state changes: Resolve N4 once its guard is ready, then a reply on N1 and one on N3
  const NOTE_N4 = 'The cancel question is answered at the top now';
  const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
  const reply = async (V, key, text) => {
    await pressSel(V, '#tl-c-text', 'tl-c-text');
    await V.p.type(text);
    await V.soon(`document.getElementById('tl-c-text').value === ${J(text)} && ${cardUp(key)}`, `C6b: ${key}'s composer holds the reply on ${key}'s card`);
    await pressSel(V, '#tl-card [data-tl-send]', 'BUTTON');
  };
  await step('step 7 (g): Resolve N4; a reply on N1 and one on N3', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    for (const key of TOCHECK) await stepBy(V, 'av-next', key, `C6a stepping to ${key}`);
    // Resolve: the control found again with TL.open and the guard read in one look, then pressed
    const resolveSel = '#tl-card .tl-addr [data-tl-accept]';
    await pressSel(V, resolveSel, 'BUTTON', { guard: `${cardUp('N4')} && (() => { const e = document.querySelector(${J(resolveSel)}); return !!e && avStep.ready(e) !== null && !e.classList.contains('waiting'); })()` });
    const resolved = await poll(() => { const th = JSON.parse(ok(F, 'owner', ['thread', 'show', idOfKey('N4'), '--json'])); return th.status === 'resolved' ? th : null; }, 20000);
    assert.ok(resolved, 'C6a: Resolve on N4 leaves thread show N4 resolved');
    assert.equal(resolved.status, 'resolved', 'C6a: N4 is resolved');
    assert.equal(resolved.outcome, NOTE_N4, "C6a: N4's outcome is its addressed note");
    // N1 (to check, its card by ›) then N3 (open, its pin on a.html#tab2)
    await stepBy(V, 'av-next', 'N1', 'C6b N1');
    await reply(V, 'N1', 'not yet');
    assert.ok(await poll(() => noteStates()[idOfKey('N1')] === 'open', 20000), `C6b: after the reply on N1 its state is open (${noteStates()[idOfKey('N1')]})`);
    await stepBy(V, 'av-next', 'N2', 'C6b stepping to N2 for N3\'s pin');
    await landsOn(V, 'N2', 'a.html', '#tab2', 'C6b setup N2');
    await pressSel(V, `#av-pins [data-tl-pin="${idOfKey('N3')}"]`, 'tl-pin');
    await V.soon(cardUp('N3'), "C6b: N3's pin opens its card");
    await reply(V, 'N3', 'Still the empty half; look again');
    assert.ok(await poll(() => noteStates()[idOfKey('N3')] === 'open', 20000), `C6b: after the reply on N3 its state is open (${noteStates()[idOfKey('N3')]})`);
    assert.equal(noteStates()[idOfKey('N1')], 'open', 'C6b: N1 is still open');
  }, { timeout: 240000 });

  await step('step 8: Hand over (2); the version\'s open notes are N1 and N3', async () => {
    const V = await visit('#library', WIN);
    await openDraft(V);
    await V.soon(`document.getElementById('av-handover').textContent === 'Hand over (2)'`, 'C6d: #av-handover reads Hand over (2)');
    assert.equal(await V.p.ev("document.getElementById('av-handover').textContent"), 'Hand over (2)', 'C6d: the bar reads Hand over (2)');
    const open = Object.entries(noteStates()).filter(([, s]) => s === 'open').map(([id]) => id).sort();
    assert.deepEqual(open, [idOfKey('N1'), idOfKey('N3')].sort(), "C6d: the version's open notes are exactly N1 and N3");
  }, { timeout: 180000 });

  // step 7b stays after T6's step 7 subtests
  // Show me on a faq note from a fresh visit with the viewer closed: where the viewer lands and what the framed page says
  const copies = [];
  const showMe = async (key, head, copy, check) => {
    const V = await visit('#library?th=open', WIN);
    const btn = `#tl-list [data-tl-show="${L[key]}"]`;
    await V.soon(`!!document.querySelector(${J(btn)})`, `${check}: ${key}'s row has Show me`);
    const n = await V.mark();
    await V.p.ev(`document.querySelector(${J(btn)}).scrollIntoView({ block: 'center' }); void 0`);
    await V.p.ev(FRAMES);
    const at = await V.p.ev(`(() => { const r = document.querySelector(${J(btn)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await V.press(at.x, at.y, 'BUTTON');
    assert.ok(await V.settle(`location.hash === ${J(head)}`, 8000), `${check}: Show me on ${key} opens ${head}, not ${await V.p.ev('location.hash')}`);
    const said = `window.__own.slice(${n}).some((m) => m.own === 'at' && m.page === 'faq/index.html' && m.copy === ${J(copy)})`;
    const got = await V.settle(said, 10000);
    const seen = await V.p.ev(`[...new Set(window.__own.slice(${n}).filter((m) => m.own === 'at' && m.copy).map((m) => m.copy))]`);
    copies.push(...seen);
    assert.ok(got, `${check}: the framed page says copy: ${copy} on ${key} (it said ${J(seen)})`);
  };
  await step('step 7b: Show me on L1 and L2, with the chore draft and after it is removed', async () => {
    await showMe('L1', `#artifact/wt/${CHORE}/${FAQ}`, 'chore', 'C5g L1');
    await showMe('L2', `#artifact/main/${FAQ}`, 'main-2', 'C5h L2 while the chore draft exists');
    F.g(['worktree', 'remove', '--force', stack.CHORE], F.old);
    assert.equal(fs.existsSync(stack.CHORE), false, 'C5h: the chore worktree is removed');
    await showMe('L1', `#artifact/main/${FAQ}`, 'main-2', 'C5h L1 after the chore draft is gone');
    await showMe('L2', `#artifact/main/${FAQ}`, 'main-2', 'C5h L2 after the chore draft is gone');
    assert.equal(copies.includes('old'), false, `C5h: no own message ever said copy: old (${J(copies)})`);
  }, { timeout: 240000 });

  t.diagnostic(`file: ${Date.now() - fileAt} ms`);
});
