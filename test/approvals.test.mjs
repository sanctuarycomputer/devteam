// What approves what: a chat answer is an Inbox answer, and a chore that changes real kit files
// needs a governance-edit, process-edit or gate-change answer (the owner's rulings, 2026-11-09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, write, json } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// A chore PR off main with these files; call the result to dry-run its merge.
function choreOf(F, slug, files) {
  const { old, g, run } = F;
  const w = path.join(old, '.worktrees', `chore-${slug}`);
  g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
  for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
  g(['add', '-A'], w);
  g(['commit', '-qm', slug], w);
  g(['push', '-q', 'origin', `chore-${slug}`], w);
  write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
  return (...extra) => { const r = run(old, ['merge', '--chore', slug, '--dry-run', ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
}
const answered = (F, opts, answer, role) => { const q = F.ok(F.old, ['ask', ...opts], SUP); F.ok(F.old, ['answer', q, answer, ...(role ?? [])], role ? SUP : undefined); return q; };
const asked = (question, cls) => ['--question', question, '--recommendation', 'yes', ...(cls ? ['--class', cls, '--reasons', cls === 'release-scope' ? 'below-rung' : 'owner-only'] : [])];

test('a chore that changes a real kit file needs a kit-class answer; outside the kit, the chore rule is as it was', () => {
  const F = fleetFixture('kit-answers');
  try {
    const merge = choreOf(F, 'rules', { 'docs/devteam/governance/quality.md': 'A changed rule.\n' });
    assert.match(merge().text, /touches files outside project\//, 'no answer: refused');
    const unrelated = answered(F, asked('Move the story?', 'release-scope'), 'yes');
    const r = merge('--approved', unrelated);
    assert.notEqual(r.status, 0, 'an unrelated class does not approve a kit file');
    assert.match(r.text, /changes kit files \(docs\/devteam\/governance\/quality\.md\); that needs the owner's answer in a governance-edit, process-edit, gate-change question, and q-\S+ is release-scope/);
    const classless = answered(F, asked('Change quality.md?'), 'yes');
    assert.match(merge('--approved', classless).text, /is classless/, 'nor a classless one');
    const fromChat = answered(F, asked('Change quality.md?', 'process-edit'), 'yes', ['--from-chat', '--said', 'yes, change it']);
    assert.equal(merge('--approved', fromChat).status, 0, 'a kit-class answer approves it, and chat counts');
    const gov = answered(F, asked('Change quality.md?', 'governance-edit'), 'yes');
    assert.equal(merge('--approved', gov).status, 0, 'so does a governance-edit answer');

    // outside the kit and project/: any answered question, as before
    const ops = choreOf(F, 'ops', { 'scripts/ops.sh': 'x\n', '.github/CODEOWNERS': 'x\n' });
    assert.match(ops().text, /touches files outside project\//);
    assert.equal(ops('--approved', unrelated).status, 0, 'files outside the kit need only an owner answer');
    // project/ is the supervisor's: no answer needed
    assert.equal(choreOf(F, 'notes', { 'docs/devteam/project/designs/notes.md': 'n\n' })().status, 0, 'project/ files need no question');
  } finally { F.done(); }
});

test('a secret chore is not a kit change: the answer that posted it is enough', () => {
  const F = fleetFixture('secret-chore');
  const { old, ok } = F;
  try {
    const post = (sink, posted = true) => { const q = ok(old, ['ask', '--kind', 'owner-action', '--question', 'Post the key', '--secrets', JSON.stringify([{ name: 'KEY', sink }])], SUP); ok(old, ['answer', q, 'Posted 1 secret']); if (posted) fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `owner-${new Date().toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, id: q, type: 'question', op: 'set', at: new Date().toISOString(), by: 'owner', secrets_posted: [{ name: 'KEY' }] })}\n`); return q; };
    const outsideKit = post('sops:config/secrets.enc.yaml:api.token');
    assert.equal(choreOf(F, 'secret-1', { 'config/secrets.enc.yaml': 'enc\n' })('--approved', outsideKit).status, 0, 'an encrypted store outside the kit');
    const inKit = post('sops:docs/devteam/secrets.enc.yaml:api.token');
    assert.equal(choreOf(F, 'secret-2', { 'docs/devteam/secrets.enc.yaml': 'enc\n' })('--approved', inKit).status, 0, 'an encrypted store under the kit path');
    const r = choreOf(F, 'secret-3', { 'docs/devteam/secrets.enc.yaml': 'enc\n', 'docs/devteam/governance/quality.md': 'A changed rule.\n' })('--approved', inKit);
    assert.notEqual(r.status, 0, 'a real kit file in the same chore still needs a kit-class answer');
    assert.match(r.text, /changes kit files \(docs\/devteam\/governance\/quality\.md\)/);
    // "Posted" with nothing posted is no exemption, whatever the sink names
    const none = post('sops:docs/devteam/scripts/devteam.mjs:a.b', false);
    assert.notEqual(choreOf(F, 'secret-4', { 'docs/devteam/scripts/devteam.mjs': 'replaced\n' })('--approved', none).status, 0, 'an answer that posted nothing');
  } finally { F.done(); }
});

test('goal decide --from-chat answers a goal-approval question', () => {
  const F = fleetFixture('goal-chat');
  const { old, ok, run } = F;
  try {
    const G = ok(old, ['goal', 'add', '--title', 'Floor', '--outcome', 'the floor holds', '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a'], SUP);
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    ok(old, ['goal', 'set', G, '--priority', '1', '--milestones', JSON.stringify([{ title: 'Floor', target: 0, preconditions: [1], tickets: 2 }])], SUP);
    write(path.join(old, 'docs/devteam/project/designs/floor.md'), '# design\n');
    F.g(['add', '-A'], old);
    F.g(['commit', '-qm', 'design'], old);
    F.g(['push', '-q', 'origin', 'main'], old);
    const Q = ok(old, ['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve the floor?', '--links', JSON.stringify([{ title: 'design', path: 'docs/devteam/project/designs/floor.md', ref: 'main' }])], SUP);
    assert.match(run(old, ['answer', Q, 'approve', '--from-chat', '--said', 'approved'], SUP).err, /goal decide .* --from-chat --said/, 'answer points at the command that answers it');
    assert.notEqual(run(old, ['goal', 'decide', G, 'refine', '--notes', 'smaller', '--from-chat'], SUP).status, 0, "the owner's words are required");
    assert.notEqual(run(old, ['goal', 'decide', G, 'refine', '--notes', 'smaller', '--from-chat', '--said', 'smaller'], { DEVTEAM_ROLE: 'worker' }).status, 0, 'only the supervisor records it');
    ok(old, ['goal', 'decide', G, 'refine', '--notes', 'smaller', '--from-chat', '--said', 'make it smaller'], SUP);
    const q = json(ok(old, ['questions', '--id', Q, '--json']))[0];
    assert.deepEqual([q.status, q.answer, q.channel, q.said, q.answered_by], ['answered', 'Refine — smaller', 'chat', 'make it smaller', 'owner']);
    assert.match(run(old, ['goal', 'decide', G, 'refine', '--notes', 'again', '--from-chat', '--said', 'again'], SUP).err, /there is none/, 'nothing open to answer');
    ok(old, ['log-check']);
  } finally { F.done(); }
});

test('metrics records a chat quote that is not in an owner-typed line of the supervisor transcript', () => {
  const F = fleetFixture('chat-quote');
  const { old, ok, home } = F;
  try {
    const q = (text) => { const id = ok(old, ['ask', '--question', text, '--class', 'release-scope', '--reasons', 'below-rung', '--recommendation', 'yes'], SUP); return id; };
    const said = 'Ship it, I checked staging';
    const real = q('Ship?');
    ok(old, ['answer', real, 'yes', '--from-chat', '--said', said], SUP);
    const made = q('Drop the column?');
    ok(old, ['answer', made, 'yes', '--from-chat', '--said', 'sure, drop the column'], SUP);
    const findings = () => json(ok(old, ['metrics', '--json'])).findings.filter((f) => f.kind === 'chat-quote-not-found');
    // not claude's, or no transcript: nothing said
    assert.deepEqual(findings(), [], 'another harness: skipped');
    const sf = path.join(old, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"resume_command": "true"', '"resume_command": "claude --continue"'));
    F.g(['add', '-A'], old);
    F.g(['commit', '-qm', 'a claude supervisor'], old);
    F.g(['push', '-q', 'origin', 'main'], old);
    assert.deepEqual(findings(), [], 'no transcript: skipped');
    const dir = path.join(home, 'claude', 'projects', fs.realpathSync(old).replace(/[^a-zA-Z0-9]/g, '-'));
    const ts = new Date(Date.now() - 60000).toISOString();
    const lines = [
      { type: 'user', userType: 'external', timestamp: ts, message: { role: 'user', content: 'You are the supervisor for this repository.' } },
      { type: 'user', userType: 'external', timestamp: ts, message: { role: 'user', content: [{ type: 'text', text: 'ok: ship it,  I checked staging. carry on' }] } },
      { type: 'user', userType: 'external', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', content: 'sure, drop the column' }] } },
      { type: 'assistant', timestamp: ts, message: { role: 'assistant', content: 'sure, drop the column' } },
    ];
    write(path.join(dir, 'session.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const found = findings();
    assert.deepEqual(found.map((f) => [f.subject, f.severity]), [[made, 'medium']], 'only the quote the owner never typed; tool results and the agent\'s own words are not the owner\'s');
    assert.match(found[0].detail, /sure, drop the column/);
    // a queued message from another agent isn't the owner's; one the owner typed mid-turn is
    const queued = (kind) => fs.appendFileSync(path.join(dir, 'session.jsonl'), `${JSON.stringify({ type: 'attachment', timestamp: ts, origin: { kind }, attachment: { type: 'queued_command', prompt: 'yes, sure, drop the column' } })}\n`);
    queued('peer');
    assert.equal(findings().length, 1, "a peer's queued message is not the owner's");
    queued('human');
    assert.deepEqual(findings(), [], 'found once the owner typed it');
    // a re-ask after the owner's no, quoting them, is checked the same way
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"resume_command":', '"remediations": { "restart-web": { "kind": "restart", "script": "project/remediations/restart.mjs", "sha": "' + 'a'.repeat(40) + '" } }, "resume_command":'));
    F.g(['add', '-A'], old);
    F.g(['commit', '-qm', 'a remediation'], old);
    F.g(['push', '-q', 'origin', 'main'], old);
    const qno = ok(old, ['ask', '--class', 'production-remediation', '--blocks', 'remediation:restart-web', '--question', 'Restart?', '--recommendation', 'restart it'], SUP);
    ok(old, ['answer', qno, 'no']);
    const again = ok(old, ['ask', '--class', 'production-remediation', '--blocks', 'remediation:restart-web', '--question', 'Restart again?', '--recommendation', 'restart it', '--owner-said', 'please restart it now'], SUP);
    assert.ok(findings().some((f) => f.subject === again), '--owner-said is checked against what the owner typed');
  } finally { F.done(); }
});
