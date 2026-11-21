// What link-approved.*.test.mjs share. One yes per repo link change: an owner's answer binds the
// field changes its question showed, wherever the same change comes up again (link set|add|rm, link
// land, merge), and nothing else.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { json, multiFixture, write } from './kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const QID = /q-[0-9]+-[0-9]+-supervisor/;
const HEADER = 'This answer approves exactly these repo link changes, and no other:';
const blockOf = (text) => JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(text)[1]);

// The fixture plus what these tests share: questions, answers, main's history.
function setup(name) {
  const F = multiFixture(name);
  const { old, okIn, runIn } = F;
  const run = (args) => runIn(old, args, SUP);
  const ok = (args) => okIn(old, args, SUP);
  const ask = (args) => { const out = ok(args); return { out, qid: (QID.exec(out) ?? [null])[0] }; };
  const question = (qid) => json(okIn(old, ['questions', '--id', qid, '--json']))[0];
  const questionCount = () => json(okIn(old, ['log', '--type', 'question', '--json'])).length;
  const acts = () => json(okIn(old, ['log', '--type', 'act', '--json']));
  const yes = (qid) => okIn(old, ['answer', qid, 'yes']);
  const here = () => fs.readFileSync(F.settingsFile, 'utf8');
  const links = () => blockOf(here()).links;
  // the lines of a question's approves section: after the header, up to the first blank line
  const section = (ctx) => { const ls = ctx.split('\n'); const i = ls.indexOf(HEADER); if (i < 0) return null; const outL = []; for (const l of ls.slice(i + 1)) { if (!l.trim()) break; outL.push(l); } return outL; };
  // main moved by someone else: a clone of home's origin commits to main, dated `at`, and pushes;
  // the main checkout only fetches (its settings.md, with what link set wrote, stays as it is)
  const originUrl = F.g(['remote', 'get-url', 'origin'], old).trim();
  const clone = path.join(F.base, 'home-clone');
  const gitAt = (args, cwd, at) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...(at ? { GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at } : {}) } });
  const onMain = (fn, at, msg = 'main moves') => {
    if (!fs.existsSync(clone)) {
      gitAt(['clone', '-q', originUrl, clone], F.base);
      for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) gitAt(['config', k, v], clone);
    }
    gitAt(['pull', '-q', 'origin', 'main'], clone);
    F.edit(fn, clone);
    gitAt(['commit', '-qam', msg], clone, at);
    gitAt(['push', '-q', 'origin', 'HEAD:main'], clone);
    F.g(['fetch', '-q', 'origin'], old);
  };
  // a time n seconds after an answer (commit times are whole seconds; an answer in the same second counts)
  const after = (qid, n) => new Date(Date.parse(question(qid).answered_at) + n * 1000).toISOString();
  const logFile = () => { const d = path.join(old, 'docs/devteam/run/log'); return path.join(d, fs.readdirSync(d).find((f) => /^supervisor-/.test(f))); };
  return { ...F, run, ok, ask, question, questionCount, acts, yes, here, links, section, onMain, after, logFile };
}

// ask --link-change: the supervisor asks in its own words, the kit writes the lines the answer binds by
const ownWords = (T, change, cls = 'governance-edit') => T.ask(['ask', '--class', cls, '--question', 'May I make this registry change?', '--recommendation', 'yes', '--stake', '1', '--urgency', '2', '--link-change', JSON.stringify(change)]).qid;

// a chore off main: fn fills it (by default link land), then it is committed, pushed and given its PR text
const chore = (T, slug, fn = () => T.ok(['link', 'land', slug])) => {
  T.g(['fetch', '-q', 'origin'], T.old);
  const wt = path.join(T.old, '.worktrees', `chore-${slug}`);
  T.g(['worktree', 'add', '-q', '-b', `chore-${slug}`, wt, 'origin/main'], T.old);
  fn(wt);
  T.g(['add', '-A'], wt);
  T.g(['commit', '-q', '--allow-empty', '-m', `chore-${slug}: registry`], wt);
  T.g(['push', '-q', 'origin', `chore-${slug}`], wt);
  write(path.join(T.old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: registry\n\n## One-way doors\n\nNone.\n`);
  return wt;
};
const dry = (T, slug, qid) => { const r = T.run(['merge', '--chore', slug, '--dry-run', '--approved', qid]); return { status: r.status, text: `${r.out}\n${r.err}` }; };
const choreLinks = (wt) => blockOf(fs.readFileSync(path.join(wt, 'docs/devteam/project/settings.md'), 'utf8')).links;
const wouldMerge = (r, slug) => { assert.equal(r.status, 0, r.text); assert.match(r.text, new RegExp(`ok: chore-${slug} at \\w{12} would merge`)); assert.doesNotMatch(r.text, /already approved|did not approve/); };

export { chore, choreLinks, dry, HEADER, ownWords, setup, wouldMerge };
