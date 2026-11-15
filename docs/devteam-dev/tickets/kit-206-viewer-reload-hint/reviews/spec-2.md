# Spec review, pass 2

- Reviewer: spec-reviewer 2 (fresh subagent, claude-opus)
- Reviewed: 9d399cedb60788ceae2ec9540221f4395f3830c1 (spec.md)

Sources read: `ticket show kit-206-viewer-reload-hint`, the spec and `reviews/spec-1.md` at 9d399ce, and quality.md §3. In `index.html`: the tokens (~34, ~42), `#av-reload` (~779, ~3669), `TS`/`tsSet`/`showArtifact` (~3543-3575), `openArtifact` (~3638), `route` (~3685), `tArtFpNow` (~4622), `tsSubject` (~5090), the frame `load` and lens `ready` handlers (~5171-5200), `holding`/`drawOrHold`/`load`/`loadNow` (~5232-5320), `viewerArtifact`/`viewerBoot` (~5644-5695) and the boot line (~5711). In `devteam.mjs`: `draftArtifacts` (~7382), `artifact describe` (~7544, which emits `fp` and `main_fp`), the shared `dashboardData` run (~14244), `/api/data` with `DATA_WAIT_MS` (~14377, ~11994) and `/api/view` (~14415). In `test/dashboard.test.mjs`: `POLL_FAST` (~325) and the viewer tests (~1833-2020).

Every pass-1 fix holds in the spec text:
- **F1 holds.** `fpNow`/`mainFpNow` start equal to `fp`/`mainFp` through `tsSet`, reload copies only a known value, and acceptance check 3 includes the press-before-first-check case.
- **F2 holds.** The tab asks for `TS.slug`/`TS.at`, so after a fallback it asks for main, and a reply for a stage no longer shown is dropped.
- **F3 holds.** The colour check compares against a probe element styled `color: var(--amber)`, in light and again under emulated dark.
- **F4 holds.** The test reads the draft's `index.html` `<title>` through its own `message` listener, so no production state is added.
- **F6 holds.** The reload-time race is accepted in Edge cases.
- **F7 holds.** One ask in flight per tab.
- **F8 holds.** The `viewerBoot` comment is rewritten, and the forbidden names are avoided (`\bload\(` does not match a name like `reload(`).
- **F9 holds.** `mainFp` follows on reload.

Existing tests the change touches:
- The existing viewer test's "nothing else" assertion already allows `/api/view?`, so the new ask does not break it.
- The 500 and network-error fault tests inject the fault on every `/api/view` call, so the poll leaves them unchanged.

No Critical or Important issue found: touches are respected; the `tree:` and preview exclusions keep the owner wrapper from polling; the title change is plain words, so V and R checks are unchanged from pass 1. What remains is two Minors (N1, the timing bound F5's fix added uses the wrong constant; N2, one edge case described incompletely) and two robustness suggestions (N3, N4).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Minor | done-when 3 ("within one poll"); quality.md §3 (a test that can flake) | spec, Acceptance check 3; `devteam.mjs` `dashboardData` ~14248 (`dataRun ??=`), `/api/data` ~14380 (`DATA_WAIT_MS`, 20 s) | On the dashboard, "met by the first read that starts after the change" is not true: `/api/data` shares a `dashboard-data` run already in flight, and a run slower than `DATA_WAIT_MS` (20 s) is answered stale with the old fp. "12 s" is `/api/view`'s describe timeout, not anything on the `/api/data` path. Restate as "the first `dashboard-data` run that starts after the change", size the dashboard's wait from `DATA_WAIT_MS` and `READ_GIVE_UP_MS`, and say whether the test uses `POLL_FAST` (which would also make the viewer tab ask `/api/view` every 300 ms). | taken in the plan: the test does not use `POLL_FAST` (real 10 s polls); the dashboard waits up to 2 × 10 s + `DATA_WAIT_MS` (20 s) + 5 s, the viewer tab 2 × 10 s + 12 s + 5 s; met by the first `dashboard-data` run (or `/api/view` ask) that starts after the change |
| N2 | Minor | done-when 1; spec Edge cases, first bullet | spec Edge cases; `openArtifact` ~3647; `draftArtifacts` ~7395 | A draft equal to main opened on the dashboard keeps `TS.fp` null, so after an edit (now listed, `fpNow` known) the "both known" rule never shows the hint for that open. Say it plainly as accepted, or at open take main's fp for a draft whose row is absent while main's is present. The test should open a draft that already differs from main. | taken in the plan: `openArtifact` takes main's row's fp for a draft whose own row is absent while main's is present (absence means equal to main); the test's draft differs from main at open |
| N3 | Suggestion | none (robustness) | spec "The change" 2, viewer tab | The one-in-flight ask has no client-side timeout; a fetch that never settles stops all later checks in that tab. Abort a little past 12 s. | taken in the plan: the ask aborts after 15 s |
| N4 | Suggestion | none (taste) | spec "The change" 2, dashboard; `drawOrHold` ~5253 | "After each `/api/data` read is drawn" skips reads `holding()` holds back; take `fpNow` from each read as it arrives in `loadNow`. | taken in the plan: `loadNow` reads the raw `d`, held or drawn |

Verdict: APPROVE 9d399cedb60788ceae2ec9540221f4395f3830c1
