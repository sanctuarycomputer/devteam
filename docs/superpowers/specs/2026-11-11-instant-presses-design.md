# Instant presses: every dashboard press answers in milliseconds

Date: 2026-11-11. Builds on the dashboard's redraw hold (`index.html` `drawOrHold`/`holding()`), its `ANSWERED` map, and the read-only git memo (`gitReadCache`, `devteam.mjs` §1).

The owner asked for it once the cloud box was live: "pressing the respond button to a question in the inbox is slow. i would think it should be instant", then "goal here is that any UI press should be ms, not seconds."

## What is slow, measured

On Stacks (11,158 log lines in 93 files, 71 tickets), on the owner's Mac, 2026-11-11:

- **An answer takes about 2 s before its card changes.** The click posts `/api/answer`; the server runs a fresh `devteam.mjs answer` child and replies when it exits; only then does `markAnswered` run. The child reads the whole log, and `durableText` runs one `git show <main>:<log file>` per file: 93 subprocesses, 1.22 s. One `git cat-file --batch` reads the same 93 files in 31 ms. Write commands have no git memo, and `appendLog` drops `logCache`, so a second read after the first write (the settles check, a standing rule's line) pays it again. Then `nudgeSupervisor` makes up to three tmux calls, which the code notes can take seconds each on a busy server.
- **Every other press waits the same way.** Thirteen kinds of press post an owner action (answer, goal decide/hold, decline, lesson keep/retire, fleet, preview start/stop, forget, overrule, correct, secrets, review answer, and the thread layer's send/resolve/accept/reopen). Each runs a child, and the card changes only when it exits. Some show nothing at all while they wait (overrule, correct, thread send).
- **A refresh takes 7–12 s** (`dashboard-data`; 313 git subprocesses on one run). A CPU profile of one 7.1 s run: 4.85 s in git subprocesses. By source: `releasedIn` (one `git tag --contains` per merged ticket) 1.38 s; `durableText` 1.16 s; `homeMergedAt` (one `git show -s --format=%cI` per merged ticket) 0.96 s; reading review files off ticket branches 0.49 s. Of the JavaScript, `logObjects` scans every object on each call, about 0.75 s in all. Every open dashboard runs one every 10 s, and on the box many run at once, so they slow every other command there too.

## Goal

The owner presses something and the page has changed before the finger is up: the card says Answered, the goal shows Drained, the turn is in the thread. The server catches up in the background, in well under a second for an action. If the server refuses, the page puts things back exactly as they were (the typed answer, the picked choice) and says why. Nothing is ever shown as saved that the server refused.

## Decisions (the owner's)

1. **Any press is milliseconds.** That is the bar for what the owner sees, everywhere on the dashboard and the thread layer.
2. **No embeddings, no Postgres, for now.** Ranked keyword search is the next PR, with its own spec.

## Non-goals

- **No change to what a press means.** The same endpoint, the same child, the same checks (the question's hash, a review's sha256, same-origin), the same log lines. An answer authorizes exactly what it did before.
- **No server running actions in-process.** The CLI is the one writer; `devteam.mjs` keeps its process-per-command shape. The child gets cheaper, not replaced.
- **No skipped refreshes.** Serving the last data when "nothing changed" needs a fingerprint of every input (tmux panes, sensors, the clock, link repos); a missed input means a stale page. Left for later, with the numbers after this lands.
- **No change to the two-step confirms** (Let go, Park, Forget). Each step answers in ms; the second click is still required.

- **Drawer opens are in, as reads.** A drawer already draws at once from the page's data and fills its record and history from `/api/peek` (a `peek` child). It gets §2's cheaper reads and is counted in §3. Making the drawer need no child at all is a later PR, if the numbers after this one say so.

## Design

### 1. The page answers every press itself

One helper replaces the scattered busy/post/markAnswered code: `press(key, run, { apply, undo, errId })`, where `run` is a function that builds the request when it is sent.

- **`apply()` runs at once,** before anything is sent: it draws the press's result into the page and registers an *overlay* under `key` (§1.2).
- **The post goes in the background,** inside `sending()` (so a refresh is held while it is on the wire, as today; the review answer's raw `fetch` joins it). No `keepalive`: a post that outlives its tab could be refused with nobody there to see it, and the browser caps keepalive bodies at 64 KB in all.
- **On success** the overlay stays until the data shows the change (§1.2), then it goes. Drafts and picks are deleted only now, not on the click.
- **On refusal or any failure** (a non-2xx, a network error, a body that isn't JSON, a thrown `TypeError`), `undo()` puts back exactly what was there (the draft text, the picked choice, the checkbox), the overlay goes, the page redraws from the last data, and the error line where the owner pressed says: "Not saved: <the server's reason>." No button is ever left disabled.
- **Presses on one key run in order, and each builds its request when its turn comes.** A second press on the same goal or card waits for the first to come back. A thread's second Send waits for the first, and by then knows the thread's id, so it says rather than starting a second thread.
- **A page with presses in flight asks before it unloads** (`beforeunload`), and says so in the header while any are ("Saving…"). It is gone in under a second normally (§2).

#### 1.1 Each press

| Press | Shown at once | When the server says yes | Undone on refusal |
|---|---|---|---|
| Answer, Send (goal ask), Decline, Can't right now, Reply, Don't use this sensor | `markAnswered` on both copies (the Inbox and a thread card) | nothing more | the card back, draft and pick restored |
| Overrule (a defaulted question) | "Overruled: …" on the answered card | nothing more | the field back with its text |
| Review Answer / Send it back (panel) | the panel goes read-only with the result as answered | nothing more | the panel editable again, its draft kept |
| Post (secrets) | "Posting…" on the card; the card stays in the Inbox | `markAnswered` only if the child says the question is answered (every secret posted), as today; else the card as the server leaves it | the error on the card. The values are wiped either way, as today: a secret is never kept in the page after a post |
| Lesson Keep / Retire | the card leaves the Inbox | nothing more | the card back |
| Goal run / drain / park | the goal's hold as the server will derive it at once: the new mode, "Draining…"/"Parking…" while sessions run (never "Drained"), by the owner, now | nothing more | the old hold |
| Goal let go / restore | the goal's status and its card as `goal-decide` sets them | nothing more | as it was |
| Fleet drain / park / undrain / unpark / resume | the strip in the new state, with "…" | nothing more | the old strip |
| Preview start / stop | "Starting…" / "Stopping…" on the row | nothing more | the row as it was |
| Forget (artifact) | the record shows as forgotten | nothing more | as it was |
| Correct (a decision) | "Correction sent" under it; the form closes | nothing more | the form, with its text |
| Thread Send | the owner's turn in the card, marked "Sending…", the box cleared; a new thread opens with it | the turn as the server recorded it, and "Sent." or "It will read it when it next checks" from the server, as today | the turn removed, the text back in the box |
| Thread Resolve / Accept / Not yet / Reopen | the card closes, or reopens | nothing more | as it was |

An optimistic turn carries `pending: true`, and the unread marks (`tlSeen`, `tUnread`) skip it, so a pending turn's clock never marks the supervisor's next reply as read.

#### 1.2 Overlays survive refreshes

`ANSWERED` already keeps an answered card from coming back when a refresh lands before the server closed it. It becomes the general case: a map of overlays, each a set of pure functions over what the page loads (the data from `/api/data`, the fleet from `/api/fleet`, the threads from `/api/threads`), each giving that data as the owner's press says it will be: a question filtered out, a goal's `hold_view` and its questions' `goal_hold` set, a lesson filtered out, a turn appended. Each loader applies the overlays to what it loads before it draws, so a refresh landing mid-press never shows the old state. An overlay leaves when the data agrees with it (each overlay says what agreement is), when its post fails, or 2 minutes after the server said yes, as long as the data the page has is fresh (not served `x-devteam-stale`).

### 2. The child gets cheap

Every change below gives the same answer as today, from the same objects, faster. The rule they rest on is the constitution's "compute state, don't record it": nothing here is a record. The facts in §2.2 are a cache of what git computes, each a function of the object ids in its key, and deleting the cache changes nothing but time.

1. **One batched read of main's log files.** `readLog` resolves `mainRef()` to its sha once and reads every `<sha>:<project>/log/<file>.jsonl` with one `git cat-file --batch` (the list on its stdin). The output is read as bytes and sliced by the byte size each header gives, then decoded per object, so non-ASCII text survives. Each result is shaped exactly as today's `git show` gives it through `git()` and `durableText` (one trailing newline stripped, one added back), and `<spec> missing` reads as missing. Results go in a per-process memo keyed by repo, commit sha and path (§2.3), and `durableText` reads from it. Keyed by the sha, not the ref, so `fetchMain` moving main never serves an old copy.
2. **A store of git facts that never change, on disk.** `run/cache/git-facts.json` (gitignored, like the rest of `run/`), keyed by the repo's root and full shas:
   - a commit's date (`show -s --format=%cI`), stored only when git gave one;
   - whether `<a>` is an ancestor of `<b>` (`merge-base --is-ancestor`), stored only for exit 0 (yes) and 1 (no), never for an error (an object not fetched yet: the answer changes when it arrives). It is run through a helper that sees the exit status, since `git()` folds every failure into `null`. `isOnMain`'s raw `spawnSync` goes through it, its sha resolved to the full one first;
   - the release a commit is in (`releasedInWith`, with its pattern), keyed by the sha, the pattern and a fingerprint of the tag list (one `for-each-ref refs/tags` per process): a new, moved or deleted tag changes the fingerprint and every release answer is asked again. Stored only when `tag --contains` succeeded.

   Ancestry and release answers also carry whether the repo is shallow (`rev-parse --is-shallow-repository`, once per process): deepening a clone changes them with no sha or tag changing. The store is read once per process and, if this process added to it, written on `exit` (not `beforeExit`, since `die` exits): read again, union, a temp file, then rename. Two processes racing lose at most one's additions, and the next run asks again. At most 20,000 entries; the oldest go first. A file that doesn't parse is ignored and rebuilt. Workers, the supervisor and the dashboard share it (`runDir`), which is fine because every entry is a function of its key.
3. **Reads at an exact commit are memoized in every command,** not only read-only ones: `show <sha>:<path>`, `cat-file -e <sha>:<path>`, `cat-file blob <oid>`, `ls-tree <sha>:<dir>`, keyed by repo, sha and path. A sha names the same bytes forever, so a write command can't read stale. Calls by ref name stay live in write commands, as today.
4. **Ticket branches' review files in two batched reads.** `deriveStatus` reads each unmerged ticket's `reviews/` off its branch (`srcList` then one `srcRead` per file, by ref name). The refresh resolves every ticket branch to its sha from the ref listing it already makes, reads all their `reviews/` trees in one `cat-file --batch`, then all their files in a second, into §2.3's memo. `srcList` and `srcRead` resolve the ref and read from it. A linked repo's tickets do the same in that repo.
5. **`logObjects` from an index.** `readLog` builds a by-type map once when it folds; `logObjects(type)` returns from it, a new array as today's `filter` did. `appendLog` still drops the cache, so the next read folds again (now with no git, from §2.1's memo).
6. **The nudge doesn't hold the reply.** `answer` (and every owner action that types into the supervisor's pane) writes its line, prints, and hands the typing to a detached process of its own, so the server replies as soon as the line is in the log. If the typing fails, it warns where `nudgeSupervisor`'s warning goes today (the dashboard log) and the supervisor reads the answer on its next tick, as it does today when no pane is recorded.
7. **The server's own loop isn't blocked.** `/api/threads` resolves the supervisor's pane with sync tmux calls every 10 s; it gets an async refresh with the cached value served meanwhile. `refreshHello`'s `git rev-parse` moves to `execFile`. `threadsRead`'s fold after a log change stays sync (it is the threads' own read); its cost is measured and noted in the verification.

Targets on Stacks, measured after: an answer's reply under 500 ms; a refresh under 2 s; a `peek` under 500 ms. They are targets for the verification, not promises; §3 bounds what can be counted.

### 3. What proves it

- **Presses, in Chrome** (the driven-dashboard harness in `test/dashboard.test.mjs`, `test/lib/chrome.mjs`): with the page holding each owner action on the wire (the harness's fetch wrapper, `POLL_FAST`, which already holds `/api/answer`, widened to every owner POST; no knob in the kit), each press in §1.1 is checked logically, not with a stopwatch: right after the click, with the post still held (the page's saving count above zero), the page already shows the press's result. A refused answer (a stale `seen`) puts the card back with its text and pick and shows the reason. A refresh landing mid-press doesn't bring the old state back. Two presses on one goal land in order. Two quick Sends on a new thread make one thread with two turns. A pending turn doesn't mark a reply read.
- **Spawns, counted.** A fixture project with 40 tickets (10 with branches and reviews), 40 log files and 3 release tags. A `PATH` shim counts git processes. `dashboard-data`'s second run spawns at most a fixed number, the same with 40 tickets as with 10. `answer`'s reply spawns at most a fixed number (counted before the detached nudge). `peek ticket` likewise.
- **Exactness, by the golden output.** `dashboard-data` (untimed and normalized like the others) and `peek ticket g1-01-a` join `g1Outputs` in `test/lib/kit.mjs` in a first commit, recorded from today's code. The rest of the PR must leave the golden unchanged. The fixture gains a log line with non-ASCII text and a durable file without a trailing newline. The main-vs-branch diff on Stacks is run once by hand and recorded in the verification.
- **The fact store is safe.** A moved or new tag changes `releasedIn`; a commit missing then fetched gets its real ancestry; a shallow repo deepened gets new answers; a corrupt or missing `git-facts.json` is ignored and rebuilt; two processes writing at once leave a valid file that holds both's entries or one's.

## Risks

- **The page says saved and the server refuses.** It is put back and says why where the owner pressed, on both copies of a card. The window is the server's reply time, under a second once §2 lands.
- **Closing the tab mid-press.** `beforeunload` asks. A post already on the wire still completes on the server; its refusal, if any, is lost with the tab, and the question shows open again on the next visit. That is today's behavior too.
- **A wrong fact.** Every entry is keyed by full shas (and the tag list, the pattern, shallowness), and only definite answers are stored, so a wrong one needs git itself to have changed an object. A parse failure falls back to asking git.
- **Sync work left in the server** (`threadsRead`'s fold after a change). Measured and stated in the verification; a follow-up if it shows.
