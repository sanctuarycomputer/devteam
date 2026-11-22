// A secret posted to a SOPS file finds the repo's age key wherever the repo keeps it, and only that key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, write } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
// A sops that opens a file only with the key marked GOOD, and says which key wrote it.
const STUB = `#!/bin/sh
k=$SOPS_AGE_KEY_FILE
case "$1" in
  -d) [ -n "$k" ] && grep -q GOOD "$k" ;;
  set) if [ -n "$k" ] && grep -q GOOD "$k"; then cat > /dev/null; echo "written with $(basename "$k")" >> "$3"; else echo "failed to load age identities; no master key" >&2; exit 1; fi ;;
esac
`;

test('sops secrets: the key that opens the file is found in the gitignored main checkout, whichever others are there', () => {
  const F = fleetFixture('sops-key');
  const { old, ok, run, g, base } = F;
  try {
    const bin = path.join(base, 'sops-bin');
    write(path.join(bin, 'sops'), STUB);
    fs.chmodSync(path.join(bin, 'sops'), 0o755);
    const PATHED = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    write(path.join(old, 'secrets/app.enc.env'), 'enc\n');
    fs.appendFileSync(path.join(old, '.gitignore'), 'secrets/*.dec\n');
    g(['add', '-A', 'secrets', '.gitignore'], old);
    g(['commit', '-qm', 'store'], old);
    g(['push', '-q', 'origin', 'main'], old);
    const q = ok(old, ['ask', '--kind', 'owner-action', '--question', 'Post the key', '--secrets', JSON.stringify([{ name: 'KEY', sink: 'sops:secrets/app.enc.env:KEY' }])], SUP);
    const post = () => run(old, ['secret', 'post', q, '--json'], PATHED, JSON.stringify({ KEY: 'the-value-9' }));

    // no key anywhere: refused, saying where it looked
    write(path.join(old, 'secrets/other-age-key.dec'), '# another repo\nAGE-SECRET-KEY-WRONG\n');
    const none = post();
    assert.notEqual(none.status, 0);
    assert.match(none.out + none.err, /no age key on this machine opens secrets\/app\.enc\.env/);
    assert.doesNotMatch(none.out + none.err, /the-value-9|AGE-SECRET-KEY/);

    // the right key beside a wrong one, and a file that only has the name
    write(path.join(old, 'secrets/not-a-sops-key.dec'), 'GOOD but no key in it\n');
    write(path.join(old, 'secrets/sops-age-key.dec'), '# this repo\nAGE-SECRET-KEY-GOOD\n');
    const done = post();
    assert.equal(done.status, 0, done.err);
    assert.doesNotMatch(done.out + done.err, /the-value-9|AGE-SECRET-KEY/);
    const w = fs.readdirSync(path.join(old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    assert.match(fs.readFileSync(path.join(old, '.worktrees', w, 'secrets/app.enc.env'), 'utf8'), /written with sops-age-key\.dec/);
  } finally { F.done(); }
});
