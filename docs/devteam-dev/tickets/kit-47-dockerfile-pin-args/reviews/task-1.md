# Task 1 review, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: b8a3428f97e6f14b2c2947f71f2425cac46ed761 (Task 1, diff since 303cf8b)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1 | Minor | spec "What changes" 4, done-when 2 ("checked against its sum") | docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.mjs, binary-tool block checks | The checker passes a file whose binary `RUN` has lost its `sha256sum -c` step. On a scratch copy I deleted gh's `&& echo "$sum  /tmp/gh.tgz" \| sha256sum -c -` line and `verify-pins` exited 0: the case arm still sets `sum=$GH_SHA256_…`, so the "RUN uses every pin" rule still holds. This is the one mutation nothing downstream catches either, because the T2 CI build and probe succeed without the check. Today's file has all four checks, so this is a gap in the guard, not a defect in the file. Fix: require each binary tool's `RUN` to contain `"$sum  <path>" \| sha256sum -c -`. Other mutations also pass, but T2's probe catches each of them: the `/usr/bin/gh` link removed, `--no-same-owner` dropped, the gh URL without its `v`, and mise's asset arch hard-coded to `x64` (that one fails on the arm runner). | fixed: verify-pins.mjs requires `echo "$sum  <path>" \| sha256sum -c -` in each binary RUN; mutate-pins.sh adds the mutation (8/8 ok) |

Checked and found sound:

- **The script runs.** `verify-pins.mjs cloud/Dockerfile` exits 0 (14 pins, release v0.52.0). Run on the 303cf8b file, it exits 1 naming the missing ARGs, the gh apt lines and the layer order. `mutate-pins.sh` passes all 7 mutations, the plan's 4 among them.
- **My own mutations all fail with the right rule:**
  - a trailing `# x` on an ARG;
  - a quoted value;
  - a blank line before a RUN;
  - mise and uv swapped;
  - the BOX_TOOLS order changed;
  - a case arm reading the other arch's sum;
  - `gh` added to the pgdg apt list;
  - `$DEVTEAM_RELEASES`.
- **It passes what it should.** `${CLAUDE_CODE_VERSION}` with braces passes. So does a `# hold:` placed above the prose rather than directly above the ARG, which kit-48's line rule wouldn't read as a hold either.
- **Docker semantics.**
  - The image is one stage, so every tool ARG is in scope at the final `ENV`, and ENV expands `$VAR` inside double quotes.
  - A changed ARG busts the cache of every later RUN, not of COPYs. The stamp's ARG is followed only by ENV and VOLUME, so a new stamp rebuilds nothing.
  - No comment line sits inside a `\` continuation. Each comment is a whole line, and the `# hold: <reason>` example sits mid-line inside one.
  - The doc comment ends in a blank line, not a hold line.
- **POSIX sh in each RUN.**
  - In each `case`, `exit 1` ends the shell on an unknown arch.
  - The `&&` chains are intact.
  - Everything the shell needs is quoted: `"$sum  path"` and the tar member name.
- **Asset names.**
  - ttyd: `$TTYD_VERSION/ttyd.$(uname -m)`.
  - gh: `v$GH_VERSION/gh_${GH_VERSION}_linux_{amd64,arm64}.tar.gz`. The member `gh_<v>_linux_<arch>/bin/gh` with `--strip-components=1 -C /usr/local` lands at `/usr/local/bin/gh`. `--no-same-owner` makes it root's, `chmod 755` sets its mode, and `/tmp/gh.tgz` is removed in the same layer.
  - mise: `$MISE_VERSION/mise-$MISE_VERSION-linux-{x64,arm64}`, which matches the old literal URL.
  - uv: `uv-$(uname -m)-unknown-linux-gnu.tar.gz`, unchanged.
- **Values and order.** All 14 values match the spec table, each once in the file, on its ARG line. The order is ttyd, gh, mise, uv, claude-swap, Claude Code, all after both apt layers. uv and claude-swap are now separate RUNs, and claude-swap's runs `/usr/local/bin/uv` from the layer before it. The stamp, ENV and VOLUME are last, and `DEVTEAM_IMAGE_HUB` is absent.
- **Nothing relied on the apt gh or the old layer order.**
  - Nothing outside the new gh RUN names `/usr/bin/gh`, `githubcli` or `cli.github.com`.
  - Dev's PATH (mise shims, then the image PATH, where `/usr/local/bin` comes before `/usr/bin`) resolves `gh` to the tarball binary. The `/usr/bin/gh` link keeps existing `~/.gitconfig` credential helpers working.
  - The ttyd probe RUN beside the kit COPY still comes after the ttyd layer.
  - The heredoc scripts call `gh`, `mise` and `ttyd` by name only.
  - `test/machine.test.mjs` reads only heredoc lines (the boot's up-list and pane lines), which are unchanged.
  - `box-image.yml` builds `cloud/Dockerfile` as before.
- **The diff** touches `cloud/Dockerfile` and this ticket's records only.

Verdict: APPROVE b8a3428f97e6f14b2c2947f71f2425cac46ed761
