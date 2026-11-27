# The test ledger

The parity run (`test/split/parity.mjs`) compares every file under `test/` (but `test/split/`) in the
generated tree with the same file at the commit. A file whose tree text differs, or which the tree adds
or removes, is a **differing test**, and the report isn't clean until each one is accepted here.

One entry per differing test, at `test/split/ledger/tests/<path under test/>.json`:

```json
{ "file": "test/a.test.mjs", "ticket": "kit-1007-dashboard-e2e", "sha256": "<tree text>", "source_sha256": "<source text>" }
```

- `file`: the test's path.
- `ticket`: the full ticket id (its branch name after `ticket/`).
- `sha256`: SHA-256 of the test's text **in the tree** (`null` when the tree removes it).
- `source_sha256`: SHA-256 of its text at the commit the entry was written against (`null` when the tree
  adds it). A later change to the test on main voids the entry, as an override's hash pin does.

An entry is accepted only when both hashes match, the ticket is merged on main's first-parent line
(`Merge pull request #<n> from <owner>/ticket/<ticket>`), and that merge's diff touches the test:
`test/<f>`, `test/split/overlay/<area>/files/test/<f>`, or `test/split/overlay/<area>/patches/<f>.patch`
(or `…/patches/test/<f>.patch`), `<f>` the path under `test/`. Otherwise the report names the first
rule unmet. An entry over 64 KB, not JSON, short of a field, or for another file is a bad entry.

The ticket that changes the test (directly or through the overlay) writes its entry.
