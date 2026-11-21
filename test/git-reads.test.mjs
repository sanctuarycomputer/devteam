// A read-only command over the whole project asks git in bulk, and reads what it read one call at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, write } from './lib/kit.mjs';

test('status: merges of every shape, each review read, in a few git calls whatever the ticket count', () => {
  const F = fleetFixture('git-reads');
  const { old, ok, g, base } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const ids = ['ch-01-plain', 'ch-02-land', 'ch-03-line', 'ch-04-third', 'ch-05-second', 'ch-06-open'];
    for (const id of ids) ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${id}/**`], done_when: ['the tidy check passes'], notes: 'n' })], SUP);
    F.land();
    const branch = (id) => {
      g(['checkout', '-q', '-b', `ticket/${id}`, 'main'], old);
      write(path.join(old, `${id}/a.txt`), `${id}\n`);
      write(path.join(old, `docs/devteam/project/tickets/${id}/reviews/plan-1.md`), `# Review\n\n- Stage: plan\n- Pass: 1\n\nVerdict: APPROVE ${'a'.repeat(40)}\n`);
      g(['add', '-A', id, `docs/devteam/project/tickets/${id}`], old);
      g(['commit', '-qm', `${id} work`], old);
      g(['checkout', '-q', 'main'], old);
    };
    const head = () => g(['rev-parse', 'HEAD'], old);
    const want = {};
    branch('ch-01-plain');
    g(['merge', '-q', '--no-ff', '-m', 'Merge from ticket/ch-01-plain', 'ticket/ch-01-plain'], old);
    want['ch-01-plain'] = head();
    // a merge with a subject that names nothing: found by its second parent
    branch('ch-02-land');
    g(['merge', '-q', '--no-ff', '-m', 'land it', 'ticket/ch-02-land'], old);
    want['ch-02-land'] = head();
    // a branch at a commit on main's first-parent line landed nothing
    g(['branch', 'ticket/ch-03-line', 'HEAD~1'], old);
    want['ch-03-line'] = null;
    // an octopus: its second parent's ticket landed by it, a later parent's isn't read as landed
    branch('ch-04-third');
    branch('ch-05-second');
    g(['merge', '-q', '--no-ff', '-m', 'both', 'ticket/ch-05-second', 'ticket/ch-04-third'], old);
    want['ch-05-second'] = head();
    want['ch-04-third'] = null;
    branch('ch-06-open');
    want['ch-06-open'] = null;
    g(['push', '-q', 'origin', 'main'], old);

    // every git call the command makes
    const bin = path.join(base, 'bin'), calls = path.join(base, 'calls.log');
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    write(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nexec '${real}' "$@"\n`);
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    const st = json(ok(old, ['status', '--json'], { PATH: `${bin}${path.delimiter}${process.env.PATH}` }));
    const made = fs.readFileSync(calls, 'utf8').trim().split('\n');

    for (const id of ids) assert.equal(st.tickets.find((t) => t.id === id).merge_sha, want[id], id);
    assert.equal(st.reviews.by_stage.plan.first_passes, 5, 'every ticket with a review on its branch or on main');
    assert.deepEqual(made.filter((c) => /^merge-base --is-ancestor|^rev-parse --verify --quiet refs\/|^show \S*:docs\/devteam\/project\/tickets\//.test(c)), [], 'nothing asked per ticket');
    assert.ok(made.length <= 25, `${made.length} git calls:\n${made.join('\n')}`);

    const shape = (x) => ({ merged: x.tickets.map((t) => [t.id, t.merge_sha, t.records_landed]), plan: x.reviews.by_stage.plan.first_passes });
    // from a subfolder of home, the same answer as from its root
    const sub = path.join(old, 'docs/devteam/run');
    fs.mkdirSync(sub, { recursive: true });
    const fromSub = json(execFileSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), 'status', '--json'], { cwd: sub, env: F.env({}), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    assert.deepEqual(shape(fromSub), shape(st), 'status from a subfolder');
    // a ref listing that fails is no answer: each ref is asked for, and nothing reads as unmerged
    const failing = path.join(base, 'bin-no-refs');
    write(path.join(failing, 'git'), `#!/bin/sh\ncase "$*" in "for-each-ref --format=%(refname)%00%(objecttype)"*) exit 1;; esac\nexec '${real}' "$@"\n`);
    fs.chmodSync(path.join(failing, 'git'), 0o755);
    assert.deepEqual(shape(json(ok(old, ['status', '--json'], { PATH: `${failing}${path.delimiter}${process.env.PATH}` }))), shape(st), 'status with for-each-ref failing');
  } finally {
    F.done();
  }
});
