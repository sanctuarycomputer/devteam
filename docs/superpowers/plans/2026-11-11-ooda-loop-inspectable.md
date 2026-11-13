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

---

## PR 2: signals the loop can see

Branch `ooda-signals` off `ooda-loop-inspectable` (PR 1); GitHub base `ooda-loop-inspectable` until PR 1 merges.

**A change from spec §2, found while planning:** `source` has meaning older kits and this kit already read (`o.source === 'repo' | 'prod'` on goal readings, `goalReadingOnMain` ~7669; a sensor's name on sensor lines), and `detector` is how every kit (an older worktree's included) recognises a sensor or metrics line (`fromSensor` ~12358, `observeFindings` ~7217). Rewriting either on new lines would make older kits misread new lines on a mixed fleet. So provenance is **computed at read time**, never rewritten: writers keep writing `source`/`detector` as today, and one pure function, `provenanceOf(o)`, returns `{ from, ref }` with `from` in `x-ooda.sources`. Views (dashboard data, peeks, `log --json`, the operator's reads) carry it. The spec's §2 is edited to say so in this PR.

### Task 1: `x-ooda` in the schema and `provenanceOf`

**Files:** `docs/devteam/schema/log.schema.json` (top-level `x-ooda`), `docs/devteam/scripts/devteam.mjs` (new `provenanceOf`, `stageOf` near `orientClusters`; `cmdLog --json`, `collectOoda.observations`, `peekView` add `provenance` and `stage`), `test/ooda-signals.test.mjs` (new).

**Interfaces — produces:**
- `SCHEMA['x-ooda'] = { stages: {…}, sources: ['sensor','metrics','spend','owner-answer','owner-thread','owner-chat','retro','worker','planner','supervisor'] }`, `stages` exactly as the spec's `x-ooda` block, plus observation kinds `finding-ack`, `sensor-ignored`, `sensor-unignored` → `decide`.
- `stageOf(o)` → `'observe'|'orient'|'decide'|'act'|'learn'|'measurement'|'inbox'|null` (null: work graph and conversation).
- `provenanceOf(o)` → `{ from, ref }`. Rules, first match wins:
  - `detector === 'sensor'` (and `fromSensor(o)`) → `{ from: 'sensor', ref: o.source }`
  - `detector === 'metrics'` → `{ from: o.kind === 'cost-hotspot' ? 'spend' : 'metrics', ref: o.kind }`
  - `source === 'pane'` → `{ from: 'metrics', ref: o.kind }` (the kit's pane check)
  - kind `reading` with `source` `repo`/`prod` → `{ from: 'sensor', ref: 'goal-measure' }`; with `source === 'owner'` → `{ from: 'owner-answer', ref: o.approved ?? null }`
  - kind `thread-resolved` → `{ from: 'owner-thread', ref: o.refs?.[0] ?? null }`
  - kind `retro` → `{ from: 'retro', ref: o.source_ref ?? null }`
  - `source` already in `x-ooda.sources` (set by `observe --source`) and allowed for the writer (below) → `{ from: o.source, ref: o.source_ref ?? null }`
  - otherwise by writer class: `owner` → `owner-chat` (the owner's own words), `supervisor` → `supervisor`, `ticket` → `worker`, `planner` → `planner`; `ref: o.source_ref ?? null`
- `observe --source <s>`: `s` must be in `x-ooda.sources` minus `sensor`, `metrics`, `spend` (the kit's own; refused like `--detector sensor`), and a worker may only give `worker`, a planner `planner`. Unknown or missing keeps today's default (`writerClass(by)`).

- [ ] Test (`test/ooda-signals.test.mjs`): a fixture log with one of each writer path (a sensor line via `sensor` test helpers if cheap, else a hand-written supervisor line with `detector: 'sensor'`; `observeFindings` via `observe-metrics` on a stale finding is heavy — write the line by hand with `detector: 'metrics'`; a goal reading with `source: 'repo'`; a `thread-resolved`; a `retro`; `observe` by owner, supervisor, a ticket; `observe --source owner-chat` by the supervisor; `observe --source sensor` refused; a worker's `observe --source supervisor` refused). Assert `log --id <id> --json` carries `provenance` and `stage` for each, and `dashboard-data`'s `ooda.observations[*].provenance`.
- [ ] Implement; run the file; commit "Provenance and stages, computed: x-ooda, provenanceOf, stageOf".

### Task 2: spikes see what the sensor heard

**Files:** `devteam.mjs` — `pollSensorLocked` (~12366: after a successful run or a live stream drain, mark the hour), `ingestEvents` spike loop (~13010), the daily prune (~12395 prunes counts to 14 days: prune `listened.json` the same way). Test in `test/ooda-signals.test.mjs`, or beside the existing spike tests (grep `is spiking` in `test/` and extend that file instead if it exists).

**Interfaces — produces:** `run/sensors/<name>/listened.json` = `{ "<yyyy-mm-ddThh>": true, … }`, written with `writeJsonAtomic`. A separate file, never a key in `counts.json` (whose keys are fingerprints and are iterated).

- [ ] Test first: a probe sensor fixture (follow the existing spike test's setup) where a fingerprint has counts in 30 hours spread over 2 days with a 10-hour gap the sensor wasn't listening, then a normal hour after the gap → no spike; the same fingerprint at 5× its median over ≥ 24 listened hours → one spike whose `detail` names the fingerprint id and says "over the last 1 day(s)" for 24–47 hours, and whose template (a log fingerprint) is inside the untrusted-data frame (`untrusted(`, as `log-error`'s detail does).
- [ ] Implement:
  - in the spike loop, `hours` iterates only hours present in `listened` (for a stream and a probe alike), `if (hours.length < 24) continue;`
  - days: `Math.floor(hours.length / 24)`
  - detail: `` `${m.name}: ${f.class ?? f.code ?? 'a log line'} (${fpIdOf(m.name, fp)}) is spiking: ${c} this hour against a median of ${median} an hour over the last ${Math.floor(hours.length / 24)} day(s)` `` plus, for a log fingerprint with a template, `\n${untrusted('the line', String(f.template).slice(0, 300))}`; keep the whole detail under 900 (the slice already there).
  - an hour is listened when a probe run succeeded (`r.ok`) or a stream's collector was alive at the drain (`res.listening`).
- [ ] Back-compat: a sensor with no `listened.json` yet (just upgraded) has no listened hours, so no spike fires for its first 24 listened hours. Say so in the commit and the PR body.
- [ ] Commit "Spikes: a median over the hours the sensor heard; say which line".

### Task 3: Orient groups a fingerprint as one signal; noise rulings; set-asides cite what they set aside

**Files:** `devteam.mjs` — `orientClusters` (~7395), `cmdAck` (~9167), `cmdSensorIgnore` (~13342), `cmdDecide` (orient-noise refs check), `governance/constitution.md` (`orient-noise` in `constitutional`), `process/supervisor.md` §3 step 4.

**Interfaces — produces:** `signalKeyOf(o)` → the recurrence key: `fpIdOfObservation(o)` for a sensor observation of a `TRIAGE_KINDS` kind, else `o.source_key ?? `${o.kind}:${o.subject}``; `orientClusters()` groups by it and also treats ids cited in any `decision.refs` as explained.

- [ ] Tests first:
  - four spikes (different hours) and a qualify on one fingerprint form one recurring signal whose key is the fingerprint id (write them as hand lines with `detector: 'sensor'`, the right `source_key`s and kinds); `orient` lists it once.
  - `decide --class orient-noise --refs <signal key> <ids…> -- "bots"` clears it from `orientClusters` and from `orient`'s output; `orient-noise` without at least one observation id in `--refs` is refused ("a noise ruling names the observations it explains").
  - `ack <kind> <subject> --reason …` writes `refs` = the ids of observations with `source_key === metrics:<kind>:<subject>`, newest 40; `sensor ignore <fp>` writes `refs` = `fpObservations(fp.id)` ids, newest 40; a line with 41 candidates carries 40.
  - knowledge's `kit` flag (from #190, once merged in) still lists and folds; a noise ruling doesn't touch it.
- [ ] Implement; add `orient-noise` to the constitution's `constitutional` list (the JSON block in §2); `supervisor.md` §3 step 4: replace "or noise (say so in an observation)" with "or noise: `decide --class orient-noise --refs <signal key> <observation ids> -- \"<why>\"` (it clears the signal; the owner can correct it)".
- [ ] Commit "Orient: one signal per fingerprint; noise rulings; set-asides cite what they set aside".

### Task 4: `sensor-untriaged`

**Files:** `devteam.mjs` — the findings list in `collectMetrics` (beside `incident-unowned`, ~8880); settings default `triage_overdue_hours: 2` in the sensor defaults; `supervisor.md` sensors "Findings" bullet.

- [ ] Test first: a supervisor-written sensor observation of severity 3 (kind `log-error`, with a fingerprint) older than 2 hours, with no incident whose `refs` include it, no `sensor-ignored` for its fingerprint, and no orient-noise decision citing it → one `sensor-untriaged` finding with subject = the fingerprint id; adding an incident clears it; a severity-2 one never raises it.
- [ ] Implement with `fpObservations` and `openIncidentOf`; subject is the fingerprint id so it dedupes per fingerprint; suggestion: "triage it: fold it into an incident, ignore it, or rule it noise".
- [ ] Commit "Findings: sensor-untriaged".

### Task 5: docs, spec note, PR

- [ ] `supervisor.md` §3 (Observe/Orient): readings vs observations, in two sentences: a reading (a rollup, a goal reading, spend, a gate) is a measurement and never a signal; an observation is a reading escalated with cause, or something noticed; its provenance is computed (`x-ooda.sources`).
- [ ] Spec §2: replace the writer bullets with the read-time `provenanceOf` design and why (mixed fleet; `source` already means things).
- [ ] Merge main in (never rebase). Full suite on Node 24, `bounds.test.mjs` alone. Push `ooda-signals`, open the PR with base `ooda-loop-inspectable`, body: what changed, the listened-hours warm-up, what the operator's review should read (`provenance.from` instead of `source`; `x-ooda.sources`), "## One-way doors\n\nNone."

### PR 2 review fixes (Fable, folded in; these win over the tasks above where they differ)

1. **Existing spike test** `test/lib/chain.mjs` ~1008-1021 seeds counts and expects "50 this hour". Seed `run/sensors/<name>/listened.json` with the same hours as `counts.json` before `mode = 'spike'`, and update its detail assertion to the new wording (the fingerprint id in parentheses, the template inside the untrusted frame).
2. **Where to mark a listened hour:** (a) at the top of `ingestEvents` (events arrived: it heard this hour), read/mark/write `listened.json` and use that map for `hours`; (b) in `pollSensorLocked` right after `const r = … await pollProbe/pollHttp`, `if (r.ok)` mark `nowIso().slice(0, 13)`, so a quiet successful hour counts. Prune beside `counts.json` (~12395) with the same cut. The spike loop is in `ingestEvents` (~12950+); goal readings' `source` is written ~7584 and read ~7669.
3. **provenanceOf:** add `owner` to `x-ooda.sources`. Owner fallback: `channel === 'chat' ? 'owner-chat' : channel === 'thread' ? 'owner-thread' : 'owner'`. `source === 'pane'` → `{ from: 'metrics', ref: 'pane' }`. `finding-ack` and `sensor-ignored` fall to their writer (say so in a comment). One table `SOURCE_FOR = { ticket: ['worker'], planner: ['planner'], supervisor: <sources minus sensor, metrics, spend>, owner: ['owner', 'owner-answer', 'owner-thread', 'owner-chat'] }` used by both `observe --source` and `provenanceOf`'s "source already in the vocabulary" rule. A supervisor hand line with `detector: 'sensor'` still reads as sensor, as `fromSensor` trusts it today (unchanged; note it).
4. **orient-noise:** `cmdDecide`: `if (cls === 'orient-noise' && !refs.some((r) => logGet(r)?.type === 'observation')) die('a noise ruling names the observations it explains: --refs <signal key> <o-…>…');`. `orientClusters`'s `linked` adds the refs of **live** decisions only (`liveDecision`, so a corrected ruling un-silences its signal). Dashboard Decide feed: no "not acted on yet" for `NO_ACT_CLASSES = ['orient-noise']` (index.html ~2032). Land the constitution JSON edit in the same commit as the first test that decides one.
5. **sensor-untriaged** excludes: a sensor no longer in settings (filter by `sensorList()` as `triageItems` does), an ignored fingerprint (`sensorIgnores()`), one cited by a live orient-noise decision, one in an open incident. Age from the oldest unhandled TRIAGE_KINDS observation on the fingerprint; severity the max. An acked finding is already handled by the ack window. Test the hand-off: with an incident it stops, and `incident-unowned` takes over after its hour.
6. **signalKeyOf** stays TRIAGE_KINDS-only; `fix-regressed`/`recurred` keep their own keys (they already ref the incident). Edit the spec's "every spike, qualify and regression" to "every qualify and spike".
7. **Tests:** for `sensor ignore`, write a `settings.sensors` probe entry and `run/sensors/<name>/fingerprints.json` by hand (or reuse chain's probe fixture). For `ack`, hand-write two observations with `source_key: metrics:<kind>:<subject>` for a finding the fixture reliably has live, then `ack`. Test the 41 → 40 cut.
8. `stageOf(act)` is always `act`, with or without `decision`.

---

## PR 3: lineage and a sidepeek for every stage

Branch `ooda-lineage` off `ooda-signals` (PR 2); base `ooda-signals` until it merges. Consumes PR 2's `SCHEMA['x-ooda']`, `stageOf(o)`, `provenanceOf(o)`, `signalKeyOf(o)`, `orientClusters()` (with `ids` and `key`), `liveDecision`.

### Task 1: `lineage(id)` in the kit

**Files:** `docs/devteam/scripts/devteam.mjs` (new `linkIndex()` and `lineage()` near `historyOf`; `peekView` adds `v.lineage`; `cmdPeek` takes `--mermaid`), `test/ooda-lineage.test.mjs` (new).

**Interfaces — produces:**
- `linkIndex()` → `{ out: Map<id, [{to, why}]>, in: Map<id, [{from, why}]> }`, built once per `readLog()` (cache keyed on the `readLog()` object, as `FP_OBS` does). Edges, each `from` the earlier step `to` the later one, `why` a short word:
  - observation → knowledge: `knowledge.evidence` contains it (`why: 'evidence'`)
  - observation → problem: `problem.refs` contains it (`'refs'`)
  - observation → decision: `decision.refs` contains it (`'refs'`; noise rulings)
  - observation → set-aside/ignore observation: its `refs` contain it (`'set aside'`)
  - observation → question: `question.evidence` (`'evidence'`)
  - knowledge|problem → decision: `decision.knowledge` (PR 4; read it if present) or `decision.refs` (`'rests on'`)
  - knowledge|problem → question: `question.evidence`/`blocks` (`'asks about'`)
  - knowledge → act: `act.knowledge` (PR 4; read if present) (`'given'`)
  - question → decision|act: `approved_by` (`'approved'`)
  - decision → act: `act.decision` (`'carried out'`)
  - act → observation: an outcome-kind observation (`stageOf === 'learn'`) whose `refs` contain the act or its decision (`'outcome'`)
  - act → ticket: `act.class === 'add-ticket'` refs (`'made'`)
  - observation → signal: `signal:<signalKeyOf(o)>` pseudo-node, for observations in an `orientClusters()` group (`'recurs'`)
  - decision|act with `corrected` → pseudo-node `correction:<id>` (`'corrected'`), stage `learn`
- `lineage(id, { up = 6, down = 4, max = 120 } = {})` → `{ nodes: [{ id, stage, type, kind, label, at, href }], edges: [{ from, to, why }], truncated }`. BFS up over `in`, down over `out`, both bounded; then collapse: siblings of one `type`+`kind` sharing one neighbour, more than 5, become one node `{ id: 'group:<neighbour>:<type>:<kind>', label: '<n> <kind> observations', members: [ids] }`. `label`: the record's short text (`what`, `statement`, `title`, `detail`), plain text, newlines to spaces, cut to 60 characters. `href`: the sidepeek hash (`#observation/<id>`, `#lesson/<id>`, `#problem/<id>`, `#decision/<id>`, `#act/<id>`, `#q/<id>`, `#signal/<key>`, `#ticket/<id>`, `#learning/<id>`), null for a correction (its call's href instead).
- `lineageMermaid(L)` → Mermaid text: `flowchart LR`, a `subgraph` per stage in order Observe, Orient, Decide, Act, Learn (empty ones left out; work-graph nodes in a final unlabelled group), node ids `n0…`, labels as `n3["<label>"]` with `"` → `#quot;`, and characters outside `[A-Za-z0-9 .,:;!?()'/+-]` dropped; `classDef` per stage; `class nK current` for the opened record.
- `peekView(...)` adds `v.lineage = lineage(id)` for any kind whose id is a log id or a signal key; `peek <kind> <id> --mermaid` prints `lineageMermaid(lineage(id))`.

- [ ] Tests first (fixture log by commands and hand lines): an incident chain — three spikes on one fingerprint (hand lines, `detector: 'sensor'`), `sensor incident` (or a hand `problem` with `refs`), `decide --class incident-fix --refs <p> <ticket>`, `ticket add --decision`, a hand `fix-deployed` and `outcome` observation citing the decision. From the first spike: down reaches the incident, decision, act, ticket and outcome. From the outcome: up reaches the spikes. From the decision: both. A noise ruling: observation → decision. Six observations on one signal collapse to one group node with 6 members; `max: 5` sets `truncated`. A label holding `"]; click x call alert(1) %%` comes out without `]`, `;`, `%`. `--mermaid` output starts `flowchart LR` and has one `subgraph` per non-empty stage.
- [ ] Implement; commit "Lineage: every OODA record's chain, both ways, bounded; Mermaid text".

### Task 2: sidepeeks for observation, signal and learning; every Loop card opens one

**Files:** `docs/devteam/dashboard/index.html` — `TYPE_META` (~2060: add `observation: ['eye', 'Observation']`, `signal: ['repeat', 'Recurring signal']`, `learning: ['trending-up', 'Learning']`), the route's sidepeek map (~3123), new `openObservation`, `openSignal`, `openLearning` (beside `openLesson` ~2876, same shape: `drawerFor`, `peekOf`, `attrs`, sections, `historySection`), `idLink` (~1030: `o-` → `#observation/`, `q-` → `#q/`), the Loop renderers (~1972-2000: `subj(...)` plus `data-open="<href>"` on every card, and one delegated click handler: a click on a card outside a link, button or input sets `location.hash`); `devteam.mjs` `peekView` for `signal` (its cluster: key, count, ids, first and latest, age, the `orient` command that would explain it) and `learning` (the record; PR 5 fills its figures).

- [ ] **Where an observation sits:** a function `loopPlace(o, data)` in index.html returning one line, from the peek's lineage (in the sidepeek) or from `DATA.ooda` (on the card): "not oriented yet" / "part of a recurring signal (n of 3)" / "explained: became a lesson|problem|incident" / "ruled noise: <why>" / "ignored at triage: <reason>" / "set aside until <time>: <reason>" / "carried on: <furthest stage reached>". The card shows it under the detail; the server adds what the card needs to `collectOoda.observations[*]` as `place: { state, ref, why }` so the card doesn't need the full index.
- [ ] Each new sidepeek: bar, attributes (an observation's provenance first: "From the g3d-stacks-logs sensor", "From your answer to …"), the place line, the lineage (Task 3), history.
- [ ] Tests (`test/dashboard.test.mjs`'s harness, which drives Chrome when `canDrive()`; follow its existing sidepeek tests): an observation card click opens `#observation/<id>` with its provenance and place; a signal opens `#signal/<key>` with a key holding `/`; `o-` ids in text are links.
- [ ] Commit "Sidepeeks for observations, recurring signals and learning; every Loop card opens".

### Task 3: draw the lineage with Mermaid, clickable, with a list fallback

**Files:** `index.html` — factor `renderMermaid`'s initialize/render/sanitize into `drawMermaid(src)` returning the sanitized SVG string (or throwing); `renderMermaid` calls it; new `lineageBlock(peek, selfId)` used by every OODA sidepeek (observation, signal, lesson, problem, decision, act, learning) after the attributes.

- [ ] `lineageBlock`: `<h3>How it came about, and what came of it</h3>`, then a container. Async: `drawMermaid(peek.lineage_mermaid)` (the server sends the text as `v.lineage_mermaid`), insert the SVG, then for each node in `peek.lineage.nodes` (index i ↔ `n<i>`), find `g.node[data-id="n<i>"]` and wrap it in `<a href="<node.href>">` with `<title>` = its label and `tabindex`; the current node gets `aria-current`. On any failure (Mermaid didn't load, render threw): the list fallback, grouped by stage in order, each item `<a href>` with its label and kind. Never show the Mermaid source. A collapsed group lists its members under it in the sidepeek.
- [ ] Redraw rule: the drawer redraws on refresh only when the lineage's node ids changed (compare a joined id string), so the graph doesn't flicker every refresh.
- [ ] Tests: with Mermaid stubbed to fail (block the CDN in the test page, as the existing Mermaid test does if any; else override `MERMAID = Promise.reject()` before opening), the fallback lists every node as a link; with it available (`canDrive()` + network), a node click opens its sidepeek.
- [ ] Commit "Lineage in every OODA sidepeek: Mermaid, clickable, with a list fallback".

### Task 4: Orientation debt (signals part)

**Files:** `devteam.mjs` `collectOoda` adds `debt: { signals: [...clusters older than a day, oldest first] }` (PR 4 adds resolved incidents); `index.html` Orient tab section "Orientation debt" above Recurring signals: each item a card that opens its signal; empty state "Nothing waiting: every recurring signal is explained or under a day old."

- [ ] Test: a cluster whose oldest item is 25 hours old (hand lines with past `at`) is in `debt.signals`; a 2-hour-old one isn't.
- [ ] Commit "Orient: orientation debt".

### Task 5: docs and PR

- [ ] `supervisor.md` §3: one paragraph on the lineage (`peek <kind> <id> --mermaid` for retros and PR bodies) and orientation debt. Merge `ooda-signals` (and main) in, full suite, push, PR with base `ooda-signals`; body says what the operator's review can read (`peek … --json`'s `lineage`, `dashboard-data`'s `ooda.debt`).

### PR 3 review fixes (Fable, folded in; these win over the tasks above)

1. **Edges by field, not by source type.** For each object `o`: for `k` of `evidence`, `refs`, `blocks`, `knowledge`: each `t` of `o[k]` that `logGet(t)` resolves is an edge `t → o` (`why` from the field: evidence `'evidence'`, refs `'about'`, blocks `'asks about'`, knowledge `'rests on'`); `o.approved_by` → `o` (`'approved'`); `o.decision` → `o` (`'carried out'`). Cited → citing is earlier → later for every field. Then the pseudo-edges (signal, correction). This covers `fix-deployed`/`recurred` (they ref the incident and ticket), knowledge evidence of any type, problems citing acts, and `worker-slots` → ticket.
2. **Work-graph and conversation nodes are leaves** (`stageOf === null`, goals included): drawn, never expanded. **Collapse key** is `(neighbour, direction, type, kind)`.
3. **Async insert vs `showDrawer`:** `LINEAGE_SVG = new Map()` keyed by the joined node ids. `lineageBlock` returns the cached, already-wrapped SVG inline when present; else a `<div data-lineage="<key>">` with the list fallback, and starts `drawMermaid`; on success it wraps the nodes in the string (build in a detached DOM, serialize), stores it, and calls `redraw()`. The list is the first paint.
4. **Labels:** `label.replace(/\s+/g, ' ').replace(/[^A-Za-z0-9 .,:!?()'/+-]/g, '').slice(0, 60)` (no `"`, `;`, `#`, `%`); empty → the id. Wrapper `<a>` built with `setAttribute('href', …)`, ids `encodeURIComponent`-ed.
5. **Select** `g.node[data-id="n<i>"]`; `n<i>` order is `lineage.nodes` order. Force the fallback in Chrome with `MERMAID = Promise.reject(new Error('blocked'))` evaluated in the page before opening. CI has no Chrome, so the CLI test also asserts the fallback's data (nodes by stage) and the `n<i>` order.
6. **Whole-card click:** one delegated handler on `[data-open]` that ignores Shift/Meta/Ctrl, non-primary buttons, `TL.pin`, clicks inside `a, button, input, select, textarea, label, [data-correct-form], .untrusted`, and a text selection; remove the incidents' per-element `onclick` (~2580) so nothing double-fires.
7. **`loopPlace` data:** `signalGroups()` returns every group (under three too) with its spread flag; `orientClusters()` is built on it. `collectOoda.observations[*].place` is computed for the 40 shown only, from `signalGroups()` and `linkIndex()`.
8. `peekView` for `signal` sets `record: null` (no `recordView` die). `linkIndex` caches on the `readLog()` object.

---

## PR 4: knowledge in decisions and prompts; what resolved incidents taught

Branch `ooda-knowledge` off `ooda-lineage`. **Adds two log fields** (`decision.knowledge`, `act.knowledge`), so it must not merge until PR 1 is released and adopted by every instance (the operator's adoption report says so; the PR body must say it too).

### Task 1: a decision cites the knowledge it rests on

**Files:** `schema/log.schema.json` (`decision.properties.knowledge`: `{ "type": "array", "items": { "type": "string", "pattern": "^(k|p)-" }, "description": "The knowledge or problems this decision rests on (decide --on); never copied into refs." }`), `devteam.mjs` `cmdDecide` (`--on <ids…>`: each must resolve to knowledge or a problem; a knowledge one must be `accepted` (a candidate or retired one is refused: "k-… is <status>: a decision rests only on accepted knowledge"); stored as `knowledge`, never added to `refs`), `orient`'s proposed `decide` commands include `--on` for the lesson or problem they came from, `index.html` decision sidepeek shows "Rests on" with links, `test/ooda-knowledge.test.mjs` (new).

- [ ] Tests: `decide --on <accepted k> --class … -- "x"` stores `knowledge`; refs unchanged; `act --decision` refs-within-decision check unaffected; a candidate, a retired lesson and an observation id are refused; lineage (PR 3) draws k → decision.
- [ ] Commit "Decisions cite the knowledge they rest on (decide --on)".

### Task 2: a start records the lessons it was given

**Files:** schema `act.properties.knowledge` (same shape, pattern `^k-`, "The accepted knowledge a worker-slots start put in the session's prompt."), `devteam.mjs` worker/planner start (~11455: `knowledge: knowledgeFor(target).map((k) => k.id)`, the same target `knowledgeBlock` used, omitted when empty), `index.html` act sidepeek "Given" list.

- [ ] Tests: a worker started with one accepted lesson in its scope logs a `worker-slots` act with `knowledge: [k]`; with none, no field; a planner's act too; `LAUNCH_ACT` parsing of `what` unchanged (the existing worker tests pass); the line stays under 4,096 bytes with 60 lessons (cap at 60 ids, newest accepted first).
- [ ] Commit "Starts record the knowledge they were given".

### Task 3: resolved incidents nobody learned from are orientation debt

**Files:** `devteam.mjs` `collectOoda.debt.incidents`: incidents (`isIncident`) with status `resolved` and an `outcome` observation citing them, not cited by any knowledge's `evidence` nor by a live `orient-noise` decision's refs, resolved in the last 30 days; `cmdOrient` prints them after the clusters: "<p-id> was fixed and verified (<title>): what did it teach? `knowledge add --kind lesson --scope … --evidence <p> <d> <outcome>` or `decide --class orient-noise --refs <p> -- \"nothing to keep\"`" (values through `shq`); the orient-noise check in `cmdDecide` also accepts a problem id; `index.html` Orientation debt lists them under the signals.
- [ ] Tests: a resolved incident with an outcome appears; a lesson with it in evidence clears it; a noise ruling citing it clears it; an unverified resolution (no outcome) doesn't appear.
- [ ] Commit "Orientation debt: what fixed incidents taught".

### Task 4: docs and PR
- [ ] `supervisor.md` §3 Decide: cite what a decision rests on with `--on`; Orient: clear incident debt. Merge, full suite, push, PR (base `ooda-lineage`), body: the adoption gate, and that the operator's review can read `decision.knowledge`, `act.knowledge` and `ooda.debt`.

---

## PR 5: the learning record and the chart

Branch `ooda-learning` off `ooda-knowledge`. **Adds two observation fields** (`figures`, `week`); same adoption gate as PR 4.

### Task 1: `learningFigures(cut)` and the weekly record

**Files:** schema `observation.properties.figures` (object: `informed: { knowledge, signals_explained, signals_formed, starts_given, starts }`, `autonomous: { trusted_calls, ladder_calls, questions, merged }`, `trusted: { agreed, answered, corrections, calls }`, all integers, each object open to keys a later kit adds) and `observation.properties.week` (`"^\\d{4}-W\\d{2}$"`); `devteam.mjs`: `logAt(cut)` (fold only lines with `at <= cut`, reusing `fold`; cached per cut), `learningFigures(cut)` computing every count from `logAt(cut)` and the week before it, `writeLearning()` called from `cmdObserveMetrics` (supervisor only): for each ISO week since the log's first line that has ended and has no observation with `source_key: learning:<week>` (checked over all observations), append `{ type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week, figures, detail: '<one sentence of the numbers>', source_key: 'learning:<week>', refs: <≤60 ids: the corrections, accepted lessons and explained signals counted> }`. Counts, not percentages, are stored; shares are computed in the view.
- [ ] Tests: a fixture log spanning three weeks (hand lines with past `at`) gets three learning records on the first `observe-metrics`, none on the second (idempotent), each with `week` and today's `at`; figures match hand-counted values for a small fixture; `dashboard-data` never writes one.
- [ ] Commit "The weekly learning record".

### Task 2: the chart at the top of the Loop, and the learning sidepeek

**Files:** `index.html` — a section above the Loop tabs: three `lineChart` charts (Informed: accepted knowledge, share of signals explained; Autonomous: share of ladder calls on trust, questions per merged ticket; Trusted: agreement, corrections per 100 calls), weekly points from `DATA.ooda.learning` (the records, oldest first), hollow when the denominator is under 5 (title "too few to say (n = …)"), marks for retros and rung changes, each point an `<a href="#learning/<id>">`. Under three records: tiles "since <date>: n calls, n lessons kept, n corrections" and "The loop needs a few weeks of calls, answers and lessons before trends mean anything." `openLearning` (PR 3's) shows the figures as a table, the counted records (recomputed by the peek: `peekView('learning')` returns the full lists from `learningFigures`), and lesson efficacy: for each lesson in `act.knowledge` of starts, the observations on the keys of its evidence in the four weeks before it was first given and since (ids and counts).
- [ ] Extend `lineChart` only if it can't take hollow points or link circles; keep its signature.
- [ ] Tests: CLI — `dashboard-data` has `ooda.learning`; peek of a learning record has the lists and efficacy rows. Chrome (when available) — the chart renders three charts; with one record, tiles.
- [ ] Commit "The Loop's learning chart, and what each week counted".

### Task 3: docs and PR
- [ ] `supervisor.md` §3: the weekly record and how to read it; `operator.md` mention for the daily review (coordinate with the upstream loop's follow-up to #190). Merge, full suite, push, PR (base `ooda-knowledge`).

### PR 4 and 5 review fixes (Fable, folded in; these win over the tasks above)

1. **Replaying the log at a cut:** `withLogAt(cut, fn)` swaps `logCache` for a fold of the lines with `at <= cut`, resets every log-derived global that isn't keyed on the `readLog()` object (grep `^let .* = null;`: `SENSOR_KEYS`, and any memo not built on `memo()`), runs `fn`, and restores them in `finally`. `fold` is one pass; no checkpoints. `mergedAt` reads git commit dates, which replay as they are.
2. **Adoption gate, operational:** PR 4's and PR 5's bodies list every instance from the hub's `/instances.json` with its `upstream_base`, and say they merge only when each is at or past PR 1's release. Workers never write `decision` or `worker-slots` lines, so a stale worktree doesn't matter; only a whole instance on an older kit does.
3. **`decide --on`:** a separate field from `approved_by`; `authorise` never reads it. Paste the reviewed check (each id resolves to knowledge or a problem; knowledge must be accepted; an id in both `--refs` and `--on` is refused); `knowledge: on.length ? on : undefined`. Test: `--on <owner standing rule>` leaves `authority` unchanged.
4. **`worker-slots.knowledge` only on a fresh start** (the final `resume` value false): a resumed session never reads the new prompt. `knowledgeFor(id)` sorted by `created_at` desc, first 60 ids.
5. **Figures, exactly** (ISO weeks, UTC; "in W" = the named time falls in W):
   - `informed.knowledge`: knowledge with `status === 'accepted'` at the cut.
   - `informed.signals_formed` / `signals_explained`: `signalGroups()` groups of 3+ at the cut before the explained exclusion; explained = any member cited by `knowledge.evidence`, `problem.refs` or a live decision's `refs`.
   - `informed.starts` / `starts_given`: `worker-slots` acts created in W whose `what` starts `made `; given = `knowledge?.length > 0`.
   - `autonomous.ladder_calls`: `calls()` created in W whose class is in `ladder().classes`; `trusted_calls`: of those, authority `rung` or `standing-rule` (a defaulted question counts as asked).
   - `autonomous.questions`: questions created in W of kinds `owner-decision`, `one-way-door`, `proposal`, `trust`, `clarification` (not `owner-action`, `review`, `goal-definition`, `goal-approval`); check the schema's question `kind` enum and use exactly its decision kinds.
   - `autonomous.merged`: tickets whose `mergedAt` falls in W.
   - `trusted.answered` / `agreed`: answered questions with `answered_at` in W and a `recommendation` (`trustEvidence`'s filter); agreed = `matched`.
   - `trusted.calls`: `calls()` created in W; `corrections`: `correctionOf(c).at` in W.
   - Hollow when the line's denominator is under 5: `ladder_calls`, `questions`, `answered`, `calls`, `signals_formed`, `starts`.
6. **`lineChart`:** extend compatibly. A point may be `[ts, v, { hollow, href, title }]` (hollow: `fill="none"` with a stroke; href: wrapped in `<a>`), and a new option `xmarks: [{ at, label }]` draws vertical dashed lines. Don't mix a count and a share on one chart: six small charts, two per column (Informed: accepted knowledge; share of signals explained. Autonomous: share of ladder calls on trust; questions per merged ticket. Trusted: agreement; corrections per 100 calls).
7. **Incident debt:** an outcome citing it = `refs.includes(p.id)`; resolution time = the last `updates` entry setting `status: 'resolved'`; exclude an incident whose status the owner set (`ownerHolds(p, 'status')`); 30 days from resolution; a live noise decision clears it, so a corrected one re-lists it.
8. Backfill starts at the week of the log's earliest `at` and skips the current week; the `source_key` check scans all observations. `detail` is cut to 300 characters. There are no `decide` commands in `orient`'s output today: the `--on` hint goes in the debt line's suggested `knowledge add` and in the decision sidepeek. Hand-written test lines go in time order. Keep CLI assertions on `ooda.learning`'s shape and the under-three tile rule, since CI has no Chrome.
9. **PR 5 review fixes, second round** (these win over items 5 and 8 and Task 1): `signals_explained` also counts a signal a live noise ruling covers (`covered()`), as Orient does. The record's `refs` are trimmed from the end until the line fits `LINE_MAX` (writer names are unbounded), so the corrections, first, survive. The back-fill reaches back at most `LEARN_BACKFILL_WEEKS` (104, two years), and runs under a lock in `run/` (`withLock`), reading the log afresh, so two passes at once don't both write a week; the dashboard keeps the earliest record per week anyway. A week counts as written only by the supervisor's own record (`created_by` supervisor, `detector` metrics), as the dashboard shows it: an owner's or hand line with the `source_key` doesn't hold it. The schema's `figures` objects keep `required` and integer types but no `additionalProperties: false`, so a later kit can add a count (spec §8); the dashboard leaves out a record whose three columns aren't objects. Questions per merged ticket is hollow on its merges (`merged` under 5; "no ticket merged" at none).
