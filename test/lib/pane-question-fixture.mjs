// What pane-question.*.test.mjs share. A question in an agent's terminal (a tool that wants a
// person's yes): read from the pane, never answered by a message typed into it, answered by the owner
// from the dashboard's card and nowhere else.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './chrome.mjs';
import { freePort, startDashboard, until, write } from './kit.mjs';

// A stand-in for the supervisor's agent, drawing what Claude Code draws: in raw mode, so a key
// reaches it as it is pressed, and every byte it is sent is written down. It goes through a list of
// screens, one step per answer (a digit, Enter or Esc): menu (the artifact consent; c changes which
// artifact), menu2 (a Bash prompt), long (a dialog taller than the pane), trust (no numbers), limit
// (the usage-limit menu), then input (its input box, which shows what is typed into it) or bare
// (nothing recognisable). A menu's mode: digit (a digit picks, as Claude Code's do), move (a digit
// moves the cursor and Enter picks), deaf (only Enter picks).
const AGENT = `import fs from 'node:fs';
const [keys, seqArg] = process.argv.slice(2);
const seq = seqArg.split(',').map((s) => { const [kind, mode = 'digit'] = s.split(':'); return { kind, mode }; });
const RULE = '─'.repeat(100);
let at = 0, sel = 1, variant = 0, draft = '', last = '';
const menu = (head, opts) => [RULE, ...head, ...opts.map((o, i) => ' ' + (i + 1 === sel ? '❯' : ' ') + ' ' + (i + 1) + '. ' + o), '', ' Esc to cancel'];
const SCREENS = {
  menu: () => menu([' Artifact', '', " Claude wants to read someone else's artifact at", ' https://claude.ai/artifact/0f1e2d3c' + variant + ' <img src=x onerror=window.__pwned=1>', ''], ['Yes', 'No']),
  menu2: () => menu([' Bash command', '', '   rm -rf  build', '', ' Do you want to proceed?'], ['Yes', 'No']),
  long: () => menu([' Bash command', ...Array.from({ length: 60 }, (_, i) => '   echo step ' + i), ' Do you want to proceed?'], ['Yes', 'No']),
  limit: () => menu([" You've hit your usage limit", ''], ['Stop and wait for limit to reset', 'Upgrade your plan']),
  trust: () => [RULE, ' Artifact', '', " Claude wants to read someone else's artifact", '', ' ' + (sel === 1 ? '❯' : ' ') + ' Yes', ' ' + (sel === 2 ? '❯' : ' ') + ' No', '', ' Esc to cancel'],
  input: () => ['answered ' + last, '', RULE, '❯ ' + draft, RULE, '  ? for shortcuts'],
  bare: () => ['answered ' + last],
};
const draw = () => process.stdout.write('\\x1b[2J\\x1b[H' + ['stand-in supervisor', ...SCREENS[seq[at].kind]()].join('\\n') + '\\n');
const next = (a) => { last = a; sel = 1; if (at < seq.length - 1) at++; };
process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  fs.appendFileSync(keys, String(d));
  for (const ch of String(d)) {
    const { kind, mode } = seq[at];
    if (kind === 'input' || kind === 'bare') { draft = ch === '\\r' ? '' : draft + ch; continue; }
    const n = Number(ch);
    if (ch === '\\x1b') next('esc');
    else if (ch === 'c' && kind === 'menu') variant++;
    else if (ch === '\\r') next(String(sel));
    else if (kind !== 'trust' && (n === 1 || n === 2)) { if (mode === 'digit') next(String(n)); else if (mode === 'move') sel = n; }
  }
  draw();
});
draw();
`;
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// in the fixture's checkout, where a supervisor runs (cwd), unless a test puts it elsewhere
function menuPane(F, seq = 'menu,input', cwd = F.old) {
  const dir = fs.mkdtempSync(path.join(F.base, 'menu-'));
  const keys = path.join(dir, 'keys.txt');
  write(path.join(dir, 'agent.mjs'), AGENT);
  const s = `ask-${path.basename(dir).slice(5)}`;
  const e = F.env();
  spawnSync('tmux', ['new-session', '-d', '-x', '120', '-y', '40', '-s', s, '-n', 'main', '-c', cwd, `${process.execPath} ${path.join(dir, 'agent.mjs')} ${keys} ${seq}`], { env: e });
  const shows = () => spawnSync('tmux', ['-u', 'capture-pane', '-p', '-t', `=${s}:main`], { env: e, encoding: 'utf8' }).stdout ?? '';
  for (let i = 0; i < 300 && !/Esc to cancel/.test(shows()); i++) nap(100);
  return { target: `${s}:main`, key: `${s}:main`, typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : ''), shows, press: (k) => spawnSync('tmux', ['send-keys', '-t', `=${s}:main`, k], { env: e }) };
}
const heldDirOf = (F, pane) => path.join(F.old, 'docs/devteam/run/held', encodeURIComponent(pane.key));
const heldFor = (F, pane) => { try { return fs.readdirSync(heldDirOf(F, pane)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; } };
const logLines = (F) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

// The pane-answer acts in F's log.
const acts = (F) => logLines(F).filter((l) => l.type === 'act' && l.class === 'pane-answer');

// A dashboard for a fixture whose supervisor is that pane; requests as the page's own (a browser
// sends Origin and Sec-Fetch-Site on every fetch POST, and Sec-Fetch-Site on its reads).
async function dash(later, F, pane, env = {}) {
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_SUPERVISOR: pane.target, ...env }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const own = { origin: B, 'sec-fetch-site': 'same-origin' };
  const asked = (headers = { 'sec-fetch-site': 'same-origin' }) => fetch(`${B}/api/threads`, { headers }).then((r) => r.json()).then((j) => j.supervisor.question);
  const post = (body, headers = own) => fetch(`${B}/api/pane-answer`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  // the question now showing, once the dashboard's own look has it (another than `not`)
  const question = (not = null) => until(async () => { const q = await asked(); return q && q.kind === 'menu' && q.digest !== not ? q : null; }, 'the question, from the hello child');
  return { B, port, own, asked, post, question, out: d.out };
}

// Esc (kit-241): the owner's other answer to a numbered menu that says "Esc to cancel".
const esc = (q) => ({ digest: q.digest, escape: true, token: q.token });

// A test's stops: cleanup(t) from lib/chrome.mjs, last registered first, each on its own.

export { acts, cleanup, dash, esc, heldDirOf, heldFor, logLines, menuPane, nap };
