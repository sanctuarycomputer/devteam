// Lineage and a sidepeek for every stage (the OODA spec, PR 3): every record in the loop with what
// it came from and what came of it, both ways and bounded, as data and as Mermaid text; where an
// observation sits in the loop; and recurring signals left unexplained for more than a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line, kit as F_KIT } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// A line as the kit would have written it agoMs ago, in its writer's file. Ids follow the kit's
// form, so each line picks a distinct agoMs.
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
const H = 3600000;
// A sensor's escalation on one fingerprint, as the sensors write it: a qualify, or a spike in an hour.
const spike = (hand, fp, ago) => hand('supervisor', { type: 'observation', source: 'web', detector: 'sensor', subject: 'sensor:web', kind: 'spike', detail: 'web: a log line is spiking', severity: 4, valence: -1, source_key: `sensor:web:spike:${fp}:${new Date(Date.now() - ago).toISOString().slice(0, 13)}` }, ago);

// An incident, from its spikes to its outcome: three spikes, the incident that holds them, the fix
// decided, the ticket it added, the fix deployed and what came of it.
function incidentChain(F) {
  const hand = handFor(F);
  const spikes = [spike(hand, 'log:L1', 50 * H), spike(hand, 'log:L1', 40 * H), spike(hand, 'log:L1', 30 * H)];
  const p = hand('supervisor', { type: 'problem', title: 'payment errors', severity: 3, realized: true, status: 'open', threatens: [], refs: spikes, fingerprints: ['web:log:L1'], sensor: 'web' }, 20 * H);
  const ticket = 'fx-01-payment';
  const d = hand('supervisor', { type: 'decision', class: 'incident-fix', scope: 'sev:high', what: 'fix the payment timeout', authority: 'rung', refs: [p, ticket] }, 19 * H);
  const a = hand('supervisor', { type: 'act', class: 'add-ticket', decision: d, what: `added ticket ${ticket}`, refs: [ticket], reversible: true }, 18 * H);
  hand('supervisor', { type: 'ticket', id: ticket, title: 'payment timeout', feature: 'chores', component: 'pay', kind: 'fix', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['pay/**'], done_when: ['no timeouts'] }, 18 * H - 1000);
  const deployed = hand('supervisor', { type: 'observation', source: 'supervisor', subject: p, kind: 'fix-deployed', detail: 'the fix is deployed', refs: [p, ticket] }, 10 * H);
  const outcome = hand('supervisor', { type: 'observation', source: 'supervisor', subject: d, kind: 'outcome', detail: 'no timeouts since the fix', valence: 1, refs: [d] }, 2 * H);
  return { hand, spikes, p, ticket, d, a, deployed, outcome };
}
const peek = (F, kind, id) => json(F.ok(F.old, ['peek', kind, id, '--json']));
const ids = (L) => L.nodes.map((n) => n.id);

test('lineage: an incident\'s chain, both ways and bounded; a noise ruling; siblings collapse', () => {
  const F = fleetFixture('ooda-lineage');
  const { old, ok } = F;
  try {
    const C = incidentChain(F);
    // from the first spike, down: the incident, the decision, its act, the ticket it made, the outcome
    const down = peek(F, 'observation', C.spikes[0]).lineage;
    for (const x of [C.p, C.d, C.a, C.ticket, C.outcome, C.deployed]) assert.ok(ids(down).includes(x), `down from the spike reaches ${x}: ${ids(down).join(' ')}`);
    assert.equal(down.nodes[0].id, C.spikes[0], 'the opened record is the first node');
    assert.deepEqual(down.nodes.find((n) => n.id === C.p), { id: C.p, stage: 'orient', type: 'problem', kind: null, label: 'payment errors', at: down.nodes.find((n) => n.id === C.p).at, href: `#problem/${C.p}` });
    assert.equal(down.nodes.find((n) => n.id === C.ticket).href, `#ticket/${C.ticket}`);
    assert.equal(down.nodes.find((n) => n.id === C.ticket).stage, null, 'the work graph is outside the loop');
    assert.ok(down.edges.some((e) => e.from === C.spikes[0] && e.to === C.p && e.why === 'about'));
    assert.ok(down.edges.some((e) => e.from === C.d && e.to === C.a && e.why === 'carried out'));
    assert.ok(down.edges.some((e) => e.from === C.a && e.to === C.ticket && e.why === 'made'), 'the ticket an act added comes after it');
    // from the outcome, up: back to every spike
    const up = peek(F, 'observation', C.outcome).lineage;
    for (const x of [...C.spikes, C.p, C.d]) assert.ok(ids(up).includes(x), `up from the outcome reaches ${x}`);
    assert.equal(up.nodes[0].stage, 'learn');
    // from the decision, both
    const both = peek(F, 'decision', C.d).lineage;
    for (const x of [...C.spikes, C.p, C.a, C.ticket, C.outcome]) assert.ok(ids(both).includes(x), `the decision's lineage holds ${x}`);
    assert.equal(both.truncated, false);
    // a noise ruling: the observations it rules on come before it
    const o1 = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'a bot hit /health'], SUP).trim();
    const n = ok(old, ['decide', '--class', 'orient-noise', '--refs', 'note:app', o1, '--', 'a health check'], SUP).trim();
    const noise = peek(F, 'observation', o1).lineage;
    assert.deepEqual(noise.edges.filter((e) => e.from === o1 && e.to === n), [{ from: o1, to: n, why: 'about' }]);
    assert.equal(noise.nodes.find((x) => x.id === n).stage, 'decide');
    // a correction is a Learn node on the call it corrects
    ok(old, ['correct', n, '--reason', 'not a bot']);
    const fixed = peek(F, 'decision', n).lineage;
    const c = fixed.nodes.find((x) => x.id === `correction:${n}`);
    assert.equal(c?.stage, 'learn');
    assert.equal(c.href, `#decision/${n}`, 'it opens the call it corrects');
    assert.ok(fixed.edges.some((e) => e.from === n && e.to === c.id && e.why === 'corrected'));
  } finally { F.done(); }
});

test('lineage: six observations on one signal collapse into one node; the bound truncates; Mermaid text is safe', () => {
  const F = fleetFixture('ooda-lineage-collapse');
  const { old, ok } = F;
  try {
    const hand = handFor(F);
    const seven = [...Array(7)].map((_, i) => spike(hand, 'log:L2', (60 - i * 5) * H));
    // one of them became knowledge, with a label that tries to break out of Mermaid's syntax
    const k = hand('supervisor', { type: 'knowledge', kind: 'lesson', scope: 'project', status: 'accepted', statement: 'payments"]; click n0 call alert(1) %% {init} #x', evidence: [seven[0]] }, H);
    // the signal holds the six still unexplained: from it, up, six siblings on one neighbour are one node
    assert.ok(json(ok(old, ['orient', '--json'])).some((c) => c.key === 'web:log:L2'), 'one recurring signal');
    const L = peek(F, 'signal', 'web:log:L2').lineage;
    assert.equal(L.nodes[0].id, 'signal:web:log:L2');
    assert.equal(L.nodes[0].href, `#signal/${encodeURIComponent('web:log:L2')}`);
    const [g, ...more] = L.nodes.filter((x) => x.members);
    assert.deepEqual(more, [], JSON.stringify(L.nodes));
    assert.equal(g.id, 'group:signal:web:log:L2:observation:spike');
    assert.equal(g.label, '6 spike observations');
    assert.deepEqual([...g.members].sort(), seven.slice(1).sort());
    assert.equal(g.stage, 'observe');
    assert.ok(L.edges.some((e) => e.from === g.id && e.to === 'signal:web:log:L2' && e.why === 'recurs'), 'the group takes its members\' edges');
    assert.equal(L.nodes.length, 2);
    // five are not collapsed
    const k5 = hand('supervisor', { type: 'knowledge', kind: 'lesson', scope: 'project', status: 'accepted', statement: 'five of them', evidence: seven.slice(2) }, H / 2);
    assert.equal(peek(F, 'lesson', k5).lineage.nodes.filter((x) => x.members).length, 0, 'five siblings stay five nodes');
    // as Mermaid text: a subgraph per stage it has, generated node ids, labels stripped to plain words
    const M = ok(old, ['peek', 'lesson', k, '--mermaid']);
    assert.match(M, /^flowchart LR\n/);
    assert.equal((M.match(/^subgraph /gm) || []).length, 2, 'one subgraph per stage it has: Observe and Orient');
    assert.match(M, /^subgraph s_observe\["Observe"\]$/m);
    const label = /\bn0\["([^"]*)"\]/.exec(M)?.[1];
    assert.ok(label, M);
    assert.doesNotMatch(label, /[\]";%#{}]/, 'no syntax in a label');
    assert.equal(label, 'payments click n0 call alert(1) init x');
    assert.match(M, /^class n0 current$/m, 'the opened record is marked');
    assert.doesNotMatch(M, /\b[kod]-\d{8}-/, 'no record id reaches Mermaid');
    assert.match(M, /^n1 -->\|evidence\| n0$/m);
  } finally { F.done(); }
});

test('lineage: at most 120 nodes, and it says when it stopped', () => {
  const F = fleetFixture('ooda-lineage-max');
  try {
    const hand = handFor(F);
    const many = [...Array(125)].map((_, i) => hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'app', kind: `note-${i}`, detail: `note ${i}` }, (200 - i) * 60000));
    // two lessons, the later resting on the earlier, each citing what fits in a line (LINE_MAX)
    const k0 = hand('supervisor', { type: 'knowledge', kind: 'lesson', scope: 'project', status: 'accepted', statement: 'w', evidence: many.slice(0, 62) }, 2000);
    const k = hand('supervisor', { type: 'knowledge', kind: 'lesson', scope: 'project', status: 'accepted', statement: 'x', evidence: [k0, ...many.slice(62)] }, 1000);
    const L = peek(F, 'lesson', k).lineage;
    assert.equal(L.truncated, true);
    assert.equal(L.nodes.length, 120);
    const small = hand('supervisor', { type: 'knowledge', kind: 'lesson', scope: 'project', status: 'accepted', statement: 'y', evidence: many.slice(0, 2) }, 500);
    assert.equal(peek(F, 'lesson', small).lineage.truncated, false);
  } finally { F.done(); }
});

test('where an observation sits: on its card (dashboard-data) and in its peek; a signal peeks by its key, / and all', () => {
  const F = fleetFixture('ooda-place');
  const { old, ok } = F;
  try {
    const C = incidentChain(F);
    const hand = C.hand;
    const note = (detail, ago, key) => hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'app', kind: 'note', detail, ...(key ? { source_key: key } : {}) }, ago);
    const fresh = note('alone', 5 * H, 'note:alone');
    const twice = [note('twice', 6 * H, 'note:twice'), note('twice again', 7 * H, 'note:twice')];
    const taught = note('it taught something', 8 * H, 'note:taught');
    hand('supervisor', { type: 'knowledge', kind: 'lesson', scope: 'project', status: 'accepted', statement: 'it taught this', evidence: [taught] }, 4 * H);
    const ruled = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'a bot', '--key', 'note:bot'], SUP).trim();
    ok(old, ['decide', '--class', 'orient-noise', '--refs', 'note:bot', ruled, '--', 'a health check'], SUP);
    const quiet = hand('supervisor', { type: 'observation', source: 'web', detector: 'sensor', subject: 'sensor:web', kind: 'log-error', detail: 'web: a error log line', severity: 3, source_key: 'sensor:web:log:Q1' }, 9 * H);
    hand('supervisor', { type: 'observation', source: 'web', detector: 'sensor', subject: 'sensor:web', kind: 'sensor-ignored', detail: 'ignored web:log:Q1: bots', source_ref: 'web:log:Q1', source_key: 'sensor:web:ignore:log:Q1:x', refs: [quiet] }, 3 * H);
    const waits = hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'w-01-a', kind: 'stale-worker', detail: 'quiet', source_key: 'metrics:stale-worker:w-01-a' }, 11 * H);
    hand('supervisor', { type: 'observation', source: 'ack', kind: 'finding-ack', subject: 'stale-worker w-01-a', detail: 'it is thinking', source_ref: 'metrics:stale-worker:w-01-a', refs: [waits] }, 1 * H);
    // a finding whose subject holds a /: three of it on two days, a recurring signal
    const slash = [26, 25, 1].map((h) => hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'web/e2e', kind: 'flaky-gate', detail: 'web/e2e failed then passed', source_key: 'metrics:flaky-gate:web/e2e' }, h * H + 500));
    // what explains a whole signal (explained().keys) explains a later observation on it too: the
    // incident that holds its fingerprint, the noise ruling that names its key
    const later = spike(hand, 'log:L1', 3 * H + 7000);
    const botAgain = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the bot again', '--key', 'note:bot'], SUP).trim();
    const d = json(ok(old, ['dashboard-data']));
    const place = (id) => d.ooda.observations.find((o) => o.id === id)?.place;
    assert.deepEqual(place(later), { state: 'explained', ref: C.p, why: 'incident' });
    assert.equal(place(botAgain).state, 'noise');
    assert.equal(place(botAgain).why, 'a health check');
    assert.deepEqual(place(fresh), { state: 'new', ref: null });
    assert.deepEqual(place(twice[0]), { state: 'signal', ref: 'note:twice', n: 2, recurring: false });
    assert.equal(place(taught).state, 'explained');
    assert.equal(place(taught).why, 'lesson');
    assert.equal(place(ruled).state, 'noise');
    assert.equal(place(ruled).why, 'a health check');
    assert.deepEqual(place(quiet), { state: 'ignored', ref: place(quiet).ref, why: 'bots' });
    assert.equal(place(waits).state, 'set-aside');
    assert.equal(place(waits).why, 'it is thinking');
    assert.ok(place(waits).until > new Date().toISOString());
    assert.equal(place(C.spikes[0]).state, 'carried');
    assert.match(place(C.spikes[0]).why, /^incident → decision → act → (outcome|fix deployed)$/);
    assert.deepEqual(place(slash[0]), { state: 'signal', ref: 'metrics:flaky-gate:web/e2e', n: 3, recurring: true });
    assert.equal(place(C.outcome), null, 'an outcome is Learn, not an observation for Orient');
    // the peek says the same, with the provenance first
    const p = peek(F, 'observation', quiet);
    assert.equal(p.place.state, 'ignored');
    assert.deepEqual(p.provenance, { from: 'sensor', ref: 'web' });
    // a signal: its observations, how long it has waited, and what would explain it
    const s = peek(F, 'signal', 'metrics:flaky-gate:web/e2e');
    assert.equal(s.record, null);
    assert.equal(s.signal.key, 'metrics:flaky-gate:web/e2e');
    assert.equal(s.signal.recurring, true);
    assert.deepEqual(s.signal.items.map((i) => i.id), slash);
    assert.equal(s.signal.unexplained_hours, 26);
    assert.match(s.signal.explain[1], /^decide --class orient-noise --refs 'metrics:flaky-gate:web\/e2e' 'o-/);
    assert.equal(s.lineage.nodes[0].id, 'signal:metrics:flaky-gate:web/e2e');
    assert.match(F.run(old, ['peek', 'signal', 'nothing:here', '--json']).err, /no signal nothing:here/);
  } finally { F.done(); }
});

test('the page\'s words for where an observation sits and where it came from', async () => {
  const vm = await import('node:vm');
  const html = fs.readFileSync(path.join(F_KIT, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* loop-place start */'), html.indexOf('/* loop-place end */'));
  assert.ok(src.length > 500, 'the loop-place block is marked in index.html');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ctx = vm.createContext({ esc, linkify: esc, qlink: (id) => `<q>${id}</q>`, who: (w) => (w === 'w-01-a' ? 'the agent on checkout' : w), words: (x) => String(x).replace(/-/g, ' '), when: () => 'Nov 11', DATA: { sensors: [{ name: 'web' }] } });
  vm.runInContext(`${src}\n;globalThis.api = { loopPlace, fromWords, recordHref };`, ctx);
  const { loopPlace, fromWords, recordHref } = ctx.api;
  const text = (h) => h.replace(/<[^>]+>/g, '');
  assert.equal(loopPlace({ state: 'new', ref: null }), 'Not oriented yet');
  assert.equal(text(loopPlace({ state: 'signal', ref: 'note:a/b', n: 2, recurring: false })), 'Part of a recurring signal (2 of 3)');
  assert.match(loopPlace({ state: 'signal', ref: 'note:a/b', n: 2 }), /href="#signal\/note%3Aa%2Fb"/);
  assert.equal(text(loopPlace({ state: 'signal', ref: 'k', n: 4, recurring: true })), 'Part of a recurring signal (seen 4 times)');
  assert.equal(text(loopPlace({ state: 'explained', ref: 'p-20261111-000000000-supervisor', why: 'incident' })), 'Explained: became an incident');
  assert.equal(text(loopPlace({ state: 'noise', ref: 'd-20261111-000000000-supervisor', why: 'a health check' })), 'Ruled noise: a health check');
  assert.equal(text(loopPlace({ state: 'ignored', ref: 'o-20261111-000000000-supervisor', why: 'bots' })), 'Ignored at triage: bots');
  assert.equal(text(loopPlace({ state: 'set-aside', ref: 'o-x', why: 'later', until: '2026-11-12T00:00:00Z' })), 'Set aside until Nov 11: later');
  assert.equal(text(loopPlace({ state: 'carried', ref: 'correction:d-20261111-000000000-supervisor', why: 'lesson → decision → correction' })), 'Carried on: lesson → decision → correction (the furthest step)');
  assert.equal(recordHref('correction:d-20261111-000000000-supervisor'), '#decision/d-20261111-000000000-supervisor');
  assert.equal(loopPlace({ state: 'noise', ref: 'd-1', why: '<b>x</b>' }).includes('<b>'), false, 'the reason escaped');
  assert.equal(text(fromWords({ from: 'sensor', ref: 'web' })), 'From the web sensor');
  assert.match(fromWords({ from: 'sensor', ref: 'web' }), /href="#sensor\/web"/);
  assert.equal(fromWords({ from: 'sensor', ref: 'goal-measure' }), "From a goal's measure, read by the kit");
  assert.equal(text(fromWords({ from: 'owner-answer', ref: 'q-1' })), 'From your answer to q-1');
  assert.equal(fromWords({ from: 'worker', ref: null }, { created_by: 'w-01-a' }), 'From the agent on checkout');
  assert.equal(fromWords({ from: 'metrics', ref: 'stale-worker' }), "From the kit's own checks (stale worker)");
});

test('the lineage as the page draws it: n<i> is the i-th node, in its stage\'s subgraph; the list fallback links every node', async () => {
  const F = fleetFixture('ooda-lineage-draw');
  try {
    const C = incidentChain(F);
    const p = peek(F, 'decision', C.d);
    const M = p.lineage_mermaid;
    assert.equal(M, F.ok(F.old, ['peek', 'decision', C.d, '--mermaid']), 'the peek carries what --mermaid prints');
    // each subgraph holds exactly the nodes of its stage, by their index
    const blocks = Object.fromEntries([...M.matchAll(/^subgraph s_(\w+)\["\w+"\]\n([\s\S]*?)\nend$/gm)].map(([, s, body]) => [s, [...body.matchAll(/^n(\d+)[[(]/gm)].map((m) => Number(m[1]))]));
    const want = {};
    p.lineage.nodes.forEach((n, i) => { if (n.stage && n.stage !== 'measurement' && n.stage !== 'inbox') (want[n.stage] ??= []).push(i); });
    assert.deepEqual(blocks, want);
    for (const [i, n] of p.lineage.nodes.entries()) assert.match(M, new RegExp(`^n${i}\\[\\(?"?\\[?"${n.label.replace(/[^A-Za-z0-9 .,:!?()'/+-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[()+?.]/g, '\\$&')}"`, 'm'), `n${i} is ${n.id}`);
    // the page's list fallback: by stage in order, every node that opens a sidepeek a link
    const vm = await import('node:vm');
    const html = fs.readFileSync(path.join(F_KIT, 'dashboard/index.html'), 'utf8');
    const src = html.slice(html.indexOf('/* loop-place start */'), html.indexOf('/* loop-place end */'));
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ctx = vm.createContext({ esc, linkify: esc, qlink: esc, who: esc, words: (x) => String(x).replace(/-/g, ' '), when: () => '', DATA: {} });
    vm.runInContext(`${src}\n;globalThis.api = { lineageList };`, ctx);
    const list = ctx.api.lineageList(p.lineage);
    const heads = [...list.matchAll(/<h4>([^<]+)<\/h4>/g)].map((m) => m[1]);
    assert.deepEqual(heads, ['Observe', 'Orient', 'Decide', 'Act', 'Learn', 'What it is about']);
    const hrefs = [...list.matchAll(/<a class="linkish" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs.sort(), p.lineage.nodes.map((n) => n.href).filter(Boolean).map(esc).sort());
    assert.match(list, new RegExp(`href="#decision/${C.d}" aria-current="page"`), 'the opened record is marked');
  } finally { F.done(); }
});

test('orientation debt: recurring signals unexplained for more than a day, oldest first', () => {
  const F = fleetFixture('ooda-debt');
  const { old, ok } = F;
  try {
    const hand = handFor(F);
    const note = (key, ago, by = 'supervisor') => hand(by, { type: 'observation', source: 'supervisor', subject: 'app', kind: 'note', detail: `${key} again`, source_key: key }, ago);
    // 25 hours old: debt; 30 hours old: debt, and first; 2 hours old, from two writers: a signal, not debt yet
    const old25 = [25, 20, 1].map((h) => note('note:a', h * H));
    [30, 10, 2].forEach((h) => note('note:b', h * H + 100));
    note('note:c', 2 * H + 200); note('note:c', H + 300); note('note:c', H / 2, 'w-01-a');
    const d = json(ok(old, ['dashboard-data']));
    assert.deepEqual(d.ooda.clusters.map((c) => c.key).sort(), ['note:a', 'note:b', 'note:c']);
    assert.deepEqual(d.ooda.debt.signals.map((x) => x.key), ['note:b', 'note:a'], 'over a day, oldest first');
    const a = d.ooda.debt.signals[1];
    assert.equal(a.count, 3);
    assert.equal(a.hours, 25);
    assert.equal(a.first_at, json(ok(old, ['log', '--id', old25[0], '--json']))[0].created_at);
    // explained, it is no debt
    ok(old, ['decide', '--class', 'orient-noise', '--refs', 'note:b', ...json(ok(old, ['orient', '--json'])).find((c) => c.key === 'note:b').ids, '--', 'a cron job'], SUP);
    assert.deepEqual(json(ok(old, ['dashboard-data'])).ooda.debt.signals.map((x) => x.key), ['note:a']);
  } finally { F.done(); }
});
