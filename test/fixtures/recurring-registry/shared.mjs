// What test/recurring-registry.test.mjs and test/recurring-registry.landing.test.mjs share (kit-162,
// final-14 F2: the A15 landing tests run in a file of their own): the paths, a job of each kind,
// the jobs file as the kit writes it, and the per-test fixture (a monoFixture with a bare origin and
// forge "git", run through the kit's commands).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { monoFixture, write, json } from '../../lib/kit.mjs';

export const SUP = { DEVTEAM_ROLE: 'supervisor' };
export const QID = /q-[0-9]+-[0-9]+-supervisor/;
export const PROJ = 'docs/devteam/project';
export const JOBS = `${PROJ}/recurring.json`;
export const NOTES = `${PROJ}/notes.md`;
export const GIT_TIMEOUT = 30000;

// Jobs that hold RECURRING_ENTRY_SHAPE@1.
export const check = (extra = {}) => ({ kind: 'check', title: 'CI on main', what: 'the kit CI on main is green', every: '6h', run: 'gh run list --limit 1', ...extra });
export const chore = (extra = {}) => ({ kind: 'chore', title: 'Tidy branches', what: 'merged branches are gone', every: '1w', by: 'supervisor', prompt: 'Delete merged branches.', ...extra });

// The jobs file as the kit writes it.
export const jobsText = (j) => `${JSON.stringify(j, null, 2)}\n`;
// a JSON file in a checkout: {} when it is missing or doesn't read
export const jsonIn = (cwd, rel = JOBS) => { try { return JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8')); } catch { return {}; } };
// fn gets the file's jobs and changes them in place or returns new ones; null deletes the file
export const putJson = (cwd, rel, fn) => {
  const j = jsonIn(cwd, rel);
  const r = fn(j);
  const v = r === undefined ? j : r;
  const f = path.join(cwd, rel);
  if (v === null) fs.rmSync(f, { force: true }); else write(f, jobsText(v));
};
export const putJobs = (cwd, fn) => putJson(cwd, JOBS, fn);

// A fixture of its own per test; removed afterwards without touching any tmux server.
export function setup(name) {
  const F = monoFixture(`recur-${name}`);
  const { old } = F;
  const g = (args, cwd = old, env) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT, ...(env ? { env: { ...process.env, ...env } } : {}) }).trim();
  const text = (r) => `${r.out}\n${r.err}`;
  const run = (args, role = SUP, cwd = old) => { const r = F.run(cwd, args, role); return { ...r, text: text(r) }; };
  const ok = (args, role = SUP, cwd = old) => F.ok(cwd, args, role);
  // the fixture's checkout on main as origin has it (merges land on origin, not here)
  const syncMain = () => { g(['checkout', '-q', 'main']); g(['fetch', '-q', 'origin']); g(['merge', '-q', '--ff-only', 'origin/main']); };
  const pushMain = () => { g(['push', '-q', 'origin', 'main']); g(['fetch', '-q', 'origin']); };
  // main moves by hand (a commit pushed straight to origin): fn changes the checkout
  const onMainDo = (fn, msg = 'main moves') => { syncMain(); fn(old); g(['add', '-A']); g(['commit', '-q', '--allow-empty', '-m', msg]); pushMain(); };
  const onMain = (fn, msg = 'main: the jobs') => onMainDo((cwd) => putJobs(cwd, fn), msg);
  const onSettings = (fn, msg = 'main: settings') => onMainDo((cwd) => F.edit(fn, cwd), msg);
  const onMainFile = (rel, body, msg = 'main moves by another file') => onMainDo((cwd) => write(path.join(cwd, rel), body), msg);
  const has = (ref, rel) => { try { g(['cat-file', '-e', `${ref}:${rel}`]); return true; } catch { return false; } };
  const mainJobs = () => { g(['fetch', '-q', 'origin']); return has('origin/main', JOBS) ? JSON.parse(g(['show', `origin/main:${JOBS}`])) : {}; };
  const headOf = (branch) => { g(['fetch', '-q', 'origin']); return g(['rev-parse', `origin/${branch}`]); };
  // a question asked with the kit's rules for the class; returns { status, text, qid }
  const ask = (change, extra = []) => {
    const r = run(['ask', '--class', 'recurring-edit', '--question', 'Should I change these jobs?', '--recommendation', 'Yes', ...(change === undefined ? [] : ['--change', JSON.stringify(change)]), ...extra]);
    return { status: r.status, text: r.text, qid: r.status === 0 ? (QID.exec(r.out) ?? [null])[0] : null };
  };
  const asked = (change, extra) => { const r = ask(change, extra); assert.equal(r.status, 0, r.text); return r.qid; };
  const answer = (qid, words = 'Yes') => F.ok(old, ['answer', qid, words]);
  // an answered yes for this change
  const yes = (change) => { const q = asked(change); answer(q); return q; };
  // a chore branch off origin/main: fn edits its worktree, then it is committed (everything, unless
  // add is false: fn staged what it means), pushed and given its PR text
  const choreBranch = (slug, fn, { add = true } = {}) => {
    g(['fetch', '-q', 'origin']);
    const wt = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, wt, 'origin/main']);
    fn(wt);
    if (add) g(['add', '-A'], wt);
    g(['commit', '-q', '--allow-empty', '-m', `chore-${slug}: jobs`], wt);
    g(['push', '-q', '-f', 'origin', `chore-${slug}`], wt);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: jobs\n\n## One-way doors\n\nNone.\n`);
    return wt;
  };
  // a chore whose recurring.json is as fn leaves it (fn gets the jobs; null deletes the file)
  const jobsChore = (slug, fn) => choreBranch(slug, (wt) => putJobs(wt, fn));
  // one more commit on a branch's worktree, pushed
  const commitIn = (wt, branch, fn, msg) => { fn(wt); g(['add', '-A'], wt); g(['commit', '-q', '--allow-empty', '-m', msg], wt); g(['push', '-q', '-f', 'origin', branch], wt); };
  // main merged into a branch's worktree, pushed
  const mergeMainInto = (wt, branch) => { g(['fetch', '-q', 'origin'], wt); g(['merge', '-q', '--no-ff', '--no-edit', 'origin/main'], wt); g(['push', '-q', 'origin', branch], wt); };
  const merge = (slug, args = [], env = {}) => run(['merge', '--chore', slug, ...args], { ...SUP, ...env });
  const dry = (slug, q) => merge(slug, ['--dry-run', ...(q ? ['--approved', q] : [])]);
  const checkPr = (branch) => run(['check-pr', '--head-ref', branch, '--sha', headOf(branch), '--title', branch.startsWith('chore-') ? `${branch}: jobs` : 'x']);
  const acts = () => json(F.ok(old, ['log', '--type', 'act', '--json']));
  const logFile = (who) => { const d = path.join(old, 'docs/devteam/run/log'); return path.join(d, fs.readdirSync(d).find((f) => f.startsWith(`${who}-`))); };
  const done = () => { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(F.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  return { ...F, g, run, ok, text, syncMain, pushMain, onMainDo, onMain, onSettings, onMainFile, has, mainJobs, headOf, ask, asked, answer, yes, choreBranch, jobsChore, commitIn, mergeMainInto, merge, dry, checkPr, acts, logFile, done };
}
export const refused = (r, re) => { assert.notEqual(r.status, 0, r.text); if (re) assert.match(r.text, re); };
export const passes = (r) => assert.equal(r.status, 0, r.text);
