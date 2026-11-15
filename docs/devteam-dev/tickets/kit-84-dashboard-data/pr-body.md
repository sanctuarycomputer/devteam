Derived data for the dashboard overhaul's pages (feature dashboard-cleanup, DCL-S6 and DCL-S7). Every field is read from what the kit already has; nothing new is stored, and no read writes the log.

- **Plain names for every kind of decision.** `CLASS_WORDS` sits beside the rungs. `/api/data` carries `class_words`, and `class_name` on the decision, trust, act, answered and question rows. Learning marks read "<name> to <level in words>". A class the supervisor made up reads "Unnamed kind (<its words>)", and a known class in another case reads as its name.
- **What holds each item.** `held_by` on tickets and planners names the open owner question holding them, first in Inbox order. A new `blocked-without-question` finding (medium) covers an item blocked under an hour with nothing naming it. The `blocked` (high) and `blocked-on-owner` findings keep their text and conditions.
- **Threads by state.** `threads: { you, waiting, ready }` in `hello --json`, `/api/hello` (what the hub reads) and `/api/data`.
- **Upkeep's days.** `upkeep_days` holds the last 14 UTC days: chores merged, kit syncs, CI fixes (which mark the day failed) and retros. Recurring checks join it in kit-168.
- **The governance listing.** There is a new `governance [--json]` command and `GET /api/governance`. They list the kit's governance and process files and the project's strategy and exterior, each with a title, the last change on main, and whether it was changed here since the last kit sync. Shallow history reads "—". A missing file, or init's untouched strategy template, reads "not written yet".
- **Every kit setting.** `settings_all` has 44 entries, taken from the same two maps `loadSettings` reads plus `sensor_scrub`. Each entry is grouped and named, with a one-line description, the value on main, the local value when it differs, the default and `owner_only`. Commands and URLs are never shown. Maps show only their names, and lists of secrets only their count. A shown value must pass its shape and the scrubber, or it is withheld.

The G1 golden `test/fixtures/g1/dashboard-data.txt` is re-recorded under ruling m-20261115-201425507. Its diff is the new fields only. The 30 lines it shows as removed come back unchanged plus a trailing comma, where a new key now follows what was an object's last key. A script and the task-7 reviewer both checked this. `test/ooda-learning.test.mjs` changes one line, its rung label in words, under ruling m-20261115-222112817.

## How to verify

- `node test/run.mjs --concurrency 2 test/dashboard-data.test.mjs` runs six tests, one per done-when area, each on a throwaway fixture.
- `node --test --test-name-pattern '^G1' test/components.test.mjs` checks the golden.
- `node test/run.mjs --concurrency 2 test/ooda-learning.test.mjs` checks the rung label.
- CI (test.yml) runs the full suite. See `docs/devteam-dev/tickets/kit-84-dashboard-data/verification.md` for the run and each done-when's evidence.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
