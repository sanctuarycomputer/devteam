// Next best step: findings, the strategy as the owner's, what the ratings say, and the Inbox (next, Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { freePort, json, line, PORTS, startDashboard, until, write } from './lib/kit.mjs';
import { fixture, raw, SUP, yesNo } from './lib/next-step-fixture.mjs';

test('findings: no strategy, an unrated question once rating has begun, ratings that are all 3', () => {
  const F = fixture('nbs-findings');
  const { old, ok, g, goal, ask, findings } = F;
  try {
    assert.deepEqual(findings('strategy-unwritten'), [], 'no running goal: nothing yet');
    const G = goal('Team billing', 1);
    assert.match(findings('strategy-unwritten')[0].detail, /still the template/);
    assert.equal(findings('strategy-unwritten')[0].severity, 'high', 'goals running and no strategy: wait keeps raising it');
    // the marker, not the kit's current words: a project on an older wording of the template is still the template
    write(path.join(old, REL_STRATEGY), fs.readFileSync(path.join(old, REL_STRATEGY), 'utf8').replace('Keep it to one page.', 'One page, please.'));
    g(['add', '-A'], old);
    g(['commit', '-qm', 'an older wording of the template'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.match(findings('strategy-unwritten')[0].detail, /still the template/);
    const first = ask('An old question?', '--goal', G);
    assert.deepEqual(findings('question-unrated'), [], 'a project that has not begun rating sees nothing');
    ask('Rated?', '--goal', G, '--stake', '1', '--urgency', '1');
    assert.deepEqual(findings('question-unrated'), [], 'nor for questions from before the first rating');
    const late = ask('Forgot to rate?', '--goal', G);
    const half = ask('Half rated?', '--goal', G, '--stake', '2');
    assert.deepEqual(findings('question-unrated').map((f) => f.subject).sort(), [late, half].sort());
    ok(old, ['rate', late, '--stake', '1', '--urgency', '1'], SUP);
    ok(old, ['rate', half, '--urgency', '1'], SUP);
    assert.deepEqual(findings('question-unrated'), []);
    assert.equal(json(ok(old, ['questions', '--id', first, '--json']))[0].rank.parts.rated, false);
    assert.deepEqual(findings('rating-inflated'), []);
    for (let i = 0; i < 4; i++) ask(`Everything is a turning point ${i}?`, '--goal', G, '--stake', '3', '--urgency', '1');
    assert.deepEqual(findings('rating-inflated').map((f) => [f.subject, f.detail]), [['stake', '4 of 7 open questions are stake 3']]);
    // a draft in front of the owner: medium while they read it, so wait doesn't stop for it
    const wt = path.join(old, '.worktrees', 'chore-strategy-first');
    g(['worktree', 'add', '-q', '-b', 'chore-strategy-first', wt, 'origin/main'], old);
    write(path.join(wt, REL_STRATEGY), '# Strategy\n\n## Why it exists\nDraft.\n');
    g(['add', '-A'], wt);
    g(['commit', '-qm', 'draft'], wt);
    g(['push', '-q', 'origin', 'chore-strategy-first'], wt);
    ok(old, ['ask', '--class', 'strategy-change', '--reasons', 'owner-only', '--question', 'Approve the strategy?', '--recommendation', 'yes', '--stake', '2', '--urgency', '2', '--links', JSON.stringify([{ title: 'The strategy', path: REL_STRATEGY, ref: 'chore-strategy-first' }])], SUP);
    assert.equal(findings('strategy-unwritten')[0].severity, 'medium');
    // the strategy written and on main: the finding goes
    write(path.join(old, 'docs/devteam/project/strategy.md'), '# Strategy\n\n## Why it exists\nTeams split bills by hand.\n\n## How it wins, in order\n- **W1** Teams adopt it without help\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'the strategy'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.deepEqual(findings('strategy-unwritten'), []);
    assert.doesNotMatch(F.run(old, ['goal', 'impact', G, '3', '--rationale', 'W1'], SUP).err, /strategy/);
  } finally { F.done(); }
});

const REL_STRATEGY = 'docs/devteam/project/strategy.md';

test('the strategy answer is bound to the text: ask pins the draft, merge refuses any other', () => {
  const F = fixture('nbs-strategy-pin');
  const { old, ok, run, g } = F;
  const chore = 'chore-a';
  const wt = path.join(old, '.worktrees', chore);
  const commit = (text, ...commitArgs) => { write(path.join(wt, REL_STRATEGY), text); g(['add', '-A'], wt); g(['commit', '-qm', 'draft', ...commitArgs], wt); g(['push', '-qf', 'origin', chore], wt); };
  const ask = (ref, extra = []) => run(old, ['ask', '--class', 'strategy-change', '--reasons', 'owner-only', '--question', 'Approve the strategy?', '--recommendation', 'yes', '--stake', '3', '--urgency', '2', '--links', JSON.stringify([{ title: 'The strategy', path: REL_STRATEGY, ref, ...extra[0] }])], SUP);
  const merge = (q) => { const r = run(old, ['merge', '--chore', 'a', '--dry-run', '--approved', q], SUP); return { status: r.status, text: r.out + r.err }; };
  try {
    g(['worktree', 'add', '-q', '-b', chore, wt, 'origin/main'], old);
    const A = '# Strategy\n\n## Why it exists\nDraft A.\n';
    commit(A);
    write(path.join(old, `docs/devteam/run/pr/${chore}.md`), `# ${chore}: x\n\n## One-way doors\n\nNone.\n`);
    // no link, a link with no ref, a ref with no file, a pin given by hand: all refused
    assert.match(run(old, ['ask', '--class', 'strategy-change', '--reasons', 'owner-only', '--question', 'x?', '--recommendation', 'yes'], SUP).err, /links the draft it asks about/);
    assert.match(run(old, ['ask', '--class', 'strategy-change', '--reasons', 'owner-only', '--question', 'x?', '--recommendation', 'yes', '--links', JSON.stringify([{ title: 'S', path: REL_STRATEGY }])], SUP).err, /links the draft it asks about/);
    assert.match(ask('no-such-branch').err, /commit the draft to its branch first/);
    assert.match(ask(chore, [{ blob: 'a'.repeat(40) }]).err, /blob is written by ask/);

    const q = ask(chore);
    assert.equal(q.status, 0, q.err);
    const id = q.out.trim();
    const blobA = g(['rev-parse', `${chore}:${REL_STRATEGY}`], old).trim();
    const link = json(ok(old, ['questions', '--id', id, '--json']))[0].links[0];
    assert.equal(link.blob, blobA, 'pinned at ask');
    assert.equal(g(['rev-parse', chore], old).trim(), link.ref, 'the link names the commit, so it shows this text however the branch moves');
    ok(old, ['answer', id, 'yes']);
    assert.equal(merge(id).status, 0, 'the text the owner saw lands');

    // the review's repro: answered yes, the branch amended after, the answer must not carry
    commit('# Strategy\n\n## Why it exists\nDraft B, never seen.\n', '--amend');
    const r = merge(id);
    assert.notEqual(r.status, 0, 'a text the owner never saw does not land under that answer');
    assert.match(r.text, /is not the text .* asked the owner about/);
    assert.equal(g(['show', `${link.ref}:${REL_STRATEGY}`], old), A.trimEnd(), 'the owner\'s link still shows Draft A');

    // asked again about the text as it is now, it lands
    const q2 = ask(chore).out.trim();
    ok(old, ['answer', q2, 'yes']);
    assert.equal(merge(q2).status, 0);

    // a deletion: nothing to pin, so no answer can approve it
    fs.rmSync(path.join(wt, REL_STRATEGY));
    g(['add', '-A'], wt);
    g(['commit', '-qm', 'no strategy', '--amend'], wt);
    g(['push', '-qf', 'origin', chore], wt);
    assert.match(ask(chore).err, /commit the draft to its branch first/);
    assert.match(merge(q2).text, /is not the text .* asked the owner about \(no file,/);
  } finally { F.done(); }
});

test('ratings are said to be the supervisor\'s, an impact that isn\'t a level is none, and the history shows a re-rate', () => {
  const F = fixture('nbs-attrib');
  const { old, ok, goal, ask, impact, rank, inbox } = F;
  try {
    const G = goal('Team billing', 1);
    const q = ask('Monthly or yearly?', '--goal', G, '--stake', '3', '--urgency', '2');
    impact(G, 4);
    assert.match(rank(q).reason, /^for Team billing \(the supervisor's rating\): the project depends on it; the supervisor's rating: decides whether the work goes ahead$/);
    assert.equal(rank(q).top, true, 'rated: it may be called the next best step');
    // the owner's own value is theirs
    const d = json(ok(old, ['goal', 'show', G])).impact.decision;
    ok(old, ['correct', d, '--reason', 'it does', '--impact', '3']);
    assert.match(rank(q).reason, /for Team billing \(your rating\): moves a number/);
    // a re-rate leaves a trail, down as well as up
    ok(old, ['rate', q, '--stake', '1'], SUP);
    const hist = inbox().find((x) => x.id === q).rating_history;
    assert.deepEqual(hist.map(({ at, ...h }) => h), [{ by: 'supervisor', stake: 3, urgency: 2, asked: true }, { by: 'supervisor', stake: 1 }]);
    // a value that is no level is no impact: not even one every object has a key for
    const R = raw(F);
    R.flush();
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ id: 'd-20260105-000000001-supervisor', type: 'decision', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'goal-impact', what: 'x', refs: [G], impact: 'constructor' }));
    assert.equal(json(ok(old, ['goal', 'show', G])).impact.level, 3, 'the owner\'s value stands and the odd line changes nothing');
    const H = goal('Onboarding', 2);
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ id: 'd-20260105-000000002-supervisor', type: 'decision', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'goal-impact', what: 'x', refs: [H], impact: 'constructor' }));
    assert.equal(json(ok(old, ['goal', 'show', H])).impact, null);
  } finally { F.done(); }
});

test('the strategy is the owner\'s: no PR changes project/strategy.md without an answered strategy-change question', () => {
  const F = fixture('nbs-strategy');
  const { old, ok, run, g } = F;
  const REL = 'docs/devteam/project/strategy.md';
  const template = fs.readFileSync(path.join(old, REL), 'utf8');
  const choreOf = (slug, change) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
    change(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', slug], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return (...extra) => { const r = run(old, ['merge', '--chore', slug, '--dry-run', ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
  };
  const linked = (ref) => ['--links', JSON.stringify([{ title: 'The strategy', path: REL, ref }])];
  // the same words each time on purpose: past ask's re-ask refusal after the owner's no
  const answered = (cls, answer = 'yes') => { const q = ok(old, ['ask', '--question', 'Approve this?', '--recommendation', 'yes', '--stake', '3', '--urgency', '2', '--new-because', 'the test asks again', ...(cls ? ['--class', cls, '--reasons', cls === 'release-scope' ? 'below-rung' : 'owner-only'] : []), ...(cls === 'strategy-change' ? linked('chore-strategy-first') : [])], SUP); ok(old, ['answer', q, answer]); return q; };
  try {
    assert.match(template, /^# Strategy\n/, 'init wrote the template');
    assert.match(template, /## How it wins, in order\n[\s\S]*## Values\n[\s\S]*## Refusals\n[\s\S]*## Not known yet\n/);
    assert.ok(json(ok(old, ['decisions', '--json'])) && !run(old, ['ask', '--question', 'x', '--class', 'strategy-change', '--reasons', 'owner-only'], SUP).err.includes('not in constitution'), 'strategy-change is a class the constitution knows');
    // a draft of the strategy, in a chore of any name
    const draft = choreOf('strategy-first', (w) => write(path.join(w, REL), '# Strategy\n\n## Why it exists\nTeams split bills by hand.\n'));
    const r0 = draft();
    assert.notEqual(r0.status, 0);
    assert.match(r0.text, /changes docs\/devteam\/project\/strategy\.md: the strategy is the owner's, so the owner's answer is needed: ask --class strategy-change/);
    assert.match(draft('--approved', answered('release-scope')).text, /is a release-scope question; changing docs\/devteam\/project\/strategy\.md needs an answered strategy-change question/);
    assert.match(draft('--approved', answered(null)).text, /is a classless question/);
    assert.notEqual(draft('--approved', answered('strategy-change', 'no, W1 is wrong')).status, 0, 'an answer that is not the yes approves nothing');
    const yes = answered('strategy-change');
    assert.equal(draft('--approved', yes).status, 0, 'the owner\'s yes lands it');
    // the same change hidden among other project files, under another name: the same rule
    const mixed = choreOf('notes', (w) => { write(path.join(w, 'docs/devteam/project/designs/notes.md'), 'n\n'); fs.appendFileSync(path.join(w, REL), '\n- **W9** Whatever pays\n'); });
    assert.match(mixed().text, /the strategy is the owner's/);
    // a file whose path differs only by case is the same file on a disk that ignores case: refused
    assert.match(choreOf('twin', (w) => write(path.join(w, 'docs/devteam/project/STRATEGY.md'), '# Strategy\n\nWhatever pays.\n'))().text, /adds docs\/devteam\/project\/STRATEGY\.md, which a disk that ignores case can't tell from docs\/devteam\/project\/strategy\.md|the strategy is the owner's/); // the second where the test's own disk ignores case
    // project/ files beside it still need no question
    assert.equal(choreOf('only-notes', (w) => write(path.join(w, 'docs/devteam/project/designs/notes.md'), 'n\n'))().status, 0);

    // the owner's strategy on main; then a chore that resets it to the template, empties it or deletes it
    write(path.join(old, REL), '# Strategy\n\n## Why it exists\nTeams split bills by hand.\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'the strategy, approved'], old);
    g(['push', '-q', 'origin', 'main'], old);
    for (const [slug, change] of [['reset', (w) => write(path.join(w, REL), template)], ['empty', (w) => write(path.join(w, REL), '')], ['delete', (w) => fs.rmSync(path.join(w, REL))]]) {
      const r = choreOf(`strategy-${slug}`, change)();
      assert.notEqual(r.status, 0, `${slug}: refused`);
      assert.match(r.text, /the strategy is the owner's/, slug);
    }
    // no strategy file on main at all (a project from before): init's untouched template may arrive, and nothing else
    g(['rm', '-q', REL], old);
    g(['commit', '-qm', 'as an older project: no strategy file'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.equal(choreOf('template', (w) => write(path.join(w, REL), template))().status, 0, 'the empty template, where there was no file');
    assert.match(choreOf('first-words', (w) => write(path.join(w, REL), `${template}\nW1 is revenue.\n`))().text, /the strategy is the owner's/, 'a first strategy is the owner\'s to approve too');
  } finally { F.done(); }
});

test('next prints the top of the Inbox and why; an unrated project prints as it always did', () => {
  const F = fixture('nbs-next');
  const { old, ok, goal, ask, impact } = F;
  try {
    assert.deepEqual(json(ok(old, ['next', '--json'])), { owner: null });
    assert.equal(ok(old, ['next']), 'you    nothing: the Inbox is empty');
    // unrated questions, with and without a goal: a steady order, no rank line, no goal chip without a goal
    const a = ask('First?');
    const G = goal('Team billing', 1);
    const b = ask('Second?', '--goal', G);
    const c = ask('Third?');
    const qs = json(ok(old, ['questions', '--json']));
    assert.deepEqual(qs.map((q) => q.id), [a, b, c], 'all the same score (2 × 2 × 1), so by age');
    assert.deepEqual(qs.map((q) => [q.rank.parts.rated, q.rank.score]), [[false, 4], [false, 4], [false, 4]]);
    assert.deepEqual([qs[0].rank.reason, qs[0].rank.chips], ['', []], 'no goal: no chip');
    assert.equal(qs[1].rank.reason, 'for Team billing: its impact is not judged yet');
    assert.doesNotMatch(ok(old, ['questions']), /rank:/);
    impact(G, 4);
    const top = ask('Should we build it at all?', '--goal', G, '--stake', '3', '--urgency', '2');
    const n = json(ok(old, ['next', '--json'])).owner;
    assert.deepEqual([n.id, n.question, n.rank.score, n.rank.top], [top, 'Should we build it at all?', 24, true]);
    assert.deepEqual(n.then.map((x) => x.id), [b, a, c], 'the judged goal\'s question (4 × 2 × 1), then the rest by age');
    const text = ok(old, ['next']);
    assert.match(text, new RegExp(`^you {4}${top} {2}Should we build it at all\\?\\n {7}for Team billing \\(the supervisor's rating\\): the project depends on it; the supervisor's rating: decides whether the work goes ahead\\n {7}score 24: impact 4 `));
    assert.match(text, /\n {7}then: q-\S+ \(score 8\), q-\S+ \(score 4\), q-\S+ \(score 4\)$/);
    // the operator may read it; a closed question has no rank
    assert.equal(F.run(old, ['next'], { DEVTEAM_ROLE: 'operator' }).status, 0);
    ok(old, ['withdraw', a, '--reason', 'x'], SUP);
    assert.equal(json(ok(old, ['questions', '--id', a, '--json']))[0].rank, null);
    const all = json(ok(old, ['questions', '--all', '--json']));
    assert.equal(all[all.length - 1].id, a, 'closed questions follow the Inbox');
  } finally { F.done(); }
});

test('the Inbox shows the order: the next best step on top with its reason, what an answer closes, and the owner\'s own value for a goal', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async () => {
  const F = fixture('nbs-page');
  const { old, ok, goal, ask, impact } = F;
  const G = goal('Team billing', 1);
  const D = impact(G, 3, 'W2 is revenue.');
  const detail = ask('Round to cents?', '--goal', G, '--stake', '1', '--urgency', '2');
  const unrated = ask('Unrated one?');
  const gate = ask('Should we build it at all?', '--goal', G, ...yesNo, '--stake', '3', '--urgency', '1', '--settles', detail, '--settles-if', "Don't build it");
  ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'a lesson to keep', '--scope', 'project', '--evidence', detail, '--for-owner', '--plain', 'A lesson that would change how you set the goals.'], SUP);
  const port = await freePort();
  const dash = startDashboard(old, F.env({ DEVTEAM_HUB_PORT: String(PORTS + 10), DEVTEAM_PORT_BASE: String(PORTS + 11) }), ['--port', String(port)]);
  const chrome = await openChrome();
  const p = await chrome.newPage();
  try {
    await until(() => /dashboard on http/.test(dash.out()), 'the dashboard');
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
    const soon = (expr, what) => until(() => p.ev(expr), what);
    await soon(`!!document.querySelector('[id="q-${gate}"]')`, 'the question cards');
    const cards = await p.ev(`[...document.querySelectorAll('#questions > .card')].map((c) => ({ id: c.id.slice(2), top: c.classList.contains('top'), lead: c.querySelector('.top-why')?.textContent ?? null, why: [...c.querySelectorAll('.why span')].map((s) => s.textContent), closes: c.querySelector('.closes')?.textContent ?? null, lesson: /Lesson to keep/.test(c.textContent) }))`);
    assert.deepEqual(cards.map((c) => c.id), [gate, detail, unrated, ''], 'the kit\'s order, and the lesson to keep after the questions');
    assert.deepEqual(cards.map((c) => c.top), [true, false, false, false]);
    assert.equal(cards[0].lead, 'Next best step. Would settle 1 other question; for Team billing (the supervisor\'s rating): moves a number the project watches; the supervisor\'s rating: decides whether the work goes ahead.');
    assert.equal(cards[0].closes, 'Would close 1 other question: Round to cents?', 'on the choice that settles it');
    assert.deepEqual(cards[1].why, ['for Team billing (the supervisor\'s rating): moves a number the project watches', 'the supervisor\'s rating: a detail', 'may be settled by Should we build it at all?']);
    assert.deepEqual(cards[2].why, ['not rated']);
    assert.ok(cards[3].lesson);
    assert.match(await p.ev(`document.querySelector('[id="q-${detail}"] .kv').textContent`), /Order2 of 3\. Score 6: impact 3 \(moves a number the project watches\) × stake 1 \(a detail\) × urgency 2 /);
    assert.match(await p.ev(`document.querySelector('[id="q-${gate}"] .kv').textContent`), /RatedWhen asked: stake 3, urgency 1, settles 1/);
    // Goals has no Strategy link of its own any more (kit-90 spec §7): the strategy is linked from the goal's
    // Why it matters, in its peek (below)
    assert.equal(await p.ev(`!!document.querySelector('#strategy-link') || [...document.querySelectorAll('#goals a')].some((a) => a.textContent.trim() === 'Strategy')`), false, 'no Strategy link on Goals');
    // the goal: its impact beside its priority, why, and Wrong? sends the owner's own value
    assert.match(await p.ev(`document.querySelector('#goals-list a.title-link[href="#goal/${G}"]').closest('.card').querySelector('.card-head').textContent`), /priority 1 · moves a number the project watches/);
    // #questions opened the Inbox in the panel (kit-100), which covers the window below 900px: closed, at
    // rest, before the goal's peek, so Wrong? is pressed on the peek and not on the panel over it
    await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel at rest');
    await p.click('#th-close');
    await soon(`!document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).visibility === 'hidden'`, 'the panel closed');
    await p.ev(`void (location.hash = '#goal/${G}')`);
    const key = `imp:${D}`;
    // The drawer is drawn at once, before the goal's record (its peek) arrives, and again when it
    // lands: the record's rows go above "Why it matters" and push Wrong? down. p.click measures and
    // presses in two steps, so a record landing between them makes the press miss. Wait for the
    // record: its Created row (a goal's reads Opened, kit-90 spec §5) there (a load pending or failed draws a Record row instead) and no
    // `.loading` left.
    await soon(`!!document.querySelector('[data-correct="${key}"]') && [...document.querySelectorAll('#drawer-body section.attrs dt')].some((dt) => dt.textContent === 'Opened') && !document.querySelector('#drawer-body .loading')`, 'the goal drawer with its record');
    // the peek slides in (kit-88): click once it is at rest, or the click lands where the button was
    await soon(`(() => { const d = document.getElementById('drawer'); return getComputedStyle(d).transform === 'none' && !d.getAnimations().some((a) => a.transitionProperty === 'transform'); })()`, 'the goal drawer at rest');
    assert.match(await p.ev(`document.querySelector('[data-correct="${key}"]').parentElement.textContent`), /Moves a number the project watches \(3 of 4\)W2 is revenue\.\s+Judged by the supervisor [\s\S]* · the decision · the strategy\s+Wrong\?/);
    assert.match(await p.ev(`[...document.querySelector('[data-correct="${key}"]').parentElement.querySelectorAll('a')].find((a) => a.textContent.trim() === 'the strategy')?.getAttribute('href') ?? ''`), /^#file\?path=docs%2Fdevteam%2Fproject%2Fstrategy\.md/, 'the strategy, linked from Why it matters');
    await p.click(`[data-correct="${key}"]`);
    // the click's effect; and the focused field holds the drawer's redraws while the values go in
    await soon(`document.activeElement === document.querySelector('input[data-reason="${key}"]')`, 'the correction form open');
    await p.ev(`(() => { document.querySelector('select[data-impact="${key}"]').value = '4'; document.querySelector('input[data-reason="${key}"]').value = 'the launch blocker'; })()`);
    await p.click(`[data-correct-send="${key}"]`);
    // the press was taken: its note, or (once the server has it and a refresh redraws the drawer,
    // which drops the note) the owner's own value's button
    await soon(`!!document.querySelector('[data-correct-sent="${key}"]') || document.querySelector('[data-correct="${key}"]')?.textContent === 'Change it'`, 'Correction sent');
    await until(() => json(ok(old, ['goal', 'show', G])).impact.level === 4, 'the owner\'s value');
    assert.deepEqual([json(ok(old, ['goal', 'show', G])).impact.by, json(ok(old, ['goal', 'show', G])).impact.rationale], ['owner', 'the launch blocker']);
  } finally {
    p.close();
    await chrome.close();
    await dash.stop();
    F.done();
  }
});
