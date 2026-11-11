# The OODA loop you can inspect: five stages, sources, lineage, and whether it's getting smarter

Date: 2026-11-11. Builds on `process/supervisor.md` §3 (Observe, Orient, Decide, Act; sensors), `governance/constitution.md` §2 (the trust ladder) and §4 (one-way doors), and the dashboard's sidepeeks (`2026-11-05-hub-tabs-design.md`, `2026-11-10-supervisor-threads-design.md`).

The owner asked for it, looking at Stacks: "I can't click to show an observation, orientation (knowledge), decision, action, learning in a sidepeek", and "I can't see clearly if an observation is being actioned autonomously … How can I inspect what the system is doing as a result?" of a `g3d-stacks-logs` spike. Then: "for any of the OODA objects … open any one of those objects and see a Mermaid chart that shows how that action was decided, how that decision was oriented, and how that orientation was an outcome of observations and learnings." "Observations are really just things that we escalate to knowledge. They're not triggers necessarily … only once they're elevated to knowledge. That knowledge is then actioned into a decision and that decision is then made into an action … we're not short-circuiting the OODA loop … this loop is how this system gets progressively more autonomous." And: "is there a way to visualize how 'smart' / 'autonomous' / 'trusted' the system is getting over time? … an overarching chart … at the top of the Loop section."

## What we found on Stacks

Four `spike` observations at 2026-11-11T14:34:35Z, one per log fingerprint, with identical text ("a log line is spiking: 20 this hour against a median of 0") and `refs: []`. Nothing came of them: no ignore, no incident, no decision. They were false: the spike check in `ingestEvents` (`devteam.mjs` ~12862) fills hours the stream wasn't listening (the box was down 03Z–13Z) with 0, so the median was 0 and a normal hour (the line runs 8–28 an hour) passed `max(spike.min, factor × 0)`. And they could never reach Orient: a spike's `source_key` carries its hour, and `orientClusters` groups on `source_key`, so no two spikes ever share a key. The loop was blind to them twice, and the dashboard had no way to show it.

## Goal

The owner clicks anything in the Loop (an observation, a recurring signal, a lesson, a problem, a decision, an act, an outcome) and a sidepeek opens with a Mermaid graph: on the left what it came from, on the right what came of it, in five columns, Observe → Orient → Decide → Act → Learn. Every box opens its own sidepeek. Each observation says in a line where it sits in the loop. At the top of the Loop, three small charts show, week by week, whether the system is getting better informed, more autonomous and more trusted, and each point opens the record that holds its numbers.

## Decisions (the owner's)

1. **Five stages: Observation, Knowledge, Decision, Act, Learning.** Everything else is a kind. Problems and incidents are knowledge: "a problem feels more formed than the observation that indicated there may be a problem." This spec makes them the stages everything is shown, explained and walked by, while the stored record types stay as they are (next section): the owner's call to confirm on review.
2. **No short-circuit.** Observations aren't triggers. A recurring one is escalated to knowledge, knowledge is acted on through a decision, a decision is carried out by acts. An urgent incident is a fast path through Orient, not around it.
3. **Every observation records its source.** Sensors, spend, the owner's answers and words, retros, workers, the supervisor, the kit's own checks.
4. **Sensor → reading → observation.** A sensor takes readings; a reading is escalated to an observation only when there's cause for action; the observation records where it came from.
5. **Mermaid** draws the lineage, for now.
6. **Rollout is a kit upgrade.** It's a migration of the kit's internals: every instance adopts it without being asked per project.

## Where the five stages live

The five stages are the model the owner sees, the process speaks and the dashboard draws. They are not five storage types. The log keeps the record shapes that enforce who may say what, and the schema maps each type and kind to its stage.

Why not collapse storage (verified in review against the code):
- The schema can't shrink. `parseLines` drops any line whose type isn't in the schema and `log-check` validates every line ever written, so `problem` and `question`, their id prefixes and their authority rows stay defined forever. A storage collapse means five new types *plus* every old one.
- The authority table is per type. The owner's answer beats a later default, and the owner's correction is immune to the supervisor, because `question` (the owner's fields), `decision` (the supervisor's) and the `corrected` set (the owner's, by rank) are different records with different writers. Merging them needs a per-kind authority system to get back what the types already give.
- `problem` and `knowledge` share no lifecycle (open → resolved against candidate → accepted → retired), and the 28 places that read incidents, plus every knowledge reader (prompts, standing rules), would have to learn to tell them apart.

So: one map in the schema, `x-ooda`, read by the views (the fold has no reason to know stages), the dashboard, the process and the lineage. Storage changes are additive only (a new field, a new optional value, a new class), which `constitution.md` §4 says is not a one-way door.

| Stage | What's in it (stored as) |
|---|---|
| **Observe** | observations that call for attention: sensor escalations, findings from the kit's own checks, what workers, planners and the supervisor notice, what's derived from the owner's words (`observation`, every kind but the ones below) |
| **Orient** | knowledge: fact, lesson, preference, constraint, pointer (`knowledge`); problems, risks and incidents (`problem`); recurring signals (computed); orientation debt (computed, below) |
| **Decide** | the supervisor's decisions (`decision`); the owner's answers to trust-ladder questions (`question`, answered, class on the ladder); noise rulings, set-asides and triage ignores |
| **Act** | every `act`. One that was its own call (no `decision`) is still an Act node in the lineage; the Decide feed lists it with its authority, as today |
| **Learn** | corrections (the owner's `corrected` on a decision or act); outcomes: `outcome`, `fix-deployed`, `fix-regressed`, `recurred`, a trial's outcome (`observation` kinds); the weekly `learning` record |

Outside the loop, and drawn in a lineage graph only as the thing a record is about: the work graph (`goal`, `feature`, `ticket`, `phase`), conversation (`message`, `thread`, `turn`), and measurement (`spend`, `gate`, daily rollups and goal readings: readings, §1). Questions that aren't ladder calls (an owner action such as posting a secret, a goal interview, a review, a governance edit with its diff) are Inbox requests; once answered they show in Decide as the owner's call, as today.

`x-ooda`, in the schema beside `x-id` and `x-authority`:

```json
{ "stages": { "observation": { "kind": { "reading": "measurement", "learning": "learn", "outcome": "learn", "fix-deployed": "learn", "fix-regressed": "learn", "recurred": "learn", "finding-ack": "decide", "sensor-ignored": "decide", "*": "observe" } },
              "knowledge": "orient", "problem": "orient", "decision": "decide", "act": "act", "question": "inbox", "spend": "measurement", "gate": "measurement" },
  "sources": ["sensor", "metrics", "spend", "owner-answer", "owner-thread", "owner-chat", "retro", "worker", "planner", "supervisor"] }
```

Each record has exactly one stage. A question is an Inbox node: an answered question in a ladder class is drawn in Decide as the owner's call; any other question is drawn outside the columns, only where a decision rests on it (`approved_by`).

## Design

### 1. Sensors, readings, observations

One model, for production and for the kit's own checks:

- **A sensor takes readings.** Production sensors (URL checks, probes, streams) as today. The kit's own sensors: `metrics` (the findings pass), the spend meter (`observe-spend`), the gate runner, a goal's measure.
- **A reading is a measurement.** Samples, hourly counts and raw events stay local (`run/sensors/<name>/`). Durable readings go to the log: daily rollups (`observation` kind `reading`), goal readings (kind `reading` with `measure`), `spend` lines, `gate` lines. A reading is never an observation for Orient: `orientClusters` skips it (it already skips `reading`), the Observe feed doesn't list it, and the dashboard shows readings under Health and on charts.
- **An observation is a reading escalated** because there's cause for action: a fingerprint qualifying for triage, a spike, a URL going down, a finding (flaky gate, stale worker, cost hotspot). The escalation rules are the ones `sensor poll` and `observeFindings` already apply; nothing new escalates.
- **Recurring signals** are Orient's: three or more observations on one recurrence key that nothing has explained yet. They are computed, not stored, and get a stable address: `signal:<key>`.

The key Orient groups on, fixed so sensor observations recur:
- a sensor observation: its fingerprint (`<sensor>:<kind>:<fingerprint>`, as `fpIdOfObservation` already derives), so every spike, qualify and regression on one fingerprint is one signal
- a finding: `metrics:<kind>:<subject>` (its `source_key` today)
- anything else: `source_key`, else `kind:subject`

Fixes to the spike check:
- **Listened hours.** Every sensor records the hours in which it ran or listened (`listened` in its `counts.json`, set on each successful run or drain). The spike check's median is over those hours only, and a spike needs 24 of them. A probe on a box that was down has the same gap a stream has.
- **Say which line.** A spike's detail names the fingerprint's class or code and its id; a log template goes inside the untrusted-data frame, as `log-error` does. The days count is `floor(hours / 24)`, never "0 day(s)".
- **Untriaged escalations.** A new finding `sensor-untriaged`, per fingerprint: an observation of severity 3 or more from a sensor, older than `triage_overdue_hours` (default 2) while the supervisor runs, with no incident, ignore or noise ruling. Today `incident-unowned` needs an incident to exist first.

### 2. Provenance

Observation already carries `source`, `detector`, `source_key`, `source_ref` and `subject`. Reconcile them; add no field.

- `source`: where it came from. It stays a string in the schema (history holds `ticket`, `owner`, `ack`, `repo`, `prod` and sensor names, and `log-check` validates every line ever written), and is not required (an older worktree's `observe` lines must still sync). The kit's writers set one of `x-ooda.sources`: `sensor`, `metrics`, `spend`, `owner-answer`, `owner-thread`, `owner-chat`, `retro`, `worker`, `planner`, `supervisor`; `observe` refuses any other value from the command line, as it refuses `--detector sensor` today. A ticket's writer is `worker`, a plan's `planner`.
- `source_ref`: which one within that source: the sensor's name, the finding's kind, the question, thread or turn id, the retro's file, the fingerprint.
- `source_key`: the recurrence key (unchanged meaning).
- `subject`: what it is about (unchanged).
- `detector`: retired; no new line writes it. The views read any line through one function, `sourceOf(o)`: `detector: "sensor"` → `sensor` with the old `source` as `source_ref`; `detector: "metrics"` → `metrics`; `ack` → `supervisor`; `repo`, `prod` or `owner` on a goal reading → `sensor` with `source_ref: goal-measure`; any other or missing value → by its writer (`owner`, `supervisor`, a ticket → `worker`, a plan → `planner`).

Each writer sets it: `sensorObserveOnce` (sensor), `observeFindings` (metrics), the cost-hotspot finding (spend), `answer` and `thread resolve` observations (owner-answer, owner-thread), chat-derived observations (owner-chat), the retro (retro), `observe` by its writer. The sidepeek shows it first: "From the g3d-stacks-logs sensor", "From your answer to …".

### 3. The links the loop needs

Additive fields and refs, so a lineage walk finds every step:

- **A decision cites the knowledge it rests on:** `decision.knowledge: [k-…, p-…]`, set by `decide --on <id>…`; the ids are never copied into `refs`, so `act`'s refs-within-the-decision check is unchanged. `orient`'s proposed commands include it. A decision citing a retired lesson is refused.
- **A worker or planner start records what it was given:** the `worker-slots` act gains `knowledge: [k-…]`, the ids `knowledgeBlock` put in its prompt, as a field (never in `what`, which `LAUNCH_ACT` parses). The act is the same class for both roles; a planner's is counted apart from a worker's. This is what makes a lesson's effect measurable (§6).
- **A noise ruling is a decision:** `decide --class orient-noise --refs <signal key> <observation ids…> -- "<why>"`, a new constitutional class (the supervisor's own call: the owner can correct it, and a correction is recorded and drawn in Learn, but like every constitutional class it moves no rung). `orientClusters` treats ids cited by a decision as explained, as it does knowledge evidence and problem refs. Today "say so in an observation" silences nothing.
- **A set-aside cites what it sets aside:** `ack` writes `refs` to the finding's observations. A triage ignore (`sensor ignore`) writes `refs` to the fingerprint's observations. Both stay stored as they are and sit in Decide. Each carries at most the 40 most recent observation ids (a line is at most 4,096 bytes); the fingerprint or finding key stays in `source_ref`, and the lineage joins the rest by key.
- **A resolved incident asks what it taught.** An incident resolved with an `outcome` and no knowledge citing it is orientation debt: `orient` lists it beside the recurring signals ("p-… was fixed and verified: what did it teach? a lesson, or nothing to keep"). The supervisor answers with `knowledge add --evidence <p-id> <d-id> <outcome id>` or a noise ruling. This is how a fast fix still turns into knowledge.

### 4. Lineage

The kit computes it, the dashboard draws it.

- `lineage(id)` in `devteam.mjs`, over one reverse index of the folded log (replacing the ad-hoc ones in `orientClusters`, `orientLinks` and `historyOf`). An explicit edge list per type, never a generic string walk:
  - observation ← cited by: knowledge `evidence`, problem `refs`, decision `refs` (noise), a set-aside or ignore `refs`, question `evidence`; joined to a recurring signal by its key
  - knowledge and problem → decision `knowledge` and `refs`, question `evidence` and `blocks`, `worker-slots` act `knowledge`
  - decision → its acts (`act.decision`), the question it rests on (`approved_by`, that one question only), its correction
  - act → the outcome observations that cite it, the ticket it made (a work-graph node)
  - a correction is a Learn node on the call it corrects
- **Bounds:** upstream to the roots (at most 6 hops), downstream 4 hops, at most 120 nodes. More than five siblings of one kind on one key collapse into one node ("23 observations on sensor:g3d-stacks-logs:log:1a2b…"), which the sidepeek lists in full.
- **Served** in `/api/peek` as `lineage: { nodes: [{id, stage, type, kind, label, at, href}], edges: [{from, to, why}], truncated }`. Labels are the record's own short text, cut to 60 characters and stripped to plain text before they reach Mermaid.
- **CLI:** `devteam.mjs peek <kind> <id> --mermaid` prints the same graph as Mermaid text, for retros, PR bodies and the supervisor.

Drawing it, with the Mermaid the dashboard already lazy-loads (`renderMermaid`, `mermaid@11.4.1`, strict security, DOMPurify, dark theme):
- `flowchart LR`, one subgraph per stage in order, a `classDef` per stage, the open record with a thicker stroke.
- Node ids are generated (`n0`, `n1`, …), never record ids, so no record text reaches Mermaid's syntax except as a quoted, escaped label.
- Strict mode turns off Mermaid's own `click`. The graph is drawn by the same initialize-render-sanitize path as `renderMermaid`, factored out as `drawMermaid(src)` (today's `renderMermaid` only renders `pre > code.language-mermaid` in a markdown root). After render, the dashboard finds each node by its `data-id` (the generated `nN`; Mermaid 11.4.1 sets `data-id` on each node's `<g>`, while its `id` carries a render counter) and wraps it in `<a href="#…">` to its sidepeek, with a focus ring and a title.
- **Offline or blocked:** when Mermaid can't load, the sidepeek shows the same graph as a list, grouped by stage, every item a link. Never the raw Mermaid source.

### 5. A sidepeek for every stage

- New sidepeeks: **observation** (`#observation/<id>`), **recurring signal** (`#signal/<key>`), **learning** (`#learning/<id>`). Existing: knowledge (`#lesson/`), problem, decision, act. Server-side, `peek observation <id>` already works through `peekView`'s generic branch; `signal` and `learning` get their own. `observation`, `signal` and `learning` join `TYPE_META` and the route's sidepeek map. A signal key holds `:` and may hold `/` (a finding's subject); the route joins the rest of the hash and `/api/peek` accepts it.
- Every Loop card opens its sidepeek when clicked anywhere on it, not only on its timestamp. `idLink` links `o-` and `q-` ids in text.
- Each sidepeek: the bar, the attributes (source first for an observation), **where it sits in the loop** (below), the lineage graph, then its history.
- **Where an observation sits**, one line on its card and in its sidepeek:
  - not oriented yet
  - part of a recurring signal (2 of 3)
  - explained: became a lesson, a problem or an incident
  - ruled noise, with the reason
  - ignored at triage, with the reason; set aside until <time>, with the reason
  - carried on: lesson → decision → act → outcome (the furthest step reached)
- A recurring signal's sidepeek lists its observations, how long it has been unexplained, and the command the supervisor would run to explain it (as `orient` prints).
- Orient's tab gains **Orientation debt**: recurring signals unexplained for more than a day, and resolved incidents nobody learned from.

### 6. Is the loop making the system smarter?

**The weekly learning record.** Every Monday (UTC) the metrics pass writes one observation, `source: metrics`, `kind: learning`, `subject: project`, `source_key: learning:<yyyy-Www>`, with the week's figures in a new field `figures` and `refs` to the records counted (capped to fit a line; the sidepeek recomputes the full list from the log as it stood at the week's end). It has an id, a sidepeek, history and lineage like anything else. On first run after the upgrade the kit back-fills one per past week since the log began. Records can't be back-dated (`appendLog` stamps `at` now, and `merge` refuses a line older than the one before it), so a back-filled record carries today's `at` and its week in `week`, and its figures come from folding only the lines with `at` on or before the week's end. Before writing, the pass looks for `source_key: learning:<week>` among all observations (not the sensor index), so it is idempotent. Only `observe-metrics` (the supervisor's) writes them; reading the dashboard never does. `refs` carries at most 60 ids.

**The figures** (each from the log as it is, or from §3's new links):

| | Figure | From |
|---|---|---|
| **Informed** | accepted knowledge in force at the week's end | knowledge status over time |
| | share of recurring signals explained, of those formed | `orientClusters` replayed at the week's cut, plus §3's explained ids |
| | share of started tickets given at least one lesson (planners counted apart) | §3's `worker-slots.knowledge` (from the upgrade on) |
| **Autonomous** | share of ladder-class calls made on trust (rung 3), not asked | decisions' `authority`, acts' derived authority |
| | owner questions asked per merged ticket | questions, merges |
| **Trusted** | the owner's agreement with recommendations | `trustEvidence` (the last `agreement_window` answers) |
| | corrections per 100 calls | `correctionOf`, `calls()` |
| | rung per class | `rungHistory` (already on the dashboard) |

Its sidepeek also lists **lesson efficacy**: for each lesson given to at least one worker, the observations on the keys in its evidence in the four weeks before it was first given and in the weeks after. A list with counts and ids, not a percentage: the numbers are small, and the owner should see which lesson and which signal.

**The chart, at the top of the Loop.** Three small charts in a row, Informed, Autonomous, Trusted, each with its lines (the trust ladder's rungs stay in their own table). Three, never one composite: a correction in one class must show as a dip, not be averaged away by a promotion in another.
- Weekly points, drawn with the dashboard's own `lineChart` (no Mermaid). Retros and rung changes are vertical marks, so cause sits next to effect.
- A point whose denominator is under 5 is hollow, titled "too few to say (n = 2)".
- Every point links to its week's `learning` sidepeek; a rung point to the answer or correction that moved it.
- **A young instance** (under three weekly records) shows tiles instead of lines: "since <date>: n calls, n lessons kept, n corrections. The loop needs a few weeks of calls, answers and lessons before trends mean anything."

### 7. The process

`supervisor.md` §3 speaks the five stages and the reading/observation split; step 4's "noise (say so in an observation)" becomes the `orient-noise` decision; Orient also clears orientation debt; `decide` cites the knowledge it rests on with `--on`. `constitution.md` §2 lists `orient-noise` as constitutional. The schema's description, `x-ooda`, and each new field carry their words for the sidepeek tooltips.

### 8. Rollout

This is an additive change to the kit's internals: new fields, new optional values, one new constitutional class, a schema map, no record type added or removed. `constitution.md` §4 says an additive change is not a one-way door. The owner's approval of this spec, upstream, is the approval: `process/` and `governance/` edits here are the upstream owner's `process-edit` and `governance-edit`, and every instance adopts them through `chore-devteam-sync` under `upstream_sync: "adopt"` (the default) with no question in the project. An instance whose owner set `upstream_sync: "ask"` asks, by its owner's own choice.

**Mixed kits.** Readers already tolerate an unknown field: `readLog` skips the schema walk. What rejects it is full validation (`checkLine`, every type `additionalProperties: false`) in `log-check`, `log-sync` (which skips a whole file on its first invalid line), and `merge`'s and `check-ticket`'s log rules; a type not in the schema is dropped in both modes. That matters wherever a worktree still carries an older `devteam.mjs`. So the first release splits `checkLine`'s errors in two: `errors`, and `unknown` (a field the schema doesn't know, or a type not in `TYPES`). `parseLines` keeps a line with only `unknown` and reports it; `log-check` prints "written by a newer kit: upgrade" and passes; `log-sync` syncs the file; `merge`'s and `check-ticket`'s log rules fail only on `errors`. An unknown field grants nothing, because nothing reads it; an unknown type creates no object. Nothing checks that every instance adopted it first: a straggler's `log-sync` warns and skips the file until it adopts, and nothing in `run/log` is lost.

## PRs, in order (each leaves every instance working)

1. **Reader tolerance** (§8). Small. Adopted fleet-wide before anything writes a new field.
2. **Signals the loop can see** (§1, §2, §3's set-aside and ignore refs, noise rulings, orientation debt): listened hours, spike detail, `sensor-untriaged`, the fingerprint key, `source` provenance and the `detector` alias, `orient-noise`, `x-ooda`.
3. **Lineage and sidepeeks** (§4, §5): `lineage()`, `/api/peek`'s `lineage`, `--mermaid`, the observation, signal and learning sidepeeks, clickable cards, where-it-sits lines.
4. **Knowledge in decisions and prompts** (§3's `decision.knowledge` and `worker-slots.knowledge`, resolved-incident debt).
5. **The learning record and the chart** (§6), with back-fill. Lesson efficacy starts filling in from PR 4's records.

## Testing

- Spike: a stream with a 10-hour listening gap and a normal hour after it raises nothing; a real 5× hour over 24 listened hours raises one spike naming the fingerprint; "1 day(s)" at 24–47 hours.
- Orient: four spikes and a qualify on one fingerprint form one recurring signal; a noise ruling citing them clears it; `decide --on` a retired lesson is refused; a set-aside's refs stop at 40; an ack's and an ignore's refs name the observations.
- Provenance: every writer sets `source`; `sourceOf` maps old `detector`, `ack`, `repo`, `prod`, `owner` and missing values; `log-check` passes on a historical log with free-text `source`; `observe --source <other>` is refused.
- Reader tolerance: `log-check` on a log with an unknown field and an unknown type lists both and passes; `log-sync` syncs a file whose lines carry a field it doesn't know; `merge` refuses a PR that adds one.
- Lineage: an incident chain (observations → incident → incident-fix decision → add-ticket act → fix-deployed → outcome) walks both ways from every node; collapse above five siblings; the 120-node cap sets `truncated`; labels with Mermaid syntax characters render as text; `--mermaid` output parses.
- Dashboard (the existing `dashboard.test.mjs` harness): every Loop card opens its sidepeek; a Mermaid node found by `data-id` opens the right one; a signal key with `/` routes; with Mermaid blocked the list fallback renders.
- Learning: back-fill writes one record per past week, idempotently, each with `week` and today's `at`; `/api/data` never writes one; the figures for a fixture log match hand-computed values; under 5 is hollow; under three records shows tiles.
- Node 24 locally, CI for the rest.

## Non-goals

- **No storage collapse** of `question` into `decision` or `problem` into `knowledge` (see "Where the five stages live"). If the owner later wants stored types to match, it starts from `x-ooda` and needs its own design.
- **No Learning record type.** Corrections stay the owner's field on the call; outcomes stay observation kinds mapped to Learn. A `learning` type for outcomes can come later if the view proves it's needed.
- **No new escalation rules.** What becomes an observation is unchanged, except `sensor-untriaged`.
- **No composite score.**
- **No change to the trust ladder's rules.** Orient-noise is constitutional: correctable, no rung effect. Every ladder class keeps its start, ceiling and drops.
- **Lists, not scores,** for orientation debt and lesson efficacy in their first version.
