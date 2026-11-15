# kit-46-standalone-hub: final-2 (pass 2, cold confirm)

- Reviewer: final-2b (fresh subagent of the supervisor, claude-sonnet; the cold confirm of track b, final-1b F1. Same review as final-2.md, filed under track b by the supervisor, who misnamed it)
- Reviewed: efd8ea9e63b7b5fc91ee218ad3124d0abd47cfc2 (diff since 4513dc5)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| (none) | - | - | - | No findings. F1 from final-1b is fixed. | n/a |

## What I checked

1. Diff 4513dc5..efd8ea9 (--stat, then full diff outside docs/devteam-dev/): code change is only `startHub(log, { kit: ownKitVersion() })` in cmdDashboard, the startHub comment reworded to match, and one new test in test/hub-overview.test.mjs. The rest is two review records (final-1.md, final-1b.md) under the ticket's reviews folder.
2. ownKitVersion() (line 13864) returns kitVersion() only when `settings.md` exists in projectDir and kitDir is inside mainRoot, else null. This is exactly spec §2 (own kit reports its release, done-when 1; a kit from outside the project, e.g. the image's or via DEVTEAM_HOME, reports null). kitVersion() returns the upstream tag (not null) when kitDir is outside mainRoot, so before the fix a foreign kit would have named a release; the new test runs an imageKit copy (in a temp dir, outside the project) with `dashboard` and asserts `list.kit === null` and no `image`, so it fails without the fix. The own-kit case stays covered by the existing dashboard test (kit equals hello --json kit). I ran the named test in a detached worktree (env scrubbed as instructed): both matching tests passed (2 pass, 0 fail). Worktree removed.
3. The change only alters the string passed as `kit`; startHub's handler, press checks, writes and cwd are untouched, so no new path for presses or writes.
Verdict: APPROVE efd8ea9e63b7b5fc91ee218ad3124d0abd47cfc2
