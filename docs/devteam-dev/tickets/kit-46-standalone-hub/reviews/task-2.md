# Task 2 review, pass 1

- Reviewer: task-reviewer-2 (fresh subagent, claude-opus)
- Reviewed: 0d9fb7cf1df7e12dd9f655aa6e7bc0c7aafda3dc (Task 2, diff since 55b51e7)

What I checked:

- Spec "What changes" 3 and acceptance check 2 against `cmdDashboard`'s `listening` handler (devteam.mjs:14677) and `imageHub()` (devteam.mjs:13816). The regex is anchored without the `m` flag, so `4320\n`, ` 4320`, `4320.0`, `0x10E0`, `yes` and empty all give `null`. Only a plain port equal to `HUB_PORT` skips `startHub`, and the skip writes the exact plan string once through the dashboard's logger. `startHub` is self-contained (its state is local to it), so skipping it leaves no other dashboard path without what it needs.
- Plan step 1: four runs on PORTS+26..29. None of them collides with the file's other ports (+30..39) or with the instance block (+41..). Each run gets a fresh bareProject, and each dashboard is stopped before the next run starts. `hubMachine` deletes `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` and sets only the one meant (acceptance 8).
- Ran via kt.sh: the new test passes. All of `test/hub-overview.test.mjs` passes (8 pass, 1 skip, which needs Chrome), so T1's tests still pass (step 4).
- Mutations in a scratch copy, each killed by the new test:
  - M1: regex removed, `Number()` alone. Case (d), `0x…`, fails.
  - M2: line logged twice. "said exactly once" fails.
  - M3: line logged and `startHub` still called. "nothing listens on the hub port" fails.
  - M4: any plain port skips. Case (c), `4320`, fails.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "What changes" 3 ("Unset, empty or another port: served as before"); spec Edge cases (`"yes"`, `" "` treated as unset) | test/hub-overview.test.mjs:368 | The empty, non-numeric and padded values (`''`, `yes`, ` <port>`) are not exercised. The code handles them correctly (I checked by reading), and the plan's step 1 lists only (a)-(d), so this is coverage the spec names but the plan didn't ask for. | noted (Minor, no change: `^\d+$` reads them as unset; a test added after this verdict would void it) |
| F2 | Suggestion | plan Task 2 step 1 ("after the dashboard answers `/api/hello`") | test/hub-overview.test.mjs:356 | The test waits on stdout `dashboard on http` and then on the log line, not on `/api/hello`. Both come from the same `listening` handler, so this is equivalent for this property. Noting the deviation from the plan's wording. | noted (equivalent, as the reviewer says) |

Verdict: APPROVE 0d9fb7cf1df7e12dd9f655aa6e7bc0c7aafda3dc
