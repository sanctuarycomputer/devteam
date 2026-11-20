// The owner answers a pane's question from the dashboard's card: where Esc must never reach (split
// from test/pane-question.answer.test.mjs, kit-223, so each file stays inside CI's watchdog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, threadsFixture, until } from './lib/kit.mjs';
import { acts, cleanup, dash, esc, menuPane } from './lib/pane-question-fixture.mjs';

// A numbered menu whose Esc doesn't say it cancels (it exits, as a folder-trust form's does, or quits,
// or the menu names no Esc at all): drawn here, a stand-in that only writes down what it is sent.
function exitMenuPane(F, hint = 'Enter to confirm · Esc to exit') {
  const dir = fs.mkdtempSync(path.join(F.base, 'exit-'));
  const keys = path.join(dir, 'keys.txt');
  fs.writeFileSync(path.join(dir, 'agent.mjs'), `import fs from 'node:fs';
const draw = () => process.stdout.write('\\x1b[2J\\x1b[H' + ['stand-in supervisor', '─'.repeat(100), ' Do you trust the files in this folder?', '', ' ❯ 1. Yes, proceed', '   2. No, exit', '', ' ' + ${JSON.stringify(hint)}].join('\\n') + '\\n');
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => { fs.appendFileSync(${JSON.stringify(keys)}, String(d)); draw(); });
draw();
`);
  const s = `exit-${path.basename(dir).slice(5)}`;
  spawnSync('tmux', ['new-session', '-d', '-x', '120', '-y', '40', '-s', s, '-n', 'main', '-c', F.old, `${process.execPath} ${path.join(dir, 'agent.mjs')}`], { env: F.env() });
  return { target: `${s}:main`, key: `${s}:main`, typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : '') };
}

test('Esc never reaches the usage-limit menu, a dialog with no numbers, or a numbered menu whose Esc exits (part 1 of 2)', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-esc-not');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F, 'menu,limit,trust,input');
  const D = await dash(later, F, pane);
  const q = await D.question();
  // the card was a menu's; the terminal moved on to the usage-limit menu
  pane.press('1');
  const lim = await until(async () => { const x = await D.asked(); return x?.kind === 'limit' ? x : null; }, 'the usage-limit menu');
  assert.equal(lim.token, undefined, 'no token for it');
  assert.equal((await D.post({ digest: lim.digest, escape: true, token: 'f'.repeat(64) })).status, 403);
  let r = await D.post(esc(q));
  assert.equal(r.status, 400, 'a stale card');
  assert.equal(pane.typed(), '1', 'no Escape reached the usage-limit menu');
  pane.press('Enter');
  const d = await until(async () => { const x = await D.asked(); return x?.kind === 'dialog' ? x : null; }, 'the dialog');
  assert.equal(d.token, undefined);
  assert.equal((await D.post({ digest: d.digest, escape: true, token: 'f'.repeat(64) })).status, 403);
  assert.equal(pane.typed(), '1\r', 'nor the dialog');
  assert.equal(acts(F).length, 0);
});

test('Esc never reaches the usage-limit menu, a dialog with no numbers, or a numbered menu whose Esc exits (part 2 of 2)', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const later = cleanup(t);
  let r;
  // a numbered menu, with a token, whose Esc exits or quits, or that names no Esc: refused before any key
  for (const [i, hint] of ['Enter to confirm · Esc to exit', 'Esc to cancel · Esc to quit', 'Enter to confirm'].entries()) {
    const G = threadsFixture(`pane-esc-exit-${i}`);
    later(() => G.done());
    const ex = exitMenuPane(G, hint);
    const E = await dash(later, G, ex);
    const m = await E.question();
    assert.equal(m.hint, hint);
    assert.match(m.token, /^[0-9a-f]{64}$/, 'an option may answer it');
    r = await E.post(esc(m));
    assert.equal(r.status, 400, `${hint}: ${await r.clone().text()}`);
    assert.match((await r.json()).error, /Esc here may not cancel/);
    assert.equal(ex.typed(), '', `no Escape sent (${hint})`);
    assert.equal(acts(G).length, 0);
  }
});
