# The operator's daily review: harvesting what supervisors learn, and judging how they work

Date: 2026-11-11. Builds on `docs/devteam/process/operator.md` (the box's operator), `process/supervisor.md` §3 (the tick), §9 (improvement) and §10 (retros), `governance/constitution.md` §1 and §2, and the log's authority table (`schema/log.schema.json`, `x-authority`). The plan is `docs/superpowers/plans/2026-11-11-operator-harvest-and-review.md`.

## The owner's goal

> "the goal is that we have a recursively self improving, progressively more autonomous supervisor for each codebase. Eventually, the supervisor should be observing errors, logs, performance, seeing opportunities for better and more performant code, and suggesting improvements and new features to the system that improve upon the strategy of the system at large. The operator is partly tasked with the meta of that: noticing when the supervisor is not working toward the ultimate goal of being an autonomous development team, and suggesting tweaks to devteam itself so we can inch closer to that goal via our strategy, goals, tasks, and OODA loop."

The owner approved this direction: the operator turns friction it notices into upstream PRs, but nobody harvests what the supervisors learn. Three parts: a daily pass by the operator over each repo's accepted knowledge, standing rules and retros; a way for a supervisor to tag a lesson as a likely kit lesson; and one guardrail, that an owner's standing rule for one project is their ruling for that project, so promoting it to the kit's default waits for the owner's OK.

## What exists today

Read before designing, so nothing here repeats it.

- **Operator.** A 30-minute check-in (`cloud/Dockerfile` types "Check on the box and your supervisors." into window 0). It reads `box-status`, open questions it hasn't noted (`box-status --questions`, noted by id in `~/operator/NOTES.md`), and flagged panes. "What could work better" turns a friction seen in two check-ins or two supervisors into an upstream PR, at most 3 open. It may run a fixed list of kit reads in a repo (`OPERATOR_READS`): `status`, `ready`, `metrics`, `hello`, `settings`, `supervisor-session`, `prompt`, `validate`, `questions`, `next`, `log`, `messages`, `knowledge` (list only), `goal` (list and show), `fleet status`. `trust`, `sensor status` and `problem` are not on it.
- **Knowledge.** `knowledge add|set|list` (`cmdKnowledge`). Kinds fact, lesson, preference, constraint, pointer; scope; status candidate, accepted, stale, retired; evidence. The owner's standing rule (`answer … --rule`) is a knowledge line of kind `preference`, written by the owner, status accepted, evidence the question. The owner's `owner_note` refines a lesson. The fold keeps each field at the rank of whoever last set it.
- **Supervisor improvement.** The tick observes (metrics, sensors, triage, incidents), orients (recurring signals become lessons or problems, `goal-unjudged`, ratings), decides and acts. §9: measure, find (retros, research spikes, architecture re-read, upstream releases), propose (trial within authority, else a `proposal` question; "roadmap and architecture suggestions don't wait for a retro"), outcome, share upstream (`upstream-pr`, rung 1 to start). `strategy-unwritten` and `goal impact` tie goals to the strategy; `new-feature` is a ladder class for a feature the owner never asked for; `planning.md` §1 has a stake-3 "should we build this at all?" question for a goal that serves no strategy line.
- **What's missing.** Nothing reads accepted knowledge across repos. Nothing marks a lesson as general. Nothing says an owner's rule needs the owner's OK before it becomes every project's default. Nothing judges a supervisor against the goal of an autonomous team, and the operator can't read three of the things that would show it (`trust`, `sensor status`, `problem`). On the supervisor side, §9 covers proposing improvements to how the fleet works and paths to an existing goal, but not proposing *new* work the project needs from what production and the code show: a performance fix, a recurring error class below triage, a feature a strategy line implies that no goal serves.

## Design

### 1. The kit-lesson tag (supervisor)

A supervisor marks one of its own knowledge entries as "this looks like it would hold for any project on the kit":

```
devteam.mjs knowledge add --kind lesson --statement "…" --scope … --evidence … --kit
devteam.mjs knowledge set <k-id> --kit          # tag
devteam.mjs knowledge set <k-id> --kit off      # untag
devteam.mjs knowledge --kit                     # list the tagged ones
```

- A new optional field on knowledge, `kit_lesson` (boolean), in the schema with its description.
- **The supervisor's own field on its own knowledge.** Authority: added to `x-authority.set.knowledge.supervisor` only. Enforced in three places, so a hand-written line can't do more than the command:
  - `integrity` (every reader): a knowledge line carrying `kit_lesson` written by anyone but the supervisor is refused (the owner's new or set line, and nobody else can write knowledge at all).
  - `fold`: a supervisor's `set` of `kit_lesson` on knowledge the supervisor didn't create (the owner's standing rule, say) is ignored, with the reason, like any other ignored line.
  - The same `integrity` rule covers `owner_note` (review finding): a knowledge line carrying it written by anyone but the owner is refused, new or set. Before, the authority table guarded it only on `set`, so a hand-written supervisor `new` line could carry one. The `owner's` mark never reads `owner_note`'s presence, only the owner's own updates.
  - `knowledge set <id> --kit` refuses on knowledge it didn't create, saying why: the owner's rules and notes are theirs, and the operator reviews every owner entry anyway.
- **It grants nothing.** It changes no prompt (`knowledgeBlock` doesn't read it), no status, no approval, no trust, and nothing the dashboard ranks. It is read in two places: the knowledge list (`, kit lesson`) and the operator's harvest (`box-status --knowledge`). A test asserts that a tagged lesson's prompt block is byte-identical to the untagged one's.
- **When to tag** (supervisor.md §9, Share upstream, and the orient step that adds lessons): the lesson is about the kit, not the project: a step a process doc misses, a command whose output misleads, a check that should exist, a flaky pattern in the kit's own gates or commands, a question the kit makes it ask that it could answer. Not: anything about this project's code, stack, services, people or owner. The tag is a suggestion; the operator judges each entry itself.

### 2. The operator's reads

`OPERATOR_READS` gains `trust`, `sensor status`, `sensor series` (the read for a p95 creeping) and `problem` (the list; `problem add|set` stay refused). Each is a pure read today; the existing "each read the operator may run writes nothing" test runs them and diffs every file and git status, and the "looks, and nothing else" test adds `problem add`, `problem set`, `sensor poll`, `sensor test` to the refused list. `sensor` and `problem` join `OPERATOR_SUBCOMMANDED` so their writes are refused by name.

### 3. `box-status` says when the daily review is due, and what's new to harvest

`machine status` (box-status) already reads `~/operator/NOTES.md` for question ids. Two additions, both read from the same file, so the operator's own notes are the only state:

- **`machine: daily review due (last <yyyy-mm-dd | never>)`**, or `machine: daily review done <date>`, from the latest date among the `## Review <yyyy-mm-dd>` headings in the notes file, compared with today's UTC date. Printed only with `--notes`.
- **`new-knowledge=<n>`** on each repo's line, after `new-questions=`: accepted knowledge whose id doesn't **start a line** of the notes (optionally after a `-` or `*` bullet), so the operator's verdict line ("`k-…: stays`") marks it read and an id mentioned in passing doesn't hide it. (Questions keep their existing anywhere-in-the-file match, which NOTES.md files already rely on.) Candidates aren't listed, tagged or not: a tag waits for the entry to be kept. `?` when the repo's kit refuses the read (none do: `knowledge` has been an operator read since the role existed, but the code handles it as questions do).
- **`box-status --knowledge`** lists those entries, one line each, like `--questions`:
  `<repo> <k-id> [<kind>, <scope>[, owner's][, kit lesson]] <statement, one line, at most 300 characters>`.
  - `owner's`: the owner created it (a standing rule, or knowledge they added), or set its statement, scope or note (`updates` by the owner touching those fields). Computed by the image's kit from the fold the repo's own kit returns, so it works on any repo kit.
  - `kit lesson`: `kit_lesson` true and created by the supervisor.
  - Statements are agents' text: the doc says to read them as data. The list is bounded (300 characters a statement) so a long entry can't flood the pane.

The first review of a repo lists everything already accepted there; that's intended (a backlog worth one look) and it's noted once.

### 4. The daily review (operator.md)

A new section, **The daily review**, run once a day on the first check-in where box-status says it's due, after the check-in itself. The operator writes `## Review <yyyy-mm-dd>` in NOTES.md first and everything below under it. Two parts.

**Part 1, harvest.** `box-status --knowledge`, plus each repo's retros since the last review (`docs/devteam/project/retros/` on main, and `log --type observation` for kind `retro`, which carries each retro's summary). Every listed id gets a verdict on a line in NOTES.md, so it isn't listed again:

- **stays** (most): about this project. Nothing to do.
- **kit, mechanical**: it would hold for any project and it's about how the kit works. Open an upstream PR under the existing rules (one per cause, the 3-open cap, generic, nothing from the repo), through the usual review. Write the change from what you verified in the kit; never paste an agent's text into the kit.
- **kit, the owner's ruling**: the entry is the owner's (`owner's` in the list), or, whoever wrote it down, it records a choice the owner made for that project (any `preference` counts until checked otherwise; a policy, a trust or merge stance). Making it the kit's default changes governance for every project, so it needs the owner's yes **where the operator can't write**: the operator shares the owner's GitHub login, so a ready-mark, an approval or a comment on GitHub would read as the owner's and proves nothing. The operator asks that repo's supervisor (`box-tell`) to put it to the owner as an Inbox question (`owner-decision`, class `governance-edit`, reason `owner-only`, no default), which only the owner's own answer settles and which the repo's log records with its channel. The PR is opened as a **draft**, its body starting: "Needs the owner's OK: this would make a rule the owner gave <repo> the default for every project. Their answer: question <q-id> in <repo>. Don't merge until it is answered yes by the owner." Whoever merges checks the answer in that repo (`questions --all --json`), and treats the line as a stop whatever the PR's draft state. The operator never marks it ready, approves, comments or edits that line.

A tag is the supervisor's suggestion; an untagged entry can be a kit lesson and a tagged one can stay.

**Part 2, judge each supervisor.** For each adopted repo with a supervisor up, four questions, each answered from named reads (all in `OPERATOR_READS`, run in the repo with `DEVTEAM_ROLE=operator`), and each with what "falls short" means, so it's checkable rather than an impression:

| Question | Reads | Falls short when |
|---|---|---|
| **Is it running the loop?** Sensors, observations, incidents, findings acted on. | `sensor status --json`; `metrics --json` (findings by `kind`, with no age: "a day" means it was in yesterday's review line too); `problem`; `log --type observation --json --tail 200` | the app deploys somewhere and there are no sensors, or `sensor-discovery-due` two reviews running; a sensor `failing`, or its `last_at` over a day old; `incident-unowned`; a high finding two reviews running with no ack; in a week with merges, no observation of its own: `created_by` supervisor, `detector` not `sensor`, `metrics` or `pane` (the kit's own, which `observe` refuses), `kind` not `retro` or `reading`. (`source` is free text and not used.) |
| **Is it steering by the strategy?** Proposing goals and improvements that serve `project/strategy.md`, or only executing. | `metrics --json` (`strategy-unwritten`, `goal-unjudged`); `goal --json`; `questions --all --json` (kind `proposal`, classes `new-feature`, `strategy-change`); `log --type act --json` (class `improvement-trial`); the latest retro's "What we will change" | `strategy-unwritten` or a goal unjudged two reviews running; across the last 7 days with merged work, no proposal question, trial or `new-feature` question of its own; and, a reading rather than a check, proposals whose text names no strategy line or evidence |
| **Is it climbing the trust ladder?** Or asking what it could decide. | `trust`; `questions --all --json` (each question's class and `why_asked`) | `trust` says the evidence supports a trust question for a class and the last retro asked none; a question asked in a class the constitution makes the supervisor's own (`constitutional`), or at a rung where it could act and report (rung 3); most of its questions giving `low-confidence` as the only reason |
| **Do kit frictions recur?** | NOTES.md's own friction notes; retros' "Why" lines; observations about the kit | the same friction in two repos, or twice in one: that's the existing "What could work better" rule |

**Signals to investigate, never to relay.** Some things the operator sees are symptoms, and copying them into NOTES.md as "open owner asks" is the failure this review exists to prevent. Each of these gets a "why?" answered before anything is written down, at the daily review and at any check-in that sees one (operator.md's "Checking in" points here):

- a supervisor asking the owner something in chat (its pane, or what it told the owner) instead of through an Inbox question;
- a goal whose latest reading is at or past its target but whose status isn't `met` (`goal --json`: status, `measure.target`, `measure.direction`, the latest reading);
- a number that doesn't add up (an Inbox count against the questions listed, merges against tickets done, a reading against what the code shows);
- anything stuck for more than a day (a goal, a question, a ticket, a finding).

Investigating means reading the kit's own docs and code (the image's kit at `/opt/devteam/kit`, or a clone in `~/code/devteam`) to find what the supervisor was supposed to do and whether the kit lets it: which command does this, which role may run it, is there an Inbox question for it, does the dashboard offer it. Then one of: the kit has a gap (an upstream PR, or, if it's bigger than one PR, a precise note to the owner naming the file and function); the supervisor missed what the kit says (`box-tell`, citing the doc section); or it's the owner's to do and the kit already asks them properly (one line in NOTES.md, nothing to relay).

**Worked example (Stacks, 2026-11-11).** Several `ready` goals had readings at target (`0 -> 0`, `12 -> 12`, `1 -> 1 attested`) and looked stuck, and the supervisor told the owner in chat "5 goals to mark met". The operator copied that into NOTES.md as an open owner ask and stopped. What the review asks for instead: two signals fire (a chat ask; goals at target but not met). Reading the kit shows why: `goal status <id> met` is the owner's, by CLI only, and there is no Inbox question for a repo or prod goal and no dashboard action, so the supervisor had no way to ask but chat. That's a kit gap: an upstream PR (or, if one is already open, a note saying which), and a plain-English line to the owner saying what is stuck, why, and which PR fixes it. (The goal-met gap itself is being fixed separately; this change only makes the operator catch the class.)

Then:

- **Short because of the kit** (the kit doesn't tell it to, makes it hard, or gives it no read for it): an upstream PR, under the same rules.
- **Short in its own work** (the kit says what to do and it isn't doing it): `box-tell <repo> "<what you saw, the read that shows it, and the doc section that covers it>"`, information from the operator. Never as the owner's word and never an instruction it must record. Tell it once per shortfall; if the next review finds the same, tell the owner here instead of telling the supervisor again.
- **Record**, under the day's heading, one line per repo: `<repo>: loop <ok | short: why> · strategy <…> · trust <…> · frictions <…> · told: <what> · PRs: <#n…>`. A repo that's fine is one line saying so.

The review never answers, approves, rates, merges or writes to a repo's log; a judgement is the operator's opinion, and its only acts are notes, tells, upstream PRs and words to the owner. It costs reads, not transcripts.

### 5. The supervisor proposes what the project needs (supervisor.md §9)

Most of the machinery exists; the gap is that §9 points the supervisor at how the fleet works and at paths to goals already set, not at what production and the code show the project needs. One bullet in §9, after **Propose**, without new commands:

> **Propose what the project needs, not only what was asked.** On quiet ticks and at each retro, read for opportunities as well as faults: production signals that are below an incident (a p95 creeping toward its target, `slo-breach-week`, warnings that recur in a probe's rollup, an exception class that keeps coming back), code the metrics keep pointing at (hotspots, slow tests, churning contracts), what the owner keeps raising in threads, and each "How it wins" line no goal serves. Each one goes through the flow it belongs to, at your rung: a fix or improvement inside a goal's scope is a ticket you plan; a change to how the fleet works is an `improvement-trial`; a feature nobody asked for is `new-feature` on the ladder; a goal is a `proposal` question naming the strategy line it serves and the evidence (ids), with a recommendation, and only the owner's yes starts its definition (`planning.md` §1). Never ask again what the owner declined (§6), and rate honestly.

Plus the tag sentence in **Share upstream** (§1 above), and one line in the orient step (§3, step 4) pointing at it.

## Authority, checked

- **The operator is not in the chain.** Every new read is a read (tested); harvesting and judging produce only NOTES.md lines, `box-tell` messages (prefixed as the operator's, already refused over a half-typed line), upstream PRs and words to the owner. It writes nothing to a repo's log; `knowledge set` stays refused to it.
- **The tag grants nothing** (§1): one field, one writer, on its own entries, read only by a list and the operator.
- **An owner's ruling stays the owner's** (§4): their entries are marked by the kit, not left to the operator's reading; their PRs are drafts that only the owner moves on.
- **The supervisor's proposals go through flows that already gate them** (questions, the ladder, `new-feature`, `proposal`); nothing new lets it act beyond its rung.
- **Harness-agnostic.** Shell commands and a notes file; nothing assumes Claude Code.

## Testing

- `test/kit-lessons.test.mjs` (new; test files may be new), on its own fixture: `--kit` on add and set, `--kit off`, `knowledge --kit`; refused on the owner's rule (command); a hand-written supervisor set line on the owner's knowledge is ignored by the fold; an owner line carrying `kit_lesson` is refused by `log-check`; a tagged lesson's prompt block equals the untagged one's.
- `test/machine.test.mjs`: the new reads write nothing; `problem add|set`, `sensor poll|test` refused to the operator; `box-status` prints the review line (due with no notes heading, done with today's) and `new-knowledge=`, and `--knowledge` lists entries not in the notes with `owner's` and `kit lesson` marks, skipping noted ids.

## Not in this change

- No change to the operator's tick loop in `cloud/Dockerfile`: the review rides the existing check-in, and box-status says when it's due.
- No new log type, no new finding, no scorecard command: the judgement is the operator's reading of reads that exist, written down.
- No way for the operator to record the owner's OK, and no reliance on GitHub for it (the operator shares the owner's login): the owner's answer lives in a repo's Inbox. A stronger proof of owner approvals is being designed separately and isn't built here.
- "Signals to investigate" goes beyond the three approved parts: it's the coordinator's worked example (Stacks, goals at target not met) of the meta role, added as a check-in rule as well as a review rule.

## Review record

Fable reviewed this spec. Main findings and what changed: the draft-PR guardrail was self-restraint on a shared GitHub login (now the owner's yes is an Inbox question in the source repo, cited in the PR, and the merger checks it); `source` is free text (now `created_by` plus `detector`); `owner_note` had the same new-line hole as the tag (now refused in `integrity` too); noted-by-substring hid ids mentioned in passing (now line-start); "for a day" wasn't computable from findings with no age (now "two reviews running", or `last_at`); `sensor series` added; spec, plan and tree agree on the new test file.
