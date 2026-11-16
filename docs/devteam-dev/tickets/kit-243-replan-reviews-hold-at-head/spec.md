# kit-243 re-plan reviews hold at head: spec

## TL;DR

- `validate --strict` skips the "verdict holds at HEAD" check for a feature whose plan log (`project/log/plan-<fid>.jsonl`) is already on main (`landed`, devteam.mjs ~3725). That is right for every other feature (their reviews are history), wrong for the feature a `plan/<fid>` branch is re-planning.
- Fix: on `plan/<fid>`, the check runs for `<fid>` even when landed. Same errors, same messages as a first plan.
- Nothing else changes: other landed features stay skipped; a first plan behaves as today; the landed design's TL;DR check stays off.

## Rulings

- m-20261116-152938511-supervisor: lighter review depth (trial a-20261116-152814133): no separate spec/plan/task reviews; supervisor reads spec and plan before approve-spec/approve-plan; full adversarial final review.

## Acceptance checks

1. On a `plan/<fid>` branch whose `plan-<fid>.jsonl` is on main (a re-plan), with the feature's graph or design review at an older commit and a non-record change since, `validate --strict` exits non-zero and prints `feature <fid>: graph review … does not hold at HEAD …` / `feature <fid>: design review … does not hold at HEAD; review again` (the first plan's messages).
2. Same branch: after new graph and design reviews at the head (APPROVE), `validate --strict` passes.
3. A first plan (plan log not on main) still fails with stale reviews and passes with reviews at the head.
4. A re-plan whose reviews hold at the head passes (covered by 2).

## Contracts

None provided or consumed.

## Edge cases

- Other landed features on a `plan/<other>` branch: still skipped (their old reviews never hold at any later head).
- Plain `validate` (not strict), or main/ticket branches: unchanged (no head check).
- A re-plan branch with no change of its own since the old review: the verdict holds (verdictHolds' rules), passes.

## Out of scope

- The design TL;DR check for landed designs.
- Any change to `verdictHolds`.
