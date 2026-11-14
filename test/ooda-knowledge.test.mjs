// Knowledge in decisions and prompts (the OODA spec, PR 4): a decision cites the knowledge or
// problems it rests on, a worker's or planner's start records the lessons its prompt carried, and a
// fixed incident nobody learned from is orientation debt until a lesson or a noise ruling cites it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line, hasTmux } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// A line as the kit would have written it agoMs ago, in its writer's file. Ids follow the kit's
// form, so each line picks a distinct agoMs; lines go in time order.
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  return (by, o, agoMs = 1000) => {
    const d = new Date(Date.now() - agoMs);
    const id = o.id ?? `${{ observation: 'o', problem: 'p', decision: 'd', act: 'a', knowledge: 'k' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const peek = (F, kind, id) => json(F.ok(F.old, ['peek', kind, id, '--json']));
const decisionOf = (F, id) => json(F.ok(F.old, ['log', '--type', 'decision', '--json'])).find((d) => d.id === id);

test('decide --on: a decision cites the accepted knowledge or problems it rests on, apart from its refs', () => {
  const F = fleetFixture('ooda-on');
  const { old, ok, run } = F;
  try {
    const o1 = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the registry has a scratch copy'], SUP).trim();
    const rule = ok(old, ['knowledge', 'add', '--kind', 'preference', '--statement', 'Keep scratch copies out of the registry', '--scope', 'project', '--owner']).trim();
    const cand = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Scratch copies confuse workers', '--scope', 'project', '--evidence', o1], SUP).trim();
    const old1 = ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'The registry was hand-kept', '--scope', 'project', '--owner']).trim();
    ok(old, ['knowledge', 'set', old1, '--status', 'retired', '--owner']);
    const p = ok(old, ['problem', 'add', '--title', 'registry drift', '--severity', '1'], SUP).trim();

    // without --on, then with it: the same call, the same authority; knowledge stored, refs as given
    const plain = ok(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--', 'the registry stays as it is'], SUP).trim();
    const on = ok(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', rule, p, '--', 'the registry stays as it is'], SUP).trim();
    const d0 = decisionOf(F, plain), d1 = decisionOf(F, on);
    assert.equal(d0.knowledge, undefined, 'no --on, no field');
    assert.deepEqual(d1.knowledge, [rule, p]);
    assert.deepEqual(d1.refs, [o1], 'never copied into refs');
    assert.equal(d1.authority, d0.authority, 'citing a standing rule with --on is not resting on it for authority');
    assert.equal(d1.approved_by, undefined);
    // an act under it stays within its refs, as before
    ok(old, ['act', '--decision', on, '--', 'left the registry as it is'], SUP);
    assert.match(run(old, ['act', '--decision', on, '--refs', rule, '--', 'x'], SUP).err, /outside it/);

    // refused: a candidate, a retired lesson, an observation, an unknown id, one in both lists, a bare --on
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', cand, '--', 'x'], SUP).err, new RegExp(`${cand} is candidate: a decision rests only on accepted knowledge`));
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', old1, '--', 'x'], SUP).err, new RegExp(`${old1} is retired: a decision rests only on accepted knowledge`));
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', o1, '--', 'x'], SUP).err, /--on .*knowledge or a problem/);
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', 'k-nope', '--', 'x'], SUP).err, /--on k-nope: no such/);
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, p, '--on', p, '--', 'x'], SUP).err, new RegExp(`${p} is in both --refs and --on`));
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', '--', 'x'], SUP).err, /--on names/);

    // lineage draws what it rests on before it
    const L = peek(F, 'decision', on).lineage;
    for (const k of [rule, p]) assert.ok(L.edges.some((e) => e.from === k && e.to === on && e.why === 'rests on'), `${k} → ${on}: ${JSON.stringify(L.edges)}`);
    // the peek names them in their own words
    assert.equal(peek(F, 'decision', on).cited[rule].text, 'Keep scratch copies out of the registry');
  } finally { F.done(); }
});

test('a start records the accepted knowledge its prompt carried: fresh starts only, newest first, at most 60', { skip: !hasTmux && 'no tmux' }, () => {
  const F = fleetFixture('ooda-given');
  const { old, ok } = F;
  const hand = handFor(F);
  const ticket = (id, component) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component, kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${component}/**`], done_when: ['the tidy check passes in CI'] })], SUP);
  const starts = () => json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'worker-slots');
  const startOf = (name) => starts().filter((a) => a.what.includes(` ${name} in `)).pop();
  const rawLine = (id) => fs.readdirSync(path.join(old, 'docs/devteam/run/log')).flatMap((f) => fs.readFileSync(path.join(old, 'docs/devteam/run/log', f), 'utf8').split('\n')).find((l) => l.includes(`"id":"${id}"`));
  try {
    // 61 accepted lessons for one component, written hours ago, in time order
    const many = Array.from({ length: 61 }, (_, i) => hand('owner', { type: 'knowledge', kind: 'lesson', statement: `lesson ${i} for the mn component`, scope: 'component:mn', status: 'accepted', evidence: [] }, (100 - i) * 60000));
    ticket('ch-01-tidy', 'ch');
    ticket('ot-01-other', 'ot');
    ticket('mn-01-many', 'mn');
    const lesson = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Run the tidy check before pushing', '--scope', 'component:ch', '--owner']).trim();
    ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Tidy checks are slow on Mondays', '--scope', 'component:ch', '--evidence', many[0]], SUP); // a candidate: not given

    // given: the one accepted lesson in its scope, in its prompt and on its act
    ok(old, ['worker', 'ch-01-tidy'], SUP);
    const a = startOf('ch-01-tidy');
    assert.match(a.what, /^made worker ch-01-tidy in /, 'what is as LAUNCH_ACT reads it');
    assert.deepEqual(a.knowledge, [lesson]);
    assert.ok(fs.readFileSync(path.join(old, 'docs/devteam/run/prompts/ch-01-tidy.txt'), 'utf8').includes(`(${lesson})`));
    // none in scope: no field
    ok(old, ['worker', 'ot-01-other'], SUP);
    assert.equal('knowledge' in startOf('ot-01-other'), false);
    assert.ok(!rawLine(startOf('ot-01-other').id).includes('"knowledge"'), 'omitted, not empty');
    // a resumed session never reads a new prompt: nothing recorded as given
    ok(old, ['worker', 'ch-01-tidy', '--resume'], SUP);
    const r = startOf('ch-01-tidy');
    assert.match(r.what, /^resumed worker ch-01-tidy in /);
    assert.equal(r.knowledge, undefined);
    // at most 60, newest first; the line stays under 4,096 bytes
    ok(old, ['worker', 'mn-01-many'], SUP);
    const m = startOf('mn-01-many');
    assert.equal(m.knowledge.length, 60);
    assert.deepEqual(m.knowledge, many.slice(1).reverse());
    assert.ok(Buffer.byteLength(rawLine(m.id)) < 4096, `${Buffer.byteLength(rawLine(m.id))} bytes`);
    // a planner's start too
    const G = ok(old, ['goal', 'add', '--title', 'Tidy everything', '--outcome', 'nothing untidy', '--measure', 'untidy files', '--target', '0', '--unit', 'files', '--direction', 'down', '--source', 'prod', '--check', 'echo 0', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
    const plan = ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'Plans name their goal', '--scope', 'project', '--owner']).trim();
    ok(old, ['planner', 'beta', '--goal', G], SUP);
    assert.deepEqual(startOf('plan-beta').knowledge, [plan]);
    // the lineage draws a lesson into the start it was given to
    const L = peek(F, 'act', a.id).lineage;
    assert.ok(L.edges.some((e) => e.from === lesson && e.to === a.id && e.why === 'given'), JSON.stringify(L.edges));
  } finally { F.done(); }
});

const H = 3600000;
test('orientation debt: an incident fixed and verified owes a lesson or a ruling that there is nothing to keep', () => {
  const F = fleetFixture('ooda-taught');
  const { old, ok } = F;
  const hand = handFor(F);
  // an incident, its fix decided and resolved ago hours ago, and (verified) the outcome citing it
  const incident = (n, ago, { outcome = true, owner = false, valence = 1 } = {}) => {
    const p = hand('supervisor', { type: 'problem', title: `incident ${n}`, severity: 3, realized: true, status: 'open', threatens: [], refs: [], fingerprints: [`web:log:L${n}`], sensor: 'web' }, ago);
    const d = hand('supervisor', { type: 'decision', class: 'incident-fix', scope: 'sev:high', what: `fix incident ${n}`, authority: 'rung', refs: [p, `fx-0${n}-fix`] }, ago - 1000);
    hand(owner ? 'owner' : 'supervisor', { type: 'problem', op: 'set', id: p, status: 'resolved' }, ago - 2000);
    const o = outcome ? hand('supervisor', { type: 'observation', source: 'web', detector: 'sensor', subject: p, kind: 'outcome', detail: `${p} resolved: quiet since the fix`, severity: 0, valence, refs: [d, `fx-0${n}-fix`, p], source_key: `sensor:verified:${p}:abc` }, ago - 3000) : null;
    return { p, d, o };
  };
  const debt = () => json(ok(old, ['dashboard-data'])).ooda.debt.incidents;
  try {
    const stale = incident(1, 31 * 24 * H);
    const taught = incident(2, 50 * H);
    const ruled = incident(3, 40 * H);
    const quiet = incident(4, 30 * H, { outcome: false });
    const owners = incident(5, 20 * H, { owner: true });
    const unverified = incident(6, 10 * H, { valence: 0 }); // resolved unverified: seen too few times to prove the fix
    assert.deepEqual(debt().map((x) => x.id), [taught.p, ruled.p], 'verified in the last 30 days, oldest first; not unverified, not one the owner resolved, not one over 30 days ago');
    const x = debt()[0];
    assert.equal(x.title, 'incident 2');
    assert.equal(x.outcome, taught.o);
    assert.equal(x.decision, taught.d);
    const said = ok(old, ['orient'], SUP);
    assert.ok(said.includes(`${taught.p} was fixed and verified (incident 2): what did it teach?`), said);
    assert.ok(said.includes(`knowledge add --kind lesson --scope 'project' --statement '<what it teaches>' --evidence '${taught.p}' '${taught.d}' '${taught.o}'`), said);
    assert.ok(said.includes(`decide --class orient-noise --refs '${taught.p}' -- 'nothing to keep'`), said);
    assert.ok(!said.includes(quiet.p) && !said.includes(owners.p) && !said.includes(stale.p) && !said.includes(unverified.p));

    // a lesson citing it clears it
    ok(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'timeouts need a retry budget', '--evidence', taught.p, taught.d, taught.o], SUP);
    assert.deepEqual(debt().map((y) => y.id), [ruled.p]);
    // a noise ruling naming the problem clears it; corrected, it owes again
    const n = ok(old, ['decide', '--class', 'orient-noise', '--refs', ruled.p, '--', 'nothing to keep'], SUP).trim();
    assert.deepEqual(debt(), []);
    assert.match(ok(old, ['orient'], SUP), /^lessons for you to keep/, 'only the lesson citing it, waiting for the supervisor to keep');
    ok(old, ['correct', n, '--reason', 'there was a lesson in it']);
    assert.deepEqual(debt().map((y) => y.id), [ruled.p]);
    // a lesson the owner retired taught nothing: the incident owes one again
    const k = json(ok(old, ['knowledge', '--json'])).find((y) => (y.evidence ?? []).includes(taught.p)).id;
    ok(old, ['knowledge', 'set', k, '--status', 'retired']);
    assert.deepEqual(debt().map((y) => y.id), [taught.p, ruled.p]);
    // a noise ruling names an observation or a fixed incident, never an open problem
    const open = ok(old, ['problem', 'add', '--title', 'slow page', '--severity', '1'], SUP).trim();
    assert.match(F.run(old, ['decide', '--class', 'orient-noise', '--refs', open, '--', 'x'], SUP).err, /a noise ruling names the observations it explains/);
  } finally { F.done(); }
});

test('a hand-written decision citing knowledge that isn\'t accepted only cites it, and its status shows', () => {
  const F = fleetFixture('ooda-rests-read');
  const { old, ok } = F;
  const hand = handFor(F);
  try {
    const retired = hand('supervisor', { type: 'knowledge', kind: 'lesson', statement: 'an old idea', scope: 'project', status: 'retired', evidence: [] }, 9 * H);
    const good = hand('supervisor', { type: 'knowledge', kind: 'lesson', statement: 'a kept idea', scope: 'project', status: 'accepted', evidence: [] }, 8 * H);
    const d = hand('supervisor', { type: 'decision', class: 'registry-edit', what: 'leave it', authority: 'constitution', refs: [], knowledge: [retired, good] }, 7 * H);
    const p = json(ok(old, ['peek', 'decision', d, '--json']));
    const why = (from) => p.lineage.edges.find((e) => e.from === from && e.to === d)?.why;
    assert.equal(why(retired), 'cites');
    assert.equal(why(good), 'rests on');
    assert.equal(p.cited[retired].status, 'retired');
  } finally { F.done(); }
});

test('lessons: the agents\' own are the supervisor\'s to keep; only one sent to the owner reaches their Inbox, in plain words', () => {
  const F = fleetFixture('ooda-for-owner');
  const { old, ok, run } = F;
  try {
    const o1 = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the ticket was checked before its log synced'], SUP).trim();
    const data = () => json(ok(old, ['dashboard-data']));
    const inbox = () => json(ok(old, ['hello', '--json'])).inbox;
    const ownerList = () => data().ooda.knowledge.filter((k) => k.status === 'candidate' && k.for_owner === true).map((k) => k.id);

    // the default: about how the agents work, so it waits for the supervisor in orient, not the owner
    const mine = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'check-pr reads tickets from main\'s log: run log-sync before the ticket\'s PR is checked', '--evidence', o1], SUP).trim();
    assert.deepEqual(ownerList(), [], 'not in the owner\'s list');
    assert.equal(inbox(), 0, 'nor in the Inbox count');
    const k0 = data().ooda.knowledge.find((k) => k.id === mine);
    assert.equal(k0.status, 'candidate', 'the owner can still read it');
    assert.equal(k0.for_owner, undefined);
    const said = ok(old, ['orient'], SUP);
    assert.match(said, /lessons for you to keep/);
    assert.ok(said.includes(`${mine} [lesson, project] check-pr reads`), said);

    // the supervisor keeps it itself
    ok(old, ['knowledge', 'set', mine, '--status', 'accepted'], SUP);
    assert.doesNotMatch(ok(old, ['orient'], SUP), /lessons for you to keep/);

    // sent to the owner: it needs a plain line, and that line has no code in it
    const base = ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'ship the pricing page before the blog, against goal one\'s order', '--evidence', o1, '--for-owner'];
    assert.match(run(old, base, SUP).err, /--plain "<one line, no commands or code>"/, 'no plain line, refused');
    for (const [bad, re] of [['Run `log-sync` first', /backticks/], ['Pass --chore log when merging', /names a flag \(--chore\)/], ['The devteam.mjs merge step drifts', /devteam\.mjs/], ['Use check-pr before you merge', /"check-pr", a name from inside the kit/], [`Since ${o1} the order is off`, /kit id/], ['Edit docs/devteam/project/log.md first', /names a file/]]) {
      const r = run(old, [...base, '--plain', bad], SUP);
      assert.notEqual(r.status, 0, bad);
      assert.match(r.err, re, bad);
    }
    assert.match(run(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'x', '--evidence', o1, '--plain', 'Words'], SUP).err, /--plain goes with --for-owner/);
    const plain = 'The pricing page would ship before the blog, which changes the order you gave the goals. It brings sign-ups forward by a week.';
    const theirs = ok(old, [...base, '--plain', plain], SUP).trim();
    assert.deepEqual(ownerList(), [theirs], 'in the owner\'s list');
    assert.equal(inbox(), 1);
    assert.equal(data().ooda.knowledge.find((k) => k.id === theirs).plain, plain, 'with its plain line');
    assert.match(ok(old, ['orient'], SUP), /1 lesson waits for the owner/);
    assert.match(ok(old, ['knowledge'], SUP), new RegExp(`${theirs} \\[lesson, candidate, project, for the owner\\]`));

    // theirs to keep: the supervisor can't accept it, or take it back, only retire it
    assert.match(run(old, ['knowledge', 'set', theirs, '--status', 'accepted'], SUP).err, /was sent to the owner/);
    assert.match(run(old, ['knowledge', 'set', theirs, '--for-owner', 'off'], SUP).err, /--for-owner takes no value/);
    // the owner keeps it; then it is no longer waiting
    ok(old, ['knowledge', 'set', theirs, '--status', 'accepted', '--owner']);
    assert.equal(inbox(), 0);

    // an agent's candidate sent on later, with its line
    const later = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'the owner\'s launch date slips with the checkout rewrite', '--evidence', o1], SUP).trim();
    assert.match(run(old, ['knowledge', 'set', later, '--for-owner'], SUP).err, /--plain/);
    ok(old, ['knowledge', 'set', later, '--for-owner', '--plain', 'Keeping the launch date means leaving the checkout rewrite for after it.'], SUP);
    assert.deepEqual(ownerList(), [later]);
    // only the supervisor sends one, and only its own
    assert.match(run(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'x', '--for-owner', '--plain', 'Words', '--owner']).err, /the supervisor sends the owner/);

    // a lesson about a call only the owner makes is theirs, however it is filed
    const L = fs.readFileSync(path.join(old, 'docs/devteam/governance/constitution.md'), 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const only = JSON.parse(L[1]).owner_only[0];
    assert.match(run(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', `class:${only}`, '--statement', 'x', '--evidence', o1], SUP).err, /only the owner makes/);
    assert.match(run(old, ['knowledge', 'set', mine, '--scope', `class:${only}`], SUP).err, /only the owner makes/);

    // and keeping one grants nothing: a lesson the supervisor accepted is no standing rule
    assert.match(run(old, ['decide', '--class', only, '--approved', mine, '--refs', o1, '--', 'x'], SUP).err, /not a standing rule of the owner's/);

    // sent is sent: its words and scope stay as the owner read them, before or after they keep it
    for (const f of [['--statement', 'something else'], ['--scope', 'component:app'], ['--plain', 'Other words.']]) assert.match(run(old, ['knowledge', 'set', later, ...f], SUP).err, /was sent to the owner as it stands/, f[0]);
    assert.match(run(old, ['knowledge', 'set', theirs, '--statement', 'something else'], SUP).err, /was sent to the owner as it stands/, 'after the owner kept it too');
    // and a line written past the kit counts for nothing: the fold holds the same rules
    const hand = handFor(F);
    hand('supervisor', { type: 'knowledge', op: 'set', id: later, status: 'accepted' }, 500);
    hand('supervisor', { type: 'knowledge', op: 'set', id: theirs, statement: 'rewritten after the owner kept it' }, 400);
    const raw = hand('supervisor', { type: 'knowledge', kind: 'lesson', statement: 'raw', scope: 'project', status: 'candidate', evidence: [o1] }, 300);
    hand('supervisor', { type: 'knowledge', op: 'set', id: raw, scope: `class:${only}` }, 200);
    const ks = json(ok(old, ['knowledge', '--json']));
    assert.equal(ks.find((k) => k.id === later).status, 'candidate', 'the supervisor\'s accept of a lesson sent to the owner is ignored');
    assert.match(ks.find((k) => k.id === theirs).statement, /^ship the pricing page/, 'and so is a rewording');
    assert.equal(ks.find((k) => k.id === raw).scope, 'project', 'and a re-scope to an owner-only class');
    // withdrawn, it can't come back as the agents' own
    ok(old, ['knowledge', 'set', later, '--status', 'retired'], SUP);
    assert.match(run(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'The owner\'s launch date slips  with the checkout rewrite', '--evidence', o1], SUP).err, /was sent to the owner: it is theirs to keep/);
    // a preference is the owner's: one the supervisor inferred goes to them
    assert.match(run(old, ['knowledge', 'add', '--kind', 'preference', '--scope', 'project', '--statement', 'short PRs'], SUP).err, /a preference is the owner's/);
    // ordinary words pass: a product's name with a dot, a hyphenated English word
    ok(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'node upgrade', '--evidence', o1, '--for-owner', '--plain', 'Moving to the newer Node.js would change the hosting plan and the sign-up page.'], SUP);
  } finally { F.done(); }
});
