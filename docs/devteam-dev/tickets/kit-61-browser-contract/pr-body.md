The `browser@1` contract that kit-63 to kit-68 build against (feature `supervisor-browser`, stories SB-S1 to SB-S3). Nothing here runs a browser or changes `devteam.mjs`.

- **`docs/devteam/schema/browser.schema.json`**: the eight JSON shapes (`status`, `snapshot`, `tabs`, `profiles`, `wait`, `state`, `resets`, `refusal`) and the live view's socket messages, keyed by `t`. It uses only the keywords the kit's own `schemaErrors` reads, so there is no dependency. Every object is closed, and every URL field carries one masked-URL pattern (no fragment, no `user:pass@`, every query value `•••`, token-shaped path segments `•••`). The `refusal` descriptions name the egress guard's rules, ranges and rule order. `state` holds no lock, and its `control_secret` is 0600 and never printed (supervisor ruling m-20261115-024248211).
- **`test/fixtures/browser/`**: a fixture per shape and outcome, the view's two message streams (with real JPEG frames), `bad/` cases that each fail with exactly one named error, and `check.mjs`, the subset checker later tests import.
- **`test/lib/sites.mjs`**: the loopback fixture site every browser test browses. It has a login with a 2FA POST step, a session-only cookie, a 24-hour cookie when "Remember me" is ticked, and a 2FA variant that answers with a page. It also counts POSTs (`/posts`) and serves an OAuth-style redirect with `?code=…#access_token=…`, token-shaped links, `/redirect?to=` (302), a page telling the reader to run a command, and a page that records clicks and typing. It runs in process or from a shell.
- **`test/browser-contract.test.mjs`**: 9 tests. They check fixtures against the schema, `check.mjs` against the kit's `schemaErrors` (cut from `devteam.mjs` and run side by side), the mask case by case, every bound, and the site route by route.

## How to verify

`node --test test/browser-contract.test.mjs` (Node 18 to 24; it passes locally on each). CI's test.yml runs it in the `rest` jobs. Records: `docs/devteam-dev/tickets/kit-61-browser-contract/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
