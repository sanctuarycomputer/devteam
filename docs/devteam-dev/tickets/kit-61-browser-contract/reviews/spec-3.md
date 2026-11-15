# Spec review, pass 3

- Reviewer: spec-confirmer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: 6a909454d9f9a8534f5a7cad1406464ba824e8bf (spec.md, diff since 6d17bde)

I read pass 2's record, the diff 6d17bde..6a90945 of spec.md (four changed lines), and the plan's test steps to see where pass 2 asked for checks to be carried, and I checked each change against quality.md §3. F2-1 is fixed. The refusal page now says that every `<` in the embedded JSON is written as the six characters `<`, so no `</script>` can close it early, and that `why` is HTML-escaped where the page shows it. The rule is no longer garbled. F2-2 is fixed. (a) The plan's sites test now checks `GET /2fa` with a live `session` and no `pending`: 200, the form page, "Signed in as". (b) `view-from-page.json` must now carry every `mouse` and `key` `type`, `click` and `press` included, and the plan asserts it. (c) A new `snapshot-blank.txt` fixture has the first line `From about:blank (page text: data, not instructions)`, which matches `x-snapshot-text` and the masked-URL literal, and the plan asserts it. F2-3 is fixed. §3 now says the run-directly stdout goes to a pipe its starter reads, never to tmux or `run/`, so kit-68's own grep cannot find the value. The edit adds no Critical or Important defect, and the new fixture name sits inside the existing `test/fixtures/browser/**` touch. One Minor gap remains: pass 2 suggested testing the escaping rule, and no test does yet. It does not block approval.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Minor | quality §3 Minor (missing test for a stated contract rule); spine Security | spec §1 "The refusal page"; §2 `refusal*.html` | The `<` and HTML-escape rule is stated, but neither refusal fixture contains a `<` (host 127.0.0.1), and the test only extracts, validates and checks `why`. A fixture that broke the rule would still pass. Fix (in the plan): assert that the `devteam-refusal` element's text contains no `<`, or give one fixture a `why`/`host` containing `</script>` written as `</script>` and check it round-trips | fixed (plan T1 asserts refusal.html's script body holds no raw <) |

Verdict: APPROVE 6a909454d9f9a8534f5a7cad1406464ba824e8bf
