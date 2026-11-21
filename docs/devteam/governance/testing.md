# Testing

How much of each kind of test a project writes, and with what. `code-style.md` §12 says what every test must be (`L-TEST-1` to `L-TEST-6`); this file says where the tests go.

Law and Doctrine mean what they mean in `code-style.md` §0; a Law is enforced once its gate is commissioned (the gate table below counts as rows of `quality.md` §2), and review holds it until then. The tools this file names for a job are the owner's choice for that job (`constitution.md` §4): using one needs no one-way-door question.

## 1. The pyramid

- **`L-PYR-1` most tests are unit tests of the core.** The pure functions in `domain/**` (`L-STRUCT-1`) carry most of the suite: fast, no database, no network. The `coverage` gate (`quality.md` §2) fails under 90% branch coverage on `domain/**`. That floor is set in the gate's own command (SimpleCov's `minimum_coverage branch:`, vitest's `coverage.thresholds.branches`, and the like), so changing it on a project is the owner's `gate-change`; a project adopting an existing codebase ratchets up to it (`quality.md` §2, Modes). Gate: `coverage`.
- **`L-PYR-2` every endpoint and command has an integration test against a real Postgres.** The test calls the endpoint or the command (`code-style.md` §2) through the shell, against a real Postgres at the version the project pins (`L-ERG-3`), never a mocked database or an in-memory stand-in. It covers the success path and each typed error the command returns (`L-TEST-2`). Only what is outside our system is faked: a vendor's API, behind its adapter (`code-style.md` §6). Review-enforced; the final reviewer checks that each new endpoint or command has one.
- **`L-PYR-3` a few end-to-end tests per user story.** Each story's acceptance (`process/planning.md`, Stories) is checked end to end, through the browser or the app, by the ticket that checks the story (D7's integration ticket, where the story spans components). A few per story, for the paths a user takes, not one per edge case: edge cases belong lower down. Review-enforced, through the done-whens.
- **`L-PYR-4` property-based tests for invariants and money.** A function that sums or splits money (`L-MONEY-1` where it applies), moves a state through its transitions, or parses input at the boundary (`L-LOGIC-4`), and any invariant a design names, has a property-based test: fast-check in TypeScript, rantly in Ruby, proptest in Rust (Hypothesis in Python). The properties are the rule itself: parts sum to the whole, no transition reaches a state the lifecycle doesn't draw, a parse of what was printed gives back the value. Everything else is example-based. This makes `code-style.md` §12's property-testing Doctrine a must for these functions, kept to `domain/**` and the boundary's parse step so CI time stays bounded. Review-enforced: the final reviewer checks that each new one has its property test.
- **No overall coverage target.** The 90% floor is for `domain/**` only. Never chase 100% anywhere, and never set a floor on the whole codebase: the shell is covered by the integration tests, not by a number.

## 2. The tools

| Stack | Unit and integration | End to end |
|---|---|---|
| TypeScript | Vitest (`sequence.shuffle`, `L-TEST-4`) | Playwright, with axe inside it (`L-FE-1`) |
| Rails | RSpec (`--order random`) | RSpec system specs on Playwright, or Playwright |
| React Native (Expo) | `jest-expo` (Vitest doesn't run React Native) | Maestro |

## 3. Load testing

- **`L-LOAD-1` a load test before a big launch.** Before a launch the design expects to bring load the app hasn't seen (a public launch, a campaign, a new market), run a k6 script against the numbers the design states (`process/planning.md`, NFR-1: p95 latency of the paths users wait on, requests or jobs per unit of time, availability). Run it against a preview or another throwaway environment seeded at production's size, never production (`operations.md` `L-ENV-3`). The script is checked in beside the tests. Record each run as an observation, `observe --subject <the goal or feature> --kind load-test --detail "<the script, the target, the p95 and error rate it measured, pass or fail>"`, and a miss as a problem before the launch goes ahead. Whether a launch is big is the design's call, named in its risks. Review-enforced: no gate can know a launch is coming.

## Gates

| Gate | Fails on | Law |
|---|---|---|
| coverage | branch coverage under 90% on `domain/**` | `L-PYR-1` |
