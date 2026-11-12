// Questions the owner can read cold: ask refuses the fleet's vocabulary and questions about asking,
// warns where a credential should be a paste box, and the dashboard lays out lists as lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fleetFixture, json } from './lib/kit.mjs';

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
    refused('x'.repeat(301), /301 characters/, 'a question that should have been context');
    refused('Ship the billing page this week?', /low-confidence with --confidence 0.8/, 'low confidence that isn\'t', '--reasons', 'low-confidence', '--confidence', '0.8');

    // what still goes through: plain words, the stakes spelled out, and "should I" about the work itself
    ok(old, ['ask', '--question', 'Should I ship the billing page this week, or wait for the design review?', '--recommendation', 'Ship it'], SUP);
    ok(old, ['ask', '--question', 'What is at stake if we skip the migration?', '--recommendation', 'Run it'], SUP);
    // asking someone else, a product's own prompt, and the project's own paths are not the kit's business
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
  vm.runInContext(`${take('esc')}\nfunction linkify(t) { return esc(t ?? ''); }\nconst artNameLink = () => '';\nconst linkOf = () => '';\n${take('qtext')}\n${take('qinline')}\n${take('inlineList')}\n${take('qblock')}\nthis.qblock = qblock; this.qinline = qinline;`, ctx);
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
});
