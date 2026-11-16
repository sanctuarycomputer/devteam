# Final review, pass 1

- Reviewer: reviewer-final-1 (fresh subagent, claude-opus-5-5)
- Reviewed: ada3b836348a372078e12dada231845839f0c489 (the whole branch)

What I read: the ticket, `git diff origin/main...HEAD` (devteam.mjs `paneBody` and `resendLostEnter`, the new test in test/accounts.supervisor.test.mjs), spec.md, verification.md, the task reviews and pr-body.md. I also read the other callers: `paneWaitingIn`, `resendSupervisorLostEnter`, and the chain.mjs lost-Enter step (test/lib/chain.mjs:2429-2499).

Runs, in a detached worktree at ada3b83. accounts.supervisor.test.mjs passes 4 of 4. Each mutation below makes the new test fail, and each was restored afterwards:

| Mutation | Result |
|---|---|
| digest back to the old `lines.slice(-8)` | fails: `timed out waiting for Enter 2 of 3` (done_when 1) |
| busy/menu guard narrowed to `lines.slice(-8)` | fails: `left alone: a spinner above a long agent list` (done_when 3) |
| `paneNorm` without the shell-phrase strip | fails: Enter 2 of 3 |
| no `PANE_TOKENS` filter | fails: Enter 2 of 3 |
| no cut at the last rule | fails: Enter 2 of 3 |

I also ran `paneBody` on /data/home/tmp/sb-pane.txt in a scratch module. The digest is unchanged and the text is found in each of these variants: the footer with `PR #671 · 2 shells`, agent lines added, the status line's shell count gone or changed to `2 background shells`, and an agent line with no tokens yet.

Callers:
- No new press into a busy pane or a menu. The busy/menu guard now reads all 15 captured lines where it used to read the bottom 8, and `paneAsking`/`clientActiveOn` are unchanged.
- The only new presses are the ones the spec accepts. The body reaches further up than the old bottom 8, so it can still find an old echo of the text on an idle pane.
- `paneWaitingIn` and `resendSupervisorLostEnter` are unchanged apart from going through the new function.
- The chain step's panes all come out the same:
  - its menu and busy panes are stopped by the caller's `PANE_WAITS` check or by the busy guard;
  - its "submitted" pane no longer has the text in its last 15 lines, so the record is still dropped.

verification.md is accurate. Run 43773870169 is `success` at headSha 4f28e3f4a9baf89a42859429fa0f0558d9e63c4f on all 17 jobs. `git diff 4f28e3f ada3b83 --stat` shows only verification.md. No code file is added.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | done_when 1 ("only the harness footer or background-agent lines change"); spec Edge cases ("A long agent list … while it is within the 15 captured lines") | docs/devteam/scripts/devteam.mjs `paneBody` | The incident pane wraps its input over 9 lines. With 6 or more agent lines under the footer, the 15-line capture leaves fewer than 8 body lines, so one more agent line moves where the body window starts and changes the digest. Checked with the sb-pane.txt shape: the digest is the same with 4, 5 and 6 agents and changes at 7. The rescue then ends while the text is still stuck. The spec puts a bigger capture out of scope, so this is only a known limit. A digest of only the body lines next to the rule, or a count that doesn't change when the window shrinks, would close it. | wont-fix known limit: the spec keeps the 15-line capture out of scope; logged as an observation for a follow-up |
| F2 | Minor | done_when 3; task-1.md T1-1's disposition | test/accounts.supervisor.test.mjs, busy loop | `assert.ok(fs.existsSync(sent))` doesn't tell a skipped press from a made one. A press on try 1 keeps the record too, with `tries: 1`. So the only check against a press into a busy pane is `s.keys() === ''`, read straight after the tick, and that read races the key reaching the stand-in. The guard mutation was caught on this run, and the older "left alone" cases use the same pattern. Also asserting `json(fs.readFileSync(sent)).tries === undefined` would catch a press without depending on timing. | wont-fix after the final verdict no code changes; the keys check matches the existing left-alone cases and caught the guard mutation |
| F3 | Suggestion | none | docs/devteam/scripts/devteam.mjs, the comment above `PANE_RULE` | "The body is the last 8 lines above the last rule": the rule line itself is in the body (`end = i + 1`) and counts toward the 8. | wont-fix cosmetic comment wording; a code edit would void the final verdict |

Verdict: APPROVE ada3b836348a372078e12dada231845839f0c489
