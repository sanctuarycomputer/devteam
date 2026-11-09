# Account rotation with cswap: implementation plan

Spec: `docs/superpowers/specs/2026-11-09-cswap-rotation-design.md`. All code is in `docs/devteam/scripts/devteam.mjs`, node built-ins only, matching its style. Tests in `test/dashboard.test.mjs`.

1. **Guard first.** `test/lib/kit.mjs`: `process.env.DEVTEAM_CSWAP = 'off'` beside the tmux guard.
2. **Failing tests**, with a stand-in `cswap` recording its argv.
3. **`findCswap()`**: the detection rule. `cswapJson(bin, args)`: `execFile`-free `spawnSync`, no shell, 45 s, 1 MB.
4. **`rotateAccounts(bin)`**: parses the event stream, returns `{ exhausted, needs_login, switched }`.
5. **`activeHasRoom(bin)`**: from `list --json`, false on anything unexpected.
6. **`limitStop(lines)`**: pure: `{ menu, limit, otherPrompt, busy }` from a pane's last 15 lines.
7. **`resumePane(target, key)`**: throttle, Escape-only for the menu, recapture, `typeInto`.
8. **`supervisorLimit()`**: transcript tail.
9. **`cmdAccountsTick`**, `supervisorOnly`; writes `run/accounts.json` atomically; add `accounts.json` and `accounts-resumed.json` to `RUN_KNOWN`; register the command.
10. **Dashboard**: `setInterval(...).unref()`, single-flight `execFile` with supervisor env and 90 s timeout; `--rotate` while this process holds the hub (flag set in `startHub`'s listening callback).
11. **Findings and hello**: `accountsState()` applies the 10-minute rule. `alert` in `helloBody`; hub tab shows it in the title and an aria label.
12. **Docs**: `supervisor.md` §11 (limit stops), README (a short section).
13. Whole suite on Node 24, then PR.
