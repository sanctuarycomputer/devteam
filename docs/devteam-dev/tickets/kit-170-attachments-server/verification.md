# kit-170 verification

CI: GitHub `test` workflow on PR #316, run 44004737734 at a704a06f15c54ccf014ad390ef5abdc317ececef (code head, after the whole-branch review fixes), every job green (`devteam.mjs gate ci -- gh run watch 44004737734 --exit-status`, exit 0, 250 s; `gh run view 44004737734 --json conclusion` = `success`). `box-image` run 44004737666 at the same head: `success`.

Local runs at a704a06: Node 18 on a box, under `env -u TMUX -u TMUX_PANE timeout 900 node --test --test-concurrency=2 <file>`, one file at a time, judged by exit code. `node --check` passes on `docs/devteam/scripts/devteam.mjs` and `cloud/gateway.mjs`.

| # | Done-when | Shown by (test/attachments.test.mjs unless named) | Result | Commit |
|---|---|---|---|---|
| 1a | On a box the gateway answers `POST /upload?name=` on an instance's name (owner's session, the page's own Origin), storing under the uploads root | "box upload: an instance's name…", "box upload: no session is 401, any Origin but the instance's…", "box upload: the box's own name…" (A1–A3), "box upload: a failure after the body is read…" | pass in CI; local 30/31, 1 skip | a704a06 |
| 1b | On a laptop the dashboard answers it, storing under `~/.devteam/uploads/<project>/` (made on first use, 0700); refuses before reading a byte unless Host, Origin and Sec-Fetch-Site are its own; off with `DEVTEAM_GATEWAY` set; returns the stored path or the reason | "laptop upload: the dashboard stores…" (A4), "each refusal comes before a byte of the body is read" (A5), "on a box (DEVTEAM_GATEWAY set) the route is off" (A6), the four A7 cases, A9, A10, "uploads at once count each other" (B-1), "a failure after the body is read is still answered, 500" | pass in CI; local pass | a704a06 |
| 1c | `safeUploadName` and devteam.mjs's copy (upload-rules block, run in vm) agree on a shared list; the limits and sweep match | "the upload rules: devteam.mjs's copy…" (A8) | pass in CI; local pass | a704a06 |
| 2a | answer, thread reply (`thread say`) and new-thread actions accept `files: [{name, path, bytes}]`, in log.schema.json for answer and turn lines | "files: an answer and both thread actions carry the dropped files…" (B1, B2, B6 via `log-check`), "files: on a box the dropped files are the gateway's" (B5), "files: a line its files make too long is refused…" (B7), "log-check: files are on the owner's lines only" (T5-1) | pass in CI; local pass | a704a06 |
| 2b | A path that doesn't resolve (after `..` and symlinks) to a file inside that machine's uploads folder is refused, naming it: `../`, an absolute path, a symlink out | "files: a path that isn't a dropped file…" (B3, including `<root>-evil`), "files: the shape is checked…" (B4, the refused modes) | pass in CI; local pass | a704a06 |
| 2c | The supervisor's prompt gets the files as a pane drop does (a bracketed paste of paths, a space after a non-image) | "the supervisor's pane gets the files as a bracketed paste…" (B8), "a turn with files held while the pane shows a menu keeps its paste…" (B9) | pass in CI; local pass | a704a06 |
| 3a | `GET /upload/<folder>/<name>` from the storing server: behind the session on a box; on a laptop behind the Host check, 403 only when Sec-Fetch-Site is present and not same-origin | "box serve: no session is 401…, another site…" (C2), "laptop serve: another site is 403, the owner's…" (C3) | pass in CI; local pass | a704a06 |
| 3b | `.png .jpg .gif .webp` as images, everything else (HTML, SVG) as `application/octet-stream` with an attachment disposition, all with nosniff and `CSP: sandbox`; paths outside are 404 | "box serve: a stored file comes back…", "laptop serve: a stored file comes back…" (C1, both servers on the same files), "box serve / laptop serve: a path that isn't…" (C4, symlinks out and to another stored file) | pass in CI; local pass | a704a06 |
| 3c | `test/gateway.test.mjs` passes unchanged | `test/gateway.test.mjs` (file not in the diff) | pass in CI; local 74/74 | a704a06 |

Also run locally at a704a06: `test/pane-question.held.test.mjs` 5/5, `test/owner-unread.test.mjs` 2/2 (it reads answer and turn lines). In T6: `test/operator-threads.pane.test.mjs` 8/8. In the branch fix: `pane-question.held` 5/5 and `operator-threads.pane` 8/8 again.

Skipped locally: "laptop upload: the override is ignored without DEVTEAM_BOX=off (A7)". On a box, `DEVTEAM_BOX` unset makes `onBox()` true and the route is off, so the case can't run here; CI's runners aren't boxes, and it passes there (plan-1 P2).

Not covered by a test: the free-disk floor (`DEVTEAM_UPLOAD_FREE`) under concurrent uploads, because a test would read the shared box's real free space and flake. The same in-flight sum feeds the total check, which is tested. Also untested: a failed `load-buffer` alone (B-2), since the test tmux can't fail only that call, and the sweep's second check for an upload that registers mid-scan.

Notes:
- `test/pane-question.answer.test.mjs` fails 10/12 on this box both at 0caac880 (before T6) and after: it needs Chrome and says "on a box the owner answers only on the dashboard". It's not in touches and not a done-when.
- One `test/gateway.test.mjs` run during T3, made while other fleets loaded the box, failed 14 tests and hit the 900 s timeout; it passed 74/74 alone and on every later run (observation o-20261117-012831728).

Reviews: spec-1 CHANGES, spec-2 APPROVE; plan-1 CHANGES, plan-2 APPROVE; task-1 to task-6 APPROVE (task 2 after one fix round, task-2-2). An in-session whole-branch review at 2a9f191 found B-1 (Important: on the laptop, uploads at once didn't count each other against the total and free-disk floor), B-2 (Minor), B-3, B-4 and B-5; all fixed at a704a06 and confirmed by a scoped re-review.

## Rulings

- `m-20261117-003346949-supervisor`: approve-spec at `792afd99`.
- `m-20261117-004552350-supervisor`: approve-plan at `ec29814c`. B6 runs `log-check`, not `validate`; the laptop keeps the dashboard's existing Host check.
- plan-2 P2-1: done in T5 (a bare `--files` is refused with the spec's words) and T6 (the named buffer is deleted when `paste-buffer` fails).
- `m-20261117-005812254-supervisor`: the laptop sweep removes an empty upload folder only once it is older than `UPLOAD_STALL_MS` (spec §3 step 6, task review T2-3); in the spec's Rulings and the PR body.
- `m-20261117-011923040-supervisor`: the owner's no-new-files rule (t-20261117-004321752) covers new code, docs and schema files, not ticket records; records stay here.
- Worker's calls, in the spec's Rulings: recorded names are held to `UNSAFE_TEXT` (T5-2, T6-2); the lost-Enter rescue's 8-line window is a known limit (T6-1).
