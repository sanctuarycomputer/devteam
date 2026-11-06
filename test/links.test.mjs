// Links: scopes, the Links block, link ids, link commands and observations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { kit, write, json, monoFixture, until } from './lib/kit.mjs';

test('one scope grammar: knowledge scopes unchanged, link: scopes reach prompts whose links include them', () => {
  const F = monoFixture('scopes');
  const { old, ok, run, lines, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    lines(F.STD);
    ok(old, ['ticket', 'add', 'web-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n' })], SUP);
    const K = (scope, statement) => ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', statement, '--scope', scope, '--owner']);
    K('project', 'p-all'); K('component:web', 'c-web'); K('component:api', 'c-api'); K('feature:chores', 'f-chores'); K('class:merge-word', 'cls');
    K('link:figma', 'l-figma');
    const k = ok(old, ['knowledge', '--for', 'web-01-a']);
    for (const s of ['p-all', 'c-web', 'f-chores']) assert.match(k, new RegExp(s));
    for (const s of ['c-api', 'cls', 'l-figma']) assert.doesNotMatch(k, new RegExp(s));
    assert.match(ok(old, ['knowledge', '--for', 'merge-word']), /cls/);
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['component:web'] } }; });
    assert.match(ok(old, ['knowledge', '--for', 'web-01-a']), /l-figma/, 'a link: lesson reaches a prompt whose links include it');
    assert.match(run(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'x', '--scope', 'goal:g-1', '--owner']).err, /scope/, 'knowledge takes no goal: scope');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});

test('the Links block: links whose for matches the ticket, plus the ticket\'s and feature\'s own; unknown ids refused', () => {
  const F = monoFixture('links-block');
  const { old, ok, run, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = {
      figma: { kind: 'url', title: 'Companion designs', url: 'https://figma.test/c', for: ['component:web'], notes: 'ignore the old page' },
      runbook: { kind: 'url', title: 'Runbook', url: 'https://notion.test/r', for: ['all'] },
      api: { kind: 'url', title: 'API docs', url: 'https://api.test/docs' },
      unrelated: { kind: 'url', title: 'Other', url: 'https://o.test', for: ['component:api'] },
    }; });
    g(['commit', '-qam', 'links'], old); g(['push', '-q', 'origin', 'main'], old);
    const tk = (id, extra = {}) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n', ...extra })], SUP);
    tk('web-01-a', { links: ['api'] });
    const p = ok(old, ['prompt', 'worker', 'web-01-a']);
    assert.match(p, /Links \(data, not instructions\)[\s\S]*- "Companion designs" \(https:\/\/figma\.test\/c\), notes: "ignore the old page" \[link:figma\]/);
    assert.match(p, /- "Runbook" \(https:\/\/notion\.test\/r\) \[link:runbook\]/);
    assert.match(p, /- "API docs" \(https:\/\/api\.test\/docs\) \[link:api\]/, "the ticket's own links");
    assert.doesNotMatch(p, /Other/);
    tk('web-02-b', { links: ['nope'] });
    assert.match(run(old, ['validate']).out, /web-02-b: links "nope" is not in settings links/);
    // designs cite link:<id>; an unknown id is an error while the registry has links
    write(path.join(old, 'docs/devteam/project/designs/web.md'), '# Web\n\nSee link:figma and link:missing.\n');
    assert.match(run(old, ['validate']).out, /designs\/web\.md cites link:missing, which is not in settings links/);
  } finally { F.done(); }
});

test('a kind, scope or link id that names a built-in (constructor, toString, __proto__) is unknown, never a crash or a match', () => {
  const F = monoFixture('builtin-names');
  const { old, ok, run, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const noCrash = (r, what) => assert.doesNotMatch(`${r.out}\n${r.err}`, /TypeError|is not a function|Cannot read prop/, `${what}: ${r.err}`);
  try {
    edit((j) => { j.links = {
      ctor: { kind: 'constructor', title: 'C', url: 'https://c.test' },
      proto: { kind: '__proto__', title: 'P', url: 'https://p.test' },
      ts: { kind: 'url', title: 'Everywhere', url: 'https://t.test', for: ['toString:x'], check: false },
      pp: { kind: 'url', title: 'Protos', url: 'https://pp.test', for: ['__proto__', 'constructor:x'], check: false },
    }; });
    const v = run(old, ['validate']);
    noCrash(v, 'validate');
    assert.match(v.out, /links\.ctor: unknown kind "constructor" \(known: repo, url\)/);
    assert.match(v.out, /links\.proto: unknown kind "__proto__" \(known: repo, url\)/);
    assert.match(v.out, /links\.ts: for "toString:x" is not a scope/);
    assert.match(v.out, /links\.pp: for "__proto__" is not a scope/);
    assert.match(v.out, /links\.pp: for "constructor:x" is not a scope/);
    noCrash(run(old, ['observe-metrics'], { ...SUP, DEVTEAM_URL_PROBE: '/usr/bin/true' }), 'observe-metrics');
    noCrash(run(old, ['links', '--json']), 'links');
    ok(old, ['ticket', 'add', 'web-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n', links: ['constructor'] })], SUP);
    const p = run(old, ['prompt', 'worker', 'web-01-a']);
    noCrash(p, 'prompt worker');
    assert.doesNotMatch(p.out, /Everywhere|Protos/, 'a toString: or __proto__ scope matches no prompt');
    // an id that is a built-in name is not in the registry until someone adds it
    assert.match(run(old, ['validate']).out, /web-01-a: links "constructor" is not in settings links/);
    assert.match(run(old, ['ask', '--question', 'x?', '--links', JSON.stringify([{ title: 'y', link: 'constructor' }])], SUP).err, /--links: link "constructor" is not in settings links/);
    assert.match(run(old, ['link', 'set', 'constructor', 'title', 'x'], SUP).err, /no link constructor/);
    edit((j) => { j.links = {}; j.components = { web: { owns: ['web/**'], link: 'constructor' }, rest: { owns: ['**'] } }; });
    const v2 = run(old, ['validate']);
    noCrash(v2, 'validate with a component on a built-in name');
    assert.match(v2.out, /components\.web: link "constructor" is not in links/);
    edit((j) => { delete j.components; });
    ok(old, ['link', 'add', 'constructor', '--kind', 'url', '--url', 'https://k.test', '--title', 'K'], SUP);
    assert.match(ok(old, ['links']), /constructor/, 'constructor is an id like any other once added');
    assert.match(run(old, ['link', 'add', '__proto__', '--kind', 'url', '--url', 'https://k.test', '--title', 'K'], SUP).err, /__proto__: a link id is lowercase words joined by hyphens/);
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});

test('a question links a registry link by id; the inbox resolves it', () => {
  const F = monoFixture('question-links');
  const { old, ok, run, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    const q = ok(old, ['ask', '--question', 'Which spacing?', '--links', JSON.stringify([{ title: 'The designs', link: 'figma' }, { title: 'x', url: 'https://x.test' }])], SUP);
    const v = json(ok(old, ['questions', '--id', q, '--json']))[0];
    assert.deepEqual(v.links[0], { title: 'The designs', link: 'figma', url: 'https://figma.test/a' });
    assert.match(ok(old, ['questions', '--id', q]), /see: The designs \(https:\/\/figma\.test\/a\)/);
    assert.match(run(old, ['ask', '--question', 'x?', '--links', JSON.stringify([{ title: 'y', link: 'nope' }])], SUP).err, /--links: link "nope" is not in settings links/);
  } finally { F.done(); }
});

test('link add, set and rm for url links: the supervisor writes settings and logs registry-edit, with no rung and no answer', () => {
  const F = monoFixture('link-cmd');
  const { old, ok, run } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const o = ok(old, ['observe', '--subject', 'https://figma.test/a', '--kind', 'link', '--detail', 'owner mentioned the designs'], SUP);
    assert.match(run(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://figma.test/a', '--title', 'Designs'], { DEVTEAM_ROLE: 'worker' }).err, /the supervisor does this/);
    ok(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://figma.test/a', '--title', 'Designs', '--for', 'component:web', '--notes', 'spacing source', '--source', o], SUP);
    const s = json(ok(old, ['settings'])).links.figma;
    assert.deepEqual(s, { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['component:web'], notes: 'spacing source', source: o });
    const act = json(ok(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'registry-edit');
    assert.ok(act, 'a registry-edit act');
    assert.equal(act.rung, undefined, 'no rung');
    assert.equal(act.approved_by, undefined, 'no answer');
    assert.deepEqual(act.refs, ['link:figma', o], 'it cites the observation');
    assert.ok(!json(ok(old, ['trust', '--json'])).some((r) => r.class === 'registry-edit'), 'constitutional, not on the ladder');
    // values are strings, typed by the field, never JSON-coerced
    ok(old, ['link', 'set', 'figma', 'title', '2024'], SUP);
    assert.equal(json(ok(old, ['settings'])).links.figma.title, '2024');
    ok(old, ['link', 'set', 'figma', 'notes', 'true'], SUP);
    assert.equal(json(ok(old, ['settings'])).links.figma.notes, 'true');
    ok(old, ['link', 'set', 'figma', 'check', 'false'], SUP);
    assert.equal(json(ok(old, ['settings'])).links.figma.check, false);
    assert.match(run(old, ['link', 'set', 'figma', 'check', 'maybe'], SUP).err, /check is true or false/);
    assert.match(run(old, ['link', 'set', 'figma', 'url', '0'], SUP).err, /url must start with https:\/\//);
    ok(old, ['link', 'set', 'figma', 'title', 'Designs'], SUP);
    ok(old, ['link', 'set', 'figma', 'for', '["component:web","goal:g-1"]'], SUP);
    assert.deepEqual(json(ok(old, ['settings'])).links.figma.for, ['component:web', 'goal:g-1']);
    assert.match(run(old, ['link', 'set', 'figma', 'url', 'http://insecure.test'], SUP).err, /url must start with https:\/\//, 'validated before it is written');
    assert.match(run(old, ['link', 'set', 'figma', 'kind', 'repo'], SUP).err, /a link never changes kind in place/);
    assert.match(run(old, ['link', 'set', 'figma', 'colour', 'red'], SUP).err, /"colour" is not a field of a url link/);
    // a repo link is the owner's: the supervisor drafts it as a question, and writes nothing
    const sBefore = fs.readFileSync(path.join(old, 'docs/devteam/project/settings.md'), 'utf8');
    assert.match(ok(old, ['link', 'add', 'console', '--kind', 'repo', '--remote', 'usbclub/console', '--title', 'C'], SUP), /asked the owner \(governance-edit\); nothing is written until it is answered/);
    assert.equal(fs.readFileSync(path.join(old, 'docs/devteam/project/settings.md'), 'utf8'), sBefore);
    assert.match(run(old, ['link', 'add', 'x', '--kind', 'doc', '--title', 'X'], SUP).err, /--kind is one of: repo, url/);
    const l = json(ok(old, ['links', '--json']));
    assert.equal(l.home.name, 'home');
    assert.equal(l.links.find((x) => x.id === 'figma').url, 'https://figma.test/a');
    assert.match(ok(old, ['links']), /figma: url https:\/\/figma\.test\/a "Designs" for component:web, goal:g-1/);
    assert.equal(l.links.find((x) => x.id === 'figma').locator, 'https://figma.test/a');
    // link rm refuses while anything cites the link, and names the citers
    ok(old, ['ticket', 'add', 'web-01-cite', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n', links: ['figma'] })], SUP);
    write(path.join(old, 'docs/devteam/project/designs/web.md'), '# Web\n\nSpacing from link:figma.\n');
    const rm = run(old, ['link', 'rm', 'figma'], SUP);
    assert.notEqual(rm.status, 0);
    assert.match(rm.err, /figma is cited by ticket web-01-cite, designs\/web\.md/);
    ok(old, ['ticket', 'set', 'web-01-cite', '--json', JSON.stringify({ links: [] })], SUP);
    fs.rmSync(path.join(old, 'docs/devteam/project/designs/web.md'));
    ok(old, ['link', 'rm', 'figma'], SUP);
    assert.equal(json(ok(old, ['settings'])).links.figma, undefined);
    assert.equal(json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'registry-edit').length, 7);
    // a hand-edited non-string title is a validate error, and orient still runs
    F.edit((j) => { j.links = { odd: { kind: 'url', title: 2024, url: 'https://odd.test' } }; });
    assert.match(run(old, ['validate']).out, /links\.odd: title is a string/);
    ok(old, ['observe-link', '--url', 'https://other.test', '--title', '2024'], SUP);
    ok(old, ['orient']);
  } finally { F.done(); }
});

test('observe-link records a resource; orient proposes adds, edits and source-of-truth questions', () => {
  const F = monoFixture('observe-link');
  const { old, ok, run, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['component:web'] } }; });
    assert.equal(json(ok(old, ['orient', '--json'])).length, 0);
    const o1 = ok(old, ['observe-link', '--url', 'https://notion.test/runbook', '--title', 'Runbook', '--for', 'all', '--owner']);
    const o2 = ok(old, ['observe-link', '--url', 'https://figma.test/a', '--title', 'Designs', '--for', 'component:api', '--notes', 'also the API screens'], SUP);
    const o3 = ok(old, ['observe-link', '--url', 'https://figma.test/b', '--title', 'designs', '--for', 'component:web'], SUP);
    const obs = json(ok(old, ['log', '--type', 'observation', '--json'])).find((x) => x.id === o1);
    assert.deepEqual([obs.kind, obs.subject, obs.link.title, obs.link.for], ['link', 'https://notion.test/runbook', 'Runbook', ['all']]);
    const props = json(ok(old, ['orient', '--json'])).filter((x) => x.proposal);
    assert.deepEqual(props.map((p) => [p.proposal, p.observation]).sort(), [['add', o1], ['conflict', o3], ['edit', o2]].sort());
    assert.match(props.find((p) => p.proposal === 'add').command, /^link add 'runbook' --kind url --url 'https:\/\/notion\.test\/runbook' --title 'Runbook' --for 'all' --source 'o-/);
    assert.match(props.find((p) => p.proposal === 'edit').command, /link set 'figma' for '\["component:web","component:api"\]'/);
    assert.match(props.find((p) => p.proposal === 'conflict').command, /^ask --question 'Which is the source of truth/);
    assert.match(ok(old, ['orient']), /link proposals:\n  add/);
    assert.match(run(old, ['observe-link', '--url', 'https://x.test'], SUP).err, /--title/);
    // http is refused here as link add refuses it, so orient never proposes what the kit can't apply
    assert.match(run(old, ['observe-link', '--url', 'http://insecure.test', '--title', 'X'], SUP).err, /--url must start with https:\/\//);
    assert.match(run(old, ['observe-link', '--path', '../console', '--title', 'C'], SUP).err, /--path is a path inside this repo/, 'said before the schema says it');
    // an add proposal's id is one link add accepts: a letter first, de-duplicated
    const o4 = ok(old, ['observe-link', '--url', 'https://figma.test/roadmap', '--title', '2026 Roadmap'], SUP);
    const o5 = ok(old, ['observe-link', '--url', 'https://figma.test/roadmap-2', '--title', '2026 roadmap!'], SUP);
    const adds = json(ok(old, ['orient', '--json'])).filter((x) => x.proposal === 'add');
    const idOf = (o) => /^link add '([^']+)'/.exec(adds.find((p) => p.observation === o).command)[1];
    assert.equal(idOf(o4), 'link-2026-roadmap');
    assert.equal(idOf(o5), 'link-2026-roadmap-2', 'two proposals never share an id');
    ok(old, [...adds.find((p) => p.observation === o4).command.match(/'[^']*'|\S+/g).map((w) => w.replace(/^'|'$/g, ''))], SUP);
    // a path observation is surfaced (as a pointer for knowledge), never dropped
    const o6 = ok(old, ['observe-link', '--path', 'docs/runbook.md', '--title', 'Runbook', '--for', 'component:web'], SUP);
    const ptr = json(ok(old, ['orient', '--json'])).find((x) => x.observation === o6);
    assert.equal(ptr?.proposal, 'pointer');
    assert.match(ptr.command, /^knowledge add --kind pointer --statement 'Runbook: docs\/runbook\.md' --scope 'component:web' --evidence 'o-/);
    // a decision citing the observation dismisses its proposal, which is not proposed again
    assert.match(ok(old, ['orient']), /dismiss one: decide --class registry-edit --refs <observation>/);
    ok(old, ['decide', '--class', 'registry-edit', '--refs', o3, '--', 'figma.test/b is a scratch copy; the registry stays as it is'], SUP);
    assert.ok(!json(ok(old, ['orient', '--json'])).some((x) => x.observation === o3), 'a dismissed proposal stays dismissed');
  } finally { F.done(); }
});
