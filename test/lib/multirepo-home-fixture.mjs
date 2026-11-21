// What multirepo-home.*.test.mjs share. Several repos, one home: the fixture, home's kit and run
// directory, repo(), lines per repo, and a ticket's records kept in home.
import fs from 'node:fs';
import path from 'node:path';
import { json, multiFixture, review, write } from './kit.mjs';

// Records in home (links.<id>.records "home"): a link ticket's spec, plan, verification and
// reviews live on home's ticket/<id>, in home's project folder; only its code is in the link.
const SUP = { DEVTEAM_ROLE: 'supervisor' };
function recordsFixture(name, linkExtra = {}) {
  const F = multiFixture(name);
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, records: 'home', ...linkExtra } } });
  return F;
}
// home's ticket/<id> in a worktree of home: the records the worker keeps there
function homeRecords(F, id, files, { push = true } = {}) {
  const rw = path.join(F.old, '.worktrees', `records-${id}`);
  if (!fs.existsSync(rw)) F.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, 'origin/main'], F.old);
  for (const [f, text] of Object.entries(files)) write(path.join(rw, 'docs/devteam/project/tickets', id, f), text);
  F.g(['add', '-A'], rw); F.g(['commit', '-qm', `${id}: records`], rw);
  if (push) F.g(['push', '-q', 'origin', `ticket/${id}`], rw);
  return { rw, sha: F.g(['rev-parse', 'HEAD'], rw) };
}

// A records-in-home console ticket ready to merge: code only on console's ticket/<id>, records
// (spec, plan, verification, then a final review naming both heads) on home's ticket/<id>.
const VERIF = '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n';
function readyInHome(F, id, { reviewer = 'reviewer-b' } = {}) {
  const { old, g, okIn, ticket } = F;
  ticket(id);
  const w = path.join(old, '.worktrees', id);
  g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
  write(path.join(w, 'src/main.js'), `${id}\n`);
  g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
  const code = g(['rev-parse', 'HEAD'], w);
  const rec = homeRecords(F, id, { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF });
  okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
  okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
  const final = homeRecords(F, id, { 'reviews/final-1.md': `- Records: ${rec.sha}\n${review(reviewer, code)}` });
  write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
  return { w, code, rw: rec.rw, reviewed: rec.sha, head: final.sha };
}
// one commit on a branch's worktree, then the check, then the commit undone (and pushed back)
function tryCommit(F, wt, files, fn) {
  const before = F.g(['rev-parse', 'HEAD'], wt);
  for (const [f, text] of Object.entries(files)) write(path.join(wt, f), text);
  F.g(['add', '-A'], wt); F.g(['commit', '-qm', 'try'], wt);
  try { fn(F.g(['rev-parse', 'HEAD'], wt)); } finally { F.g(['reset', '-q', '--hard', before], wt); }
}

export { homeRecords, readyInHome, recordsFixture, SUP, tryCommit, VERIF };
