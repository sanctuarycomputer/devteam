# Task 5 review, pass 1

- Reviewer: task-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: c54471ae304854cf5ecf61d321b9e9ba9442cd77 (Task 5, diff since 04f7dfb96815665eb26fb36e4336c9debd06d732)

I read the README diff against spec item 5, done-when 7 and plan T5 Step 1. I checked the README's claims against devteam.mjs at this head:
- `hub` retries whatever holds the port (the standalone branch of the error handler);
- the log is `~/.devteam/hub-<port>.log`;
- a dashboard skips the hub only when `DEVTEAM_IMAGE_HUB` equals its HUB_PORT, and says so in run/dashboard.log;
- the HELP line `hub [--release vX.Y.Z]` exists (T1).

`git diff --diff-filter=A --name-only origin/main c54471a -- . ':!docs/devteam-dev'` is empty, so done-when 7 holds. The README names the gap (an older project kit takes the port while the image's hub restarts), as the spec asks.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| H1 | Suggestion | spec item 5 | README.md, "Many projects, one machine", second sentence | "Any running dashboard also serves the hub" still stands unqualified, and the box case only corrects it two sentences later. "Any running dashboard can serve the hub" (or moving the box sentence up) would read true on a box. The gap sentence could also say that an older kit holding the port keeps it until its dashboard stops, not only for "the moment" of a restart. That is implied by "until that project adopts the release". | noted (Suggestion: the next sentence qualifies it for the laptop, the one after for the box) |

Verdict: APPROVE c54471ae304854cf5ecf61d321b9e9ba9442cd77
