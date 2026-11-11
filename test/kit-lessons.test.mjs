// The kit-lesson tag: the supervisor's own mark on its own knowledge, "this looks like it would hold
// for any project on the kit", for the box's operator to read. It grants nothing, so the tests below
// check who can set it (the command, a hand-written line in each writer's file, the fold) and that
// nothing but the listings reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, line, monoFixture } from './lib/kit.mjs';

test('a kit lesson is the supervisor\'s tag on its own knowledge, and grants nothing', () => {
  const F = monoFixture('kit-lessons');
  const { old, ok, run } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const obs = ok(old, ['observe', '--subject', 'kit', '--kind', 'friction', '--detail', 'the sync step is missing', '--severity', '1', '--valence', '-1'], SUP);
    const lesson = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Run the sync step before the merge', '--scope', 'project', '--evidence', obs, '--kit'], SUP);
    const plain = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Our API is slow on Mondays', '--scope', 'project', '--evidence', obs], SUP);
    const rule = ok(old, ['knowledge', 'add', '--kind', 'preference', '--statement', 'Ship banners without asking', '--scope', 'project', '--owner']);
    const all = () => Object.fromEntries(json(ok(old, ['knowledge', '--json'])).map((k) => [k.id, k]));
    assert.equal(all()[lesson].kit_lesson, true);
    assert.equal(all()[plain].kit_lesson, undefined);
    // listed, and marked in the list; the owner's entry is marked as theirs
    const listed = ok(old, ['knowledge']);
    assert.match(listed, new RegExp(`^${lesson} \\[lesson, candidate, project, kit lesson\\] `, 'm'));
    assert.match(listed, new RegExp(`^${rule} \\[preference, accepted, project, owner's\\] `, 'm'));
    assert.deepEqual(ok(old, ['knowledge', '--kit']).split('\n').map((l) => l.split(' ')[0]), [lesson]);
    // tagged and untagged by set
    ok(old, ['knowledge', 'set', plain, '--kit'], SUP);
    assert.equal(all()[plain].kit_lesson, true);
    ok(old, ['knowledge', 'set', plain, '--kit', 'off'], SUP);
    assert.equal(all()[plain].kit_lesson, false);
    assert.match(run(old, ['knowledge', 'set', plain, '--kit', 'maybe'], SUP).err, /--kit is on or off/);
    // never on the owner's entry, and never by the owner: it is the supervisor's suggestion
    const refused = run(old, ['knowledge', 'set', rule, '--kit'], SUP);
    assert.notEqual(refused.status, 0);
    assert.match(refused.err, /the supervisor's tag on its own knowledge/);
    assert.match(run(old, ['knowledge', 'set', lesson, '--kit', 'off', '--owner']).err, /the supervisor's tag/);
    assert.match(run(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'x', '--kit', '--owner']).err, /the supervisor's tag/);
    // a line written by hand gets no further than the command
    const month = new Date().toISOString().slice(0, 7);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const at = new Date(Date.now() + 1000).toISOString();
    const liveDir = path.join(old, 'docs/devteam/run/log');
    fs.appendFileSync(path.join(liveDir, `supervisor-${month}.jsonl`), line({ id: rule, type: 'knowledge', op: 'set', at, by: 'supervisor', kit_lesson: true }));
    const forged = `k-${day}-000000001-owner`;
    fs.appendFileSync(path.join(liveDir, `owner-${month}.jsonl`), line({ id: forged, type: 'knowledge', op: 'new', at, by: 'owner', channel: 'cli', kind: 'lesson', statement: 'forged', scope: 'project', status: 'accepted', kit_lesson: true }));
    fs.appendFileSync(path.join(liveDir, `owner-${month}.jsonl`), line({ id: lesson, type: 'knowledge', op: 'set', at, by: 'owner', channel: 'cli', kit_lesson: false }));
    // nor can the supervisor pass a note off as the owner's on a line of its own
    const noted = `k-${day}-000000002-supervisor`;
    fs.appendFileSync(path.join(liveDir, `supervisor-${month}.jsonl`), line({ id: noted, type: 'knowledge', op: 'new', at, by: 'supervisor', kind: 'lesson', statement: 'noted', scope: 'project', status: 'accepted', owner_note: 'the owner says so' }));
    assert.equal(all()[noted], undefined, 'a supervisor line carrying owner_note doesn\'t count');
    assert.equal(all()[rule].kit_lesson, undefined, 'the supervisor\'s line on the owner\'s rule is ignored');
    assert.equal(all()[forged], undefined, 'an owner line carrying the tag doesn\'t count');
    assert.equal(all()[lesson].kit_lesson, true, 'nor does the owner untagging one');
    const check = run(old, ['log-check']);
    assert.match(check.out, new RegExp(`ignored: supervisor-${month}\\.jsonl:\\d+ ${rule}: kit_lesson is the supervisor's tag on knowledge it wrote`));
    assert.match(check.out, /fail: owner-\d{4}-\d{2}\.jsonl:\d+: .*kit_lesson is the supervisor's tag on its own knowledge/);
    // it changes no prompt: the knowledge block is the same tagged and untagged
    ok(old, ['knowledge', 'set', lesson, '--status', 'accepted'], SUP);
    ok(old, ['knowledge', 'set', plain, '--status', 'accepted'], SUP);
    const tagged = ok(old, ['knowledge', '--for', 'project']);
    ok(old, ['knowledge', 'set', lesson, '--kit', 'off'], SUP);
    assert.equal(ok(old, ['knowledge', '--for', 'project']), tagged);
    assert.doesNotMatch(tagged, /kit/i);
  } finally { F.done(); }
});
