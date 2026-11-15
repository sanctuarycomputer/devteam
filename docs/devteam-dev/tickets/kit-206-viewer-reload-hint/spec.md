# kit-206-viewer-reload-hint: spec

The artifact viewer's reload button shows an orange outline when the artifact changed since it was loaded.

## Why

The owner's ask (supervisor's terminal, 2026-11-15 01:25): until drafts reload live (fast-threads kit-106), the reload button should say when a reload is needed. The owner iterates on a draft by looking at it; today nothing tells them the draft on screen is behind the one on disk. When kit-106 lands, its live reload supersedes the outline (the supervisor told fast-threads so in m-20261115-012648683-supervisor).

## How it works today

- The stage (`#artifact-view`) shows an artifact in `#av-frame` through `showArtifact(slug, at, { fp, mainFp })`, which records the fingerprint of what it shows in `TS.fp` (`index.html` ~3559). `#av-reload` reloads the frame by clearing and resetting its `src` (~3669).
- Two hosts:
  - **The dashboard** (`#artifact/main/<slug>`, `#artifact/wt/<worktree>/<slug>`): `openArtifact` takes `fp` from `DATA.library.artifacts` (the `/api/data` poll, every 10 s, `load()`). Nothing updates `TS.fp` afterwards.
  - **A viewer tab** (`/view/artifact/<slug>?at=…`): `viewerArtifact` takes `fp` from `/api/view` (which runs `artifact describe --json`), once. The tab polls `/api/threads` every 5 s and `/api/hello` every 30 s, never `/api/data`.
- The Library's draft rows (`draftArtifacts`) list a draft only when its fingerprint differs from main's.
- `--amber` is the warning colour token, defined for light and for dark (`prefers-color-scheme: dark`).

## The change

1. **What the frame loaded.** `TS.fp` (and `TS.mainFp`) stay the fingerprints of what the open frame loaded. New `TS.fpNow` and `TS.mainFpNow` hold the latest seen for the stage's `slug`/`at`; `showArtifact` starts them equal to `fp`/`mainFp` when it sets the stage up (`tsSet`), so they are never behind what was loaded (spec-1 F1).
2. **Checking, on the normal poll.**
   - Dashboard: after each `/api/data` read is drawn, if the stage shows an artifact at `main` or a draft, `fpNow` is the fp of the Library row with that slug and `at`, and `mainFpNow` the fp of its main row. A row that is absent changes nothing.
   - Viewer tab: every 10 s while the tab is visible, if the stage shows an artifact at `main` or a draft, it asks `/api/view` for `TS.slug` and `TS.at` (what the stage shows, which after a fallback is main, not the address's `at`) and takes `fp` and `main_fp`. One ask in flight per tab: a tick while one is pending is skipped. A reply for a stage no longer shown (another slug or `at`) is dropped. A 404, an error or no answer changes nothing (spec-1 F2, F7).
   - A `tree:` version never changes: never checked (so the owner wrapper, which shows only trees, never polls). A preview: never checked.
   - `viewerBoot`'s comment ("Nothing else: a dozen viewer tabs cost a dozen cheap reads") is rewritten to say a tab showing main or a draft also asks `/api/view` every 10 s while seen: one `artifact describe` per ask. The new poll's names avoid `route`, `render`, `load`, `loadNow` and `loadSchemaDocs`, which the existing viewer test forbids in `viewerBoot` (spec-1 F8).
3. **The hint.** When `TS.fp` and `TS.fpNow` are both known and differ, `#av-reload` gets the class `stale`: a 2 px `var(--amber)` outline (light and dark by the token), and its title becomes "A newer version is ready: reload to see it". Otherwise the class is off and the title is "Load the page again".
4. **Reload.** Pressing `#av-reload` on an artifact reloads the frame as today, then sets `TS.fp = TS.fpNow` and `TS.mainFp = TS.mainFpNow`, each only when the newer one is known, and clears the hint. Nothing reloads by itself.
5. **Switching.** Opening another artifact, version or a preview resets both (`tsSet`), so the hint goes.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | While the viewer is open, the dashboard checks the artifact's fingerprint (as /api/view or describe reports it, for main or the draft shown) on its normal poll; on a difference from what the frame loaded, reload gets an orange outline (`--amber`, light and dark) and a title saying a newer version is ready | browser test: viewer tab and dashboard stage on a draft, file changed, `#av-reload` has `stale`, its title says a newer version is ready, and its computed `outline-color` equals the computed `color` of a probe element styled `color: var(--amber)`, checked in light and again under `Emulation.setEmulatedMedia` with `prefers-color-scheme: dark`; before the change it has no `stale` (spec-1 F3) |
| 2 | Pressing reload loads the new version and clears the outline; nothing reloads by itself | browser test: before the press the frame's lens still reports the old title; after it, the new one, and the class is off |
| 3 | A dashboard test: open a draft, change its file, outline within one poll; press it, outline goes, frame shows the change | the test in `test/dashboard.test.mjs`. "Within one poll" is met by the first read that starts after the change; a read already in flight may carry the old fp, so the test waits at most two poll periods plus the read's timeout (2 × 10 s + 12 s) (spec-1 F5). It also presses reload before the first check, then changes the file, and the hint still comes (spec-1 F1) |
| 4 | test.yml passes on every job; no file is added | CI at the head; `git diff --name-only --diff-filter=A origin/main` lists only this ticket's records |

"The frame shows the change": the frame is opaque-origin, so the test reads what the artifact's lens tells the stage. Its `ready` message carries the page's `document.title`, the `<title>` in the draft's `index.html` (not `artifact.json`'s title), and the stage keeps none of it for an artifact, so the test adds its own `message` listener on the stage page and waits for a `ready` with the new `<title>` after the press. No production state is added for the test (spec-1 F4).

## Contracts

None provided or changed. Consumed: `/api/view` (artifact kind) and `/api/data`'s `library.artifacts[].fp`, unchanged.

## Edge cases

- A draft whose fingerprint equals main's is absent from the Library rows: the dashboard has no `fpNow` for it and shows no hint (the viewer tab, which asks `/api/view`, does). A draft opened from the Library is listed, so the usual case works.
- A draft removed while open: the dashboard finds no row, the viewer tab gets a 404; neither changes the hint.
- The fingerprint taken at open can be a poll older than the file the frame fetched; the hint then shows once though nothing is newer, and one reload clears it. The same holds at reload: a file changed after the last check and before the press is on screen while `TS.fp` names the version before it, so threads drawn then carry that older fp and the next check shows the hint once more. Accepted for both, until kit-106 (spec-1 F6).
- `/api/view`'s comment in `devteam.mjs` says the ask is "never polled". The viewer tab now asks it every 10 s while visible (one `artifact describe` child per ask, shared by concurrent asks). That file is outside touches; the comment goes stale until kit-106's `/api/artifact-fp` replaces this poll. Told to the supervisor in the review request.

## Out of scope

Live reload (kit-106), refreshing the viewer bar's title after a reload, keeping the scroll position across reload, a cheaper fingerprint endpoint, any change to `devteam.mjs`.

## Rulings

None yet.
