// Questions the owner can read cold: ask refuses the fleet's vocabulary and questions about asking,
// warns where a credential should be a paste box, and the dashboard lays out lists as lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fleetFixture, json, line, pastDeadline } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('ask: plain words, no asking about asking, credentials straight to a paste box', () => {
  const F = fleetFixture('plain-ask');
  const { old, ok, run } = F;
  try {
    const refused = (question, re, why, ...opts) => { const r = run(old, ['ask', '--question', question, '--recommendation', 'yes', ...opts], SUP); assert.notEqual(r.status, 0, why); assert.match(r.err, re, why); };
    refused('Should I ask you for the Stripe API key?', /don't ask whether to ask/, 'a question about asking');
    refused('Do you want me to request access to the staging database?', /don't ask whether to ask/, 'the same, worded another way');
    for (const q of ['Want me to ask for the Stripe key?', 'Would it help if I asked you for the password?', 'Is it okay to ask for the staging password?', 'Do you mind if I ask for the deploy token?', 'Should I ask you to review the design first?']) refused(q, /don't ask whether to ask/, q);
    // a credential asked for in a decision's words would be typed into an answer: it is a paste box
    for (const q of ['Can you share the Postgres password for staging?', 'May I have the API key?', 'Do you want to give me the API key, or should I skip it?']) refused(q, /don't ask for a credential in a decision's words/, q);
    refused('Is q-20261101-120000000-supervisor still the right call?', /kit id/, 'a kit id in the question');
    refused('Should we move this release-scope call to next week?', /class name/, 'a class name in the question');
    refused('Can the worker run in its own worktree for this?', /kit's own word "worktree"/, 'kit jargon in the question');
    // the override: the question is about that very thing, so the named word stays, and only it
    const po = run(old, ['ask', '--question', 'Can the worker run in its own git worktree for this?', '--plain-ok', 'worktree', '--recommendation', 'yes'], SUP);
    assert.equal(po.status, 0, po.err);
    assert.match(po.err, /--plain-ok worktree: the owner reads those words as they are/);
    ok(old, ['ask', '--question', 'Should release-scope calls go ahead without you from now on?', '--plain-ok', 'release-scope', '--recommendation', 'yes'], SUP);
    refused('Can the worktree use the trust ladder?', /kit's own word "trust ladder"/, 'a word not named stays refused', '--plain-ok', 'worktree');
    refused('Is q-20261101-120000000-supervisor still the right call?', /kit id/, 'ids never pass', '--plain-ok', 'q-20261101-120000000-supervisor');
    refused('Should I ask you for the deploy token?', /don't ask whether to ask/, 'asking about asking never passes', '--plain-ok', 'token');
    refused('x'.repeat(301), /301 characters/, 'a question that should have been context');
    refused('Ship the billing page this week?', /low-confidence with --confidence 0.8/, 'low confidence that isn\'t', '--reasons', 'low-confidence', '--confidence', '0.8');
    // only when low confidence is the whole reason: a question asked for another reason stands on that
    ok(old, ['ask', '--question', 'Ship the billing page this week?', '--reasons', 'low-confidence', 'goals-conflict', '--confidence', '0.8', '--recommendation', 'yes'], SUP);
    // a word and its plural are one word to --plain-ok
    ok(old, ['ask', '--question', 'Should each worker get its own git worktrees, one per repo?', '--plain-ok', 'worktree', '--recommendation', 'yes'], SUP);
    ok(old, ['ask', '--question', 'Should the worker keep one git worktree per repo?', '--plain-ok', 'worktrees', '--recommendation', 'yes'], SUP);
    // a ticket the owner knows by what it is, never by its id
    ok(old, ['feature', 'add', 'pay', '--json', JSON.stringify({ title: 'pay', goals: [], stories: [] })], SUP);
    const plan = path.join(old, 'docs/devteam/project/log/plan-pay.jsonl');
    fs.mkdirSync(path.dirname(plan), { recursive: true });
    fs.appendFileSync(plan, line({ id: 'pay-01-start', type: 'ticket', op: 'new', at: new Date().toISOString(), by: 'plan-pay', title: 'start', feature: 'pay', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['src/**'], done_when: ['its test passes in CI'] }));
    refused('Should pay-01-start ship before the billing page?', /names the ticket pay-01-start/, 'a ticket id in the question');
    refused('Should PAY-01-START ship first?', /names the ticket pay-01-start/, 'in any case');
    ok(old, ['ask', '--question', 'Should the first payments ticket ship before the billing page?', '--ticket', 'pay-01-start', '--recommendation', 'yes'], SUP);

    // what still goes through: plain words, the stakes spelled out, and "should I" about the work itself
    ok(old, ['ask', '--question', 'Should I ship the billing page this week, or wait for the design review?', '--recommendation', 'Ship it'], SUP);
    ok(old, ['ask', '--question', 'What is at stake if we skip the migration?', '--recommendation', 'Run it'], SUP);
    // asking someone else, a product's own prompt, and the project's own paths are not the kit's business
    // a product question about other people asking, or the owner's own part in the process, is not asking whether to ask
    for (const q of ['Should we let users request access to a workspace before they can see it?', 'Can we require users to ask for access before seeing billing?', 'Should we ask you to confirm each deploy in Slack as well?', 'Can we get a new API key from Stripe before launch?']) ok(old, ['ask', '--question', q, '--recommendation', 'yes'], SUP);
    refused('Can we get a new API key from you?', /don't ask for a credential in a decision's words/, 'a credential from the owner is still a paste box');
    refused('Should I ask you to post the deploy token as well?', /don't ask whether to ask/, 'a credential asked of the owner "as well" is still asking about asking');
    for (const q of ['Should I ask the vendor for a refund on the unused seats?', 'Can we request a quota increase from AWS before launch?', 'Should we prompt users to log in again after the password change?', 'Should I request an API key from the vendor?', 'Should the app request access to contacts?', 'Would you give customers API keys on the free plan?', 'Should we send the API key in a header or a query param?', 'Do a dry-run/staging deploy first?']) ok(old, ['ask', '--question', q, '--recommendation', 'yes'], SUP);

    // a credential named in a decision gets a nudge to the paste box; one with --secrets doesn't
    const r = run(old, ['ask', '--question', 'Rotate the API keys after the leak?', '--recommendation', 'yes'], SUP);
    assert.equal(r.status, 0);
    assert.match(r.err, /needs a credential. Ask for it directly: --kind owner-action with --secrets/);
    const s = run(old, ['ask', '--kind', 'owner-action', '--question', 'Post the staging Postgres password', '--context', 'Workers need it to run the import against staging.', '--secrets', JSON.stringify([{ name: 'STAGING_DB_PASSWORD', sink: 'file:.devteam-secrets/staging-db' }])], SUP);
    assert.equal(s.status, 0, s.err);
    assert.doesNotMatch(s.err, /needs a credential/);

    // a literal \n from a shell argument is a line break by the time it reaches the owner
    const id = ok(old, ['ask', '--question', 'Which way should sign-in go?', '--context', 'Two ways:\\n- email links\\n- passwords', '--recommendation', 'email links'], SUP);
    assert.equal(json(ok(old, ['questions', '--id', id, '--json']))[0].context, 'Two ways:\n- email links\n- passwords');
    // only where it can be nothing else: not in code, a Windows path, an escaped backslash, or text with real breaks
    const keep = (context) => assert.equal(json(ok(old, ['questions', '--id', ok(old, ['ask', '--question', 'Where should the build cache live?', '--context', context, '--recommendation', 'yes'], SUP), '--json']))[0].context, context);
    keep('It is at C:\\new\\node_modules today.');
    keep('The check is `grep "\\n" out.txt`.');
    keep('Written \\\\n in the config.');
    keep('Line one\nand a literal \\n in line two.');
    assert.match(run(old, ['ask', '--question', 'Ship it?', '--context', 'It is on q-20261101-120000000-supervisor.', '--recommendation', 'yes'], SUP).err, /--context names a kit id/);
  } finally { F.done(); }
});

// The dashboard's qblock, run on its own source: paragraphs, bullets, numbered lists (a run on one
// line too), bold and code, and everything escaped.
function dashboardFns() {
  const html = fs.readFileSync(path.join(ROOT, 'docs/devteam/dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('<script>', html.indexOf('</style>')) + '<script>'.length, html.lastIndexOf('</script>'));
  const pick = (name) => { const at = src.indexOf(`function ${name}(`) >= 0 ? src.indexOf(`function ${name}(`) : src.indexOf(`const ${name} =`); assert.ok(at >= 0, name); return at; };
  const take = (name) => { const at = pick(name); let depth = 0, i = src.indexOf('{', at); const arrow = src.startsWith(`const ${name} =`, at); if (arrow) return src.slice(at, src.indexOf(';\n', at) + 1); for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; } return src.slice(at, i + 1); };
  const ctx = { NAME_REF: /\[\[([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]\]/ };
  vm.createContext(ctx);
  vm.runInContext(`${take('esc')}\nfunction linkify(t) { return esc(t ?? ''); }\nconst artNameLink = () => '';\nconst linkOf = (l) => '<a href="' + esc(l.url) + '">' + esc(l.title) + '</a>';\n${take('qtext')}\n${take('qinline')}\n${take('inlineList')}\n${take('NUMBERED')}\n${take('qblock')}\nthis.qblock = qblock; this.qinline = qinline;`, ctx);
  return ctx;
}

test('dashboard: a question\'s context is laid out as paragraphs and lists, escaped', () => {
  const { qblock, qinline } = dashboardFns();
  assert.equal(qblock('What it unblocks:\n- sign-in\n- billing\n\nSteps:\n1. Open Stripe\n2. Copy the **test** key', []),
    '<p>What it unblocks:</p><ul><li>sign-in</li><li>billing</li></ul><p>Steps:</p><ol><li>Open Stripe</li><li>Copy the <b>test</b> key</li></ol>');
  assert.equal(qblock('Two ways: 1) wait for the vendor 2) ship our own shim, or 3) drop it.', []), '<p>Two ways:</p><ol><li>wait for the vendor</li><li>ship our own shim</li><li>drop it.</li></ol>', 'a numbered run on one line');
  assert.equal(qblock('(1) first (2) second', []), '<ol><li>first</li><li>second</li></ol>');
  assert.equal(qblock('We are on version 2) of the plan.', []), '<p>We are on version 2) of the plan.</p>', 'a lone number is prose');
  assert.equal(qblock('one\ntwo', []), '<p>one<br>two</p>');
  assert.equal(qblock('<img src=x onerror=alert(1)> **b** `c`', []), '<p>&lt;img src=x onerror=alert(1)&gt; <b>b</b> <code>c</code></p>', 'escaped first, then formatted');
  assert.equal(qinline('Ship `v2` **now**?', []), 'Ship <code>v2</code> <b>now</b>?');
  // numbers in prose are prose: a sentence that ends in one, a date, a parenthesis, a version, a time
  for (const prose of ['We finished step 1. Then we moved to step 2. Finally we shipped.', 'We deploy on Nov 1. Marketing emails go out Nov 2. Is that OK?', 'The plan (phase 1) and the follow-up (phase 2) both need a database.', 'It runs at 10.30, costs $1.50 on v2.1. Then 3.5x faster.']) assert.equal(qblock(prose, []), `<p>${prose}</p>`, prose);
  assert.equal(qblock('Options: 1. wait 2. ship', []), '<p>Options:</p><ol><li>wait</li><li>ship</li></ol>', '"1." opens a run after a colon');
  assert.equal(qblock('1. Raise the limit to 2. Then restart\n2. Watch the queue', []), '<ol><li>Raise the limit to 2. Then restart</li><li>Watch the queue</li></ol>', 'a list written one per line keeps its lines whole');
  assert.equal(qblock('Do this next:\n3. Rotate the key\n4. Redeploy', []), '<p>Do this next:</p><ol start="3"><li>Rotate the key</li><li>Redeploy</li></ol>', 'a list keeps the number it starts at');
  // marks are read before escaping and never reach into a link: its href stays whole
  const links = [{ name: 'a', title: 'A', url: 'https://x.test/src/**/a' }, { name: 'b', title: 'B', url: 'https://x.test/src/**/b`c' }];
  assert.equal(qinline('Compare [[a]] with `x` [[b]]', links), 'Compare <span class="qref"><a href="https://x.test/src/**/a">A</a></span> with <code>x</code> <span class="qref"><a href="https://x.test/src/**/b`c">B</a></span>');
  assert.equal(qinline('`a**b**c`, 2**10 and 3**2, src/**/*.js and test/**/*.js', []), '<code>a**b**c</code>, 2**10 and 3**2, src/**/*.js and test/**/*.js', 'code is literal, and ** inside words is not bold');
  assert.equal(qinline('**run `x` now** and **<i>', []), '<b>run <code>x</code> now</b> and **&lt;i&gt;', 'code inside bold; an unclosed mark stays as written');
});

// A default stands in for the owner only at its deadline, and only where it could fire when the owner
// saw the question: answer --defaulted, act and decide --approved, a decision's authority and
// log-check all hold to it, however the lines were written.
test('defaults: only at the deadline, only from rung 2 as asked, never on a door or the owner\'s own', () => {
  const F = fleetFixture('defaults');
  const { old, ok, run } = F;
  try {
    const supLog = () => { const dir = path.join(old, 'docs/devteam/run/log'); return path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith('supervisor-'))); };
    const ask = (q, ...opts) => ok(old, ['ask', '--class', 'priority-change', '--question', q, '--recommendation', 'yes', '--default', 'yes', '--reasons', 'below-rung', ...opts], SUP);
    const defaulted = (id) => fs.appendFileSync(supLog(), line({ id, type: 'question', op: 'set', at: new Date().toISOString(), by: 'supervisor', status: 'defaulted' }));
    const refused = (args, re, why) => { const r = run(old, args, SUP); assert.notEqual(r.status, 0, why); assert.match(r.err, re, why); };

    // the CLI: a default fires at its deadline, in every class, not a second before
    const Q1 = ask('Move the export work ahead of search?');
    refused(['answer', Q1, '--defaulted'], /default fires at .*until then it is the owner's to answer/, 'answer --defaulted waits for the deadline');
    refused(['act', '--class', 'priority-change', '--approved', Q1, '--', 'moved it'], /is not an answered question/, 'an open question approves nothing');
    pastDeadline(old, Q1);
    ok(old, ['answer', Q1, '--defaulted'], SUP);
    const A1 = ok(old, ['act', '--class', 'priority-change', '--approved', Q1, '--', 'moved export ahead of search'], SUP);
    assert.equal(json(ok(old, ['log', '--id', A1, '--json']))[0].approved_by, Q1, 'at the deadline, the default approves the call');

    // a defaulted line written by hand before the deadline approves nothing: act, decide, a decision, log-check
    const Q2 = ask('Move the import work ahead of search?');
    defaulted(Q2);
    refused(['act', '--class', 'priority-change', '--approved', Q2, '--', 'moved it'], new RegExp(`${Q2} was defaulted before its deadline .*approves nothing`), 'act --approved');
    refused(['decide', '--class', 'priority-change', '--approved', Q2, '--', 'move it'], new RegExp(`${Q2} was defaulted before its deadline`), 'decide --approved');
    let lc = run(old, ['log-check']);
    assert.equal(lc.status, 0, lc.err || lc.out);
    assert.match(lc.out, new RegExp(`warn: ${Q2}'s default approves nothing: ${Q2} was defaulted before its deadline`), 'log-check names the early default');
    const D = 'd-20261101-235959000-supervisor';
    fs.appendFileSync(supLog(), line({ id: D, type: 'decision', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'priority-change', what: 'move it', refs: [], authority: 'default', approved_by: Q2, rung: 2, reversible: true }));
    refused(['act', '--decision', D, '--', 'moved it'], /records authority it doesn't have \(.*defaulted before its deadline/, 'a decision written by hand on it');
    lc = run(old, ['log-check']);
    assert.notEqual(lc.status, 0, 'a call standing on it fails log-check');
    assert.match(lc.out, new RegExp(`fail: ${D} stands on ${Q2}'s default, which approves nothing`));

    // migration: a default asked on rung 1 stays inert after its class moves to rung 2, as the owner saw it
    const Q3 = 'q-20261101-235958000-supervisor';
    fs.appendFileSync(supLog(), line({ id: Q3, type: 'question', op: 'new', at: new Date(Date.now() - 25 * 3600000).toISOString(), by: 'supervisor', kind: 'owner-decision', class: 'release-scope', question: 'Move the reports story to the next release?', recommendation: 'yes', default: 'yes', deadline: new Date(Date.now() - 3600000).toISOString(), why_asked: { rung: 1, ceiling: 3, reasons: ['below-rung'] } }));
    assert.equal(json(ok(old, ['trust', '--json'])).find((r) => r.class === 'release-scope').rung, 2, 'the class is on rung 2 now');
    refused(['answer', Q3, '--defaulted'], new RegExp(`${Q3} was asked on rung 1 \\(ask\\), where a default never stands in for the owner`), 'answer --defaulted');
    defaulted(Q3);
    refused(['act', '--class', 'release-scope', '--approved', Q3, '--', 'moved it'], /was asked on rung 1/, 'act --approved');
    assert.match(run(old, ['log-check']).out, new RegExp(`warn: ${Q3}'s default approves nothing: ${Q3} was asked on rung 1`));

    // ask: no default where it could never fire, or where silence is never a yes
    refused(['ask', '--class', 'release-production', '--question', 'Ship version 2 to production?', '--recommendation', 'yes', '--default', 'yes'], /release-production is on rung 1: no --default until it's on rung 2/, 'a class below rung 2');
    refused(['ask', '--kind', 'one-way-door', '--question', 'Switch the database to Postgres?', '--recommendation', 'yes', '--default', 'yes'], /a one-way door has no --default/, 'a one-way door');
    refused(['ask', '--question', 'Switch the database to Postgres?', '--reasons', 'one-way-door', '--recommendation', 'yes', '--default', 'yes'], /a one-way door has no --default/, 'one-way-door as a reason');
    refused(['ask', '--class', 'gate-change', '--question', 'Drop the lint check on generated files?', '--recommendation', 'yes', '--default', 'yes'], /gate-change is the owner's .*no --default/, 'an owner-only class');
  } finally { F.done(); }
});
