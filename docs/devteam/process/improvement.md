# Improvement

The supervisor doesn't just run the fleet; it keeps making the fleet better. Faster cycles, cheaper runs, better code, a smarter architecture, a sharper roadmap, all aimed at the owner's goals. This doc is the loop that does it: measure, look for improvements in four places, propose, trial, keep what works, and share what's general with upstream devteam. Everything it records goes in the log ([`log.md`](log.md)).

**The one rule:** never trade quality for speed. An improvement that weakens a gate, a review, or a code rule needs evidence that defects won't rise, and the owner's yes.

## 1. The loop

```
measure → find (retro, research, architecture, upstream) → propose → trial → measure again → keep or revert → share
```

The supervisor runs it on quiet ticks, within the time and spend limits in the settings (`improvement_budget_usd_per_week`; unset means use judgment and report spend). Research and reviews that take real work run as **spike tickets** in the `chores` feature, so workers do them and the supervisor stays free to supervise. Each spike's output is a document, not code.

## 2. Measure

Three sources feed the numbers, and each depends on sessions recording as they go:

- **Phases and cost:** workers heartbeat at every phase change and report their cumulative spend (`devteam.mjs heartbeat --phase <p> --usd <total> --in <tokens> --out <tokens>`; `worker.md` §4). Each phase change is a `phase` line in the log; the spend between two of them is charged to the earlier phase.
- **Gates:** every local gate run goes through `devteam.mjs gate <name> [--junit <report.xml>] -- <command>`, which records duration, pass or fail, the commit, and (with a JUnit report) each test's time and failures.
- **Everything else:** git, review records, messages, owner questions, observations and corrections in the log.

`devteam.mjs metrics [--since <date>] [--json]` turns them into:

| Metric | What it tells you |
|---|---|
| cycle time per ticket (first phase line → merged), median and slowest | where time goes |
| time and cost in each phase (spec, plan, build, verify, final-review, blocked, …) | which part of the loop is slow or expensive |
| gate durations and fail rates; flaky gates and tests (failed, then passed at the same commit); slowest tests | what to speed up or stabilize |
| first-pass rejection rate per review stage, review passes per ticket | review strength and rework |
| how long messages wait for a reply, and owner questions for an answer; the owner's answer rate over 14 days | coordination drag, and whether the decide step is stalling |
| cost total, per ticket and per merged ticket | spend efficiency |
| escaped defects (observations with kind `escaped-defect`) | quality, the number that must not rise |

It also lists **findings**: blockers and inefficiencies with a suggested next step, highest severity first. Flaky gates and tests, slow gates and tests, the phase taking most of the time or money, blocked tickets, workers with stale heartbeats, merge requests waiting on the supervisor, unanswered messages, owner questions past their deadline, tickets churning through review, spare capacity while ready tickets wait, and escaped defects. `devteam.mjs observe-metrics` records each finding as an observation, so recurring ones surface in `orient` (`log.md` §3). Each finding is a candidate for a proposal (§4); the cheap, obvious ones (fix a flaky test, shard a slow suite) can go straight into a chore ticket.

### The dashboard

`devteam.mjs dashboard-data` writes all of this, plus ticket status, the critical path, open owner questions, messages awaiting a reply and the state of the loop, to `run/dashboard.json`. The supervisor refreshes it every tick. `node docs/devteam/scripts/dashboard.mjs` serves a local page (http://127.0.0.1:4321) laid out by the loop: goals, the questions waiting for the owner (with why each needs them, and a choice of how to handle the next one), progress and the board, what was observed, what keeps recurring and what has been learned, the trust ladder, and the act feed with a button to correct any act. It binds to localhost because anyone who can reach it can act as the owner.

The page also shows progress, computed from git so it needs no extra bookkeeping:

- **Burn-up:** scope and done over time in points (S = 1, M = 2; scope grows when a ticket file is first committed, done when it merges), with a forecast finish date from the last two weeks' throughput and a best-to-worst range from recent weekly rates. Switch the view to one feature, story, release or wave.
- **Board:** every ticket in a column by its computed stage (backlog, ready, planning, building, review, merged, released), with risk, live phase and the critical path marked.
- **Widgets:** progress per feature, per wave and per story; each release's stories done (target releases come from the release map, §6 of each feature plan) and whether it is tagged or ready to tag; weekly throughput.

A forecast is only as good as the plan. Scope that isn't in the graph yet isn't in the date, so plan ahead (`planning.md`) before reading the finish date as a promise.

Each retro file keeps a snapshot of the headline numbers (gate runs and message waits live in gitignored files, so the snapshot is how trends survive restarts and other machines), and the next retro compares against it.

## 3. Where improvements come from

### 3.1 Retros

**When.** A retro is due `retro_every_days` (7 if unset) after the last one, and whenever a feature has fully merged since the last one. `devteam.mjs retro --due` says whether one is due and why; the dashboard shows "due since <date>" under Goals. Nothing has to remember: the last retro is a line in the log.

**How.**

1. When one is due, `devteam.mjs retro` drafts `project/improvement/retros/<date>.md` (from the numbers and the log, in its own chore worktree, so main stays clean): the headline numbers against the previous retro's, what merged, the slowest tickets, every review rejected at first pass, corrections, trials started and trials still without an outcome, problems opened and resolved, goal readings due, recurring signals to explain, where trust evidence supports a step up, current findings, and the roadmap as it stands.
2. On the next quiet tick (within 24 hours of the draft; after that it goes first), write the three sections only you can: **Why** (for each slow ticket, rejected review and correction), **What we will change** (each a trial act, a chore ticket, a lesson or problem, or "nothing, because …"; everything that needs the owner goes in one `proposal` question), and a two-line **Summary for the owner**. Do what the draft lists: record the goal readings, explain the recurring signals, record outcomes for finished trials.
3. `devteam.mjs chore-pr retro-<date> --title "retro <date>"`, merge it when CI passes, then `devteam.mjs retro close <date> --summary "<the two lines>" --refs <ids it produced>`. That observation is how the next retro, the due date and the dashboard know it happened.

Typical findings: a gate that's slow and could run in parallel, a ticket size that's consistently too big, a review prompt that finds nothing, a recurring design-change cause that better planning would catch, a component whose footprints keep colliding, a goal whose forecast keeps slipping.

### 3.2 Practice research (every `research_every_days`, default 7)

Code generation practice changes month to month: new models, agent features, review techniques, harness and loop patterns, cost levers. Make a spike ticket that researches what changed since the last research note, with sources, and how it would apply here. Write findings to `project/improvement/research/<date>-<topic>.md`. Prefer primary sources (vendor docs, release notes, papers, practitioners' write-ups) and say how confident each finding is.

### 3.3 Architecture reassessment (at the end of each feature, or when metrics point at the code)

Re-read `project/designs/architecture.md` against the goal plans and the roadmap (`devteam.mjs roadmap`). Look for hotspots that keep serializing tickets, components that should be split or merged, contracts that churn, dependencies or vendors that newer options beat on speed, cost or reliability. Research the external landscape for each candidate. Output is a proposal, never a direct change.

### 3.4 Upstream devteam

At most once every `upstream_check_hours` (default 24):

1. List releases of `upstream_repo` newer than the newest row in `project/upstream-log.md`: `gh release list -R <upstream_repo>`; read each with `gh release view <tag> -R <upstream_repo>`. Each release's notes have **What**, **Why** and **Migration**.
2. For each change, check whether this project edited the same files (the dated lines in `project/decisions.md`, and a diff against upstream at the base tag).
3. Ask the owner one question per release ([`questions.md`](questions.md)), kind `owner-decision`, no default, recommending **adopt**, **adapt** (keep the local intent, take the improvement) or **skip** for each change.
4. After the answer, fold it in as one `chore-devteam-sync-<tag>` PR: fetch upstream at the base and target tags, apply each change as answered, never touch `project/` or `run/`, add one row per release to `project/upstream-log.md` (even a skipped release, so the base moves on). It is `risk: high` if it changes `governance/`.

## 4. Propose

An idea that needs the owner is a **question of kind `proposal`** (`questions.md`), with the evidence ids attached (`--evidence`) and, when the reasoning is long, a research note written from [`templates/improvement-proposal.md`](../templates/improvement-proposal.md) at `project/improvement/research/<date>-<slug>.md` (in a chore worktree: `devteam.mjs chore-start research-<slug>`, then `chore-pr`) and linked with `--note`: the evidence, the change, the expected gain on each dimension (speed, quality, cost), the risk, how it will be measured, a trial plan and how to undo it.

An idea within the supervisor's own authority is not a question; it is a trial, logged as an act (class `improvement-trial`).

Who decides:

| Kind of change | Decides |
|---|---|
| A reversible change to how the supervisor schedules, reviews or prompts, within existing rules | supervisor: trial it (an act) |
| An edit to `governance/` or `process/`, or a new or changed gate | owner (`constitution.md` §4) |
| Anything that loosens a gate, a review rule or a code rule | owner, with trial evidence that escaped defects didn't rise |
| Roadmap, priorities, architecture, a new vendor or dependency | owner, as a proposal with the research attached; priority changes may climb the trust ladder (`autonomy.md`) |
| Opening a PR on upstream devteam | the `upstream-pr` class on the trust ladder: ask until the owner says otherwise (§6) |

Roadmap and architecture suggestions don't wait for a retro. When research or metrics show a faster, better or cheaper path to the owner's goals, ask now. Always say which goal the change serves.

## 5. Trial, measure, keep or revert

- Trial on a slice: one feature, one component, or the next N tickets. Log the start as an act (`devteam.mjs act --class improvement-trial -- "<what, on which slice>"`), and note the before numbers in the research note if there is one.
- Compare the same metrics before and during. Escaped defects and first-pass rejection rates must not get worse.
- Record the result as an **outcome**: an observation with kind `outcome`, refs to the act (and the question, if the owner approved it), a valence, and the measured change (`devteam.mjs observe --subject <act-id> --kind outcome --refs <act-id> --valence 1 --value <n> --unit <u> --detail "…"`).
- **Keep** it: land it where it belongs (settings, a prompt template, a process doc via an owner-approved PR) and add a line to `project/decisions.md`. If it taught something general, record it as a lesson.
- **Revert** it: undo it, and record the outcome with its numbers anyway. A failed idea is still knowledge.

## 6. Sharing upstream

When a kept improvement is to devteam itself (`governance/`, `process/`, `templates/`, `schema/`, `scripts/`) and would help other projects, contribute it:

1. Write it generically. Remove anything project-specific: names, components, data, metrics that identify the project. Never include code or content from `project/` or `run/`.
2. Check the `upstream-pr` class on the trust ladder (`devteam.mjs trust`). Below rung 3, ask the owner first (a `proposal` question with the diff summary). At rung 3, go ahead and log the act; the owner sees it in the act feed.
3. Open a PR on `upstream_repo` with a body in the release-note shape: **What**, **Why** (with the trial evidence, anonymized) and **Migration**. Put the PR link in the act.

## 7. What the supervisor must not do

- Change rules, gates or reviews on its own. Propose them.
- Let improvement work starve delivery. Improvement spikes take spare capacity, not critical-path slots.
- Chase novelty. A new technique needs a reason to expect it beats what works now, and a trial to prove it.
