/* imports start */
import { BROWSER_USAGE } from './browser.mjs';
import { RESPONDER_HELP } from './responder.mjs';
import { cmdAccountsTick } from './hub/health-pool.mjs';
import { cmdAck } from './orient.mjs';
import { cmdAct } from './questions.mjs';
import { cmdAnswer } from './decide.mjs';
import { cmdArtifact } from './artifact-notes.mjs';
import { cmdArtifacts } from './artifact-notes.mjs';
import { cmdAsk } from './decide.mjs';
import { cmdBoxPins } from './box-pins.mjs';
import { cmdBrowser } from './browser-view.mjs';
import { cmdBrowserGuard } from './browser-guard.mjs';
import { cmdCheckPr } from './pr-checks.mjs';
import { cmdCheckTicket } from './check-ticket.mjs';
import { cmdChore } from './goals.mjs';
import { cmdComponents } from './lineage.mjs';
import { cmdCorrect } from './questions.mjs';
import { cmdDashboard } from './dashboard/server.mjs';
import { cmdDashboardData } from './orient.mjs';
import { cmdDecide } from './questions.mjs';
import { cmdDecisions } from './trust.mjs';
import { cmdDispose } from './log-sync.mjs';
import { cmdDrain } from './fleet.mjs';
import { cmdExterior } from './world-model.mjs';
import { cmdFeature } from './holds.mjs';
import { cmdFleet } from './fleet.mjs';
import { cmdGate } from './sessions.mjs';
import { cmdGoal } from './goals.mjs';
import { cmdGovernance } from './pr-checks.mjs';
import { cmdHandoff } from './fleet.mjs';
import { cmdHello } from './lineage.mjs';
import { cmdHistory } from './lineage.mjs';
import { cmdHub } from './hub/health-pool.mjs';
import { cmdInit } from './init.mjs';
import { cmdKnowledge } from './observe.mjs';
import { cmdLink } from './lineage.mjs';
import { cmdLinks } from './lineage.mjs';
import { cmdLog } from './log-sync.mjs';
import { cmdLogCheck } from './log-sync.mjs';
import { cmdLogSync } from './log-sync.mjs';
import { cmdMachine } from './recover.mjs';
import { cmdMerge } from './merge.mjs';
import { cmdMessages } from './sessions.mjs';
import { cmdMetrics } from './orient.mjs';
import { cmdMoves } from './orient.mjs';
import { cmdNext } from './questions.mjs';
import { cmdNotes } from './lineage.mjs';
import { cmdObserve } from './questions.mjs';
import { cmdObserveLink } from './questions.mjs';
import { cmdObserveMetrics } from './questions.mjs';
import { cmdObserveSpend } from './spend.mjs';
import { cmdOperatorThread } from './hub/operator.mjs';
import { cmdOrient } from './scores.mjs';
import { cmdOwnerSetting } from './sessions.mjs';
import { cmdPackage } from './recurring.mjs';
import { cmdPane } from './sessions.mjs';
import { cmdPeek } from './lineage.mjs';
import { cmdPhase } from './sessions.mjs';
import { cmdPreview } from './previews.mjs';
import { cmdProblem } from './observe.mjs';
import { cmdPrompt } from './sessions.mjs';
import { cmdQuestions } from './questions.mjs';
import { cmdRate } from './decide.mjs';
import { cmdReady } from './holds.mjs';
import { cmdRecord } from './lineage.mjs';
import { cmdRecover } from './recover.mjs';
import { cmdRecurring } from './recurring.mjs';
import { cmdRemediate } from './remediation.mjs';
import { cmdRepair } from './questions.mjs';
import { cmdResponder } from './responder.mjs';
import { cmdRetro } from './goals.mjs';
import { cmdReview } from './artifact-notes.mjs';
import { cmdReviewWorktree } from './pr-checks.mjs';
import { cmdRoadmap } from './goals.mjs';
import { cmdSearch } from './observe.mjs';
import { cmdSecret } from './secrets.mjs';
import { cmdSelf } from './self-model.mjs';
import { cmdSend } from './sessions.mjs';
import { cmdSensor } from './remediation.mjs';
import { cmdSettings } from './lineage.mjs';
import { cmdStatus } from './holds.mjs';
import { cmdStopOk } from './sessions.mjs';
import { cmdSupervisorSession } from './accounts.mjs';
import { cmdThread } from './threads.mjs';
import { cmdTicket } from './holds.mjs';
import { cmdTimeline } from './orient.mjs';
import { cmdTrust } from './trust.mjs';
import { cmdUndrain } from './fleet.mjs';
import { cmdUnread } from './sessions.mjs';
import { cmdValidate } from './panes.mjs';
import { cmdWait } from './remediation.mjs';
import { cmdWaves } from './holds.mjs';
import { cmdWhoami } from './lineage.mjs';
import { cmdWithdraw } from './decide.mjs';
import { makeSession } from './fleet.mjs';
import { questions } from './log-sync.mjs';
/* imports end */
/* HELP start */
/* helpSections start */
export const HELP_SETUP = `Setup and roles
  init [--name n] [--upstream-base vX]   project folders, settings, .gitignore, the devteam section of AGENTS.md
  prompt supervisor | worker <id> | planner <feature> | responder    the prompt a session starts with
  supervisor-session                 the id of the supervisor's Claude Code conversation (claude --resume <id>); nothing if there's none, or another harness
  recover [--dry-run] [--force] [--here] | recover --machine [--dry-run] [--force] [--in <dir>…] [--was-up <list>] [--session s] [--only <repo>]   after a restart (a dead laptop, a redeploy): bring back this repo's supervisor, or every repo's on this machine, if it was up and its fleet isn't held, on its exact conversation where the harness can (Claude Code); --force also starts one the owner stopped or whose fleet is held; --here runs it in this terminal; safe to run twice. --in adds every adopted repo in a folder; --was-up names a list of roots that were up (a box's), used up as they come back; --session puts each in that tmux session as sup-<repo>
  machine status [--questions | --knowledge] [--in <dir>…] [--notes <file>] | machine tell <repo> <message> | machine alert <text>|--clear | machine pane-state <pane> | machine limit-state <pane>   every project on this machine (recorded in ~/.devteam, and under --in): a read-only digest (with when the operator's daily review is due, from --notes), or the open questions, or the accepted knowledge, not in --notes; a message into a repo's supervisor, marked as not the owner's, only when its pane is at its prompt; a line on the hub and the owner's devices; what a pane is at (ready busy dialog limit typing shell other unknown gone). tell and alert are the operator's or the owner's
  operator-thread new "<words>" [--title t] [--subject json] | say <ot-id> "<words>" | close <ot-id> | reopen <ot-id> ["<words>"] | start | reply <ot-id> "<words>" | list [--open | --waiting] [--json] | show <ot-id> | status   the owner's threads with the machine's operator, as the hub's Overview keeps them (beside the operator, in no repo): new, say, close, reopen and start are the owner's (start brings up a laptop's operator, once, in tmux session devteam-home); reply is the operator's; each owner turn is typed into the operator's pane as one line
  worker <ticket-id> [--resume [--if-gone]] [--force] | worker <ticket-id> --remove [--force] | planner <feature> [--goal <g-id>] [--resume] [--force] [--id-block <n>]   supervisor: a worktree, a tmux window and an agent for a ticket or a feature plan (a new planner names its goal and reserves n ticket numbers, default 20); refused while its goal is parked or let go, or draining for a session that hasn't run, or (a resume of one that ran aside) while the machine's memory is at its machine_memory_ceiling, unless --force (logged); --resume where no session exists starts fresh with the handoff note; worker --remove, once the ticket is merged and its worker logged phase done (--force before that), removes its worktree through the repo it belongs to and prunes that repo's worktree list (the branch stays)
${RESPONDER_HELP}
  whoami | settings [--get key]
  hello [--json]                   who this instance is (root, name, kit, open questions, fleet): what the hub lists`;
export const HELP_HOLDS = `Holds and the fleet (planning.md §1, holds; supervisor.md §12)
  goal hold <g-id|upkeep> run|drain|park [--reason r] [--for <cause>…] [--until <date>] [--owner]   a goal's toggle: drain starts nothing new and lets in-flight work finish; park stops its sessions (WIP commit, push, handoff). The supervisor drains a running goal (with --reason and --for, the cause it waits on; its drain needs --for; the date is optional, except that a pr:, run: or external: cause needs --until, at most 30 days ahead) and releases only its own drain
  goal park-sessions <g-id|upkeep> | --all [--again]   supervisor: send the park ruling to the sessions a park or let go holds, once per cause
  goal decide <g-id> let-go | restore [--notes n]   owner: let a goal go (its sessions park, its questions leave the inbox), or bring it back, parked
  fleet undrain | unpark | resume [--owner]   put back every goal the fleet op changed (and nobody changed since); resume does whichever are in force; on a new machine it first rebuilds an empty run/log from the landed log and prints the parity fingerprint before writing
  handoff [--file f] [--supervisor]   a parked worker or planner: the note (stdin) as an empty "devteam handoff: <name>" commit on its branch, pushed; the supervisor: an annotated devteam-handoff/<op> tag on origin
  fleet park|drain [--reason r] [--move] [--owner]   hold every goal: a pause on this machine, or with --move a move to another (it releases the host claim)
  fleet status [--json] [--no-fetch]   ready to move? per session parked (or, drained, nothing running), pushed, clean, handoff on origin; the log landed, spend observed, review results committed; the new machine's checklist; which machine supervises the repo
  fleet host [--json] [--no-fetch] | --release | --take   which machine supervises this repo (origin's refs/devteam/host claim); the owner's, when that machine is gone: --release frees it for the next start anywhere, --take takes it for the machine it runs on. It grants nothing
  drain --status | undrain           the old names: drain --status is fleet status; undrain lifts an old drain still in force (drain itself now asks for fleet park or fleet drain)`;
export const HELP_GRAPH = `The graph (planning.md)
  feature add|set|show <slug> --json '{…}' | --file f    a feature: goals, preconditions, stories with releases, design
  ticket add|set|show <id> --json '{…}' | --file f       a ticket: one PR of work
  ticket hold <id> --reason r --for <cause>… [--until <date>] [--whole "<why>"]   supervisor or planner: hold a ticket, naming what it waits on (q-…, a ticket, chore:<slug>, goal:<g-id>, pr:<link>#<n>, run:<link>:<id>, external:<words>; the last three need --until, at most 30 days ahead)
  ticket release <id> [--reason r]       supervisor or planner: lift a ticket's hold
  validate [--strict] [--plan <feature>]  graph rules D1-D11, reviews, goals, log health (--plan: the feature a detached plan head plans)
  waves [--feature f] | ready [--plan-ahead] | status [--json] | roadmap [--json]   status also prints each running goal with its next move under it
  moves [--json] [--holder owner|supervisor|planner|worker|nobody]   every running goal's, active ticket's, planner's and open chore's next move: what, who holds it, since when, owed or stalled marked (next-move@1)
  components check [--ref r] [--repo <link> [--path <checkout>]] [--count] [--json]   coverage: every tracked path at r (default main) owned by exactly one component line; exit 1 on any gap (--count: the Baseline's number); --repo checks another repo's tree under home's lines`;
export const HELP_CHECKS = `Checks and merging (quality.md)
  check-ticket <id> [--sha s] [--title t] [--body-file f] [--pr n]   definition of done at an exact head
  check-pr --head-ref r --sha s [--title t] [--body-file f] [--approved <qid>] [--repo <link> [--path <checkout>]]   what the forge's required check runs (optional; no gates, no approval acts; --approved holds a change to strategy.md, self.md or exterior.md to that owner answer, and without it such a change only warns); --repo checks a PR in another repo, in its checkout (--path names another one, such as a CI run's)
  merge <ticket-id> | merge --plan <feature> | merge --chore <slug> [--approved qid [qid …]] [--decision d-id] [--no-gates] [--dry-run]   supervisor: verify, run gates at the head, merge, log the act
  review-worktree <ticket-id> <sha> [--name suffix] | review-worktree --remove <path>   a final reviewer's detached worktree at exactly that sha, seeded like a worker's`;
export const HELP_SESSIONS = `Sessions (worker.md)
  phase <to> [--task t] [--note n] [--usd x --in n --out n]   phase change or liveness ping; phase supervisor --usd x
  gate <name> [--junit f] -- <cmd…>   run a gate and record it   |   gate --all: every settings gate here
  send <to> "<text>" [--kind k] [--re m-…] [--sha s] [--owner] | send supervisor "<text>" --kind handoff --thread <t-id> (the responder's) | messages [--open] [--to x] [--json]
  stop-ok                         for a stop hook: refuses while the last commit is newer than the last phase line`;
export const HELP_DECIDE = `Decide and act (supervisor.md, constitution.md)
  links [--json]                  the registry: home and each link, each repo's effective settings, the component lines and their coverage
  link add <id> --kind url --url u --title t [--for scope…] [--notes n] [--source id] | link set <id> <field> [--] <value> | link rm <id>   supervisor: a url link, written to settings.md and logged as registry-edit
  link add <id> --kind repo --remote r --title t [--path p] [--main_branch b] [--forge f] [--gates '{…}'] … [--approved qid]   supervisor: drafts a repo link (or link set|rm on one) and asks the owner (governance-edit; gate-change for a gate field); with the answer, writes it for the chore-registry PR
  link land [<chore slug>]   supervisor: copy only the links entries changed in this checkout's settings.md into .worktrees/chore-<slug> (default registry), leaving every other key as the chore has it
  artifact new <slug> --title t --summary s [--for '["goal:g"]']   draw an artifact (a page that shows an idea) in this worktree, under project/artifacts/<slug>/
  artifact check [<slug>…]        the checks merge runs, on this checkout's artifacts
  artifact manifest <slug> [--json]   what publishing a landed artifact would put up: main's tree, each file's sha256 (the cloud gateway's confirm page reads it)
  artifact describe <slug> [--at main|<worktree>|tree:<id>] [--json]   what a viewer shows of an artifact there (title, fingerprint) and main's fingerprint (the dashboard's /api/view reads it)
  artifact versions <slug> [--json]   an artifact's versions: its drafts, main's, then earlier ones by date (the dashboard's /api/artifact-versions reads it)
  artifact handoff <slug> [--at main|<worktree>|tree:<id>] [--json]   (owner) hand the open notes on that copy to the session drawing it (the dashboard's Hand over)
  artifact notes <slug> [--at main|<worktree>|tree:<id>] [--json]   the notes on that copy not yet resolved: each one's state, the spot as data, the owner's words
  artifact addressed <t-id> --note "<what changed>" [--sha <commit>] [--draft <worktree>]   (the session a note was handed to, or the supervisor) mark it, with the kit's picture of the spot: look at it
  artifact publish <slug> --owner --tree <t> | artifact unpublish <slug> --owner   the owner's record that a landed artifact went public or came down (the gateway's confirm page runs these; by hand they record intent only)
  artifact archivable <goal-id> [--at <time>] [--json]   the landed artifacts kit-935 archives when that goal is met (landed by --at); writes nothing
  artifact archive|restore <slug> [--reason "<why>"] [--owner]   archive a landed artifact (out of the Library, nothing deleted) or bring it back: the supervisor's, or the owner's with --owner
  artifacts [--json]              landed artifacts, and drafts in session worktrees
  preview <port> [--label "<one line>"]   register a server you are running; prints the link for this machine (a name derived from project, session and label)
  preview --run "<command>" [--port <p>] [--label …]   the kit runs it in a tmux window beside yours; PORT is set, {port} in the command is filled in, a free port in 4400-4499 is picked without --port
  preview list [--json]           this instance's previews, with whether each answers
  preview url [<name>]            the link, as the owner will open it
  preview stop <name> | --all     unregister (--all: your own; a name is any session's, there is no ownership check); stops the server if the kit started it
  browser-guard [--port n]        the browser's egress guard on its own (browser serve starts it; for tests): a loopback forward proxy that refuses this machine's network; prints {"browser":1,"port":n}
  ${BROWSER_USAGE}   supervisor: the supervisor's own Chrome (Node 22+), in a tmux window beside yours, with one private profile per project under ~/.devteam/browser/; profiles lists them as JSON, and forget removes one (every site in it signed out); a password or one-time code goes in on stdin, never as an argument (other local users can read a command line): browser type <ref> --stdin
  preview start <name>            run a kit-started preview again, on its name and port
  ask --question q [--kind k] [--class c] [--reasons r…] [--recommendation r] [--confidence 0-1] [--default d [--deadline 15m|2h|<time> (incident-fix)]] [--choices '[{"label","detail","effect"}…]' | --options "a" "b"… (each choice its own value, or one JSON array)] [--rule-scope s] [--goal g-… (goal-approval, goal-met: the kit writes a goal-met question)] [--links '[{"title","path","ref"}|{"title","url"}|{"title","link"}…]' (link: a registry id)] [--blocks ids] [--evidence ids] [--ticket id] [--re m-…] [--note path] [--secrets '[{"name","kind":"string|file","sink"}…]' (owner-action)]
  secret post <qid> [--file NAME=path] [--json]                          owner: post a question's secrets straight to their sinks; never logged (secret sinks lists them)
  ask --kind review --page <repo path> --ref <branch|sha> [--data <repo path>] [--result-schema <repo path>] [--allow-partial] --question q [--context c] [--class c] [--reasons r…] [--ticket id] [--blocks ids] [--re m-…]
                                  supervisor: an agent-drawn page for rows the owner decides; pins page, data and result schema to a commit and their sha256s
  review check <page.html> [--data d.json] [--result-schema s.json] [--json]   anyone: the static checks ask runs, with line numbers
  review show <qid> [--json [--contents]]   the pinned files and the result's status: verified, missing, tampered or declined (--contents adds the verified data, draft and result)
  review result <qid> [--json|--tsv|--commit]   the owner's result, once every hash verifies (exit 1 otherwise); --commit copies it into this worktree, the PR that asked (project/questions/<qid>/result.json, or the ticket's questions/<qid>/ on a ticket branch), and prints the line to stage it
  review verify <qid> --applied <file>   rows applied ([{ "id", "values", "evidence" }]) vs rows the owner decided; exit 1 on any difference
  review draft <qid> [<file|->]   owner: save partial progress; without a file, print it (a draft is never an answer)
  unread [--json]   what the owner wrote that the supervisor hasn't dealt with yet (answers, thread turns, decisions), oldest first, each with its ref   |   unread ack <ref> [<ref> …]   (supervisor) dealt with exactly those lines
  answer <qid> --review-result <file|-> | answer <qid> "<why>" --decline   (owner) a review: validate and hash its result, or send it back
  answer <qid> "<text>" [--autonomy 1|2|3 [--scope s]] [--rule "<standing rule>"]   (owner)   |   answer <qid> "<text>" --from-chat --said "<owner's words>" [--autonomy n] [--rule "…"] | answer <qid> "<text>" --from-turn <u-id> [--autonomy n] [--rule "…"] | answer <qid> "<text>" --from-turn <u-id> --said "<whole clauses>" [--at <n>] [--seen-turn <u-id>]   (a question asked with thread ask --turn) | answer <qid> --defaulted   (supervisor)
  thread new "<first words>" [--title "<line>"] [--subject '<json>'] | thread say <t-id> "<words>" | thread resolve <t-id> [--outcome "<line>" | --accept [--at <when it was proposed>] | --accept-addressed --at <when it was marked>] | thread reopen <t-id> ["<words>"]   (owner; the dashboard's Shift+click)   a thread with the supervisor about one thing; words may follow --; refused in the supervisor's own pane
  thread new --subject '{"kind":"item","ref":"question:q-…"}' [--title "<line>"] [--no-ask "<why>"] -- "<words>"   (supervisor)   your own thread about a question or goal (or goal:g-…), for what belongs to no open thread; at most 20 open; nothing is typed anywhere, the owner sees it as from you
  settings set <key> <1..20|none> [--for <act-id>]   (the supervisor sets max_active_tickets or max_active_per_component in its settings chore, .worktrees/chore-settings; none is no limit; --for names the owner's owner-setting act it lands, which must be the latest for the key with this value. It applies once merge --chore settings lands it)
  owner-setting <key> <1..20|none>   (the owner asks for one of the supervisor's own settings, max_active_tickets or max_active_per_component; none is no limit. The dashboard's Settings page runs it on Save; the supervisor lands it with settings set in its settings chore)
  pane question [--json]   (what the supervisor's terminal is asking; the owner answers it on the dashboard's card, which sends that option's digit key and nothing else: no command answers it)
  thread reply <t-id> "<words>" [--refs <type>:<id>…] [--pending] [--re <u-id>] [--off-subject "<why>"] [--no-ask "<why>"] [--anyway] | thread reply <t-id> --part <n> "<words>", then thread reply <t-id> --after-parts ["<last words>"] [reply's flags] | thread ask <t-id> --question "…" [--off-subject "<why>"] <ask's flags> | thread ask <t-id> --turn <u-id> [--seen-turn <u-id>] [--owner-said "<whole clauses>" [--at <n>]] --question "…" <ask's flags> | thread ready <t-id> --outcome "<line>" | thread unready <t-id> --reason "<line>"   (supervisor; the responder replies too)   reply, ask an Inbox question in it, propose resolving it (on an artifact note it takes a picture of the spot: look at it), withdraw a proposal or a session's mark; a turn nothing waits on (no owner turn owed, no open handoff) names its --refs on the thread's subject, or follows up your --pending turn with --re <that turn>, or says --off-subject "<why>"
  thread working <t-id> [--done]   (the session holding the owner's turn: the card shows it is responding until you reply)
  thread show <t-id> [--json] | thread list [--waiting [--responder] | --with <session> | --open | --all] [--json]   the thread, its subject framed as data; --waiting: open threads where the supervisor owes a reply; --waiting --responder: the owner's turns owed and routed to the responder, oldest first; --with: the artifact notes handed to that session, not yet marked
  withdraw <qid> [--reason r] | questions [--all] [--id q] [--json]   questions print in Inbox order: the most valuable first
  ask … --stake 1-3 --urgency 1-3 [--settles <qid>… --settles-if "<answer>"]   rate every question: how much of what the fleet does next rides on the answer, how soon waiting costs, and the open questions one answer would settle (stake 3, same goal or feature)
  rate <qid> [--stake 1-3] [--urgency 1-3] [--settles <qid>… | --settles none] [--unsettles <qid>…] [--settles-if "<answer>"]   supervisor: rate an open question again; --settles adds to what it settles
  next [--json]   the owner's next best step: the top of the Inbox, and why it is there
  decide --class c [--scope s] [--approved qid|kid] [--options a b] [--rationale r] [--confidence 0-1] [--refs ids] [--irreversible] -- "<what>"   a judgment call and the trust it rests on; prints d-…
  act --decision d-… -- "<what>"   carry out a decision (merge, ticket, withdraw, goal hold, worker, planner, fleet and link take --decision too)
  act --class c [--scope s] [--approved qid|kid] [--refs ids] [--irreversible] [--repo <link>] -- "<what>"   an act that is its own decision; --repo names the repo a release, staging or production act was in
  decisions [--who owner|supervisor] [--class c] [--corrected] [--tail n] [--json]   every call, who made it and under what
  correct <decision-or-act-id> --reason r [--severity n]   (owner; --retro for the supervisor) | correct <id> --from-turn <u-id> --said "<whole clauses>" [--at <n>] | correct <id> --from-chat --said "<owner's words>"   (supervisor, the owner's correction) | repair <id> --how undo|fix-ticket|none
  correct <goal-impact d-id> --reason r --impact 1-4   (owner) give the goal's impact yourself; it stands until you give another
  trust [--json]                  the ladder: rung, ceiling, agreement, corrections per class`;
export const HELP_OBSERVE = `Observe and orient
  observe --subject s --kind k --detail d [--source owner-chat|owner-answer|owner-thread|retro|…] [--severity 0-4] [--valence -2..2] [--key k] [--refs ids] [--fix f] [--value n --unit u]
  observe-link --url u | --path p --title t [--for scope…] [--notes n] [--owner]   a resource the work uses; orient proposes it for the registry
  wait [--minutes n]   supervisor, between ticks: blocks until a new message to you, a new owner line, a new high finding, or the tick is due (tick_minutes, default 15); an open high finding returns at once until acted on or acked
  observe-metrics | observe-spend | orient [--json] | metrics [--since date] [--json]   (observe-metrics records spend lines too, and each ended week's learning record)
  ack <finding-kind> <subject> --reason r [--owner]   set a finding aside for finding_ack_hours (a merge commit: for good)
  timeline <ticket-id> [--json]   the ticket and every log line, review and file that bears on it
  governance [--json]   the kit's governance and process files and the project's strategy, Self and exterior: title, last change, changed here
  self show [--json]   main's project/self.md, what the project is, printed as it is; --json is the dashboard's self block, null when not drafted or plain (self@2)
  self check   the working tree's self.md against self@2 (a plain document; a fenced self block is refused), each part link on disk, and the names rule; errors exit 1, warnings don't
  exterior show [--json] | exterior check   show: main's project/exterior.md, what the project relates to, printed as it is (--json a version 1 block's dashboard data, else null); check: the working tree's draft against exterior@2 (a version 1 block refused), its dated sources, and on a repo not known to be private the names rule (a heading of any form refused: one of level 3 to 6 not named whole, or a # or ## one holding a capitalised word but Exterior, or a link host, not named whole, in origin main's strategy or dependency names, or a # or ## or HTML one holding raw HTML, a character reference, an invisible or control character, a lone mark, ~~, [ or ], since a top-level heading must be plain text; each other capitalised word and link host held until named on the chore); errors exit 1
  knowledge [--status s] [--kind k] [--kit] | knowledge --for <ticket|feature|class> | knowledge add|set … [--kit [on|off]] (--kit: the supervisor's tag on its own entry, "this would hold for any project", for the box's operator; it grants nothing) [--for-owner --plain "<words>"] (a lesson that would change something the owner set waits for them, its plain line first; any other the supervisor keeps itself)
  search "<words>" [--type <log type>|doc]… [--since <date>] [--limit n] [--json]   what the project already wrote about it, best first, quoted as data (supervisor.md §6)
  problem [--all] | problem add --title t --severity n [--risk] [--threatens g…] | problem set <id> …`;
export const HELP_GOALS = `Goals and retros
  goal [list|check|show|forecast|add|set|order|decide|approve|status|reading|hold|park-sessions|impact] …
  goal impact <g-id> <1-4> --rationale "…" [--confidence 0-1]   supervisor: how much the goal matters to the project, judged against project/strategy.md (4 the project depends on it, 3 moves a number the project watches, 2 worth having, 1 housekeeping); orders the Inbox, never the work
  goal set <g-id> --approved <qid> …   supervisor: apply an answered goal-change question to a goal past draft (one set per answer)
  goal order <g-id> <g-id> …   owner: put the goals in order, 1..n; the goals left out keep their order after them (a line per goal named and per goal left out that moves, one goal-order act)
  goal order [<g-id> …] --approved <qid>   supervisor: apply an answered goal-change --order question, exactly the order it proposed
  goal reading <g-id> --run | --approved <qid> | --value n   a reading by the measure's source: --run runs a repo check on main or a prod check; --approved records an owner goal's yes from its answered goal-met question; --value only for a goal with no source, or the owner's own (--owner)
  retro [--due | --print | close <date> --summary s --refs ids]
  chore start <slug> [--what "…"] [--for <refs>] [--fresh] | chore adopt <slug> [--what "…"] [--for <refs>] | chore drop <slug> --reason "…" | chore pr <slug> --title t [--names-checked <word,…>]    a supervisor-written file (design, retro, architecture) and its PR; on a public or unknown repo it holds a self.md or exterior.md draft's unchecked names (capitalised words main's strategy.md and dependency files don't contain) until --names-checked names each, and an exterior.md naming an organisation or work main's strategy.md doesn't, which --names-checked never clears; chore start keeps an open branch's commits, refuses a dropped one unless --fresh, and records --what (the chore's title for the owner) and --for (the refs it serves); chore adopt records an existing branch; chore drop ends a chore and keeps its branch`;
export const HELP_RECURRING = `Jobs under Upkeep (supervisor.md, Recurring jobs)
  recurring list [--json]   main's jobs (project/recurring.json at main) in name order: kind, every, title, who registered each through an answered recurring-edit question (or not), the runs a day against the cap of 100, and the pending questions; a file on main that doesn't read prints its problem and exits 1. --json: { entries: [{ name, entry, runs_a_day, registered: { qid, at, by, act } | null, problems?: ["…"] }], runs_a_day, cap, pending: [{ qid, name, change, status }] }; problems is there only when an entry breaks the shape (validate says the same)
  recurring show <name> [--json]   one job on main in full, who registered it, its problems if it breaks the shape, and its pending questions
  recurring apply <qid>   supervisor: write an answered recurring-edit question's exact change into .worktrees/chore-recurring's recurring.json (chore start recurring first; its file must be main's), main's jobs with each null removed, each edit in its place and each addition last; then chore pr recurring and merge --chore recurring --approved <qid>
  recurring run --due   supervisor (wait starts it when a check is due): take run/recurring/.lock and run each due check of main's in an unseeded detached checkout of main, in its own process group under timeout_s; one recurring-run line each (detector recurring), the scrubbed tail in run/recurring/<name>/; a live lock: says who holds it and exits 0
  recurring run <name> --draft   supervisor: run this checkout's entry once the same way, to try it before asking; prints the status and excerpt, logs and keeps nothing
  recurring due [--json]   when each of main's checks is due, from the log alone: { checks: [{ name, due, slot, next, start }], runner: { pid, start, budget_s, current } | null }; a problem with main's file exits 1 naming it
  recurring ticket <name> --id <id> --touches <glob>… [--component <c>]   supervisor: a chores ticket to fix a failing check, cited by its add-ticket act (which clears recurring-failing); refused unless the check has failed fail_after runs in a row with no fix ticket
  recurring start <name>   supervisor: begin a due chore while Upkeep runs: yours opens .worktrees/chore-recurring-<name>-<yyyymmdd>, a worker's writes the chores ticket <component>-<NN>-recurring-<name>; logs a started run and prints the instructions headed with the approving question. It finishes when that chore PR or ticket merges
  recurring done <name> --nothing "<why>" | --abandoned "<why>"   supervisor: finish your started chore without a merge (--nothing removes its empty worktree); refused for a worker's chore, which ends only through its ticket (merged, or superseded)
  metrics raises recurring-failing (a check failing fail_after runs in a row, no fix ticket), recurring-stale (not run in 3 intervals while wait runs), recurring-invalid (main's recurring.json doesn't read, breaks the shape, or is over the 100-runs-a-day cap), recurring-due and recurring-overdue (a chore due and not started, past its grace_days; neither raised while Upkeep is drained or parked) and recurring-stuck (a chore started grace_days ago and not finished); recurring run --due logs recurring-failed and recurring-recovered after each pass`;
export const HELP_LOG = `The log
  log [--type t] [--by w] [--id x] [--tail n] [--json] | log-check | log-sync [--dry-run] | history [<ticket-id>]
  record <id> [--json]   one record's stored fields, who created it and who set each field | peek <kind> <id> --json | --mermaid   what a dashboard sidepeek shows beyond the data: history, its kind's details and, for a record in the loop (observation, signal, lesson, problem, decision, act, learning), its lineage; --mermaid prints the lineage as Mermaid text
  sensor status [--json] | sensor test <name> [--since t] | sensor poll [--due] [--name n] [--rollup-day d] [--json] (supervisor; wait runs it) | sensor series <name> [--range 24h|7d]   production sensors from settings
  sensor show <fingerprint> | sensor discover [--record] [--json] | sensor stream <name> (wait runs it) | sensor scrub < text   a cached event (untrusted), what production is and can be seen, a stream's collector, the scrubber
  sensor triage [--all] [--peek] [--json] | sensor ignore|unignore <fingerprint> --reason r [--owner] | sensor incident <fingerprint…> --title t | sensor incident <p-id> --add <fingerprint…>   what changed since the last triage, ignores, incidents (supervisor)
  remediate <action> --decision d-… [--to <release>]   run a reviewed remediation from settings (production-remediation; a rollback across a production migration needs the owner's own answer)`;
export const HELP_DASHBOARD = `Dashboard and releases
  dashboard [--port p] [--host h] | dashboard-data | notes <from-tag> [<to>] [--repo <link>]
  box-pins verify [--release vX.Y.Z] | check [--json] | bump --release vX.Y.Z [--dry-run]  (each [--dockerfile p])   in the kit's own checkout: the box image's tool pins in cloud/Dockerfile (Claude Code, claude-swap, gh, ttyd, mise, uv). verify checks them and the release stamp offline; check says which are behind upstream (exit 1 stale, 3 some unknown, 0 none, 2 no file or one that doesn't verify); bump moves every tool not held (a "# hold: <reason>" line above its _VERSION ARG) to its latest, with sums from the downloaded assets, and stamps the release. Only the top package of the npm and PyPI tools is pinned: their dependencies resolve when the image is built
  box-pins installed   inside the box image: each tool's version, asked at its path in the image (never through PATH), against DEVTEAM_BOX_TOOLS
  hub [--release vX.Y.Z]   the machine's hub alone, on 127.0.0.1:4320, retrying while anything holds it; logs to ~/.devteam/hub-<port>.log (the box's boot runs it from the image's kit with the image's release)`;
/* helpSections end */
export const HELP = `devteam <command>   (positionals before flags; flags take the words after them)

${[HELP_SETUP, HELP_HOLDS, HELP_GRAPH, HELP_CHECKS, HELP_SESSIONS, HELP_DECIDE, HELP_OBSERVE, HELP_GOALS, HELP_RECURRING, HELP_LOG, HELP_DASHBOARD].join('\n\n')}
`;

/* HELP end */
// What the box's operator may run: reads only (a test runs each and diffs the log and git status). A
// command that also writes is listed by its read forms, so `knowledge add` is refused like any write.
// recover, machine and operator-thread write, and are allowed by name below: bringing a supervisor
// back, the machine's digest, word to a supervisor and alert, and its own replies to the owner are
// what the operator's for (operator-thread holds each of its verbs to the owner or the operator).
export const OPERATOR_READS = new Set(['search', 'status', 'moves', 'ready', 'metrics', 'hello', 'settings', 'supervisor-session', 'prompt', 'validate', 'questions', 'next', 'unread', 'log', 'messages', 'knowledge', 'goal', 'goal list', 'goal show', 'fleet status', 'fleet host', 'trust', 'problem', 'sensor status', 'sensor series', 'peek', 'recurring list', 'recurring show']);
export const OPERATOR_SUBCOMMANDED = new Set(['fleet', 'goal', 'knowledge', 'problem', 'sensor', 'settings', 'unread', 'recurring']);
/* commandGroups start */
// The commands that read the whole project and change nothing: one answer per git question, and each
// ticket's reviews read once, as a dashboard refresh has it (a status on a big project was thousands
// of git processes). A command that writes never runs this way.
export const GIT_READ_ONLY = new Set(['status', 'ready', 'metrics']);
export const COMMANDS_SETUP = {
  init: cmdInit, prompt: cmdPrompt, worker: () => makeSession('worker'), planner: () => makeSession('planner'), responder: cmdResponder, whoami: cmdWhoami, hello: cmdHello, settings: cmdSettings,
};
export const COMMANDS_GRAPH = {
  feature: cmdFeature, ticket: cmdTicket, components: cmdComponents, link: cmdLink, links: cmdLinks, artifact: cmdArtifact, artifacts: cmdArtifacts, preview: cmdPreview, validate: cmdValidate, waves: cmdWaves, ready: cmdReady, status: cmdStatus, moves: cmdMoves, roadmap: cmdRoadmap,
};
export const COMMANDS_CHECKS = {
  'check-ticket': cmdCheckTicket, 'check-pr': cmdCheckPr, merge: cmdMerge, 'review-worktree': cmdReviewWorktree, package: cmdPackage,
};
export const COMMANDS_SESSIONS = {
  phase: cmdPhase, gate: cmdGate, send: cmdSend, messages: cmdMessages, 'stop-ok': cmdStopOk,
};
export const COMMANDS_DECIDE = {
  ask: cmdAsk, answer: cmdAnswer, unread: cmdUnread, thread: cmdThread, pane: cmdPane, 'owner-setting': cmdOwnerSetting, review: cmdReview, secret: cmdSecret, withdraw: cmdWithdraw, rate: cmdRate, next: cmdNext, questions: cmdQuestions, decide: cmdDecide, decisions: cmdDecisions, act: cmdAct, correct: cmdCorrect, repair: cmdRepair, trust: cmdTrust,
};
export const COMMANDS_OBSERVE = {
  observe: cmdObserve, 'observe-link': cmdObserveLink, 'observe-metrics': cmdObserveMetrics, 'observe-spend': cmdObserveSpend, orient: cmdOrient, metrics: cmdMetrics, ack: cmdAck, timeline: cmdTimeline, governance: cmdGovernance, self: cmdSelf, exterior: cmdExterior, knowledge: cmdKnowledge, search: cmdSearch, problem: cmdProblem,
};
export const COMMANDS_GOALS = {
  goal: cmdGoal, retro: cmdRetro, chore: cmdChore,
};
export const COMMANDS_LOG = {
  log: cmdLog, record: cmdRecord, peek: cmdPeek, sensor: cmdSensor, 'log-check': cmdLogCheck, remediate: cmdRemediate, 'accounts-tick': cmdAccountsTick, 'supervisor-session': cmdSupervisorSession, recover: cmdRecover, machine: cmdMachine, 'operator-thread': cmdOperatorThread, dispose: cmdDispose, 'log-sync': cmdLogSync, history: cmdHistory,
};
export const COMMANDS_HOLDS = {
  drain: cmdDrain, undrain: cmdUndrain, fleet: cmdFleet, handoff: cmdHandoff, wait: cmdWait,
};
export const COMMANDS_DASHBOARD = {
  dashboard: cmdDashboard, 'dashboard-data': cmdDashboardData, notes: cmdNotes, hub: cmdHub, 'box-pins': cmdBoxPins, 'browser-guard': cmdBrowserGuard, browser: cmdBrowser,
};
export const COMMANDS_RECURRING = {
  recurring: cmdRecurring,
};
/* commandGroups end */
export const COMMANDS = {
  ...COMMANDS_SETUP, ...COMMANDS_GRAPH, ...COMMANDS_CHECKS, ...COMMANDS_SESSIONS, ...COMMANDS_DECIDE, ...COMMANDS_OBSERVE, ...COMMANDS_GOALS, ...COMMANDS_LOG, ...COMMANDS_HOLDS, ...COMMANDS_DASHBOARD, ...COMMANDS_RECURRING,
};
