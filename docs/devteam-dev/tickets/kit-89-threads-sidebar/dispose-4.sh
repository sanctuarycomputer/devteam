#!/bin/sh
# kit-89: dispositions for spec-4 and plan-3.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-89-threads-sidebar
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
f=spec-4.md
node $D dispose $T $f S4-1 "fixed: §2.6 keeps .tl-card.in-dock for a floating card with no box on screen, beside the open panel; the router never moves a floating t by itself"
node $D dispose $T $f S4-2 "fixed: §2.5 under talk/, any change of t, dropping it included, replaces the entry"
node $D dispose $T $f S4-3 "fixed: §2.5 decisions needing the threads wait for the first /api/threads read, and the route runs again when it lands"
node $D dispose $T $f S4-4 "fixed: §2.5 the link-head rule covers changes that stay on the page; a floating row navigates as §2.4"
node $D dispose $T $f S4-5 "fixed: §2.5 on a fresh link head the store goes into history.state.page; the duplicate sentence removed"
node $D dispose $T $f S4-6 "fixed: §2.9 pin mode keeps Escape first; leaving an in-panel thread focuses its row"
node $D dispose $T $f S4-7 "fixed: §2.1 #th-tabs follows the pane's redraw rule"
node $D dispose $T $f S4-8 "fixed: §3 fixture's second question is asked in A; the moving counts run on their own project"
f=plan-3.md
node $D dispose $T $f P3-1 "fixed: one F.sup ask plus the one asked in A, so two open questions"
node $D dispose $T $f P3-2 "fixed: in-dock kept (spec §2.6), placed beside the panel in T2, tested there; dashboard.test.mjs ~3338 kept"
node $D dispose $T $f P3-3 "fixed: T2's talk/ check asserts history.state.page"
node $D dispose $T $f P3-4 "fixed: T3 tests the back arrow under a talk/ card"
node $D dispose $T $f P3-5 "fixed: T3 waits for the first threads read and tests a held fresh tab"
node $D dispose $T $f P3-6 "fixed: T2 tests Escape in pin mode; T1 tests a focused tab across a count change"
