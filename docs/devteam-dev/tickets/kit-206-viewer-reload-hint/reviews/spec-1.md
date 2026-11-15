# Spec review, pass 1

- Reviewer: spec-reviewer (fresh subagent, claude-opus)
- Reviewed: 5f3e192f35bef54fd195680ca94187e03c511040 (spec.md)

Sources read: the spec, `ticket show kit-206-viewer-reload-hint` (four done-whens; touches are `index.html` and `test/dashboard.test.mjs`), and quality.md §3. In `index.html`: the tokens (~30-45), the `#av-reload` markup (~779) and handler (~3669), `TS`/`tsSet`/`showArtifact` (~3543-3575), `openArtifact` (~3638), `tArtFpNow` (~4622) and its "changed since" use (~4699), `tsSubject` (~5090), the frame `load` and lens `ready` handlers (~5171, ~5191), `holding`/`drawOrHold`/`load`/`loadNow` (~5220-5320), and `viewerArtifact`/`viewerBoot` (~5644-5695). In `devteam.mjs`: `/api/data` (~14377), `/api/view` (~14415), `describing` (~13903), `artifact describe` (~7533), `artifactSource`/`artifactAt`, `diskOid`/`fingerprint` (~7184-7196), `describeArtifact`, `draftArtifacts`, the `/artifact/` response headers (`no-store`, ~14580), and ARTIFACT_LENS `hello`→`ready` (~6396). Also the viewer tests in test/dashboard.test.mjs (~1834-2020).

Every done-when is restated faithfully, and the commit adds only the spec. The approach holds up against the code:
- **`TS.fp` is what the frame loaded.** Nothing updates it after open on either host. `tsSubject` stamps new threads with it, and `tArtFpNow` compares a thread's fp with it, so keeping it fixed until reload is right. Moving it on reload makes older threads read "changed since", which is correct.
- **The dashboard has the draft's fp on every poll.** `/api/data` runs `dashboard-data` fresh on each read, and `draftArtifacts` hashes the working tree from disk (oid cache keyed by path, size and mtime), so an uncommitted edit moves the fp.
- **Reload fetches the new bytes.** `/artifact/` is served `no-store`.
- **Trees, previews and the framed wrapper need no polling.** The wrapper's gateway grants only published trees, so "never check a tree" means the wrapper never polls. Previews are reset by `tsSet('preview')`.
- **Polling `/api/view` every 10 s is acceptable as stated.** It runs only in visible tabs, the server shares concurrent asks per slug|at, and kit-106 supersedes it. The stale comment in `devteam.mjs` is named and handed to the supervisor.

Values and refusals:
- P1 (harness): not involved. Passes.
- P2 (nothing project-specific): nothing project-specific. Passes.
- P3 (decide and report): the open-time race is decided and accepted. Passes.
- P4 (owner-only asks): none needed. Passes.
- P5 (authority): not touched. N/A.
- P6 (keep it simple): the design is the simple one. Passes.
- R1 (no self-widening of authority): no authority change. Passes.
- R2 (plain owner-facing text): the new title is plain words. Passes.

The blocking defect is F1: reload copies `fpNow` into `TS.fp` without checking that `fpNow` is known, so a press before the first check erases `TS.fp`; the stage then never shows the hint again, and threads drawn on it lose their fingerprint.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | done-when 1 and 2; spec "The change" 1, 4 and 5 | spec "The change" 4; code `tsSet` ~3554, `tsSubject` ~5090, `tArtFpNow` ~4622 | Reload "sets `TS.fp = TS.fpNow`", but `fpNow` starts null (`tsSet` resets it, nothing sets it to `fp` at open) and stays null until the first check (up to 10 s), and after a 404 or error. A reload in that window, likely right after the owner opens a draft they just edited, sets `TS.fp = null`: the hint never shows for this open, `tsSubject` stops putting `fp` on new threads, and `tArtFpNow` returns null. Set `fpNow = fp` at open, or have reload copy only a known `fpNow`. Add a check: reload before the first poll, then change the file, and the hint still comes. | fixed: `fpNow`/`mainFpNow` start equal to `fp`/`mainFp` at open, reload copies only a known one, and the check is added |
| F2 | Minor | spec "The change" 2, viewer tab ("the same ask it boots with") | `viewerArtifact` ~5655-5663 | Boot asks `VIEWER.at` first and, after an unframed 404, shows main (`TS.at = 'main'`). "The same ask" read as `VIEWER.at` 404s every poll and never checks the main page shown. Say the poll asks `TS.slug` and `TS.at`, and drops a reply for a stage it no longer shows. | fixed: the poll asks `TS.slug`/`TS.at`; a reply for another stage is dropped |
| F3 | Minor | done-when 1 ("in light and dark"); quality.md §3 | Acceptance check 1 | The check reads `outline-color` in one scheme only, and `getComputedStyle` gives `rgb(...)` while the token is hex. Compare against a probe element's computed `color: var(--amber)`, and repeat under `Emulation.setEmulatedMedia` with `prefers-color-scheme: dark`. | fixed: probe element comparison, in light and under emulated dark |
| F4 | Minor | done-when 3 ("the frame shows the change") | Acceptance checks 2 and 3; lens `hello` ~6396, stage `ready` handler ~5191 | The lens reports `document.title` (the page's `<title>`), not `artifact.json`'s title; and the stage keeps nothing of `ready.title` for an artifact, so the test needs its own `message` listener. Say both, so no production `TS.title` is added just for the test. | fixed: the draft's `index.html` `<title>`; the test listens for `ready` itself |
| F5 | Minor | done-when 3 ("within one poll"); quality.md §3 (a test that can flake) | Acceptance check 3 | A `dashboard-data` run in flight when the file changes returns the old fp, and `load()` skips a tick while a read is in flight, so the hint can take longer than "10 s plus the read's time". Give the wait a margin (two poll periods plus the read timeout) and say the done-when is met by the first read that starts after the change. | fixed: wait up to 2 × 10 s + 12 s; met by the first read after the change |
| F6 | Minor | spec "The change" 4; Edge cases | spec "The change" 4 | The open-time race also happens at reload: the frame can fetch a file newer than the last `fpNow`, so new threads carry an older fp and the next poll shows a spurious hint. Accept it in Edge cases, or re-check right after a reload. | accepted in Edge cases, beside the open-time race |
| F7 | Minor | spec "The change" 2, viewer tab | `viewerBoot` ~5694; `/api/view` describe timeout 12 s | An ask can take up to 12 s, longer than the 10 s period, so two asks can overlap and an older reply land last. One ask in flight per tab. | fixed: one ask in flight per tab, a tick skipped while one is pending |
| F8 | Suggestion | existing test "it polls the threads and hello" (~1880); `viewerBoot` comment (~5666) | `viewerBoot` | The comment "Nothing else: a dozen viewer tabs cost a dozen cheap reads" becomes false and must be rewritten; and the existing test forbids `route(`, `render(`, `load(`, `loadNow(`, `loadSchemaDocs(` in `viewerBoot`'s text, so the new poll must not reuse those names. | fixed: both are in the spec |
| F9 | Suggestion | none (taste) | spec "The change" 2 and 4 | Both checks also get main's fp; updating `TS.mainFp` on reload would keep a tree thread's "changed since" right on a draft stage. The viewer bar's title also stays the boot-time one after a reload. | taken in part: `mainFp` follows on reload; the bar title refresh is out of scope |

Verdict: CHANGES 5f3e192f35bef54fd195680ca94187e03c511040
