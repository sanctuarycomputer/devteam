# kit-275 final review 1

- Reviewer: kit-275 final reviewer
- Reviewed: 7b94ab0cbce92fb7644460ab8854740f90cae658

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality.md §3 (CI at head) | PR #323 checks at 7b94ab0c | CI for the head was still pending when I reviewed. The head differs from the green run 44078649675 (c0e53a84) only by records under docs/devteam-dev/. The supervisor should confirm the head's run is green before merge. | |

## What I checked

- Done-when 1: the diff shows R100 for both renames into test/contracts/. Neither old path exists at the head.
- Done-when 2: a grep of the whole tree for the old paths and for bare shell.md / browser.schema forms finds hits only under test/contracts, the new-path forms, the 5 expected bare hits in test/dashboard-shell.test.mjs, the two readers, and the merged records in docs/devteam-dev/tickets (history, not edited).
- Ruling d-20261117-111122002: the 4 block comment lines (index.html 47/1168, hub.html 31/402) changed to test/contracts/shell.md. The index and hub lines are byte-identical, and nothing else in the blocks changed. The other index.html edits are comment-only mentions outside the blocks.
- CSP: I recomputed the sha256 of browser.html's single inline script and its style. The script hash is DDpsdbxQXFZ9wLTGXW9F8PnmQ068Ay5c5txm2XpplTw=, which matches the page's script-src. The style hash is unchanged and matches.
- Mutations: I reran M2 (bindFleetSwitch renamed in shell.md; dashboard-shell red, 15 pass 1 fail) and M3 (the "browser" key deleted from state.json; browser-contract red, 3 fail). Both bit, and I restored both files. The baseline dashboard-shell and browser-contract run was green with 0 skipped.
- Owner rule: files added outside test/ are only the ticket's own records folder. No other new file or folder.
- Changes since 989b2160 outside docs/devteam-dev: none, so the code is final.
- CI: gh pr checks 323 showed all jobs pending at the review time (see F1).

Verdict: APPROVE 7b94ab0cbce92fb7644460ab8854740f90cae658
