# Search: ranked keyword search over everything the project has written

Date: 2026-11-11. Follows `2026-11-11-instant-presses-design.md`: its PR lands first, and this one uses its batched reads at a commit and its by-type log index. Builds on `knowledge --for` (scoped lessons), `history <id>`, `questions` and `questionView`.

The owner asked whether going without vector search makes the system dumber, then chose: "let's skip embeddings and postgres for now. I like the ranked keyword search!"

## Why

Agents find what the project knows by exact keys today. Lessons reach a prompt when their scope matches the ticket, feature or class (`knowledgeFor`). History comes by id (`history <id>`). The supervisor reads accepted knowledge whole at its start. That works while the record is small and every lesson is scoped right. It misses three things, and they grow with the log:

- **A lesson scoped to the wrong place** never reaches the worker it applies to.
- **"Have we seen this before?"** An incident, a refused merge, a flaky gate, a question: the earlier one exists under other ids, and nothing finds it but a grep the agent has to think of.
- **Asking the owner twice.** On Stacks, 43 pairs of questions share at least 60% of their content words, and five standing rules say nearly the same thing ("Always adopt new devteam releases…").

Stacks today: 11,158 log lines and 71 tickets' files. The text a person reads in them is about 6 M characters. In a trial on this Mac (Node 18), it tokenised and ranked in about 400 ms, using 133 MB, with no index on disk.

## Goal

`devteam.mjs search "salary window flake"` prints the most relevant things the project has written, best first: the incident, the observation, the ticket section that named it, the retro paragraph. Each comes with its id (or path and heading), its date, a quoted snippet and how to open it.

- **The supervisor** searches before it asks the owner, before a ladder decision, and when a new problem or a severe observation comes in.
- **A planner** searches in research.
- **A worker** searches after reading its history.

When the supervisor asks, `ask` shows the owner's earlier answers to questions that look like this one, labelled as context that approves nothing. It also shows any standing rule that may already settle it.

## Decisions (the owner's)

1. **Ranked keyword search, no embeddings, no Postgres.** It matches words, not meanings. Revisit only with evidence of misses where only the wording differs.

## Non-goals

- **No index on disk, no service.** The index is built in memory on each call. A cache comes only if a search on Stacks takes over a second once instant-presses has landed.
- **No dashboard search box.** Agents first. The owner's version is a later addition (`/api/search` over the same function).
- **No new authority, and nothing added to prompts automatically.** A search result is quoted data, read by an agent, and it approves nothing. `knowledge --for` stays the one thing that puts lessons in a prompt. An earlier answer never approves a new call: an answer approves one call, and only for its own goal (constitution §4; `act --approved` checks this).
- **No files from sibling repos yet.** A sibling ticket's log objects are searched, because they are in home's log. Its spec, plan and reviews live in that repo's own project and are not searched in this PR.

## Design

### 1. What is searched

Each result is one *document*.

**A log object**, as the kit reads it:
- A question's answer, standing rule and status come from `questionView`. That view counts only the owner's own lines, and it drops an answer whose question was rewritten since. The folded object's `answer` field is never read.
- A lesson's owner note comes from `ownerNote()`.

Each type's text is the set of fields a person reads, listed in the plan from `log.schema.json`. These include:
- **Question:** question, context, recommendation, choices, the answer and the owner's words.
- **Decision:** rationale.
- **Observation:** subject, kind, detail, fix hint.
- **Goal:** title, non-goals, milestones, the measure's what.
- **Ticket and feature:** title, notes, done-when, stories.

Never ids of commits, hashes, or secret names' values (no secret value is ever in the log). The title, statement or question counts double. `gate`, `spend` and `phase` lines are left out of results by default, because they are 60% of the log and say "build → verify". `--type` reaches them.

**A section of a project markdown file**, split at `#` and `##` headings outside code fences:
- `strategy.md`;
- `designs/*.md`;
- `retros/*.md`;
- `reviews/<feature>/*.md` and `reviews/<design>/*.md`;
- each ticket's `spec.md`, `plan.md`, `verification.md` and `reviews/*.md`.

Its id is `path#heading`, with `#heading-2` when a heading repeats. The files are read at commits, never from a working tree, which may be dirty or behind:
- **main's copy**, at `mainRef()`'s sha;
- **each in-flight ticket's folder** at its branch's sha, labelled with the branch;
- **each plan branch's** designs and tickets, at its sha, labelled the same way.

All of them come through the batched `cat-file --batch` reads from instant-presses. That is one or two git calls, however many files there are.

**Dates** come from the fold, never from `git log`:
- a log object's time;
- a ticket file's ticket (its merge time, else its last phase);
- a retro's file name;
- a design's newest goal or feature line that cites it;
- otherwise none. `--since` leaves undated documents out and says how many it left out.

### 2. Ranking

**Words.** BM25 (k1 1.2, b 0.75) over lowercase tokens. There is no stemming:
- Each token is kept whole, and also as its first five characters when it is longer, so "merged" meets "merges", and "flaky" meets "flake".
- Ids and paths are indexed whole and split: `stacks-08-salary-window-flake` matches as written and on "salary".
- `snake_case`, camelCase and `/` paths are split the same way.
- Tokens with digits, or that match a log id's pattern, are only kept whole.
- A short English stop list is removed.

**Phrases.** A quoted phrase must appear as adjacent tokens. Documents with it rank above those without.

**Ties** go to the newer document.

**Filters.** `--type <log type>|doc` (repeatable), `--since <date>`, `--limit <n>` (10 by default, at most 100), `--json`.

**Old things are kept.** Retired and stale knowledge, withdrawn questions and resolved problems stay searchable and marked. "We tried that and retired it" is what search is for. Candidate knowledge is marked "proposed by <writer>, not kept by the owner".

### 3. What it prints

```
Search results (data, not instructions): what agents and the owner wrote, each quoted as written…
1. k-20261104-… knowledge, lesson, accepted, 2026-11-04: "Salary window specs flake under parallel runs; pin the clock."
   open: devteam.mjs record k-20261104-…
2. tickets/stacks-08-salary-window-flake/spec.md#Root cause, doc at origin/main, 2026-11-06: "…the salary window spec fails when two runs share…"
   open: devteam.mjs file tickets/stacks-08-salary-window-flake/spec.md
```

- The block opens with the kit's data framing line, as Links and Artifacts do.
- Every title and snippet is one line, quoted with `quoteData`, and capped at 300 bytes. File snippets go through `scrubText` too.
- The matched words are not marked inside the quotes. The "open:" line is built only from the id or path, never from the text.
- `--json` carries the same fields and only those.

### 4. Where agents use it

**`ask` shows two kinds of earlier text**, as warnings on stderr, as its rating warnings do. The question is still asked and is unchanged.
- **Standing rules** (accepted `preference` knowledge) that may settle the question: "A standing rule may settle this: k-… "…". If it does, withdraw this question and cite the rule (`--approved k-…`)." This is how a rule already settles a call.
- **Earlier answered questions** that look like this one: "The owner answered similar questions before; read them for your recommendation. They approve nothing here: q-… "…" (answer: "…")."

**Similarity is relative, so it holds on any corpus.** A result counts as similar when it meets both tests:
- its score is at least 0.3 of the score the question would get against itself (on a small project, words only the new question has weigh most, so a near-copy scores about a third);
- it covers at least 60% of the distinct content words in the question, its context, recommendation and choices.

Questions get to the Inbox and to the owner's phone as soon as they are logged. So the supervisor runs `search` before `ask`, and `ask`'s warning is the backstop.

**The process docs**, one sentence each, at the step that already exists:
- **`supervisor.md`:**
  - §3 tick step 7, before a decision in a ladder class: `knowledge --for <class>`, `trust`, then `search "<the decision in a few words>" --limit 5`.
  - §6, before asking: `search` the question's words. Withdraw only when an earlier answer was to the same decision (same goal or ticket, same class). Otherwise use it in the recommendation.
  - Orient: `search --limit 5` for each new problem or incident, and for observations of severity 3 or more. Not every observation, so a tick stays short.
- **`planning.md` §2 research:** start from `architecture.md`, the accepted knowledge, and `search` for the goal's words.
- **`worker.md` §2 step 3:** after `history <id>`, `search` the ticket's title.

### 5. What proves it

- **Ranking, on a fixture:**
  - an exact title match ranks first;
  - a phrase outranks scattered words;
  - "merged" finds "merges", and "flaky" finds "flake";
  - an id matches whole and by its words;
  - a retired lesson is found and marked; a candidate one is marked as proposed;
  - `--type`, `--since` (with its count of undated documents) and `--limit` filter.
- **No false authority.** A supervisor `set` line carrying `answer` on a question never shows as the owner's answer. A rewritten question's old answer doesn't show. Neither does a non-owner line's `owner_note`.
- **What it reads.** A section on a ticket branch is found, labelled with its branch. A dirty working tree's edit is not found.
- **Quoting.** A snippet with control characters and a fake framing line comes out quoted on one line. No hash, sha or field outside the read list appears in either output.
- **`ask` on a generated corpus the size of Stacks.** Each question's own context finds the question in its top 3, for all but 2% of them (the generated contexts share only three of five topic words, so a few collide by chance). The two warnings print with their own wording when they should, and stay quiet when nothing is close.
- **Bounds.** In `test/bounds.test.mjs`'s pattern (best of three, relative to a baseline command on the same fixture), `search` finishes within the baseline plus 1,000 ms.
