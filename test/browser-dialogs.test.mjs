// A page's JS dialogs (kit-329): alert, confirm, prompt and beforeunload are answered by the daemon
// with the stated defaults (alert OK, confirm Cancel, prompt Cancel, beforeunload Leave), so neither
// the verbs nor the live view's frames stop behind one, and the verb that was running names each
// dialog it answered. Each check is the spec's (docs/devteam/project/tickets/kit-329-browser-js-dialogs/
// spec.md, home), named by its id. The fixture pages are this file's own server's, allowed beside the
// shared fixture site's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { a, browser, ok, viewer, readState, sleep } from './lib/browser-view-fixture.mjs';
import { TEXT, MANY, dsite, dialogsFile, up, timed, stillGoing, named, said, later, asked, LATER } from './lib/browser-dialogs-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
dialogsFile();

test('D1 an alert is dismissed (OK): the next frame and verb arrive, and open names it', opts, async () => {
  await up();
  const c = await viewer();
  const r = await timed(['open', `${dsite.origin}/alert`]);
  await stillGoing(c, /heading "after the alert"/);
  named(r, said('alert', TEXT.alert, 'OK'));
});

test('D2 a confirm is answered Cancel: the page gets false, the next frame and verb arrive, and open names it', opts, async () => {
  await up();
  const c = await viewer();
  const r = await timed(['open', `${dsite.origin}/confirm`]);
  await stillGoing(c, /heading "confirm returned false"/);
  named(r, said('confirm', TEXT.confirm, 'Cancel'));
});

test('D3 a prompt is answered Cancel: the page gets null, the next frame and verb arrive, and open names it', opts, async () => {
  await up();
  const c = await viewer();
  const r = await timed(['open', `${dsite.origin}/prompt`]);
  await stillGoing(c, /heading "prompt returned null"/);
  named(r, said('prompt', TEXT.prompt, 'Cancel'));
});

test('D4 a beforeunload is answered Leave: the click goes on to the next page, the next frame and verb arrive, and the click names it', opts, async () => {
  await up();
  const c = await viewer();
  await ok(a, ['open', `${dsite.origin}/leave`]);
  const snap = await ok(a, ['snapshot']);
  const button = /^(e\d+) button "Press me"$/m.exec(snap)?.[1], link = /^(e\d+) link "Go on"/m.exec(snap)?.[1];
  assert.ok(button && link, snap);
  await ok(a, ['click', button]); // the page's sticky activation, which Chrome needs before it asks
  const r = await timed(['click', link]);
  await stillGoing(c, /heading "the plain page"/);
  named(r, 'the page asked before leaving (beforeunload); answered Leave');
  assert.match(r.out, /now at http:\/\/127\.0\.0\.1:\d+\/plain/);
});

test('D5 a dialog between verbs is answered, the next frame and verb arrive, and that verb names it once', opts, async () => {
  await up();
  const c = await viewer();
  await later();
  await asked();
  const s = await stillGoing(c, /heading "later confirm returned false"/);
  assert.ok(s.out.split('\n').includes(LATER), s.out);
  assert.ok(!(await ok(a, ['snapshot'])).includes(LATER), 'named once');
});

test('D8 ping and a JSON answer leave a kept dialog for the next plain-text answer', opts, async () => {
  await up();
  await later();
  await asked();
  const st = readState(a);
  const res = await fetch(`http://127.0.0.1:${st.control_port}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-devteam-browser': st.control_secret }, body: JSON.stringify({ verb: 'ping' }) });
  assert.deepEqual(await res.json(), { code: 0, out: 'pong' });
  assert.equal(JSON.parse(await ok(a, ['tabs'])).browser, 1);
  assert.equal(JSON.parse(await ok(a, ['snapshot', '--json'])).browser, 1);
  assert.ok((await ok(a, ['snapshot'])).split('\n').includes(LATER), 'the next plain-text answer names it');
});

test('D6 five dialogs are named, the rest counted; each text is JSON-quoted on its own line and cut to 300 characters', opts, async () => {
  await up();
  const r = await timed(['open', `${dsite.origin}/many`]);
  assert.equal(r.status, 0, `open: ${r.err || r.out}`);
  const lines = r.out.split('\n');
  assert.ok(!lines.some((l) => l.startsWith('the page\'s confirm said "forged"')), `a line break in the text forged a line:\n${r.out}`);
  assert.deepEqual(lines.filter((l) => l.startsWith("the page's ")), [
    said('alert', MANY[0], 'OK'),
    said('alert', 'x'.repeat(300), 'OK'),
    ...MANY.slice(2, 5).map((t) => said('alert', t, 'OK')),
  ]);
  assert.equal(lines.at(-1), 'and 2 more dialogs, answered the same way');
  await stillGoing(await viewer(), /heading "seven alerts done"/);
});

// browser <args> within ms, else null (the CLI is left to its own 90 s kill)
const bounded = (args, ms) => Promise.race([timed(args), sleep(ms).then(() => null)]);

test('D10 on a page alerting without end, each verb answers on its own timeout and the daemon stays answerable', { ...opts, timeout: 150000 }, async () => {
  await up();
  const o = await bounded(['open', `${dsite.origin}/loop`], 45000);
  assert.ok(o, 'open answered within 45 s');
  const s = await bounded(['snapshot'], 45000);
  assert.ok(s, 'snapshot answered within 45 s');
  const st = await bounded(['status'], 5000);
  assert.ok(st, 'status answered within 5 s');
  assert.equal(st.status, 0, st.err || st.out);
  assert.ok(st.out.split('\n').filter((l) => l.startsWith("the page's alert said")).length <= 5, st.out);
});

test('D7 the usage names the default answers', opts, async () => {
  const r = await browser(a, ['no-such-verb']);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /a page's JS dialogs are answered: alert OK, confirm Cancel, prompt Cancel, beforeunload Leave/);
});
