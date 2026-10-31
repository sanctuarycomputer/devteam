# Improvement

The supervisor doesn't just run the fleet; it keeps making the fleet better. Faster cycles, cheaper runs, better code, a smarter architecture, a sharper roadmap. This doc is the loop that does it: measure, look for improvements in four places, propose, trial, keep what works, and share what's general with upstream devteam.

**The one rule:** never trade quality for speed. An improvement that weakens a gate, a review, or a code rule needs evidence that defects won't rise, and the owner's yes.

## 1. The loop

```
measure → find (retro, research, architecture, upstream) → propose → trial → measure again → keep or revert → share
```

The supervisor runs it on quiet ticks, within the time and spend limits in the settings (`improvement_budget_usd_per_week`; unset means use judgment and report spend). Research and reviews that take real work run as **spike tickets** in the `chores` feature, so workers do them and the supervisor stays free to supervise. Each spike's output is a document, not code.

## 2. Measure

Three sources feed the numbers, and each depends on sessions recording as they go:

- **Phases and cost:** workers heartbeat at every phase change and report their cumulative spend (`devteam.mjs heartbeat --phase <p> --usd <total> --in <tokens> --out <tokens>`; `worker.md` §4). Each report charges the spend since the last one to the phase that was running.
- **Gates:** every local gate run goes through `devteam.mjs gate <name> [--junit <report.xml>] -- <command>`, which records duration, pass or fail, the commit, and (with a JUnit report) each test's time and failures.
- **Everything else:** git, review records, messages and owner questions.

`devteam.mjs metrics [--since <date>] [--json]` turns them into:

| Metric | What it tells you |
|---|---|
| cycle time per ticket (worker made → merged), median and slowest | where time goes |
| time and cost in each phase (spec, plan, build, verify, final-review, blocked, …) | which part of the loop is slow or expensive |
| gate durations and fail rates; flaky gates and tests (failed, then passed at the same commit); slowest tests | what to speed up or stabilize |
| first-pass rejection rate per review stage, review passes per ticket | review strength and rework |
| how long messages wait for a reply, and owner questions for an answer | coordination drag |
| cost total, per ticket and per merged ticket | spend efficiency |
| escaped defects (`defect.escaped` events) | quality, the number that must not rise |

It also lists **findings**: blockers and inefficiencies with a suggested next step, highest severity first. Flaky gates and tests, slow gates and tests, the phase taking most of the time or money, blocked tickets, workers with stale heartbeats, merge requests waiting on the supervisor, unanswered messages, owner questions past their deadline, tickets churning through review, spare capacity while ready tickets wait, and escaped defects. Each finding is a candidate for a proposal (§4); the cheap, obvious ones (fix a flaky test, shard a slow suite) can go straight into a chore ticket.

### The dashboard

`devteam.mjs dashboard-data` writes all of this, plus ticket status, the critical path, open owner questions and messages awaiting a reply, to `run/dashboard.json`. The supervisor refreshes it every tick. `node docs/devteam/scripts/dashboard.mjs` serves a local page (http://127.0.0.1:4321) that shows it and lets the owner answer questions; it binds to localhost because anyone who can reach it can answer as the owner.

The page also shows progress, computed from git so it needs no extra bookkeeping:

- **Burn-up:** scope and done over time in points (S = 1, M = 2; scope grows when a ticket file is first committed, done when it merges), with a forecast finish date from the last two weeks' throughput and a best-to-worst range from recent weekly rates. Switch the view to one feature, story, release or wave.
- **Board:** every ticket in a column by its computed stage (backlog, ready, planning, building, review, merged, released), with risk, live phase and the critical path marked.
- **Widgets:** progress per feature, per wave and per story; each release's stories done (target releases come from the release map, §6 of each feature plan) and whether it is tagged or ready to tag; weekly throughput.

A forecast is only as good as the plan. Scope that isn't in the graph yet isn't in the date, so plan ahead (`planning.md`) before reading the finish date as a promise.

Write a short dated snapshot of the metrics to `project/improvement/metrics.md` at each retro so trends survive restarts.

## 3. Where improvements come from

### 3.1 Retros (every `retro_every_days`, default 7, and at the end of each feature)

Read the metrics and the event log since the last retro. For each of the slowest tickets and each rejected review, ask why. Typical findings: a gate that's slow and could run in parallel, a ticket size that's consistently too big, a review prompt that finds nothing, a recurring design-change cause that better planning would catch, a component whose footprints keep colliding.

### 3.2 Practice research (every `research_every_days`, default 7)

Code generation practice changes month to month: new models, agent features, review techniques, harness and loop patterns, cost levers. Make a spike ticket that researches what changed since the last research note, with sources, and how it would apply here. Write findings to `project/improvement/research/<date>-<topic>.md`. Prefer primary sources (vendor docs, release notes, papers, practitioners' write-ups) and say how confident each finding is.

### 3.3 Architecture reassessment (at the end of each feature, or when metrics point at the code)

Re-read the baseline and recent designs against the roadmap. Look for hotspots that keep serializing tickets, components that should be split or merged, contracts that churn, dependencies or vendors that newer options beat on speed, cost or reliability. Research the external landscape for each candidate. Output is a proposal, never a direct change.

### 3.4 Upstream devteam

At most once every `upstream_check_hours` (default 24):

1. List releases of `upstream_repo` newer than the newest row in `project/upstream-log.md`: `gh release list -R <upstream_repo>`; read each with `gh release view <tag> -R <upstream_repo>`. Each release's notes have **What**, **Why** and **Migration**.
2. For each change, check whether this project edited the same files (the dated lines in `project/decisions.md`, and a diff against upstream at the base tag).
3. Ask the owner one question per release ([`questions.md`](questions.md)), kind `owner-decision`, no default, recommending **adopt**, **adapt** (keep the local intent, take the improvement) or **skip** for each change.
4. After the answer, fold it in as one `chore-devteam-sync-<tag>` PR: fetch upstream at the base and target tags, apply each change as answered, never touch `project/` or `run/`, add one row per release to `project/upstream-log.md` (even a skipped release, so the base moves on). It is `risk: high` if it changes `governance/`.

## 4. Propose

Every idea becomes a proposal at `project/improvement/proposals/<date>-<slug>.md`, from [`templates/improvement-proposal.md`](../templates/improvement-proposal.md): the evidence, the change, the expected gain on each dimension (speed, quality, cost), the risk, how it will be measured, a trial plan and how to undo it.

Who decides:

| Kind of change | Decides |
|---|---|
| A reversible change to how the supervisor schedules, reviews or prompts, within existing rules | supervisor: trial it |
| An edit to `governance/` or `process/`, or a new or changed gate | owner (`constitution.md` §4) |
| Anything that loosens a gate, a review rule or a code rule | owner, with trial evidence that escaped defects didn't rise |
| Roadmap, priorities, architecture, a new vendor or dependency | owner, as a recommendation with the research attached |
| Opening a PR on upstream devteam | owner, unless `upstream_contributions` is `auto` (§6) |

Roadmap and architecture suggestions don't wait for a retro. When research or metrics show a faster, better or cheaper path to the owner's goals, ask now, with the proposal linked.

## 5. Trial, measure, keep or revert

- Trial on a slice: one feature, one component, or the next N tickets. Record the start in the proposal and log an `improvement` event.
- Compare the same metrics before and during. Escaped defects and first-pass rejection rates must not get worse.
- **Keep** it: land it where it belongs (settings, a prompt template, a process doc via an owner-approved PR), set the proposal's status to `kept`, and add a line to `project/decisions.md`.
- **Revert** it: undo it, set the status to `reverted` with the numbers, and keep the file. A failed idea is still knowledge.

## 6. Sharing upstream

When a kept improvement is to devteam itself (`governance/`, `process/`, `templates/`, `schema/`, `scripts/`) and would help other projects, contribute it:

1. Write it generically. Remove anything project-specific: names, components, data, metrics that identify the project. Never include code or content from `project/` or `run/`.
2. If `upstream_contributions` in the settings is `ask` (the default), ask the owner first, with the diff summary. If it is `auto`, go ahead and tell the owner afterwards.
3. Open a PR on `upstream_repo` with a body in the release-note shape: **What**, **Why** (with the trial evidence, anonymized) and **Migration**. Record the PR link in the proposal.

## 7. What the supervisor must not do

- Change rules, gates or reviews on its own. Propose them.
- Let improvement work starve delivery. Improvement spikes take spare capacity, not critical-path slots.
- Chase novelty. A new technique needs a reason to expect it beats what works now, and a trial to prove it.
