#!/bin/sh
# kit-84: dispositions for plan-1.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-84-dashboard-data
R=plan-1.md
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
d P1-1 "fixed: a line() helper writes act, phase, message and decision lines with explicit unique ids (a counter breaks stamp ties); phase lines go in <ticket>.jsonl; the tidy duplicate is two ids, so the code's dedupe is what is tested"
d P1-2 "fixed: noId runs over the known classes; made-up classes are checked by exact value (the spec's fallback)"
d P1-3 "fixed: the fixture answers a new-feature question with --autonomy 3 (a rung mark, its label asserted) and adds owner knowledge (a rule row, asserted to exist)"
d P1-4 "fixed: the parked case uses its own goal, feature and ticket (t-e), with no question; only blocked-without-question is asserted absent"
d P1-5 "fixed: the defaults check covers only value keys the fixture doesn't set (set: false)"
d P1-6 "fixed: NOT_CLASSES lists the scan's non-class words, each with its reason"
d P1-7 "fixed: both findings gate on heldByMap (held_by), computed once in collectMetrics"
d P1-8 "fixed: governance is not added to OPERATOR_READS; HELP under Observe and orient"
d P1-9 "fixed: the test reads both maps' keys by regex, no vm"
d P1-10 "fixed: shownAs(key, kind, v) everywhere; default rules per kind; upstream_repo default null; the Other fallback and its order are in the interface"
d P1-11 "fixed: the token goes in tmux_session; the wrong-type case is agent_command 42 and max_active_tickets lots in the working tree; links x dropped"
d P1-12 "fixed: two real chores on day 0 plus the duplicate; dayAt(0) is midway between today's midnight and now"
d P1-13 "fixed: the planner is listed by a feature line on its branch naming a goal with an open approval question (F.approval)"
d P1-14 "fixed: uses kitRel; title fallbacks per spec; the HTTP check no longer claims held_by"
d P1-15 "fixed: G1 runs alone by --test-name-pattern; T6 on one fixture; T5 B and C share one; noId over every class_words value"
