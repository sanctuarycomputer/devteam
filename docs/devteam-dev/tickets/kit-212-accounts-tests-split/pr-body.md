`test/accounts.test.mjs` (25 tests, 169 s summed on main's Node 24 `rest` job) becomes six files of 2 to 7 tests each, `test/accounts.{rotation,leaving,restart,restart-guards,untrusted,supervisor}.test.mjs`, and `test/lib/accounts-fixture.mjs`, which holds only the setup they share. Every test moves byte for byte, in its original order, done by a split tool that recomputes imports with eslint and refuses an undefined name. No test changes.

## How to verify

- The same 25 test names before and after: `names.mjs de07a84 <head> accounts`, in this PR's records, `docs/devteam-dev/tickets/kit-212-accounts-tests-split/names-1.md`.
- Any part runs alone: `node --test test/accounts.leaving.test.mjs`.
- Times per part, from test.yml's Node 24 `rest` job at the head: `ci-timings-head.md` in the records.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
