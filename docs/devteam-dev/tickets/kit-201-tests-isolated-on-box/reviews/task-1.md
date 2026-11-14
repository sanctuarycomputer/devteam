# Task 1 review, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus)
- Reviewed: f0e6cdc8e7c0f702c5ccccbc27f3d1cc1f926398

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Suggestion | none | test/lib/kit.mjs boxFns | Every `boxFns()` call adds its own `process.on('exit')` listener and its own temp dir. The DEVTEAM_BOX=off test calls it 12 times, so each run prints `MaxListenersExceededWarning: 11 exit listeners` (seen in the TAP of the base run). One shared dir, or one listener the module registers once, would stop the noise. Nothing fails because of it. | fixed in Task 2: one temp dir and one exit listener per process |
| T1-2 | Suggestion | spec "The off switch's limit" (P6) | devteam.mjs:13025 boxFilesOff | A realpath comparison can't see a second path to the same directory, such as a bind mount or another mount of the volume, so a HOME spelled that way would count as a throwaway home. The spec asks for realpath and only for the accidental path, and nothing on the box mounts /data/home twice, so this isn't a defect. Comparing `statSync().dev`/`.ino` would close that gap too, if it ever matters. | wont-fix: the spec pins a real-path compare; nothing on the box mounts the home twice |

No Critical or Important findings. Checked:

- **Unset or other values.** When `DEVTEAM_BOX` is anything but exactly `off`, `boxFile(f)` is `fs.existsSync(f)`, so `onBox`, `threadsNeedGateway` and `gatewayThreadKey` work exactly as on main. The test covers unset, `on`, `OFF` and empty.
- **Fails closed.** If either realpath throws, or `userInfo()` throws, `boxFilesOff()` is false (L-SEC-2).
- **Real HOME and passwd home.** On this box both are `/data/home`, and the Dockerfile's `as_dev` sets `HOME=/data/home`, so the switch is never honored at the real home. Node's `os.homedir()` reads `$HOME`, and `os.userInfo().homedir` reads the passwd file. When HOME is unset, `os.homedir()` falls back to the passwd home, which compares equal. A relative HOME resolves to its real path.
- **Nothing reads or sets the switch outside the test.** `git grep DEVTEAM_BOX` over docs/, cloud/, test/ and .github/ finds only devteam.mjs's `boxFilesOff` and its comment, plus the new test. The only other hit is cloud/Dockerfile's `DEVTEAM_BOX_HOLD_SECONDS`, which is a different variable. Nothing else in devteam.mjs reads the two box paths.
- **No real box files reach the test.** The stand-in `fs` sends both box paths to temp files the loader writes, or to a missing path when a file isn't listed. The block reads no other path except the key file the test's environment names. So the real /opt and /etc files on this box don't leak in: the laptop case `L` passes here, where both real files exist.
- **Spec acceptance check 5.** The markers, the vm loader with stand-in fs, os and env, and the test cases (passwd home, symlink, trailing slash, missing HOME, no passwd entry, temp HOME with the environment's key, DEVTEAM_PUBLIC_URL, unset and `on`) all match the spec and plan Task 1. `node --check` passes.

Mutations: each one ran in a `git archive` copy of f0e6cdc under the scratchpad, with run-isolated.sh copied in, using `--test-reporter=tap --test-name-pattern='DEVTEAM_BOX=off' test/operator-threads.test.mjs`. The unmutated copy passes (`# pass 1`, `# fail 0`). Every mutation fails the test.

| Mutation | Failed at |
|---|---|
| Drop `realpathSync` and compare the raw strings | 'HOME is a symlink to it' |
| Make the catch return `true` (fail open) | 'HOME names nothing' |
| `boxFile` ignores the switch | the throwaway-HOME assertions |
| Drop the home check (`return DEVTEAM_BOX === 'off'`) | 'HOME is the passwd home' |
| `gatewayThreadKey` uses `fs.existsSync(BOX_GATEWAY_FILE)` directly | the env-key assertion |
| Accept the value case-insensitively | 'DEVTEAM_BOX=OFF' |

Verdict: APPROVE f0e6cdc8e7c0f702c5ccccbc27f3d1cc1f926398
