// The terminal (terminal@1): the Shell, posts in order, nothing typed logged, and agent HTML sandboxed.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dashboardOnFreePort, fleetFixture, sessionOf, until, write } from './lib/kit.mjs';
import { hex, isGone, keysBody, keysTo, markPane, nothingTyped, openBody, pause, refusedWith, SAME, screenOf, screenUntil, sends, shellWindows, termFixture, tmuxOut, tokenOf, typedState, W } from './lib/terminal-server-fixture.mjs';

// ---- the Shell (terminal@1 §9, §10) ----
// a window of its own in `target` running a sleeper: its pane id
const sleeper = (T, target, name, cwd) => { const m = spawnSync('tmux', ['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', target, '-n', name, '-c', cwd, process.execPath, '-e', 'setInterval(() => {}, 1000)'], { env: T.env, encoding: 'utf8' }); assert.equal(m.status, 0, m.stderr); return m.stdout.trim(); };
const tagPane = (T, pane, value) => assert.equal(spawnSync('tmux', ['set-option', '-p', '-t', pane, '@devteam-shell', value], { env: T.env }).status, 0, `tag ${pane}`);
// what an agent's session carries, named here, never read from the script (S2-3)
const AGENT_ENV = ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_HUB_RECORD', 'DEVTEAM_CHANNEL', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PID'];
const openShellAt = (T, port, token, cols, rows) => T.post(port, '/api/term/shell/open', { ...openBody(token), cols, rows }, SAME);
// the session's panes in windows named shell: id, start path, tag, window size
const shellPanes = (T, session = T.session) => tmuxOut(T, ['list-panes', '-s', '-t', `=${session}`, '-F', '#{window_name}\t#{pane_id}\t#{pane_start_path}\t#{@devteam-shell}\t#{window_width}x#{window_height}']).split('\n').filter((l) => l.startsWith('shell\t')).map((l) => l.split('\t').slice(1));

// ---- nothing typed is logged; agent HTML stays sandboxed (terminal@1 not-logged, S14) ----
const filesUnder = (dir) => { const out = []; const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p); } }; walk(dir); return out; };
// every place the marker could be: the marker, its hex (both cases) and its UTF-8 bytes
const leaks = (T, dash, marker) => {
  const needles = [marker, hex(marker), hex(marker).toUpperCase(), Buffer.from(marker, 'utf8').toString('latin1')];
  const bad = [];
  const holds = (buf) => needles.some((n) => buf.includes(Buffer.from(n, 'latin1')));
  if (holds(Buffer.from(dash.out(), 'utf8'))) bad.push('the dashboard output');
  for (const d of ['docs/devteam/run', 'docs/devteam/project/log']) for (const f of filesUnder(path.join(T.root, d))) if (holds(fs.readFileSync(f))) bad.push(f);
  return bad;
};

// a header's directives, split on ; and trimmed
const directives = (csp) => String(csp ?? '').split(';').map((d) => d.trim()).filter(Boolean);
const assertSandboxed = (r, what) => {
  assert.equal(r.status, 200, `${what}: ${r.status} ${r.text.slice(0, 200)}`);
  const sb = directives(r.headers['content-security-policy']).filter((d) => d.split(/\s+/)[0].toLowerCase() === 'sandbox');
  assert.equal(sb.length, 1, `${what}: one sandbox directive in ${r.headers['content-security-policy']}`);
  assert.ok(!sb[0].split(/\s+/).slice(1).includes('allow-same-origin'), `${what}: ${sb[0]} lifts the origin`);
};

test('terminal A6: the Shell is the lowest-id pane tagged with this root in this session, never the marked one; shell/open makes one clean window per project, sized; terminal A4: echo hi on the Shell; terminal A5c: the Shell made the marked pane is 423', async () => {
  const T = termFixture('term-shell');
  after(() => T.done());
  // the marked supervisor pane, tagged with this root, and the lowest id: never the Shell
  const s = T.standIn({ lines: ['shell stand-in'] });
  tagPane(T, s.pane, T.root);
  // tagged with another root; and, in another session on this server, tagged with this root
  const otherRoot = sleeper(T, `=${T.session}:`, 'decoy', T.root);
  tagPane(T, otherRoot, path.join(T.F.base, 'elsewhere'));
  assert.equal(spawnSync('tmux', ['new-session', '-d', '-s', 'another-project', '-c', T.F.base], { env: T.env }).status, 0, 'another session');
  const elsewhere = sleeper(T, '=another-project:', 'shell', T.root);
  tagPane(T, elsewhere, T.root);
  // two tagged panes across a digit boundary, %9 and %10: by number %9 is lower, by string %10
  const ids = [];
  while (ids.length < 2) { const p = sleeper(T, `=${T.session}:`, 'tagged', T.root); if (Number(p.slice(1)) >= 9) ids.push(p); else spawnSync('tmux', ['kill-pane', '-t', p], { env: T.env }); }
  assert.deepEqual(ids, ['%9', '%10'], 'the ids cross a digit boundary');
  tagPane(T, '%10', T.root);
  tagPane(T, '%9', T.root);
  const { port } = await T.dashboard();
  const tok = await tokenOf(T, port);
  const shellScreen = () => screenOf(T, port, 'shell');
  let g = await shellScreen();
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.state, 'live', g.text);
  assert.equal(g.json.pane, '%9', 'the numerically lowest tagged pane');
  // the remembered pane retagged: dropped, and looked up again
  tagPane(T, '%9', path.join(T.F.base, 'elsewhere'));
  await pause(150);
  g = await shellScreen();
  assert.equal(g.json.pane, '%10', g.text);
  // the remembered pane gone: none of this root in this session but the marked one
  spawnSync('tmux', ['kill-pane', '-t', '%10'], { env: T.env });
  await pause(150);
  g = await shellScreen();
  assert.equal(g.status, 200, g.text);
  isGone(g.json, 'shell');
  // an agent's environment in the server's global one: the Shell gets none of it
  for (const k of AGENT_ENV) assert.equal(spawnSync('tmux', ['set-environment', '-g', k, 'x'], { env: T.env }).status, 0, k);
  const global = tmuxOut(T, ['show-environment', '-g']).split('\n');
  for (const k of AGENT_ENV) assert.ok(global.includes(`${k}=x`), `the server's global environment has ${k}`);
  assert.equal(shellPanes(T).length, 0, 'no Shell yet');
  // two opens at once make one window (T5-2)
  const [o, oo] = await Promise.all([openShellAt(T, port, tok, 100, 30), openShellAt(T, port, tok, 100, 30)]);
  assert.equal(o.status, 200, o.text);
  assert.equal(oo.status, 200, oo.text);
  assert.equal(oo.json.pane, o.json.pane, 'two opens at once: one pane');
  assert.equal(o.headers['cache-control'], 'no-store');
  assert.equal(o.json.which, 'shell');
  assert.equal(o.json.state, 'live');
  const pane = o.json.pane;
  assert.match(pane, /^%\d+$/);
  assert.ok(![s.pane, otherRoot, elsewhere, ...ids].includes(pane), `a new pane: ${pane}`);
  assert.deepEqual([o.json.cols, o.json.rows], [100, 30], 'the answer is the sized screen');
  assert.equal(shellWindows(T), 1, 'one shell window');
  assert.deepEqual(shellPanes(T), [[pane, T.root, T.root, '100x30']], 'at the root, tagged with it, sized');
  // A4 on the Shell: typed with -H, and a line exactly hi within 5 s
  const sent = T.callSpans('send-keys').length;
  const k = await keysTo(T, port, 'shell', keysBody(tok, pane, 1, { data: '6563686f2068690d' }, 'shell'));
  assert.equal(k.status, 200, k.text);
  assert.equal(k.json.taken, true);
  assert.equal(T.callSpans('send-keys').length, sent + 1);
  let last;
  for (const stop = Date.now() + 5000; Date.now() < stop; await pause(100)) { last = await shellScreen(); if (last.json?.lines?.includes('hi')) break; }
  assert.ok(last.json?.lines?.includes('hi'), `a line exactly hi: ${last.text}`);
  if (process.platform === 'linux') {
    const pid = tmuxOut(T, ['display', '-p', '-t', pane, '#{pane_pid}']).trim();
    const environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const names = environ.map((l) => l.split('=')[0]);
    for (const k of AGENT_ENV) assert.ok(!names.includes(k), `the Shell has no ${k}`);
    assert.ok(environ.includes(`TMUX_PANE=${pane}`), 'the Shell has its own TMUX_PANE');
  }
  // a second open, another size: the same window, resized
  const o2 = await openShellAt(T, port, tok, 90, 20);
  assert.equal(o2.status, 200, o2.text);
  assert.equal(o2.json.pane, pane);
  assert.deepEqual([o2.json.cols, o2.json.rows], [90, 20]);
  assert.equal(shellWindows(T), 1, 'still one shell window');
  assert.deepEqual(shellPanes(T), [[pane, T.root, T.root, '90x20']]);
  // a stale pane id: 423, nothing typed
  const before = sends(T);
  for (const stale of ['%9999', '%10']) refusedWith(await keysTo(T, port, 'shell', keysBody(tok, stale, 2, { data: hex('echo stale\r') }, 'shell')), 423, W.moved, `a stale pane ${stale}`);
  // A5c: the Shell's own pane made the marked one: 423, nothing typed
  markPane(T, pane);
  refusedWith(await keysTo(T, port, 'shell', keysBody(tok, pane, 2, { data: hex('echo marked\r') }, 'shell')), 423, W.moved, 'the Shell made the marked pane');
  markPane(T, s.pane);
  await pause(300);
  assert.equal(sends(T), before, 'nothing sent');
  assert.doesNotMatch(tmuxOut(T, ['capture-pane', '-p', '-t', pane]), /stale|marked/, 'the Shell got nothing');
  // unmarked again it is the Shell once more, and the other session's tagged pane never was
  const back = await openShellAt(T, port, tok, 90, 20);
  assert.equal(back.json.pane, pane, back.text);
  assert.equal(shellWindows(T), 1);
  // a second project's dashboard on the same tmux server opens its own Shell
  const F2 = fleetFixture('term-shell-2');
  let d2 = null;
  after(async () => { if (d2) await d2.dash.stop(); F2.done(); });
  const root2 = F2.old;
  const session2 = sessionOf(root2, 'term-shell-2');
  const allWindows = () => tmuxOut(T, ['list-windows', '-a', '-F', '#{session_name}:#{window_id}']);
  // T5-3: its session missing, open is 409 and no window appears anywhere (the dashboard first)
  d2 = await dashboardOnFreePort(root2, { ...F2.env({}), TMUX_TMPDIR: T.env.TMUX_TMPDIR });
  const windows = allWindows();
  refusedWith(await openShellAt(T, d2.port, await tokenOf(T, d2.port), 80, 24), 409, 'the shell could not be opened', 'no session');
  assert.equal(allWindows(), windows, 'no window anywhere');
  assert.equal(spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', session2, '-n', 'main', '-c', root2], { env: T.env }).status, 0, 'the second session');
  const o3 = await openShellAt(T, d2.port, await tokenOf(T, d2.port), 80, 24);
  assert.equal(o3.status, 200, o3.text);
  assert.notEqual(o3.json.pane, pane, 'its own pane');
  assert.deepEqual(shellPanes(T, session2), [[o3.json.pane, root2, root2, '80x24']], 'in its own session, tagged with its own root');
  assert.equal(o3.json.which, 'shell');
  assert.deepEqual(shellPanes(T), [[pane, T.root, T.root, '90x20']], 'this project\'s untouched');
  assert.equal((await openShellAt(T, port, tok, 90, 20)).json.pane, pane, 'and still its own');
  // T5-1: a dead Shell kept by remain-on-exit never shadows a live one
  assert.equal(spawnSync('tmux', ['set-option', '-w', '-t', pane, 'remain-on-exit', 'on'], { env: T.env }).status, 0);
  const ex = await keysTo(T, port, 'shell', keysBody(tok, pane, 3, { data: hex('exit\r') }, 'shell'));
  assert.equal(ex.json?.taken, true, ex.text);
  await until(() => tmuxOut(T, ['display', '-p', '-t', pane, '#{pane_dead}']).trim() === '1', 'the first Shell dead, its pane kept');
  const fresh = await openShellAt(T, port, tok, 90, 20);
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(fresh.json.state, 'live');
  const live = fresh.json.pane;
  assert.ok(Number(live.slice(1)) > Number(pane.slice(1)), `a new, higher pane: ${live} after ${pane}`);
  // the remembered id dropped (the live pane retagged a moment, so the read moves off it): the lookup
  // that follows picks the live pane, not the dead one with the lower id
  tagPane(T, live, path.join(T.F.base, 'elsewhere'));
  await pause(150);
  isGone((await shellScreen()).json, 'shell');
  tagPane(T, live, T.root);
  await pause(150);
  const found = await shellScreen();
  assert.equal(found.json.pane, live, `the live pane, not the dead ${pane}: ${found.text}`);
  const typed = await keysTo(T, port, 'shell', keysBody(tok, live, 4, { data: hex('echo again\r') }, 'shell'));
  assert.equal(typed.status, 200, typed.text);
  assert.equal(typed.json.taken, true);
  s.kill();
});

test('terminal A7c: posts one at a time in arrival order, each seq taken once; a paste whole and bracketed; a failed send keeps its seq', async () => {
  const T = termFixture('term-a7c');
  after(() => T.done());
  const s = T.standIn({ lines: ['A7c stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const delay = path.join(T.F.base, 'tmux-delay.json');
  write(delay, JSON.stringify({ 'send-keys': 150 }));
  T.clearCalls();
  const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => keysTo(T, port, 'supervisor', keysBody(tok, s.pane, i + 1, { data: hex(String(i)) }))));
  const got = String(await s.received(1));
  assert.match(got, /^[0-9]+$/, got);
  for (let i = 1; i < got.length; i++) assert.ok(got[i] > got[i - 1], `strictly increasing: ${got}`);
  answers.forEach((r, i) => { assert.equal(r.status, 200, r.text); assert.equal(r.json.taken, got.includes(String(i)), `seq ${i + 1}: taken ${r.json.taken}, received ${got}`); });
  assert.ok(got.includes('9'), 'the highest seq is always taken');
  const spans = T.callSpans('send-keys').sort((a, b) => a.start - b.start);
  assert.equal(spans.length, got.length, 'one send-keys per taken post');
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i].start >= spans[i - 1].end, `send-keys overlap: ${JSON.stringify(spans)}`);
  // the highest taken seq again: taken false, nothing more typed
  const base = await typedState(T, port, s);
  const rep = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 10, { data: hex('9') }));
  assert.equal(rep.status, 200, rep.text);
  assert.equal(rep.json.taken, false);
  assert.equal(rep.json.state, 'live');
  assert.equal(rep.json.pane, s.pane);
  await nothingTyped(T, port, s, base, 'a repeat');
  // another page counts its own seqs
  const other = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 1, { data: hex('p') }), page: 'another-page-0123456789' });
  assert.equal(other.json.taken, true, other.text);
  fs.rmSync(delay);
  // a two-line paste into a program that asked for bracketed paste: one bracketed paste, no Enter after
  await s.say('\x1b[?2004hbracketed');
  const before = String(await s.received());
  const p = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 11, { paste: 'one\ntwo' }));
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.taken, true);
  const pasted = String(await s.received(before.length + 1)).slice(before.length);
  assert.match(pasted, /^\x1b\[200~one[\r\n]two\x1b\[201~$/, JSON.stringify(pasted));
  assert.equal(T.callSpans('paste-buffer').length, 1, 'one paste-buffer');
  assert.equal(T.callSpans('load-buffer').length, 1, 'one load-buffer');
  const buffers = () => tmuxOut(T, ['list-buffers', '-F', '#{buffer_name}']);
  assert.doesNotMatch(buffers(), /devteam-term-/, 'no buffer left');
  // B-1: a paste can't end its own bracket: every ESC[200~ and ESC[201~ in it is dropped, again until
  // none is left (a drop can join two halves into a marker), so its Enter stays inside the one bracket
  const bp = 'bracket-page-0123456789';
  for (const [i, [text, want]] of [['one\x1b[201~two\r', 'onetwo\r'], ['a\x1b[20\x1b[201~1~b\x1b[2\x1b[200~00~c\r', 'abc\r']].entries()) {
    const at = String(await s.received()).length;
    const r = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, i + 1, { paste: text }), page: bp });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.taken, true);
    const got = String(await s.received(at + 1)).slice(at);
    assert.equal(got, `\x1b[200~${want}\x1b[201~`, `one bracket, the Enter inside it: ${JSON.stringify(got)}`);
  }
  // a paste of nothing but markers is empty: 400, as an empty paste is; nothing typed, its seq free
  const b1 = await typedState(T, port, s);
  refusedWith(await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 3, { paste: '\x1b[20\x1b[201~0~' }), page: bp }), 400, W.shape, 'a paste of markers only');
  await nothingTyped(T, port, s, b1, 'a paste of markers only');
  const bx = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 3, { paste: 'x' }), page: bp });
  assert.equal(bx.json.taken, true, bx.text);
  // a paste-buffer that fails: 500, its buffer deleted, its seq used
  const fail = path.join(T.F.base, 'tmux-fail.json');
  let b2 = await typedState(T, port, s);
  write(fail, JSON.stringify({ 'paste-buffer': 'server exited unexpectedly' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 12, { paste: 'three' })), 500, W.sent, 'a failed paste');
  assert.equal(T.callSpans('delete-buffer').length, 1, 'the buffer deleted');
  assert.doesNotMatch(buffers(), /devteam-term-/, 'no buffer left after a failed paste');
  fs.rmSync(fail);
  const rp = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 12, { paste: 'three' }));
  assert.equal(rp.status, 200, rp.text);
  assert.equal(rp.json.taken, false, 'a failed send keeps its seq');
  b2 = { ...b2, sends: b2.sends + 2 };
  await nothingTyped(T, port, s, b2, 'a failed paste and its resend');
  // a send-keys that fails: the same
  write(fail, JSON.stringify({ 'send-keys': 'server exited unexpectedly' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 13, { data: hex('z') })), 500, W.sent, 'a failed send-keys');
  fs.rmSync(fail);
  const rk = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 13, { data: hex('z') }));
  assert.equal(rk.json.taken, false, rk.text);
  await nothingTyped(T, port, s, { ...b2, sends: b2.sends + 1 }, 'a failed send-keys and its resend');
  const next = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 14, { data: hex('z') }));
  assert.equal(next.json.taken, true, next.text);
  assert.ok(String(await s.received()).endsWith('z'));
  // T4-4: a 4096-byte data post is taken whole
  let had = String(await s.received()).length;
  const full = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 15, { data: '62'.repeat(4096) }));
  assert.equal(full.status, 200, full.text);
  assert.equal(full.json.taken, true);
  assert.equal(String(await s.received(had + 4096)).slice(had), 'b'.repeat(4096));
  // T4-4: the same seq posted twice at once types once
  had = String(await s.received()).length;
  const twice = await Promise.all([0, 1].map(() => keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 16, { data: hex('Y') }))));
  for (const r of twice) assert.equal(r.status, 200, r.text);
  assert.deepEqual(twice.map((r) => r.json.taken).sort(), [false, true]);
  assert.equal(String(await s.received(had + 1)).slice(had), 'Y');
  // T4-1: every read after a taken send failing: the answer is the pre-send screen, taken
  await pause(150);
  write(delay, JSON.stringify({ 'send-keys': 3000 }));
  T.clearCalls();
  const pending = keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 17, { data: hex('Q7') }));
  await until(() => T.callLog().some((c) => c.cmds.join('+') === 'display+capture-pane'), 'the pre-send read');
  write(fail, JSON.stringify({ 'display+capture-pane': 'server exited unexpectedly' }));
  const q = await pending;
  fs.rmSync(fail);
  fs.rmSync(delay);
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.taken, true);
  assert.equal(q.json.state, 'live');
  assert.ok(!q.json.lines.some((l) => l.includes('Q7')), `the pre-send screen: ${JSON.stringify(q.json.lines)}`);
  assert.ok(T.callLog().filter((c) => c.cmds.join('+') === 'display+capture-pane').length > 1, 'it read after the send');
  assert.ok(String(await s.received()).endsWith('Q7'), 'and the keys went');
  // T4-3: a failed paste whose buffer can't be deleted: the log names the buffer, never its text
  write(fail, JSON.stringify({ 'paste-buffer': 'server exited unexpectedly', 'delete-buffer': 'server exited unexpectedly' }));
  refusedWith(await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 18, { paste: 'secret-paste-T43' })), 500, W.sent, 'a failed paste, its buffer kept');
  fs.rmSync(fail);
  const left = buffers().split('\n').filter((n) => n.startsWith('devteam-term-'));
  assert.equal(left.length, 1, 'the buffer is still there');
  const dlog = path.join(T.root, 'docs/devteam/run/dashboard.log');
  await until(() => fs.readFileSync(dlog, 'utf8').includes(left[0]), 'the buffer named in the log');
  assert.ok(!fs.readFileSync(dlog, 'utf8').includes('secret-paste-T43'), 'never its text');
  assert.equal(spawnSync('tmux', ['delete-buffer', '-b', left[0]], { env: T.env }).status, 0);
  // B-2: a post whose client went while it waited its turn types nothing and leaves its seq free
  const gp = 'gone-client-page-0123456789';
  had = String(await s.received()).length;
  write(delay, JSON.stringify({ 'send-keys': 1500 }));
  T.clearCalls();
  const first = keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 1, { data: hex('G') }), page: gp });
  await until(() => T.callLog().some((c) => c.cmds.join('+') === 'display+capture-pane'), 'the first post\'s read');
  const body2 = JSON.stringify({ ...keysBody(tok, s.pane, 2, { data: hex('H') }), page: gp });
  const second = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/term/supervisor/keys', setHost: false, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...SAME, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body2)) } });
  second.on('error', () => {});
  second.end(body2);
  await pause(400);
  second.destroy();
  const g = await first;
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.taken, true);
  // a repeat of the first, queued behind the gone one: when it answers, the gone one's turn is over
  const rep1 = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 1, { data: hex('G') }), page: gp });
  assert.equal(rep1.json.taken, false, rep1.text);
  fs.rmSync(delay);
  assert.equal(String(await s.received(had + 1)).slice(had), 'G', 'only the first post typed');
  assert.equal(T.callSpans('send-keys').length, 1, 'one send-keys');
  assert.match(fs.readFileSync(dlog, 'utf8'), /refused \/api\/term\/supervisor\/keys: the client went before its turn/);
  const again = await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, 2, { data: hex('H') }), page: gp });
  assert.equal(again.json.taken, true, `its seq was not used: ${again.text}`);
  assert.equal(String(await s.received(had + 2)).slice(had), 'GH');
  s.kill();
});

test('terminal not logged: a typed or pasted marker, sent, refused or failed, is in no log, no file and no output', async () => {
  const T = termFixture('term-nolog');
  after(() => T.done());
  const marker = `kit612-marker-${crypto.randomBytes(8).toString('hex')}`;
  const s = T.standIn({ lines: ['not-logged stand-in'] });
  const { dash, port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const o = await openShellAt(T, port, tok, 80, 24);
  assert.equal(o.status, 200, o.text);
  const shell = o.json.pane;
  let seq = 0, shellSeq = 0;
  const sup = (more, extra) => keysTo(T, port, 'supervisor', keysBody(tok, s.pane, ++seq, more), extra);
  const sh = (more) => keysTo(T, port, 'shell', keysBody(tok, shell, ++shellSeq, more, 'shell'));
  // typed (as data) and pasted, on both tabs
  for (const r of [await sup({ data: hex(marker) }), await sup({ paste: marker }), await sh({ data: hex(marker) }), await sh({ paste: marker })]) { assert.equal(r.status, 200, r.text); assert.equal(r.json.taken, true); }
  assert.ok(String(await s.received()).includes(marker), 'the marker was typed on the supervisor');
  // refused: a wrong token, and a body of another shape, each carrying it
  refusedWith(await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, ++seq, { data: hex(marker) }), token: 'f'.repeat(64) }), 403, W.token, 'a wrong token');
  refusedWith(await keysTo(T, port, 'supervisor', { ...keysBody(tok, s.pane, ++seq, { data: hex(marker) }), extra: marker }), 400, W.shape, 'a body of the wrong shape');
  // failed: a send-keys, a paste-buffer and a load-buffer that fail
  const fail = path.join(T.F.base, 'tmux-fail.json');
  for (const [key, more, tab] of [['send-keys', { data: hex(marker) }, sup], ['paste-buffer', { paste: marker }, sup], ['load-buffer', { paste: marker }, sup], ['send-keys', { data: hex(marker) }, sh], ['paste-buffer', { paste: marker }, sh]]) {
    write(fail, JSON.stringify({ [key]: `server exited unexpectedly ${key}` }));
    const r = await tab(more);
    fs.rmSync(fail);
    assert.equal(r.status, 500, `${key}: ${r.text}`);
  }
  await pause(300);
  assert.deepEqual(leaks(T, dash, marker), [], 'the marker, its hex and its bytes are nowhere');
  assert.ok(fs.existsSync(path.join(T.root, 'docs/devteam/run/dashboard.log')) || dash.out().length > 0, 'there was output to search');
  // the check can fail: the marker written to run/ by hand is found
  const planted = path.join(T.root, 'docs/devteam/run/planted');
  write(planted, `${marker}\n`);
  assert.deepEqual(leaks(T, dash, marker), [planted], 'a planted marker is seen');
  fs.rmSync(planted);
  s.kill();
});

test('terminal sandbox: artifacts, repo files, review pages and dropped files are served in a sandbox without allow-same-origin', async () => {
  const T = termFixture('term-sbx');
  after(() => T.done());
  const git = (args) => spawnSync('git', args, { cwd: T.root, encoding: 'utf8' });
  const art = 'docs/devteam/project/artifacts/sbx';
  write(path.join(T.root, art, 'index.html'), '<!doctype html><title>x</title><p>agent page</p>\n');
  write(path.join(T.root, art, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>\n');
  write(path.join(T.root, 'a.html'), '<!doctype html><script>1</script>\n');
  write(path.join(T.root, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>\n');
  write(path.join(T.root, 'a.xml'), '<?xml version="1.0"?><a/>\n');
  for (const a of [['add', '-A'], ['commit', '-qm', 'sandbox fixtures'], ['push', '-q', 'origin', 'main']]) { const g = git(a); assert.equal(g.status, 0, `${a.join(' ')}: ${g.stderr}`); }
  const { port } = await T.dashboard([], { HOME: fs.mkdtempSync(path.join(T.F.base, 'home-')) });
  const frame = { ...SAME, 'sec-fetch-dest': 'iframe' };
  const get = (p, headers) => T.req(port, 'GET', p, { headers });
  for (const h of [frame, SAME, {}]) {
    assertSandboxed(await get(`/artifact/main/sbx/index.html`, h), `artifact page ${JSON.stringify(h)}`);
    assertSandboxed(await get(`/artifact/main/sbx/`, h), `artifact root ${JSON.stringify(h)}`);
    assertSandboxed(await get(`/artifact/main/sbx/pic.svg`, h), `artifact svg ${JSON.stringify(h)}`);
  }
  for (const f of ['a.html', 'a.svg', 'a.xml']) assertSandboxed(await get(`/api/file?path=${f}`, SAME), `/api/file ${f}`);
  assertSandboxed(await get('/review/preview/?path=a.html', frame), 'review page');
  // dropped as the page drops them: a post with its own Origin, then read back as the page would
  for (const name of ['drop.html', 'drop.svg']) {
    const body = name.endsWith('html') ? '<script>1</script>' : '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const up = await T.req(port, 'POST', `/upload?name=${name}`, { headers: { origin: `http://127.0.0.1:${port}`, ...SAME, 'content-length': String(Buffer.byteLength(body)) }, body });
    assert.equal(up.status, 200, `upload ${name}: ${up.text}`);
    const [, folder, file] = /\/([^/]+)\/([^/]+)$/.exec(up.json.path);
    for (const h of [frame, SAME]) assertSandboxed(await get(`/upload/${folder}/${file}`, h), `/upload ${name} ${JSON.stringify(h)}`);
  }
  // the check can fail: no header, and a lifted one, are each refused by it
  assert.throws(() => assertSandboxed({ status: 200, text: '', headers: {} }, 'none'));
  assert.throws(() => assertSandboxed({ status: 200, text: '', headers: { 'content-security-policy': "default-src 'none'; sandbox allow-scripts allow-same-origin" } }, 'lifted'));
});
