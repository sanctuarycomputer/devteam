# Spec review, pass 2

- Reviewer: spec-confirmer (fresh subagent, claude-opus)
- Reviewed: 2ce8e946465b237b986e83b2d5cebc5e677cfd92 (spec.md, diff since 79816da)

- F1 confirmed fixed: the new preamble to the acceptance checks runs every standalone hub from a non-git copy of `docs/devteam`. With `scriptCommon` and `cwdCommon` both null, `mainRoot = repoRoot = process.cwd()` (devteam.mjs ~390, ~449), so the check now matches the box. It also forbids writes into the kit checkout. See F2-2 for a wording gap in it.
- F2 confirmed fixed: the owner action and the `operator-thread status` ask spawn with `cwd: process.cwd()`, a dashboard keeps `mainRoot` (today ~11730, ~11834), and the reason is stated. Check 4 now has an assertion that catches a wrong cwd: the proof lands in `~/operator/threads.jsonl` under the fixture `HOME`.
- F3 confirmed fixed for the standalone hub. The image's kit started from a project folder or with `DEVTEAM_HOME` has `kitDir` outside `mainRoot`, so it reports `null`. The guard also changes a dashboard's hub; see F2-1.
- F4 confirmed fixed: the check now uses window `operator`, which matches `OPERATOR_WINDOW` and the box lookup at ~13206.
- F5 confirmed fixed: check 4 adds a foreign Host, `sec-fetch-site` missing or `same-site`, a non-JSON content type, and cross-site GETs of `/instances.json` and `/operator/threads`.
- F6 confirmed fixed: the hub retries on any listen error, logs once per distinct message, and its retry timer is not unref'd.
- F7 confirmed fixed: the non-hub holds the port for at least 4 × `DEVTEAM_HUB_RETRY_MS`, and the check asserts exactly one line and that the hub is still alive.
- F8 confirmed fixed: `--release` must match `^v\d+\.\d+\.\d+$` (no `-rc` suffix), and check 1 asserts that `--release ''` and `--release nope` give `kit: null`, no `image`, and a hub still alive a second later.
- F9 confirmed fixed: `DEVTEAM_IMAGE_HUB` must be a plain port (`^\d+$`). This agrees with the edge case that treats a non-number as unset.
- F10 confirmed fixed: the new Security section states the same-handler invariant and the P6 lines that aren't defended.
- F11 confirmed fixed: the hub is left out on purpose, and the claim checks out. The guard at ~19093 lets the operator run only `recover`, `machine`, `operator-thread` and `OPERATOR_READS` (~19075), and `hub` is none of them.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | done-when 1 ("a dashboard's hub reports kitVersion()"); design kit-46 bullet 2 ("for a dashboard's hub, it is `kitVersion()` (or `null` where there's no project)") | spec "What changes" 2, second bullet | The F3 guard ("`kitDir` is inside `mainRoot`") applies to a dashboard's hub as well as to the standalone `hub`. A dashboard whose running kit sits outside `mainRoot` while `settings.md` exists then reports `null`, but `hello --json` (~18060) still reports `kitVersion()`, which for that layout is the bare tag (`rel` starts `..`, ~18075). One example is a dashboard started with `DEVTEAM_OWN_KIT=1` from a project worktree. The test fixtures copy the kit into the project (test/lib/kit.mjs ~418), so check 1 still passes, but the spec narrows what the done-when says. Either apply the guard only to `hub` without `--release` (a dashboard's hub keeps `kitVersion()`, as written), or say in Rulings that this narrowing is intended. | fixed in plan.md (T1 Interfaces, Rulings and notes): a dashboard's hub keeps kitVersion(); the own-kit guard is the standalone hub's alone |
| F2-2 | Minor | done-when 1 ("creates no docs/devteam/run folder under its cwd"); spec check 1 ("no `docs` at all under its cwd") | Acceptance checks, the new preamble | The preamble says the hub runs "from a copy of `docs/devteam` … in a temp folder" but does not say the copy lives outside the hub's cwd. If a test puts the copy at `<cwd>/docs/devteam`, then "no `docs` at all under its cwd" fails without any defect, and `devteamDir` (~458) resolves to that copy. Say that the kit copy sits in its own temp folder (like `/opt/devteam/kit`), apart from the cwd the hub runs in. | fixed in plan.md (T1 Interfaces): imageKit() copies into its own temp folder, never under the hub's cwd |

Verdict: APPROVE 2ce8e946465b237b986e83b2d5cebc5e677cfd92
