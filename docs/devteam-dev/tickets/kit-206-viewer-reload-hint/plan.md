# kit-206 viewer reload hint: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, with test-driven-development). Steps use checkbox (`- [ ]`) syntax.

## TL;DR

- `#av-reload` gets the class `stale` (2 px `var(--amber)` outline, title "A newer version is ready: reload to see it") when the stage's artifact has a newer fingerprint than the one its frame loaded.
- `TS` gains `fpNow` and `mainFpNow`, started equal to `fp`/`mainFp` in `showArtifact`; `tsSet` resets them.
- Dashboard: after each `/api/data` read (`loadNow`, the raw `d`, not the possibly held `DATA`), the Library rows update them.
- Viewer tab: every 10 s while visible, one `/api/view` ask in flight for `TS.slug`/`TS.at` (main or a draft only).
- Reload copies the known newer fingerprints into `fp`/`mainFp` and clears the hint; nothing reloads by itself.
- One new browser test in `test/dashboard.test.mjs`, two subtests (dashboard stage, viewer tab), light and dark.
- Two tasks; only `index.html` and `test/dashboard.test.mjs` change.

**Goal:** the reload button says when the artifact on the stage is behind the one on disk.

**Architecture:** one hint function (`avHint()`) reads `TS` and sets the button; two feeders (the dashboard's data read, the viewer tab's poll) update `TS.fpNow`/`TS.mainFpNow` and call it; the reload handler moves the loaded fingerprints forward and calls it.

**Tech stack:** the dashboard's single-file vanilla JS; `node:test` with the kit's CDP Chrome driver (`test/lib/chrome.mjs`).

**Spec:** `docs/devteam-dev/tickets/kit-206-viewer-reload-hint/spec.md` (read it; this plan argues from it).

## Global constraints

- Files: `docs/devteam/dashboard/index.html`, `test/dashboard.test.mjs`, and this ticket's folder. No file added outside the ticket folder.
- Colour: `var(--amber)`, the warning token (light `#f5a623`, dark `#ffb224`). No new token.
- Titles, exact: stale "A newer version is ready: reload to see it"; otherwise "Load the page again" (today's).
- Viewer poll: 10 s, only while `document.visibilityState === 'visible'`, only `TS.kind === 'artifact'` with `TS.at` not `tree:`, one ask in flight. Its code in `viewerBoot` uses none of the names `route(`, `render(`, `load(`, `loadNow(`, `loadSchemaDocs(`.
- Never reload the frame except on the button's press.
- The new test never uses `POLL_FAST`: it waits on the real 10 s polls (spec-2 N1). Waits: dashboard up to 45 000 ms (2 × 10 s + `DATA_WAIT_MS` 20 s + 5 s), viewer tab up to 37 000 ms (2 × 10 s + describe's 12 s + 5 s); met by the first `dashboard-data` run, or `/api/view` ask, that starts after the change.
- Browser tests run here with Node 22: `/usr/local/bin/node` (the default Node 18 has no WebSocket and skips them).

## Review focus

1. A reload before any check (fpNow still the open-time fp): the hint still comes on a later change. Pinned in Task 1's test.
2. A held dashboard draw (the owner typing): the check must use the read, not `DATA`. Covered by using `d` in `loadNow`; reviewer reads it.
3. A switch of stage (another artifact, a preview, close) while a viewer ask is in flight: its reply is dropped. Pinned by the slug/at guard; reviewer reads it.
4. A tree stage and a preview stage never poll and never show the hint. Pinned in Task 2's test (the existing "nothing else" asks list stays clean for a tree).
5. Dark mode: outline colour is the dark token. Pinned in Task 1's test.

---

### Task 1: the hint, the reload, and the dashboard's check

**Files:**
- Modify: `docs/devteam/dashboard/index.html`: CSS near `.av-bar` (~516-535); `TS` (~3543) and `tsSet` (~3554); `showArtifact` (~3569-3570); `openArtifact` (~3647); the `#av-reload` handler (~3669); `loadNow` after `drawOrHold(d)` (~5325).
- Test: `test/dashboard.test.mjs`, a new top-level test after the viewer test (~2021).

**Interfaces (produced):**
- `TS.fpNow`, `TS.mainFpNow`: string | null.
- `avHint(): void`: sets `#av-reload`'s `stale` class and title from `TS` (stale iff `TS.kind === 'artifact' && TS.fp && TS.fpNow && TS.fp !== TS.fpNow`).
- `avFpSeen(fp: string|null, mainFp: string|null, slug: string, at: string): void`: if the stage shows that `slug`/`at` (and `at` isn't `tree:`), sets each given non-null value on `TS.fpNow`/`TS.mainFpNow`, then `avHint()`.

- [ ] **Step 1: write the failing test** `the viewer's reload button says when a newer version is ready, and the press loads it`, `{ skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }`, using `threadsFixture('reload-hint')`, `landArtifact(F, 'hint-mock', mock('main'))` and the draft written at `F.old/.worktrees/demo-01-draft/docs/devteam/project/artifacts/hint-mock` as `mock('v1')`, where `mock(t)` is `{ 'artifact.json': …title 'Hint mock'…, 'index.html': `<!doctype html><title>${t}</title><p>${t}</p>` }`. A page with `COUNT_FETCH`, and on each new document a listener that pushes `e.data.title` of `{ lens: 1, type: 'ready' }` messages from `#av-frame` into `window.__titles`. Helper `amber()` = computed `color` of a probe `<span style="color: var(--amber)">` appended to `#artifact-view`. Subtest **dashboard**:
  - open `${B}/#artifact/wt/demo-01-draft/hint-mock`; wait for `__titles` to include `'v1'`; assert `#av-reload` has no `stale` and its title is `Load the page again`.
  - press `#av-reload` (before any change); wait for a second `'v1'`.
  - write `index.html` as `mock('v2')`; wait up to 45 000 ms for `stale`; assert title `A newer version is ready: reload to see it`, `getComputedStyle(#av-reload).outlineColor === amber()`, outline width `2px`, and `__titles` has no `'v2'` (nothing reloaded by itself).
  - `Emulation.setEmulatedMedia` `{ features: [{ name: 'prefers-color-scheme', value: 'dark' }] }`: outline colour still equals `amber()`, and `amber()` differs from its light value; set it back to light.
  - press `#av-reload`: wait for `'v2'` in `__titles`; assert no `stale`, title `Load the page again`, and `TS.fp === TS.fpNow`.
- [ ] **Step 2: run it, see it fail** — `/usr/local/bin/node --test --test-name-pattern "reload button says" test/dashboard.test.mjs`; expected: times out waiting for `stale`.
- [ ] **Step 3: implement.** CSS `#av-reload.stale { outline: 2px solid var(--amber); outline-offset: 1px; }`. Add `fpNow: null, mainFpNow: null` to `TS` and to `tsSet`'s reset. In `showArtifact`, pass `fpNow: fp, mainFpNow: mainFp` to `tsSet` (new stage), and on the same stage leave `fpNow`/`mainFpNow` as they are; call `avHint()` at its end. `avHint()` and `avFpSeen()` beside `showArtifact`. The reload handler: after resetting `src`, if `TS.kind === 'artifact'` copy `fpNow`→`fp` and `mainFpNow`→`mainFp` where non-null, then `avHint()`. `tsSet` also calls `avHint()` so a preview or close clears it. In `openArtifact`, a draft whose own Library row is absent while main's is present opens with main's fp as its `fp` (absence means equal to main; spec-2 N2). In `loadNow` after `drawOrHold(d)` (the raw `d`, so a held draw still feeds the check; spec-2 N4): if `TS.kind === 'artifact'`, `avFpSeen(row(TS.at)?.fp ?? null, row('main')?.fp ?? null, TS.slug, TS.at)` over `d.library?.artifacts`. Comments in the file's voice.
- [ ] **Step 4: run it, see it pass**, then the whole file: `/usr/local/bin/node --test test/dashboard.test.mjs` through `devteam.mjs gate test`.
- [ ] **Step 5: commit** `kit-206: the reload button's hint, and the dashboard's check`.

### Task 2: the viewer tab's poll

**Files:**
- Modify: `docs/devteam/dashboard/index.html`: `viewerBoot` (~5664-5695) and its comment.
- Test: `test/dashboard.test.mjs`, a second subtest in Task 1's test.

**Interfaces (consumed):** `avFpSeen`, `TS.fpNow`, from Task 1.

- [ ] **Step 1: write the failing subtest** **viewer tab**: write the draft back to `mock('v1')`; go to `${B}/view/artifact/hint-mock?at=demo-01-draft`; wait for `'v1'` in a fresh `__titles`; no `stale`. Write `mock('v3')`; wait up to 37 000 ms for `stale` and the stale title; `__titles` has no `'v3'`. Press: `'v3'` arrives, `stale` off. Then go to `${B}/view/artifact/hint-mock?at=tree:<T>` (T from `landArtifact`), wait 11 s, and assert `__asked` has exactly one `/api/view?` (boot's) and `#av-reload` has no `stale`.
- [ ] **Step 2: run it, see it fail** (no `stale` in the viewer tab).
- [ ] **Step 3: implement** in `viewerBoot`, for an artifact: a `let asking = false` and a 10 s `setInterval` that returns unless visible, `TS.kind === 'artifact'`, `TS.at` not `tree:`, and not `asking`; it fetches `/api/view?kind=artifact&slug=&at=` for the `TS.slug`/`TS.at` taken at the ask, and on a 200 calls `avFpSeen(j.fp, j.main_fp, slug, at)`; anything else changes nothing; the fetch aborts after 15 s (`AbortController`; spec-2 N3); `asking` cleared in `finally`. Rewrite the boot comment to name this read (one `artifact describe` per ask, every 10 s while seen, main or a draft only).
- [ ] **Step 4: run it, see it pass**, then the whole file through the gate, and `/usr/local/bin/node --test test/dashboard.test.mjs` with the existing viewer test's "nothing else" check still green.
- [ ] **Step 5: commit** `kit-206: the viewer tab checks its artifact's fingerprint`.

After both: verification.md (a row per done-when), then the finish (worker.md §8).

## Rulings

None yet.

## From the spec reviews

spec-2 (APPROVE 9d399ce) left N1-N4; they are taken here, not in spec.md, so its approval holds: the test's waits and no `POLL_FAST` (N1), main's fp for an unlisted draft at open (N2), a 15 s abort on the viewer's ask (N3), the check on every read, held or drawn (N4).
