// Settings' Ready to move? when home's origin can't be reached (kit-341): the check (POST
// /api/fleet-check) answers 502 with only an error, so a page with nothing drawn yet reads fleet
// status plainly (GET /api/fleet) and shows its blockers under the error, as it does for a refused
// check (ruling m-20261116-095757248: Ready to move? at all times, each blocker). Over an answer
// already drawn, a failed check reads nothing and the old answer stays, marked old.
// Run: node --test test/settings-fleet-offline.test.mjs (needs Chrome and Node 22)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PORTS, dashboardOnFreePort, fleetFixture, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

test('Settings with home\'s origin gone: the check fails, the card shows the plain read\'s blockers under the error', { skip: SKIP, timeout: 600000 }, async (t) => {
  const F = fleetFixture('setoffline');
  const later = cleanup(t);
  later(() => F.done());
  // home's origin gone: every fetch from it fails at once
  F.g(['remote', 'set-url', 'origin', path.join(F.base, 'gone.git')], F.old);
  fs.mkdirSync(F.home, { recursive: true });
  const env = { ...F.env({}), HOME: F.home, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3) };
  const { dash, port } = await dashboardOnFreePort(F.old, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#overview` });
  await until(() => p.ev("location.protocol === 'http:' && !!document.querySelector('main') && !document.querySelector('main.waiting') && typeof loadFleet === 'function'").catch(() => false), 'the dashboard drawn');

  // what the server says, asked directly: the check fails with only an error; the plain read has blockers
  const own = { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
  const check = await fetch(`http://127.0.0.1:${port}/api/fleet-check`, { method: 'POST', headers: own, body: '{}' });
  assert.equal(check.status, 502, 'the check, with home\'s origin gone');
  assert.match((await check.json()).error, /^home: could not fetch origin: /);
  const plain = await (await fetch(`http://127.0.0.1:${port}/api/fleet`)).json();
  assert.ok(plain.blockers.length > 0 && plain.blockers.some((b) => /neither parked nor drained/.test(b)), `a running fleet's plain read has blockers: ${JSON.stringify(plain.blockers)}`);

  // every GET of /api/fleet and every check counted; __failFleet answers the plain read 500
  await p.ev(`(() => {
    window.__fleetGets = 0; window.__checks = 0; window.__failFleet = false;
    const real = window.fetch;
    window.fetch = (u, o) => {
      const url = String(u);
      if (url === '/api/fleet-check' && o && o.method === 'POST') window.__checks += 1;
      if (url === '/api/fleet' && (!o || !o.method || o.method === 'GET')) {
        window.__fleetGets += 1;
        if (window.__failFleet) return Promise.resolve(new Response(JSON.stringify({ error: 'the read failed' }), { status: 500, headers: { 'content-type': 'application/json' } }));
      }
      return real(u, o);
    };
  })()`);
  const S = '#settings';
  const blockers = () => p.ev(`JSON.stringify([...document.querySelectorAll('${S} .ready-card .ready-blocker')].map((r) => r.textContent.trim()))`);
  const err = () => p.ev(`document.querySelector('${S} .ready-card .err')?.textContent ?? ''`);
  const badge = () => p.ev(`document.querySelector('${S} .ready-card .card-head .badge')?.textContent ?? null`);

  // C1: arriving checks; the check fails with nothing drawn, so the page reads plainly and draws its blockers under the error
  await p.ev("location.hash = '#settings'");
  await until(() => p.ev(`window.__checks >= 1 && !FLEET.busy && !!document.querySelector('${S} .ready-card .err')`), 'the arrival check answered and drawn');
  assert.match(await err(), /^Couldn't check: home: could not fetch origin: .* What shows is a plain read, not checked against origin\.$/, 'the error, and that what shows is a plain read');
  assert.equal(await p.ev('window.__fleetGets'), 1, 'one plain read after the failed check');
  await until(async () => (await blockers()) === JSON.stringify(plain.blockers), `the plain read's blockers on the card (have ${await blockers()})`);
  assert.match(await badge(), /^last check failed; this is from \S/, 'the badge says the check failed');

  // C2: Check now again, still offline, with an answer drawn: no read, the answer stays, marked old
  await p.ev('window.__fleetGets = 0; window.__checks = 0; true');
  await p.click(`${S} .ready-card [data-checknow]`);
  await until(() => p.ev(`window.__checks === 1 && !FLEET.busy && document.querySelector('${S} .ready-card [data-checknow]')?.disabled === false`), 'the second check answered');
  assert.equal(await p.ev('window.__fleetGets'), 0, 'no plain read over an answer already drawn');
  assert.match(await err(), /^Couldn't check: home: could not fetch origin: /, 'the check\'s error');
  assert.doesNotMatch(await err(), /plain read/, 'not said to be a plain read: nothing was read');
  assert.equal(await blockers(), JSON.stringify(plain.blockers), 'the drawn blockers stay');
  assert.match(await badge(), /^last check failed; this is from \S/, 'marked old');

  // C3: nothing drawn and the plain read fails too: the check's error, no blockers, nothing thrown
  await p.ev('window.__errors = []; window.addEventListener("unhandledrejection", (e) => window.__errors.push(String(e.reason))); window.addEventListener("error", (e) => window.__errors.push(String(e.message))); true');
  await p.ev('FLEET.data = null; FLEET.error = null; window.__fleetGets = 0; window.__checks = 0; window.__failFleet = true; true');
  await p.click(`${S} .ready-card [data-checknow]`);
  await until(() => p.ev(`window.__checks === 1 && window.__fleetGets === 1 && !FLEET.busy && document.querySelector('${S} .ready-card [data-checknow]')?.disabled === false`), 'the check and the failed read answered');
  assert.match(await err(), /^Couldn't check: home: could not fetch origin: /, 'the check\'s error, not the read\'s');
  assert.doesNotMatch(await err(), /the read failed|plain read/, 'the read\'s failure does not replace it');
  assert.equal(await blockers(), '[]', 'no blockers: nothing was read');
  assert.equal(await p.ev('FLEET.data'), null, 'no data');
  assert.deepEqual(JSON.parse(await p.ev('JSON.stringify(window.__errors)')), [], 'nothing thrown');
});
