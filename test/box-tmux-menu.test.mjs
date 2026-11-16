// box-tmux-menu, the ☰ menu on the box's terminal, run from cloud/Dockerfile against a stub tmux:
// it fits the client's height, acts on the tapping client's pane, and shows any window name as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const script = () => {
  const df = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8');
  const start = df.indexOf("COPY --chmod=755 <<'EOF' /usr/local/bin/box-tmux-menu\n");
  assert.ok(start >= 0, 'the Dockerfile writes box-tmux-menu');
  const body = df.slice(df.indexOf('\n', start) + 1);
  return body.slice(0, body.indexOf('\nEOF\n') + 1);
};

// run the menu with a stub tmux that answers list-windows from `windows` and records the menu
function menu(windows, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-menu-'));
  try {
    fs.writeFileSync(path.join(dir, 'box-tmux-menu'), script(), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'windows'), windows.map((w) => w.join('\t')).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'tmux'), `#!/bin/sh
case "$1" in
  list-windows) cat "${dir}/windows" ;;
  display-message) case "$*" in *client_height*) echo ${height} ;; *pane_id*) echo %7 ;; esac ;;
  display-menu) for a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/menu" ;;
esac
`, { mode: 0o755 });
    execFileSync(path.join(dir, 'box-tmux-menu'), ['/dev/pts/3'], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    return fs.readFileSync(path.join(dir, 'menu'), 'utf8').split('\n').slice(0, -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// the menu's items: label, key, command triples after the fixed arguments, and separators ("")
const items = (args) => {
  const out = [];
  let i = args.indexOf('S') + 1;
  while (i < args.length) {
    if (args[i] === '') { out.push(''); i += 1; } else { out.push(args[i]); i += 3; }
  }
  return out;
};

test('box-tmux-menu: acts on the tapping client\'s pane, and shows a hostile window name as text', () => {
  const args = menu([
    ['home', '0', 'operator', '@1'],
    ['home', '1', '-dash', '@2'],
    ['home', '2', '', '@3'],
    ['home', '3', 'x#(id)y', '@4'],
    ['devteam-stacks-a1b2c3', '0', 'dashboard', '@5'],
    ['devteam-stacks-a1b2c3', '1', 'stacks-12-invoices', '@6'],
  ], 40);
  assert.deepEqual(args.slice(0, 5), ['display-menu', '-c', '/dev/pts/3', '-t', '%7'], 'the scroll items act on this client\'s pane');
  const labels = items(args);
  assert.ok(labels.includes(' -dash'), 'a leading - is not a disabled item');
  assert.ok(labels.includes('x##(id)y'), 'a # is shown literally, never expanded');
  assert.ok(!args.includes('@3') && !args.some((a) => a.includes("'@3'")), 'an empty name is skipped');
  assert.ok(labels.includes('-#[align=centre]stacks'), 'each project under its name');
  assert.ok(labels.includes('stacks-12-invoices'));
  assert.ok(!labels.includes('dashboard'));
});

test('box-tmux-menu: on a short screen it fits, keeping the home windows and each supervisor', () => {
  const windows = [['home', '0', 'operator', '@1'], ['home', '1', 'shell', '@2']];
  let n = 10;
  for (const p of ['devteam-stacks-a1b2c3', 'devteam-website-d4e5f6', 'devteam-stacksbot-0a0b0c']) {
    windows.push([p, '0', `sup-${p.split('-')[1]}`, `@${n++}`]);
    for (let w = 1; w <= 12; w++) windows.push([p, String(w), `ticket-${w}`, `@${n++}`]);
  }
  const height = 20;
  const args = menu(windows, height);
  const rows = items(args).length;
  assert.ok(rows + 2 <= height, `${rows} rows fit a ${height}-row client`);
  const labels = items(args);
  assert.ok(labels.includes('operator') && labels.includes('shell'));
  for (const s of ['stacks', 'website', 'stacksbot']) assert.ok(labels.includes(`* ${s}`), `${s}'s supervisor is there`);
  assert.ok(!labels.includes('ticket-1'), 'agents give way on a short screen');
  // a tall screen lists them all
  assert.ok(items(menu(windows, 80)).includes('ticket-12'));
});
