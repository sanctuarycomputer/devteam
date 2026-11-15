# Final review, pass 1 (track A)

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: 47fff63fec60c849d389a2b19c61f8ccb153294b (the whole branch; code at e4307836ea5b00f1691eccafcccc3d2df76519c1, later commits records only)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec step 5 (DW4, the window) | box-image.yml, "the hub comes back…", last line | After the window is closed and back, `holder` is checked but its pid is not compared to the pid from the kill check (700 in the run). A hub that survived the window's SIGHUP would pass while the new window's hub only retries the port. The spec's edge cases accept this explicitly ("a lingering image hub still answers correctly, which is all DW4 asks of the window"), so it does not block. Printing the pid, or noting old vs new, would make a red run easier to read. | wont-fix deferred (Minor, per supervisor m-20261115-055425612) |
| F2 | Minor | spec step 5 ("check the window is gone") | same step, `if has_hub_window` right after `kill-window` | If the minute loop's check lands in the roughly 0.1 s between `kill-window` and this read, the window is already back and the step fails although the box is fine. This fails closed (a false red, never a false green), and the chance is about 0.1/60 per run. | wont-fix deferred (Minor, per supervisor m-20261115-055425612) |
| F3 | Minor | spec step 1 / "timeouts bounded" | the `docker exec` calls (`dx box-status`, `dx cat`, `dx tmux …`) | These calls have no per-call or per-step timeout. A hung exec is capped only by the job's `timeout-minutes: 45`. It is bounded, but a hang costs up to 45 minutes and gives no "timed out" message for that check. `timeout-minutes` on each new step would fix this. | wont-fix deferred (Minor, per supervisor m-20261115-055425612) |

## What I checked

- quality.md §3, then the ticket's spec, plan, verification, and the plan, spec and task reviews. All task findings are dispositioned and fixed (task-1 F1–F4 in a421989, task-2 F1 in 83fd9be).
- The diff `origin/main...47fff63` outside `docs/devteam-dev` touches only `.github/workflows/box-image.yml`. `git diff e430783 47fff63` touches only `pr-body.md` and `verification.md`, both records.
- **The run is at the code's tree.** Run 43682276306: event pull_request, headSha e4307836…, conclusion success, and every new step succeeded ("what the box said" was skipped because nothing failed). The checkout step checked out merge ref eeaf5203de38b364ddd61ab568541da1de6eee72 ("Merge e4307836 into bdc18bbb"). I fetched that commit, and `git diff e430783 eeaf520` is empty: the whole tree is identical, including box-image.yml, cloud/ and the kit. bdc18bb is already in e430783 and is still origin/main.
- The run log, step by step:
  - **Boot.** The image's own entrypoint is used (no `--entrypoint`), with `DEVTEAM_PUBLIC_URL=https://box.test`, a named volume on /data, and 127.0.0.1:8080. /healthz is polled for 120 s with curl `--max-time 5`, and the step fails early when `.State.Running` is not true. REL was v0.52.0, checked against `^v[0-9]+\.[0-9]+\.[0-9]+$`. TOOLS was non-empty.
  - **The hub (DW1).** HUBPID 157 was exported. `holder_in` requires exactly one pid (regex over the whole `lsof -t` output) whose cmdline has argv[1] `/opt/devteam/kit/scripts/devteam.mjs` and argv[2] `hub`. A project's hub at `/data/home/code/*/docs/devteam/scripts/devteam.mjs` would fail this check. `image === true` and `kit === REL` are checked in node on the parsed JSON.
  - **The dashboard (DW2).** init ran in the e2e repo. The log line is compared exactly after its `<time> [<pid>] ` prefix. The holder equals 157. The list names `/data/home/code/e2e`. The `box-status` output in the next step also shows `e2e … dash=4321/up`, so the dashboard really did take a different port.
  - **The versions (DW3).** `machine: hub 4320 up, kit v0.52.0 (image)` and `machine: box v0.52.0: claude-code 2.1.307, …, uv 0.13.7` are matched as whole lines (`-x`). `image: $REL` is matched as a whole line in the docker logs.
  - **The hub returns (DW4).** "the hub is back as pid 700" printed 1.7 s into the step, and the deadline is checked again after a successful poll. After `kill-window` the window was gone, then back from the minute loop (`sleep 60` then `hub_window`, in cloud/Dockerfile) about 56 s later. After that came the list and the holder checks.
  - **Cleanup** ran (`if: always()`) after the steps.
- shellcheck 0.11.0 on every `run:` body, on box.sh as the boot step writes it, on the IN_BOX text, on the in-box kill script and on the e2e init script. The only output is SC1090 (dynamic source, expected), SC2016 (single quotes on purpose for text that runs in the box), SC2153 (TOOLS comes from GITHUB_ENV) and SC2164 on `mkdir && cd` under `bash -e`. SC2164 is a false positive: the last command of an && list does trip errexit.
- The YAML parses (ruby 3.4.12). The trigger is `pull_request` only, with `permissions: contents: read`. Nothing references secrets, tokens, a deploy hook, or `pull_request_target`.

## What I tried to break, and how it held

- **Vacuous matches.** REL and TOOLS are required non-empty before any check. Every grep is `-F` and most are `-x`. `left()` returns 1 on an empty log. `[ "$(holder)" = "$HUBPID" ]` can't pass as `"" = ""`: HUBPID is set only after holder printed a regex-checked pid, and box.sh's `set -u` would abort on an unset one. `read -ra` on a TOOLS with a newline would build a short line, and the whole-line match would then fail (fails closed). In-box `bash -c` exits with `list_in`'s or `holder_in`'s own status, and node exits 0 only when every condition holds.
- **pipefail and grep -q.** Every `grep -q` reads a here-string or a variable, never a pipe. The job default `shell: bash` gives `-e -o pipefail` (the log shows it), and sourcing box.sh adds `-u`.
- **Reading the wrong container or user.** Every check runs in container `box`. `dx` runs as dev with `HOME=/data/home`, so it uses dev's tmux server. The failure dump also lists windows as dev.
- **Sleeps hiding races.** Every wait is a deadline poll (until_ok, or the in-box loop at 0.2 s), and none is a fixed sleep. The kill budget is timed inside the container and checked again after a successful poll. The old, dying hub can't satisfy the kill check, because the holder's pid must differ from HUBPID.
- **Cleanup not running.** The dump step is `if: failure()` and the cleanup step is `if: always()`. Both stand alone (they don't source box.sh) and have `|| true` on every command, so they can't fail while the container is absent. The runners are GitHub-hosted and one per job, so the fixed names `box` and `box-data` can't collide between runs.
- **Timeouts.** The job has `timeout-minutes: 45`. The build took about 3 minutes and the whole job about 4. The waits are 120, 60, 5, 15, 90 and 15 s. curl has `--max-time` everywhere. The only gap is F3.
- **Fork PRs.** A fork PR on `pull_request` gets a read-only token and no secrets. The workflow needs neither, and nothing writes outside the runner.

Verdict: APPROVE 47fff63fec60c849d389a2b19c61f8ccb153294b
