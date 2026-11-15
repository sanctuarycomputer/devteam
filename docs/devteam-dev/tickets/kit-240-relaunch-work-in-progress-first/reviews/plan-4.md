# Plan review, pass 4

- Reviewer: reviewer-d (fresh subagent, claude-opus, cold confirm)
- Reviewed: cac6c29c33c121751807621ddb6b2a181e9dbd65 (plan.md and spec.md, diff since 05a9473)

Pass-3 checks.

Plan F3-1 is resolved. `hasSetup` for a worker is now `repoReadable(repoOfTicketLink(t)) ? repoOfTicket(t).settings.worktree_setup : true`. I traced each call to see whether it can reach `die`:

- `t` is always defined. `launchOf` returns `['worker', name]` only when `tickets().has(name)` (devteam.mjs:14254), and `sessionsToRelaunch` keeps only names whose launch is non-null (12728). So the "missing ticket" case from pass 3 can't come up, and dropping "a throw counts as true" leaves nothing uncovered.
- `repoOfTicketLink(t)` can't die. It is `componentLink(t.component, committedComponents())` (2523, 991). `componentLink` is `ownEntry(s.components, name)?.link ?? 'home'`. `ownEntry` (8224) is `Object.hasOwn` guarded, so a ticket whose component has no line, or has no component at all, gets `'home'`. `committedComponents` is `mainSettings(null) ?? loadSettings()`, and `mainSettings` reads with `settingsAt(..., { orNull: true })`. The tick already calls `loadSettings` throughout, so the fix adds no new way to fail.
- `repoReadable(name)` (2527) is `true` for home. For a link it checks the same things `linkRepo` dies on (2486-2491): `ownEntry(loadSettings().links, id)` exists, `hostsComponents` is set, and `reachable` returns null. `reachable` (902-915) tests the same `linkLocation(id)` existence and the same `remoteKey(origin) === remoteKey(link.remote)` check, against the same working-tree `loadSettings().links` that `linkRepo` uses. So when `repoReadable` is true, `linkRepo` passes all three of its `die` checks. `commonOf` and `effectiveSettings` don't die. The only gap is a checkout that disappears between the memoized `reachable` and `linkRepo` within one process, which is negligible and no worse than today's relaunch child.
- `repoOfTicket(t).settings.worktree_setup` is what `seedWorktree` (4693-4704) runs: `R.settings.worktree_setup`, with `worktree_setup` in `REPO_OWN` (790-796) and defaulting to `''`. The budget rule therefore reads the same value the resume will run.
- `tries && hasSetup(...)` short-circuits, so the first relaunch never touches a link.

Plan F3-2 is resolved. T4 now says the first relaunch has up to 100 s and a later one starts only with the full 100 s when there is a `worktree_setup`. Spec F3-1 is resolved: the header names kit-202, kit-239 and kit-86. The spec's added clause ("after `repoReadable`, since `repo()` exits on an unreadable link") matches the plan. The fix introduces nothing new. It adds no test for an unreadable link, and the plan says so. The guard is a pure read and is checked in task review, which is acceptable for an S chore.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F4-1 | Minor | accuracy | plan.md T4 ("the first relaunch of a tick has up to 100 s; when its repo has a `worktree_setup`, a later one ...") | As the sentence is written, "its repo" reads as the first relaunch's repo. The rule (spec, T3 `hasSetup(name, ...)`) is about the later session's own repo. When writing §11, say "a later one whose repo has a `worktree_setup` starts only if the full 100 s are left". | |

Verdict: APPROVE cac6c29c33c121751807621ddb6b2a181e9dbd65
