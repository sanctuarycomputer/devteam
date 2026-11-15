# Task review, Task 2, pass 1

- Reviewer: task-reviewer (fresh subagent, Opus 5.5)
- Reviewed: b4f14e2c9dff434f211d4393629ca749c5f7c963 (f908502..b4f14e2)

What I ran and read:

- `git diff f908502 b4f14e2`: three files. `cloud/gateway.mjs` changes one line (`instances` falls back to `JSON.stringify({ hub: 1, instances: [], down: true })`). `test/gateway.test.mjs` changes the two expected fallback bodies (over 1 MB, nothing on the port) and rewords the F1-2 comment at L2903. `reviews/task-1-2.md` fills only F1-2's Disposition cell (`fixed (comment reworded in T2)`). Nothing else changed. The new comment ("written before it listens (the code's order): it comes ahead of the listen line") drops the claim F1-2 objected to and claims no more than the assertion checks. That is one of the two remedies F1-2 offered.
- hubList (gateway.mjs L1221-1238): every no-answer path ends in `none()` → `null`: a non-200, a body over 1 MB, a socket timeout (destroy → error/close), the 15 s deadline, and a connection error. `instances` is the only place the fallback is built, and `??` applies it only on `null`. A hub that answers returns its Buffer (truthy, even when empty) and is passed through byte for byte with no `down`. This matches spec §2 and acceptance 2.
- Other consumers of the list: `pollPush`, `refreshPreviews`/`takePreviews` and `alertNews`/`inboxNews` call `hubList()` directly and get `null`, never the fallback, so `down` can't reach them. On `null` they behave as before (empty previews; pollPush returns early). The machine status `hubLine`, the preview clash check `previewNamesElsewhere` and `startHub`'s own probe in devteam.mjs all read `127.0.0.1:HUB_PORT` directly, never the gateway, so they never see the fallback. `hub.html`'s `draw` reads only `data.instances ?? []` today, so the extra key is ignored there until T3. The contract comment above `startHub` (ba2194d) already names `down?` as set only by the gateway.
- `node --test --test-concurrency=2 test/gateway.test.mjs` in the worktree: 73 pass, 0 fail.
- Mutants, run on a `git archive` copy in scratch with the "whatever an agent binds" test (the copy's baseline: pass):
  - M1, the fallback without `down`: killed.
  - M2, `down: true` added to every hub answer: killed (the exact-body assertion at L489).
  - M3, `down: 1`: killed.
  - M4, removing the non-200 check, so a non-200 body goes through as the list: survives the whole file (73/73). See F2-1.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | spec §2 (the fallback "when `hubList()` gives nothing: ... a non-200, ... a timeout") | test/gateway.test.mjs ~L479-499; cloud/gateway.mjs L1226 | Of the no-answer paths, only "over 1 MB" and "nothing on the port" are pinned through `/instances.json`. Dropping `if (ur.statusCode !== 200)` passes all 73 tests, and the deadline test (L911) checks only `pollPush`'s time, not the served body. All the paths share one `none()` → `??`, so the shipped code is correct by construction. Optional pin: have the stand-in answer `/instances.json` with a 500 once and assert the `down: true` body. The gap was already there before this task and doesn't block. | wont-fix: every no-answer path returns null to the one fallback (the reviewer called the test optional) |

Verdict: APPROVE b4f14e2c9dff434f211d4393629ca749c5f7c963
