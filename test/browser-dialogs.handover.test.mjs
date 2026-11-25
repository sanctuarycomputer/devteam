// A page's confirm, prompt or beforeunload while the owner has the browser (kit-770): shown in the view,
// and the owner's own answer is the one the page gets. Each check is the spec's, named by its id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { a, browser, ok, viewer, ws, within, readState, sleep } from './lib/browser-view-fixture.mjs';
import { MARK, TEXT, dsite, dialogsFile, up, later, asked, LATER, s1Close, isDialog, hold, release, heldDialog, pageGot, allow, byHand } from './lib/browser-dialogs-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
dialogsFile();

for (const accept of [true, false]) test(`H1 during a handover a confirm is shown in the view, and the owner's ${accept ? 'OK' : 'Cancel'} is what the page receives`, opts, async () => {
  const { c, qid, d, n } = await heldDialog();
  assert.equal(d.kind, 'confirm');
  assert.equal(d.text, TEXT.later);
  assert.deepEqual([d.url, d.frame], [`${dsite.origin}/hconfirm`, undefined]);
  await sleep(1500);
  assert.equal(dsite.answered, null, 'nothing answers it before the owner');
  c.send({ t: 'dialog', id: d.id, accept });
  await pageGot(String(accept));
  await c.wait((m) => m.t === 'dialog_end' && m.id === d.id, 3000, n);
  assert.deepEqual(c.bad, []);
  await release(qid);
});

for (const [name, answer, got] of [['OK with text', { accept: true, text: 'owner words' }, '"owner words"'], ['Cancel', { accept: false, text: 'ignored' }, 'null']]) test(`H2 during a handover the owner's prompt answer is what the page receives: ${name}`, opts, async () => {
  const { c, qid, d } = await heldDialog('/hprompt');
  assert.deepEqual([d.kind, d.text, d.default], ['prompt', TEXT.prompt, 'typed by default']);
  c.send({ t: 'dialog', id: d.id, ...answer });
  await pageGot(got);
  await release(qid);
});

test('H3 during a handover the owner answers a beforeunload: Stay keeps the page, Leave goes on', opts, async () => {
  await up();
  const c = await viewer();
  await ok(a, ['open', `${dsite.origin}/hleave`]);
  const qid = await hold();
  await c.wait((m) => m.t === 'held' && m.qid === qid, 5000);
  c.send({ t: 'mouse', type: 'click', x: 20, y: 20, button: 'left', clicks: 1 }); // sticky activation
  await sleep(500);
  const seen = async (accept) => {
    const n = c.msgs.length;
    c.send({ t: 'nav', url: `${dsite.origin}/plain` });
    const d = await c.wait(isDialog, 5000, n);
    assert.equal(d.kind, 'beforeunload');
    c.send({ t: 'dialog', id: d.id, accept });
    return n;
  };
  const n = await seen(false);
  await sleep(1500);
  assert.ok(!c.msgs.slice(n).some((m) => m.t === 'url' && m.url.endsWith('/plain')), 'Stay keeps the page');
  const n2 = await seen(true);
  await c.wait((m) => m.t === 'url' && m.url.endsWith('/plain'), 5000, n2);
  await release(qid);
});

test('H4 an answer reaches only the dialog it names, once', opts, async () => {
  dsite.keys = [];
  const { c, qid, d } = await heldDialog('/hkeys');
  c.send({ t: 'dialog', id: 'd-0000000000000000', accept: true });
  c.send({ t: 'dialog', id: d.id, accept: 'true' });
  c.send({ t: 'dialog', id: d.id, accept: true, extra: 1 });
  c.send({ t: 'key', type: 'press', key: 'z', code: 'KeyZ', text: 'z' });
  await sleep(1500);
  assert.equal(dsite.answered, null, 'none of them answered it');
  c.send({ t: 'dialog', id: d.id, accept: false });
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('false');
  await sleep(500);
  assert.deepEqual(dsite.keys, [], 'what was typed while it was up never lands');
  c.send({ t: 'key', type: 'press', key: 'y', code: 'KeyY', text: 'y' });
  await within(3000, () => dsite.keys.includes('y'), 'a key after the answer');
  await release(qid);
});

test('H7 a viewer who connects later is shown it, and can answer it', opts, async () => {
  const { c, qid, d } = await heldDialog();
  c.close();
  await sleep(2000);
  assert.equal(dsite.answered, null, 'no viewer: it waits');
  const c2 = await ws(readState(a).view_port);
  const again = await c2.wait(isDialog, 5000);
  assert.deepEqual(again, d);
  c2.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  c2.close();
  await release(qid);
});

test('H8 outside a handover, and after one, a confirm is Cancel at once and the view is sent nothing', opts, async () => {
  const { c, qid, d } = await heldDialog();
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  await release(qid);
  const c2 = await viewer();
  await later();
  const n = c2.msgs.length;
  await asked();
  assert.ok(!c2.msgs.slice(n).some(isDialog));
  const s = await ok(a, ['snapshot']);
  assert.ok(s.split('\n').includes(LATER), s);
});

test('H9 the owner\'s dialog and its answer never reach the agent', opts, async () => {
  const { c, qid, d } = await heldDialog('/hprompt');
  c.send({ t: 'dialog', id: d.id, accept: true, text: `${MARK} secret` });
  await pageGot(JSON.stringify(`${MARK} secret`));
  const st = await ok(a, ['status']);
  await release(qid);
  const s = await ok(a, ['snapshot']);
  for (const x of [st, s]) assert.ok(!x.includes(TEXT.prompt) && !x.includes('secret'), x);
});

test('H11 an alert during a handover is still OK at once, and reaches neither the view nor the agent', opts, async () => {
  await up();
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/halert`]);
  const qid = await hold();
  const n = c.msgs.length;
  dsite.go = true;
  await pageGot('went-on');
  assert.ok(!c.msgs.slice(n).some(isDialog));
  const st = await ok(a, ['status']);
  await release(qid);
  const s = await ok(a, ['snapshot']);
  for (const x of [st, s]) assert.ok(!x.includes(TEXT.alert), x);
});

for (const [what, m] of [['an address', () => ({ t: 'nav', url: `${dsite.origin}/plain` })], ['Back', () => ({ t: 'back' })], ['a paste', () => ({ t: 'paste', text: 'pasted' })]]) test(`H19 ${what} sent while a confirm is up neither answers it nor lands after it`, opts, async () => {
  await up();
  dsite.keys = [];
  dsite.plain = 0;
  const { c, qid, d } = await heldDialog('/hkeys');
  c.send(m());
  await sleep(1500);
  assert.equal(dsite.answered, null, 'it stays up');
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  await sleep(1000);
  assert.deepEqual([dsite.keys, dsite.plain], [[], 0], 'nothing lands');
  await release(qid);
});

test('H22 an answer right after the ask counts, whenever the hold was last read', opts, async () => {
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_WATCH_MS: '60000' });
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/hconfirm`]);
  const second = await ws(readState(a).view_port); // its connect reads the log: no hold yet
  await second.wait((m) => m.t === 'bye', 3000);
  const n = c.msgs.length;
  const qid = byHand();
  dsite.go = true;
  const d = await c.wait(isDialog, 5000, n);
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  await release(qid);
  await browser(a, ['stop']);
});

test('H24 its words and default are cut, its address is masked, and nothing over the limits answers', opts, async () => {
  const { c, qid, d } = await heldDialog('/hlong?token=hunter2');
  assert.deepEqual([d.text, d.default], [`${'w'.repeat(1999)}\ufffd`, 'v'.repeat(2000)]);
  assert.equal(d.url, `${dsite.origin}/hlong?token=•••`);
  c.send({ t: 'dialog', id: d.id });
  c.send({ t: 'dialog', id: d.id, accept: true, text: 'x'.repeat(10001) });
  c.send({ t: 'dialog', id: d.id, accept: true, text: 7 });
  await sleep(1500);
  assert.equal(dsite.answered, null, 'none of them answered it');
  c.send({ t: 'dialog', id: d.id, accept: true, text: 'y'.repeat(10000) });
  await pageGot(JSON.stringify('y'.repeat(10000)));
  await release(qid);
});

test('H15 a frame with no URL of its own asks under its page\'s name, not the one last opened by the agent', opts, async () => {
  await up();
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/plain`]);
  const qid = await hold();
  await c.wait((m) => m.t === 'held' && m.qid === qid, 5000);
  c.send({ t: 'nav', url: `${dsite.origin}/hframe` });
  await c.wait((m) => m.t === 'url' && m.url.endsWith('/hframe'), 5000);
  const n = c.msgs.length;
  dsite.go = true;
  const d = await c.wait(isDialog, 5000, n);
  assert.equal(d.text, 'framed');
  assert.deepEqual([d.url, d.frame], [`${dsite.origin}/hframe`, true]);
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  await release(qid);
});

test('H21 another site\'s frame, with no URL of its own, never asks as the page it is in', opts, async () => {
  await up();
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/hembed?token=hunter2`]);
  const qid = await hold();
  const n = c.msgs.length;
  dsite.go = true;
  const d = await c.wait(isDialog, 5000, n);
  assert.deepEqual([d.text, d.url, d.frame], ['framed', `${dsite.origin}/hembed?token=•••`, true]);
  c.send({ t: 'dialog', id: d.id, accept: false });
  await pageGot('false');
  await release(qid);
});

test('H16 a page behind another asks, and the owner\'s answer reaches it', opts, async () => {
  await up();
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/hpop`]);
  const b = /^(e\d+) button "Pop up"$/m.exec(await ok(a, ['snapshot']))?.[1];
  await ok(a, ['click', b]);
  await within(5000, async () => JSON.parse(await ok(a, ['tabs'])).tabs.some((t) => t.active && t.url.endsWith('/plain')), 'the popup in front');
  const qid = await hold();
  const n = c.msgs.length;
  dsite.go = true;
  const d = await c.wait(isDialog, 8000, n);
  assert.deepEqual([d.text, d.url], ['behind', `${dsite.origin}/hpop`]);
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  await release(qid);
});

test('H17 an answer dropped on a failed read leaves the dialog up, and the next one counts', opts, async () => {
  const flag = path.join(os.tmpdir(), `${MARK}-fails`);
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_VIEW_READ_FAILS: flag });
  const { c, qid, d } = await heldDialog();
  fs.writeFileSync(flag, '');
  try { c.send({ t: 'dialog', id: d.id, accept: true }); await sleep(2000); } finally { fs.rmSync(flag, { force: true }); }
  assert.equal(dsite.answered, null, 'the first is dropped');
  c.send({ t: 'dialog', id: d.id, accept: true });
  await pageGot('true');
  await release(qid);
  await browser(a, ['stop']);
});

// the renderers below this test's own Chrome, from its state file's pid
const renderersOf = (root) => {
  const kids = (p) => fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).filter((x) => { try { const st = fs.readFileSync(`/proc/${x}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]) === p; } catch { return false; } }).map(Number);
  const all = (p) => kids(p).flatMap((k) => [k, ...all(k)]);
  return all(root).filter((p) => { try { return fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').includes('--type=renderer'); } catch { return false; } });
};
test('H25 its page gone, the view is told it ended', { ...opts, skip: !canDrive ? 'needs Chrome and Node 22+' : fs.existsSync('/proc') ? false : 'needs /proc' }, async () => {
  const { c, qid, d, n } = await heldDialog();
  const pids = renderersOf(readState(a).chrome_pid);
  assert.ok(pids.length > 0);
  for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch {}
  const e = await c.wait((m) => m.t === 'dialog_end', 5000, n);
  assert.equal(e.id, d.id);
  c.send({ t: 'dialog', id: d.id, accept: true });
  await sleep(500);
  assert.equal(dsite.answered, null);
  await release(qid);
});

test('H10 the view page itself, in real Chrome: the owner presses OK and the page in the browser gets true', opts, async () => {
  await up();
  s1Close();
  const chrome = await openChrome();
  try {
    const p = await chrome.newPage();
    await p.send('Page.enable');
    const origin = `http://127.0.0.1:${readState(a).view_port}`;
    await p.send('Page.navigate', { url: `${origin}/` });
    // the view loaded before the first read (kit-920): Page.navigate answers once the page commits, while
    // #chip may not be parsed yet, and a read in a context the navigation replaces throws; those retry
    await within(30000, () => p.ev(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`).catch(() => false), 'the view page loaded');
    await within(10000, () => p.ev(`document.getElementById('chip').textContent === 'Live'`), 'the view live');
    dsite.go = false;
    dsite.answered = null;
    await ok(a, ['open', `${dsite.origin}/hconfirm`]);
    const qid = await hold();
    dsite.go = true;
    await within(8000, () => p.ev(`document.getElementById('ask').open`), 'the dialog in the view');
    assert.equal(await p.ev(`document.getElementById('ask-said').textContent`), TEXT.later);
    await within(5000, () => p.ev(`!document.getElementById('ask-yes').disabled`), 'OK armed');
    const r = await p.ev(`(() => { const b = document.getElementById('ask-yes').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, ...r, button: 'left', clickCount: 1 });
    await pageGot('true');
    await within(3000, () => p.ev(`!document.getElementById('ask').open`), 'taken down');
    await release(qid);
    p.close();
  } finally { await chrome.close(); }
});
