import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, monoFixture, write, review } from './lib/kit.mjs';

test('validate --strict on a re-plan branch checks its latest design and graph verdicts hold at the head, as a first plan\'s', () => {
  const F = threadsFixture('replan');
  try {
    const { goal } = F.approval();
    F.owner(['goal', 'decide', goal, 'approve']);
    const PL = { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'cards' };
    const at = (wt) => ({
      ok: (args) => F.ok(wt, args, PL),
      strict: () => { const r = F.run(wt, ['validate', '--strict'], PL); return { status: r.status, said: `${r.out}\n${r.err}` }; },
      commit: (msg) => { F.g(['add', '-A'], wt); F.g(['commit', '-qm', msg], wt); return F.g(['rev-parse', 'HEAD'], wt); },
      reviews: (n, sha) => {
        write(path.join(wt, `docs/devteam/project/reviews/cards/graph-${n}.md`), review('reviewer-a', sha));
        write(path.join(wt, `docs/devteam/project/reviews/self-serve-billing/design-${n}.md`), review('reviewer-a', sha));
      },
    });
    const STALE = [/feature cards: graph review graph-\d\.md is at \w{12}, which does not hold at HEAD/, /feature cards: design review design-\d\.md is at \w{12}, which does not hold at HEAD; review again/];
    const stale = (w, when) => { const r = w.strict(); assert.notEqual(r.status, 0, `${when}: ${r.said}`); for (const re of STALE) assert.match(r.said, re, when); };
    const fresh = (w, when) => { const r = w.strict(); assert.equal(r.status, 0, `${when}: ${r.said}`); for (const re of STALE) assert.doesNotMatch(r.said, re, when); };
    // check-pr, the merge gate, validates the pushed head detached, off any branch
    const gate = (wt) => {
      const sha = F.g(['rev-parse', 'HEAD'], wt);
      F.g(['push', '-q', '-f', 'origin', 'plan/cards'], wt);
      const r = F.run(F.old, ['check-pr', '--head-ref', 'plan/cards', '--sha', sha, '--title', 'plan-cards: cards'], F.SUP);
      return { status: r.status, said: `${r.out}\n${r.err}` };
    };

    // a first plan: reviews at its head pass; a ticket changed after them is stale
    const wt1 = path.join(F.base, 'plan-cards');
    F.g(['worktree', 'add', '-q', '-b', 'plan/cards', wt1, 'origin/main'], F.old);
    const w1 = at(wt1);
    write(path.join(wt1, 'docs/devteam/project/designs/self-serve-billing.md'), '# Design: billing\n\n## TL;DR\n\n- cards first\n\n## Goals\n\nadmins pay alone\n');
    w1.ok(['feature', 'add', 'cards', '--json', JSON.stringify({ title: 'Cards', goals: [goal], preconditions: [`${goal}#1`], design: 'project/designs/self-serve-billing.md', stories: [{ id: 'CARD-S1', text: 'admin adds a card', release: 'v0.2.0' }] })]);
    w1.ok(['ticket', 'add', 'card-01-capture', '--json', JSON.stringify({ title: 'card capture', feature: 'cards', component: 'card', kind: 'build', size: 'S', risk: 'normal', serves: ['CARD-S1'], depends_on: [], touches: ['cards/**'], done_when: ['card test passes in CI'] })]);
    w1.reviews(1, w1.commit('plan cards'));
    const reviewed = w1.commit('reviews');
    fresh(w1, 'a first plan reviewed at its head');
    let g = gate(wt1);
    assert.equal(g.status, 0, `check-pr on a first plan reviewed at its head: ${g.said}`);
    w1.ok(['ticket', 'set', 'card-01-capture', '--json', '{"size":"M"}']);
    w1.commit('after review');
    stale(w1, 'a first plan changed after its reviews');
    g = gate(wt1);
    assert.notEqual(g.status, 0, g.said);
    for (const re of STALE) assert.match(g.said, re, 'check-pr on a first plan changed after its reviews');
    F.g(['reset', '-q', '--hard', reviewed], wt1);

    // it lands
    F.g(['merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from x/plan/cards', 'plan/cards'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    F.g(['worktree', 'remove', '--force', wt1], F.old);
    F.g(['branch', '-q', '-D', 'plan/cards'], F.old);

    // a re-plan: the same checks, though the feature's plan log is on main
    const wt2 = path.join(F.base, 'replan-cards');
    F.g(['worktree', 'add', '-q', '-b', 'plan/cards', wt2, 'origin/main'], F.old);
    const w2 = at(wt2);
    fresh(w2, 'a re-plan with nothing changed since its reviews');
    w2.ok(['ticket', 'set', 'card-01-capture', '--json', '{"size":"M"}']);
    w2.commit('re-plan cards');
    stale(w2, 'a re-plan changed after its reviews');
    g = gate(wt2);
    assert.notEqual(g.status, 0, g.said);
    for (const re of STALE) assert.match(g.said, re, 'check-pr on a re-plan changed after its reviews');
    w2.reviews(2, F.g(['rev-parse', 'HEAD'], wt2));
    w2.commit('re-plan reviews');
    fresh(w2, 'a re-plan reviewed again at its head');
    g = gate(wt2);
    assert.equal(g.status, 0, `check-pr on a re-plan reviewed again at its head: ${g.said}`);
  } finally { F.done(); }
});

// kit-204 A4: the plan TL;DR limit counts its body bullets; the writing-plans header fields
// (Goal, Architecture, Tech stack, Spec) as bullets don't count. A refused approve-plan writes
// nothing, so each refusal runs on the one ticket first and the approval last.
test('the plan TL;DR limit counts its own bullets, not header fields', () => {
  const F = monoFixture('tldr-header');
  const { old, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const id = 'api-01-tldr';
    F.ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['its suite passes in CI'], notes: 'n' })], SUP);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/main'], old);
    const tdir = path.join(w, 'docs/devteam/project/tickets', id);
    write(path.join(tdir, 'spec.md'), '# spec\n');
    const plan = (text) => {
      write(path.join(tdir, 'plan.md'), text);
      g(['add', '-A'], w);
      g(['commit', '-q', '--allow-empty', '-m', `${id}: plan`], w);
      g(['push', '-q', 'origin', `ticket/${id}`], w);
    };
    const tldr = (bullets) => `# plan\n\n## TL;DR\n\n${bullets.join('\n')}\n\n## T1\n\n- a step\n`;
    const H = ['- **Goal:** g', '- **Architecture:** a', '- **Tech stack:** node', '- **Spec:** spec.md'];
    const body = (n) => Array.from({ length: n }, (_, i) => `- body bullet ${i + 1}`);
    F.ok(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'spec ok'], SUP);
    const approve = () => { const r = F.run(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP); return { status: r.status, text: `${r.out}\n${r.err}` }; };
    // A4c: header fields alone are no bullets
    plan(tldr(H));
    const c = approve();
    assert.notEqual(c.status, 0, c.text);
    assert.match(c.text, /a TL;DR with no bullets/);
    // A4b: header fields plus eight body bullets: the eight count
    plan(tldr([...H, ...body(8)]));
    const b = approve();
    assert.notEqual(b.status, 0, b.text);
    assert.match(b.text, /8 bullets; seven at most/);
    // A4d: a label with no colon is a body bullet
    plan(tldr(['- Spec review first', ...body(7)]));
    const d = approve();
    assert.notEqual(d.status, 0, d.text);
    assert.match(d.text, /8 bullets/);
    // A4a: every header label form, nine of them, plus seven body bullets (the limit, so any one header that counts is refused) is approved
    plan(tldr([...H, '- **Goal**: g', '- __Spec__: s', '- Goal: g', '- **Tech Stack:** node', '- tech-stack: node', ...body(7)]));
    const a = approve();
    assert.equal(a.status, 0, a.text);
  } finally { F.done(); }
});
// kit-204 A5-A7: a spike's document goes in its own ticket folder, which validate accepts as its
// whole touches; no other path in the kit's line (another's folder, a design, a prefix, dot
// segments) is accepted, and planning.md D9 says the same.
test('a spike whose touches are only its own ticket folder validates; D9 says the same', () => {
  const F = monoFixture('spike-folder');
  const { old } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    F.lines(F.STD);
    const T = 'docs/devteam/project/tickets';
    const spike = (id, touches) => F.run(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'api', kind: 'spike', size: 'S', risk: 'normal', serves: [], depends_on: [], touches, done_when: ['findings.md answers the question'], notes: 'findings for the api' })], SUP);
    const validate = () => { const r = F.run(old, ['validate'], SUP); return { status: r.status, text: `${r.out}\n${r.err}` }; };
    // A5: its own folder, then a file under it
    const a = spike('api-01-spike', [`${T}/api-01-spike/`]);
    assert.equal(a.status, 0, `${a.out}\n${a.err}`);
    const v1 = validate();
    assert.doesNotMatch(v1.text, /api-01-spike:/, v1.text);
    F.ok(old, ['ticket', 'set', 'api-01-spike', '--json', JSON.stringify({ touches: [`${T}/api-01-spike/findings.md`] })], SUP);
    const v2 = validate();
    assert.doesNotMatch(v2.text, /api-01-spike:/, v2.text);
    // A6: every other kit-line path is still refused
    const bad = { 'api-02-spike': `${T}/api-01-spike/`, 'api-03-spike': 'docs/devteam/project/designs/x.md', 'api-04-spike': `${T}/api-04-spike-x/`, 'api-05-spike': `${T}/api-05-spike/../../scripts/devteam.mjs`, 'api-06-spike': `${T}/api-06-spike/./x.md` };
    const added = Object.entries(bad).filter(([id, p]) => spike(id, [p]).status === 0);
    const v3 = validate();
    if (added.length) assert.notEqual(v3.status, 0, v3.text);
    for (const [id, p] of added) assert.ok(v3.text.includes(`${id}: touches "${p}" lies in the kit's own line`), `${id} refused:\n${v3.text}`);
    assert.doesNotMatch(v3.text, /api-01-spike:/, v3.text);
    // A7: D9 names the ticket folder, not designs
    const d9 = fs.readFileSync(path.join(old, 'docs/devteam/process/planning.md'), 'utf8').split('\n').find((l) => l.startsWith('- **D9'));
    assert.ok(d9, 'planning.md has a D9 line');
    assert.match(d9, /project\/tickets\/<id>\//);
    assert.doesNotMatch(d9, /project\/designs\//);
  } finally { F.done(); }
});

// planning.md D12 and D13: validate warns when a story's makes_true is not one of its feature's
// preconditions, and on each budget a plan goes over; a feature within them gets no warning, and a
// story without the new fields still validates (they are optional, for logs planned before them).
test('validate warns on D12 makes_true and the D13 budgets, and not within them', () => {
  const F = threadsFixture('goal-chain');
  try {
    const { goal } = F.approval();
    const feature = (id, extra = {}) => F.sup(['feature', 'add', id, '--json', JSON.stringify({ title: id, goals: [goal], preconditions: [`${goal}#1`], design: 'project/designs/self-serve-billing.md', stories: [{ id: `${id.toUpperCase()}-S1`, text: 'an admin pays', release: 'v1.0.0' }], ...extra })]);
    const ticket = (id, f, extra = {}) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: f, component: 'api', kind: 'build', size: 'S', risk: 'normal', serves: [`${f.toUpperCase()}-S1`], depends_on: [], touches: [`api/${id}/**`], done_when: ['its suite passes in CI'], ...extra })]);
    const validate = () => { const r = F.run(F.old, ['validate'], F.SUP); return `${r.out}\n${r.err}`; };
    // within budget, with the new fields: no D12 or D13 warning
    feature('small', { stories: [{ id: 'SMALL-S1', text: 'an admin pays', release: 'v1.0.0', acceptance: ['an admin pays by card end to end (e2e pay_spec)'], makes_true: `${goal}#1` }] });
    ticket('api-01-small', 'small', { contracts: { consumes: ['docs/contracts/a.md@1.0', 'docs/contracts/b.md@1.0'] } });
    const v1 = validate();
    assert.doesNotMatch(v1, /\(D1[23]\)/, v1);
    // D12: a makes_true outside the feature's preconditions
    feature('wrong', { stories: [{ id: 'WRONG-S1', text: 'an admin pays', makes_true: `${goal}#2` }] });
    ticket('api-02-wrong', 'wrong', { contracts: { consumes: ['docs/contracts/a.md@1.0', 'docs/contracts/b.md@1.0', 'docs/contracts/c.md@1.0'] } });
    // D13: 13 open tickets in one feature, in a chain 13 waves deep
    feature('big');
    for (let i = 0; i < 13; i++) ticket(`api-${10 + i}-big`, 'big', i ? { depends_on: [`api-${9 + i}-big`] } : {});
    // a superseded ticket is not open: it counts toward neither budget
    ticket('api-30-big', 'big', { depends_on: ['api-22-big'] });
    F.sup(['ticket', 'set', 'api-30-big', '--json', JSON.stringify({ superseded_by: 'api-22-big' })]);
    // D13: milestone 1 served by five features (small, wrong, big and two more)
    feature('more');
    feature('most');
    const v2 = validate();
    assert.match(v2, new RegExp(`feature wrong: story WRONG-S1 makes_true ${goal}#2, which is not one of the feature's preconditions \\(D12\\)`), v2);
    assert.match(v2, new RegExp(`feature wrong: precondition ${goal}#1 has no story that makes it true \\(D12\\)`), v2);
    assert.doesNotMatch(v2, /feature big: precondition/, v2);
    assert.match(v2, /api-02-wrong: consumes 3 contracts, over the budget of 2; split the ticket \(D13\)/, v2);
    assert.doesNotMatch(v2, /api-01-small: consumes/, v2);
    assert.match(v2, /feature big: 13 open tickets, over the budget of 12; split the feature \(D13\)/, v2);
    assert.match(v2, /feature big: its open tickets are 13 waves deep, over the budget of 5/, v2);
    assert.match(v2, new RegExp(`milestone ${goal}@1 is served by 5 features \\(big, more, most, small, wrong\\), over the budget of 4; split the milestone \\(D13\\)`), v2);
    assert.doesNotMatch(v2, /feature small: .*\(D1[23]\)/, v2);
  } finally { F.done(); }
});
