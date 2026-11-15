// kit-211: the edits made to the split files after split.mjs, as exact replacements (each must match
// once). Re-runnable on a fresh split: node edits.mjs <name>
import fs from 'node:fs';

const E = {
  machine: [
    ['test/machine.run-folder.test.mjs', `// runs that test in minutes, hence the wait.)
`, `// runs that test in minutes, hence the wait.) It lives in machine.status.test.mjs, which loads only
// what its own tests need.
`],
    ['test/machine.run-folder.test.mjs', `'status says at a glance', 'test/machine.test.mjs']`, `'status says at a glance', 'test/machine.status.test.mjs']`],
    ['test/machine.status.test.mjs', `    assert.match(status().stdout, new RegExp(\`^machine: daily review done \${today}$\`, 'm'));
    assert.match(status().stdout, /^statused .* new-knowledge=1$/m);
`, `    // one reading for both: nothing changes between them
    const done = status();
    assert.match(done.stdout, new RegExp(\`^machine: daily review done \${today}$\`, 'm'));
    assert.match(done.stdout, /^statused .* new-knowledge=1$/m);
`],
    ['test/machine.status.test.mjs', `    fs.writeFileSync(latestRelease, 'v0.1.0\\n');
    const st3 = status();
    assert.match(st3.stdout, /^statused .*dash=9\\/DOWN/m);
    assert.doesNotMatch(st3.stdout, /behind=/);
    machine(['machine', 'alert', '--', 'look at the disk']);
    assert.match(status().stdout, /^machine: hub \\d+ DOWN; alert: look at the disk$/m);
`, `    fs.writeFileSync(latestRelease, 'v0.1.0\\n');
    // and an alert raised: one reading says all three (the alert is on the hub's line, not the repo's)
    machine(['machine', 'alert', '--', 'look at the disk']);
    const st3 = status();
    assert.match(st3.stdout, /^statused .*dash=9\\/DOWN/m);
    assert.doesNotMatch(st3.stdout, /behind=/);
    assert.match(st3.stdout, /^machine: hub \\d+ DOWN; alert: look at the disk$/m);
`],
    ['test/machine.hub-records.test.mjs', `      // a tick child started just before the stop finishes on its own
      await new Promise((res) => setTimeout(res, 1500));
`, `      // a tick child started just before the stop finishes on its own: wait until none runs
      const tick = \`\${path.join(r, 'docs/devteam/scripts/devteam.mjs')} accounts-tick\`;
      await until(() => !spawnSync('ps', ['-A', '-ww', '-o', 'args='], { encoding: 'utf8' }).stdout.split('\\n').some((l) => l.includes(tick)), 'its last tick child to finish');
`],
    ['test/machine.hub-records.test.mjs', `import { spawn } from 'node:child_process';`, `import { spawn, spawnSync } from 'node:child_process';`],
    ['test/machine.box.test.mjs', `    await new Promise((r) => setTimeout(r, 1100));
    // made after home, so it is the session tmux reads a bare name in
`, `    // the next second, so the next session's session_created is later than home's
    const created = Number(tmuxSh(['display-message', '-p', '-t', '=home:', '#{session_created}']).stdout.trim());
    assert.ok(created > 0, 'home\\'s session_created');
    await until(() => Math.floor(Date.now() / 1000) > created, 'the second after home was made');
    // made after home, so it is the session tmux reads a bare name in
`],
  ],
  recovery: [
    ['test/recovery.relaunch.test.mjs', `    F.ensureSession();
    sleepMs(1100);
    const now = new Date().toISOString();
`, `    F.ensureSession();
    // the launch a second after the session was made
    const made = Number(spawnSync('tmux', ['display-message', '-p', '-t', \`=\${F.session}:\`, '#{session_created}'], { encoding: 'utf8' }).stdout.trim());
    assert.ok(made > 0, 'the session\\'s session_created');
    await until(() => Math.floor(Date.now() / 1000) > made, 'the second after the session was made');
    const now = new Date().toISOString();
`],
    ['test/recovery.relaunch.test.mjs', `    F.killSession();
    sleepMs(1100);
    F.ensureSession();
`, `    F.killSession();
    // and a session made a second after the launch
    await until(() => Math.floor(Date.now() / 1000) > Math.floor(Date.parse(now) / 1000), 'the second after the launch');
    F.ensureSession();
`],
    ['test/recovery.relaunch.test.mjs', `    execFileSync('tmux', ['respawn-pane', '-k', '-t', \`=\${F.session}:demo-30-y\`, STUB_SHELL]);
    sleepMs(200);
`, `    execFileSync('tmux', ['respawn-pane', '-k', '-t', \`=\${F.session}:demo-30-y\`, STUB_SHELL]);
    // a shell the kit knows (the stub shell execs /bin/sh -i): not node, and not the stub's own name
    await until(() => /^-?(sh|bash|dash|zsh)$/.test((spawnSync('tmux', ['display-message', '-p', '-t', \`=\${F.session}:demo-30-y\`, '#{pane_current_command}'], { encoding: 'utf8' }).stdout ?? '').trim()), 'a shell in its pane, the agent gone');
`],
  ],
};

const [name] = process.argv.slice(2);
for (const [f, from, to] of E[name] ?? []) {
  const s = fs.readFileSync(f, 'utf8');
  const n = s.split(from).length - 1;
  if (n !== 1) { console.error(`${f}: ${n} matches for ${JSON.stringify(from.slice(0, 80))}`); process.exit(1); }
  fs.writeFileSync(f, s.replace(from, () => to));
}
console.log(`${name}: ${(E[name] ?? []).length} edits`);
