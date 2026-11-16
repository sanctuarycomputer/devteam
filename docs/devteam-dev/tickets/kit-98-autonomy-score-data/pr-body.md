`/api/data` gains `autonomy`, the data behind the Trust page (design: Autonomy pages › Trust). kit-93 draws it. It is computed on read and adds nothing to the log.

- **decisions:** the last 12 calendar weeks (kit-173's `efficiencyWeeks`), oldest first, ending with this week, plus `this_week`, `last_week` and `score`. Each week has:
  - its split: decided alone, asked the owner, corrected;
  - its score: round(100 × alone ÷ decisions), 0 with no decisions;
  - merged, answers and merged per answer;
  - questions asked again (a re-ask after the linked page moved doesn't count);
  - hours waiting on the owner (the union of open intervals, clipped to the week);
  - answers that went with the recommendation, as a count and a share.

  Merged, corrected and with the recommendation come from the week's learning record: the stored one when there is one, else `learningFigures` computed on read. A figure missing from a stored record reads 0. The rest is counted from the log on read (ruling m-20261115-224929460). Asked counts the owner's answers, defaults, goal verdicts, statuses and holds (Upkeep's included), and the owner's standing rules. The operator writes no project line, so it counts nowhere.
- **trust:** the kinds of decision it takes alone (rung 3) out of all of them, and this week's effective rung moves (raised, dropped, each change). Every step is capped as `rungFor` caps it.
- **senses:**
  - needed: the sensors in place plus discovery's proposals, missing and outside names;
  - has: needs no credential, credential posted, or working;
  - working: ok, or up;
  - missing: the needed sensors it doesn't have, by name.

  Every `sensor discover` writes `run/sensor-discovery.json`, and Senses reads that. A missing or malformed cache reads as no discovery.
- **Cost:** `withLogAt` gets a fast path for a cut after the log's last line, so this week needs no refold. An ended week with no stored record costs one fold.
- **Departure from the spec** (plan-1 P1, accepted with approve-plan, m-20261115-230057575): there is no cross-request cache. Every `/api/data` request runs `dashboard-data` in a fresh child, so nothing in the module survives between requests.
- **Title:** the ticket is now "The Trust Score's data". The field stays `autonomy` (m-20261116-052139143).

## How to verify

- `node --test --test-concurrency=2 test/autonomy-data.test.mjs` runs the hand-written fixture logs with known answers: every week's figures, a stored record against a recompute, a missing figure, the operator, the server path, trust's moves and caps, and senses with good, missing and malformed caches.
- `node --test --test-concurrency=2 test/components.test.mjs`: the G1 golden gains only the `autonomy` block, and `metrics.txt` doesn't move.
- CI (test.yml) runs the full suite. See `docs/devteam-dev/tickets/kit-98-autonomy-score-data/verification.md`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
