// kit-211: the edits made to the split files after split.mjs, as exact replacements (each must match
// once, or exactly the count given as a fourth element). Re-runnable on a fresh split: node edits.mjs <name>
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
  'pane-question': [
    ['test/lib/pane-question-fixture.mjs', `
export { heldDirOf, heldFor, logLines, menuPane, nap };`, `
// A test's stops, run last-registered first, each on its own: a removal registered first runs
// after every stop, and one stop that throws skips none of the others (node runs t.after hooks in
// the order they were registered and stops at the first that throws). The first error is thrown
// once all have run.
function cleanup(t) {
  const fns = [];
  t.after(async () => {
    let first = null;
    for (const f of fns.reverse()) { try { await f(); } catch (e) { first ??= e; } }
    if (first) throw first;
  });
  return (f) => { fns.push(f); };
}

export { cleanup, heldDirOf, heldFor, logLines, menuPane, nap };`],
    ['test/pane-question.held.test.mjs', `  t.after(() => F.done());`, `  const later = cleanup(t);
  later(() => F.done());`, 4],
    ['test/pane-question.held.test.mjs', `  t.after(() => live.kill());`, `  later(() => live.kill());`],
    ['test/pane-question.held.test.mjs', `import { heldDirOf, heldFor, logLines, menuPane, nap } from './lib/pane-question-fixture.mjs';`, `import { cleanup, heldDirOf, heldFor, logLines, menuPane, nap } from './lib/pane-question-fixture.mjs';`],
    ['test/pane-question.answer.test.mjs', `async function dash(t, F, pane, env = {}) {`, `async function dash(later, F, pane, env = {}) {`],
    ['test/pane-question.answer.test.mjs', `  t.after(() => d.stop());`, `  later(() => d.stop());`],
    ['test/pane-question.answer.test.mjs', `  t.after(() => F.done());`, `  const later = cleanup(t);
  later(() => F.done());`, 6],
    ['test/pane-question.answer.test.mjs', `await dash(t, F, pane`, `await dash(later, F, pane`, 6],
    ['test/pane-question.answer.test.mjs', `  t.after(() => chrome.close());`, `  later(() => chrome.close());`],
    ['test/pane-question.answer.test.mjs', `import { heldFor, logLines, menuPane } from './lib/pane-question-fixture.mjs';`, `import { cleanup, heldFor, logLines, menuPane } from './lib/pane-question-fixture.mjs';`],
  ],
  'operator-threads': [
    ['test/lib/operator-threads-fixture.mjs', `
export { agentProgram,`, `
// A test's stops, run last-registered first, each on its own: a removal registered first runs
// after every stop, and one stop that throws skips none of the others (node runs t.after hooks in
// the order they were registered and stops at the first that throws). The first error is thrown
// once all have run.
function cleanup(t) {
  const fns = [];
  t.after(async () => {
    let first = null;
    for (const f of fns.reverse()) { try { await f(); } catch (e) { first ??= e; } }
    if (first) throw first;
  });
  return (f) => { fns.push(f); };
}

export { agentProgram,`],
    ['test/lib/operator-threads-fixture.mjs', ` box, GW_PUBLIC, KIT,`, ` box, cleanup, GW_PUBLIC, KIT,`],
    ['test/operator-threads.hub.test.mjs', `async function hubFixture(t, name, { box: boxed = false } = {}) {`, `async function hubFixture(later, name, { box: boxed = false } = {}) {`],
    ['test/operator-threads.hub.test.mjs', `  t.after(async () => { await dash.stop(); tmuxSh(['kill-session', '-t', \`=devteam-home-\${HUB}\`]); });`, `  later(() => dash.stop());
  later(() => tmuxSh(['kill-session', '-t', \`=devteam-home-\${HUB}\`]));`],
    ['test/operator-threads.hub.test.mjs', `= await hubFixture(t, `, `= await hubFixture(later, `, 3],
    ['test/operator-threads.hub.test.mjs', `  const F = await hubFixture(later, 'routes');`, `  const later = cleanup(t);
  const F = await hubFixture(later, 'routes');`],
    ['test/operator-threads.hub.test.mjs', `  const F = await hubFixture(later, 'boxroutes', { box: true });`, `  const later = cleanup(t);
  const F = await hubFixture(later, 'boxroutes', { box: true });`],
    ['test/operator-threads.hub.test.mjs', `  const F = await hubFixture(later, 'chrome');`, `  const later = cleanup(t);
  const F = await hubFixture(later, 'chrome');`],
    ['test/operator-threads.hub.test.mjs', `  t.after(() => chrome.close());`, `  later(() => chrome.close());`],
    ['test/operator-threads.hub.test.mjs', `  t.after(() => p.close());`, `  later(() => p.close());`],
    ['test/operator-threads.hub.test.mjs', `  t.after(() => fs.rmSync(imageKit, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));`, `  const later = cleanup(t);
  later(() => fs.rmSync(imageKit, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));`],
    ['test/operator-threads.hub.test.mjs', `  t.after(() => a.kill());`, `  later(() => a.kill());`],
    ['test/operator-threads.hub.test.mjs', `  t.after(() => (hub.exitCode === null`, `  later(() => (hub.exitCode === null`],
    ['test/operator-threads.hub.test.mjs', `import { agentProgram, box, GW_PUBLIC, machine,`, `import { agentProgram, box, cleanup, GW_PUBLIC, machine,`],
  ],
};

const [name] = process.argv.slice(2);
for (const [f, from, to, count = 1] of E[name] ?? []) {
  const s = fs.readFileSync(f, 'utf8');
  const n = s.split(from).length - 1;
  if (n !== count) { console.error(`${f}: ${n} matches for ${JSON.stringify(from.slice(0, 80))}, want ${count}`); process.exit(1); }
  fs.writeFileSync(f, s.split(from).join(to));
}
console.log(`${name}: ${(E[name] ?? []).length} edits`);
