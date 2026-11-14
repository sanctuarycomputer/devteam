// The host claim: one machine supervises a repo at a time (supervisor.md §12, One machine at a time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { json, fleetFixture } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
// two machines on one test box: each its own id and name
const BOX = { DEVTEAM_MACHINE_ID: 'box-0000000001', DEVTEAM_MACHINE_NAME: 'the-box' };
const MAC = { DEVTEAM_MACHINE_ID: 'mac-0000000002', DEVTEAM_MACHINE_NAME: 'owners-mac' };
const claimOf = (g, org) => {
  const sha = g(['rev-parse', '--verify', '--quiet', 'refs/devteam/host'], org);
  const raw = g(['cat-file', 'commit', sha], org);
  return JSON.parse(raw.slice(raw.indexOf('\n\n') + 2));
};
// a claim as another machine (or a hand) would push it, straight into origin
function pushClaim(g, at, body) {
  const tree = execFileSync('git', ['mktree'], { cwd: at, input: '', encoding: 'utf8' }).trim();
  const sha = execFileSync('git', ['commit-tree', tree, '-m', JSON.stringify(body)], { cwd: at, encoding: 'utf8' }).trim();
  g(['push', '-q', '--force', 'origin', `${sha}:refs/devteam/host`], at);
}
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

test('host claim: a live claim from another machine refuses a start, the same machine is fine, a stale one is taken over, fleet status shows the holder', () => {
  const F = fleetFixture('host');
  const { org, old, neu, run, ok, g, base } = F;
  try {
    // the box starts: it claims the repo on origin, outside main's history
    assert.match(ok(old, ['prompt', 'supervisor'], BOX), /^You are the supervisor/);
    let c = claimOf(g, org);
    assert.deepEqual([c.devteam_host, c.machine, c.hostname, c.fleet], [1, BOX.DEVTEAM_MACHINE_ID, 'the-box', null]);
    assert.equal(g(['rev-list', '--count', 'main'], org), '1', 'main is untouched');
    // the same machine starts again: fine, and its heartbeat moves
    const [first, since] = [c.at, c.since];
    assert.match(ok(old, ['prompt', 'supervisor'], BOX), /^You are the supervisor/);
    c = claimOf(g, org);
    assert.ok(c.at >= first);
    assert.equal(c.since, since, 'the same stint');

    // the owner's Mac, a clone of the same repo, tries to start one too: refused, in plain words
    g(['clone', '-q', org, neu], base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], neu);
    const no = run(neu, ['prompt', 'supervisor'], MAC);
    assert.equal(no.status, 1);
    assert.match(no.out, /^Do not supervise this repo from this machine\. the-box is supervising this repo \(machine box-0000000001\), last seen (less than a minute|a minute|\d+ minutes) ago/);
    assert.match(no.out, /park or drain the fleet/);
    assert.match(no.out, /lapses 45 minutes after it was last seen/);
    assert.doesNotMatch(no.out, /You are the supervisor/);
    assert.equal(claimOf(g, org).machine, BOX.DEVTEAM_MACHINE_ID, 'a refusal writes nothing');
    // recover refuses too, --force or not; fleet unpark, a resume, likewise
    const rec = run(neu, ['recover', '--force', '--dry-run'], MAC);
    assert.match(rec.out, /^NOT started \(the-box is supervising this repo/);
    // its tick refuses as well, with one owner-action, once
    const tick = run(neu, ['observe-metrics'], { ...SUP, ...MAC, DEVTEAM_URL_PROBE: '/usr/bin/true' });
    assert.equal(tick.status, 1);
    assert.match(tick.err, /stop supervising here\. the-box is supervising this repo/);
    assert.equal(run(neu, ['observe-metrics'], { ...SUP, ...MAC, DEVTEAM_URL_PROBE: '/usr/bin/true' }).status, 1);
    const asked = json(ok(neu, ['questions', '--all', '--json'])).filter((q) => q.kind === 'owner-action' && /stopped supervising this project/.test(q.question));
    assert.equal(asked.length, 1, 'one question for the owner, not one a tick');
    assert.match(asked[0].question, /^owners-mac stopped supervising this project, because the-box is supervising it$/);
    assert.doesNotMatch(asked[0].context, /devteam\.mjs|--|refs\//, 'plain words, no commands');
    // nothing for the owner from a refused start
    assert.equal(json(ok(old, ['questions', '--all', '--json'])).filter((q) => q.kind === 'owner-action').length, 0);

    // fleet status (and fleet host) show who holds it
    assert.match(ok(neu, ['fleet', 'status'], SUP), /\nsupervising machine: the-box \(machine box-0000000001\), last seen /);
    assert.match(ok(old, ['fleet', 'host'], BOX), /^supervising machine: the-box \(machine box-0000000001, this machine\)/);
    const st = json(ok(neu, ['fleet', 'status', '--json'], { ...SUP, ...MAC }));
    assert.deepEqual([st.host.machine, st.host.hostname, st.host.mine, st.host.state], [BOX.DEVTEAM_MACHINE_ID, 'the-box', false, 'live']);

    // the box died an hour ago: its claim is stale, and the Mac takes over
    pushClaim(g, old, { devteam_host: 1, machine: BOX.DEVTEAM_MACHINE_ID, hostname: 'the-box', at: minutesAgo(60), since: minutesAgo(600), fleet: null });
    const took = run(neu, ['prompt', 'supervisor'], MAC);
    assert.equal(took.status, 0, took.err);
    assert.match(took.out, /^You are the supervisor/);
    assert.match(took.err, /took over supervising this repo from the-box \(its claim was stale/);
    assert.equal(claimOf(g, org).machine, MAC.DEVTEAM_MACHINE_ID);
    // now the box is the second one: it comes back and is refused
    assert.equal(run(old, ['prompt', 'supervisor'], BOX).status, 1);

    // a hand-written claim only ever refuses: one dated far ahead, or unreadable, holds nothing
    pushClaim(g, old, { devteam_host: 1, machine: 'someone-else-1', hostname: 'x', at: new Date(Date.now() + 3 * 3600000).toISOString(), fleet: null });
    assert.equal(run(old, ['prompt', 'supervisor'], BOX).status, 0);
    pushClaim(g, old, { anything: 'at all' });
    assert.equal(run(old, ['prompt', 'supervisor'], BOX).status, 0);
    assert.equal(claimOf(g, org).machine, BOX.DEVTEAM_MACHINE_ID);

    // the owner, sure the box is gone, takes it now; the supervisor can't
    assert.match(run(neu, ['fleet', 'host', '--take'], { ...SUP, ...MAC }).err, /owner commands don't run in an agent session/);
    assert.match(ok(neu, ['fleet', 'host', '--take'], MAC), /^owners-mac now supervises this repo \(taken from the-box/);
    assert.equal(claimOf(g, org).machine, MAC.DEVTEAM_MACHINE_ID);
  } finally { F.done(); }
});

test('host claim: a parked or drained fleet hands the claim to the machine it moves to', () => {
  const F = fleetFixture('hostpark');
  const { org, old, neu, run, ok, g, base } = F;
  try {
    ok(old, ['prompt', 'supervisor'], BOX);
    g(['clone', '-q', org, neu], base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], neu);
    assert.equal(run(neu, ['prompt', 'supervisor'], MAC).status, 1);
    // park on the box: the claim says so at once
    ok(old, ['fleet', 'park', '--reason', 'moving to the mac'], { ...SUP, ...BOX });
    assert.equal(claimOf(g, org).fleet, 'park');
    assert.match(ok(old, ['fleet', 'status'], { ...SUP, ...BOX }), /supervising machine: the-box \(machine box-0000000001, this machine\), last seen .*its fleet parked for a move/);
    // the Mac starts: it takes the claim over
    const took = run(neu, ['prompt', 'supervisor'], MAC);
    assert.equal(took.status, 0, took.out);
    assert.match(took.err, /took over supervising this repo from the-box \(its claim was parked for a move/);
    assert.equal(claimOf(g, org).machine, MAC.DEVTEAM_MACHINE_ID);
    // the box, still ticking while parked, is now the second machine; once the Mac unparks, a live one
    pushClaim(g, old, { ...claimOf(g, org), at: new Date().toISOString(), fleet: null });
    const tick = run(old, ['observe-metrics'], { ...SUP, ...BOX, DEVTEAM_URL_PROBE: '/usr/bin/true' });
    assert.equal(tick.status, 1);
    assert.match(tick.err, /owners-mac is supervising this repo/);

    // a drain hands over the same way
    pushClaim(g, old, { devteam_host: 1, machine: BOX.DEVTEAM_MACHINE_ID, hostname: 'the-box', at: new Date().toISOString(), since: minutesAgo(30), fleet: 'drain' });
    assert.equal(run(neu, ['prompt', 'supervisor'], MAC).status, 0);
    assert.equal(claimOf(g, org).machine, MAC.DEVTEAM_MACHINE_ID);
  } finally { F.done(); }
});

test('host claim: no remote, or no network, never blocks: one warning, then on', () => {
  const F = fleetFixture('hostoff');
  const { old, run, ok, g } = F;
  try {
    // origin unreachable (a laptop offline): warned once, started all the same
    g(['remote', 'set-url', 'origin', path.join(F.base, 'nowhere.git')], old);
    const a = run(old, ['prompt', 'supervisor'], BOX);
    assert.equal(a.status, 0);
    assert.match(a.out, /^You are the supervisor/);
    assert.match(a.err, /could not check which machine supervises this repo: could not reach origin/);
    const b = run(old, ['prompt', 'supervisor'], BOX);
    assert.equal(b.status, 0);
    assert.doesNotMatch(b.err, /could not check which machine/, 'once, not every start');
    assert.equal(run(old, ['observe-metrics'], { ...SUP, ...BOX, DEVTEAM_URL_PROBE: '/usr/bin/true' }).status, 0);
    assert.match(ok(old, ['fleet', 'host'], BOX), /^supervising machine: unknown \(could not reach origin/);
    // no origin at all
    g(['remote', 'remove', 'origin'], old);
    const c = run(old, ['prompt', 'supervisor'], BOX);
    assert.equal(c.status, 0);
    assert.match(c.err, /this checkout has no origin remote/);
    assert.equal(run(old, ['prompt', 'supervisor'], BOX).err.includes('could not check'), false);
    assert.ok(!fs.existsSync(path.join(old, 'docs/devteam/run/log')) || json(ok(old, ['questions', '--all', '--json'])).length === 0, 'nothing for the owner');
  } finally { F.done(); }
});
