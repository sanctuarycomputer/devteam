# kit-200 notes (WIP, superseded by kit-201-tests-isolated-on-box)

No code changed yet. What the catch-up found, for kit-201's worker:

- Ruling m-20261114-215142046-supervisor (re m-20261114-215131874): touches add test/lib/kit.mjs and
  test/gateway.test.mjs; the one shared helper is a scrub at import in test/lib/kit.mjs. Keep it small.
- test/lib/kit.mjs today deletes only DEVTEAM_HOME, TMUX, TMUX_PANE from process.env at import.
  machine.test.mjs:14 / operator-threads.test.mjs:19 delete ROLE/TICKET/FEATURE but keep DEVTEAM_RUN.
- A worker on this box also carries DEVTEAM_PUBLIC_URL and DEVTEAM_PREVIEWS: PUBLIC_URL alone makes
  previewBox(), and so onBox(), true (devteam.mjs ~6618, 13004). The scrub must take them too.
- Don't scrub every DEVTEAM_* blindly: the harness's own knobs must survive the import, e.g.
  DEVTEAM_FORK (kit.test.mjs -> lib/fork.mjs; ESM imports run kit.mjs before fork.mjs reads it),
  DEVTEAM_FORK_AUDIT, DEVTEAM_TEST_* (KEEP, COLD, GITLEAKS, READ_DELAY_MS), DEVTEAM_G1_RECORD,
  DEVTEAM_CGROUP/MEMINFO (CI sets them in test.yml).
- gateway.test.mjs doesn't import lib/kit.mjs and spawns the kit with process.env whole (bareProject
  init ~l.304, dashboard ~l.319/765, operator-thread ~l.724).
- onBox(): box files are BOX_GATEWAY_FILE /opt/devteam/gateway.mjs and BOX_THREAD_KEY
  /etc/devteam/thread-key.pub, read in onBox, threadsNeedGateway and gatewayThreadKey (~13004-13030).
  An off switch has to cover all three (gatewayThreadKey otherwise reads the box's real key, not the
  test's DEVTEAM_GATEWAY_THREAD_KEY). The comment there says the file, not the env, says box, because
  an agent can change env: the spec should say why an explicit DEVTEAM_BOX=off is acceptable.
- Baseline on this box at cca0976, session env removed (env -u ...): hub-overview 2/2 pass (6s),
  machine 16/16 pass (138s), operator-threads 1 pass / 15 fail (37s), all from the box files.
