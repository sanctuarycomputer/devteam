# kit-232-prompt-by-file: plan

## TL;DR

- One helper in devteam.mjs, `promptPointer(file)`: a short plain-words message naming the prompt file's absolute path.
- Worker and planner launches (fresh and `--resume`) and the fresh `recover` and `legacyRecover` starts type `shq(promptPointer(promptFile))` where they typed `"$(cat '<promptFile>')"`.
- The supervisor's resume messages stay inline, word for word (spec, Resume paths).
- The prompt file is written exactly as today.
- One new test in test/kit.test.mjs: a planner launched, then resumed, with a prompt of over 200 KB, through a stand-in agent that records its argument lengths and reads the file.
- TDD: the test first, failing on main (the stand-in records one argument over 200 KB, or the shell refuses it), then the change.
- Gates: the touched test file alone at --test-concurrency=2 locally; GitHub CI is the gate.

## Files

Only `docs/devteam/scripts/devteam.mjs` and `test/kit.test.mjs` (the ticket's touches), plus this
ticket's records under `docs/devteam-dev/tickets/kit-232-prompt-by-file/`.

## Task 1: the failing test

In `test/kit.test.mjs`, a new top-level `test(...)` (skipped without tmux), on its own `threadsFixture('prompt-file')`:

1. Write a stand-in agent `agent.mjs` in the fixture's base: it appends one JSON line to `calls.jsonl`
   with `lens` (each argument's byte length), `first` (the first argument when under 4 KB), and, for the
   first absolute path ending `.txt` named in the argument, `read` (the file's byte length, or the error).
   Then it waits (`setInterval`), as an agent would.
2. Set `agent_command` and `resume_command` in the fixture's settings.md to `<node> <agent.mjs>`, commit and
   push (as chain.mjs's `landSettings` does).
3. Write 64 accepted knowledge lines with `hand('supervisor', { id: 'k-<stamp>-supervisor', type: 'knowledge', kind: 'lesson', statement: <3,500 bytes, distinct per line>, scope: 'all', status: 'accepted', evidence: [] }, …)`, each stamp unique (spec review F2).
4. `sup(['planner', 'big', '--goal', F.goal])`; wait until `calls.jsonl` has a line. Then kill the agent's window (`tmux kill-window`), `sup(['planner', 'big', '--resume'])`, and wait for a second line.
5. Assert, for each line: `run/prompts/plan-big.txt` is over 200 × 1024 bytes and holds the knowledge block; the agent got exactly
   one argument; every argument is under 131,072 bytes and the one argument under 1 KB; it names the prompt
   file by its absolute path and says to read and follow it; the agent read the file and got its full length.
6. Clean up: kill the fixture's tmux server, `F.done()`.

On main the line typed is `<agent> "$(cat '<file>')"`, so the shell either refuses it (E2BIG: no line in
`calls.jsonl`, the wait times out) or the stand-in records a 200 KB argument: either way the test fails.

Run: `node --test --test-concurrency=2 --test-name-pattern='prompt' test/kit.test.mjs` through
`devteam.mjs gate test`.

## Task 2: the pointer

In `docs/devteam/scripts/devteam.mjs`:

1. Near the launch code, add:
   ```js
   // A prompt goes to the agent as a file it is told to read, never as its text on the command line:
   // one argument is at most 128 KB on Linux (MAX_ARG_STRLEN), and a prompt with a large knowledge
   // block passes that, so the shell refuses the line and no agent starts.
   const promptPointer = (file) => `Your prompt for this session is in the file ${path.resolve(file)}. Read all of it now, every part (a long file takes more than one read), and follow it.`;
   ```
2. Worker/planner (~15809): `type(\`${sessionMarkerPrefix()}${cmd} ${shq(promptPointer(promptFile))}\`)`, fresh and resume alike.
3. `recoverOne` (~12704): `${cmd} ${id ? \`"$(cat '${promptFile}')"\` : shq(promptPointer(promptFile))}`.
4. `legacyRecover` (~12921): the same, keyed on its `id`.
5. Re-run Task 1's test: passes.

## Task 3: verification and finish

`verification.md` with a row per done-when; merge `origin/main`; PR; final review; `check-ticket`;
`merge-request`. Note to the supervisor (info): a finding for a launched window that shows a shell error,
as its own ticket.

## Rulings

None yet.
