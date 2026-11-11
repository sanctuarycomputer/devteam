# Operator harvest and daily review: implementation plan

**Goal:** the box's operator harvests what each repo's supervisor learned and judges, once a day, whether each supervisor works like an autonomous team steered by its strategy; a supervisor can tag a lesson as a likely kit lesson; an owner's ruling never becomes the kit's default without the owner's OK; and the supervisor is told to propose what the project needs, through the flows it already has.

**Spec:** `docs/superpowers/specs/2026-11-11-operator-harvest-and-review-design.md`. Read it first.

## Global constraints

- Node 18+ built-ins only; dense single-file style; comments say why. No new files except this plan, the spec and the test file.
- Tests: `ASDF_RUBY_VERSION=3.1.7 ~/.asdf/installs/nodejs/24.14.1/bin/node --test test/<file>`, one file at a time, with the private `TMUX_TMPDIR` that `test/lib/kit.mjs` sets. Never touch real instances, their panes or logs, or ports 4320-4345.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never rebase or force-push.
- The operator stays out of the chain: every change on its side is a read, a note, a `box-tell`, an upstream PR or words to the owner.

## Files

| File | Change |
|---|---|
| `docs/devteam/schema/log.schema.json` | `knowledge.kit_lesson` (boolean); `x-authority.set.knowledge.supervisor` gains it |
| `docs/devteam/scripts/devteam.mjs` | integrity rule; fold rule; `knowledge add/set --kit`, `knowledge --kit`, list marks; `OPERATOR_READS` + `OPERATOR_SUBCOMMANDED`; `machine status` review line, `new-knowledge=`, `--knowledge`; help text |
| `docs/devteam/process/operator.md` | reads list; "The daily review" section; draft-PR rule for owner rulings |
| `docs/devteam/process/supervisor.md` | §3 step 4 pointer; §9 "Propose what the project needs"; §9 Share upstream: the tag |
| `README.md` | one sentence on the operator's daily review where the operator is described |
| `test/kit-lessons.test.mjs` (new) | the tag's command, integrity, fold and prompt checks |
| `test/machine.test.mjs` | operator reads; `box-status` review line, `new-knowledge=`, `--knowledge` |

## Tasks

### 1. The tag (schema, integrity, fold, command)

1. Test first (`test/kit-lessons.test.mjs`, on `monoFixture`): supervisor `knowledge add … --kit` → `knowledge --json` has `kit_lesson: true`; `knowledge set <id> --kit off` → false; `knowledge --kit` lists only tagged; text list shows `, kit lesson`; `knowledge set <owner-rule> --kit` refused; a hand-written supervisor set line `kit_lesson: true` on the owner's entry is ignored by the fold (`log-check` lists it as ignored, `knowledge --json` shows no tag); a hand-written owner line carrying `kit_lesson` fails `log-check` and doesn't count; `knowledge --for <target>` output identical with and without the tag.
2. Schema: add the property with its description; add `kit_lesson` to `x-authority.set.knowledge.supervisor`.
3. `integrity`: `if (o.type === 'knowledge' && 'kit_lesson' in o && cls !== 'supervisor') return 'kit_lesson is the supervisor's tag on its own knowledge'`.
4. `fold`: on a set line touching `kit_lesson` where `obj.created_by !== 'supervisor'`, drop that field (ignored with why if nothing else changed).
5. `cmdKnowledge`: `--kit` on add (supervisor only) and set (refuse unless created by the supervisor and the writer is the supervisor; parse `on|yes|true` / `off|no|false`); list filter `--kit`; list marks `, owner's` and `, kit lesson`.
6. Run the file; commit.

### 2. Operator reads

1. Test first (`test/machine.test.mjs`): the "writes nothing" test runs `trust`, `trust --json`, `sensor status`, `sensor status --json`, `problem`, `problem --json --all`; the "looks, and nothing else" test refuses `problem add`, `problem set`, `sensor poll`, `sensor test x`, `sensor ignore x`.
2. `OPERATOR_READS` += `trust`, `problem`, `sensor status`; `OPERATOR_SUBCOMMANDED` += `problem`, `sensor`.
3. Run; commit.

### 3. box-status: review due, new knowledge, `--knowledge`

1. Test first (in the existing status test, which already passes `--notes`): no `## Review` heading → `machine: daily review due (last never)`; today's heading → `done`; repo line ends `new-questions=1 new-knowledge=<n>`; `--knowledge` lists accepted entries not in the notes with marks; an id written in the notes is skipped.
2. `machineStatus`: the review line after the hub line when `--notes` is given; per repo `knowledge --status accepted --json` through `projectJson`; `new-knowledge=`.
3. `machineKnowledge()` for `--knowledge`; `cmdMachine` dispatch; usage string.
4. Run; commit.

### 4. Docs

1. `operator.md`: kit reads list; "The daily review" (harvest, verdicts, the owner's-ruling draft rule, the four judgements table, tell/PR/escalate, the record format); "What could work better" points at it.
2. `supervisor.md`: §3 step 4 one clause; §9 new bullet after Propose; §9 Share upstream tag sentence.
3. `README.md`: the operator paragraph gains the daily review.
4. Commit.

### 5. PR

Full runs of the touched test files; push; open the PR (What / Why / Tested / Migration); Fable review; fold in; CI green.
