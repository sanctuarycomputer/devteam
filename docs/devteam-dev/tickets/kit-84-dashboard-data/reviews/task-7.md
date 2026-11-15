# Task 7 review, pass 1

- Reviewer: task-reviewer-7 (fresh subagent, claude-sonnet-5-5)
- Reviewed: 1513b9d85cb0b90d791586ae72a2a32b96cabcd4

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T7-1 | Minor | ruling m-20261115-201425507 ("additions only") | test/fixtures/g1/dashboard-data.txt | The diff is not literally additions only: 30 lines are removed and re-added with a trailing comma, because a key was appended after the previously-last key of a pretty-printed object. This is the unavoidable JSON shape, but a final reviewer reading `git diff --stat` ("30 deletions") will see it. The PR description should say that the 30 deletions are comma-only. | |
| T7-2 | Minor | G1 golden hygiene | test/fixtures/g1/dashboard-data.txt, settings_all (agent_command, resume_command) | Hidden kinds have `value: null` as required, but the `default` field of the hidden `agent_command` and `resume_command` entries carries the framework default command text ("claude --dangerously-skip-permissions", "claude --continue --dangerously-skip-permissions"). These are public framework defaults, not secrets, and the `set` flag is separate, so nothing leaks. Confirm that exposing defaults for hidden kinds is intended. If the dashboard should never show a raw command, null the default for hidden kinds too. | |

Checked:
- Only test/fixtures/g1/dashboard-data.txt changed in 1513b9d (`git show --stat`: 1 file, 685 insertions, 30 deletions).
- Removals checked independently with my own script over the whole old and new files, not the controller's checker. Every one of the 968 old lines appears in order in the 1623-line new file, either unchanged or as the same text plus ",". 30 lines took a comma and 0 are missing, so nothing was reordered or changed. All 30 `-` lines in the diff lack a trailing comma, which agrees. 968 + 655 net additions = 1623.
- Added keys, counted from the diff: class_words (1), class_name (28), held_by (2), threads (you, waiting, ready), upkeep_days (14 items/failed pairs, no *_at keys), settings_all (1 array of 44 entries, with key/group/name/description/shown/value/set/default/owner_only each 44 times), and the plain-word rung learning_marks labels (recovery, drain, undrain, ...). The rung and history lines in the diff are comma artifacts. Nothing outside the listed fields was added.
- Unstable values: grepped added lines for dates, /home, /tmp, /data, localhost, ports and pid. The only hit is the key name `machine_memory_ceiling` (value 0.8). No timestamps, paths, ports or pids. `project` is "g1" and `worktree_files` is the fixture's "config/dev.key", a name and not a secret.
- settings_all hidden kinds (agent_command, resume_command, agent_trust_command, worktree_setup, usage_command, upstream_repo) all show `value: null`. Count kinds show only counts (sensor_scrub 0, secret_commands 0). Names kinds show names or empty lists. worker_denied_commands shows the framework default deny patterns (a public default). The one caveat is T7-2.
- G1 test without record: `gate test -- node --test --test-concurrency=2 --test-name-pattern '^G1' test/components.test.mjs` exited 0 (1 pass, 6 skipped, 0 fail; "gate test passed").

Verdict: APPROVE 1513b9d85cb0b90d791586ae72a2a32b96cabcd4
