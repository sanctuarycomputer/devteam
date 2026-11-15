# Final review, pass 1 (track A)

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: a502a79ade15e4401cb1df1d0b0b764536081df6 (the whole branch, kit PR #244, ticket/kit-50-box-versions-on-hub; matches origin)

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | (none) | docs/devteam/scripts/devteam.mjs boxStatusLine; cloud/gateway.mjs boxImage | The pair-parsing loop is duplicated between the gateway and machine status. Spec §4 asks for "the same token rule", and each copy is pinned by its own tests (mutations below), so this is taste, not a defect. | deferred (Suggestion, per the supervisor m-20261115-042638127) |
| F2 | Suggestion | (none) | cloud/gateway.mjs boxImage | No cap on the number of tool pairs. DEVTEAM_BOX_TOOLS is set by the image's own Dockerfile and isn't attacker input; 100,000 pairs parse quickly. | deferred (Suggestion, per the supervisor m-20261115-042638127) |

No Critical, Important or Minor findings.

## What I checked

- Read spec.md, plan.md, verification.md and the reviews in docs/devteam-dev/tickets/kit-50-box-versions-on-hub/, and the diff `origin/main...a502a79` outside docs/devteam-dev (cloud/gateway.mjs, hub.html, devteam.mjs, the two test files).
- Commit order: the contract commit ba2194d is alone and comes before the build tasks (gateway.mjs and devteam.mjs comments only). The head commit a502a79 only adds verification.md on top of e38c1dc.
- Ran the touched test files one at a time under the box rule (env -u ..., TMUX_TMPDIR, --test-concurrency=2): test/gateway.test.mjs 73/73 pass; test/hub-overview.test.mjs 15/15 pass (nothing skipped); test/dashboard.test.mjs 155 pass, 0 fail.

## What I tried to break, and how it held

1. **/box.json's `image` sits behind the session.** The only route that serves it is the one at gateway.mjs:2057, and it comes after `const session = claimed ? sessionOf(req) : null; if (!session) ... 401/403`. The routes before the session check are `/auth/*` (claim, login) and `INSTALL` (manifest, sw.js, icons only), and none carries box data. On instance subdomains `/box.json` is proxied to the instance and never reaches this route. On preview, terminal and auth hosts it is handled elsewhere or 404s. BOX_IMAGE is used only in that route, and the start line logs only the token-checked release. The tests check 403 when unclaimed and 401 when signed out. As a mutation I added an unauthenticated `/box.json` route before the session check, and the "/box.json names the image" test failed.
2. **boxImage's token rule.** I probed it directly. `v1\nv2`, `v1 x`, `vé`, `v1\u0000`, fullwidth `ｖ1`, a zero-width space, `<script>` and a 65-character string all give release null. A trailing `\n` is trimmed away, as the spec says. JS `\w` without the u flag is ASCII-only, and `$` without the m flag does not match before a newline. For pairs: `x=y=z`, `=1`, `n=` and pairs without `=` are dropped, `é`/NBSP-separated values split and get dropped, and the first of a duplicated name wins. `__proto__`, `constructor` and `toString` become own keys, and the prototype stays intact. Mutations of the version check, the release check and the duplicate check each failed the boxImage test.
3. **hub.html escaping.** `el()` sets textContent. Separators are text nodes appended with `d.append(' · ')`. `boxLine` re-checks the release, the kit and every tool name and version against the token rule, and only `Object.hasOwn(TOOL_WORDS, n)` maps a name. The draw catch only sets `hubSeen = null` and calls `paintOverview()`: it renders no error text, and the only text on the not-answering path is the fixed string "hub not answering". These mutations each failed a hub-overview test: innerHTML for the span, dropping the kit token check, dropping the tool filter, dropping the release check, dropping the `hub !== 1` branch, dropping the `down` check, and reverting the catch to `{ return; }`.
4. **`down: true`.** The gateway's fallback is the only place that sets it. Nothing in devteam.mjs reads the gateway's list: machine status, startHub and the probes all query the hub port directly. In hub.html only boxLine reads `down`. The rest of draw sees `instances: []`, the same as the old fallback, so behaviour is unchanged. A local process holding the port could send `down: true` itself. That would only make the page say "not answering", and such a process could already fake a full image list, so `down` opens nothing new. Removing `down` from the fallback failed the "whatever an agent binds" test.
5. **machine status's box line.** An escape in the release prints `?`, and an escape in a pair drops that pair. These mutations each failed the machine status test in a git-initialised scratch copy (the copy is a git repo because the test runs `git status`): dropping `ok(rel)`, dropping the per-pair `ok()` checks, and removing `out(boxed)`. The failures are true positives: for the first one the test reports actual `machine: box \x1B[31mx: gh 2.83.0`.

All the mutations ran in a scratch copy made with git archive, never in the review worktree or on the branch.

Verdict: APPROVE a502a79ade15e4401cb1df1d0b0b764536081df6
