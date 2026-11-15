# kit-61-browser-contract: verification

At commit `4171aeb985e9e0872cf21d57a4f32f748ec66cc0`. That is the branch with `origin/main` merged (`8d57768`, merge `0e5fff0`), final-1's fixes (`73a7249`), and final-2's record.

Where:
- **CI** is test.yml run [43671340549](https://github.com/sanctuarycomputer/devteam/actions/runs/43671340549) at `4171aeb`. Every job (`kit` × Node 18/20/22/24 × chain/rest) succeeded, and box-image run 43671340569 succeeded. It was recorded with `devteam.mjs gate ci -- gh pr checks 243 --watch`. The earlier head `8d57768` was green too: runs 43670672966 and 43670672957.
- **Box** is this cloud box. There, only `test/browser-contract.test.mjs` was run, through `devteam.mjs gate test -- node --test --test-concurrency=2 test/browser-contract.test.mjs`: 9 pass, 0 fail. It was also run on Node 18.20.4, 20, 22 and 24 from `~/.local/share/mise/installs/node/<v>`, 9/9 on each. The full suite was not run on the box: the supervisor stopped that run (m-20261115-030118434), because CI's run is the gate for it.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `test/browser-contract.test.mjs` passes in CI, every job. Every fixture validates: status, snapshot, tabs, profiles, wait (done, declined, withdrawn, timeout), state.json with both pids, resets.json with a reset and an unreset `done` entry, the guard's 403 refusal body, and every live-view message in both directions. `browser: 2`, a snapshot without the framing, a `#fragment` URL and an unknown socket `t` each fail | CI run 43671340549; box: the gate above | pass. "every fixture validates against its shape" covers each fixture named, with every message type and every mouse and key `type`; frame sizes are read from the JPEGs. "each bad fixture fails with exactly its named error" covers `bad/status-browser-2.json`, `snapshot-no-framing.json`, `tabs-fragment.json` and `view-from-{server,page}-unknown-type.json`, plus five more, each with exactly one error. Fragments anywhere in a URL are refused ("the mask pattern…") |
| 2 | The test starts `test/lib/sites.mjs` on a random loopback port and gets every route the done-when names: the login form with a password field; the 2FA POST form with `autocomplete=one-time-code`; a session cookie with no Expires or Max-Age, set only after both steps; the 24-hour remembered variant; the 200-page 2FA variant; `GET /posts` counting POSTs; the OAuth redirect to `?code=…#access_token=…`; a `https://user:pass@host/…` link; `/redirect?to=` answering 302; and the run-a-command page | same | pass: "the fixture site serves every page later tests browse" (port 0 on 127.0.0.1) and "the fixture site runs from a shell, and says each session it issues" |
| 3 | The schema's descriptions name the egress guard's rules and refused ranges as the spine lists them, and the state.json shape has no lock field | same | pass: "the refusal names the guard's rules and ranges; state holds no lock". It checks every spine range, the registry ranges in `range.enum`, the rule order, resolve-once and the test exception with the ports it never covers. `state` is closed and has no lock, hold or held field, and its `control_secret` is 0600 and never printed (ruling m-20261115-024248211) |

Also at this head:
- `check.mjs` agrees with the kit's own `schemaErrors`. The test runs the kit's function, cut from `devteam.mjs`, side by side with it.
- Every bound in the contract refuses what it should.
- Schema mutations, each killed: an open `state`; `#` allowed in path segments; 4 digits allowed; `click` dropped; a fragment allowed after the query; the framing host widened. Site mutations, each killed: the guard around a request removed; the reviewers' 9 further mutants in `final-2.md`.

Nothing is deferred to beta: the contract has no runtime part.
