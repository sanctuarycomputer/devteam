# kit-232-prompt-by-file: spec

## Problem

Every fresh launch types `<agent_command> "$(cat '<promptFile>')"` into a tmux pane. The shell turns
the whole prompt file into one argument, and Linux caps one argument at MAX_ARG_STRLEN (131,072
bytes). A worker prompt carrying a large accepted-knowledge block passes that (mothership app-128:
134,034 bytes): the shell prints `Argument list too long`, no agent starts, and nothing raises it.

## Change

One helper, `promptPointer(file)`, returns a short first message:

> Your prompt for this session is in the file `<absolute path>`. Read all of it now and follow it.

The three fresh launch sites pass `shq(promptPointer(promptFile))` instead of `"$(cat '<promptFile>')"`:

1. the worker and planner launch (`devteam.mjs` ~15809), when it is not a resume;
2. the supervisor's own `recover` (~12704), when it starts fresh (no session id);
3. `legacyRecover`, another project's supervisor started from an older kit's settings (~12921),
   when it starts fresh.

The prompt file is written exactly as today. The path is absolute (`path.resolve`), so the agent
can read it from any working directory. The message names no harness and adds no flag, so it works
for any `agent_command`.

**Resume paths are unchanged.** A resume still passes its prompt inline, as today: the supervisor's
recover messages (`RECOVER_MESSAGE`, `LEGACY_RECOVER_MESSAGE`) are short constants that the recovery and
machine tests assert word for word, and the ticket keeps resume paths as they are. A worker or
planner `--resume` still cats its prompt file (see Out of scope).

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | Worker, planner and every supervisor launch pass a short first message pointing at the prompt file (absolute path) instead of `"$(cat …)"`; the file content is unchanged | Code at the three sites; the new test reads the prompt file and finds the full prompt (its knowledge block) in it; existing tests that read `run/prompts/<name>.txt` and `supervisor-prompt.txt` still pass |
| 2 | A test launches with a 200 KB prompt through a fake agent; the agent receives the short message and can read the file; no argument exceeds 128 KB | New test in `test/kit.test.mjs`: a planner launched with over 200 KB of accepted knowledge in its prompt, `agent_command` a stand-in node script that records each argument's length and reads the file the message names; asserts one short argument (under 1 KB), the named path absolute, the file over 200 KB, and every argument under 131,072 bytes |
| 3 | Works for any `agent_command` (no Claude-specific flag); resume paths unchanged | The stand-in agent is not `claude`; the message is plain words with no flag; recovery.test.mjs and machine.test.mjs (resume asserted verbatim) unchanged and passing in CI |
| 4 | test.yml passes on every job; no file is added | GitHub CI green at the head; `git diff --name-status origin/main` shows only M lines for the two touched files, plus this ticket's records |

## Contracts

None provided or consumed: the prompt file's path and content were already the kit's own.

## Edge cases

- The path contains a quote or a space: the whole message goes through `shq`, as other typed lines do.
- `runDir` relative (it is not today): `path.resolve` makes it absolute anyway.
- The agent is not an LLM that reads files (a no-op like `true`): it ignores its argument, as before.
- A pane's input line: the typed line is now short, well under a pty's MAX_INPUT, where before a large
  prompt was a single `$(cat …)` expansion done by the shell (the typed text was already short).

## Out of scope

- Worker and planner `--resume` still cat their prompt file (the ticket keeps resume paths unchanged). A
  resume with a prompt over 128 KB would still fail; noted as an observation for the supervisor.
- The operator launch (~13345) is not named by the ticket; its prompt is under 40 KB.
- A finding when a launched window shows a shell error instead of an agent (the ticket's "also consider"):
  noted for the supervisor as a separate ticket, not built here.
