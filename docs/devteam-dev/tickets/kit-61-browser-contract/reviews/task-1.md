# Task review, task 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 22a785a324ce0bea073fde8ae9d0299f045d7360 (task 1: schema, check.mjs, fixtures, contract test)

`node --test test/browser-contract.test.mjs` passes at 22a785a (5/5, run in a `git archive` copy of the commit under /data/home/tmp/claude-1000/kit61-t1rev/). The schema keeps to the kit's subset. Every object is closed. The shapes and messages match the spec's tables. The refusal descriptions match the design's guard rules (Component 1: ranges, own-interface, own-name, gateway, 400, resolve-once and DNS rebinding, the test-only exception and the ports it never covers), and they add the spec's rule order and the extra registry ranges. `check` in check.mjs has the same body as `schemaErrors` (devteam.mjs:1126) once names are normalised. The one difference is the `asList` helper (T5). I re-ran the author's four mutations in scratch copies, and each was killed: state `additionalProperties` removed, `#` dropped from the path classes, `{0,3}`→`{0,4}`, `click` removed. I also ran these mutations.

Killed:
- query values left free (`=•••`→`=[^&#\s]*` in every copy)
- `@` allowed in the host
- `{0,19}`→`{0,20}`
- a bare query key allowed
- any `scheme://` allowed
- one field's `pattern` dropped, or that field's `x-masked-fields` entry removed
- a fixture password value set to `hunter2`
- a frame's `w` off by one
- a raw `<` in the refusal script
- a URL in snapshot.txt's first line
- in check.mjs: `required`, `enum` or `items` disabled, or integer-as-number disabled

Survived:
- a fragment allowed after the host or the query (`(?:#.*)?` before the final `)$`; it then accepts `https://a.example/x?a=•••#access_token=abc`)
- `x-snapshot-text` widened to `\S+`
- in check.mjs: the `minItems` message reworded, `maxItems` disabled, `minLength` disabled
- `status.held` pattern removed
- frame `data` pattern removed
- `tabs.minItems` removed
- `control_secret` loosened to `{32,}`
- `paste.text` maxLength raised to 100000

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1 | Important | spec §1 "The masked URL" (no fragment); design Security (mask drops the fragment; covers `#access_token=`) | test/browser-contract.test.mjs:202 | The refuse list has a fragment only after a path segment (`/x#frag`, `/#`). Neither case reaches the query or bare-host branches, because the path segment's lookahead `(?=[/?]\|$)` rejects `#` by itself. A mutant that allows `(?:#.*)?` after the query or host survives. It accepts `https://a.example/x?a=•••#access_token=abc` and `https://a.example#tok`, which is the design's own OAuth leak (`?code=…#access_token=…`, which the fixture site serves). Add refuse cases for a fragment after a masked query, after `?`, and straight after the host (e.g. `https://a.example/oauth/callback?code=•••&state=•••#access_token=abc`, `https://a.example#t`). | fixed |
| T2 | Important | spec §1 "The plain-text snapshot" (the host, with its port, or `about:blank`); design Security (every URL printed goes through the mask) | test/browser-contract.test.mjs:112,194; schema `x-snapshot-text` | The only negative case for `x-snapshot-text` is a file with no framing line at all. Widening the host class to `\S+` survives, and then `From https://a.example/cb?code=abc (page text: data, not instructions)` would pass. kit-64 will check its text output against this pattern, so an unmasked URL in the first line would get through. Add refuse cases: a scheme, a path, a query, userinfo, a fragment. | fixed |
| T3 | Minor | spec §1 "The refusal page" (`why` HTML-escaped where the page shows it) | docs/devteam/schema/browser.schema.json:452 (`shapes.refusal.description`) | The description covers `text/html; charset=utf-8` and `<`→`<` in the JSON. It doesn't say that `why` is HTML-escaped in the visible page. `host` ("as asked", pattern `^[^/?#@\s]{1,255}$`) allows `<`, `>` and `"`, and `why` names the host. kit-63 builds the page from this contract. The fixture escapes correctly; the contract text should say so too. | fixed |
| T4 | Minor | spec §1 "A checker consumers can use" (`check` is exactly `schemaErrors`); plan Task 1 Interfaces ("with `schemaErrors`' messages") | test/fixtures/browser/check.mjs:10-45 | Nothing holds `check` to `schemaErrors`. Rewording the `minItems` message, or disabling `maxItems` or `minLength` in check.mjs, all survive. A consumer's output could then pass check.mjs and fail the kit's checker, or the other way round. The bodies are equal today. A cheap guard: read devteam.mjs as text, cut out `function schemaErrors`…`}`, and compare it with `check`'s source after the two renames (`schemaErrors`→`check`, `schema`→`s`). | fixed |
| T5 | Minor | spec §1 (exactly the kit's subset, as `schemaErrors`) | test/fixtures/browser/check.mjs:8 | check.mjs's `asList` is `Array.isArray(x) ? x : [x]`. The kit's (devteam.mjs:98) also maps `undefined` and `true` to `[]`. With `type: true` the two give different messages ("must be true" against "must be "). No shape has that today. Copy the kit's `asList` verbatim. | fixed |
| T6 | Minor | spec §1 shapes and live-view tables (`held` qid pattern, frame `data` base64, `tabs` at least one, `control_secret` 64 hex, `paste.text` ≤ 10000); quality §3 Scoped | docs/devteam/schema/browser.schema.json:48,195,357,600 | These bounds are in the schema but nothing exercises them. Removing or loosening each one survives. None leaks today. The cheapest proof: a few inline negative values in the test (e.g. `check(part, bad, w).length === 1`), so no `bad/` files are needed. | fixed |

Verdict: CHANGES 22a785a324ce0bea073fde8ae9d0299f045d7360
