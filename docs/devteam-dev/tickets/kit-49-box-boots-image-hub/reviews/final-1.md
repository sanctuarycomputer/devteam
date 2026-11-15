# Final review, pass 1 (track A)

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: 40aad378d8bbd0abdb987e6fdc723921fcf849b8 (the whole branch, kit PR #245, ticket/kit-49-box-boots-image-hub)

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec acceptance 1 / How ("Each tmux call has `timeout 20`") | test/machine.test.mjs (hub fakes); cloud/Dockerfile hub_window | Every new tmux call in `hub_window` and the minute-loop line is bounded by `timeout 20`, but no test sees it: the fake `timeout` just shifts and execs, and the fake tmux logs the same arguments with or without it. Mutation M8 (`timeout 20 tmux new-window` changed to `tmux new-window`) passed all six kit-49 tests. The code is correct today. A later edit that drops a bound would go unnoticed, and a hung tmux would then stall the boot before the dashboards. Fix: have the fake `timeout` log `$1` to `$CALLS`, and assert that each tmux call is wrapped. | Deferred (m-20261115-045352826-supervisor): a test that the fake timeout sees the 20 s bound, as a follow-up. |
| F2 | Minor | test comment / spec How ("never a shell that dies before the dashboards") | cloud/Dockerfile `hub_wait` | The guard `''\|*[!0-9]*\|0?*` lets through an all-digit value too large for dash's arithmetic. With `DEVTEAM_HUB_WAIT_SECONDS=99999999999999999999`, `dash -c '…hub_wait \|\| :; echo reached'` prints `Illegal number` and exits 2 before reaching the echo. In the real boot that would end devteam-dev before the dashboards, box-recover and ttyd. Only the owner can set that variable (container env from the platform), and the value would have to be 19 or more digits, so this is not plausible in practice. A cap in the case (for example `?????*) hub_w=15`) closes it. | Deferred (m-20261115-045352826-supervisor): an all-digit value too large for dash arithmetic still kills the shell; the follow-up caps the digit count. Only the image or an operator sets it. |
| F3 | Suggestion | none | cloud/Dockerfile hub_window / hub_wait | `hub_wait` polls `$DEVTEAM_IMAGE_HUB`, but the hub binds `DEVTEAM_HUB_PORT`'s default, 4320, because the wrapper unsets `DEVTEAM_HUB_PORT`. If `ENV DEVTEAM_IMAGE_HUB` ever changes alone, they disagree. They agree today. Passing `DEVTEAM_HUB_PORT=$DEVTEAM_IMAGE_HUB` in the wrapper, or a comment tying the two together, would keep them in step. | Deferred (m-20261115-045352826-supervisor): pass DEVTEAM_HUB_PORT=$DEVTEAM_IMAGE_HUB to the hub so the two can never disagree; they agree today (both 4320). |

## What I checked

- quality.md §3. The ticket's spec, plan, verification (including note B) and the task reviews. The kit-49 sections of the design ("The boot, in order", "Failure modes", "Testing"). The diff `origin/main...40aad37`, excluding the ticket records.
- **The boot script (devteam-dev heredoc, `#!/bin/sh`, dash).** devteam-dev has no `set -e` or `set -u`, so a failing `hub_window` (non-zero from `timeout`/tmux) or `hub_wait` (returns 1, and is called as `hub_wait || :`) cannot abort the boot. The heredoc is quoted (`<<'EOF'`), so `$HOME`, `$DEVTEAM_KIT_RELEASE` and `$hub_rel` expand at boot, not at build.
  - Targets. `has-session -t =home` and `list-windows -t =home` take a session target, and exact `=home` is right there. `new-window -t '=home:'` takes a window target, with the colon. With the home session missing, it falls back to `new-session -d -s home -n hub`. With no tmux server, the minute loop starts one holding only the hub, as the loop's comment says.
  - Bounds. Every new tmux call has `timeout 20`. The wait is bounded by its deadline, with `curl --max-time 1` and `sleep 1`.
  - Placement. The first `hub_window` call follows the operator block (the `home` session exists). `hub_wait || :` sits after boot.sh and before the dashboard loop. The minute-loop line sits right after `sleep 60` and before `list-panes … || continue`.
  - The pane command. It runs `/usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub`, never a checkout, with `-c "$HOME"`. It uses `env -u` for NODE_OPTIONS, NODE_PATH, NODE_REPL_EXTERNAL_MODULE, DEVTEAM_HOME, DEVTEAM_RUN, DEVTEAM_PROJECT and DEVTEAM_HUB_PORT, plus `HOME='$HOME'` and root's PATH.
  - The release. It is expanded at creation and passed only when it is exactly `vN.N.N`. The `case` rejects newlines and quotes before `grep -x` sees them.
- **kit-46's side.** `cmdHub` takes `--release ''` as "no release, say so", and steps back from nothing (only `cmdDashboard` checks `imageHub() === HUB_PORT`). `/instances.json` answers curl, which sends no `sec-fetch-site`, on Host `127.0.0.1:4320`, with `{"hub":1,"kit":…`, which `"hub":1[,}]` matches. The hub log is `~/.devteam/hub-${HUB_PORT}.log`, which is what the note and operator.md name. The status line format `up, kit <r> (image)` matches operator.md's healthy line. `hub` is exempt from the DEVTEAM_RUN refusal and is machine-wide. ENV `DEVTEAM_IMAGE_HUB` reaches devteam-dev through `as_dev` (env keeps it), and so the tmux server's global environment, so dashboards that supervisors start in tmux step back too.
- **box-deploy.yml.** `setup-node@v5` (22) runs before the step. `TAG` comes from `github.event.release.tag_name` through `env:`, never `${{ }}` in the script. `box-pins verify --release "$TAG"` is the step's first line, before `[ -n "$HOOK" ]`, and its refusal text matches the spec. `releaseFlag()` dies on anything that isn't `^v\d+\.\d+\.\d+$`. `readPins` reports a missing or non-vX.Y.Z `DEVTEAM_RELEASE` (unstamped refuses). `inputs=(cloud docs/devteam)`. The job `if`, `environment: box`, the on-main check and the nothing-changed skip are unchanged.
- **box-image.yml.** The smoke step adds `box-pins installed` and `test "$(echo $DEVTEAM_IMAGE_HUB)" = 4320` inside the single-quoted `sh -ec`, so both are evaluated in the container and a mismatch fails the step.
- **README / operator.md.** They match the code (inputs, the refusal, every release restarts the box, the hub-DOWN paragraph).

## What I tried to break, and how it held

- **The tests**, run as the box rule prescribes, with `TMUX`/`TMUX_PANE` also unset since this shell is inside tmux. test/lib/kit.mjs already deletes them and installs a private-socket shim. Result: 53/54. The one failure was "status names the hub's kit, or says it is no hub, or down" (load around 8 to 17), the untouched timing test in note B. Rerun alone, it passed (drip about 5 s). All six kit-49 tests passed.
- **Mutations** on a scratch copy, running the six kit-49 tests each time. Each mutation made a test fail, except M8:
  - M1: dropped `-u DEVTEAM_HOME`. Caught.
  - M2: `'=home:'` changed to `'=home'`. Caught by 3 tests, including the real-tmux one.
  - M3: removed the `case` release guard. Caught, by the multi-line release.
  - M4: dropped `-c "$HOME"` from new-session. Caught.
  - M5: deleted the minute-loop line. Caught.
  - M6: loosened the body match to `grep -q hub`. Caught.
  - M7: removed the wait's `sleep 1`. Caught.
  - M9: dropped `HOME='$HOME'`. Caught.
  - M10: moved verify after the HOOK check. Caught.
  - M11: replaced the refusal with `|| true`. Caught.
  - M8: removed `timeout 20` from new-window. Survived, which is F1.
- **Crafted tags**, run through the deploy step's shell, extracted from the workflow and run with Actions' bash flags, with HOOK unset:
  - Refused with exit 1, and nothing ran: `v0.52.0$(touch pwned)`, `v0.52.0;touch pwned`, a tag with a newline, `v0.52.0 --dockerfile /dev/null`, `''`, `--`, `V0.52.0`, `v0.52.00`. No `pwned` file appeared.
  - `v0.52.0` passes, as it should.
  - `--release=v0.52.0` also passes, because the argv parser's last flag wins, and resolves to the stamped release. That is harmless: the `box` environment admits only `v*` tags, and the result is still the matching stamp.
- **The wait under dash.** It handles `15s`, `08`, `010`, `-1` and a `0` wait without dying. A 20-digit value kills the shell, which is F2.
- **Failure paths, by reading the code.**
  - A transient `list-windows` failure while home exists adds a second hub window, which only retries the port. This is documented.
  - `has-session` failing while home exists makes `new-session -s home` fail as a duplicate, which is harmless.
  - A hung tmux costs at most about 60 s per minute-loop pass, and the loop's existing `list-panes … || continue` is still reached.

No Critical or Important finding.

Verdict: APPROVE 40aad378d8bbd0abdb987e6fdc723921fcf849b8
