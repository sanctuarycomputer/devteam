# kit-212: accounts.test.mjs becomes files under 60 s each on CI, every test kept

Feature `tests-light` (stories TESTS-S1, TESTS-S2), design `project/designs/devteam-s-tests-are-light-fast-and-easy-.md` (in devteam-dev): "Splitting the long files". It follows kit-211, which split five other files the same way, and its tools.

## Why

`test/accounts.test.mjs` is 784 lines and 25 tests. On test.yml run 43753735288 (main, de07a84, Node 24 `rest` job, which runs the files 8 at a time), its tests sum to 169.1 s; the longest are "the restart record is untrusted…" at 23.7 s and "restarting: never on text that only reads like a limit…" at 23.2 s. Per test: `ci-timings-base.md`, made by `specdur.mjs` from that job's log.

## Acceptance checks (the done-whens)

1. **No test dropped.** The sorted top-level test names across `test/accounts*.test.mjs` at the PR head equal those of `test/accounts.test.mjs` at the base (de07a84). `verification.md` quotes both lists and the empty diff, from `names.mjs accounts` (this folder). 25 tests before and after; none is split or changed.
2. **Each file under 60 s of wall time** on the Node 24 job at the PR head, quoted from the CI log. test.yml's `rest` job uses node's spec reporter over all files at once, which prints each test's time but no file's. A file's tests run one after another, so its time is the sum of its top-level tests' times there (as kit-211 measured), plus its process start-up and fixture set-up, which a local run puts at under 2 s. The target is a sum of 45 s or less per file on that job. The groups below sum to 36 s at most on the base run, under test.yml's own load of 8 files at a time, so no temporary workflow is needed. If the PR's run shows a file over 45 s, I regroup before the merge request; if a single test makes it impossible, I ask the supervisor before anything else (kit-211's ruling m-20261115-165039090, judging alone on a runner, is the precedent).
3. **No test over 30 s** on that job, quoted from the same log. The longest on the base run is 23.7 s.
4. **test.yml green** on every job at the PR head, read from `gh run view`'s conclusion (lesson k-20261115-164245020), and recorded through `devteam.mjs gate ci`.

## Design

### Shape

- `test/accounts.test.mjs` is replaced by six files, `test/accounts.<subject>.test.mjs`, named as kit-211 named its parts, plus `test/lib/accounts-fixture.mjs` (pending the design-change ruling, see Rulings). The original file is removed.
- The fixture holds what two or more parts use: the imports it needs, `MENU`, `ROOM`, `FULL`, `MOVED`, the file's `HOME` (with its exit cleanup), `claimFile`/`clearClaims`, `fixture(name)`, `findings`, and the helpers more than one part uses (`MINUTE`, `autos`). No test bodies. A part imports it, so each part, its own process, gets its own `HOME` and claim files, as the one file does today. Each part still claims its own port block through `./lib/kit.mjs`.
- Code that only one part uses moves to the top of that part: `row` to `rotation`; `switchCalls`, `SOON`, `PAST`, `expired`, `FULL_READING`, `OTHER`, `OTHER_FULL`, `ROOMIEST`, `CSWAP_STATE`, `quarantine` to `leaving` (split.mjs's dry run).
- Test bodies move byte for byte, with the comment lines above them, in their original order. No edits.

### The split (base run sums, Node 24 under test.yml's load)

- `accounts.rotation` (23.2 s): accounts-tick off; rotation runs cswap auto; the claim (two tests); the dashboard's rotation; what the accounts say.
- `accounts.leaving` (22.4 s): the six "leaving a full account" tests; starting a session warns on a full account.
- `accounts.restart` (36.0 s): the limit menu; a banner alone; never on text that only reads like a limit.
- `accounts.restart-guards` (31.0 s): a refusal or failing worktree_setup; only a session the supervisor launched; the SIGTERM; 3 times in 6 hours.
- `accounts.untrusted` (28.3 s): the restart record is untrusted; files any agent could write.
- `accounts.supervisor` (28.1 s): a stopped supervisor; supervisor-session; the supervisor's own pane.

### Tools (this folder)

Copied from kit-211's folder and used unchanged but for their header line: `split.mjs`, `chunks.mjs`, `lint.mjs` (eslint 9's `no-undef`/`no-unused-vars`; the kit has no dependencies, so any eslint 9 checkout), `names.mjs`. New: `split-plan.mjs` (the parts above), `specdur.mjs` (per-test seconds from a spec-reporter job log), `joblog.sh` (fetches a job's log). `split.mjs` refuses to write if any file has an undefined name, and recomputes each file's imports.

## Contracts

None provided or consumed: test files and a test-only helper.

## Edge cases

- Each part runs alone (`node --test test/accounts.<part>.test.mjs`), and nothing depends on a test in another part having run first. Each test makes its own `fixture()`; the only file-wide state is `HOME` and the claim files, which every test that uses them clears.
- `SOON` and `PAST` are computed when the part loads, as they were when the file loaded.
- `the dashboard: rotation…` binds `PORTS + 70`/`+71`, inside the part's own block, as before.
- Test names stay byte-identical; `names.mjs` reads them from the sources at both refs.
- Node 18: test.yml passes no `--test-timeout` there; nothing here changes per major.

## Rulings

- m-20261115-205854695-supervisor: trial, one combined spec and plan review (size S). Reviewer briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule. Run only my files, at `--test-concurrency=2`.
- Pending: m-20261115-210129296 (design-change), `test/lib/accounts-fixture.mjs` in the touches. If refused, each part carries its own copy of the preamble instead (about 85 lines each), and nothing else in this spec changes.

## Out of scope (outside the touches; for the supervisor)

- `test/timings.json` still names `test/accounts.test.mjs` (174.9). The new files weigh the median until weights are refreshed (kit-215).
- `test/lib/ports.mjs`'s layout comment, "+70/71..95 accounts (accounts.test.mjs)".
- kit-202 touches `test/accounts.test.mjs` and follows this ticket; it will edit the part that holds its test.
- The tests' own speed (fixed waits, the kit's code): not changed here.
