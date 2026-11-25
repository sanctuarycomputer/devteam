// log-sync's fetch of chore-log (kit-884): only origin saying the branch is gone drops
// origin/chore-log, and the sync then starts from main. Any other failed fetch keeps it: the sync
// goes on from it when origin's chore-log is still there, or stops saying why, so no push is
// refused as a non-fast-forward. A git on PATH stands in for the calls it is armed for: it fails
// them with words of its own, or empties a sibling worktree's commondir just before the first one
// (another git worktree add, between making that file and filling it) and fills it 0.4 s after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const q = (s) => JSON.stringify(s);
const REFUSED = 'fatal: unable to access origin: Connection refused';
const FETCH = [' fetch ', 'refs/heads/chore-log:'];
const ASK = [' ls-remote ', 'refs/heads/chore-log'];

// arm(rules): each rule { match, says, times } fails the first `times` git calls (every one when
// times is left out) whose arguments hold each string of match, printing says and exiting 128;
// { match, half: true } empties the sibling's commondir before the first matching call and fills
// it 0.4 s after. codes(): each matched call's exit. disarm(): the shim gone, the entry whole.
function shim(F) {
  const { old } = F;
  const sib = path.join(fs.mkdtempSync(path.join(F.base, 'sib-')), 'sibling');
  F.g(['worktree', 'add', '-q', '--detach', sib, 'HEAD'], old);
  const common = path.join(fs.realpathSync(old), '.git', 'worktrees', 'sibling', 'commondir');
  const bin = fs.mkdtempSync(path.join(F.base, 'shims-'));
  const at = (n) => path.join(bin, n);
  fs.copyFileSync(common, at('whole'));
  const rule = (r, i) => `case " $* " in ${r.match.map((m) => `*${q(m)}`).join('')}*)
${r.half
    ? `first=; if [ ! -e ${q(at(`met${i}`))} ]; then first=1; : > ${q(at(`met${i}`))}; : > ${q(common)}; fi
${q(realGit)} "$@"; code=$?; echo "$code" >> ${q(at('codes'))}
if [ -n "$first" ]; then (sleep 0.4; cp ${q(at('whole'))} ${q(common)}) </dev/null >/dev/null 2>&1 & fi
exit $code`
    : `n=$(cat ${q(at(`met${i}`))} 2>/dev/null || echo 0); echo $((n + 1)) > ${q(at(`met${i}`))}
if [ ${r.times ? `"$n" -lt ${r.times}` : 'true'} ]; then echo ${q(r.says)} >&2; echo 128 >> ${q(at('codes'))}; exit 128; fi
${q(realGit)} "$@"; code=$?; echo "$code" >> ${q(at('codes'))}; exit $code`} ;;
esac`;
  const disarm = () => { for (const n of fs.readdirSync(bin)) if (n !== 'whole') fs.rmSync(at(n), { force: true }); fs.copyFileSync(at('whole'), common); };
  return {
    env: { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    arm: (rules) => { disarm(); fs.writeFileSync(at('git'), `#!/bin/sh\n${rules.map(rule).join('\n')}\nexec ${q(realGit)} "$@"\n`, { mode: 0o755 }); },
    disarm,
    codes: () => (fs.existsSync(at('codes')) ? fs.readFileSync(at('codes'), 'utf8').trim().split('\n') : []),
  };
}

test('log-sync keeps origin/chore-log past a failed fetch', async (t) => {
  const F = fleetFixture('log-sync-fetch');
  const { old, ok, g } = F;
  try {
    const S = shim(F);
    const tracked = () => { try { return g(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/chore-log'], old); } catch { return null; } };
    const onOrigin = () => { try { return g([`--git-dir=${F.org}`, 'rev-parse', '--verify', '--quiet', 'refs/heads/chore-log'], old); } catch { return null; } };
    const isAncestor = (a, b) => { try { g(['merge-base', '--is-ancestor', a, b], old); return true; } catch { return false; } };
    let n = 0;
    // a new line in run/log for the sync to carry, and its title to find on chore-log
    const newLine = () => { const title = `line ${++n}`; ok(old, ['problem', 'add', '--title', title, '--severity', '1'], SUP); return title; };
    const landed = (title) => { try { return g([`--git-dir=${F.org}`, 'grep', '-l', '-F', `"title":"${title}"`, 'refs/heads/chore-log'], old) !== ''; } catch { return false; } };
    const sync = () => F.run(old, ['log-sync'], S.env);
    // a commit on origin's chore-log that this checkout hasn't fetched
    const moveOrigin = () => {
      const tip = onOrigin();
      const sha = g([`--git-dir=${F.org}`, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', `${tip}^{tree}`, '-p', tip, '-m', 'elsewhere'], old);
      g([`--git-dir=${F.org}`, 'update-ref', 'refs/heads/chore-log', sha], old);
      return sha;
    };
    // each step starts with origin/chore-log fetched (whatever the one before left) and ends disarmed
    const step = (name, fn) => t.test(name, async () => {
      try {
        g(['fetch', '-q', 'origin', '+refs/heads/chore-log:refs/remotes/origin/chore-log'], old);
        await fn();
      } finally { S.disarm(); }
    });

    newLine();
    const first = sync();
    assert.equal(first.status, 0, first.err);
    assert.ok(onOrigin() && onOrigin() === tracked(), 'chore-log is on origin and fetched');

    await step('L1: a fetch refused once, origin\'s chore-log where it was: the sync goes on from it, a fast-forward', () => {
      const was = tracked();
      const title = newLine();
      S.arm([{ match: FETCH, says: REFUSED, times: 1 }]);
      const r = sync();
      assert.equal(r.status, 0, `L1: ${r.err}`);
      assert.deepEqual(S.codes(), ['128'], 'L1: the fetch was refused');
      assert.ok(isAncestor(was, onOrigin()), 'L1: origin\'s chore-log moved by a fast-forward');
      assert.ok(landed(title), 'L1: the new line landed');
      assert.match(r.err, /couldn't fetch chore-log from origin \(fatal: unable to access origin: Connection refused\); origin's is still at [0-9a-f]{7,}/, 'L1: says why');
    });

    await step('L2: a fetch past a sibling\'s half-made worktree entry: fetched again, a fast-forward', () => {
      const was = tracked();
      const title = newLine();
      S.arm([{ match: FETCH, half: true }]);
      const r = sync();
      assert.equal(r.status, 0, `L2: ${r.err}`);
      assert.deepEqual(S.codes(), ['1', '0'], 'L2: fetched again once the entry was whole');
      assert.ok(isAncestor(was, onOrigin()), 'L2: a fast-forward');
      assert.ok(landed(title), 'L2: the new line landed');
    });

    await step('L3: a fetch refused, origin\'s chore-log moved: stops, saying why, the ref kept; the next sync is a fast-forward', () => {
      const was = tracked();
      const moved = moveOrigin();
      const title = newLine();
      S.arm([{ match: FETCH, says: REFUSED, times: 1 }]);
      const r = sync();
      assert.notEqual(r.status, 0, 'L3: no sync');
      assert.match(r.err, /couldn't fetch chore-log from origin \(fatal: unable to access origin: Connection refused\), and origin's is at [0-9a-f]{7,}, not [0-9a-f]{7,}: kept origin\/chore-log and synced nothing; run log-sync again/, 'L3: says why');
      // the stop itself, never a warning the sync goes on past (to a push git refuses)
      assert.match(r.err, /^devteam: couldn't fetch chore-log/m, 'L3: a stop, not a warning');
      assert.doesNotMatch(r.err, /git push|\[rejected\]/, 'L3: no push tried');
      assert.equal(tracked(), was, 'L3: origin/chore-log kept');
      assert.equal(onOrigin(), moved, 'L3: nothing pushed');
      S.disarm();
      const next = sync();
      assert.equal(next.status, 0, `L3 next: ${next.err}`);
      assert.ok(isAncestor(moved, onOrigin()), 'L3: the next push is a fast-forward');
      assert.ok(landed(title), 'L3: the line landed on the next sync');
    });

    await step('L4: origin unreachable (fetch and ls-remote refused): stops, saying why, the ref kept', () => {
      const was = tracked();
      newLine();
      S.arm([{ match: FETCH, says: REFUSED }, { match: ASK, says: REFUSED }]);
      const r = sync();
      assert.notEqual(r.status, 0, 'L4: no sync');
      assert.match(r.err, /couldn't fetch chore-log from origin \(fatal: unable to access origin: Connection refused\) or ask origin for it \(fatal: unable to access origin: Connection refused\): kept origin\/chore-log and synced nothing; run log-sync again/, 'L4: says why');
      // the stop itself, never a warning the sync goes on past (to a push git refuses)
      assert.match(r.err, /^devteam: couldn't fetch chore-log/m, 'L4: a stop, not a warning');
      assert.doesNotMatch(r.err, /git push|\[rejected\]/, 'L4: no push tried');
      assert.equal(tracked(), was, 'L4: origin/chore-log kept');
      assert.equal(onOrigin(), was, 'L4: nothing pushed');
    });

    await step('L5: chore-log deleted on the forge: the stale copy is dropped and the sync starts from main', () => {
      const stale = tracked();
      g([`--git-dir=${F.org}`, 'update-ref', '-d', 'refs/heads/chore-log'], old);
      const title = newLine();
      const r = sync();
      assert.equal(r.status, 0, `L5: ${r.err}`);
      assert.ok(onOrigin(), 'L5: chore-log pushed again');
      assert.ok(!isAncestor(stale, onOrigin()), 'L5: started from main, not the stale copy');
      assert.ok(isAncestor(g(['rev-parse', 'origin/main'], old), onOrigin()), 'L5: on main');
      assert.ok(landed(title), 'L5: the new line landed');
    });
  } finally { F.done(); }
});
