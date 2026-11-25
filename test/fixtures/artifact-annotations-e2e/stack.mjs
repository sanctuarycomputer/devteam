// The helpers of test/artifact-annotations-e2e.test.mjs (kit-146): the CLI runner every child goes
// through, the fixture builder (pricing at its planner's worktree, faq landed on main with a ticket
// draft and a chore draft), the no-sandbox Chrome wrapper's writer and the log reader. The PNG and ring
// checks are kit-147's (test/fixtures/artifact-shots/kit.mjs), imported, not copied.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export { png, near, ringAt } from '../artifact-shots/kit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PAGES = (name) => path.join(HERE, name);
export const SLUG = 'pricing', FAQ = 'faq', PLAN = 'plan-pricing', CHORE = 'chore-artifact-faq', OLD = 'x-01-old';
const J = JSON.stringify;
const artDir = (root, slug) => path.join(root, 'docs/devteam/project/artifacts', slug);

// who runs the command: the owner (the main checkout, no role), the supervisor (the same, with its role) or the planner
// (its worktree, its role and feature). Every child gets DEVTEAM_CHROME_NO_SANDBOX=1, then extra.
export function cli(F, who, args, extra = {}) {
  const roles = {
    owner: { cwd: F.old, env: {} },
    supervisor: { cwd: F.old, env: { DEVTEAM_ROLE: 'supervisor' } },
    planner: { cwd: path.join(F.old, '.worktrees', PLAN), env: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'pricing' } },
  };
  const r = roles[who];
  assert.ok(r, `cli: no such role ${who}`);
  const env = { ...r.env, DEVTEAM_CHROME_NO_SANDBOX: '1', ...extra };
  return F.run(r.cwd, args, env);
}
export function ok(F, who, args, extra) {
  const r = cli(F, who, args, extra);
  assert.equal(r.status, 0, `${who}: ${args.join(' ')}: ${r.err || r.out}`);
  return r.out;
}

// faq's page with its copy word set
const faqPage = (copy) => fs.readFileSync(path.join(PAGES('faq'), 'index.html'), 'utf8').replace(/(<meta name="copy" content=")[^"]*"/, `$1${copy}"`);
function writeFaq(root, copy) {
  const dir = artDir(root, FAQ);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(PAGES('faq'), 'artifact.json'), path.join(dir, 'artifact.json'));
  fs.writeFileSync(path.join(dir, 'index.html'), faqPage(copy));
}
const commit = (F, cwd, msg) => { F.g(['add', '-A', 'docs'], cwd); F.g(['commit', '-qm', msg], cwd); };

// pricing at plan-pricing only; faq main-1 on main (pushed, as the kit reads origin/main); a ticket
// worktree holding faq `old`; a chore worktree holding faq `chore`. landFaq(copy) lands another copy on main.
export function buildStack(F) {
  const wt = (name) => path.join(F.old, '.worktrees', name);
  const WT = wt(PLAN);
  F.g(['worktree', 'add', '-q', '-b', 'plan/pricing', WT, 'main'], F.old);
  fs.mkdirSync(artDir(WT, SLUG), { recursive: true });
  for (const f of fs.readdirSync(PAGES('pricing'))) fs.copyFileSync(path.join(PAGES('pricing'), f), path.join(artDir(WT, SLUG), f));
  commit(F, WT, 'pricing: draft');
  const landFaq = (copy) => { writeFaq(F.old, copy); commit(F, F.old, `faq: ${copy}`); F.g(['push', '-q', 'origin', 'main'], F.old); };
  landFaq('main-1');
  F.sup(['ticket', 'add', OLD, '--json', J({ title: 'An older faq', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['docs/**'], done_when: ['the faq is older'], notes: 'n' })]);
  for (const [name, branch, copy] of [[OLD, `ticket/${OLD}`, 'old'], [CHORE, 'chore/artifact-faq', 'chore']]) {
    F.g(['worktree', 'add', '-q', '-b', branch, wt(name), 'main'], F.old);
    writeFaq(wt(name), copy);
    commit(F, wt(name), `faq: ${copy}`);
  }
  return { WT, CHORE: wt(CHORE), OLD: wt(OLD), landFaq };
}

// the planner's change to the draft (pricing-2 over it), committed; the new HEAD
export function draftChange(F, WT) {
  const dir = artDir(WT, SLUG);
  for (const f of fs.readdirSync(PAGES('pricing-2'))) fs.copyFileSync(path.join(PAGES('pricing-2'), f), path.join(dir, f));
  commit(F, WT, 'pricing: draft 2');
  return F.g(['rev-parse', 'HEAD'], WT);
}

// a 0755 sh script that runs the real Chrome only when started with --no-sandbox
export function writeNoSandboxChrome(dir, real) {
  const file = path.join(dir, 'chrome-needs-no-sandbox');
  fs.writeFileSync(file, `#!/bin/sh\ncase " $* " in *" --no-sandbox "*) exec '${real}' "$@";; esac\nexit 1\n`, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return file;
}

// every line of the fixture's log files (F.logDir, the live log the planner's worktree shares or its own), read now
export function logLines(F) {
  const dirs = [F.logDir, path.join(F.old, '.worktrees', PLAN, 'docs/devteam/run/log')];
  return dirs.filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean)));
}

// the log line a mark wrote for thread id with the picture stamped stamp (an addressed message, or a ready's set), or null
export function markLine(F, id, stamp) {
  const all = logLines(F).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  return all.find((m) => m && m.shot?.stamp === stamp && ((m.type === 'message' && m.kind === 'addressed' && m.thread === id) || (m.type === 'thread' && m.op === 'set' && m.id === id))) ?? null;
}
