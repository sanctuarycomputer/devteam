// The browser handover's close (kit-67): what happens once the owner hands the browser back, and the
// repeated-site warning. Each check is the spec's
// (docs/devteam/project/tickets/kit-67-browser-handover/spec.md, home), named by its id. Every check
// needs Chrome and skips without canDrive; the mustRun guard fails the file instead on CI's Node 22+.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { startSites } from './lib/sites.mjs';
import { handoverFile, project, kit, browser, appendLine, site, CHOICES, qidOf, ok, withdraw } from './lib/browser-handover-fixture.mjs';

handoverFile();

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const chromeOpts = { skip, timeout: 140000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

// C23's own sites: hosts no other check hands over, so only C23's handovers name them. S2 carries
// the 8-day case and the near miss, S3 the 6-day, second-handover and after-forget cases: the live
// handover of the 8-day case names S2, so it is never an earlier handover of S3's cases.
let S2, S3;
before(async () => { S2 = await startSites(); S3 = await startSites(); });
after(async () => { await S2?.close(); await S3?.close(); });

let C;
const cA = () => (C ??= project('cA', { DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${S2.port},${S3.port}` }));
const DAY = 86400000;
const host = (S) => `127.0.0.1:${S.port}`;
// an earlier handover of this scope, written by hand as asked at `at` on `on`, and closed
async function earlier(P, on, at) {
  const l = appendLine(P, { type: 'question', kind: 'owner-action', class: 'browser-handover', scope: `browser:${P.key}`, question: 'Log in (written by hand)', context: `Open the browser from the link, log in, then press Done.\n\nThe browser is on ${on}.`, choices: CHOICES, at: new Date(at).toISOString() });
  await withdraw(P, l.id);
  return l.id;
}
// a live handover on site S: { qid, err }, closed again after
async function handover(P, S) {
  await ok(P, ['open', `${S.origin}/login`]);
  const r = await browser(P, ['handover', '--reason', 'Log in to the fixture site, then press Done']);
  assert.equal(r.status, 0, r.err || r.out);
  const qid = qidOf(r);
  assert.ok(qid, r.out);
  await withdraw(P, qid);
  return { qid, err: r.err };
}
const WARNED = /was handed over on .* and not forgotten since/;
const warning = (S, qid) => new RegExp(`devteam: warning: browser handover: ${host(S).replace(/\./g, '\\.')} was handed over on \\d{4}-\\d{2}-\\d{2} \\(${qid}\\) and not forgotten since; the session may not have lasted`);

test('C23 a second handover of a site within 7 days, with no forget between, warns naming the earlier one', chromeOpts, async () => {
  const P = cA();
  await ok(P, ['start']);
  // root.json 10 days back: only the hand-written earlier handovers' dates decide
  const root = path.join(P.profile, 'root.json');
  const back = new Date(Date.now() - 10 * DAY);
  fs.utimesSync(root, back, back);
  // 8 days back: too old to warn
  await earlier(P, host(S2), Date.now() - 8 * DAY);
  const eight = await handover(P, S2);
  assert.doesNotMatch(eight.err, WARNED, `8 days back: ${eight.err}`);
  // 6 days back: warns, naming it
  const six = await earlier(P, host(S3), Date.now() - 6 * DAY);
  const h6 = await handover(P, S3);
  assert.match(h6.err, warning(S3, six), `6 days back: ${h6.err}`);
  // a live second handover: warns naming the most recent earlier one, the live first
  const second = await handover(P, S3);
  assert.match(second.err, warning(S3, h6.qid), `the second handover: ${second.err}`);
  // forget remakes root.json: no warning after it
  await ok(P, ['stop']);
  await ok(P, ['forget']);
  await ok(P, ['start']);
  const fresh = await handover(P, S3);
  assert.doesNotMatch(fresh.err, WARNED, `after forget: ${fresh.err}`);
  // a host the earlier one doesn't name exactly: 127.0.0.1:<port> is not 127.0.0.1:<port>0
  await earlier(P, `${host(S2)}0`, Date.now());
  const near = await handover(P, S2);
  assert.doesNotMatch(near.err, WARNED, `the near-miss host: ${near.err}`);
});
