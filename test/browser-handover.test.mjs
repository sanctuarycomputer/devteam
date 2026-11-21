// The browser handover (kit-67): the supervisor hands the agent browser to the owner for a login
// with one owner-action question (class browser-handover, scope browser:<instance key>), and the
// browser is held until the owner answers. Each check is the spec's
// (docs/devteam/project/tickets/kit-67-browser-handover/spec.md, home), named by its id. The asking
// checks need no Chrome and run on every Node; the Chrome checks skip without canDrive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { monoFixture } from './lib/kit.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
// the Chrome checks take these (later tasks)
const chromeOpts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const KEY = 'probe67-0123456789ab';
const CHOICES = JSON.stringify([{ label: 'Done' }, { label: "Can't right now" }]);

// One project for the asking checks; every line the log holds, counted across its files.
let F;
const fx = () => (F ??= monoFixture('handover-ask'));
test.after(() => F?.done());
const logLines = () => {
  const dir = path.join(fx().old, 'docs/devteam/run/log');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l.trim()).length, 0);
};
const ask = (...extra) => fx().run(fx().old, ['ask', '--question', 'Log in to the fixture site, then press Done', '--stake', '2', '--urgency', '2', ...extra], SUP);
const refused = (r, re, n0, why) => {
  assert.equal(r.status, 1, `${why}: exit ${r.status}: ${r.err || r.out}`);
  assert.match(r.err, re, why);
  assert.equal(logLines(), n0, `${why}: no line is added`);
};

test('C2 ask refuses --default on browser-handover', () => {
  const n0 = logLines();
  const r = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', `browser:${KEY}`, '--choices', CHOICES, '--default', 'Done');
  refused(r, /a browser-handover question has no --default: only the owner hands the browser back/, n0, '--default');
  // the default is refused first, before a bad kind or scope
  const r2 = ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', 'browser:nope', '--default', 'Done');
  refused(r2, /no --default/, n0, '--default before kind and scope');
});

test('C26 ask refuses a wrong kind or scope, and gives no no-goal warning', () => {
  const n0 = logLines();
  refused(ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', `browser:${KEY}`), /browser-handover question is an owner-action/, n0, '--kind owner-decision');
  refused(ask('--class', 'browser-handover', '--scope', `browser:${KEY}`), /browser-handover question is an owner-action/, n0, 'no --kind (an owner-decision)');
  // the kind is refused before the scope
  refused(ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', 'browser:nope'), /browser-handover question is an owner-action/, n0, 'kind before scope');
  for (const s of ['browser:nope', `browser:${KEY.toUpperCase()}`, KEY, `browser:${KEY}x`, `browser: ${KEY}`]) {
    refused(ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', s, '--choices', CHOICES), /browser-handover question's scope is browser:<instance key>/, n0, `--scope ${s}`);
  }
  refused(ask('--kind', 'owner-action', '--class', 'browser-handover', '--choices', CHOICES), /browser-handover question's scope is browser:<instance key>/, n0, 'no --scope');
  // with neither problem it is asked, and without the no-goal warning
  const scope = 'browser:c26-aaaaaaaaaaaa';
  const r = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICES);
  assert.equal(r.status, 0, r.err || r.out);
  assert.match(r.out, /^q-\S+$/m);
  assert.doesNotMatch(r.err, /names no --goal/);
  assert.equal(logLines(), n0 + 1);
  // another class still gets the warning
  const o = ask('--kind', 'owner-action', '--class', 'new-feature', '--choices', CHOICES);
  assert.equal(o.status, 0, o.err || o.out);
  assert.match(o.err, /names no --goal/);
});

test('C10b ask refuses a second open handover of the scope', () => {
  const scope = `browser:${KEY}`;
  const first = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICES);
  assert.equal(first.status, 0, first.err || first.out);
  const qid = first.out.split('\n').find((l) => /^q-/.test(l));
  assert.ok(qid, first.out);
  const n0 = logLines();
  const r = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICES);
  refused(r, new RegExp(`already open.*${qid}|${qid}.*already open`), n0, 'a second handover of the scope');
  // another instance's scope is its own browser: asked
  const other = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', 'browser:other-0123456789ab', '--choices', CHOICES);
  assert.equal(other.status, 0, other.err || other.out);
  assert.equal(logLines(), n0 + 1);
});
