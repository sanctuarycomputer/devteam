# Final review, pass 2

- Reviewer: final-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 0c02ae84b3aee30e70058bc65cf79d0e7915214a (fix diff from 794a96d7, cold confirm)

I read the rules, quality.md §3, final-1.md with its dispositions, spec.md's last Rulings line (m-20261116-095757248), the amended done-when 3 (`ticket show`), the fix brief and report, and the diff 794a96d7..0c02ae84. Apart from code commit 8f405c7, the diff adds only the final-1 record, its dispositions and the spec's ruling line. 8f405c7 touches only `docs/devteam/dashboard/index.html` (lines 2765 to 2972, outside both frozen blocks) and `test/dashboard-pages.test.mjs`, both in touches. The new top-level names `FLEET_DRAWN` and `CHECK_PRESSED` are not in the shell block. I ran `test/dashboard-pages.test.mjs` in review worktree `final2` at 0c02ae84 on /usr/local/bin/node v22. The baseline gave exit 0, 6/6 passing, 0 skipped. Then I ran one mutation run that put `el.innerHTML === want` back in `drawFleet` and dropped Check now's `disabled`. It failed exactly as expected: "settings area" with "two redraws keep the switch node while it is busy", and "settings page" with "timed out waiting for Check now disabled while out". I removed the worktree afterwards.

**F1, ADDRESSED.** `readyCard` now draws the card on a running fleet too, with the "Fleet" row, the readiness badge, each blocker and the parity. It also draws it while parked or drained, with the "Held" row. Check now sits in the card head with the mock's markup (`ghost mini`, `data-checknow`, "Check now"). The click handler calls `loadFleet(true)` once. `loadFleet` redraws with the button disabled before the request goes out, and the click guard also checks `FLEET.busy`. A non-ok answer or a throw sets `FLEET.error`, which shows on the card as `.err` with `role="alert"`, and a good answer clears it. Check now pressed while another read is in flight can't fire: the button is disabled, and the handler re-checks `FLEET.busy`. Arriving on Settings already queues a fetch through `wantFetch`, so no check is lost. The tests prove each of these:
- the running-fleet card's blockers, badge, parity and button;
- exactly one `/api/fleet?fetch=1` GET per Check now (`__gets` filtered on `/api/fleet`);
- the button disabled while the read is held (the mutation confirms this) and enabled afterwards;
- the fresh answer drawn;
- a 500 shown on the card, kept across `render(DATA)`, and cleared by a good check;
- the card while draining, with its blockers;
- the parked card with one button, Check now.

Only the two assertions the ruling supersedes changed: "no Ready to move? while the fleet runs" and "no button in Ready to move?". They now assert the new behaviour. No other assertion was weakened.

**F3, ADDRESSED.** `drawFleet` compares each slot with `FLEET_DRAWN.get(el)`, the string it last wrote, and nothing else writes a `data-fleet-slot` element. The busy-state test fails when the fix is reverted.

**F2, AGREED.** The supervisor accepted the waits by ruling m-20261116-095757248, and no assertion changed.

**F4, AGREED.** The bound is the server's own allowlist, 1 to 20, and `/api/data` serves no maximum to read. The spec line holds in substance.

Neither new finding blocks.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | done-when 3 as amended ("Ready to move? (fleet status) at all times, with Check now refetching it") | docs/devteam/dashboard/index.html:2905, :2908 | After a failed check, `FLEET.data` stays as it was. The card shows "Couldn't check: …" next to the old badge (possibly a green "ready to move"), the old blockers and the old parity, and nothing marks them as from an earlier check. The error is visible, so the owner can tell, but the badge reads as current. Main's strip also kept the old data on failure, so this is no regression. | fixed in 667a545: after a failed check the badge goes neutral (last check failed; this is from <when>), never green, with a test |
| F2-2 | Suggestion | none | docs/devteam/dashboard/index.html:2944 | Once the Check now read ends, focus goes back to Check now when the active element is the body, or any element inside `#settings`. So if the owner tabbed to a limit control while the read was out, focus is pulled back to Check now. Restoring only when focus is still on the body would leave that control alone. | fixed in 667a545: focus returns to Check now only if the owner has not moved it |

Verdict: APPROVE 0c02ae84b3aee30e70058bc65cf79d0e7915214a
