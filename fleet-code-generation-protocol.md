# Fleet Code-Generation Protocol

How this repository's code actually gets written, reviewed, and merged: one coordinating session ("the PM/CTO") driving a fleet of long-lived autonomous builder sessions, without a human in the loop for most steps.

This is the operating manual for the *fleet*. It sits above `docs/PROCESS.md` (the per-item SDD rules every builder follows) and alongside `docs/CODE-STYLE.md` (the code doctrine). Where this doc and `docs/PROCESS.md` overlap, `docs/PROCESS.md` is authoritative for the mechanics of a single item; this doc governs coordination across items and sessions.

Status: descriptive (as-is). Metrics labelled "observed" are from live operation, not a controlled study. A short list of known limitations and improvements-under-consideration is at the end; none of those is implemented.

## 0. The shape in one paragraph

One PM session writes no production code. It rules cross-service contract/design questions, exercises delegated approvals (`approve spec`, `approve plan`, `approve design change`), gives the **merge word** (the only thing that authorizes a merge), serializes the shared build machine's gate slots, keeps the authoritative memory ledger, gathers the small set of genuinely owner-level questions, and runs an autonomous loop so work advances on its own. Each builder session owns one service's current item, builds it test-first in its own git worktree, gets it reviewed by a non-author, and brings the PM a verified head for the word. Everything crossing a service line starts as a versioned contract change, reviewed before the code.

## 1. Roles

- **PM/CTO** (one stable session). Coordinates; does not implement. Authority and duties above. The single accountable "last word" on every merge.
- **Builders** (one long-lived session per active service/stream). Each owns its service's current item end-to-end: spec, plan, test-first build, verification, and bringing a reviewed head to the PM.
- **Review pool / idle builders.** A session blocked on its own item takes non-author review duty or a scoped de-risk for another stream rather than sit idle.

## 2. Fleet topology

- Builders run as separate `claude --resume <id> --dangerously-skip-permissions` processes, all launched from the main checkout, each operating on a per-item **git worktree** under `.worktrees/<service>-NN-<slug>`.
- They live in one tmux session (one pane each). The PM observes a pane read-only (`tmux capture-pane`); it drives keys into a pane only for **recovery** (a frozen modal, a relaunch), never to assign work.
- **Normal coordination is message-passing, not tmux.** The PM and builders talk over cross-session messages; a builder's message interrupts the PM's loop immediately.
- **Roster drift:** relaunching a session regenerates its display name, so names are resolved live via the agent listing, not assumed. Address by the current name; append a disambiguating ref only when a listing shows two.

## 3. How work is broken up

- **One item in build per service**, in its own worktree.
- **Spec-ahead:** while the current item builds, the next on-path item may be specced + planned in a second worktree by a second session; it commits no contract stage until the current item merges and builds only tasks that touch none of the blocker's files.
- **Two-in-flight cap:** of two items in flight, one is "current" (building) and one "next"; **no service runs three**, and one session never builds two items at once.
- **Items decompose into tasks, built test-first** (the test is red before the code), each with a file map and machine-checkable done-whens.
- **Contract-first:** a change crossing a service line begins with a versioned change to the contract under `docs/contracts/`, reviewed as a "contract stage" against the § Contract checklist before the code in the services it binds.
- **Contract-minor serialization:** a stage reads `main`'s `Version:` line at commit time and takes the lowest free minor; when two stages are in flight, the rule is **first-ready-takes-the-lowest-free-minor**, each re-reading `main` immediately before committing so they can't collide.

## 4. The SDD lifecycle and the PM's gates

An item flows **spec → plan → build (task-by-task) → verification → merge**, reviewed at every stage, with a PM gate at the transitions.

| Stage | Reviewer | PM action |
|---|---|---|
| Spec | non-author, adversarial | `approve spec` (PM reads the review record + rules open questions) |
| Plan | non-author, adversarial | `approve plan` |
| Contract stage | non-author § Contract pass (often the PM) | **stage word** (PM reviews the diff against § Contract itself) |
| Per-task build | non-author | builder proceeds on green; no PM word |
| Design change mid-build | — | `approve design change` (builder STOPS and asks rather than inventing a fix) |
| Final build | fresh non-author | **merge word** (full verification, §6) |

**Stop-don't-invent:** when a builder hits a spec-vs-reality or spec-vs-contract conflict, it stops and asks for a design-change ruling rather than guessing. This reflex is load-bearing — several real defects (a fail-open authority misattribution, a migration that would break rollback-safety) were caught because a builder stopped.

## 5. Adversarial reviews

- **Form.** By an agent that did **not** write the work — a fresh subagent dispatched with an adversarial "find the defect, default to not-approved" prompt, or a different session for cross-service seams. A reviewer reads the diff and what it cites (not the whole tree) and runs **mutation testing** in a scratch copy where a vector can't carry the property.
- **When.** Every spec, plan, contract stage, build, and a final whole-branch review. Security-sensitive or cross-service items get **two independent reviews from two different sessions**.
- **Passes.** Pass 1 (adversarial) → fixes → pass 2 (confirm, diff-only). A new Critical in pass 2 forces pass 3.
- **A fix wave gets a COLD confirming re-review** — a non-author who is *not* the fixer re-verifies and flips the verdict to APPROVE. A "Changes needed" verdict plus an author-side "fixes applied" note is **not** an approval; the merge word waits for the cold re-review. (A meaningful fraction of fix waves still reject on the cold pass — don't skip it.)
- **Observed timing (live, single-machine):** a full adversarial pass ~15–45 min; a confirm pass ~5–15 min; the PM's contract-diff review ~5–10 min; the PM's merge-word verification ~2–5 min. Real-machine *verification* runs (not reviews) run hours and are slot-serialized (§7).
- **Observed value:** essentially every substantive adversarial review surfaces at least one real Important/Critical before approval. Reviews are a defect filter, not ceremony.

## 6. The merge word (the only merge authorization)

The PM **never merges on green alone and never on a peer's attestation.** For every merge word it verifies, itself, at the **exact head** the builder names:

1. `draft == false`
2. `mergeStateStatus == CLEAN` (mergeable *and* not behind base)
3. `headRefOid` equals the named head exactly
4. CI: every check green, including the required aggregate (a path-filtered SKIP is fine; a failure is not)
5. **Every required non-author review APPROVE at that exact head** — the PM reads the review records, not the summary
6. Any item-specific condition (a recorded migration-rollback constraint, a verification clause under a PM ruling, etc.)

The builder then merges with `git merge --match-head-commit <head>` (refuses if the head moved), and the PM **confirms the merge landed on `main` itself** before logging it.

Two hard-won sub-rules:
- **The reviewer's own word.** If a review reached the builder only by relay/transcription, the PM requires the reviewer's **direct** confirmation at the exact head — a coordinator's transcription of a third session's verdict is not the review.
- **The head can move.** A builder that pushes after requesting the word invalidates the earlier head; the PM verifies the *current* exact head, not the one first named.

## 7. Gate-slot serialization (shared build machine)

All sessions share one machine; a full build-with-coverage pins the CPU and two at once thrash everyone (false reds from load timeouts).

- **One heavy gate at a time across the whole fleet.** Builders ping before a full gate; off-critical-path gates yield to the critical-path "pole."
- **Latency/real-machine verifications run only in a PM-granted quiet slot** (low 1-minute load, no other fleet heavy gate). The PM serializes the slot by message: current run holds it; the next waits.
- **A load-induced red is a flake, not a failure:** stop on any red, but a red that passes alone *and* goes green on a full re-run is a load flake — commit on the green run, and record the overlap honestly.
- **Measurement discipline:** loop-hold/latency bars on a shared box are judged by **median per-slice + the expected cadence**, not wall-clock tails (which measure OS descheduling under contention, not the code). A quiet-window re-run with a clean median passes even if a contended earlier run showed tails; the tails are recorded as invalid-by-environment.

## 8. How sessions unblock each other

Message-passing, not shared editing. Replies to the coordinator are one line; agreements land in the documents, not just the chat.

- **Co-land.** A contract change that reddens a consumer's pinned enum is fixed by the *consumer's owner* in a small commit co-landed into the same PR, so CI never sees a red head.
- **Contract-first seams.** When service X needs something of service Y, it becomes Y's contract to serve and X's to consume, placed as an item and read fail-closed.
- **Idle redirection.** A session blocked on its item takes review duty or a scoped de-risk (e.g., a single live probe against a just-merged dependency) without touching its blocked path.
- **Staged done-whens.** A downstream dependency that isn't live yet is handled by a documented "built but withheld" done-when, so the item can merge without the dependency.
- **Permission boundaries are per-session.** A session never does for a peer what that peer was denied; a peer's request is not the user's approval. Such a request is refused and surfaced to the owner (no permission laundering).

## 9. How decisions get made

- **Delegated authority.** The PM holds `approve spec`/`approve plan`/`approve design change` and all cross-service contract/ordering rulings, and exercises them without a check-in.
- **Verify, don't rubber-stamp.** For a stage or merge word the PM reads the actual diff / review record / live evidence, never the builder's summary. (When the shared object store glitches under concurrent access, fall back to `git cat-file` or the worktree filesystem.)
- **Rule from the contract, not convenience.** A ruling cites the contract's own text; a contract's own guarantee overrides a spec's looser wording.
- **Fail-safe by default.** Every safety-touching ruling chooses fail-closed / fail-loud; fail-open is owner-only. Bounds that *refuse* beat bounds that silently truncate.
- **Minimize one-way doors.** Prefer the option that avoids an irreversible migration/release; two rollback-unsafe migrations in a release is a smell.

## 10. Gathering the owner's questions

The standing mandate is **surface only genuine blockers**; the PM decides everything else.
- An **owner-touch queue** in the ledger batches the few genuinely-owner items (a product capability only the owner knows, an irreversible policy, a deploy gate) rather than interrupting per-item.
- A push notification is sent only when newly blocked on a decision the PM won't make alone, or when something landed the owner must act on now — **one ping per state, not per tick**. Progress the PM made itself is not a trigger; the transcript carries it.

## 11. The memory ledger (the authoritative record)

A file-based memory is the durable record. Every merge word, ruling, design change, and placed item is appended with its head SHA and rationale, so the protocol survives context compaction and is hand-offable. The ledger — not chat — is where the state of the world lives; an index file is loaded each session.

## 12. The autonomous loop

The PM runs on a self-paced timer. Each tick **sweeps**: fetch + new merges on `main`, open PR states (`draft`/`mergeStateStatus`), and a pane-health scan. Cadence adapts — tighter (~20 min) when PRs are converging, looser (~30 min) when quiet. Builders' direct messages interrupt regardless, so the sweep is a backstop, not the primary signal.
- **Live vs stale panes:** a limit/freeze banner in a pane is judged live only if no subagent is actively running; a capped session can't run subagents or merge PRs, so running subagents + landed merges prove liveness and a visible banner is stale scrollback.

## 13. Recovery playbook

- **Weekly-usage freeze:** the fleet can freeze on a shared org usage limit. The spend-free recovery is to set each frozen session's modal to "continue automatically at reset"; a genuinely separate login (its own pool) requires **relaunching** each session, because a running session holds its launch credential and won't re-read a new one without a restart.
- **Relaunch a frozen/straggler session:** terminate that one known process and re-run `claude --resume <id>` from the main checkout; verify it comes up without a limit error.
- **Safe-kill discipline:** kill only a single known PID, or an in-session gate's recorded **process group** (checked ≠ 0/1/self first) — never a broad pattern-kill on a shared box.
- After a fleet-wide respawn, re-establish each session's state from the ledger and a roster re-resolve (names drift).

## 14. Skills in use

- `superpowers:using-superpowers` (the meta-skill: check for a relevant skill before acting; process skills before implementation skills).
- `superpowers:dispatching-parallel-agents` (one agent per independent problem; the builders use it for review/fix fan-out).
- The autonomous-loop skill (the PM's dynamic-pacing loop).
- Builders run the SDD workflow their `CLAUDE.md`/`docs/PROCESS.md` encode (spec/plan/test-first/review/verify), which maps onto the superpowers writing-plans / TDD / verification-before-completion / systematic-debugging skills.

## 15. Known limitations & improvements under consideration (not implemented)

Honest weak spots a reviewer should scrutinize:
- **Author-dispatched subagent reviews** are less independent than a different-session review; the PM accepts them only when the pass is demonstrably adversarial (finds real issues) and adds its own § Contract pass; security-sensitive items get two separate-session reviews.
- **The PM is a single serial verification bottleneck** — every merge word routes through one session reading artifacts by hand. (This is partly deliberate: the human-accountable last word.)
- **Shared single build machine** forces slot-serialization and injects load-flakes.
- **No structured findings log** yet (fixed/won't-fix/disputed/wrong), so the review false-positive rate is not measured.

Improvement research exists (an internal fable-model study, and a cross-compare with a sibling fleet) proposing: decoupling review from the builder's clock, push-not-poll event coordination, scripting the merge word's mechanical checks (keeping the judgment with the PM), moving heavy gates off the shared box, incremental mutation testing in CI, a ranked async-questions inbox with reversible-only defaults, and a structured findings log to measure review quality. None is implemented; each should be trialled on one service with the merge-word and review records unchanged, and measured.
