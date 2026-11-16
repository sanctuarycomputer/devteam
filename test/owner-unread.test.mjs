// Every owner line is in the log whether the supervisor is up or not; a cursor says which ones the
// supervisor has dealt with. An answer given while the supervisor was down, then a restart: the
// line is unread, the opening prompt says so, and past ten minutes the owner-unread finding (high)
// is raised, until the supervisor acks it. Nothing is cleared by a nudge or a screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

test('an owner answer stays unread, is in the opening prompt and raises owner-unread, until the supervisor acks it', () => {
  const F = threadsFixture('owner-unread');
  try {
    const AWAY = { DEVTEAM_SUPERVISOR: 'no-such-session:0' };
    const ask = (q) => F.sup(['ask', '--kind', 'owner-decision', '--goal', F.goal, '--question', q, '--recommendation', 'Yes', '--options', 'Yes', 'No']).trim().split('\n')[0];
    const unread = () => JSON.parse(F.sup(['unread', '--json'])).unread;
    const ackListed = () => { const u = unread(); return u.length ? F.sup(['unread', 'ack', u.at(-1).ref]) : 'nothing unread'; };
    const finding = () => JSON.parse(F.sup(['metrics', '--json'])).findings.find((f) => f.kind === 'owner-unread');
    // start from a clean slate: whatever the fixture's owner wrote is dealt with
    ackListed();
    assert.deepEqual(unread(), []);
    const q1 = ask('Ship the EU launch first?');
    const q2 = ask('Keep the old checkout a week?');
    // the owner answers while the supervisor is down: the nudge reaches no one
    F.owner(['answer', q1, 'Yes'], AWAY);
    const u = unread();
    assert.equal(u.length, 1, JSON.stringify(u));
    assert.match(u[0].what, /Yes/);
    assert.match(F.sup(['unread']), /1 unread\. Act on each/);
    // the restart: the opening prompt leads with it
    assert.match(F.sup(['prompt', 'supervisor']), /The owner wrote 1 line you haven't dealt with yet/);
    // within the grace, no finding; past it, high
    assert.equal(finding(), undefined, 'not yet: a nudge may still be on its way');
    // a line from twenty minutes ago that reached this machine only now (synced late): unread too,
    // and old enough to raise the finding. The floor is put back an hour so the line is above it.
    const cf = path.join(F.old, 'docs/devteam/run/owner-cursor.json');
    const c = JSON.parse(fs.readFileSync(cf, 'utf8'));
    fs.writeFileSync(cf, JSON.stringify({ ...c, floor: new Date(Date.now() - 3600000).toISOString() }));
    F.hand('owner', { type: 'thread', title: 'An old one from while you were away' }, 20 * 60000);
    const f = finding();
    assert.ok(f, 'owner-unread once a line is over ten minutes old');
    assert.equal(f.severity, 'high');
    // ack up to the first: the later one stays
    const all = unread();
    assert.equal(all.length, 2, 'the late line and the answer');
    assert.match(all[0].what, /^thread/, 'oldest first: the late line');
    F.sup(['unread', 'ack', all[0].id]);
    assert.deepEqual(unread().map((x) => x.id), [all[1].id]);
    // a new answer after the ack is unread again; acking the last listed ref clears everything listed
    F.owner(['answer', q2, 'No'], AWAY);
    assert.equal(unread().length, 2);
    assert.match(ackListed(), /nothing unread/);
    assert.deepEqual(unread(), []);
    assert.equal(finding(), undefined);
    assert.doesNotMatch(F.sup(['prompt', 'supervisor']), /you haven't dealt with yet/);
    // only the supervisor moves the cursor: the operator may read the list, never ack it
    assert.match(F.owner(['unread'], { DEVTEAM_ROLE: 'operator' }), /nothing unread/);
    assert.match(F.fails(['unread', 'ack', 'x'], { DEVTEAM_ROLE: 'operator' }), /operator/);
    assert.ok(fs.existsSync(path.join(F.old, 'docs/devteam/run/owner-cursor.json')));
  } finally { F.done(); }
});

// With no cursor yet, the floor is pinned the first time the supervisor writes, so its own later
// lines never mark an earlier owner line read; and two owner lines on one object (each a `set` line
// carrying that object's id) are read one at a time.
test('owner-unread: the first supervisor line pins the floor, and lines sharing an id are acked one by one', () => {
  const F = threadsFixture('owner-unread-floor');
  try {
    const cf = path.join(F.old, 'docs/devteam/run/owner-cursor.json');
    const unread = () => JSON.parse(F.sup(['unread', '--json'])).unread;
    const ackListed = () => { const u = unread(); return u.length ? F.sup(['unread', 'ack', u.at(-1).ref]) : 'nothing unread'; };
    ackListed();
    // an upgrade: no cursor file, and the owner wrote after the supervisor's last line
    fs.rmSync(cf, { force: true });
    const tid = F.hand('owner', { type: 'thread', title: 'A word while you were away' }, 0);
    assert.equal(unread().length, 1, 'unread with no cursor');
    // the supervisor's tick writes a line of its own before it reads unread: the owner's stays unread
    F.sup(['observe', '--source', 'supervisor', '--subject', 'tick', '--kind', 'note', '--detail', 'a tick line']);
    assert.ok(fs.existsSync(cf), 'the first supervisor line pins the floor in a cursor');
    assert.equal(unread().length, 1, 'its own later line does not mark the owner\'s read');
    // a second owner line on the same thread (closing it): same id, a different line
    F.hand('owner', { id: tid, type: 'thread', op: 'set', status: 'closed' }, 0);
    const two = unread();
    assert.equal(two.length, 2);
    assert.equal(two[0].id, two[1].id, 'both lines carry the thread\'s id');
    assert.notEqual(two[0].ref, two[1].ref);
    F.sup(['unread', 'ack', two[0].ref]);
    assert.deepEqual(unread().map((x) => x.ref), [two[1].ref], 'acking the first leaves the second unread');
    ackListed();
    assert.deepEqual(unread(), []);
    // ack acts only on what was listed: a line written between unread and ack stays unread
    const seen = F.hand('owner', { type: 'thread', title: 'Seen in the listing' }, 0);
    const shown = unread();
    assert.equal(shown.length, 1);
    F.hand('owner', { id: seen, type: 'thread', op: 'set', status: 'closed' }, 0);
    assert.match(F.fails(['unread', 'ack', '--all']), /ref of the last line you dealt with/);
    assert.match(F.fails(['unread', 'ack', seen]), /2 unread lines carry/, 'a bare id two lines share is refused');
    F.sup(['unread', 'ack', shown[0].ref]);
    assert.equal(unread().length, 1, 'the line written after the listing is still unread');
    ackListed();
    // a corrupt cursor is pinned again, not read as no cursor on every call
    fs.writeFileSync(cf, '{"floor": "2026');
    const tid2 = F.hand('owner', { type: 'thread', title: 'After the crash' }, 0);
    F.sup(['observe', '--source', 'supervisor', '--subject', 'tick', '--kind', 'note', '--detail', 'a tick line after a crash']);
    // (lines acked before the crash may come back too: a lost cursor errs on reading twice, never on missing one)
    assert.ok(unread().map((x) => x.id).includes(tid2), 'the owner\'s line survives the supervisor\'s next line');
    ackListed();
    // the acked list stays bounded: keys under the floor are dropped
    const c = JSON.parse(fs.readFileSync(cf, 'utf8'));
    assert.ok(c.acked.every((k) => k.split('|')[0] > c.floor));
  } finally { F.done(); }
});
