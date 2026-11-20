// Goals on the dashboard's server: Mark met at a target, and a goal approval's three verdicts.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, freePort, write, json, fleetFixture, startDashboard, until } from './lib/kit.mjs';
import { cleanup } from './lib/dashboard-page.mjs';

test("a goal at its target: the card's Mark met is an owner action, same-origin only, and reads the check again", async (t) => {
  const F = fleetFixture('mark-met');
  const later = cleanup(t);
  later(() => F.done());
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  write(path.join(F.old, 'prod.txt'), '12\n');
  const G = F.ok(F.old, ['goal', 'add', '--title', 'Read MCP', '--outcome', 'clients read production', '--measure', 'core resources served', '--target', '12', '--unit', 'resources', '--direction', 'up', '--source', 'prod', '--check', 'cat prod.txt', '--non-goals', 'none', '--preconditions', 'a'], SUP);
  F.ok(F.old, ['goal', 'decide', G, 'approve', '--force']);
  F.ok(F.old, ['goal', 'reading', G, '--run'], SUP);
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  await until(async () => (await fetch(`${B}/api/data`)).ok, 'a first dashboard-data');
  const goalNow = async () => (await (await fetch(`${B}/api/data?force=1`)).json()).ooda.goals.find((g) => g.id === G);
  assert.equal((await goalNow()).at_target?.value, 12, 'the card is told it reached its target');
  const post = (body, headers = {}) => fetch(`${B}/api/goal-met`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ id: G }, { origin: 'https://evil.example' })).status, 403, 'another origin');
  assert.equal((await post({ id: '--force' })).status, 400, 'an id, nothing else');
  write(path.join(F.old, 'prod.txt'), '11\n');
  let r = await post({ id: G });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /check reads 11 from production, not its target 12/, 'the check runs again');
  write(path.join(F.old, 'prod.txt'), '12\n');
  r = await post({ id: G });
  assert.equal(r.status, 200, await r.clone().text());
  const g = json(F.ok(F.old, ['goal', 'show', G]));
  const u = g.updates.filter((x) => x.status === 'met').pop();
  assert.deepEqual([g.status, u?.by, u?.channel], ['met', 'owner', 'dashboard'], "the owner's, from the dashboard");
  const html = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  assert.match(html, /g\.status === 'ready' && g\.at_target \? `<div class="holdbar"><button type="button" data-met-id=/, 'the card draws Mark met for a running goal at its target');
  assert.match(html, /build: \(\) => \(\{ action: 'goal-met', body: \{ id \} \}\)/);
});

// kit-287: a goal approval's card offers Approve, Refine and Let go whatever the supervisor's
// recommendation says, and each, through the page's own verdict map, is a body the dashboard server's
// goal-decide check takes. Approve (or the verdict named) is marked only when the recommendation says
// just that: "Yes, but refine the measure" marks nothing.
test("a goal approval's choices are the three verdicts, each one the server takes, whatever the recommendation says", () => {
  const PAGE = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  const SERVER = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const from = (src, start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a); assert.ok(a >= 0 && b > a, `${start} is in the source`); return src.slice(a, b); };
  const line = (src, start) => from(src, start, '\n');
  const ctx = vm.createContext({});
  vm.runInContext([
    // norm, the page's GOAL_VERDICTS and choicesOf, in the page's order
    from(PAGE, 'const norm = ', '// An open owner-action without secrets'),
    from(PAGE, 'const isOa = ', '\n// What the supervisor suggested'),
    line(SERVER, 'const ID = /^[a-z]-'),
    line(SERVER, 'const text = (x, max = 4000)'),
    `const goalDecide = ${line(SERVER, "'goal-decide': (b) => ").replace(/^'goal-decide': /, '').replace(/,\s*$/, '')};`,
    'this.choicesOf = choicesOf; this.GOAL_VERDICTS = GOAL_VERDICTS; this.goalDecide = goalDecide;',
  ].join('\n'), ctx);
  const G = 'g-20261117-174044056-supervisor';
  const marks = { Yes: 'Approve', 'Yes.': 'Approve', APPROVE: 'Approve', approved: 'Approve', 'go ahead': 'Approve', Refine: 'Refine', 'let go': 'Let go', 'Refine the measure': null, No: null, 'Yes, but refine the measure': null, 'Approve with changes': null, '': null };
  for (const rec of [...Object.keys(marks), null]) {
    const c = JSON.parse(JSON.stringify(ctx.choicesOf({ kind: 'goal-approval', status: 'open', options: [], choices: [], secrets: [], recommendation: rec })));
    assert.deepEqual(c.map((x) => x.label), ['Approve', 'Refine', 'Let go'], `recommendation ${JSON.stringify(rec)}: the three verdicts, nothing else`);
    for (const x of c) assert.ok(ctx.goalDecide({ id: G, verdict: ctx.GOAL_VERDICTS[x.label] }), `recommendation ${JSON.stringify(rec)}: ${x.label} is a body the server takes`);
    assert.deepEqual(c.filter((x) => x.rec).map((x) => x.label), marks[rec] ? [marks[rec]] : [], `recommendation ${JSON.stringify(rec)}: marks ${marks[rec] ?? 'nothing'}`);
  }
  assert.equal(ctx.goalDecide({ id: G, verdict: undefined }), null, 'and a label the map lacks is refused, as the owner saw');
});
