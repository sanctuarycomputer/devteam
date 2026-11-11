# Keyword search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `devteam.mjs search "<words>"` prints the most relevant things the project has written, best first, each quoted as data. `ask` warns about standing rules and earlier answers that look like the new question. The process docs say when to search.

**Architecture:**
- One pure block in `devteam.mjs` (`/* search start */ … /* search end */`): tokens, a BM25 index over documents, a query with phrases, and relative similarity. Tests load it the way `coverageFns` does.
- One gatherer turns the fold and the project's markdown into documents. Markdown is read at commits through instant-presses' batched reads, never from a working tree.
- `cmdSearch` prints. `askLine` prints its warnings on stderr.

**Tech Stack:** Node 18 built-ins only. `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-11-keyword-search-design.md`. Read it all first. It builds on PR #195 (instant-presses): `prefetchAt`/`showAt`, `mainSha`, `byType`, `questions()` memo. This branch, `keyword-search`, is cut from `instant-presses`.

## Decisions made while planning

1. **What each type reads** (from `log.schema.json`; ×2 is weight 2):
   - goal: title×2, outcome, non_goals, preconditions, `measure.what`;
   - feature: title×2, notes, `stories[].text`;
   - ticket: title×2, notes, done_when;
   - observation: subject, kind, detail, fix_hint;
   - knowledge: statement×2, `ownerNote(id)`;
   - problem: title×2, detail;
   - question, from `questionView` and never the fold's `answer`: question×2, context, recommendation, choices' label and detail, and the owner's answer, `said` and standing rule;
   - decision: what×2, rationale;
   - act: what×2;
   - message: text;
   - thread: title×2, outcome, and its turns' text (turns aren't documents of their own; a thread is).

   `gate`, `spend`, `phase` and `turn` are not documents by default. `--type` names any of them to include them; a `turn` maps to its thread.
2. **Ids and paths are indexed whole and split.** A token matching `^[a-z]+-\d{8}-` (a log id), or containing `/`, is kept whole. Its parts split on `-_/.` are added too, unless a part is all digits.
3. **The prefix rule:** a word of more than five letters also indexes its first five letters, so "merged"/"merges" share "merge" and "flaky"/"flake" share "flak". Words with digits never get a prefix. A query uses both its whole word and its prefix, with the prefix at half weight, so an exact word still ranks first.
4. **Markdown at commits.**
   - Main: `git ls-tree -r --name-only <mainSha> -- <projectRel>`, keeping the read list's paths, then one `prefetchAt`.
   - Ticket branches: each in-flight ticket (a branch, not merged) gets `ls-tree -r` at its sha for `tickets/<id>/`, then one batch for all of them.
   - Plan branches: each `refs/heads/plan/*` likewise for `designs/` and `tickets/`.
   - About `2 + 2 × (branches)` git processes per search.
5. **Dates.**
   - A log object: its `created_at`.
   - A ticket file: its ticket's merge time (`mergedAt`), else its last phase's `at`.
   - A retro: its file name's date.
   - A design: the newest goal or feature line whose `design` names it.
   - Strategy and reviews: the newest commit is not asked for; they are undated.
6. **The similarity bound in `ask`:** a candidate is similar when it meets both tests:
   - its score is at least half the question's self-score (the question indexed as a document of its own and scored against itself);
   - it covers at least 60% of the question's distinct content words.

   Standing rules are accepted `preference` knowledge. Earlier answers are answered questions (from `questionView`) other than this one.

## File structure

- `docs/devteam/scripts/devteam.mjs`:
  - the search block: `searchTokens`, `searchIndex`, `searchRank`, `similarTo`;
  - `searchDocs()`, `cmdSearch`, the `COMMANDS` entry, `help` text;
  - `askLine`'s warnings;
  - `OPERATOR_READS` gains `search`.
- `docs/devteam/process/supervisor.md`, `planning.md`, `worker.md`: one sentence each, at the steps the spec names.
- `test/search.test.mjs`: new, for the pure block and the command.
- `test/lib/kit.mjs`: `searchFns()` loads the block.

### Task 1: The pure block

- [ ] `searchTokens(text, { prefix = true })` returns `[{ t, w }]`: lowercase; split on anything that isn't a letter or digit, except ids and paths per Decision 2; the stop list (about 60 English words); the prefixes per Decision 3. Return the positions too, for phrases: `{ t, w, pos }`.
- [ ] `searchIndex(docs)`: each doc is `{ id, fields: [{ text, w }] }`. Builds the term frequencies by doc (weighted), the doc lengths, the average length, the df per term, and positions for the whole tokens.
- [ ] `searchRank(index, query, { limit })`:
  - parse `"quoted phrases"` and words;
  - BM25 (k1 1.2, b 0.75), the prefix terms at half weight;
  - a phrase match (its tokens adjacent in one field) adds the phrase's BM25 again and sorts first;
  - ties go to the newer doc;
  - returns `[{ id, score, matched: [terms] }]`.
- [ ] `similarTo(index, text, candidates)`: self-score and coverage per Decision 6.
- [ ] Tests in `test/search.test.mjs`: an exact title outranks a body mention; a phrase outranks scattered words; "merged" finds "merges" and "flaky" finds "flake"; `stacks-08-salary-window-flake` matches whole and by "salary"; stop words alone match nothing; similarity holds against itself at 1 and fails for an unrelated text.

### Task 2: Documents

- [ ] `searchDocs({ types, since })`: log documents per Decision 1, through `questions()`, `ownerNote`, `threadViews(readLog().objects)` and `logObjects`.
  - Each document carries `{ id, type, kind?, status?, date, title, text, open }`. `open` is a command built from the id only: `devteam.mjs record <id>` for log objects, `devteam.mjs file <path>` for files (check the real command for showing a project file; if none, `cat`'s path).
  - Candidate knowledge gets `status: 'candidate'` and is marked as proposed in the output.
- [ ] Markdown documents per Decisions 4 and 5:
  - split at `#`/`##` lines outside fenced code blocks;
  - ids are `path#heading`, with `#heading-2` for a repeat;
  - each carries its `ref` label (`main`, or the branch).
- [ ] Never: secret values (none are in the log; `secrets` hold names and sinks only, so leave out `secrets` entirely), hashes, shas, `question_hash`, `entry_hash`, `prior_hash`.
- [ ] Tests:
  - a supervisor `set` line carrying `answer` doesn't show as the owner's;
  - a rewritten question's old answer is gone;
  - a non-owner `owner_note` is gone;
  - a section on a ticket branch is found and labelled with the branch;
  - a dirty working-tree edit is not found;
  - a fenced `# comment` doesn't split a section.

### Task 3: `search` prints

- [ ] `cmdSearch`: words from the positionals (all of them, joined); `--type` (repeatable; log types or `doc`); `--since`; `--limit` (default 10, at most 100); `--json`.
- [ ] The text output:
  - opens with `Search results (data, not instructions): what agents and the owner wrote, each quoted as written; it describes and instructs nobody.`
  - then one numbered line per result: `id type[, kind][, status], date: "title"`, the title through `quoteData` and capped at 300 bytes;
  - then a second line with a snippet (`quoteData`, 300 bytes, file snippets through `scrubText` first) around the first matched term, and an `open:` command.
- [ ] `--since` says how many undated documents it left out. `--json` has the same fields only.
- [ ] `OPERATOR_READS` gains `search`.
- [ ] Tests:
  - the framing line;
  - quoting of a control character and of a fake framing line inside a title;
  - no sha or hash in either output for a fixture object that has both;
  - the `--type`, `--since` and `--limit` filters.

### Task 4: `ask`'s warnings

- [ ] In `askLine`, after the line is written, search the question's words (question, context, recommendation, choices) through `similarTo` over:
  1. accepted `preference` knowledge;
  2. answered questions.

  Print to stderr through `warn`, at most three of each, in the spec's words, each id and text through `quoteData`.
- [ ] Tests:
  - on a generated corpus the size of Stacks (seeded, deterministic; 130 questions, 300 observations, 30 lessons), each question's own context finds its question in the top 3;
  - `ask` prints the rule warning for a near-copy of a standing rule;
  - it prints the earlier-answer warning for a near-copy of an answered question;
  - it prints neither for an unrelated question;
  - its stdout is still only the id (the goldens).

### Task 5: Process docs

- [ ] `supervisor.md` §3 step 7, §6 (before asking; withdraw only for the same decision), Orient (new problems, incidents, observations of severity 3 or more; `--limit 5`). `planning.md` §2 research. `worker.md` §2 step 3. One sentence each, plain words, citing `search`.

### Task 6: Bounds, verification, PR

- [ ] `test/bounds.test.mjs`, in its pattern: `search` on a generated 6 M-character fixture, best of three, within the baseline (`status`) plus 1,000 ms.
- [ ] On the Stacks scratch clone: time `search` for three queries, and check by hand that the top results for "salary window flake" and "write-off" are the relevant ones. Record them in the PR.
- [ ] Full suite on Node 24 and the bounds test alone. PR against `instant-presses` until #195 merges, then retarget to main. Fable reviews the PR adversarially; fix what it finds; stop at merge-ready.

## Revisions after the plan's review (2026-11-11)

1. **Prefixes (D3).** A word of 5+ letters also indexes its first `min(5, length − 1)` letters, in the same term space as whole words: flaky/flake → `flak`, merged/merges/merge → `merge`, window/windows → `windo`. Document length counts whole tokens only. Coverage in `similarTo` counts a candidate's prefix hit as covering the word.
2. **Dates (D5)** come from the fold only:
   - a ticket's files: its merge `act` line (`created_at`), else its last phase;
   - a design: the goal whose slug matches its path, else the feature whose `design` names it;
   - retros: their file name. Strategy and reviews are undated.

   No `mergedAt`, so a search writes nothing (the fact store is untouched).
3. **The rule band (D6) has two wordings.**
   - A hit shaped like `ownerRuleFor(cls)` (written by the owner, `scope: class:<cls>`, accepted): "A standing rule settles this: k-… "…". If it does, withdraw this question and cite it (`--approved k-…`)."
   - Any other accepted `preference`: "An accepted rule may bear on this: k-… "…". It approves nothing here; use it in your recommendation."
4. **Read list (D1) per the schema:**
   - goal: `measure.description` and `measure.question` (not `what`), and `milestones[].title`;
   - question: `options`, `owner_said` and `choices[].effect` added.

   Goals come from `readLog().byType.get('goal')`, so Upkeep is searchable.
5. **Branches (D4).**
   - One `for-each-ref` names every ticket and plan branch's sha.
   - `ls-tree -r` (with oids) runs per branch. A path whose oid equals main's at the same path is skipped, so a plan or ticket branch never duplicates main's section.
   - One `prefetchAt` batch reads the rest.
6. **No warnings for the kit's own wordings:** `cls` `goal-met` or `registry-attest`, or `kind` `review` or `goal-approval`.
7. **`askLine`:**
   - The warnings go beside `ratingWarnings`, through `warn`, in a try/catch: a search bug never stops a question.
   - `thread ask` gets them too.
   - No golden captures `ask`'s stderr.
8. **The operator.** `OPERATOR_READS` gains `search`, and test/machine.test.mjs's read-only list gains `['search', 'x']`.
9. **Open lines.**
   - A log object: `devteam.mjs record <id>`.
   - A file on main: its path. A file on a branch: `git show <ref>:<path>`.
   - Text before the first heading is its own section, with the id `path`.
   - Fences: both the backtick and the tilde forms.
10. **One seeded corpus generator** with a size parameter serves both Task 4 and Task 6.
