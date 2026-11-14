# Task 4 review, pass 1

- Reviewer: task-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: 04f7dfb96815665eb26fb36e4336c9debd06d732 (Task 4, diff since f57715b8e1ad49be80bc2464e7ba0276ccec91db)

I ran `kt.sh test/machine.test.mjs` in the worktree: 17/17 pass, so done-when 5 holds and the existing DOWN/alert assertions are unchanged. The new test asserts all five lines exactly, plus the alert suffix, and deletes the three env vars (done-when 8).

Mutations, each in a scratch copy of 04f7dfb, running "names the hub's kit" alone. The unmutated copy passes. Every mutation was killed:
- the 64 KB cap removed: the 70 KB body printed `up, kit v1.2.3`;
- the release regex replaced by `true`: the ESC case printed the escape;
- `{1,64}` replaced by `+`: the 10 KB case printed it.

Probes I ran against the worktree kit's `machine status`, each with an in-process server on a scratch port and a scratch HOME (/data/home/tmp/claude-1000/-data-home-code-devteam-dev--worktrees-kit-46-standalone-hub/28488347-2c65-4742-9f26-ba72c20a41e5/scratchpad/t4/trickle.mjs):
- a server that sends headers and then one byte every 2 s: status took 15.5 s, ended only when the server ended its body at 15 s, and printed `up, kit v1.0.0`;
- headers, then silence: `DOWN` after 3.7 s;
- 60000 × "€" (about 180 KB of bytes) in a valid hub body: parsed, `up, kit v1.0.0`.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| G1 | Important | spec item 4 ("asks `/instances.json` … 3 s"); plan T4 Interfaces ("3 s timeout"); spec Security (a `dev` process may hold 4320) | devteam.mjs `hubLine`, `timeout: 3000` on `http.get` | `timeout` on http.get is a socket idle timeout, not a deadline. Whatever holds the hub port can trickle a byte every < 3 s and keep `machine status` (and box-status, which wraps it) waiting up to 64 KB × 3 s. I observed 15.5 s, limited only by my server. The `portAnswers` it replaces had an overall bound (`AbortSignal.timeout(3000)`). Fix: an overall 3 s timer that destroys the request and resolves, and a test case with a trickling server that asserts the line comes back within a few seconds. | fixed (one 3 s timer over the whole read; test case "a server that drips", RED: hung → GREEN: up, not a hub within 3 s) |
| G2 | Minor | spec Edge cases ("read capped at 64 KB, then `not a hub`") | `hubLine`, `b += c; if (b.length > 65536)` | The cap counts decoded UTF-16 characters, not bytes, so about 180 KB of multibyte text was read and parsed. Decoding each chunk on its own can also split a multibyte character. Count `c.length` on the Buffer chunks and decode once at the end. | fixed (the cap counts bytes, chunks kept as Buffers) |
| G3 | Suggestion | spec item 4 (`DOWN` is "no answer") | `hubLine`, `r.on('timeout')` | A holder that sends response headers and then goes silent is reported `DOWN`, though it did answer. `up, not a hub` would be truer to the spec's list. Settle this when fixing G1. | fixed (answered, then silent: up, not a hub) |

Verdict: CHANGES 04f7dfb96815665eb26fb36e4336c9debd06d732
