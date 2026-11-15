# Task 3 review, pass 1

- Reviewer: Lovelace (fresh subagent, claude-opus-5-5)
- Reviewed: 4bca7aa5d49a44e01e3375c628bfbadfd7d90923 (Task 3, diff from 20b488f)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T3-1 | Minor | `L-TEST-1`; spec check 3 ("`http://` and `https://` addresses send as typed"); schema `nav.url` ("As the owner typed it") | the address-bar test, the `[typed, url]` table | Every accepted entry is already in canonical form, so the typed string and `new URL(...).href` are the same. Mutation M1 sends `u.href` instead of what was typed, and the test still passes. Add an entry whose `href` differs from what was typed, such as `HTTPS://Shop.Example/a` or `http:a.example`, and expect it to arrive unchanged. | |
| T3-2 | Minor | `L-TEST-1`; plan Task 3 ("a 2049-character URL"); schema `nav.url` maxLength 2048 | the address-bar test, the too-long case | The test uses 2051 characters with a scheme, not 2049, and nothing checks that 2048 is accepted. M2 (`> 2050`) survives. M3 also survives: it measures `v` without the `https://` prefix, so a schemeless 2045-character entry would be sent as 2053 characters and break the contract. Test 2048 sends, 2049 refused, and a schemeless entry that only goes over 2048 once the prefix is added. | |
| T3-3 | Minor | `L-TEST-1`; spec, The address bar ("the newest `url` waits and is shown on blur or after a nav") | `browser.html` submit handler `addr.blur()`; the url-while-typing test | Only an explicit `blur()` is tested. M4 removes the `addr.blur()` after a nav: the waiting url then never shows until the owner clicks away, and every test still passes. Add a case where a `url` arrives while the owner is typing, then Enter sends nav and the field shows that url. | |
| T3-4 | Minor | spec, The address bar (the `://` rule); design R2 (plain words) | `toNav`, `v.includes('://')` | No scheme gets through. I probed 29 hostile inputs in Node's WHATWG parser: mixed case, leading C0 and Unicode space, embedded tab and newline, `//host`, `http:host`, backslashes, IDN, `blob:`, `view-source:`, `ws:`, and more. Each is refused, or sent only when it parses to http or https. The `://` clause adds no protection, though. Every real scheme already matches `SCHEME` (M5 removes the clause and all tests pass). Its only effect is to refuse a schemeless https address with `://` in its query, such as `a.example/?next=https://b.example`, and that refusal says "Only http and https addresses open here." The same wording also comes back for `https://` and `http://a.example:99999`. This follows the spec as written, so the fix goes back to the spec: drop the clause, or say "That isn't an address." when parsing fails. | |
| T3-5 | Minor | `L-TEST-1`; review T2-2-2 (on blur "held empties") | the non-Latin layout test, the blur case | M19 drops `held.clear()` from the blur handler and the test still passes. Stale entries would then send a second `up` on every later blur. Blur twice, or blur, refocus and blur, and expect exactly one `up`. | |

Mutations were made on a scratch copy of the page with its CSP recomputed, and run against a copy of the test pointed at it.

- Caught (a test fails): M6 drops the `(?!\d)` port lookahead. M7 sends `forget` on the dialog's `close` event. M8 removes the blur handler's `up`s. M9 drops `trim`. M10 drops the protocol check. M11 skips clearing the note on a good nav. M12 sends `forget` when the dialog opens. M13 makes Cancel do nothing. M14 opens the dialog with `show()` instead of `showModal()`. M15 lets a url overwrite the field while it has focus. M16 takes Back away. M17 drops the length check. M18 sends the far-release `up` at the press point (this is T2-2-1's fix, now pinned).
- Survived: M1, M2, M3, M4, M5 and M19, as described in the findings.

Other checks:

- The dialog opens Cancel-first under `showModal`. A backdrop click doesn't close a native dialog, and Escape sends nothing (tested). No Done or hand-back control was added (`noHandBack` runs with the dialog open).
- A url with markup in it reaches the page only through `.value`.
- The whole file passed under Node 22.23.4 (24/24). The Task 3, blur and 4 px tests passed three more times. The `until` default going from 3 s to 5 s doesn't loosen the 3 s reconnect check, which still goes through `waitConn(2, 3000)`.

Verdict: APPROVE 4bca7aa5d49a44e01e3375c628bfbadfd7d90923
