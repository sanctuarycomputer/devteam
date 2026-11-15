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

1. **What the frame loaded.** `TS.fp` stays the fingerprint the open frame loaded. A new `TS.fpNow` holds the latest fingerprint seen for the same `slug`/`at`.
2. **Checking, on the normal poll.**
   - Dashboard: after each `/api/data` read is drawn, if the stage shows an artifact at `main` or a draft, `fpNow` is the fp of the Library row with that slug and `at`.
   - Viewer tab: every 10 s while the tab is visible, if the stage shows an artifact at `main` or a draft, it asks `/api/view` (the same ask it boots with) and takes its `fp`. A 404, an error or no answer leaves `fpNow` as it was.
   - A `tree:` version never changes: never checked. A preview: never checked.
3. **The hint.** When `TS.fp` and `TS.fpNow` are both known and differ, `#av-reload` gets the class `stale`: a 2 px `var(--amber)` outline (light and dark by the token), and its title becomes "A newer version is ready: reload to see it". Otherwise the class is off and the title is "Load the page again".
4. **Reload.** Pressing `#av-reload` on an artifact reloads the frame as today, then sets `TS.fp = TS.fpNow` (and `TS.mainFp` too when `at` is main) and clears the hint. Nothing reloads by itself.
5. **Switching.** Opening another artifact, version or a preview resets `fpNow` (`tsSet`), so the hint goes.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | While the viewer is open, the dashboard checks the artifact's fingerprint (as /api/view or describe reports it, for main or the draft shown) on its normal poll; on a difference from what the frame loaded, reload gets an orange outline (`--amber`, light and dark) and a title saying a newer version is ready | browser test: viewer tab and dashboard stage on a draft, file changed, `#av-reload` has `stale`, its computed `outline-color` is the `--amber` value, its title says a newer version is ready; before the change it has none |
| 2 | Pressing reload loads the new version and clears the outline; nothing reloads by itself | browser test: before the press the frame's lens still reports the old title; after it, the new one, and the class is off |
| 3 | A dashboard test: open a draft, change its file, outline within one poll; press it, outline goes, frame shows the change | the test in `test/dashboard.test.mjs`, waiting at most one poll (10 s) plus the read's time |
| 4 | test.yml passes on every job; no file is added | CI at the head; `git diff --name-only --diff-filter=A origin/main` lists only this ticket's records |

"The frame shows the change": the frame is opaque-origin, so the test reads what the artifact's lens tells the stage (`ready` carries the page's `document.title`); the draft's change is to its title.

## Contracts

None provided or changed. Consumed: `/api/view` (artifact kind) and `/api/data`'s `library.artifacts[].fp`, unchanged.

## Edge cases

- A draft whose fingerprint equals main's is absent from the Library rows: the dashboard has no `fpNow` for it and shows no hint (the viewer tab, which asks `/api/view`, does). A draft opened from the Library is listed, so the usual case works.
- A draft removed while open: the dashboard finds no row, the viewer tab gets a 404; neither changes the hint.
- The fingerprint taken at open can be a poll older than the file the frame fetched; the hint then shows once though nothing is newer, and one reload clears it. Accepted.
- `/api/view`'s comment in `devteam.mjs` says the ask is "never polled". The viewer tab now asks it every 10 s while visible (one `artifact describe` child per ask, shared by concurrent asks). That file is outside touches; the comment goes stale until kit-106's `/api/artifact-fp` replaces this poll. Told to the supervisor in the review request.

## Out of scope

Live reload (kit-106), keeping the scroll position across reload, a cheaper fingerprint endpoint, any change to `devteam.mjs`.

## Rulings

None yet.
