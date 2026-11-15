// What a pane is at, machine tell into a supervisor, and status finding projects and the hub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { hasTmux, until, write } from './lib/kit.mjs';
import { agent, baseEnv, box, code, home, KIT, machine, nowhere, prompt, repo, rule, shown, tmp, tmuxSh } from './lib/machine-fixture.mjs';

const paneState = (pane) => machine(['machine', 'pane-state', pane]).stdout.trim();

test('what a pane is at, from what is on it', { skip: !hasTmux }, async () => {
  const at = async (screen, want, why) => { const a = agent({ screens: [screen] }); await shown(a.pane, screen.replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()).replace(/ /g, ' ').trim().slice(0, 12)); assert.equal(paneState(a.pane), want, why); a.kill(); };
  await at(box(`\x1b[38;5;246m${prompt}\x1b[39m`), 'ready', 'an empty input, with the real non-breaking space');
  await at(box(`\x1b[39m${prompt}\x1b[2mcopy the .env.local files\x1b[0m`), 'ready', 'a dim suggestion is the harness\'s, not typing');
  await at(box(`${prompt}fix the `), 'typing', 'text in the input box is someone\'s');
  await at(box(`${prompt}fix the \x1b[2mbug\x1b[0m`), 'typing', 'typed text with a suggestion after it is still typing');
  await at('Do you trust the files in this folder?\n❯ 1. Yes, I trust\n', 'dialog');
  await at('Quick safety check: Is this a project you created or one you trust?\n ❯ Yes, I trust this folder\n   No, exit\n', 'dialog', 'the real trust dialog');
  await at(`Do you want to proceed?\n❯ 1. Yes\n  2. No\n${rule}\n`, 'dialog', 'a menu is a dialog, however it is drawn');
  await at(`You've hit your limit · resets 3pm\n${box(prompt)}`, 'limit', 'the banner the kit knows');
  await at(`Claude usage limit reached\n${box(prompt)}`, 'limit');
  await at(`5-hour limit reached ∙ resets 9am\n${box(prompt)}`, 'limit');
  // what the agent wrote about, never its own UI: none of these may hold a tick
  await at(`The stacks supervisor's usage limit reached its reset.\n${box(prompt)}`, 'ready', 'prose naming a limit');
  await at(`> You've hit your limit · resets 3pm\n${box(prompt)}`, 'ready', 'a quoted banner');
  await at(`Do you want to run the migration next?\n${box(prompt)}`, 'ready', 'a question it asked, with its input box up');
  await at(`Press Enter to continue is what the dialog says.\n${box(prompt)}`, 'ready');
  await at(`✢ Thinking… (esc to interrupt)\n${box(prompt)}`, 'busy');
  await at('a screen with no input box', 'unknown');
  // with no input box drawn, a dialog's words count only where the harness puts them
  await at('I asked whether do you want to keep it is right', 'unknown', 'prose mid-line is not a dialog');
  await at('the [y/n] prompts are in the docs', 'unknown', 'nor a y/n that isn\'t at the end');
  await at('Overwrite config/master.key? [y/n] ', 'dialog');
  await at('Press Enter to continue…', 'dialog');
  const sh = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', '=keep:', '-n', 'a-shell']).stdout.trim();
  await until(() => paneState(sh) === 'shell', 'a shell');
  const other = tmuxSh(['new-window', '-dP', '-F', '#{pane_id}', '-t', '=keep:', '-n', 'other', 'exec sleep 3600']).stdout.trim();
  assert.equal(paneState(other), 'other', 'never type into vim, psql or any other program');
  tmuxSh(['kill-pane', '-t', other]);
  tmuxSh(['kill-pane', '-t', sh]);
  assert.equal(paneState(other), 'gone');
  assert.equal(machine(['machine', 'pane-state']).status, 2);
});

test('tell types into a supervisor, marked as not the owner, and only when its pane can take it', { skip: !hasTmux }, async () => {
  const r = repo('tellable');
  const told = (args = ['hello'], env = {}) => machine(['machine', 'tell', '--in', code, '--', 'tellable', ...args], env);
  const sup = agent({ screens: [box(prompt)], cwd: r, window: 'sup-tellable' });
  await shown(sup.pane, 'status');
  const ok = told(['disk is low\non this box', '--force']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`^tellable: told \\(pane ${sup.pane}\\)`));
  await until(() => sup.keys().includes('\r'), 'the Enter');
  assert.equal(sup.keys(), "From the operator (information, not an owner answer; record nothing as the owner's from this): disk is low on this box --force\r", 'one line, prefixed, its words whatever they start with');
  // never into the pane this runs in, and never from a session in a fleet
  assert.match(told(['hi'], { TMUX_PANE: sup.pane }).stdout, /not told: no supervisor is up in its root/);
  for (const role of ['supervisor', 'worker', 'planner']) { const x = told(['hi'], { DEVTEAM_ROLE: role }); assert.notEqual(x.status, 0, role); assert.match(x.stderr, /the operator's or the owner's/, role); }
  assert.equal(told(['hi'], { DEVTEAM_ROLE: 'operator' }).status, 0, 'the operator\'s own');
  assert.equal(sup.keys().split('\r').length, 3, 'nothing typed for those refused');
  sup.kill();

  const typing = agent({ screens: [box(`${prompt}half a thou`)], cwd: r, window: 'sup-tellable' });
  await shown(typing.pane, 'half a thou');
  const busyInput = told();
  assert.equal(busyInput.status, 3);
  assert.match(busyInput.stdout, /not told: its pane is at typing/);
  assert.equal(typing.keys(), '', 'nothing typed over someone\'s line');
  typing.kill();

  // a lost Enter: the line is still in the input, one more Enter takes it
  const lost = agent({ screens: [box(prompt), box(`${prompt}From the operator (information`), box(prompt)], cwd: r, window: 'sup-tellable' });
  await shown(lost.pane, 'status');
  assert.match(told().stdout, /told \(pane/);
  assert.equal(lost.keys().split('\r').length - 1, 2, 'one more Enter, and only one');
  lost.kill();
  // still there after that: said, never reported as told
  const stuck = agent({ screens: [box(prompt), box(`${prompt}From the operator (information`)], cwd: r, window: 'sup-tellable' });
  await shown(stuck.pane, 'status');
  const notDelivered = told();
  assert.equal(notDelivered.status, 3);
  assert.match(notDelivered.stdout, /not delivered: the message is still in its input/);
  assert.equal(stuck.keys().split('\r').length - 1, 3, 'pressed three times in all before saying so');
  stuck.kill();

  // the operator's window, the owner's shell window, and a pane started elsewhere are never it
  for (const [window, cwd] of [['operator', r], ['shell', r], ['sup-tellable', path.join(tmp, 'elsewhere')]]) {
    fs.mkdirSync(cwd, { recursive: true });
    const a = agent({ screens: [box(prompt)], cwd, window });
    await shown(a.pane, 'status');
    const x = told();
    assert.equal(x.status, 3, window);
    assert.match(x.stdout, /no supervisor is up in its root/, window);
    assert.equal(a.keys(), '', window);
    a.kill();
  }
  const dialog = agent({ screens: ['Do you want to proceed?\n❯ 1. Yes\n'], cwd: r, window: 'sup-tellable' });
  await shown(dialog.pane, 'proceed');
  assert.match(told().stdout, /not told: its pane is at dialog/);
  assert.equal(dialog.keys(), '');
  dialog.kill();
  const nobody = told();
  assert.equal(nobody.status, 3);
  assert.match(nobody.stdout, /no supervisor is up/);
  assert.equal(machine(['machine', 'tell', '--in', code, '--', 'not-here', 'hello']).status, 1);
  assert.equal(machine(['machine', 'tell', '--in', code, '--', '../etc', 'hello']).status, 2, 'a repo is a name, never a path');
  assert.equal(machine(['machine', 'tell', '--in', code, '--', 'tellable']).status, 2, 'no message');
});

test('tell and status find a project the machine recorded, outside any --in folder', { skip: !hasTmux }, async () => {
  const away = path.join(tmp, 'elsewhere-projects');
  const r = repo('recorded', { dir: away });
  // what a dashboard's tick or the supervisor's own command leaves (registerOnMachine)
  write(path.join(home, '.devteam', `repos-${process.env.DEVTEAM_HUB_PORT}`, 'recorded.json'), JSON.stringify({ root: r, at: new Date().toISOString() }));
  const sup = agent({ screens: [box(prompt)], cwd: r, window: 'sup-recorded' });
  try {
    await shown(sup.pane, 'status');
    const x = machine(['machine', 'tell', 'recorded', 'hello']);
    assert.equal(x.status, 0, x.stdout + x.stderr);
    assert.match(machine(['machine', 'status']).stdout, new RegExp(`^recorded sup=up .* pane=${sup.pane} state=ready`, 'm'));
  } finally { sup.kill(); fs.rmSync(path.join(home, '.devteam', `repos-${process.env.DEVTEAM_HUB_PORT}`, 'recorded.json')); }
});

// The hub line names the release serving the hub, from its list: the image's own, a project kit's,
// one too old to say, something that isn't a hub, or nothing at all. Run without blocking this
// process, whose event loop serves the stand-in hub.
test('status names the hub\'s kit, or says it is no hub, or down', async () => {
  const port = Number(process.env.DEVTEAM_HUB_PORT);
  const env = { ...baseEnv };
  for (const k of ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS']) delete env[k];
  const empty = fs.mkdtempSync(path.join(tmp, 'no-repos-'));
  const hubLineOf = () => new Promise((resolve) => execFile(process.execPath, [KIT, 'machine', 'status', '--in', empty], { cwd: nowhere, encoding: 'utf8', env }, (err, stdout) => resolve(stdout.split('\n').find((l) => l.startsWith('machine: hub ')))));
  let body = '';
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url === '/instances.json' ? body : 'not found'); });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  let open = true;
  try {
    const cases = [
      [{ hub: 1, kit: 'v1.2.3', image: true, instances: [] }, 'up, kit v1.2.3 (image)'],
      [{ hub: 1, kit: 'v1.2.3', instances: [] }, 'up, kit v1.2.3'],
      [{ hub: 1, instances: [] }, 'up, kit ?'],
      [{ hub: 1, kit: null, instances: [] }, 'up, kit ?'],
      [{ hub: 1, kit: '\u001b[31mx', instances: [] }, 'up, kit ?'],
      [{ hub: 1, kit: 'v'.repeat(10240), instances: [] }, 'up, kit ?'],
      ['ok', 'up, not a hub'],
      [{ hub: 1, kit: 'v1.2.3', instances: [], pad: 'x'.repeat(70 * 1024) }, 'up, not a hub'],
    ];
    for (const [b, want] of cases) {
      body = typeof b === 'string' ? b : JSON.stringify(b);
      assert.equal(await hubLineOf(), `machine: hub ${port} ${want}`, body.slice(0, 80));
    }
    // something on the port that answers and never finishes, a byte at a time: status still ends,
    // within its 3 s, and says it isn't a hub
    const drip = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); const i = setInterval(() => res.write(' '), 1000); res.on('close', () => clearInterval(i)); });
    await new Promise((r) => srv.close(r));
    await new Promise((r) => drip.listen(port, '127.0.0.1', r));
    const started = Date.now();
    try { assert.equal(await hubLineOf(), `machine: hub ${port} up, not a hub`); } finally { drip.closeAllConnections?.(); await new Promise((r) => drip.close(r)); }
    assert.ok(Date.now() - started < 8000, `status waited ${Date.now() - started} ms on a server that drips`);
    await new Promise((r) => srv.listen(port, '127.0.0.1', r));
    body = JSON.stringify({ hub: 1, kit: 'v1.2.3', instances: [] });
    machine(['machine', 'alert', '--', 'look']);
    assert.equal(await hubLineOf(), `machine: hub ${port} up, kit v1.2.3; alert: look`, 'the alert suffix as it was');
    machine(['machine', 'alert', '--', '--clear']);
    await new Promise((r) => srv.close(r));
    open = false;
    assert.equal(await hubLineOf(), `machine: hub ${port} DOWN`);
  } finally {
    machine(['machine', 'alert', '--', '--clear']);
    if (open) srv.close();
  }
});
