# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 22b9cae7d851cca6be2d6cf7d51981c70ca80247 (spec.md, the pass-1 fixes)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | spec.md:103 (its own claim), spec-1 F1-5 | spec.md:103; plan.md:244 vs plan.md:266 | The new landed rule doesn't do what its last sentence claims. Take main at 5, the owner asking 7, and the supervisor running `settings set max_active_tickets 5` (no `--for`, so the file is unchanged), then an unrelated settings chore merging. Main holds 5, the merge act is newer, and the merged head's `settings.md` holds 5, so the edit counts as landed. Yet the spec says "a no-op edit followed by an unrelated settings merge doesn't count". The plan inherits the contradiction: its test 7 (plan.md:244) expects null "because the merged head's file doesn't differ by this edit", which is a diff rule, while its `landedOverride` (plan.md:266) is the spec's value rule and returns the edit. Either outcome is defensible: a no-op edit is the supervisor keeping main's value, which is in force, so "Set by the supervisor (you asked for 7)" is true. But the spec must pick one. Drop the sentence and say a no-op edit counts, or require the merge to change the key between the merge's base and its head. | |
| F2-2 | Minor | spec.md:103 ("A head git can't read doesn't count"), done-when 4 | spec.md:103; devteam.mjs:5206 (gh pr merge with merge_method), :5214 | The landed rule reads a historical head sha on every `metrics` and `/api/data` run. With `merge_method` `merge` (the default) the head is a parent of main's merge commit, so it stays readable. With `squash` or `rebase`, or in a fresh clone that never fetched the chore branch, the head becomes unreachable once gc prunes it or the branch is deleted. A landed override then stops counting, the finding is raised again, and the label falls back to "Saved; applies once the supervisor lands it" weeks later for a value the supervisor chose and main holds. This doesn't cross R1, since nothing is shown as the owner's, but it is a false nag. Say what happens off `merge`, or record the edit's landing at merge time (for example, `merge --chore settings` notes the `settings-edit` ids its head carries) so nothing has to read the old sha later. | |

**F1-1 (Important): confirmed fixed.** spec.md:31 adds the refusal check (no dashboard channel, stdin not a TTY, so nothing written), and spec.md:71-72 put the check after `ownerWriter`. `ownerActionEnv('dashboard')` (devteam.mjs:12005) sets `DEVTEAM_CHANNEL=dashboard` for the route's child, so the save path still passes. An agent's shell tool has no TTY and no such channel, so the confused path outside tmux, or before the pane is marked, is closed. The P6 line names deliberate forgery as undefended.

**F1-2 (Important): confirmed fixed.** Acceptance 1, the CLI contract and the schema bullet now use the envelope `at` only. The "at is written explicitly" decision is gone, and the schema adds only `key`, `value` and `for`.

**F1-3 (Important): confirmed fixed by ruling.** `m-20261115-200302226` (a) gives the No limit control to `kit-87`. The ruling is cited in Rulings, and acceptance 8 provides only the route (`value: null`) and `shown`. By the brief, the supervisor's ruling is authoritative.

**F1-4: confirmed fixed.** Acceptance 8 lists the readers in devteam.mjs. I grepped every `max_active_tickets`, `max_active_per_component` and `incident_slots` read (3836, 3841, 10301, 11568, 11569, 11571, and 11835 `caps`, which stays) and found nothing missing. The "(+N for fix tickets)" suffix and the fix-ready idle-capacity line have stated behaviour. `index.html:4667` is `kit-86`'s per ruling (b).

**F1-5: partly fixed.** The rule now ties the landing to the merged head's file, which closes "an edit in a worktree that never merged and holds a different value". But the no-op case the finding named is still counted, against the spec's own sentence (F2-1). The new reliance on the old sha adds F2-2.

**F1-6: confirmed fixed.** The CLI requires `proof.port` to equal `run/dashboard-port` (spec.md:73), and the edge case at spec.md:123 states where each port comes from.

**F1-7: confirmed fixed.** The body must be exactly `{key, value}` and at most 512 bytes. Its base64 in the proof stays well under `LINE_MAX` 4096, and the edge case at spec.md:122 covers an extra field.

**F1-8: confirmed fixed.** The label text follows the done-when ("Saved; applies once the supervisor lands it"), `kit-87` shows N from `asked`, and the no-limit form of the second label is given.

**F1-9: confirmed fixed by ruling (c).** `settings-edit` is the supervisor's own act, written with no `authorise()` and no decision line, and corrected like any act. The constitution.md change is a follow-up the supervisor asks after the merge.

**F1-10: confirmed fixed.** `asked` is always present, `act: null` means never asked, and the check after the edit is spelled out (no repeated key, the edited key equals the new value, every other top-level key canonical-equal).

Values and refusals: the fixes don't change pass 1's answers, except that they close its gaps. P6 now stops the accidental laptop path (F1-1) and the CLI's cross-project proof (F1-6). No refusal is crossed: R1 holds, because neither F2 finding shows a value as the owner's that the owner didn't choose, and R2 holds with the label texts settled.

Verdict: APPROVE 22b9cae7d851cca6be2d6cf7d51981c70ca80247
