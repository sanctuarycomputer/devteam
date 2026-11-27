# package-hub (kit-967)

From R, a laptop's hub runs from the installed package (`kit-package@1`'s hub, `kit-install@1`'s hub tree). This area holds one override, `overrides/dashboardHub.mjs`, and nothing else (kit-package-dist decision 11).

**What the override does.** A dashboard that starts the hub reads `~/.devteam/hub/current`.
- The hub runs from `current` when it names a runnable install: `packageStatus` reads it verified, it is layout 2, and its package's `docs/devteam/scripts/cli.mjs` is a file.
  - It runs as a child: `node <real folder>/node_modules/<name>/docs/devteam/scripts/cli.mjs hub`.
  - The child runs in the dashboard's project, as today's hub does, so its owner actions (the operator's threads) run where they run today. The installed script is in no repo, so the project's guard leaves it be; `DEVTEAM_OWN_KIT` is dropped from its environment, so it never reaches the operator's tmux server.
  - It logs to `~/.devteam/hub-<port>.log`, as any `devteam hub` does, not to the dashboard's log. The dashboard's log says when it starts, stops or restarts the child, and names that file.
  - The child is in the dashboard's process group.
  - `packagePrune` keeps any folder a live process holds by a word of its command line, so it keeps this one while the hub runs, even after `current` moved on. A child started through `current` would not be seen.
- Anything else runs the hub in the dashboard's own process, as before R. The dashboard's log says why: no install, not verified, not layout 2, or no `cli.mjs`.
- **One hub per port.** A child starts only once nothing answers on the hub port. The dashboard checks again every `DEVTEAM_HUB_RETRY_MS` (30 s).
- **Following `current`.** While a child runs, `current` is read every `DEVTEAM_HUB_POINTER_MS` (10 s).
  - A runnable install of the same package and a newer version replaces the child. The old child is stopped (SIGTERM, then SIGKILL after 10 s) and waited for before the new one starts.
  - Anything else is said once and the child stays.
- **When the child or the dashboard stops.** A child that exits on its own is started again after the retry wait, from what `current` names then. A child that ends within a minute of starting three times in a row hands the hub to the dashboard's own process. `close()` (a dashboard handing over to a new kit) and the dashboard's exit stop the child.

**The pin.** Line 1 is `// override dashboardHub sha256:<hash>`. The hash is of `dashboardHub`'s item as the split makes it, its comment lines included. That item is recorded below, under "The original".
- When main changes the declaration or its comment, the override goes stale (`the original changed: it is now sha256:<new>`), and `test/split-hub-pointer.test.mjs` skips and names it.
- A pin that isn't the recorded original's hash fails the test. So does a recorded original that isn't `dashboardHub` as it was at the commit that last changed this area, where the checkout has that history (not in CI's shallow checkout).

To remake the override:
1. Read the new original.
2. Carry any change in it (the image check, `startHub`'s arguments) into the override.
3. Put the new hash on line 1, and the new original below, copied by the split's own reading, never by hand:
   `node --input-type=module -e "const {findDecl,hash}=await import('./test/split/lib/overlay.mjs'); const fs=await import('node:fs'); const d=findDecl(fs.readFileSync('docs/devteam/scripts/devteam.mjs','utf8'),'dashboardHub'); console.log(hash(d.text)); console.log(d.text)"` (run at the kit's top)

**Known limits.**
- The child hub reports `kit: null` (its kit isn't the project's), so machine status labels it "hub served by a project's kit, ?".
- A dashboard killed outright (SIGKILL) leaves an orphan. The orphan doesn't follow `current`, holds its folder from pruning, and keeps later dashboards waiting until it is stopped.

`test/split-hub-pointer.test.mjs` checks all of it.

## The original

`dashboardHub`'s item as the split makes it, which line 1's hash pins:

```js
// A dashboard's hub, unless the box image runs the machine's hub on this port (DEVTEAM_IMAGE_HUB):
// then it is left to the image. The image relies on this check (IMAGE_RUNS).
function dashboardHub(log) {
  if (imageHub() === HUB_PORT) { log(`hub: left to the image (DEVTEAM_IMAGE_HUB=${HUB_PORT})`); return null; }
  return startHub(log, { kit: ownKitVersion() });
}
```
