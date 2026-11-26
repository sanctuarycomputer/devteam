/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DAY } from './base.mjs';
import { HUB_PORT } from './orient.mjs';
import { PORT_RANGE } from './orient.mjs';
import { UNSAFE_TEXT } from './links.mjs';
import { answers } from './orient.mjs';
import { argv } from './base.mjs';
import { browserEnsure } from './browser.mjs';
import { browserGates } from './browser.mjs';
import { browserIsDaemon } from './browser.mjs';
import { browserIsPreview } from './browser.mjs';
import { browserKey } from './browser.mjs';
import { browserPreviewShaped } from './browser.mjs';
import { browserStop } from './browser-view.mjs';
import { die } from './base.mjs';
import { execFile } from 'node:child_process';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { isObj } from './artifact-notes.mjs';
import { json } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { logWriter } from './log.mjs';
import { mainRoot } from './state.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { portFree } from './orient.mjs';
import { positional } from './base.mjs';
import { probeHello } from './orient.mjs';
import { readNum } from './hub/operator.mjs';
import { realPath } from './state.mjs';
import { rest } from './base.mjs';
import { runDir } from './state.mjs';
import { sh } from './base.mjs';
import { tmux } from './sessions.mjs';
import { tmuxServerEnv } from './sessions.mjs';
import { tmuxSession } from './base.mjs';
import { tryLock } from './log.mjs';
import { withLock } from './log.mjs';
/* imports end */
// ===== previews: a session's running dev server, behind a name the owner can open =====
//
// A preview is a name bound to a port on this machine, offered by a session. Unlike an artifact it
// is run state: run/previews/<name>.json, machine-local, never a log line; what it shows can change
// from one look to the next, so it approves nothing. The name is two words from a hash of the
// project, the session and the label, so it is the same after a restart and on a new box with
// nothing remembered. One hyphen between two letter-only words can never be a reserved name.
export const PREVIEW_ADJECTIVES = [
  'able', 'agile', 'airy', 'alert', 'amber', 'ample', 'apt', 'aqua', 'arched', 'ashen', 'azure', 'balmy', 'bold', 'brave', 'breezy', 'brief',
  'bright', 'brisk', 'broad', 'bronze', 'brown', 'bubbly', 'busy', 'calm', 'candid', 'careful', 'cedar', 'cheery', 'chief', 'chilly', 'civic', 'classy',
  'clean', 'clear', 'clever', 'cloudy', 'coastal', 'cobalt', 'cool', 'copper', 'coral', 'cosmic', 'cozy', 'crafty', 'crimson', 'crisp', 'curly', 'daily',
  'dainty', 'dapper', 'daring', 'dawning', 'deft', 'dewy', 'direct', 'dreamy', 'dusky', 'dusty', 'eager', 'early', 'earnest', 'earthy', 'easy', 'elated',
  'elder', 'even', 'exact', 'fair', 'famous', 'fancy', 'feisty', 'fine', 'firm', 'first', 'fleet', 'fluffy', 'flying', 'fresh', 'frosty', 'frugal',
  'fuzzy', 'gentle', 'giddy', 'gilded', 'glad', 'gleamy', 'glossy', 'golden', 'good', 'grand', 'grassy', 'great', 'green', 'grey', 'hale', 'handy',
  'happy', 'hardy', 'hazel', 'hearty', 'honest', 'humble', 'husky', 'ideal', 'indigo', 'inky', 'ivory', 'jade', 'jaunty', 'jazzy', 'jolly', 'jovial',
  'joyful', 'keen', 'kind', 'lavish', 'leafy', 'level', 'light', 'lilac', 'limber', 'linen', 'lively', 'loyal', 'lucid', 'lucky', 'lunar', 'lush',
  'main', 'major', 'maple', 'marine', 'mellow', 'merry', 'mighty', 'mild', 'minty', 'misty', 'modern', 'modest', 'mossy', 'nearby', 'neat', 'nifty',
  'nimble', 'noble', 'north', 'oaken', 'olive', 'open', 'orange', 'orchid', 'outer', 'pale', 'peachy', 'pearly', 'perky', 'pink', 'placid', 'plucky',
  'plum', 'plush', 'polar', 'polite', 'prime', 'proud', 'pure', 'purple', 'quaint', 'quick', 'quiet', 'quirky', 'radiant', 'rapid', 'ready', 'regal',
  'rich', 'rocky', 'rosy', 'round', 'ruby', 'rustic', 'safe', 'sage', 'salty', 'sandy', 'savvy', 'scarlet', 'scenic', 'serene', 'shady', 'sharp',
  'shiny', 'silent', 'silky', 'silver', 'simple', 'sleek', 'slim', 'smart', 'smooth', 'snappy', 'snowy', 'snug', 'soft', 'solid', 'sonic', 'spare',
  'speedy', 'spicy', 'spry', 'stable', 'starry', 'steady', 'steely', 'still', 'stout', 'sturdy', 'suave', 'sunny', 'super', 'sure', 'swift', 'tall',
  'tawny', 'teal', 'tender', 'thrifty', 'tidy', 'timely', 'tiny', 'trim', 'true', 'trusty', 'twin', 'upbeat', 'urban', 'useful', 'valiant', 'velvet',
  'verdant', 'violet', 'vivid', 'warm', 'wavy', 'wealthy', 'west', 'windy', 'winged', 'wintry', 'wise', 'witty', 'wooden', 'woolly', 'worthy', 'zany',
];
export const PREVIEW_NOUNS = [
  'acorn', 'alder', 'alpaca', 'anchor', 'antler', 'apple', 'apricot', 'arbor', 'arch', 'aspen', 'atlas', 'aurora', 'badger', 'bagel', 'bamboo', 'banjo',
  'barley', 'basil', 'basin', 'bass', 'beacon', 'beaver', 'beech', 'bell', 'berry', 'birch', 'biscuit', 'bison', 'bluff', 'bobcat', 'bonsai', 'boulder',
  'branch', 'breeze', 'brook', 'bumble', 'bunny', 'button', 'cactus', 'camel', 'canoe', 'canyon', 'cape', 'cashew', 'castle', 'chalk', 'cheetah', 'cherry',
  'chime', 'cider', 'clam', 'cloud', 'clover', 'cobra', 'comet', 'compass', 'condor', 'cookie', 'cornet', 'cosmos', 'cottage', 'cougar', 'coyote', 'crane',
  'creek', 'cricket', 'crocus', 'crow', 'cypress', 'dahlia', 'daisy', 'dale', 'dawn', 'deer', 'delta', 'dingo', 'dolphin', 'dove', 'dragon', 'drum',
  'dune', 'eagle', 'ember', 'falcon', 'fawn', 'fern', 'ferret', 'fiddle', 'field', 'finch', 'fjord', 'flute', 'forest', 'fossil', 'fox', 'gazelle',
  'gecko', 'geyser', 'ginger', 'glacier', 'glade', 'goose', 'gopher', 'grape', 'grove', 'gull', 'harbor', 'hare', 'harp', 'hawk', 'heron', 'hill',
  'hippo', 'holly', 'honey', 'hornet', 'horse', 'iris', 'island', 'jaguar', 'jasmine', 'jay', 'juniper', 'kale', 'kayak', 'kelp', 'kestrel', 'kite',
  'kiwi', 'koala', 'lagoon', 'lake', 'lantern', 'lark', 'laurel', 'lemon', 'lemur', 'leopard', 'lichen', 'lily', 'linden', 'lion', 'llama', 'lobster',
  'locust', 'lotus', 'lynx', 'magpie', 'manatee', 'mango', 'mantis', 'marble', 'meadow', 'melon', 'meteor', 'mink', 'moose', 'moth', 'mule', 'nectar',
  'newt', 'nutmeg', 'oasis', 'ocean', 'octopus', 'orca', 'oriole', 'osprey', 'otter', 'owl', 'oyster', 'panda', 'panther', 'papaya', 'parrot', 'peach',
  'peacock', 'peak', 'pear', 'pebble', 'pelican', 'penguin', 'pepper', 'perch', 'petal', 'pigeon', 'pine', 'piper', 'plover', 'pond', 'poppy', 'prairie',
  'puffin', 'puma', 'quail', 'quartz', 'quince', 'rabbit', 'raccoon', 'radish', 'rain', 'raven', 'reef', 'ridge', 'river', 'robin', 'rocket', 'rose',
  'rowan', 'saddle', 'salmon', 'sapling', 'seal', 'sequoia', 'shark', 'shell', 'shrew', 'sierra', 'skylark', 'sloth', 'sparrow', 'spruce', 'squid', 'stag',
  'star', 'stork', 'stream', 'summit', 'swan', 'tamarin', 'tapir', 'teapot', 'tern', 'thistle', 'thrush', 'tiger', 'toucan', 'trail', 'trout', 'tulip',
  'tundra', 'turnip', 'turtle', 'valley', 'vine', 'viola', 'vole', 'walnut', 'walrus', 'weasel', 'whale', 'willow', 'wombat', 'wren', 'yak', 'zebra',
];
export const PREVIEW_NAME = /^[a-z]{3,7}-[a-z]{3,7}(?:-[1-9]\d?)?$/;
export const PREVIEW_MAX = 20;
export const PREVIEW_LABEL_MAX = 40;
export const PREVIEW_TTL = 7 * DAY;
export const TTYD_PORT = Number(process.env.DEVTEAM_TTYD_PORT ?? 7681);
export function previewName(project, session, label) {
  const h = crypto.createHash('sha256').update(`${project}\0${session}\0${label}`).digest();
  return `${PREVIEW_ADJECTIVES[h[0]]}-${PREVIEW_NOUNS[h[1]]}`;
}
// true, or why not. A dashboard's or the hub's port has a name of its own, and a link to the
// gateway's or the terminal's would have the gateway relay itself. own: the gateway's port, which
// a box's agents see as the platform's PORT. Only the browser's daemon has a PORT that is its own
// view port, always one of PREVIEW_PICK; browserIsDaemon is set by browser serve alone, so no
// environment makes another command exempt.
export function previewPortOk(port, own = process.env.DEVTEAM_PUBLIC_URL ? Number(process.env.PORT) : null) {
  if (browserIsDaemon && PREVIEW_PICK.includes(own)) own = null;
  if (!Number.isInteger(port)) return 'a port is an integer';
  if (port < 1024) return 'ports below 1024 are not offered';
  if (port > 65535) return 'a port is at most 65535';
  if (port === HUB_PORT) return `${port} is the hub's`;
  if (PORT_RANGE.includes(port)) return `${port} is in the instance block (${PORT_RANGE[0]}-${PORT_RANGE.at(-1)}): those are dashboards, each with a name of its own`;
  if (port === TTYD_PORT) return `${port} is the box's terminal`;
  if (port === own) return `${port} is the gateway's own port on this box`;
  return true;
}
export const previewsDir = () => path.join(runDir, 'previews');
export const previewFile = (name) => path.join(previewsDir(), `${name}.json`);
// Told once per file by the dashboard's log; anywhere else a bad file is simply not a preview.
export let previewBad = null;
// Every record on disk that holds together, by name, at most 20 of them, each with its file's mtime
// (the tick compares it before writing). Anything else in the folder is skipped: a file an agent can
// write is data, and however many are planted the reads, the probes and the environment handed to
// dashboard-data stay small.
export function readPreviews() {
  let files;
  try { files = fs.readdirSync(previewsDir()); } catch { return []; }
  const recs = [];
  for (const f of files.filter((x) => x.endsWith('.json')).sort().slice(0, 256)) {
    if (recs.length >= PREVIEW_MAX) break;
    const stem = f.slice(0, -'.json'.length);
    try {
      const st = fs.lstatSync(path.join(previewsDir(), f));
      if (!st.isFile() || st.size > 65536) throw new Error('not a small file');
      const r = JSON.parse(fs.readFileSync(path.join(previewsDir(), f), 'utf8'));
      if (!isObj(r) || r.name !== stem || !PREVIEW_NAME.test(stem) || previewPortOk(r.port) !== true || !['project', 'session', 'label', 'cwd', 'at', 'expires'].every((k) => typeof r[k] === 'string')) throw new Error('not a preview');
      if (r.run !== undefined && !(isObj(r.run) && typeof r.run.cmd === 'string' && (r.run.window === null || typeof r.run.window === 'string'))) throw new Error('not a preview: its run');
      if (r.down_since !== undefined && typeof r.down_since !== 'string') throw new Error('not a preview: its down_since');
      recs.push({ ...r, mtimeMs: st.mtimeMs });
    } catch (e) { previewBad?.(f, e); }
  }
  return recs;
}
// The raw writers, for a caller that already holds the record's lock (the tick, under tryLock).
export function writePreviewFile(rec) {
  const { mtimeMs, ...r } = rec;
  fs.mkdirSync(previewsDir(), { recursive: true });
  const tmp = `${previewFile(r.name)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(r, null, 2)}\n`);
  fs.renameSync(tmp, previewFile(r.name));
}
export const removePreviewFile = (name) => fs.rmSync(previewFile(name), { force: true });
// Everyone else's: under the record's lock, so the tick's look-then-write can't land between
// them and undo a stop (withLock isn't re-entrant: never call these from inside one).
export function writePreview(rec) {
  fs.mkdirSync(previewsDir(), { recursive: true });
  return withLock(previewFile(rec.name), () => writePreviewFile(rec));
}
export function removePreview(name) {
  fs.mkdirSync(previewsDir(), { recursive: true });
  return withLock(previewFile(name), () => removePreviewFile(name));
}
// What this project calls itself, and who is asking.
export const previewProject = () => loadSettings().project ?? path.basename(mainRoot);
export function previewLabel() {
  const label = flags.label === undefined ? '' : (flagStr('label') ?? '');
  if (UNSAFE_TEXT.test(label)) die('preview --label is one line of plain text');
  if (label.length > PREVIEW_LABEL_MAX) die(`preview --label is at most ${PREVIEW_LABEL_MAX} characters`);
  return label.trim();
}
// A port for a new registration: previewPortOk's rules, and none of the relays' range. That rule is
// for new ones only: readPreviews checks every record with previewPortOk, so one made before the
// range existed stays a preview (decision 3).
export function previewPort(v) {
  const port = /^\d+$/.test(String(v)) ? Number(v) : NaN;
  const ok = previewPortOk(port);
  if (ok !== true) die(`preview: ${v}: ${ok}`);
  if (RELAY_PORTS.includes(port)) die(`preview: ${v}: ${port} is where the dashboard's preview relays listen (${RELAY_PORTS[0]}-${RELAY_PORTS.at(-1)})`);
  // this checkout's own dashboard, when its port was saved: a relay for it would serve the dashboard under the owner's pointer
  // (a pinned port, which pickDashboardPort never saves, is settings.md's dashboard_port)
  if ([readNum(path.join(runDir, 'dashboard-port')), Number(loadSettings().dashboard_port)].includes(port)) die(`preview: ${v}: ${port} is this checkout's own dashboard`);
  return port;
}
// A dashboard of any checkout answering on the port (its hello), which is never a preview's app: a
// registration refuses it, and the relay won't serve it. One timed probe, a few hundred ms at most.
export async function previewPortIsDashboard(port) { return !!(await probeHello(port, 500)); }
// What other instances on this machine list, from the hub (one agent-written list among others,
// used only to pick a clear name). Two seconds at most: no hub, or a slow one, means no clash.
export function previewNamesElsewhere() {
  return new Promise((resolve) => {
    const none = new Set();
    let root;
    try { root = fs.realpathSync(mainRoot); } catch { return resolve(none); }
    const req = http.get({ host: '127.0.0.1', port: HUB_PORT, path: '/instances.json', timeout: 2000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin' } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 1024 * 1024) req.destroy(); });
      res.on('end', () => {
        try {
          const names = new Set();
          for (const i of JSON.parse(b)?.instances ?? []) if (i?.root !== root && Array.isArray(i?.previews)) for (const p of i.previews) if (typeof p?.name === 'string' && p.name.length <= 63) names.add(p.name);
          resolve(names);
        } catch { resolve(none); }
      });
    });
    const budget = setTimeout(() => { req.destroy(); resolve(none); }, 2000);
    req.on('timeout', () => { req.destroy(); resolve(none); });
    req.on('error', () => resolve(none));
    req.on('close', () => clearTimeout(budget));
  });
}
// The name this (project, session, label) goes by here, and the record it already has. A clash
// with another instance, or with another session's record here, takes the lowest free number; the
// suffix is the one thing about a name that is remembered, and only in the record that needs it.
export async function previewClaim(session, label) {
  const project = previewProject();
  const recs = readPreviews();
  const base = previewName(project, session, label);
  const mine = recs.find((r) => r.project === project && r.session === session && r.label === label && (r.name === base || r.name.startsWith(`${base}-`)));
  if (mine) return { name: mine.name, had: mine };
  if (recs.length >= PREVIEW_MAX) die(`preview: at most ${PREVIEW_MAX} previews on an instance; stop one first (devteam.mjs preview list)`);
  const taken = new Set([...recs.map((r) => r.name), ...await previewNamesElsewhere()]);
  if (!taken.has(base)) return { name: base, had: null };
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return { name: `${base}-${n}`, had: null };
  die(`preview: ${base} and every numbered name after it are taken on this box`);
}
// Never rejects: a port net.connect won't take (a record planted by hand) is just nobody answering.
export const probePort = async (port) => { try { return (await answers(port, '127.0.0.1')) || (await answers(port, '::1')); } catch { return false; } };
// The box's address when this machine has one, and whether its gateway serves previews: only the
// release that does sets DEVTEAM_PREVIEWS, so the kit never prints a link that would answer 421.
/* preview box start */
export function previewBox() {
  try { return process.env.DEVTEAM_PUBLIC_URL ? new URL(process.env.DEVTEAM_PUBLIC_URL) : null; } catch { return null; }
}
/* preview box end */
export const previewServed = () => !!previewBox() && process.env.DEVTEAM_PREVIEWS === '1';
export const previewLink = (r) => { const b = previewBox(); return previewServed() ? `${b.protocol}//${r.name}.${b.host}` : `http://127.0.0.1:${r.port}`; };
export function previewSay(r, up) {
  if (previewServed()) {
    out(`preview ${r.name} is live at ${previewLink(r)} (${up ? `port ${r.port} answers` : `nothing answers on port ${r.port} yet; the link works once it does`})`);
    out('Only the signed-in owner can open it. Name it in your review request; it is in the owner\'s Library too.');
  } else {
    out(`preview ${r.name} is at ${previewLink(r)} (open it on this machine; there is no gateway here)`);
    if (previewBox()) out('this box\'s gateway doesn\'t serve previews yet: it needs the release that does');
    if (!up) out(`Nothing answers on port ${r.port} yet; the link works once it does.`);
    out('Name it in your review request; it is in the owner\'s Library too.');
  }
  out(`Stop it: devteam.mjs preview stop ${r.name}`);
}
export const previewNamed = (name) => readPreviews().find((r) => r.name === name) ?? die(`no preview "${name}" on this instance (devteam.mjs preview list)`);
export const previewFresh = (rec) => { const at = nowIso(); return { ...rec, at, expires: new Date(Date.parse(at) + PREVIEW_TTL).toISOString() }; };
// The windows of this project's tmux session. A window id is unique only within one server's life
// (a box reboot starts again at @0), so a stored id is trusted only with its name and start path.
export const PREVIEW_PANES = ['-F', '#{window_id}\t#{window_name}\t#{pane_start_path}'];
export const previewPaneRows = (text) => (text ?? '').split('\n').filter(Boolean).map((l) => { const [id, name, start] = l.split('\t'); return { id, name, start }; });
export function previewPanes() {
  const session = tmuxSession();
  // list-panes -s answers for another session when this one doesn't exist (ourWindows)
  if (sh('tmux', ['has-session', '-t', `=${session}`]) === null) return [];
  return previewPaneRows(sh('tmux', ['list-panes', '-s', '-t', `=${session}`, ...PREVIEW_PANES]));
}
export function previewWindow(rec, panes = previewPanes()) {
  const id = rec.run?.window;
  if (typeof id !== 'string' || !/^@\d+$/.test(id)) return null;
  return panes.find((p) => p.id === id && p.name === `dev~${rec.name}` && realPath(p.start) === realPath(rec.cwd)) ?? null;
}
export function killPreviewWindow(rec, panes) {
  const w = previewWindow(rec, panes);
  if (w) tmux(['kill-window', '-t', w.id]);
  return !!w;
}
// The kit's own line, printed when the command ends: a window closes with its process, and what
// the command printed is the whole point of reporting that it failed. It stays half a minute.
export const PREVIEW_EXITED = '[devteam] the command exited with status';
// In a window of its own, with PORT on the command line (a new window doesn't inherit this shell's
// environment, and -e needs tmux 3.2), and this shell's PATH, or a project's pinned tools aren't
// found. Written with window null first, so a tick that sees the new window doesn't take it for
// an orphan, and the id after. run.env (the browser's daemon) adds NAME=value words after PATH,
// each a plain name with a value holding no NUL: separate argv words, so no shell quoting.
export function launchPreviewWindow(rec) {
  const cmd = rec.run.cmd.split('{port}').join(String(rec.port));
  const extra = isObj(rec.run.env) ? Object.entries(rec.run.env).filter(([k, v]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === 'string' && !v.includes('\0')).map(([k, v]) => `${k}=${v}`) : [];
  // A record with env (the browser's) starts from an empty environment: the tmux server's own can hold
  // secrets. One without keeps today's argv.
  const argv = ['env', ...(isObj(rec.run.env) ? ['-i'] : []), `PORT=${rec.port}`, `PATH=${process.env.PATH ?? ''}`, ...extra, 'sh', '-c', `sh -c "$1"; s=$?; printf '\\n${PREVIEW_EXITED} %s\\n' "$s"; sleep 30`, 'sh', cmd];
  writePreview({ ...rec, run: { ...rec.run, window: null } });
  const session = tmuxSession({ save: true });
  const name = `dev~${rec.name}`;
  const open = ['-d', '-P', '-F', '#{window_id}', '-n', name, '-c', rec.cwd, ...argv];
  const id = sh('tmux', tmux(['has-session', '-t', `=${session}`]) ? ['new-window', '-t', `=${session}:`, ...open] : ['new-session', '-s', session, ...open], { env: tmuxServerEnv() });
  if (!id) return null;
  const r = { ...rec, run: { ...rec.run, window: id } };
  writePreview(r);
  return r;
}
// Up to 60 s for the port to answer, watching the window: gone, or its last line the kit's, means
// the command ended.
export async function previewAwait(rec) {
  const end = Date.now() + 60000;
  for (;;) {
    if (await probePort(rec.port)) return { up: true };
    const text = sh('tmux', ['capture-pane', '-p', '-t', rec.run.window]);
    if (text === null || text.includes(PREVIEW_EXITED)) return { up: false, exited: true, text: text ?? '' };
    if (Date.now() > end) return { up: false, exited: false };
    await new Promise((r) => setTimeout(r, 250));
  }
}
// A port just given up takes a moment to answer no more.
export async function previewPortQuiet(port, ms = 3000) {
  const end = Date.now() + ms;
  while (await probePort(port)) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 100)); }
  return true;
}
export const PREVIEW_PICK = Array.from({ length: 100 }, (_, i) => 4400 + i);
export async function previewPickPort(name) {
  const held = new Set(readPreviews().filter((r) => r.name !== name).map((r) => r.port));
  for (const p of PREVIEW_PICK) if (!held.has(p) && previewPortOk(p) === true && (await portFree(p))) return p;
  die(`preview: no free port in ${PREVIEW_PICK[0]}-${PREVIEW_PICK.at(-1)}; pass --port`);
}
// Launch, wait, and say how it went; a command that ended before answering keeps its record, so
// the agent fixes it and runs preview start.
export async function previewRunIt(rec) {
  const r = launchPreviewWindow(rec);
  if (!r) die('preview: could not open a tmux window for it (is tmux installed?)');
  const w = await previewAwait(r);
  if (w.exited) {
    const tail = w.text.split('\n').filter((l) => !l.includes(PREVIEW_EXITED)).join('\n').trimEnd().split('\n').slice(-20).join('\n');
    process.stderr.write(`devteam: preview ${r.name}: the command exited before port ${r.port} answered; the record is kept, fix it and run devteam.mjs preview start ${r.name}\n${tail}\n`);
    process.exitCode = 1;
    return;
  }
  previewSay(r, w.up);
  out(`running in tmux window ${tmuxSession()}:dev~${r.name}; its output is there`);
}
// What hello and the Library say of one preview, every string capped: this goes into the hub's list.
export const previewCap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export const previewHelloRow = (r, up) => ({ name: previewCap(r.name, 63), port: r.port, project: previewCap(r.project, 63), session: previewCap(r.session, 80), label: browserPreviewShaped(r) ? "Supervisor's browser" : previewCap(r.label, PREVIEW_LABEL_MAX), at: previewCap(r.at, 40), up, run: !!r.run });
// --- the preview lens: framed by the viewer at <preview>/.devteam/lens, on the app's own origin, it
// reads the app's page for the viewer over postMessage (spec §7). On a box the gateway serves it; on a
// laptop the dashboard's relay does. Copied from cloud/gateway.mjs, never edited here: a test holds
// the two byte for byte. Plain ASCII, no backtick and no dollar sign before a brace.
export const PREVIEW_LENS = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Preview</title><style>html{touch-action:manipulation}html,body{margin:0;height:100%;overflow:hidden;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><!-- The sandbox is advisory: the same-origin app can lift it. frame-src 'self' is what keeps the app's frame on its own origin. -->
<iframe id="app" title="The app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock allow-downloads"></iframe><script>
(() => {
  'use strict';
  // devteam's preview lens. It is on the app's own origin, so it can read the app's page. It frames
  // the app, and answers the viewer that frames it, over postMessage, about what is where. It takes
  // only the viewer's questions (hello, hit, resolve, scroll-by, scroll-to, go), tells it only about
  // the app (ready, route, hit-reply, rects, key, errors), and holds nothing of the owner's.
  const CAPS = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024, route: 300, error: 200, errors: 3 };
  const WATCH_MAX = 200;
  const KEY_MAX = 120;
  const frame = document.getElementById('app');
  const enc = new TextEncoder();
  const size = (s) => enc.encode(s).length;
  // at most n bytes of UTF-8, never half a character
  const cap = (s, n) => {
    const str = String(s == null ? '' : s);
    if (size(str) <= n) return str;
    let out = '';
    let b = 0;
    for (const c of str) { const k = size(c); if (b + k > n) break; out += c; b += k; }
    return out;
  };
  const capDots = (s, n) => (size(s) <= n ? s : cap(s, n - 3) + '\u2026');
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => typeof v === 'number' && isFinite(v);
  const idOk = (id) => (typeof id === 'string' && id.length > 0 && id.length <= 64) || (Number.isInteger(id) && id >= 0);

  // --- the viewer: the page that frames this one, and only it ----------------------------------
  // This page's frame-ancestors says who that may be. Here: a message must come from that frame
  // (never the app, which shares this origin), and from the origin first heard.
  let viewer = null;
  const tell = (m) => { if (viewer) parent.postMessage(Object.assign({ lens: 1 }, m), viewer); };

  // --- the app ----------------------------------------------------------------------------------
  const appWindow = () => { try { const w = frame.contentWindow; return w && w.document && w.location.href !== 'about:blank' ? w : null; } catch (e) { return null; } };
  const routeOf = (w) => { try { return w.location.origin === location.origin ? cap(w.location.pathname + w.location.search + w.location.hash, CAPS.route) : null; } catch (e) { return null; } };
  // a path on this origin, and never the lens's own
  const safeRoute = (r) => {
    if (typeof r !== 'string' || r[0] !== '/' || r[1] === '/' || r.indexOf('\\') >= 0 || size(r) > 2048) return null;
    try { const u = new URL(r, location.origin); return u.origin === location.origin && u.pathname.indexOf('/.devteam/') !== 0 ? u.pathname + u.search + u.hash : null; } catch (e) { return null; }
  };

  // --- what is where ------------------------------------------------------------------------------
  // an id or a class a person wrote, not one a build made (digit runs, hashes, React's :r1:)
  const plain = (s) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s) && !/[0-9]{3,}/.test(s) && !s.split(/[-_]/).some((p) => p.length >= 5 && /[0-9]/.test(p) && /[A-Za-z]/.test(p));
  const only = (doc, sel) => { try { return doc.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const quoted = (v) => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
  const selectorOf = (el, doc) => {
    const tag = el.localName;
    if (el.id && plain(el.id) && only(doc, '#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const [n, ok] of [['data-testid', true], ['name', /^(input|select|textarea|button|form)$/.test(tag)], ['aria-label', true]]) {
      const v = el.getAttribute(n);
      const sel = v ? tag + '[' + n + '=' + quoted(v) + ']' : '';
      if (ok && v && size(sel) <= CAPS.selector && only(doc, sel)) return sel;
    }
    const steps = [];
    for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement && steps.length < 6; e = e.parentElement) {
      if (e !== el && e.id && plain(e.id) && only(doc, '#' + CSS.escape(e.id))) { steps.unshift('#' + CSS.escape(e.id)); break; }
      let n = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === e.localName) n += 1;
      steps.unshift(e.localName + Array.prototype.filter.call(e.classList, plain).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('') + ':nth-of-type(' + n + ')');
    }
    while (steps.length > 1 && size(steps.join(' > ')) > CAPS.selector) steps.shift();
    return cap(steps.join(' > '), CAPS.selector);
  };
  const ROLES = { button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem', dialog: 'dialog', aside: 'complementary', section: 'region', option: 'option', summary: 'button' };
  const INPUTS = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox' };
  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.localName;
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'input') return INPUTS[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    return ROLES[t] || '';
  };
  const nameOf = (el, doc) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    const named = by ? by.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? x.textContent : ''; }).join(' ') : '';
    if (oneLine(named)) return named;
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    for (const n of ['alt', 'title', 'placeholder']) { const v = el.getAttribute(n); if (v) return v; }
    return el.textContent;
  };
  // the element with its own children, each child's contents collapsed to an ellipsis
  const htmlOf = (el) => {
    const top = el.cloneNode(false);
    let k = 0;
    for (const c of el.childNodes) {
      if (++k > 50) { top.appendChild(el.ownerDocument.createTextNode('\u2026')); break; }
      if (c.nodeType === 3) top.appendChild(c.cloneNode(false));
      else if (c.nodeType === 1) { const d = c.cloneNode(false); if (c.firstChild) d.textContent = '\u2026'; top.appendChild(d); }
    }
    return capDots(top.outerHTML, CAPS.html);
  };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textOf = (el) => cap(oneLine(el.textContent), CAPS.text);
  const anchorOf = (el, doc, x, y) => {
    const rect = rectOf(el);
    return { selector: selectorOf(el, doc), tag: cap(el.localName, CAPS.tag), role: cap(roleOf(el), CAPS.role), text: textOf(el), name: cap(oneLine(nameOf(el, doc)), CAPS.name), html: htmlOf(el), rect, point: { x: Math.round(x - rect.x), y: Math.round(y - rect.y) } };
  };
  // Where an anchor is now: by its selector (changed: with other text now), else an element of its
  // tag with its text, the nearest to where it was.
  const find = (doc, a) => {
    let el = null;
    try { el = doc.querySelector(a.selector); } catch (e) { el = null; }
    if (el) { const t = textOf(el); return { el, changed: typeof a.text === 'string' && t !== a.text, text: t }; }
    if (typeof a.text !== 'string' || !a.text || typeof a.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.tag)) return null;
    const was = a.rect && num(a.rect.x) && num(a.rect.y) ? a.rect : { x: 0, y: 0 };
    const all = doc.getElementsByTagName(a.tag);
    let best = null;
    let far = Infinity;
    for (let i = 0; i < all.length && i < 5000; i++) {
      if (textOf(all[i]) !== a.text) continue;
      const r = all[i].getBoundingClientRect();
      const d = Math.hypot(r.left - was.x, r.top - was.y);
      if (d < far) { far = d; best = all[i]; }
    }
    return best ? { el: best, changed: false, text: a.text } : null;
  };

  // --- what the viewer watches: sent when it moves --------------------------------------------
  let watched = [];
  let sent = '';
  const sendRects = (id) => {
    const w = appWindow();
    const rects = watched.map((x) => { const f = w ? find(w.document, x.anchor) : null; return f ? { key: x.key, rect: rectOf(f.el), changed: f.changed, text: f.text } : { key: x.key, rect: null }; });
    const now = JSON.stringify(rects);
    if (id === undefined && now === sent) return;
    sent = now;
    tell(id === undefined ? { type: 'rects', rects } : { type: 'rects', id, rects });
  };
  let framePending = false;
  const soon = () => { if (framePending || !watched.length) return; framePending = true; requestAnimationFrame(() => { framePending = false; sendRects(); }); };
  let settle = 0;
  const later = () => { if (!watched.length) return; clearTimeout(settle); settle = setTimeout(() => sendRects(), 100); };

  // --- what the app does: its route, its keys, its errors ----------------------------------------
  let route = null;
  const checkRoute = () => { const w = appWindow(); const r = w ? routeOf(w) : null; if (r === route) return; route = r; tell({ type: 'route', route: r }); soon(); };
  let errors = [];
  const describe = (x) => { try { return x && typeof x === 'object' && 'message' in x ? String(x.message) : String(x); } catch (e) { return 'an error'; } };
  const noteError = (text) => { const one = cap(oneLine(text), CAPS.error); if (!one) return; errors = errors.concat(one).slice(-CAPS.errors); tell({ type: 'errors', errors }); };
  let shiftDown = false;
  const onKey = (e) => {
    if (e.key !== 'Shift' && e.key !== 'Escape') return;
    shiftDown = e.type === 'keydown' ? e.key === 'Shift' || e.shiftKey : e.key !== 'Shift' && e.shiftKey;
    tell({ type: 'key', key: e.key, shift: shiftDown, ...(e.type === 'keyup' ? { up: true } : {}) });
  };
  const onBlur = () => { if (shiftDown) { shiftDown = false; tell({ type: 'key', key: 'Shift', shift: false }); } };
  const readyOf = (w) => (w ? { type: 'ready', route: routeOf(w), title: cap(oneLine(w.document.title), CAPS.text), viewport: { w: w.innerWidth, h: w.innerHeight } } : { type: 'ready', route: null, title: '', viewport: null });
  // Each page the app loads is a new window: listen on it, in the capture phase so the app can't stop
  // a key reaching here, and note the errors it logs from then on.
  let attached = null;
  const attach = () => {
    const w = appWindow();
    if (!w || w.document === attached) return;
    attached = w.document;
    errors = [];
    try {
      w.addEventListener('keydown', onKey, true);
      w.addEventListener('keyup', onKey, true);
      w.addEventListener('blur', onBlur);
      w.addEventListener('error', (e) => { if (e && e.message) noteError(e.message); }, true);
      w.addEventListener('unhandledrejection', (e) => noteError('Unhandled rejection: ' + describe(e.reason)));
      const own = w.console && w.console.error;
      if (typeof own === 'function') w.console.error = function () { noteError(Array.prototype.map.call(arguments, describe).join(' ')); return own.apply(this, arguments); };
      w.addEventListener('scroll', soon, true);
      w.addEventListener('resize', soon);
      w.addEventListener('popstate', checkRoute);
      w.addEventListener('hashchange', checkRoute);
      new w.MutationObserver(later).observe(w.document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) { /* a page that can't be watched is still framed */ }
    route = routeOf(w);
    tell(readyOf(w));
    sendRects();
  };

  // --- the viewer's questions ----------------------------------------------------------------------
  let last = { x: 0, y: 0 };
  const ORDERS = {
    hello: () => { tell(readyOf(appWindow())); if (errors.length) tell({ type: 'errors', errors }); },
    hit: (m) => {
      if (!idOk(m.id) || !num(m.x) || !num(m.y)) return;
      const w = appWindow();
      const doc = w && w.document;
      let el = doc ? doc.elementFromPoint(m.x, m.y) : null;
      // the page itself is no thing to point at: the viewer pins the point instead
      if (el && (el === doc.documentElement || el === doc.body)) el = null;
      last = { x: m.x, y: m.y };
      const anchor = el ? anchorOf(el, doc, m.x, m.y) : null;
      tell({ type: 'hit-reply', id: m.id, anchor, rect: anchor ? anchor.rect : null, route: w ? routeOf(w) : null });
    },
    resolve: (m) => {
      if (!idOk(m.id) || !Array.isArray(m.anchors)) return;
      watched = m.anchors.slice(0, WATCH_MAX).filter((x) => x && typeof x.key === 'string' && size(x.key) <= KEY_MAX && x.anchor && typeof x.anchor === 'object' && typeof x.anchor.selector === 'string' && size(x.anchor.selector) <= CAPS.selector).map((x) => ({ key: x.key, anchor: x.anchor }));
      sendRects(m.id);
    },
    'scroll-by': (m) => {
      const w = appWindow();
      if (!w) return;
      const step = (v) => (num(v) ? Math.max(-10000, Math.min(10000, v)) : 0);
      const at = num(m.x) && num(m.y) ? { x: m.x, y: m.y } : last;
      // the box under the pointer that scrolls, else the page
      for (let el = w.document.elementFromPoint(at.x, at.y); el && el !== w.document.body && el !== w.document.documentElement; el = el.parentElement) {
        const s = w.getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY + ' ' + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) { el.scrollBy(step(m.dx), step(m.dy)); return; }
      }
      w.scrollBy(step(m.dx), step(m.dy));
    },
    'scroll-to': (m) => {
      const w = appWindow();
      const a = m.anchor;
      if (!w || !a || typeof a !== 'object' || typeof a.selector !== 'string' || size(a.selector) > CAPS.selector) return;
      const f = find(w.document, a);
      if (f) f.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    go: (m) => { const r = safeRoute(m.route); if (r) frame.src = r; },
  };
  addEventListener('message', (e) => {
    if (!e.isTrusted) return;
    if (e.source !== parent || parent === window) return;
    if (e.origin === location.origin || e.origin === 'null') return;
    const ancestors = location.ancestorOrigins;
    if (ancestors && ancestors.length && ancestors[0] !== e.origin) return;
    if (viewer && e.origin !== viewer) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.lens !== 1 || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(ORDERS, m.type)) return;
    viewer = e.origin;
    try { ORDERS[m.type](m); } catch (err) { /* one bad question costs only itself */ }
  });
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  // the poll can find a page mid-parse (no title yet): its load says ready again, whatever attach did
  frame.addEventListener('load', () => { attach(); const w = appWindow(); if (w) tell(readyOf(w)); checkRoute(); });
  // an SPA's pushState can't be seen without touching its code: the route is polled
  setInterval(() => { attach(); checkRoute(); }, 250);
  setInterval(() => { if (watched.length) sendRects(); }, 1000);
  frame.src = safeRoute(new URLSearchParams(location.search).get('route')) || '/';
})();
</script></body></html>
`;
// Its policy: its one script and its one style by hash, its own origin to frame, and who may hold it.
export const previewLensPart = (tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(PREVIEW_LENS)[1];
export const previewLensHash = (tag) => `'sha256-${crypto.createHash('sha256').update(previewLensPart(tag)).digest('base64')}'`;
export const previewLensCsp = (ancestors) => `default-src 'none'; script-src ${previewLensHash('script')}; style-src ${previewLensHash('style')}; frame-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;
// The frame-ancestors directive of each policy in a header, and who may frame the page, replaced in
// every policy that says: the gateway's own (a test holds them equal), for the relay's one relaxation.
export const FRAME_ANCESTORS = /(^|[;,])(\s*)frame-ancestors(?=[\s;,]|$)([^;,]*)/gi;
export const replaceFrameAncestors = (csp, sources) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => `${sep}${sp}frame-ancestors ${sources}${/\s$/.test(list) ? ' ' : ''}`);
// Where a laptop dashboard's preview relays listen, one per preview its viewer has opened (spec §7):
// off the instance block and PREVIEW_PICK, and no new preview may take one (previewPort).
// DEVTEAM_RELAY_PORTS (low-high) is for tests, each in a range of its own.
export const RELAY_PORTS = (() => {
  const m = /^(\d{4,5})-(\d{4,5})$/.exec(process.env.DEVTEAM_RELAY_PORTS ?? '');
  const [lo, hi] = m && Number(m[1]) >= 1024 && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 65535 ? [Number(m[1]), Number(m[2])] : [4800, 4899];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
})();
// The frames a page may be loaded in: a preview's is refused in another site's, as the gateway refuses it.
export const PREVIEW_FRAMED = ['iframe', 'frame', 'object', 'embed', 'fencedframe'];
// The dashboard's own: the last probe of each name. A preview command has no tick to ask, and
// dashboard-data is a child process, so the dashboard hands it over in the environment.
export const previewUp = new Map();
export const previewUpHere = () => { if (previewUpHere.seen === undefined) { try { previewUpHere.seen = JSON.parse(process.env.DEVTEAM_PREVIEW_UP ?? '{}'); } catch { previewUpHere.seen = {}; } } return previewUpHere.seen; };
export const tmuxAsync = (args) => new Promise((resolve) => execFile('tmux', args, { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' }, (err, stdout) => resolve(err ? null : stdout)));
export const previewAsIRead = (r) => { try { return fs.statSync(previewFile(r.name)).mtimeMs === r.mtimeMs; } catch { return false; } };
// The tick's write, held open for a test (DEVTEAM_PREVIEW_WRITE_DELAY_MS) so a stop can be put
// inside the window it guards: a <name>.json.writing marker, the wait, the write, and the marker
// gone only once the write is done. Unset, it is just the write.
export function previewWriteHook(name, write) {
  const delay = Number(process.env.DEVTEAM_PREVIEW_WRITE_DELAY_MS ?? 0);
  if (!(delay > 0)) return write();
  const marker = `${previewFile(name)}.writing`;
  fs.writeFileSync(marker, '');
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    return write();
  } finally {
    fs.rmSync(marker, { force: true });
  }
}
// The dashboard's housekeeping, every 10 s, and nowhere else (hello is a read: the operator runs
// it). Probes each port, keeps the answers for hello and the Library, and finishes what any crash
// left: expiry, a server gone for a day, a dev~ window with no record. It writes a record only when
// the file is as it read it, so a preview command that ran in between always wins; a skipped write
// happens next tick. No tmux call here blocks the process: the hub gives hello 300 ms.
export async function previewTick() {
  const recs = readPreviews();
  const ups = await Promise.all(recs.map((r) => probePort(r.port)));
  const delay = Number(process.env.DEVTEAM_PREVIEW_TICK_DELAY_MS ?? 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const session = tmuxSession();
  const panes = (await tmuxAsync(['has-session', '-t', `=${session}`])) === null ? [] : previewPaneRows(await tmuxAsync(['list-panes', '-s', '-t', `=${session}`, ...PREVIEW_PANES]));
  const kill = async (r) => { const w = previewWindow(r, panes); if (w) await tmuxAsync(['kill-window', '-t', w.id]); };
  const now = Date.now();
  const names = new Set();
  await Promise.all(recs.map(async (r, i) => {
    const up = ups[i];
    names.add(r.name);
    previewUp.set(r.name, up);
    const since = Date.parse(r.down_since ?? '');
    // an expiry that doesn't parse is past: a file nobody wrote through the kit never lives forever
    if (!(Date.parse(r.expires) > now) || (!r.run && !up && since && now - since > DAY)) {
      // the look and the removal under the record's lock, never waiting on it: a held one is next tick's
      fs.mkdirSync(previewsDir(), { recursive: true });
      const gone = tryLock(previewFile(r.name), () => previewAsIRead(r) && (removePreviewFile(r.name), true));
      if (!gone) return;
      await kill(r);
      previewUp.delete(r.name);
      return;
    }
    const want = up ? null : (Number.isNaN(since) ? nowIso() : r.down_since);
    if ((r.down_since ?? null) === want || !previewAsIRead(r)) return;
    const { down_since, ...rest } = r;
    // the look again and the write, under the lock a preview command takes: a stop can't land between them
    fs.mkdirSync(previewsDir(), { recursive: true });
    tryLock(previewFile(r.name), () => {
      if (!previewAsIRead(r)) return;
      previewWriteHook(r.name, () => writePreviewFile(want ? { ...rest, down_since: want } : rest));
    });
  }));
  for (const n of previewUp.keys()) if (!names.has(n)) previewUp.delete(n);
  // The windows were listed before these records are read, so a window opened since has its id in
  // a record, or a record still saying window null (the launch's first write).
  const live = new Map(readPreviews().map((r) => [r.name, r]));
  // On a shared tmux session (a legacy `devteam`, or tmux_session set) another project's windows
  // sit beside ours: only one started under this checkout is ours to judge.
  const shared = session === 'devteam' || !!loadSettings().tmux_session;
  const mine = `${realPath(mainRoot)}${path.sep}`;
  const seen = new Set();
  for (const w of panes) {
    if (!w.name.startsWith('dev~') || seen.has(w.id)) continue;
    seen.add(w.id);
    const r = live.get(w.name.slice(4));
    if (r?.run?.window === w.id) continue;
    if (r?.run && r.run.window === null && now - r.mtimeMs < 120000) continue;
    if (shared && !`${realPath(w.start)}${path.sep}`.startsWith(mine)) continue;
    await tmuxAsync(['kill-window', '-t', w.id]);
  }
  // a write that died between its temp file and the rename
  try { for (const f of fs.readdirSync(previewsDir())) if (f.endsWith('.tmp') && now - fs.statSync(path.join(previewsDir(), f)).mtimeMs > 3600000) fs.rmSync(path.join(previewsDir(), f), { force: true }); } catch {}
}
// A writer's previews when its session ends or parks. The worktree going takes the records too; a
// park keeps them, so the resumed session brings each back on the same name and port.
export function stopPreviewsOf(writer, { keepRecords }) {
  for (const r of readPreviews().filter((x) => x.session === writer)) {
    killPreviewWindow(r);
    if (!keepRecords) removePreview(r.name);
  }
}
// What a resumed session is told: each of its kit-started previews whose window is gone. The
// command is the session's own text, but a line in a prompt is one line.
export function previewsBlock(name) {
  const panes = previewPanes();
  const down = readPreviews().filter((r) => r.session === name && r.run && !UNSAFE_TEXT.test(`${r.run.cmd ?? ''}`) && !previewWindow(r, panes));
  if (!down.length) return null;
  return `## Previews\n\n${down.map((r) => `your preview ${r.name} (${r.run.cmd}, port ${r.port}) is not running; devteam.mjs preview start ${r.name} brings it back`).join('\n')}`;
}
export async function cmdPreview() {
  const [sub, arg] = positional;
  const listing = ['list', 'url', 'stop', 'start'].includes(sub);
  if (flags.run !== undefined && sub !== undefined) die('preview takes either a port or --run "<command>"');
  if (sub === 'list') {
    const recs = readPreviews();
    const rows = await Promise.all(recs.map(async ({ mtimeMs, ...r }) => ({ ...r, up: await probePort(r.port) })));
    if (flags.json) return json(rows);
    if (!rows.length) return out('no previews');
    for (const r of rows) {
      const label = browserPreviewShaped(r) ? "Supervisor's browser" : r.label;
      out(`${r.name}  port ${r.port}  ${r.up ? 'answers' : 'not answering'}  ${r.session}${label ? ` (${label})` : ''}  ${previewLink(r)}`);
    }
    return undefined;
  }
  if (sub === 'url') {
    if (arg) return out(previewLink(previewNamed(arg)));
    const session = logWriter();
    const mine = readPreviews().filter((r) => r.session === session);
    if (mine.length !== 1) die(mine.length ? `preview url: you have ${mine.length} previews; name one (${mine.map((r) => r.name).join(', ')})` : 'preview url: you have no preview here (devteam.mjs preview <port>)');
    return out(previewLink(mine[0]));
  }
  if (sub === 'stop') {
    if (flags.all) {
      const session = logWriter();
      const mine = readPreviews().filter((r) => r.session === session);
      // the caller's browser record as browser stop stops it (Chrome too), the others as ever
      for (const r of mine) {
        if (browserIsPreview(r)) await browserStop({ say: false, rec: r });
        else { killPreviewWindow(r); removePreview(r.name); }
      }
      return out(`stopped ${mine.length} preview${mine.length === 1 ? '' : 's'}`);
    }
    const r = previewNamed(arg ?? die('usage: preview stop <name> | --all'));
    // the browser's record is browser stop, whoever's writer runs it: stopping takes nothing from anyone
    if (browserIsPreview(r)) {
      // the line only when Chrome was stopped: a failed kill has said why and set exit 1
      if (await browserStop({ say: false, rec: r })) out(`preview ${r.name} stopped, and the supervisor's browser with it`);
      return undefined;
    }
    const killed = killPreviewWindow(r);
    removePreview(r.name);
    return out(`preview ${r.name} stopped${killed ? ' and its server shut down' : r.run ? '' : ' (unregistered; the server is yours to stop)'}`);
  }
  if (sub === 'start') {
    const r = previewNamed(arg ?? die('usage: preview start <name>'));
    // the browser's record is browser start: its gates first (a worker refused before anything
    // starts), then the start lock, the memory check and a fresh environment from this caller
    if (browserIsPreview(r)) {
      browserGates({ chrome: true });
      const s = await browserEnsure();
      return out(`browser running (preview ${s.preview}, profile ${browserKey()})`);
    }
    if (!r.run) die(`preview ${r.name} has no command to run: it is a server you run yourself. Start it, then devteam.mjs preview ${r.port}${r.label ? ` --label "${r.label}"` : ''}`);
    if (!fs.existsSync(r.cwd)) die(`preview ${r.name}: its folder ${r.cwd} is gone`);
    killPreviewWindow(r);
    if (!(await previewPortQuiet(r.port))) die(`preview ${r.name}: something else answers on port ${r.port}; stop it first`);
    return previewRunIt(previewFresh(r));
  }
  if (flags.run !== undefined) {
    const cmd = flagStr('run') ?? '';
    if (!cmd.trim()) die('preview --run needs a command');
    if (/[\r\n\0]/.test(cmd)) die('preview --run is one line');
    const session = logWriter();
    const label = previewLabel();
    // previewClaim keys on the label: this one would take over the browser's record and kill its window
    if (label === 'browser') die("preview: the label browser is the supervisor's browser's; pick another");
    const { name, had } = await previewClaim(session, label);
    if (had?.run) killPreviewWindow(had);
    let port;
    if (flags.port !== undefined) {
      port = previewPort(flagStr('port'));
      if (await previewPortIsDashboard(port)) die(`preview: ${port} is a devteam dashboard`);
      if (!(await previewPortQuiet(port))) die(`preview: something already answers on port ${port}; stop it, or leave out --port and the kit picks one`);
    } else if (had?.run && PREVIEW_PICK.includes(had.port) && (await previewPortQuiet(had.port))) port = had.port;
    else port = await previewPickPort(name);
    return previewRunIt(previewFresh({ v: 1, name, project: previewProject(), session, label, port, cwd: process.cwd(), run: { cmd, window: null } }));
  }
  if (sub !== undefined && !listing) {
    const port = previewPort(sub);
    if (await previewPortIsDashboard(port)) die(`preview: ${port} is a devteam dashboard`);
    const session = logWriter();
    const label = previewLabel();
    if (label === 'browser') die("preview: the label browser is the supervisor's browser's; pick another");
    const { name, had } = await previewClaim(session, label);
    // The kit's own window stays only while it is what's on this port; a window with no record
    // to answer for it would be swept by the next tick anyway.
    const keep = had?.run && had.port === port && previewWindow(had) ? { run: had.run } : {};
    if (had?.run && !keep.run) killPreviewWindow(had);
    const r = previewFresh({ v: 1, name, project: previewProject(), session, label, port, cwd: keep.run ? had.cwd : process.cwd(), ...keep });
    writePreview(r);
    return previewSay(r, await probePort(port));
  }
  die('usage: preview <port> [--label "<one line>"] | preview --run "<command>" [--port <p>] [--label …] | preview list [--json] | preview url [<name>] | preview stop <name> | --all | preview start <name>');
}

