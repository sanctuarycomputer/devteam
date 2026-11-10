// The registry attestation, and link probes.
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
import { write, json, fleetFixture, monoFixture, REAL_GIT } from './lib/kit.mjs';

test('the registry attestation is the owner\'s: registry-attest is never defaulted, a chat answer counts, and a goal that needs the registry complete waits for the owner\'s yes', () => {
  const F = fleetFixture('attest');
  const { old, ok, run } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const goal = (title, pre, prio, extra = []) => ok(old, ['goal', 'add', '--title', title, '--outcome', 'the floor holds', '--measure', 'floor gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'new features', '--preconditions', ...pre, '--priority', prio, ...extra], SUP);
    // the marker is the goal's own field, set by number; the precondition's wording is free
    assert.match(run(old, ['goal', 'add', '--title', 'X', '--preconditions', 'a', '--registry-precondition', '2'], SUP).err, /--registry-precondition 2: X has 1 precondition/);
    assert.match(run(old, ['goal', 'add', '--title', 'X', '--preconditions', 'a', '--registry-precondition', 'one'], SUP).err, /--registry-precondition is the number of the goal's "registry is complete" precondition \(1-based\), or none/);
    const G = goal('Baseline', ['format and lint', 'every repo, design file and doc is listed'], '1', ['--registry-precondition', '2']);
    // the phrase alone marks nothing: the check is keyed to the field, never the text
    const other = goal('Other', ['format and lint', 'the registry is complete'], '2');
    const third = goal('Third', ['format and lint'], '3');
    const ready = (...refs) => run(old, ['act', '--class', 'goal-readiness', ...(refs.length ? ['--refs', ...refs] : []), '--', 'Baseline ready'], SUP);
    // a goal-readiness act or decision names exactly one existing goal
    for (const [refs, why] of [[[], 'no refs'], [['g-nope'], 'a bogus ref'], [['nonsense'], 'not a goal id'], [[G, third], 'two goals'], [[G, 'g-nope'], 'a goal and a bogus ref']]) {
      const r = ready(...refs);
      assert.notEqual(r.status, 0, `refused with ${why}`);
      assert.match(r.err, /goal-readiness names exactly one goal, an existing goal id: --refs <g-id>/, why);
    }
    assert.match(run(old, ['decide', '--class', 'goal-readiness', '--', 'Baseline ready'], SUP).err, /goal-readiness names exactly one goal/);
    assert.match(run(old, ['decide', '--class', 'goal-readiness', '--refs', G, third, '--', 'both ready'], SUP).err, /goal-readiness names exactly one goal/);
    assert.match(ready(G).err, new RegExp(`${G} has precondition 2 marked "the registry is complete".*no owner's yes to a registry-attest question .*ask --class registry-attest --goal`));
    assert.equal(ready(other).status, 0, 'a goal without the marker is not held, whatever its preconditions say');
    // a decision names one goal; the act under it is held like any other
    const D = ok(old, ['decide', '--class', 'goal-readiness', '--refs', G, '--', 'Baseline ready'], SUP);
    assert.match(run(old, ['act', '--decision', D, '--', 'Baseline ready'], SUP).err, /no owner's yes to a registry-attest question/);
    const ask = ['ask', '--class', 'registry-attest', '--goal', G, '--question', 'Does the registry list every repo, design file and doc this project depends on?'];
    assert.match(run(old, [...ask, '--recommendation', 'yes', '--default', 'yes'], SUP).err, /registry-attest question has no --default/);
    assert.match(run(old, ask, SUP).err, /--recommendation yes/);
    assert.match(run(old, ['ask', '--class', 'registry-attest', '--question', 'Complete?', '--recommendation', 'yes'], SUP).err, /registry-attest question needs --goal/);
    const Q = ok(old, [...ask, '--recommendation', 'yes'], SUP);
    assert.match(run(old, ['answer', Q, '--defaulted'], SUP).err, /no default to apply/, 'never defaulted');
    assert.match(ready(G).err, new RegExp(`${Q} is not answered by the owner`), 'readiness waits while the question is open');
    ok(old, ['answer', Q, 'no, the designs are missing']);
    assert.match(ready(G).err, new RegExp(`${Q} was answered "no, the designs are missing"`));
    const Q2 = ok(old, [...ask, '--recommendation', 'yes'], SUP);
    ok(old, ['answer', Q2, 'yes']);
    assert.equal(ready(G).status, 0, "the owner's yes is the attestation");
    assert.equal(run(old, ['act', '--decision', D, '--', 'Baseline ready'], SUP).status, 0, 'and the act under the decision');
    // the marker is a goal field: a draft's supervisor sets and clears it by number
    ok(old, ['goal', 'set', third, '--registry-precondition', '1'], SUP);
    assert.match(ready(third).err, /no owner's yes to a registry-attest question \(none asked yet\)/);
    const Qc = ok(old, ['ask', '--class', 'registry-attest', '--goal', third, '--question', 'Does the registry list every repo, design file and doc this project depends on?', '--recommendation', 'yes'], SUP);
    ok(old, ['answer', Qc, 'yes', '--from-chat', '--said', 'yes, that is everything'], SUP);
    assert.equal(ready(third).status, 0, "the owner's yes in chat attests like any other");
  } finally { F.done(); }
});

test('a draft whose precondition reads as the registry being complete can\'t dodge the attestation by leaving registry_precondition unset; the dashboard and the approval show the field', () => {
  const F = fleetFixture('regdodge');
  const { old, ok, run } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const G = ok(old, ['goal', 'add', '--title', 'Floor', '--outcome', 'the floor holds', '--measure', 'floor gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'new features', '--preconditions', 'format and lint', 'the Registry is Complete', '--priority', '1'], SUP);
    const plain = ok(old, ['goal', 'add', '--title', 'Plain', '--outcome', 'it works', '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a registry exists', 'tests complete', '--priority', '2'], SUP);
    for (const x of [G, plain]) {
      ok(old, ['goal', 'reading', x, '--run'], SUP);
      ok(old, ['goal', 'set', x, '--milestones', JSON.stringify([{ title: 'Floor', target: 0, preconditions: [1, 2], tickets: 2 }])], SUP);
    }
    const gap = new RegExp(`definition: precondition 2 \\("the Registry is Complete"\\) reads as the registry being complete, and ${G} has no registry_precondition: goal set ${G} --registry-precondition 2`);
    assert.match(ok(old, ['goal', 'check', G]), gap, 'unset, the registry wording is a definition gap');
    assert.equal(run(old, ['goal', 'check', G, '--strict']).status, 1);
    // clearing the field is no way round it
    ok(old, ['goal', 'set', G, '--registry-precondition', 'none'], SUP);
    assert.match(ok(old, ['goal', 'check', G]), gap);
    // the heuristic only flags: "registry" and "complete" in two different preconditions is not it
    assert.match(ok(old, ['goal', 'check', plain]), /^ {2}ok$/m);
    const design = [{ title: 'The approach', path: 'docs/devteam/project/designs/floor.md' }];
    const approval = ['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve the floor?', '--links', JSON.stringify(design)];
    assert.match(run(old, approval, SUP).err, new RegExp(`${G} is not fully defined yet[\\s\\S]*--registry-precondition 2`), 'the approval question waits for the field');
    assert.match(run(old, ['goal', 'decide', G, 'approve']).err, new RegExp(`${G} is not fully defined[\\s\\S]*--registry-precondition 2`), 'and so does the owner\'s approve');
    let dash = json(ok(old, ['dashboard-data'])).ooda.goals;
    assert.equal(dash.find((x) => x.id === G).registry_attest, undefined, 'nothing on the card while unset');
    // set, the gap is gone and the card shows the attestation's state
    ok(old, ['goal', 'set', G, '--registry-precondition', '2'], SUP);
    assert.match(ok(old, ['goal', 'check', G]), /^ {2}ok$/m);
    dash = json(ok(old, ['dashboard-data'])).ooda.goals;
    assert.deepEqual(dash.find((x) => x.id === G).registry_attest, { precondition: 2, status: 'not asked', question: null, answer: null });
    // (the attestation is an open question about the goal, so an approval is asked before or after it)
    const A = ok(old, approval, SUP);
    assert.match(json(ok(old, ['questions', '--id', A, '--json']))[0].context, /Registry attestation: precondition 2 \("the Registry is Complete"\), not asked; goal-readiness waits for the owner's yes/, 'the approval\'s context names the field');
    const Q = ok(old, ['ask', '--class', 'registry-attest', '--goal', G, '--question', 'Does the registry list every repo, design file and doc this project depends on?', '--recommendation', 'yes'], SUP);
    dash = json(ok(old, ['dashboard-data'])).ooda.goals;
    assert.deepEqual(dash.find((x) => x.id === G).registry_attest, { precondition: 2, status: 'open', question: Q, answer: null });
    ok(old, ['answer', Q, 'yes']);
    dash = json(ok(old, ['dashboard-data'])).ooda.goals;
    assert.deepEqual(dash.find((x) => x.id === G).registry_attest, { precondition: 2, status: 'answered', question: Q, answer: 'yes' });
    assert.equal(dash.find((x) => x.id === plain).registry_attest, undefined);
  } finally { F.done(); }
});

test('link probes: four at a time inside a tick budget, never a prompt, and a page behind auth is a note', () => {
  const F = monoFixture('probes');
  const { old, ok, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const starts = path.join(F.base, 'starts.log');
  // the first stub to start leaves a marker: its mtime is when probing began, so exec latency on a
  // loaded machine (seconds, before any probe runs) never counts against the budget's bound
  const first = path.join(F.base, 'first-probe');
  const stub = path.join(F.base, 'probe.sh');
  write(stub, `#!/bin/sh\n[ -e "${first}" ] || : > "${first}"\necho "$1" >> "${starts}"\ncase "$1" in *slow*) sleep 30; echo 200 ;; *auth*) echo 403 ;; *gone*) echo 404 ;; *) echo 200 ;; esac\n`);
  fs.chmodSync(stub, 0o755);
  // ls-remote through a shim that records whether git could prompt, and says the remote is gone
  const shim = path.join(F.base, 'shim');
  write(path.join(shim, 'git'), `#!/bin/sh\nif [ "$1" = ls-remote ]; then echo "prompt=$GIT_TERMINAL_PROMPT askpass=[$GIT_ASKPASS]" >> "${path.join(F.base, 'lsremote.log')}"; exit 2; fi\nexec "${REAL_GIT}" "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  const url = (id, host) => ({ kind: 'url', title: id, url: `https://${host}.test/${id}` });
  const tick = (extra) => {
    const r = spawnSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), 'observe-metrics'], { cwd: old, env: { ...F.env(SUP), DEVTEAM_URL_PROBE: stub, ...extra }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return { out: r.stdout, sinceFirst: fs.existsSync(first) ? Date.now() - fs.statSync(first).mtimeMs : null };
  };
  try {
    const co = path.join(F.base, 'console');
    g(['init', '-q', co], F.base);
    g(['remote', 'add', 'origin', 'https://github.com/usbclub/console.git'], co);
    edit((j) => { j.links = { fast1: url('fast1', 'fine'), fast2: url('fast2', 'fine'), ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`slow${n}`, url(`slow${n}`, 'slow')])) }; });
    g(['commit', '-qam', 'links'], old); g(['push', '-q', 'origin', 'main'], old);
    // a slow stub sleeps 30 s; the budget is 5 s. Bounds are loose on purpose: a stub can take
    // seconds to exec under load, so the fast ones may be cut too, but no slow one ever finishes
    const t = tick({ DEVTEAM_PROBE_BUDGET_MS: '5000' });
    assert.ok(t.sinceFirst === null || t.sinceFirst < 25000, `the budget cut the slow probes (${t.sinceFirst} ms from the first probe; one slow probe alone is 30 s; null: none started)`);
    const skipped = (/(\d+) link\(s\) not probed this tick \(time budget\): ([^\n]+)/.exec(t.out)?.[2] ?? '').split(', ');
    for (const n of [1, 2, 3, 4, 5]) assert.ok(skipped.includes(`slow${n}`), `slow${n} not probed (${skipped.join(', ')})`);
    assert.ok(skipped.every((id) => /^(slow[1-5]|fast[12])$/.test(id)), skipped.join(', '));
    const started = fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').trim().split('\n') : [];
    assert.ok(!started.some((u) => u.endsWith('/slow5')), `four at a time: slow5 waits for a slot that only the budget frees (${started.join(' ')})`);
    assert.ok(!json(ok(old, ['metrics', '--json'])).findings.some((f) => f.kind === 'link-unreachable'), 'not probed is not a finding');
    const cache = json(fs.readFileSync(path.join(old, 'docs/devteam/run/link-probes.json'), 'utf8'));
    assert.deepEqual(Object.keys(cache).filter((id) => !['fast1', 'fast2'].includes(id)), [], 'only a fast probe that finished is cached; the rest are probed next tick');
    assert.deepEqual(Object.keys(cache).sort(), ['fast1', 'fast2'].filter((id) => !skipped.includes(id)), 'a fast probe is cached exactly when it was not cut');
    // 401/403/405 is a page behind auth: a low note, never a high finding that wakes wait
    edit((j) => { j.links = { locked: url('locked', 'auth'), gone: url('gone', 'gone'), console: { kind: 'repo', title: 'Console', remote: 'usbclub/console', path: co } }; });
    g(['commit', '-qam', 'links 2'], old); g(['push', '-q', 'origin', 'main'], old);
    // these probes are all quick: a long budget only stands in for a loaded machine
    tick({ PATH: `${shim}${path.delimiter}${process.env.PATH}`, DEVTEAM_PROBE_BUDGET_MS: '120000' });
    const fs2 = json(ok(old, ['metrics', '--json'])).findings;
    assert.equal(fs2.find((f) => f.subject === 'locked')?.kind, 'link-behind-auth');
    assert.equal(fs2.find((f) => f.subject === 'locked').severity, 'low');
    assert.equal(fs2.find((f) => f.subject === 'gone')?.kind, 'link-unreachable');
    // the repo probe: ls-remote with no terminal prompt and no askpass, and its failure is a finding
    assert.match(fs.readFileSync(path.join(F.base, 'lsremote.log'), 'utf8'), /prompt=0 askpass=\[\]/);
    assert.match(fs2.find((f) => f.subject === 'console' && f.kind === 'link-unreachable')?.detail ?? '', /its remote usbclub\/console does not resolve/);
  } finally { F.done(); }
});
