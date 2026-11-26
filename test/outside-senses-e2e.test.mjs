// kit-131, end to end: a project draws project/self.md, then project/exterior.md, each landed only
// with the owner's answer of its own class, and both go stale as the strategy moves (OUT-S5); the
// supervisor's senses, described in markdown (project/senses.md and readings under project/senses/),
// change nothing the kit decides (OUT-S2). One fixture project, Tillstack (a checkout for independent
// shops that depends on Stripe, with Cartwell its alternative), walked through the way a supervisor
// would: chore start, the draft, self check or exterior check, chore pr, ask, the owner's answer,
// merge --chore. Each step is a subtest of the one walk, named for its check (E1…) in the spec's
// acceptance table, so one red step leaves the next to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, kit as KIT, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';

const P = 'docs/devteam/project';
const STRAT = `${P}/strategy.md`;
const SELF = `${P}/self.md`;
const EXT = `${P}/exterior.md`;
const FIX = (f) => fs.readFileSync(new URL(`./fixtures/outside-e2e/${f}`, import.meta.url), 'utf8');
const STRATEGY = FIX('strategy.md');
const SELF_MD = FIX('self.md');
const EXTERIOR_MD = FIX('exterior.md');
// kit-867: the next Exterior a pass drafts, and its change note beside the senses' readings
const EXTERIOR_2 = FIX('exterior-2.md');
const NOTE_2 = `${P}/senses/exterior-change-2.md`;
const CHANGE_NOTE = FIX('exterior-change-2.md');
// the strategy before the owner's names: no Cartwell
const UNNAMED = FIX('strategy-unnamed.md');
// the supervisor's senses: a page describing them and the readings they wrote
const SENSES = { [`${P}/senses.md`]: FIX('senses.md'), [`${P}/senses/daily-sales.md`]: FIX('senses/daily-sales.md'), [`${P}/senses/cartwell-pricing.md`]: FIX('senses/cartwell-pricing.md') };
// the code self.md's parts name, and Stripe as a dependency
const CODE = { 'src/checkout/page.js': 'export {};\n', 'src/payments/charge.js': 'export {};\n', 'package.json': `${JSON.stringify({ name: 'tillstack', dependencies: { stripe: '^17.0.0' } }, null, 2)}\n` };
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// The project: main holds the strategy (linking self.md) and the code, and no self.md, unless start
// says otherwise; a gh on PATH says acme/tillstack is private (or vis), as the supervisor would have found it.
function project({ name = 'outside-e2e', vis = 'PRIVATE', start = {} } = {}) {
  const F = fixture(name);
  const { old, g } = F;
  const bin = path.join(F.base, 'bin');
  g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/tillstack.git'], old);
  g(['remote', 'set-url', 'origin', 'https://github.com/acme/tillstack.git'], old);
  write(path.join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *acme/tillstack*) ;; *) exit 1 ;; esac\nif [ "$1 $2" = "repo view" ]; then echo ${vis}; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const ENV = { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (args, env = ENV) => { const r = F.run(old, args, env); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
  // a command run in another checkout, such as a chore's worktree (self check and exterior check read the working tree)
  const runIn = (cwd, args) => { const r = F.run(cwd, args, ENV); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
  const ok = (args, env) => { const r = run(args, env); assert.equal(r.status, 0, `${args.join(' ')}\n${r.text}`); return r.out; };
  // the owner's own command: no role
  const owner = (args) => ok(args, { PATH: ENV.PATH });
  const onMain = (changes, msg) => {
    for (const [rel, text] of Object.entries(changes)) {
      if (text === null) fs.rmSync(path.join(old, rel), { recursive: true, force: true });
      else write(path.join(old, rel), text);
    }
    g(['add', '-A'], old);
    g(['commit', '-qm', msg], old);
    g(['push', '-q', 'origin', 'main'], old);
  };
  onMain({ [STRAT]: STRATEGY, ...CODE, ...start }, 'tillstack');
  const blob = (rel) => g(['rev-parse', `origin/main:${rel}`], old);
  // a chore as the supervisor makes one: start it, change its worktree, chore pr; its head
  const chore = (slug, change) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    if (!fs.existsSync(w)) ok(['chore', 'start', slug]);
    change(w);
    ok(['chore', 'pr', slug, '--title', `${slug} draft`]);
    return g(['rev-parse', 'HEAD'], w);
  };
  // chore pr as it goes, refused or not (--names-checked words in more); and whether the branch is pushed
  const chorePr = (slug, change, more = []) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    if (!fs.existsSync(w)) ok(['chore', 'start', slug]);
    change(w);
    return run(['chore', 'pr', slug, '--title', `${slug} draft`, ...more]);
  };
  const pushed = (slug) => Boolean(g(['ls-remote', 'origin', `refs/heads/chore-${slug}`], old));
  const merge = (slug, q, dry = true) => run(['merge', '--chore', slug, ...(dry ? ['--dry-run'] : []), ...(q ? ['--approved', q] : [])]);
  const body = path.join(F.base, 'pr-body.md');
  write(body, 'x\n\n## One-way doors\n\nNone.\n');
  const checkPr = (slug, sha, q) => run(['check-pr', '--head-ref', `chore-${slug}`, '--sha', sha, '--title', `chore-${slug}: x`, '--body-file', body, ...(q ? ['--approved', q] : [])]);
  // ask the owner about the draft of rel on chore-<slug>, as supervisor.md says; the question's id
  // (a strategy-change names no chore: it lands in any PR its pinned text is the head of)
  let n = 0;
  const ask = (cls, rel, title, slug) => ok(['ask', '--question', `Approve this draft of ${title} (${++n})?`, '--recommendation', 'yes', '--stake', '3', '--urgency', '2',
    '--class', cls, '--reasons', 'owner-only', '--links', JSON.stringify([{ title, path: rel, ref: `chore-${slug}` }]), ...(cls === 'strategy-change' ? [] : ['--approves', `chore-${slug}`])]).trim();
  const answered = (cls, rel, title, slug) => { const q = ask(cls, rel, title, slug); owner(['answer', q, 'yes']); return q; };
  const metrics = () => json(ok(['metrics', '--json']));
  const findings = (kind) => metrics().findings.filter((f) => f.kind === kind);
  return { ...F, ENV, run, runIn, ok, owner, onMain, blob, chore, chorePr, pushed, merge, checkPr, ask, answered, metrics, findings };
}

// a draft check run in the chore's worktree: it read the draft (not "not drafted" or "nothing to check") and found no error
const checked = (r, m) => { assert.equal(r.status, 0, `${m}: exits 0\n${r.text}`); assert.doesNotMatch(r.text, /not drafted|nothing to check|error/, m); };
// a refusal: a non-zero exit and its own words
const refused = (r, pattern, m) => { assert.notEqual(r.status, 0, `${m}: exits non-zero\n${r.text}`); assert.match(r.text, pattern, m); };
const landed = (r, m) => assert.equal(r.status, 0, `${m}\n${r.text}`);

test('Tillstack draws self.md, then exterior.md, each landed only with the owner\'s answer; both go stale; its senses change nothing', async (t) => {
  const W = project();
  const check = (title, fn) => t.test(title, fn);
  try {
    await check('E1 a written strategy and no self.md: self-missing, and no exterior-missing', () => {
      const f = W.findings('self-missing');
      assert.equal(f.length, 1, `E1 one self-missing\n${JSON.stringify(f)}`);
      assert.equal(f[0].key, W.blob(STRAT), 'E1 keyed by the strategy\'s blob');
      assert.equal(f[0].severity, 'high', 'K1 self-missing is high until the owner is asked about a draft');
      assert.deepEqual(W.findings('exterior-missing'), [], 'E1 no exterior-missing without self.md');
    });

    // kit-814: what the owner has been asked sets self-missing's and exterior-missing's severity
    const severity = (kind) => W.findings(kind).map((f) => f.severity);
    let q0 = null;
    await check('K2 self-missing is medium while a self-change question is open', () => {
      W.chore('self-0', (w) => write(path.join(w, SELF), SELF_MD));
      q0 = W.ask('self-change', SELF, 'The Self', 'self-0');
      assert.deepEqual(severity('self-missing'), ['medium'], 'K2 medium while the owner reads the draft');
    });
    await check('K2b self-missing is high again after the owner refines it', () => {
      W.owner(['answer', q0, 'No: say what it makes first']);
      assert.deepEqual(severity('self-missing'), ['high'], 'K2b high again once the owner refines it');
    });

    let selfQ = null;
    await check('E2 self.md drawn from the code and the strategy: refused until the owner\'s self-change answer pins it, then lands', () => {
      const sha = W.chore('self', (w) => { write(path.join(w, SELF), SELF_MD); checked(W.runIn(w, ['self', 'check']), 'E2 the draft passes self check'); });
      refused(W.merge('self'), new RegExp(`changes ${re(SELF)}: .*the owner's answer is needed: ask --class self-change`), 'E2 no answer: merge refuses');
      assert.match(W.checkPr('self', sha).text, new RegExp(`warn: changes ${re(SELF)}: .*ask --class self-change`), 'E2 no answer: check-pr warns');
      selfQ = W.answered('self-change', SELF, 'The Self', 'self');
      // the answer pins the text asked about: a draft changed after it is refused, the same text back lands
      W.chore('self', (w) => write(path.join(w, SELF), `${SELF_MD}\nA line the owner never saw.\n`));
      refused(W.merge('self', selfQ), new RegExp(`${re(SELF)} at the head is not the text ${selfQ} asked the owner about`), 'E2 a draft changed after the answer is refused under it');
      const back = W.chore('self', (w) => write(path.join(w, SELF), SELF_MD));
      assert.notEqual(back, sha, 'E2 the text back is a new commit, not the one the answer was asked at');
      landed(W.checkPr('self', back, selfQ), 'E2 check-pr passes under the answer');
      landed(W.merge('self', selfQ, false), 'E2 merge --chore lands it under the answer');
      W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
      assert.equal(W.g(['show', `origin/main:${SELF}`], W.old), SELF_MD.trimEnd(), 'E2 main holds the approved self.md');
      assert.deepEqual(W.findings('self-missing'), [], 'E2 self-missing gone');
    });

    await check('K3a exterior-missing is high until the owner is asked about a draft', () => {
      assert.deepEqual(severity('exterior-missing'), ['high'], 'K3a high until the owner is asked about a draft');
    });
    let q1 = null;
    await check('K3 exterior-missing is medium while an exterior-change question is open', () => {
      W.chore('exterior-0', (w) => write(path.join(w, EXT), EXTERIOR_MD));
      q1 = W.ask('exterior-change', EXT, 'The exterior', 'exterior-0');
      assert.deepEqual(severity('exterior-missing'), ['medium'], 'K3 medium while the owner reads the draft');
    });
    await check('K3b exterior-missing is high again after the owner refines it', () => {
      W.owner(['answer', q1, 'No: name the shops first']);
      assert.deepEqual(severity('exterior-missing'), ['high'], 'K3b high again once the owner refines it');
    });

    let extQ = null;
    await check('E3 exterior.md drawn from both: exterior-missing until then; refused until an exterior-change answer pins it, then lands', () => {
      assert.equal(W.findings('exterior-missing').length, 1, 'E3 exterior-missing once main has self.md and a linking strategy');
      const sha = W.chore('exterior', (w) => { write(path.join(w, EXT), EXTERIOR_MD); checked(W.runIn(w, ['exterior', 'check']), 'E3 the draft passes exterior check'); });
      refused(W.merge('exterior'), new RegExp(`changes ${re(EXT)}: .*the owner's answer is needed: ask --class exterior-change`), 'E3 no answer: merge refuses');
      assert.match(W.checkPr('exterior', sha).text, new RegExp(`warn: changes ${re(EXT)}: .*ask --class exterior-change`), 'E3 no answer: check-pr warns');
      refused(W.merge('exterior', selfQ), new RegExp(`changing ${re(EXT)} needs an answered exterior-change question`), 'E3 the self-change answer does not land exterior.md');
      extQ = W.answered('exterior-change', EXT, 'The exterior', 'exterior');
      landed(W.checkPr('exterior', sha, extQ), 'E3 check-pr passes under the answer');
      landed(W.merge('exterior', extQ, false), 'E3 merge --chore lands it under the answer');
      W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
      assert.equal(W.g(['show', `origin/main:${EXT}`], W.old), EXTERIOR_MD.trimEnd(), 'E3 main holds the approved exterior.md');
      assert.deepEqual(W.findings('exterior-missing'), [], 'E3 exterior-missing gone');
      assert.deepEqual(W.findings('exterior-stale'), [], 'E3 not stale: drawn from main\'s strategy.md and self.md');
    });

    await check('E4 one PR changing both under one --approved is refused, whichever answer it cites', () => {
      // a new self.md and a new exterior.md in one chore
      const sha = W.chore('both', (w) => {
        write(path.join(w, SELF), `${SELF_MD}\nIt also prints receipts.\n`);
        write(path.join(w, EXT), `${EXTERIOR_MD}\nShops print their receipts.\n`);
      });
      const bySelf = W.answered('self-change', SELF, 'The Self', 'both');
      refused(W.merge('both', bySelf), new RegExp(`is a self-change question; changing ${re(EXT)} needs an answered exterior-change question`), 'E4 under the self-change answer, merge');
      refused(W.checkPr('both', sha, bySelf), new RegExp(`changing ${re(EXT)} needs an answered exterior-change question`), 'E4 under the self-change answer, check-pr');
      const byExt = W.answered('exterior-change', EXT, 'The exterior', 'both');
      refused(W.merge('both', byExt), new RegExp(`is an? exterior-change question; changing ${re(SELF)} needs an answered self-change question`), 'E4 under the exterior-change answer, merge');
      refused(W.checkPr('both', sha, byExt), new RegExp(`changing ${re(SELF)} needs an answered self-change question`), 'E4 under the exterior-change answer, check-pr');
    });

    await check('E5 both on main: self show, exterior show and dashboard-data carry them', () => {
      const self = W.ok(['self', 'show']);
      assert.ok(self.includes(SELF_MD.trim()), `E5 self show prints the Self, a plain document (kit-862)\n${self}`);
      assert.equal(W.ok(['exterior', 'show']), `Exterior: ${EXT} on main\n\n${EXTERIOR_MD.trimEnd()}`, 'E5 exterior show prints the exterior, a plain document (kit-863)');
      const d = json(W.ok(['dashboard-data']));
      assert.deepEqual(d.self, json(W.ok(['self', 'show', '--json'])), 'E5 dashboard-data\'s self is self show --json\'s');
      assert.equal(d.self, null, 'E5 dashboard-data\'s self is null for a plain self.md (the page reads the document)');
      assert.deepEqual(d.exterior, json(W.ok(['exterior', 'show', '--json'])), 'E5 dashboard-data\'s exterior is exterior show --json\'s');
      assert.equal(d.exterior, null, 'E5 dashboard-data\'s exterior is null for a plain exterior.md (the page reads the document)');
    });

    await check('E6 a strategy.md change raises exterior-stale; put back, it clears', () => {
      const drewFrom = W.blob(STRAT);
      // put back whatever happens, so a red E6 leaves E7 its own cause
      try { stale(); } finally { if (W.blob(STRAT) !== drewFrom) W.onMain({ [STRAT]: STRATEGY }, 'the strategy as it was'); }
    });
    function stale() {
      W.onMain({ [STRAT]: `${STRATEGY}- Shops can pay in instalments.\n` }, 'the strategy moves on');
      const f = W.findings('exterior-stale');
      assert.equal(f.length, 1, `E6 one exterior-stale\n${JSON.stringify(f)}`);
      assert.match(f[0].detail ?? f[0].what ?? JSON.stringify(f[0]), /drew from a strategy\.md main has moved on from/, 'E6 names the strategy');
      W.onMain({ [STRAT]: STRATEGY }, 'the strategy as it was');
      assert.deepEqual(W.findings('exterior-stale'), [], 'E6 the strategy exterior.md drew from again: not stale');
    }

    await check('E7 a new self.md, landed under its own answer, raises exterior-stale', () => {
      const next = `${SELF_MD}\nIt also prints receipts.\n`;
      W.chore('self-2', (w) => write(path.join(w, SELF), next));
      landed(W.merge('self-2', W.answered('self-change', SELF, 'The Self', 'self-2'), false), 'E7 the new self.md lands under its answer');
      W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
      const f = W.findings('exterior-stale');
      assert.equal(f.length, 1, `E7 one exterior-stale\n${JSON.stringify(f)}`);
      assert.match(f[0].detail ?? f[0].what ?? JSON.stringify(f[0]), /drew from a self\.md main has moved on from/, 'E7 names self.md');
    });
    // OUT-S2: the supervisor's senses, described in markdown, are its own; the kit decides nothing from them
    const NOTE = { [`${P}/notes/tillstack.md`]: '# Notes\n\nShops asked for receipts.\n' };
    await check('E8 check-pr: a PR adding senses.md and readings gets what the same PR without them gets', () => {
      const without = W.chore('note', (w) => { for (const [rel, text] of Object.entries(NOTE)) write(path.join(w, rel), text); });
      const withSenses = W.chore('senses', (w) => { for (const [rel, text] of Object.entries({ ...NOTE, ...SENSES })) write(path.join(w, rel), text); });
      const said = (slug, sha) => { const r = W.checkPr(slug, sha); return { status: r.status, text: r.text.replaceAll(sha, '<sha>').replaceAll(sha.slice(0, 12), '<sha>').replaceAll(`chore-${slug}`, '<chore>') }; };
      assert.deepEqual(said('senses', withSenses), said('note', without), 'E8 check-pr says the same with and without senses.md and readings');
    });

    await check('E9 validate, metrics and dashboard-data say the same on main with and without senses.md and readings', () => {
      // what changes between any two runs: the clock
      const clockless = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'generated_at' || k === 'now' ? undefined : x)));
      const snap = () => ({ validate: W.run(['validate']), metrics: clockless(json(W.ok(['metrics', '--json']))), data: clockless(json(W.ok(['dashboard-data']))) });
      const without = snap();
      W.onMain(SENSES, 'the supervisor\'s senses and their readings');
      assert.ok(fs.existsSync(path.join(W.old, `${P}/senses.md`)) && W.g(['ls-tree', '-r', '--name-only', 'origin/main', `${P}/senses/`], W.old).split('\n').length === 2, 'E9 main holds senses.md and two readings');
      const withSenses = snap();
      assert.deepEqual([withSenses.validate.status, withSenses.validate.text], [without.validate.status, without.validate.text], 'E9 validate says the same');
      assert.deepEqual(withSenses.metrics, without.metrics, 'E9 metrics says the same');
      assert.deepEqual(withSenses.data, without.data, 'E9 dashboard-data says the same');
    });

    await check('E10 devteam.mjs names neither senses.md nor project/senses', () => {
      const src = fs.readFileSync(path.join(KIT, 'scripts', 'devteam.mjs'), 'utf8');
      assert.doesNotMatch(src, /senses\.md/, 'E10 devteam.mjs does not name senses.md');
      assert.doesNotMatch(src, /project\/senses/, 'E10 devteam.mjs does not name project/senses');
    });

    // kit-867 (OUT-S8): a pass found something changed; the next Exterior, with its change note beside
    // the senses' readings, lands only under its own exterior-change answer, never the first one's
    await check('E11 a second exterior.md lands through its own answer, with its change note; the first answer does not land it', () => {
      assert.equal(W.findings('exterior-stale').length, 1, 'E11 exterior-stale from E7 is still raised');
      const sha = W.chore('exterior-2', (w) => {
        write(path.join(w, EXT), EXTERIOR_2);
        write(path.join(w, NOTE_2), CHANGE_NOTE);
        checked(W.runIn(w, ['exterior', 'check']), 'E11 the second draft passes exterior check');
      });
      refused(W.merge('exterior-2', extQ), new RegExp(`${re(extQ)} approves chore-exterior, not chore-exterior-2`), 'E11 the first version\'s answer does not land the second');
      refused(W.checkPr('exterior-2', sha, extQ), new RegExp(`${re(extQ)} approves chore-exterior, not chore-exterior-2`), 'E11 nor does check-pr pass it');
      const q2 = W.answered('exterior-change', EXT, 'The exterior', 'exterior-2');
      landed(W.checkPr('exterior-2', sha, q2), 'E11 check-pr passes under its own answer');
      landed(W.merge('exterior-2', q2, false), 'E11 merge --chore lands it under its own answer');
      W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
      assert.equal(W.g(['show', `origin/main:${EXT}`], W.old), EXTERIOR_2.trimEnd(), 'E11 main holds the second exterior.md');
      assert.equal(W.g(['show', `origin/main:${NOTE_2}`], W.old), CHANGE_NOTE.trimEnd(), 'E11 its change note landed with it');
      assert.deepEqual(W.findings('exterior-stale'), [], 'E11 not stale: drawn from main\'s strategy.md and the new self.md');
    });
  } finally { W.done(); }
});

// kit-867 (OUT-S6): a Tillstack whose main still holds a version 1 self.md (a fenced self block, as an
// older kit landed it) migrates it to a plain one through self-change.
test('a version 1 self.md on main migrates to a plain one through self-change', async (t) => {
  const W = project({ name: 'outside-e2e-v1', start: { [SELF]: FIX('self-v1.md') } });
  const check = (title, fn) => t.test(title, fn);
  try {
    await check('M1 main\'s version 1 self.md raises one self-drift asking for the plain version, and no self-missing', () => {
      const f = W.findings('self-drift');
      assert.deepEqual(f.map((x) => [x.severity, x.key]), [['low', 'self@1']], `M1 one self-drift, keyed self@1\n${JSON.stringify(f)}`);
      assert.match(f[0].suggestion, /plain document/, 'M1 it asks for the plain version');
      assert.deepEqual(W.findings('self-missing'), [], 'M1 no self-missing: main has a self.md');
    });
    await check('M2 the plain draft passes self check, is refused until a self-change answer pins it, then lands and clears self-drift', () => {
      const sha = W.chore('self', (w) => { write(path.join(w, SELF), SELF_MD); checked(W.runIn(w, ['self', 'check']), 'M2 the plain draft passes self check'); });
      refused(W.merge('self'), new RegExp(`changes ${re(SELF)}: .*the owner's answer is needed: ask --class self-change`), 'M2 no answer: merge refuses');
      const q = W.answered('self-change', SELF, 'The Self', 'self');
      landed(W.checkPr('self', sha, q), 'M2 check-pr passes under the answer');
      landed(W.merge('self', q, false), 'M2 merge --chore lands it under the answer');
      W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
      assert.equal(W.g(['show', `origin/main:${SELF}`], W.old), SELF_MD.trimEnd(), 'M2 main holds the plain self.md');
      assert.deepEqual(W.findings('self-drift'), [], 'M2 the plain version clears self-drift');
    });
  } finally { W.done(); }
});

// kit-867 (OUT-S7): on a public repo the same exterior.md draft is refused while main's strategy
// doesn't name Cartwell, passes once it does and its held words and link hosts are named on the
// chore, and is refused again once the owner takes the name back.
test('on a public repo the exterior draft is refused, passes once named, and is refused again once taken back', async (t) => {
  const W = project({ name: 'outside-e2e-public', vis: 'PUBLIC', start: { [STRAT]: UNNAMED, [SELF]: SELF_MD } });
  const check = (title, fn) => t.test(title, fn);
  const HEADING = /"Cartwell" \(a ### heading\) is not named whole in origin main's strategy\.md/;
  const strategyChange = (slug, text) => {
    W.chore(slug, (w) => write(path.join(w, STRAT), text));
    refused(W.merge(slug), new RegExp(`changes ${re(STRAT)}: .*ask --class strategy-change`), `${slug}: no answer, no strategy change`);
    landed(W.merge(slug, W.answered('strategy-change', STRAT, 'The strategy', slug), false), `${slug}: lands under the owner's strategy-change answer`);
    W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
  };
  let words = [];
  try {
    await check('U1 main\'s strategy names no Cartwell: chore pr refuses the draft\'s Cartwell heading, naming it on the chore or not, and pushes nothing', () => {
      const r = W.chorePr('exterior', (w) => write(path.join(w, EXT), EXTERIOR_MD));
      refused(r, HEADING, 'U1 chore pr refuses the heading');
      const named = W.chorePr('exterior', () => {}, ['--names-checked', 'Cartwell,Exterior,tillstack.example,status.stripe.com,cartwell.example']);
      refused(named, HEADING, 'U1 --names-checked never clears a heading');
      assert.equal(W.pushed('exterior'), false, 'U1 nothing pushed');
    });
    await check('U2 the owner\'s names, as a strategy-change, land on main', () => {
      strategyChange('strategy-names', STRATEGY);
      assert.match(W.g(['show', `origin/main:${STRAT}`], W.old), /Cartwell/, 'U2 main\'s strategy names Cartwell');
    });
    await check('U3 the same draft holds its words and link hosts until they are named on the chore, then pushes and lands under its exterior-change answer', () => {
      const w = path.join(W.old, '.worktrees', 'chore-exterior');
      W.g(['merge', '-q', '--ff-only', 'origin/main'], w);
      const r = W.chorePr('exterior', () => assert.equal(fs.readFileSync(path.join(w, EXT), 'utf8'), EXTERIOR_MD, 'U3 the same draft'));
      assert.notEqual(r.status, 0, `U3 held until named\n${r.text}`);
      assert.doesNotMatch(r.text, HEADING, 'U3 the heading is no longer refused');
      for (const x of ['"tillstack.example" (link host)', '"status.stripe.com" (link host)', '"cartwell.example" (link host)']) assert.ok(r.text.includes(x), `U3 holds ${x}\n${r.text}`);
      assert.equal(W.pushed('exterior'), false, 'U3 nothing pushed while held');
      words = /--names-checked (\S+)/.exec(r.text)?.[1]?.split(',') ?? [];
      assert.ok(words.length, `U3 the refusal lists the words to name\n${r.text}`);
      landed(W.chorePr('exterior', () => {}, ['--names-checked', words.join(',')]), 'U3 chore pr pushes once each is named');
      assert.equal(W.pushed('exterior'), true, 'U3 pushed');
      const sha = W.g(['rev-parse', 'HEAD'], w);
      const q = W.answered('exterior-change', EXT, 'The exterior', 'exterior');
      landed(W.checkPr('exterior', sha, q), 'U3 check-pr passes under the answer');
      landed(W.merge('exterior', q, false), 'U3 merge --chore lands it');
      W.g(['pull', '-q', '--ff-only', 'origin', 'main'], W.old);
      assert.equal(W.g(['show', `origin/main:${EXT}`], W.old), EXTERIOR_MD.trimEnd(), 'U3 main holds the exterior.md');
      assert.deepEqual([W.findings('exterior-drift'), W.findings('exterior-stale')], [[], []], 'U3 no exterior-drift and no exterior-stale');
    });
    await check('U4 once the owner takes Cartwell back, main\'s heading raises exterior-drift and the next draft is refused again, named on the chore or not', () => {
      strategyChange('strategy-back', UNNAMED);
      const f = W.findings('exterior-drift');
      assert.deepEqual(f.map((x) => x.key), ['cartwell'], `U4 one exterior-drift, for Cartwell\n${JSON.stringify(f)}`);
      const next = `${EXTERIOR_MD}\nShops print their receipts.\n`;
      refused(W.chorePr('exterior-2', (w) => write(path.join(w, EXT), next)), HEADING, 'U4 chore pr refuses the heading again');
      refused(W.chorePr('exterior-2', () => {}, ['--names-checked', [...words, 'Cartwell'].join(',')]), HEADING, 'U4 naming it on the chore, Cartwell too, does not clear it');
      assert.equal(W.pushed('exterior-2'), false, 'U4 nothing pushed');
    });
  } finally { W.done(); }
});

// kit-867 (OUT-S8): supervisor.md says how the Self and the Exterior are kept right
test('S supervisor.md says the weekly pass, its due and overdue, what starts one sooner, what starts a new self.md, and one question per document', () => {
  const md = fs.readFileSync(path.join(KIT, 'process', 'supervisor.md'), 'utf8');
  const keep = /\n\*\*Keeping the Self and the Exterior right\.\*\*\n([\s\S]*?)(?=\n\n|$)/.exec(md)?.[1] ?? '';
  const bullet = (head) => keep.split('\n').find((l) => l.startsWith(`- **${head}`)) ?? '';
  assert.match(bullet('One weekly pass'), /"every":"1w"/, 'S1 a weekly pass');
  assert.match(bullet('One weekly pass'), /`recurring-due` and `recurring-overdue`/, 'S2 its due and overdue');
  assert.match(bullet('Sooner'), /fast sense[\s\S]*`exterior-stale`[\s\S]*a move the owner mentions[\s\S]*starts a pass at once/, 'S3 what starts one sooner');
  assert.match(bullet('What starts a new Self'), /`self-drift`; an approved strategy change; and, in the weekly pass, a reading of what merged/, 'S4 what starts a new self.md');
  assert.match(bullet('Proposing a change'), /one question per document \(`self-change` or `exterior-change`[\s\S]*never one per passage/, 'S5 one question per document');
  assert.match(bullet('Proposing a change'), /one short line per changed passage/, 'S6 a line per changed passage');
  assert.match(bullet('Proposing a change'), /change note is a markdown file under `project\/senses\/` on the draft's own branch/, 'S7 the change note');
});
