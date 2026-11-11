# An inspectable OODA loop: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `docs/superpowers/specs/2026-11-11-ooda-loop-inspectable-design.md` as five PRs, each leaving every instance working.

**Architecture:** One CLI (`docs/devteam/scripts/devteam.mjs`), one schema (`docs/devteam/schema/log.schema.json`), one dashboard page (`docs/devteam/dashboard/index.html`). Extend those files; tests go in `test/*.test.mjs` using `test/lib/kit.mjs`'s `fleetFixture`.

**Tech Stack:** Node 18+ (no dependencies), `node:test`, the dashboard's CDN Mermaid 11.4.1 and DOMPurify.

## Global Constraints

- Node 18 to 24 (CI runs 18, 20, 22, 24). Locally: `node --test --test-concurrency=8 test/*.test.mjs` on Node 24 (`~/.asdf` or `npx -y node@24`), plus `node --test test/bounds.test.mjs` alone.
- Never run tmux in tests without the fixture's private `TMUX_TMPDIR`.
- Storage changes are additive only: no field narrowed, none required, no type removed. Writers (`appendLog`, which runs `checkLine`) stay strict; only readers become tolerant.
- A log line is at most 4,096 bytes (`LINE_MAX`).
- Match surrounding style: long single-line statements, comments that say why, plain-English owner-facing text.
- Each PR: Fable adversarial review of the diff, fixes, green CI, stop at merge-ready.

PRs 2–5 are planned in their own sections below, each written when the PR before it is up (their code depends on what the earlier PR's review changes).

---

## PR 1: reader tolerance

A line written by a newer kit (a field this kit's schema doesn't know, or a type it doesn't know) is reported, not refused, by every full-validation path. Writers stay strict.

### Task 1: `parseLines` sets unknown fields and types aside

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` — `parseLines` (~924), `cmdLogCheck` (~1717)
- Test: `test/log-tolerance.test.mjs` (new)

**Interfaces:**
- Produces: `parseLines(text, file, opts)` returns `{ lines, errors, unknown }`; `unknown` is a list of strings `"<file>:<n>: <what>"`. Lines with unknown top-level body fields are kept with those fields removed; lines of an unknown type (otherwise a valid envelope) are not kept. Every existing caller reads only `lines` and `errors`, so they need no change except `cmdLogCheck`, which prints `unknown`.

- [ ] **Step 1: Write the failing test** (`test/log-tolerance.test.mjs`)

```js
// A kit reads a log a newer kit wrote: a field or a type it doesn't know is set aside and reported,
// never an error, so log-check passes, log-sync syncs and the fold still applies what it knows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const month = () => new Date().toISOString().slice(0, 7);

test('a newer kit\'s field or type is reported, not refused; known fields still fold', () => {
  const F = fleetFixture('tolerance');
  const { old, ok, run } = F;
  try {
    const id = ok(old, ['problem', 'add', '--title', 'slow page', '--severity', '1'], SUP).trim();
    const file = path.join(old, 'docs/devteam/run/log', `supervisor-${month()}.jsonl`);
    const at = () => new Date().toISOString();
    // a set line from a newer kit: one known field, one it doesn't know
    fs.appendFileSync(file, line({ id, type: 'problem', op: 'set', at: at(), by: 'supervisor', status: 'owned', figures: { informed: 1 } }));
    // a whole line of a type this kit doesn't know
    fs.appendFileSync(file, line({ id: `l-${id.slice(2)}`, type: 'learning', op: 'new', at: at(), by: 'supervisor', kind: 'outcome' }));
    const r = run(old, ['log-check']);
    assert.equal(r.status, 0, r.err || r.out);
    assert.match(r.out, /written by a newer kit: upgrade.*figures/);
    assert.match(r.out, /written by a newer kit: upgrade.*type "learning"/);
    const o = json(ok(old, ['log', '--id', id, '--json']))[0];
    assert.equal(o.status, 'owned', 'the known field on the same line still applies');
    assert.equal(o.figures, undefined, 'an unknown field is never read');
    // a known field the writer may not set is still an error: tolerance is for unknown names only
    fs.appendFileSync(file, line({ id, type: 'problem', op: 'set', at: at(), by: 'supervisor', title: 'renamed' }));
    assert.notEqual(run(old, ['log-check']).status, 0);
  } finally { F.done(); }
});
```

(`log --id <id> --json` prints the folded objects, `cmdLog` ~1741. `problem set`'s supervisor fields are `status, severity, …`; `title` is not settable, so the last line is a real integrity error.)

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/log-tolerance.test.mjs`
Expected: FAIL — `log-check` exits non-zero with `figures is not a field here` / `not a log line`.

- [ ] **Step 3: Implement in `parseLines`**

Replace the shape/validation lines in `parseLines` with:

```js
    const envelopeOk = o && typeof o === 'object' && !Array.isArray(o) && ['new', 'set'].includes(o.op) && typeof o.id === 'string' && typeof o.at === 'string' && typeof o.by === 'string' && typeof o.type === 'string';
    if (!envelopeOk) return void errors.push(`${file}:${n}: not a log line`);
    // A line a newer kit wrote: a type or a field this kit's schema doesn't know. Set aside and
    // reported (log-check says upgrade), never an error: it grants nothing, since nothing here
    // reads it. Writers stay strict (appendLog runs checkLine on the line as given).
    if (!TYPES.includes(o.type)) return void unknown.push(`${file}:${n}: type "${o.type}"`);
    const props = SCHEMA.$defs.types[o.type].properties ?? {};
    const extra = Object.keys(o).filter((k) => !ENVELOPE.includes(k) && !(k in props));
    if (extra.length) {
      unknown.push(`${file}:${n}: ${o.type}.${extra.join(', ')}`);
      for (const k of extra) delete o[k];
      // a set line that carried only unknown fields changes nothing this kit knows
      if (o.op === 'set' && !Object.keys(o).some((k) => !ENVELOPE.includes(k))) return;
    }
    const errs = validate ? checkLine(o, file) : [integrity(o, file)].filter(Boolean);
```

and declare `const unknown = [];` beside `errors`, returning `{ lines, errors, unknown }`. Update the function's comment: "…readers skip the schema walk for speed but never the integrity checks. A type or field a newer kit wrote goes to `unknown`."

- [ ] **Step 4: Implement in `cmdLogCheck`**

After the parse loop, collect `r.unknown` into `newer` and before `report(...)`:

```js
  for (const u of newer) out(`written by a newer kit: upgrade (${u})`);
```

(The out text must contain both "written by a newer kit: upgrade" and the field or `type "x"`, which the test matches.)

- [ ] **Step 5: Run the test**

Run: `node --test test/log-tolerance.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/devteam/scripts/devteam.mjs test/log-tolerance.test.mjs
git commit -m "log: a newer kit's field or type is reported, not refused"
```

### Task 2: `log-sync` and `merge` accept a newer kit's lines

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs` — `cmdLogSync` (~1651), `logRule` (~1526) only if a test shows they need it (they read only `errors`, so after Task 1 they should already pass).
- Test: `test/log-tolerance.test.mjs`

- [ ] **Step 1: Write the test** (append)

```js
test('log-sync lands a file whose lines carry a field this kit doesn\'t know', () => {
  const F = fleetFixture('tolerance-sync');
  const { old, ok } = F;
  try {
    const id = ok(old, ['problem', 'add', '--title', 'slow page', '--severity', '1'], SUP).trim();
    const file = path.join(old, 'docs/devteam/run/log', `supervisor-${month()}.jsonl`);
    fs.appendFileSync(file, line({ id, type: 'problem', op: 'set', at: new Date().toISOString(), by: 'supervisor', status: 'owned', figures: { informed: 1 } }));
    const out = ok(old, ['log-sync'], SUP);
    assert.doesNotMatch(out, /not synced/);
  } finally { F.done(); }
});
```

If `log-sync` in `fleetFixture` needs more setup (a chore-log worktree), follow `test/lib/chain.mjs`'s step "log-sync mirrors run/ into project/log on chore-log" (~1783) for what it runs first, and copy that setup here.

- [ ] **Step 2: Run** — `node --test test/log-tolerance.test.mjs`. Expected PASS after Task 1; if FAIL, make `cmdLogSync` ignore `added.unknown` (it already reads only `errors`) and fix what the failure names.

- [ ] **Step 3: Docs.** In `process/supervisor.md`, where `log-check` is described (the authority paragraph, ~line 238: "`devteam.mjs log-check` validates every line and lists what the fold ignored"), add: "; a field or type a newer kit wrote is listed as written by a newer kit (upgrade), and passes". In `schema/log.schema.json`'s top-level `description`, after "…enforces all of it on write and in log-check", add: "A line from a newer kit (a type or field this schema doesn't know) is set aside and reported, never an error: it grants nothing."

- [ ] **Step 4: Full suite** — `npx -y node@24 --test --test-concurrency=8 test/*.test.mjs` then `npx -y node@24 --test test/bounds.test.mjs`. Expected: all pass.

- [ ] **Step 5: Commit, push, PR**

```bash
git add -A && git commit -m "log-sync and merge take a newer kit's lines; docs"
git push -u origin ooda-loop-inspectable
gh pr create --title "Log: read lines a newer kit wrote (OODA PR 1 of 5)" --body "<spec link, what changes, tests, rollout note>"
```
