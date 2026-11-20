// A superseded ticket is history (kit-328): validate's id-prefix rule ("id must start with its
// component") is for live tickets only. A ticket re-created under another component when its
// touches moved lines keeps its old id, and nothing can repair its component from the log, so the
// prescribed fix (supersede it with a ticket under the new component) has to clear the error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { monoFixture } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

test('validate --strict skips the id-prefix rule for a superseded ticket and keeps it for a live one', () => {
  const F = monoFixture('superseded-prefix');
  const { old, ok, run, lines } = F;
  try {
    lines({ ...F.STD, repo: { owns: ['repo/**'] }, leads: { owns: ['leads/**'] } });
    const tj = (component, extra = {}) => JSON.stringify({ title: 'x', feature: 'chores', component, kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${component}/**`], done_when: ['the check passes'], notes: 'n', ...extra });
    // the ticket as first planned, under component repo
    ok(old, ['ticket', 'add', 'repo-251-x', '--json', tj('repo')], SUP);
    // re-created under component leads when its touches moved to the leads line: the same id, its
    // line now naming a new component, as a re-plan rewrites its graph (no command sets a ticket's
    // component, so nothing can put it back)
    const logDir = path.join(old, 'docs/devteam/run/log');
    const file = path.join(logDir, fs.readdirSync(logDir).find((f) => f.startsWith('supervisor-')));
    const objs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const first = objs.find((o) => o.type === 'ticket' && o.id === 'repo-251-x' && o.op === 'new');
    const moved = (id, component) => ({ ...first, id, component, touches: [`${component}/**`] });
    fs.writeFileSync(file, objs.map((o) => `${JSON.stringify(o === first ? moved('repo-251-x', 'leads') : o)}\n`).join(''));
    const v = (...args) => { const r = run(old, ['validate', '--strict', ...args]); return { status: r.status, text: `${r.out}\n${r.err}` }; };
    const PREFIX = /repo-251-x: id must start with its component "leads-"/;
    assert.match(v().text, PREFIX, 'live, the moved ticket is refused: the reported case');
    // superseded by its replacement under the new component: clean
    ok(old, ['ticket', 'add', 'leads-252-x', '--json', tj('leads')], SUP);
    ok(old, ['ticket', 'set', 'repo-251-x', '--json', JSON.stringify({ superseded_by: 'leads-252-x' })], SUP);
    const plain = v();
    assert.doesNotMatch(plain.text, /id must start with its component/, 'a superseded ticket is history');
    assert.equal(plain.status, 0, `validate --strict is clean:\n${plain.text}`);
    const plan = v('--plan', 'chores');
    assert.doesNotMatch(plan.text, /id must start with its component/, 'and under --plan');
    // a live ticket whose id doesn't start with its component is still refused
    fs.appendFileSync(file, `${JSON.stringify({ ...moved('repo-253-y', 'leads'), at: new Date().toISOString() })}\n`);
    const live = v();
    assert.match(live.text, /repo-253-y: id must start with its component "leads-"/);
    assert.notEqual(live.status, 0);
    assert.match(v('--plan', 'chores').text, /repo-253-y: id must start with its component "leads-"/, 'and under --plan');
  } finally { F.done(); }
});
