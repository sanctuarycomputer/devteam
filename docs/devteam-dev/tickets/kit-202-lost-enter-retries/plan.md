# kit-202 plan

## TL;DR

- The lost-Enter rescue's "pane changed" check ignores the harness chrome: the footer, the agent list, and the shell counts and token counters.
- One helper, `paneBody(lines, tail)`. It cuts below the input box's last rule line (unless the typed text is below it). The body is the last 8 lines that aren't chrome; shell-count phrases are taken out and the lines normalized for the digest. The tail is looked for in the raw lines.
- The busy and menu guard reads all 15 captured lines, unfiltered (today: the bottom 8). Wider, never narrower.
- TDD in `test/accounts.supervisor.test.mjs`, one new test. Boxed and boxless panes whose chrome changes, including the shell count going away, get three Enters. A busy footer gets none, and neither does a busy spinner above a long agent list. Each redraw's own keys and the record's `tries` are checked, because a redraw restarts the stand-in.
- The existing tests in that file are unchanged, byte for byte.
- Two files touched, no file added. Gate: that one test file locally, then test.yml on CI through `gate ci`.

## Files

- `docs/devteam/scripts/devteam.mjs`: lost-Enter block (~2876–2955).
- `test/accounts.supervisor.test.mjs`: one new top-level test, appended.

## Task 1: failing test (red)

Append to `test/accounts.supervisor.test.mjs` a test named `"the supervisor's own pane: a lost Enter is pressed again while only the harness chrome changes, never into a busy pane"` (`{ skip: !hasTmux }`). It uses the same helpers as the existing lost-Enter test: `fixture('sup-chrome')`; a `pane(shown)` that kills and redraws window `sup-chrome` and points `supervisor-pane` and `supervisor-pane-role` at it; `deliver`; `later`.

`pane()` restarts the stand-in, which empties its keys file (`agent()` writes `''`). So each step asserts that pane's own keys, plus the record:

```js
const step = async (shown, n) => {          // n: the try this tick should make
  s = pane(shown); await until(() => s.shows().includes('devteam answer'), 'the pane');
  if (n > 1) later();
  F.tick();
  await until(() => s.keys() === '\r', `Enter ${n}`);
  if (n < 3) assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, n); else assert.ok(!fs.existsSync(sent), 'and then it stops');
};
```

`deliver(3600)` comes before step 1. After step 3, one more tick must leave the keys at `\r`.

Cases:

1. **Boxed pane, chrome changes** (R = `'─'.repeat(60)`, `text` as in the existing test):
   - A: `⏺ The plan names each one as stricter than before.`, then `✻ Cogitated for 20s · done 9:56 PM · 1 shell still running`, R, `❯ ${text}`, R, `⏵⏵ bypass permissions on · 1 shell · ↓ to manage`, and `◯ general-purpose  Re-review Task 2 fixes   20s · ↓ 46.1k tokens`.
   - B: the same content and input, with `2 shells still running` and the footer `⏵⏵ bypass permissions on · PR #671 · 2 shells · ↓ to manage`, then `● main`, the agent at `1m 5s · ↓ 52.3k tokens`, and `◯ Explore  Find the footer  4s · ↓ 1.2k tokens`.
   - C: the shell is gone. The status line is `✻ Cogitated for 20s · done 9:56 PM` and the footer is `⏵⏵ bypass permissions on · ↓ to manage`, with no agent lines.
   - Run step(A, 1), step(B, 2), step(C, 3).
2. **Boxless pane** (another harness):
   - First: `⏺ Earlier output`, `> ${text}`, `1 shell running`, `◯ agent  12s · ↓ 3.1k tokens`.
   - Then: `2 shells running` and `40s · ↓ 9.8k tokens`.
   - Then: no shell line, and `◯ agent  1m 2s · ↓ 1.2M tokens`.
   - Run deliver(3600) again, then the three steps.
3. **Never into a busy pane** (deliver(3600), tick, then `s.keys() === ''`):
   - (a) pane A with the footer `⏵⏵ bypass permissions on · 1 shell · esc to interrupt`;
   - (b) `⏺ work`, `✻ Cogitating… (12s · ↓ 1.2k tokens · esc to interrupt)`, R, `❯ ${text}`, R, `⏵⏵ bypass permissions on · 1 shell`, and seven agent lines `◯ agent<n>  <n>s · ↓ <n>.1k tokens`.
   - Clear the record between the two.

Run it as a script file: `env -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_RUN -u DEVTEAM_SUPERVISOR -u DEVTEAM_HOME -u DEVTEAM_FEATURE timeout 600 node --test --test-concurrency=2 test/accounts.supervisor.test.mjs`. On today's code, expect step B to fail (no second Enter: the digest changed) and the boxless case at step 2 too. Case 3 passes today: in (a) the guard sees the footer, and in (b) the tail isn't in the bottom 8, so it's dropped as submitted. It stays in the test to guard the widened tail window. Commit.

## Task 2: the fix (green)

In devteam.mjs, beside `squash` (`PANE_SHELL` is a module-level const declared above, read at call time):

```js
// The harness's own chrome, not the pane's content: a box-drawing rule (the input box's border),
// a running-shell count, a token counter (an agent's list line or spinner). They change on an idle
// pane, so the lost-Enter rescue doesn't digest them.
const PANE_RULE = /^[─-╿]{8,}$/;
const PANE_TOKENS = /[↑↓]\s*[\d.,]+\s*[km]?\s+tokens\b/i;
const PANE_SHELLS = new RegExp(PANE_SHELL.source, 'gi');
const paneNorm = (l) => l.replace(PANE_SHELLS, ' ').replace(/[\s·]+/g, ' ').trim();
function paneBody(lines, tail) {
  let end = lines.length;
  for (let i = end - 1; i >= 0; i--) if (PANE_RULE.test(lines[i].replace(/\s+/g, ''))) { end = i + 1; break; }
  // text below the last rule: no box under the input, so nothing below it is a footer
  if (end < lines.length && squash(lines.slice(end).join('')).includes(tail)) end = lines.length;
  const kept = [];
  for (let i = end - 1; i >= 0 && kept.length < 8; i--) if (!PANE_TOKENS.test(lines[i]) && paneNorm(lines[i])) kept.unshift(i);
  return { text: squash(lines.slice(kept[0] ?? end, end).join('')), digest: crypto.createHash('sha1').update(kept.map((i) => paneNorm(lines[i])).join('\n')).digest('hex') };
}
```

In `resendLostEnter`:
- replace `bottom`/`digest` with `const body = paneBody(lines, tail); const digest = body.digest;`;
- the tail check becomes `if (!body.text.includes(tail))`;
- the busy guard becomes `lines.some((l) => PANE_BUSY.test(l) || /Enter to confirm/i.test(l))`, over every captured line.

Update the block comment ("bottom lines" becomes "the pane's body: its lines above the harness footer, its chrome left out").

I proved this on the spec's fixture shapes with a scratch copy of the helper:
- boxed panes A, B and C give one digest, and so do the three boxless panes;
- the echo, more-reply and typed-line panes each give their own digest;
- the spinner pane reads as busy;
- the tail is found in /data/home/tmp/sb-pane.txt.

Run the same test file: every test passes, and the existing ones are unedited (`git diff origin/main -- test/` shows only additions). Commit.

## Task 3: verify and finish

- `gate test` on the one file.
- Push.
- `gate ci -- <a command that watches the PR's test.yml run>`, never piped and never `-- true`.
- verification.md with a row per done-when at a named commit.
- `git diff --stat origin/main` shows exactly the two files plus the records.
- A final review from a fresh reviewer, then check-ticket, then the merge-request.

## Risks

- **It can add presses, on idle panes only.** The body reaches past the footer and agent list, so a submitted echo with a short reply can stay in view where today it scrolls out of the bottom 8. The rescue then presses one Enter into an empty idle prompt, which submits nothing (spec, Edge cases). Every guard is the same or wider, so no press goes into a menu, a busy pane, or a pane with someone at it.
- `─` lines in other content, below the input, with the text above them (an odd harness): the cut leaves them out of the digest. They're static, so the worst case is the same as today.
