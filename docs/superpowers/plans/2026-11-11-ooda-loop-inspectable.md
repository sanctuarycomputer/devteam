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
