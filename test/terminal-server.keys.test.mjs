// The terminal (terminal@1): a key post of the wrong shape, and supervisor keys to the wrong pane.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { until, write } from './lib/kit.mjs';
import { hex, isGone, keysBody, keysTo, markPane, nothingTyped, pause, refusedWith, screenOf, screenUntil, sends, termFixture, tmuxOut, tokenOf, typedState, W } from './lib/terminal-server-fixture.mjs';

test('terminal A5c: a key post of the wrong shape is 400, a paste over its cap 413, a tagged supervisor pane 423; none types', async () => {
  const T = termFixture('term-a5c-keys');
  after(() => T.done());
  const s = T.standIn({ lines: ['A5c stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  let base = await typedState(T, port, s);
  const k = (more = {}, which) => ({ ...keysBody(tok, s.pane, 1, { data: '61' }, which), ...more });
  const shapes = [
    ['not JSON', '{'],
    ['an array', [k()]],
    ['an extra key', { ...k(), x: 1 }],
    ['both data and paste', { ...k(), paste: 'a' }],
    ['neither data nor paste', { ...k(), data: undefined }],
    ['odd-length data', k({ data: '616' })],
    ['empty data', k({ data: '' })],
    ['data not hex', k({ data: 'zz' })],
    ['data not a string', k({ data: 97 })],
    ['an empty paste', { ...k(), data: undefined, paste: '' }],
    ['a paste not a string', { ...k(), data: undefined, paste: ['a'] }],
    ['a which unlike the path', k({ which: 'shell' })],
    ['no which', k({ which: undefined })],
    ['a pane not %<n>', k({ pane: s.pane.slice(1) })],
    ['a pane not a string', k({ pane: 1 })],
    ['a page too short', k({ page: 'short' })],
    ['a page of other characters', k({ page: 'page/0123456789abcdef' })],
    ['seq 0', k({ seq: 0 })],
    ['seq -1', k({ seq: -1 })],
    ['seq 1.5', k({ seq: 1.5 })],
    ['seq as a string', k({ seq: '1' })],
    ['seq past the safe integers', k({ seq: 2 ** 53 })],
  ];
  for (const [what, body] of shapes) {
    refusedWith(await keysTo(T, port, 'supervisor', body), 400, W.shape, what);
    await nothingTyped(T, port, s, base, what);
  }
  // a paste is capped in UTF-8 bytes, not characters
  for (const [what, paste] of [['a 65537-byte paste', 'a'.repeat(65537)], ['32769 two-byte characters', 'é'.repeat(32769)]]) {
    refusedWith(await keysTo(T, port, 'supervisor', { ...k(), data: undefined, paste }), 413, W.paste, what);
    await nothingTyped(T, port, s, base, what);
  }
  // the marked pane carrying @devteam-shell: 423 from both routes (the edge case: neither's)
  assert.equal(spawnSync('tmux', ['set-option', '-p', '-t', s.pane, '@devteam-shell', T.root], { env: T.env }).status, 0);
  await screenUntil(T, port, (j) => j.state === 'gone', 'gone when tagged');
  base = await typedState(T, port, s);
  refusedWith(await keysTo(T, port, 'supervisor', k()), 423, W.moved, 'a tagged supervisor pane');
  await nothingTyped(T, port, s, base, 'a tagged supervisor pane');
  refusedWith(await keysTo(T, port, 'shell', k({}, 'shell')), 423, W.moved, 'a shell post naming the tagged marked pane');
  await nothingTyped(T, port, s, base, 'a shell post naming the tagged marked pane');
  // untagged, the same post types: so the 423 was the tag
  assert.equal(spawnSync('tmux', ['set-option', '-p', '-u', '-t', s.pane, '@devteam-shell'], { env: T.env }).status, 0);
  const ok = await keysTo(T, port, 'supervisor', k());
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.taken, true);
  assert.equal(String(await s.received(1)), 'a');
  s.kill();
});

test('terminal A6: supervisor keys to no, a foreign, a killed or an exited pane get 409, a stale pane 423; each post reads fresh', async () => {
  const T = termFixture('term-a6-keys');
  after(() => T.done());
  const { dash, port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  // nothing marked: 409 on the supervisor, and the shell isn't open: 409
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, '%0', 1)), 409, W.down, 'no marked pane');
  refusedWith(await keysTo(T, port, 'shell', keysBody(tok, '%0', 1, undefined, 'shell')), 409, W.shut, 'no Shell pane');
  const s = T.standIn({ lines: ['A6 stand-in'] });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  let base = await typedState(T, port, s);
  assert.equal(base.sends, 0);
  for (const [what, which, pane, status, error] of [
    ['an unknown pane', 'supervisor', '%9999', 423, W.moved],
    // the pane step's order (S3): a shell post naming the marked pane is 423 before "no Shell"
    ['a shell post naming the marked pane', 'shell', s.pane, 423, W.moved],
    ['a shell post, no Shell open', 'shell', '%9999', 409, W.shut],
  ]) {
    refusedWith(await keysTo(T, port, which, keysBody(tok, pane, 1, undefined, which)), status, error, what);
    await nothingTyped(T, port, s, base, what);
  }
  // a foreign pane: noted, started outside the root, its record naming another server
  const made = spawnSync('tmux', ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${T.session}:`, '-n', 'far', '-c', T.F.base, process.execPath, '-e', 'setInterval(() => {}, 1000)'], { env: T.env, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const far = made.stdout.trim();
  await until(() => tmuxOut(T, ['display', '-p', '-t', far, '#{pane_current_command}']).trim() === 'node', 'node in the far pane');
  markPane(T, far);
  const up = path.join(T.root, 'docs/devteam/run/supervisor-up.json');
  write(up, JSON.stringify({ up: true, kind: 'tmux', pane: far, server: '1' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, far, 1)), 409, W.down, 'a foreign pane');
  assert.equal(sends(T), 0, 'a foreign pane: nothing sent');
  fs.rmSync(up);
  // a second stand-in marked: the first's id is stale (423), and it is never typed into
  const s2 = T.standIn({ lines: ['A6 second stand-in'] });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s2.pane, 'the second live');
  base = await typedState(T, port, s2);
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1)), 423, W.moved, 'the old pane');
  await nothingTyped(T, port, s2, base, 'the old pane');
  assert.equal(String(await s.received()), '', 'the old pane got nothing');
  // killed: 409, and the screen reads gone
  s2.kill();
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s2.pane, 1)), 409, W.down, 'a killed pane');
  isGone((await screenUntil(T, port, (j) => j.state === 'gone', 'gone when killed')).json);
  assert.equal(sends(T), 0, 'a killed pane: nothing sent');
  // a post just after a screen GET, inside a long cache, makes its own read (S2, S2-1): the stand-in
  // has exited to a shell since the GET, which only a fresh read sees
  await dash.stop();
  const s3 = T.standIn({ lines: ['A6 third stand-in'] });
  const long = await T.dashboard([], { DEVTEAM_TERM_CACHE_MS: '10000' });
  const tok2 = await tokenOf(T, long.port);
  const g = await screenUntil(T, long.port, (j) => j.state === 'live' && j.pane === s3.pane, 'the third live');
  assert.equal(g.json.pane, s3.pane);
  const reads = T.oneCallReads();
  await s3.exit();
  assert.equal((await screenOf(T, long.port)).json.state, 'live', 'the cache still holds the live screen');
  assert.equal(T.oneCallReads(), reads, 'and read nothing');
  refusedWith(await keysTo(T, long.port, 'supervisor', keysBody(tok2, s3.pane, 1, { data: hex('echo typed\r') })), 409, W.down, 'exited to a shell, inside the cache');
  assert.equal(T.oneCallReads(), reads + 1, 'the post made its own one-call read');
  await pause(300);
  assert.equal(sends(T), 0, 'an exited pane: nothing sent');
  assert.doesNotMatch(tmuxOut(T, ['capture-pane', '-p', '-t', s3.pane]), /typed/, 'the shell got nothing');
  s3.kill();
  s.kill();
});
