# Planning Doctrine — setting up and breaking down a column

How a **column** (a whole feature-area, a.k.a. a stream; the owner's word is a "pitch") gets set up, designed, broken into numbered items, chunked into releases by user story, and tracked through every stage — so multiple agent sessions produce the same shape by rule, not by precedent.

This is the layer **above** `docs/PROCESS.md` (which runs a single item) and **below** `docs/workflow/fleet-code-generation-protocol.md` §3 (which coordinates across sessions). It does not restate either.

Status: draft for review. No process changes until approved; the "owed" items at the end name the scripts/edits that make its gates real.

## 1. What a column is

One owner direction → one **design** → one **column plan** → **N numbered items across M services** → done when the column plan's numbered done-whens hold on the live household(s).

Glossary addition: **column** — a feature-area owned end-to-end, tracked by one `docs/plans/<column>.md`. (Not "epic"/"stream"/"pitch" in the docs; "pitch" stays the owner's word for the originating direction.)

## 2. Entry criteria — what must exist before any item is numbered

A column is not "started" until all three exist (this removes the "where does the design live?" choice — it is **(a)**, always):

1. **The design** — `docs/design/<slug>.md` with a `Status:` line (or `<service>/docs/design/<slug>.md` when a single service owns it). Design *content* lives here — never frozen inside a `docs/specs/system-*.md`. Research behind it lives under `docs/research/<date>-<slug>/`.
2. **The system item** — `system-NN-<slug>`, whose *build is* writing the design + the column plan (the `system-09` shape: "a design, not a spec").
3. **The column plan** — `docs/plans/<column>.md`, structured per §8.

## 3. Chunking rules (normative; lifted from the v1-roadmap §2 header)

- One chunk = one reviewable PR. Define S/M sizes in the column plan.
- A chunk crossing a service line opens with its **contract stage** (`PROCESS.md` §1a); contract text is proposed in the system item's spec so fakes build before the owner merges (the `system-10` precedent).
- A chunk's done-when is written **once**, in the service roadmap row — never duplicated into the column plan.

## 4. Landing — turning chunks into numbered items (the `chore-v1-roadmap` procedure, made a rule)

- The PM assigns numbers **next-free per service**. Numbers never move.
- Each roadmap row gains a **`Column:` line** under its `Blocked by:` line (e.g. `Column: v1 (W-03)`), so the working-id → real-number map lives in the **tracked roadmap**, not a side ledger.
- A superseded row keeps its number with a one-line pointer to its replacement.
- The root `ROADMAP.md` gains one dated paragraph announcing the column's ladder (the `### The V1 ladder (2026-10-21)` shape).

## 5. Column-level rulings

Dated, one line each, in the column plan's **§7 Rulings log**. **A ruling that changes a `CLAUDE.md` rule is a `CLAUDE.md` edit in the same PR** — never only in the plan or a ledger. (This closes the leak where "two-in-flight relaxed to 3+/service" lived only in an untracked file; see Owed.)

## 6. Releases and user stories

- **User stories live once**, in the column plan **§1**, numbered `<COL>-S1 …`, actor-first, in EARS form where a reviewer must check them ("When ⟨trigger⟩, the ⟨system⟩ shall ⟨response⟩"; Mavin et al., RE'09).
- **Each service roadmap row gains a `Serves: <COL>-S2, <COL>-S5` line.** That is the entire item → story map; `rg '^Serves:'` enumerates it; a story is complete when every row serving it has all four boxes ticked on `main`.
- **Releases cut on cadence, not scope** (keep the existing 24h-soak / "a stable every two rcs" rules — making releases scope-gated reintroduces large batches; Reinertsen 2009, DORA/*Accelerate* 2018). The release *notes* are story-derived: see `deployment.md` (changelog generation) — the notes script groups merged rows by `Serves:`.
- The column plan **§6 Release map** names the *expected* release per story; the notes script records the *actual*. No one-off release-plan files, no GitHub Milestones (a second source of truth).

## 7. Stage tracking — derive it, don't record it

Every stage (designed → spec'd → planned → building → review → verified → merged → released) is recoverable from tracked files + PR state + tags. The mechanism is a script (`scripts/stages.py`, Owed), not hand-maintained state:

| stage | derived from |
|---|---|
| designed | a column-plan §2 row with a real number + a `Column:` roadmap line |
| spec'd | `<svc>/docs/specs/<svc>-NN-*.md` with `Status: approved`; Spec box |
| planned | plan file exists; Plan box (read at the item PR head) |
| building | a PR titled `<svc>-NN: …`, `isDraft` |
| in review | PR `isDraft=false`, not merged; a review record present |
| verified | `<svc>/docs/verification/<svc>-NN-*.md` present + linked in the PR |
| merged | PR `mergedAt`; all four boxes on `main` |
| released | `git tag --contains <merge-sha>` matches `v*` |

The script emits a Markdown table + JSON (the dashboard reads the JSON; the PM's sweep becomes one command). The only *gate* is a **consistency** check in `hygiene`: a `Serves:` id no column plan defines, or a `Column:` working-id with no row, fails — never a gate on stage *values* (facts, not rules). Precedent for in-repo machine-readable tracking: Kubernetes KEPs, Rust RFCs, Python PEPs (our `Status:` line already mirrors PEPs).

## 8. The per-column plan artefact — `docs/plans/<column>.md`

`docs/plans/v1-roadmap.md` is the working prototype. Required sections:

0. **Header** — `Status:`, the sha it was read against, the design it implements, the owner rulings it rests on.
1. **Stories** — the done-when/story list, numbered `<COL>-S1 …`, actor-first (EARS).
2. **Chunks per service** — working id, scope, `Blocked by`, size, **stories served**, **real number** (filled at landing).
3. **DAG / critical path / waves.**
4. **Gaps** any pause creates.
5. **Open owner questions** — each keeps its **answer + date** once given.
6. **Release map** — which stories are expected at which rc/stable.
7. **Rulings log** — dated column-level rulings.
8. **Supersessions** — what this replaces.

**Anti-duplication (the rule that keeps this layer thin):** the column plan must NOT hold item prose, done-whens, the four boxes (the service roadmap's), spec/plan content, task breakdown, or per-session state.

**Relationship in one line:** *the design says what; the column plan says the breakdown, the stories and the release map; the service roadmap owns the rows and the boxes; `PROCESS.md` runs each row.*

## 9. Owed (makes this doctrine real)

- `scripts/stages.py` (§7) + its JSON output; the dashboard reads the JSON.
- `scripts/release/notes.py` (shared with `deployment.md`): roadmap box-flips grouped by `Serves:` → the changelog + tag message.
- Add `Column:` and `Serves:` lines to existing roadmap rows; add the `hygiene` consistency check for both.
- Retire `docs/plans/v1-assignments.md`: its id map → `Column:` lines, its rulings → the column plan §7, its live state → derived by `scripts/stages.py`.
- **Confirm + land the two-in-flight cap**: the untracked ledger records "two-in-flight relaxed → 3+/service (owner, 2026-10-22)", which contradicts `CLAUDE.md`. If genuine, land it in `CLAUDE.md` (§5's rule); until then `CLAUDE.md`'s two-in-flight stands.
- Reshape `docs/plans/v1-roadmap.md` to the §8 structure (adds §0, §7, §8) — a project-plan edit, done with owner sign-off, separate from this guide.
