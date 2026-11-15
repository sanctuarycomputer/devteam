# Task review, Task 3, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: a6654295be5633f56c2be6dcffeda4cd36be2cd2 (a072f29..a665429)

## What I ran

- Read `git diff a072f29 a665429` (hub.html +35/-3, test/hub-overview.test.mjs +67), plan Task 3, spec §3, acceptance 3, the ticket's done_whens, quality.md §3, code-style.md.
- `node --test --test-concurrency=2 --test-name-pattern 'box line' test/hub-overview.test.mjs`: 2 pass, 0 fail (both new tests).
- `test/dashboard.test.mjs --test-name-pattern 'pages parse'` (the ~893 check that hub.html's scripts parse): pass.
- `test/gateway.test.mjs` with the five tests that read hub.html (the served-copy check ~358, the laptop `urlOf`, the notify guard, the drop guard, previews): 5 pass.
- 26 mutants of hub.html in a scratch copy (`git archive` of a665429), run with `--test-name-pattern 'box line|draws the box line'`. Killed: release token check, kit token check, `down` ignored, null-list check, `hub !== 1`, `image !== true` loosened to truthy, the kit/release comparison, amber flipped on the matched and the mismatched parts, the tools filter removed, the name check removed, the `Claude Code` word removed, token length 1000, token allowing space and `<`, the paintOverview call, `image: b.image` in findBox, draw's catch without paintOverview, without `hubSeen = null`, the non-object throw removed, `hubSeen = data` removed, a `window` read in the block. Survived: `typeof image !== 'object'` removed (equivalent: a string's `.release` is undefined), a no-op separator mutant (mine), and the three DOM ones below (F1).
- Rendered the block's output in headless Chromium (`/usr/bin/chromium`) with hub.html's own `<style>` and paintOverview's insertion code: `.ov-box` takes the whole width of `.ov-head` on its own row under the h1, summary and `.acts` (top 34.5 vs acts bottom 28.5); the amber part is `--amber-fg` (rgb(163, 82, 0)), the rest `--fg-2`; the text is `Box v0.53.0 · hub v0.52.0, box v0.53.0 · Claude Code 2.1.310 · gh 2.83.0`.

## Checked by reading

- boxLine against every spec branch: null without a token `release`; `Box <release>` first; hub part in the spec's order (null/non-object/`down: true`, then `hub !== 1`, then `image !== true`, then `<kit> !== release`, else plain); `<kit>` is `?` unless a token, in every branch; tools in key order, `Claude Code` for `claude-code` via `Object.hasOwn` (so `constructor`/`__proto__` names don't reach the prototype), arrays and non-objects give no tools. Matches.
- The block is pure: only `RegExp`, `Object`, `Array` built-ins; no DOM, `fetch`, `window` or outside names (the vm runs it in an empty context; the `window` mutant is killed).
- draw: the 401 reload returns before the catch, so it doesn't paint. A failed fetch, bad JSON, `null` or a number now sets `hubSeen = null` and paints (earlier, `null` threw outside the try as an unhandled rejection; that's fixed too). A JSON array is an object, so it's kept and shows the amber "isn't a hub" part, and `data.instances ?? []` still gives no tabs, as before. No recursion: paintOverview calls `tlDraw`, not `draw`. First draw: `ovTab` is set before `findBox().then(draw)`, and paintOverview returns early when the Overview isn't selected. Laptop: `box` is null, so `boxLine(null, …)` is null and nothing is drawn. The extra paint on a failed poll redraws the same stale cards and keeps focus through the existing `data-k` logic, which every successful draw already does.
- Text goes in as text: `el` sets `textContent`, and the separators are appended as strings.

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Low | quality.md §3 (tests pin the claim) | test/hub-overview.test.mjs, 'the Overview draws the box line…' | No test covers the DOM half of the wiring. Three mutants survive: `innerHTML` in place of `el(…, text)`, the `amber` class dropped, and the `.ov-box` own-row CSS dropped. The spec's acceptance 3 asks only for the source assertions that are there, and boxLine's token filter makes `innerHTML` harmless today, so this doesn't block. Cheap to close: also match `el('span', x.amber ? 'amber' : '', x.text)` and the `.ov-head .ov-box { flex-basis: 100%` rule. | |
| F2 | Info | plan Task 3, "Look at it" | verification.md (Finish) | Chrome is available on this box (`/usr/bin/chromium`), so verification.md should record a look rather than say it couldn't take one. My headless render above shows the line on its own row with the amber part. | |

Verdict: APPROVE a6654295be5633f56c2be6dcffeda4cd36be2cd2
