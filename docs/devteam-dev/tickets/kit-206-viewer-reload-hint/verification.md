# kit-206 verification

At 225ebfba7ba9388c901e8f1d5644aaeb7c2c4f40 (code as at 7f62d29; later commits add records only). `origin/main` merged: already up to date. Browser tests run with Node 22 (`/usr/local/bin/node`); the machine's default Node 18 has no WebSocket and skips them, as CI's Node 18 job does.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | While the viewer is open, the dashboard checks the artifact's fingerprint on its normal poll; on a difference from what the frame loaded, reload gets an orange outline (warning token, light and dark) and a title saying a newer version is ready | `/usr/local/bin/node --test --test-name-pattern "reload button says" test/dashboard.test.mjs` | pass, 3/3 (the test, its dashboard subtest and its viewer-tab subtest): `stale` within one poll after the draft changes, title "A newer version is ready: reload to see it", `outline-color` equal to a probe's computed `var(--amber)` in light and under emulated dark (the two differ), 2px solid. Screenshots: `screenshots/reload-hint-light.png`, `screenshots/reload-hint-dark.png` |
| 2 | Pressing reload loads the new version and clears the outline; nothing reloads by itself | same | pass: the frame's lens still says the old `<title>` when the hint appears and again 3 s later; after the press it says the new one, `stale` is off, title "Load the page again". Mutations (a delayed self-reload; no open-time fpNow with an unguarded copy; no poll; no tree guard) each fail the test (task-1.md, task-1-2.md, task-2.md) |
| 3 | A dashboard test: open a draft, change its file, outline within one poll; press it, outline goes, frame shows the change | same; whole file through the gate: `devteam.mjs gate test --junit reports/junit.xml -- /usr/local/bin/node --test … test/dashboard.test.mjs` | pass; gate passed, 155/155 at 7f62d29 (262 s) |
| 4 | test.yml passes on every job; no file is added | CI (test.yml) at the PR head; `git diff --name-only --diff-filter=A origin/main` | no-file-added: pass, only this ticket's records (spec, plan, reviews, verification, two screenshots); modified: `docs/devteam/dashboard/index.html`, `test/dashboard.test.mjs`. CI: deferred to the PR's checks, every job green at the head before the merge request |

## Notes

- The new test's timeout is 240000 ms, not the plan's 180000: two subtests on real 10 s polls (task-1 T1-3).
- `reports/junit.xml` (the gate's output) is untracked and not committed.

## Rulings

- m-20261115-013720113-supervisor: spec approved; the stale "never polled" comment on `/api/view` in `devteam.mjs` is left for kit-106 (also in plan.md).
- m-20261115-014304247-supervisor: plan approved; the final review is one fresh subagent (risk normal); a screenshot of the outline in light and dark goes to the supervisor before the merge request.
