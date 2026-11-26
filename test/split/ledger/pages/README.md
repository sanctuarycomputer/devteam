# The page ledger

The old dashboard pages (`docs/devteam/dashboard/index.html`, `hub.html`, `canvas.html`,
`browser.html`, `devteam-ui.js`, `devteam-ui.css`) are being rebuilt as apps. A change to them after the
**baseline** (the merge that added `test/split/parity.mjs`) must reach the apps too, so the parity run
lists each first-parent commit of main after the baseline whose diff touches one of them. Each is
**unacknowledged** until it has an entry here, at `test/split/ledger/pages/<full commit sha>.json`:

```json
{ "commit": "<full commit sha>", "pages": { "docs/devteam/dashboard/hub.html": "kit-1007-dashboard-e2e" } }
```

`pages` names, for each old page the commit changed, the full id of the ticket that ports the change to
its app. An entry acknowledges the commit; the report lists it as **acknowledged, not ported** until
every named ticket is merged on main.

Whoever changes an old page adds the entry in the same PR, or the ticket that ports it does. There are
none yet.
