# kit-232-prompt-by-file: spec

## Problem

Every fresh launch types `<agent_command> "$(cat '<promptFile>')"` into a tmux pane. The shell turns
the whole prompt file into one argument, and Linux caps one argument at MAX_ARG_STRLEN (131,072
bytes). A worker prompt carrying a large accepted-knowledge block passes that (mothership app-128:
134,034 bytes): the shell prints `Argument list too long`, no agent starts, and nothing raises it.

## Change

One helper, `promptPointer(file)`, returns a short first message:

> Your prompt for this session is in the file `<absolute path>`. Read all of it now, every part (a long file takes more than one read), and follow it.

These launch sites pass `shq(promptPointer(promptFile))` instead of `"$(cat '<promptFile>')"`:

1. the worker and planner launch (`devteam.mjs` ~15809), fresh **and** `--resume`: both write the full
   prompt (knowledge block included) to the same file and type the same line, so a resume over 128 KB
   fails exactly as app-128 did (spec review F1);
2. the supervisor's own `recover` (~12704), when it starts fresh (no session id);
3. `legacyRecover`, another project's supervisor started from an older kit's settings (~12921),
   when it starts fresh.

The prompt file is written exactly as today. The path is absolute (`path.resolve`), so the agent
can read it from any working directory. The message names no harness and adds no flag, so it works
for any `agent_command`.

**Resume paths are unchanged.** Read as: what a resume does (its `resume_command`, `--continue` /
`--resume <id>`, which session it continues) is unchanged, and the supervisor's resume messages
(`RECOVER_MESSAGE`, `LEGACY_RECOVER_MESSAGE`) still go inline, word for word: they are short constants
that recovery.test.mjs and machine.test.mjs assert verbatim. A worker or planner resume gets the pointer
like a fresh start: what reaches its argv is asserted by no test, and its prompt is as large as a fresh
one's. This reading is put to the supervisor with the spec review request; a different ruling goes in
the Rulings section below.

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | Worker, planner and every supervisor launch pass a short first message pointing at the prompt file (absolute path) instead of `"$(cat …)"`; the file content is unchanged | Code at the three sites; the new test reads the prompt file and finds the full prompt (its knowledge block) in it; existing tests that read `run/prompts/<name>.txt` and `supervisor-prompt.txt` still pass |
| 2 | A test launches with a 200 KB prompt through a fake agent; the agent receives the short message and can read the file; no argument exceeds 128 KB | New top-level test in `test/kit.test.mjs`, skipped without tmux, on its own `threadsFixture` (nothing it writes reaches the threads test): 64 accepted knowledge lines written with `hand`, each with an explicit `id: k-<stamp>-supervisor` (unique stamps), `by` supervisor, `kind: 'lesson'`, a distinct 3,500-byte `statement`, `scope: 'all'`, `status: 'accepted'`, so the prompt is over 64 × 3,500 = 224,000 bytes; `agent_command` and `resume_command` a stand-in node script (not `claude`) that records each argument's byte length and reads the file the message names. A planner is launched fresh, then relaunched with `--resume`. For each launch it asserts: the prompt file is over 200 × 1024 bytes and holds the knowledge block; one argument, under 1 KB, naming the prompt file by an absolute path; every argument under 131,072 bytes; the agent read the file whole |
| 3 | Works for any `agent_command` (no Claude-specific flag); resume paths unchanged | The stand-in agent is not `claude`; the message is plain words with no flag; recovery.test.mjs and machine.test.mjs (resume asserted verbatim) unchanged and passing in CI |
| 4 | test.yml passes on every job; no file is added | GitHub CI green at the head; `git diff --name-status origin/main` shows only M lines for the two touched files, plus this ticket's records |

## Contracts

None provided or consumed: the prompt file's path and content were already the kit's own.

## Edge cases

- The path contains a quote or a space: the whole message goes through `shq`, as other typed lines do.
- `runDir` relative (it is not today): `path.resolve` makes it absolute anyway.
- The agent is not an LLM that reads files (a no-op like `true`): it ignores its argument, as before.
- The prompt file sits in the main checkout's `run/prompts/`, outside a worker's worktree: under an
  `agent_command` without a skip-permissions flag, the agent's read of it may raise a permission prompt.
  The default `agent_command` has the flag; a project that drops it already answers prompts by hand.
- A pane's input line: the typed line is now short, well under a pty's MAX_INPUT, where before a large
  prompt was a single `$(cat …)` expansion done by the shell (the typed text was already short).

## Out of scope

- legacyRecover's fresh path: machine.test.mjs line 633 still matches only because the pointer names
  `supervisor-prompt.txt`; that the file holds the old kit's own prompt is unchanged code (the
  `writeFileSync` above the typed line) and its old-kit fixture lives in machine.test.mjs, outside this
  ticket's touches (spec review F5).
- The operator launch (~13345) is not named by the ticket; its prompt is under 40 KB.
- A finding when a launched window shows a shell error instead of an agent (the ticket's "also consider"):
  noted for the supervisor as a separate ticket, not built here.

## Rulings

None yet.
