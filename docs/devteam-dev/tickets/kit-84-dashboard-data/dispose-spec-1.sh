#!/bin/sh
# kit-84: dispositions for spec-1.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-84-dashboard-data
R=spec-1.md
cd "$(git rev-parse --show-toplevel)"
# dispose reads docs/devteam/project/tickets/<id>/reviews: a temporary link there, removed after
L=docs/devteam/project/tickets/$T
made_project=0; made_tickets=0
[ -d docs/devteam/project ] || made_project=1
[ -d docs/devteam/project/tickets ] || made_tickets=1
cleanup() {
  [ -L "$L" ] && rm "$L"
  [ "$made_tickets" = 1 ] && rmdir docs/devteam/project/tickets 2>/dev/null
  [ "$made_project" = 1 ] && rmdir docs/devteam/project 2>/dev/null
  return 0
}
trap cleanup EXIT
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "$L"
d() { node "$D" dispose "$T" "$R" "$1" "$2"; }
d F1-1 "fixed: differs is per file (newest first-parent commit a sync commit or not); acceptance 1 has a two-sync case"
d F1-2 "fixed: a planner is blocked by an unanswered blocked message (cmdPhase allows planners only parked); acceptance 3 covers it"
d F1-3 "fixed: blocked (high, >=1h) unchanged; blocked-without-question covers the first hour, one finding per item at a time"
d F1-4 "fixed: the statement now names the page's localStorage marks (devteam.thread.seen) and why the server can't use them"
d F1-5 "fixed: the scanned set adds every quoted class in class: expressions, OWNER_ACTS and decision rows; a deletion self-test"
d F1-6 "fixed: learning_marks label uses className and the rung in words; it is a checked display field"
d F1-7 "fixed: retro-* chores left out (the retro counts once); chores-feature ticket words stated; acceptance 5 covers both"
d F1-8 "fixed: asked of the supervisor as a done_when amendment or ruling in the spec review request"
d F1-9 "fixed: ooda.* placement, class_words top-level, class_name null on classless rows"
d F1-10 "fixed: one git log walk per request, no in-process cache claim; shallow via git rev-parse --git-path shallow"
d F1-11 "fixed: fallback is Unnamed kind (...); the rule is case-insensitive"
d F1-12 "fixed: planners filter let-go questions as tickets do"
d F1-13 "fixed: a sync commit is one where upstream_base became a different release tag; null never counts"
