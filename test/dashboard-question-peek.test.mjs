// An open question answered from its side peek, with the Inbox's own card (kit-766). Headless Chrome on a
// real dashboard. Ports: none of its own (lib/kit.mjs's).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

const J = JSON.stringify;
const RATE = ['--stake', '1', '--urgency', '1'];
const CHOICES = '[{"label":"Left"},{"label":"Right"}]';
const el = (id) => `document.getElementById(${J(id)})`;
const peekOn = (q) => `DRAWER.kind === 'q' && DRAWER.id === ${J(q)} && !document.getElementById('drawer').hidden && document.body.classList.contains('peek-open')`;
const cardIn = (q) => `${peekOn(q)} && !!document.querySelector(${J(`#drawer-body [id="p-q-${q}"]`)})`;
const onInbox = `document.body.classList.contains('threads-open') && document.querySelector('#th-tabs [role="tab"][data-tab="inbox"]')?.getAttribute('aria-selected') === 'true'`;

test('an open question is answered from its side peek, with the Inbox card', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('question-peek');
  later(() => F.done());
  fs.mkdirSync(path.join(F.old, 'review'), { recursive: true });
  fs.writeFileSync(path.join(F.old, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head>\n<body>\n<p>Look.</p>\n</body></html>\n');
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: F.old, stdio: 'pipe' });
  git('add', 'review/page.html');
  git('commit', '-qm', 'a review page');
  const ask = (...a) => F.sup(['ask', '--question', ...a, '--goal', F.goal, ...RATE]);
  const Q = {
    card: ask('Which way for the card?', '--choices', CHOICES),
    words: ask('What should the banner say?'),
    secret: F.sup(['ask', '--kind', 'owner-action', '--question', 'Post the API key', '--secrets', J([{ name: 'KEY', sink: 'file:secrets/key.txt' }]), '--goal', F.goal, ...RATE]),
    review: F.sup(['ask', '--kind', 'review', '--question', 'Does it look right?', '--ref', 'main', '--page', 'review/page.html', ...RATE]),
    link: ask('Which way for the link?', '--choices', CHOICES),
    keep: ask('Which way to keep?', '--choices', CHOICES),
    drop: ask('Which file goes with it?', '--choices', CHOICES),
    wide: ask('Which way at each width?', '--choices', CHOICES),
    trust: ask('Which way, and next time?', '--choices', CHOICES, '--class', 'new-feature', '--default', 'Left'),
    trustBack: ask('Which way if it is refused?', '--choices', CHOICES, '--class', 'new-feature', '--default', 'Left'),
  };
  const K = F.sup(['knowledge', 'add', '--kind', 'fact', '--statement', 'Deploys wait for a green build']).split('\n')[0];
  const G2 = F.sup(['goal', 'add', '--title', 'A side goal', '--outcome', 'it is done']).split('\n')[0];
  Q.act = F.sup(['ask', '--kind', 'owner-action', '--question', 'Tidy these two', '--context', `Retire ${K}. Let go ${G2}.`, '--goal', F.goal, ...RATE]);
  const T = F.owner(['thread', 'new', 'About the two copies', '--title', 'The two copies']).split('\n')[0];
  const inThread = F.sup(['thread', 'ask', T, '--kind', 'owner-decision', '--question', 'Which way in the thread?', '--choices', CHOICES, '--goal', F.goal, ...RATE]);
  const apart = F.sup(['thread', 'ask', T, '--kind', 'owner-decision', '--question', 'Which way apart?', '--choices', CHOICES, '--goal', F.goal, ...RATE, '--off-subject', 'a second question in the thread']);

  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const size = (width, height = 900) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1440);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `${POLL_FAST};window.__thrown = [];addEventListener('error', (e) => window.__thrown.push(String(e.error?.stack || e.message)));addEventListener('unhandledrejection', (e) => window.__thrown.push(String(e.reason?.stack || e.reason)));` });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#board` });
  const soon = soonIn(p);
  // and loaded (kit-784): until the load event, Chrome makes a script's hash change with no user gesture (every
  // p.ev here) replace the entry rather than add one, so a Back or a close after it would land off the page
  await soon(`document.readyState === 'complete' && !!${el(`q-${Q.card}`)}`, 'the Inbox drawn');
  const open = async (q) => { await p.ev(`location.hash = ${J(`#q/${encodeURIComponent(q)}`)}`); await soon(peekOn(q), `${q}'s peek`); };
  const polls = async (n = 3) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
  const answers = (q) => fs.readdirSync(path.join(F.old, 'docs/devteam/run/log')).flatMap((f) => fs.readFileSync(path.join(F.old, 'docs/devteam/run/log', f), 'utf8').split('\n')).filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.id === q && l.answer !== undefined);
  const posted = (q) => p.ev(`(window.__posts ?? []).filter((x) => x.url === '/api/answer' && JSON.parse(x.body).id === ${J(q)}).length`);

  await t.test('AC1: the peek body holds the Inbox card: choices, words field, drop box, Answer', async () => {
    await open(Q.card);
    await soon(cardIn(Q.card), 'the card in the peek');
    const read = (root) => p.ev(`(() => { const c = document.querySelector(${J(root)}); return { choices: [...c.querySelectorAll('input[data-pick]')].map((x) => x.value), box: !!c.querySelector('.dropbox[data-drop=${J(`q:${Q.card}`)}] textarea[data-q]'), press: c.querySelector('[data-answer]')?.textContent, ph: c.querySelector('textarea[data-q]')?.placeholder }; })()`);
    const peek = await read(`#drawer-body [id="p-q-${Q.card}"]`);
    assert.deepEqual(peek, await read(`#th-inbox [id="q-${Q.card}"]`), 'the same controls as the Inbox card');
    assert.deepEqual(peek.choices, ['Left', 'Right', '__other']);
    assert.equal(peek.box, true, 'the words field is the drop box');
    const how = await p.ev(`[...document.querySelectorAll('#drawer-body dt')].find((x) => x.textContent.trim() === 'How it changes').nextElementSibling.textContent`);
    assert.match(how, /^Answer it below, or /, `How it changes on an open question: ${how}`);
    await open(Q.words);
    await soon(cardIn(Q.words), 'a words-only card');
    assert.equal(await p.ev(`document.querySelector(${J(`#drawer-body [id="p-q-${Q.words}"] [data-answer]`)})?.textContent`), 'Answer');
  });

  await t.test('AC2: every kind the Inbox answers is the same card in the peek', async () => {
    const diff = await p.ev(`(() => {
      const base = DATA.questions.find((x) => x.id === ${J(Q.card)}), reasons = {};
      const norm = (h) => { const d = document.createElement('div'); d.innerHTML = h; d.querySelector('.chip-next')?.remove(); return d.firstElementChild.innerHTML.replace(/\\b(id|name)="(e-)?p-/g, '$1="$2'); };
      const kinds = Object.keys(KIND_ICON).filter((k) => k !== 'review');
      return { n: kinds.length, off: kinds.filter((kind) => { const q = { ...base, kind }; return norm(questionCard(q, DATA.ooda, reasons, 'peek')) !== norm(questionCard(q, DATA.ooda, reasons)); }) };
    })()`);
    assert.ok(diff.n >= 8, `the kinds: ${diff.n}`);
    assert.deepEqual(diff.off, [], 'kinds whose peek card differs');
  });

  await t.test('AC3: a secrets or review question says where to answer it, and goes there', async () => {
    for (const q of [Q.secret, Q.review]) {
      await open(q);
      const sel = `#drawer-body a[data-q-inbox=${J(q)}]`;
      await soon(`!!document.querySelector(${J(sel)})`, `${q}: where to answer it`);
      assert.equal(await p.ev(`document.querySelector(${J(sel)}).textContent`), 'Answer it in the Inbox');
      assert.equal(await p.ev(`document.querySelectorAll('#drawer-body [data-secret], #drawer-body [data-post-secrets], #drawer-body [data-answer], #drawer-body [data-open-review]').length`), 0, 'no form of its own');
      await p.ev(`document.querySelector(${J(sel)}).click()`);
      await soon(`${onInbox} && (() => { const b = document.getElementById('th-body').getBoundingClientRect(), r = ${el(`q-${q}`)}.getBoundingClientRect(); return r.height > 0 && r.top < b.bottom && r.bottom > b.top; })()`, `${q}: its Inbox card in view`);
      await p.ev(`document.getElementById('th-close').click()`);
      await soon(`!document.body.classList.contains('threads-open')`, 'the panel closed');
    }
  });

  await t.test('AC4: answering from the peek records one answer and updates every copy', async () => {
    await p.ev(`location.hash = '#board'`);
    await soon(`location.hash === '#board'`, 'Board');
    await p.ev(`TL.open = ${J(T)}; thGo({ th: 'open', t: ${J(T)} }); void 0`);
    await soon(`!!${el(`t-q-${inThread}`)}`, "the thread's copy");
    await p.ev(`openQuestion(${J(inThread)})`);
    await soon(cardIn(inThread), 'the peek over the thread');
    await p.ev(`document.querySelector(${J(`[id="p-q-${inThread}"] input[value="Left"]`)}).click()`);
    await p.ev(`document.querySelector(${J(`[id="p-q-${inThread}"] [data-answer]`)}).click()`);
    await soon(`/Answered: Left/.test(document.getElementById('drawer-body').textContent)`, 'the peek says answered');
    await soon(`!${el(`q-${inThread}`)}`, "the Inbox's card gone");
    await soon(`!document.querySelector(${J(`#tl-c-turns [data-answer="${inThread}"]`)})`, "the thread's copy answered");
    await soon(`[...document.querySelectorAll('#drawer-body .props dd, #drawer-body dd')].some((d) => d.textContent.trim() === 'answered')`, 'the peek in its answered state');
    await polls();
    assert.equal(await posted(inThread), 1, 'one post');
    assert.equal(answers(inThread).length, 1, 'one answer in the log');
  });

  await t.test("AC5: the peek's controls never act for the Inbox's or a thread's copy", async () => {
    await soon(`!!${el(`t-q-${apart}`)}`, "the thread's copy");
    await p.ev(`openQuestion(${J(apart)})`);
    await soon(cardIn(apart), 'the peek');
    const names = await p.ev(`[${J(`q-${apart}`)}, ${J(`t-q-${apart}`)}, ${J(`p-q-${apart}`)}].map((c) => document.getElementById(c).querySelector('input[data-pick]').name)`);
    assert.equal(new Set(names).size, 3, `three radio groups: ${names}`);
    assert.equal(await p.ev(`!!document.querySelector(${J(`[id="p-q-${apart}"] .from-thread a`)})`), true, 'the peek says which thread it came from');
    await p.ev(`document.querySelector(${J(`[id="p-q-${apart}"] [data-answer]`)}).click()`);
    await soon(`/Pick a choice/.test(${el(`e-p-${apart}`)}?.textContent ?? '')`, "the error on the peek's line");
    assert.deepEqual(await p.ev(`[${el(`e-${apart}`)}.textContent, ${el(`e-t-${apart}`)}.textContent]`), ['', ''], 'no error on the other copies');
    assert.equal(await posted(apart), 0, 'nothing posted');
    await p.ev(`document.querySelector(${J(`[id="p-q-${apart}"] input[data-rulebox]`)}).click()`);
    await p.ev(`document.activeElement?.blur?.()`);
    await polls();
    assert.deepEqual(await p.ev(`[${J(`p-q-${apart}`)}, ${J(`q-${apart}`)}, ${J(`t-q-${apart}`)}].map((c) => document.getElementById(c).querySelector('input[data-rulebox]').checked)`), [true, false, false], "the rule box is the peek's alone");
    assert.equal(await p.ev(`qcardOf(document.querySelector(${J(`[id="p-q-${apart}"] [data-answer]`)})).errId`), `p-${apart}`);
    // and the Inbox's box stays the Inbox's: the peek is earlier in the page, so a redraw must not hand it this tick
    await p.ev(`document.querySelector(${J(`[id="p-q-${apart}"] input[data-rulebox]`)}).click()`);
    await p.ev(`document.querySelector(${J(`[id="q-${apart}"] input[data-rulebox]`)}).click()`);
    await p.ev(`document.activeElement?.blur?.()`);
    await polls();
    assert.deepEqual(await p.ev(`[${J(`p-q-${apart}`)}, ${J(`q-${apart}`)}, ${J(`t-q-${apart}`)}].map((c) => document.getElementById(c).querySelector('input[data-rulebox]').checked)`), [false, true, false], "the Inbox's rule box is the Inbox's alone");
  });

  await t.test('AC11: a refused answer gives each copy back its own rule box', async () => {
    const boxes = () => p.ev(`[${J(`p-q-${apart}`)}, ${J(`q-${apart}`)}, ${J(`t-q-${apart}`)}].map((c) => document.getElementById(c).querySelector('input[data-rulebox]').checked)`);
    const set = (c, on) => p.ev(`(() => { const b = document.querySelector(${J(`[id="${c}-q-${apart}"] input[data-rulebox]`.replace('"-q-', '"q-'))}); if (b.checked !== ${on}) b.click(); })()`);
    await p.ev(`document.querySelector(${J(`[id="p-q-${apart}"] input[value="Left"]`)}).click()`);
    await p.ev(`(() => { const f = window.fetch; window.__fetch1 = f; window.fetch = (u, o) => (String(u) === '/api/answer' ? Promise.resolve(new Response(JSON.stringify({ error: 'refused here' }), { status: 400 })) : f(u, o)); })()`);
    try {
      for (const [peek, inbox] of [[true, false], [false, true]]) {
        await set('p', peek);
        await set('', inbox);
        await p.ev(`document.querySelector(${J(`[id="p-q-${apart}"] [data-answer]`)}).click()`);
        await soon(`!!document.querySelector(${J(`[id="p-q-${apart}"] [data-refused]`)})`, "the refusal on the peek's card");
        await polls();
        assert.deepEqual(await boxes(), [peek, inbox, false], 'each copy keeps its own box after a refusal');
        await p.ev(`document.querySelector(${J(`[id="p-q-${apart}"] [data-dismiss-refused]`)}).click()`);
        await soon(`!document.querySelector(${J(`[id="p-q-${apart}"] [data-refused]`)})`, 'the refusal dismissed');
      }
    } finally { await p.ev('window.fetch = window.__fetch1; void 0'); }
    assert.equal(answers(apart).length, 0, 'nothing recorded');
  });

  await t.test('AC12: a redraw of the peek keeps its rule box and its trust choice', async () => {
    await open(Q.trust);
    await soon(cardIn(Q.trust), 'the card');
    const card = `document.querySelector(${J(`[id="p-q-${Q.trust}"]`)})`;
    assert.ok(await p.ev(`${card}.querySelectorAll('input[data-auto]').length`) >= 2, 'the card offers a trust choice');
    const chosen = await p.ev(`(() => { ${card}.querySelector('input[data-rulebox]').click(); const r = [...${card}.querySelectorAll('input[data-auto]')].find((x) => !x.checked); r.click(); document.activeElement?.blur?.(); return r.value; })()`);
    const at = await p.ev(`(() => { const was = ${card}; LAST_HTML = ''; redraw(); const c = ${card}; return { redrawn: c !== was, rule: c.querySelector('input[data-rulebox]').checked, auto: c.querySelector('input[data-auto]:checked')?.value }; })()`);
    assert.deepEqual(at, { redrawn: true, rule: true, auto: chosen }, "the peek's boxes, right after a redraw");
    assert.equal(await p.ev(`${el(`q-${Q.trust}`)}.querySelector('input[data-rulebox]').checked`), false, "the Inbox's box is untouched");
  });

  await t.test('AC13: a refused answer leaves each copy its own trust choice', async () => {
    await open(Q.trustBack);
    await soon(cardIn(Q.trustBack), 'the card');
    const inCard = (id) => `document.getElementById(${J(id)})`;
    const [pc, ic] = [`p-q-${Q.trustBack}`, `q-${Q.trustBack}`];
    const read = () => p.ev(`[${J(pc)}, ${J(ic)}].map((c) => document.getElementById(c).querySelector('input[data-auto]:checked')?.value)`);
    const set = (c, v) => p.ev(`[...${inCard(c)}.querySelectorAll('input[data-auto]')].find((x) => x.value === ${J(v)}).click()`);
    const [base] = await read();
    const other = await p.ev(`[...${inCard(pc)}.querySelectorAll('input[data-auto]')].find((x) => !x.checked).value`);
    await p.ev(`${inCard(pc)}.querySelector('input[value="Left"]').click()`);
    await p.ev(`(() => { const f = window.fetch; window.__fetch2 = f; window.fetch = (u, o) => (String(u) === '/api/answer' ? Promise.resolve(new Response(JSON.stringify({ error: 'refused here' }), { status: 400 })) : f(u, o)); })()`);
    try {
      for (const [peek, inbox] of [[other, base], [base, other]]) {
        await set(pc, peek);
        await set(ic, inbox);
        await p.ev('document.activeElement?.blur?.()');
        await p.ev(`${inCard(pc)}.querySelector('[data-answer]').click()`);
        await soon(`!!${inCard(pc)}?.querySelector('[data-refused]')`, "the refusal on the peek's card");
        await polls();
        assert.deepEqual(await read(), [peek, inbox], 'each copy keeps its own trust choice after a refusal');
        await p.ev(`${inCard(pc)}.querySelector('[data-dismiss-refused]').click()`);
        await soon(`!${inCard(pc)}.querySelector('[data-refused]')`, 'the refusal dismissed');
      }
    } finally { await p.ev('window.fetch = window.__fetch2; void 0'); }
    assert.equal(answers(Q.trustBack).length, 0, 'nothing recorded');
  });

  await t.test("AC18: words typed in a goal peek's Wrong? form survive a redraw", async () => {
    F.sup(['goal', 'impact', F.goal, '3', '--rationale', 'moves the number the strategy watches']);
    await p.ev(`location.hash = ${J(`#goal/${encodeURIComponent(F.goal)}`)}`);
    await soon("!!document.querySelector('#drawer-body button[data-correct]')", "the goal peek's Wrong?");
    await p.ev("document.querySelector('#drawer-body button[data-correct]').click()");
    await p.ev("(() => { const r = document.querySelector('#drawer-body input[data-reason]'); r.focus(); r.value = 'only one admin pays'; r.blur(); })()");
    const at = await p.ev("(() => { const was = document.querySelector('#drawer-body input[data-reason]'); LAST_HTML = ''; render(DATA); const r = document.querySelector('#drawer-body input[data-reason]'); return { redrawn: r !== was, value: r.value }; })()");
    assert.deepEqual(at, { redrawn: true, value: 'only one admin pays' }, "the Wrong? form's words, right after a redraw");
  });

  await t.test('AC6: a link to an open question opens the peek, and Back returns to the page', async () => {
    await p.ev(`TL.open = null; thGo({}); void 0`);
    await p.ev(`location.hash = '#board'`);
    await soon(`location.hash === '#board' && !document.body.classList.contains('peek-open')`, 'Board');
    await p.ev(`document.getElementById('th-close').click(); void 0`);
    await soon(`!document.body.classList.contains('threads-open')`, 'the panel closed');
    await p.ev(`(() => { document.getElementById('probe-q')?.remove(); const a = document.createElement('a'); a.id = 'probe-q'; a.href = ${J(`#q/${Q.link}`)}; a.textContent = 'the probe'; document.querySelector('main.page > section[data-page="board"]').prepend(a); })()`);
    await p.click('#probe-q');
    await soon(cardIn(Q.link), 'the peek with its card');
    assert.equal(await p.ev('location.hash'), `#q/${Q.link}`, 'the link stays the peek');
    assert.equal(await p.ev(`document.body.classList.contains('threads-open')`), false, 'the Inbox tab did not open');
    await p.ev('history.back()');
    await soon(`location.hash === '#board' && !document.body.classList.contains('peek-open')`, 'Back: Board, the peek closed');
    const q1 = await chrome.newPage();
    later(() => q1.close());
    await q1.send('Page.enable');
    await q1.send('Runtime.enable');
    await q1.send('Page.navigate', { url: `http://127.0.0.1:${port}/#q/${Q.link}` });
    await soonIn(q1, 30000)(cardIn(Q.link), 'a cold load: the peek with its card');
  });

  await t.test('AC7: a picked choice and typed words survive a poll redraw', async () => {
    await open(Q.keep);
    await soon(cardIn(Q.keep), 'the card');
    const card = `document.querySelector(${J(`[id="p-q-${Q.keep}"]`)})`;
    await p.ev(`${card}.querySelector('input[value="Right"]').click()`);
    // typed, then the card redrawn in the same task, before any poll could read the box
    const at = await p.ev(`(() => { const t = ${card}.querySelector('textarea[data-q]'); t.focus(); t.value = 'kept across polls'; t.dispatchEvent(new InputEvent('input', { bubbles: true })); t.blur(); document.activeElement?.blur?.(); const was = ${card}; LAST_HTML = ''; redraw(); return { redrawn: ${card} !== was, value: ${card}.querySelector('textarea[data-q]').value }; })()`);
    assert.deepEqual(at, { redrawn: true, value: 'kept across polls' }, 'the words, right after a redraw');
    await polls();
    assert.equal(await p.ev(`${card}.querySelector('textarea[data-q]').value`), 'kept across polls');
    assert.equal(await p.ev(`${card}.querySelector('input[value="Right"]').checked`), true);
    assert.equal(await p.ev(`${el(`q-${Q.keep}`)}.querySelector('textarea[data-q]').value`), 'kept across polls', "the Inbox's card shows the same words");
  });

  await t.test("AC8: the peek's field is the Inbox's dropBox, taking a dropped file into both", async () => {
    await open(Q.drop);
    await soon(cardIn(Q.drop), 'the card');
    await p.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['the words'], 'note.txt', { type: 'text/plain' })); document.querySelector(${J(`[id="p-q-${Q.drop}"] .dropbox`)}).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await soon(`!!document.querySelector(${J(`[id="p-q-${Q.drop}"] .dropbox > .pills .att-pill[data-pill-state="ok"]`)})`, "the pill in the peek's box");
    await soon(`!!document.querySelector(${J(`[id="q-${Q.drop}"] .dropbox > .pills .att-pill[data-pill-state="ok"]`)})`, "the pill in the Inbox's box");
  });

  await t.test("AC10: an owner-action card's record rows keep the peek's own ids and error lines", async () => {
    await open(Q.act);
    await soon(cardIn(Q.act), 'the card');
    const line = (pre, rec) => `e-${pre}oa-${Q.act}-${rec}`;
    const inPeek = (sel) => `document.querySelector(${J(`[id="p-q-${Q.act}"] ${sel}`)})`;
    await soon(`!!${inPeek(`[data-oa-know="${K}"][data-status="retired"]`)} && !!${inPeek(`[data-oa-goal="${G2}"]`)}`, "the rows' controls");
    await p.ev(`(() => { const f = window.fetch; window.__fetch0 = f; window.fetch = (u, o) => (/^\\/api\\/(knowledge|goal-decide)$/.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ error: 'refused here' }), { status: 400 })) : f(u, o)); })()`);
    try {
      await p.ev(`${inPeek(`[data-oa-know="${K}"][data-status="retired"]`)}.click()`);
      await soon(`/Not saved/.test(${el(line('p-', K))}?.textContent ?? '')`, "Retire's refusal on the peek's line");
      assert.equal(await p.ev(`${el(line('', K))}.textContent`), '', "no refusal on the Inbox's line");
      await p.ev(`${inPeek(`[data-oa-goal="${G2}"]`)}.click()`);
      await soon(`/Confirm/.test(${inPeek(`[data-oa-goal="${G2}"]`)}?.textContent ?? '')`, 'Confirm let go');
      assert.deepEqual(await p.ev(`[document.querySelectorAll(${J(`[id="${line('', G2)}"]`)}).length, document.querySelectorAll(${J(`[id="${line('p-', G2)}"]`)}).length]`), [1, 1], 'after a repaint, one error line each');
      await p.ev(`${inPeek(`[data-oa-goal="${G2}"]`)}.click()`);
      await soon(`/Not saved/.test(${el(line('p-', G2))}?.textContent ?? '')`, "Let go's refusal on the peek's line");
      assert.equal(await p.ev(`${el(line('', G2))}.textContent`), '', "no refusal on the Inbox's line");
    } finally { await p.ev('window.fetch = window.__fetch0; void 0'); }
  });

  await t.test('AC9: the card reads correctly at 560px line width and at phone width', async () => {
    await open(Q.wide);
    await soon(cardIn(Q.wide), 'the card');
    // the viewport whose card is 560px wide: the peek fills it below 720px, less its padding and scrollbar gutter
    await size(640);
    await soon(`getComputedStyle(document.getElementById('drawer')).transform === 'none'`, 'the peek at rest');
    const gutter = 640 - await p.ev(`document.querySelector(${J(`[id="p-q-${Q.wide}"]`)}).getBoundingClientRect().width`);
    for (const [name, width] of [['560', 560 + gutter], ['phone', 390]]) {
      await size(width);
      await soon(`getComputedStyle(document.getElementById('drawer')).transform === 'none'`, 'the peek at rest');
      const m = await p.ev(`(() => {
        const c = document.querySelector(${J(`[id="p-q-${Q.wide}"]`)}), b = document.getElementById('drawer-body'), r = c.getBoundingClientRect();
        const inside = (x) => { const q = x.getBoundingClientRect(); return q.left >= r.left - 0.5 && q.right <= r.right + 0.5; };
        return { w: r.width, over: b.scrollWidth - b.clientWidth, card: c.scrollWidth - c.clientWidth, box: inside(c.querySelector('.dropbox')), text: inside(c.querySelector('textarea[data-q]')), press: inside(c.querySelector('[data-answer]')), choices: [...c.querySelectorAll('.choice')].every(inside), vw: innerWidth, right: r.right };
      })()`);
      if (name === '560') assert.ok(Math.abs(m.w - 560) <= 1.5, `the line is 560px: ${m.w}`);
      assert.ok(m.over <= 0 && m.card <= 0, `${name}: nothing overflows (${m.over}, ${m.card})`);
      assert.deepEqual([m.box, m.text, m.press, m.choices], [true, true, true, true], `${name}: the field, Answer and the choices stay inside the card`);
      assert.ok(m.right <= m.vw, `${name}: the card is on screen`);
      if (process.env.KIT766_SHOTS) {
        await p.ev(`document.querySelector(${J(`[id="p-q-${Q.wide}"]`)}).scrollIntoView({ block: 'start' })`);
        const { data } = await p.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(process.env.KIT766_SHOTS, `peek-${name}.png`), Buffer.from(data, 'base64'));
      }
    }
    await size(1440);
    assert.deepEqual(await p.ev('window.__thrown'), [], 'nothing thrown');
  });

  const keyOn = (key, code, vk, modifiers = 0) => p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }).then(() => p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }));
  const pc = (q, s = '') => `document.querySelector(${J(`[id="p-q-${q}"] ${s}`.trim())})`;
  const ic = (q, s = '') => `document.querySelector(${J(`#th-inbox [id="q-${q}"] ${s}`.trim())})`;

  await t.test('AC14: answered elsewhere while the peek is open', async () => {
    const q = ask('Answered elsewhere?', '--choices', CHOICES);
    await soon(`!!${el(`q-${q}`)}`, 'the Inbox has it');
    await open(q);
    await soon(cardIn(q), 'the card');
    F.owner(['answer', q, 'Left']);
    await soon(`!document.querySelector(${J(`[id="p-q-${q}"]`)}) && [...document.querySelectorAll('#drawer-body dd')].some((d) => d.textContent.trim() === 'answered')`, 'the settled record');
  });

  await t.test('AC15: Escape with words typed', async () => {
    const q = ask('Escape with words?', '--choices', CHOICES);
    await soon(`!!${el(`q-${q}`)}`, 'the Inbox has it');
    await open(q);
    await soon(cardIn(q), 'the card');
    await p.ev(`${pc(q, 'input[value="Right"]')}.click()`);
    await p.ev(`${pc(q, 'textarea[data-q]')}.focus()`);
    await p.type('half typed');
    assert.equal(await p.ev(`${pc(q, 'textarea[data-q]')}.value`), 'half typed');
    await keyOn('Escape', 'Escape', 27);
    await soon(`document.getElementById('drawer').hidden && !document.body.classList.contains('peek-open')`, 'the peek closed');
    assert.equal(await p.ev(`${ic(q, 'textarea[data-q]')}.value`), 'half typed', "the Inbox card's words");
    assert.equal(await p.ev(`${ic(q, 'input[value="Right"]')}.checked`), true, "the Inbox card's pick");
    await open(q);
    await soon(cardIn(q), 'the card again');
    assert.equal(await p.ev(`${pc(q, 'textarea[data-q]')}.value`), 'half typed', 'the words on reopening');
    assert.equal(await p.ev(`${pc(q, 'input[value="Right"]')}.checked`), true, 'the pick on reopening');
  });

  await t.test("AC16: Shift+Enter in the peek's field presses its Answer, once", async () => {
    const q = ask('Shift enter?', '--choices', CHOICES);
    await soon(`!!${el(`q-${q}`)}`, 'the Inbox has it');
    await open(q);
    await soon(cardIn(q), 'the card');
    await p.ev(`${pc(q, 'input[value="Left"]')}.click()`);
    await p.ev(`${pc(q, 'input[data-rulebox]')}.click()`);
    assert.equal(await p.ev(`${ic(q, 'input[data-rulebox]')}.checked`), false, 'the rule ticked in the peek only');
    await p.ev(`${pc(q, 'textarea[data-q]')}.focus()`);
    await keyOn('Enter', 'Enter', 13, 8);
    await soon(`/Answered: Left/.test(document.getElementById('drawer-body').textContent)`, 'Answered: Left');
    await polls();
    assert.equal(await posted(q), 1, 'one post');
    assert.equal(await p.ev(`JSON.parse(window.__posts.find((x) => x.url === '/api/answer' && JSON.parse(x.body).id === ${J(q)}).body).rule ?? null`), 'Left: the standing answer to questions like “Shift enter?”', "the post carries the peek's rule box");
  });

  await t.test('AC17: a link inside the card opens that question, and Back returns with the words', async () => {
    const q = ask('Link from here?', '--choices', CHOICES);
    const q2 = ask('Link to here?', '--choices', CHOICES);
    await soon(`!!${el(`q-${q2}`)}`, 'the Inbox has them');
    await open(q);
    await soon(cardIn(q), 'the card');
    await p.ev(`${pc(q, 'textarea[data-q]')}.focus()`);
    await p.type('come back');
    await p.ev(`(() => { const a = document.createElement('a'); a.id = 'probe-link'; a.href = ${J(`#q/${q2}`)}; a.textContent = 'the other'; ${pc(q)}.append(a); })()`);
    await p.click('#probe-link');
    await soon(cardIn(q2), "the other question's card");
    await p.ev('history.back()');
    await soon(cardIn(q), 'back on this card');
    assert.equal(await p.ev(`${pc(q, 'textarea[data-q]')}.value`), 'come back', 'the words');
    assert.deepEqual(await p.ev('window.__thrown'), [], 'nothing thrown');
  });
});
