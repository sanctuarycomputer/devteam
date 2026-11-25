// A page's dialog in a handover (kit-770) that the owner doesn't answer: no agent can, an answer after
// the close is dropped, and every end is the stated default, never an OK. Each check is the spec's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { site, a, browser, kitCli, ok, running, viewer, within, readState, sleep, s1 } from './lib/browser-view-fixture.mjs';
import { TEXT, dsite, dialogsFile, up, isDialog, hold, release, heldDialog, byHand, pageGot, allow, other } from './lib/browser-dialogs-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
dialogsFile();

test('H5 no agent answers it: every verb but status is refused, and stop is never an OK', opts, async () => {
  const { qid } = await heldDialog();
  for (const v of [['snapshot'], ['press', 'Enter'], ['open', `${dsite.origin}/plain`], ['back'], ['tabs'], ['screenshot']]) assert.equal((await browser(a, v)).status, 3, v.join(' '));
  // the daemon itself, past the CLI's own check
  const s = readState(a);
  for (const [verb, args] of [['snapshot', {}], ['press', { key: 'Enter' }], ['open', { url: `${dsite.origin}/plain` }], ['back', {}], ['tabs', {}]]) {
    const res = await fetch(`http://127.0.0.1:${s.control_port}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-devteam-browser': s.control_secret }, body: JSON.stringify({ verb, args }), signal: AbortSignal.timeout(5000) }).catch(() => null);
    assert.equal(res && (await res.json()).code, 3, `${verb} at the daemon`);
  }
  const st = await browser(a, ['status']);
  assert.equal(st.status, 0);
  assert.ok(!st.out.includes(TEXT.later), st.out);
  assert.equal(dsite.answered, null, 'still the owner\'s');
  await ok(a, ['stop']);
  await sleep(1000);
  assert.notEqual(dsite.answered, 'true', 'stop is never an OK');
  await up();
  await release(qid);
});

test('H6 an answer after the close, while it is pending, is dropped; the end is never an OK', opts, async () => {
  await browser(a, ['stop']);
  await running({ DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${dsite.address().port},${other.address().port}`, DEVTEAM_TEST_BROWSER_WATCH_HANDLE: '0', DEVTEAM_TEST_BROWSER_WATCH_MS: '60000' });
  const { c, qid, d } = await heldDialog();
  const w = await kitCli(a, ['withdraw', qid, '--reason', 'closed under the owner']);
  assert.equal(w.status, 0, w.err || w.out);
  c.send({ t: 'dialog', id: d.id, accept: true });
  await sleep(1500);
  assert.equal(dsite.answered, null, 'the late answer is dropped');
  await ok(a, ['snapshot']); // the close handled
  await c.wait((m) => m.t === 'bye', 5000);
  await sleep(500);
  assert.notEqual(dsite.answered, 'true');
  await browser(a, ['stop']);
});

for (const [how, env] of [['the close', { DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '1500' }], ['a forget', { DEVTEAM_TEST_BROWSER_FORGET_DELAY_MS: '1500' }]]) test(`H12 a confirm ended by ${how} is Cancel, and what its page says next never reaches the agent`, opts, async () => {
  await browser(a, ['stop']);
  await allow(env);
  const { c, qid } = await heldDialog('/hspeaks');
  if (how === 'a forget') c.send({ t: 'forget' });
  else assert.equal((await kitCli(a, ['withdraw', qid, '--reason', 'closed'])).status, 0);
  await pageGot('false');
  await sleep(3000);
  if (how === 'a forget') await release(qid);
  const st = await ok(a, ['status']), s = await ok(a, ['snapshot']);
  for (const x of [st, s]) assert.ok(!x.includes('ownersecret'), x);
  await browser(a, ['stop']);
});

test('H13 a beforeunload ended by the close is Leave', opts, async () => {
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '1500' });
  const c = await viewer();
  await ok(a, ['open', `${dsite.origin}/hleave`]);
  const qid = await hold();
  await c.wait((m) => m.t === 'held' && m.qid === qid, 5000);
  c.send({ t: 'mouse', type: 'click', x: 20, y: 20, button: 'left', clicks: 1 });
  await sleep(500);
  const n = c.msgs.length;
  dsite.plain = 0;
  c.send({ t: 'nav', url: `${dsite.origin}/plain` });
  await c.wait(isDialog, 5000, n);
  assert.equal(dsite.plain, 0);
  assert.equal((await kitCli(a, ['withdraw', qid, '--reason', 'closed'])).status, 0);
  await within(5000, () => dsite.plain > 0, 'Leave went on');
  await browser(a, ['stop']);
});

test('H18 a close handled by a verb, with the watch off, ends a confirm with Cancel', opts, async () => {
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_WATCH_HANDLE: '0', DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '1500' });
  const { qid } = await heldDialog();
  assert.equal((await kitCli(a, ['withdraw', qid, '--reason', 'closed'])).status, 0);
  await sleep(1000);
  assert.equal(dsite.answered, null, 'nothing has handled the close');
  await ok(a, ['snapshot']);
  assert.equal(dsite.answered, 'false');
  await browser(a, ['stop']);
});

test('H20 a close ends the dialog off the verbs\' queue, while a verb holds it', opts, async () => {
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_OPEN_DELAY_MS: '12000' });
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  const s = readState(a);
  // open runs before the hold and is kept on the queue by the hook; the hold is asked by hand meanwhile
  const open = fetch(`http://127.0.0.1:${s.control_port}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-devteam-browser': s.control_secret }, body: JSON.stringify({ verb: 'open', args: { url: `${dsite.origin}/hconfirm` } }) }).then((r) => r.json());
  await within(5000, () => c.msgs.some((m) => m.t === 'url' && m.url.endsWith('/hconfirm')), 'the page open');
  const n = c.msgs.length;
  const qid = byHand();
  await c.wait((m) => m.t === 'held' && m.qid === qid, 3000, n);
  dsite.go = true;
  await c.wait(isDialog, 3000, n);
  assert.equal((await kitCli(a, ['withdraw', qid, '--reason', 'closed'])).status, 0);
  await within(3000, () => dsite.answered !== null, 'the end while open still runs');
  assert.equal(dsite.answered, 'false');
  await open;
  await browser(a, ['stop']);
});

test('H14 with a close unhandled, a confirm under the next handover is Cancel at once and never sent', opts, async () => {
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_WATCH_HANDLE: '0' });
  const c = await viewer();
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/hconfirm`]);
  const q1 = await hold();
  await c.wait((m) => m.t === 'held' && m.qid === q1, 5000);
  assert.equal((await kitCli(a, ['withdraw', q1, '--reason', 'closed'])).status, 0);
  const q2 = await hold();
  await sleep(700);
  const n = c.msgs.length;
  dsite.go = true;
  await pageGot('false');
  assert.ok(!c.msgs.slice(n).some(isDialog));
  assert.equal((await kitCli(a, ['withdraw', q2, '--reason', 'closed'])).status, 0);
  await browser(a, ['stop']);
});

test('H23 with no viewer and the watch not yet round, an alert just after the ask never reaches the agent', opts, async () => {
  s1?.close();
  await browser(a, ['stop']);
  await allow({ DEVTEAM_TEST_BROWSER_WATCH_MS: '60000' });
  dsite.go = false;
  dsite.answered = null;
  await ok(a, ['open', `${dsite.origin}/halert`]);
  const qid = await hold();
  dsite.go = true;
  await pageGot('went-on');
  const st = await ok(a, ['status']);
  assert.ok(!st.includes(TEXT.alert), st);
  await release(qid);
  await browser(a, ['stop']);
});
