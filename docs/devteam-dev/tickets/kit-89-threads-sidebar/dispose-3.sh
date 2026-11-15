#!/bin/sh
# kit-89: dispositions for spec-3 and plan-2.
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
f=spec-3.md
node $D dispose $T $f S3-1 "fixed: §2.5 TH_MADE tells a Threads change from a fresh entry; the route order is apply, draw, write; AC7 covers x then a nav click"
node $D dispose $T $f S3-2 "fixed: §2.4 tlInPanel decided by whether the subject exists (tlHome), never by the page shown; only an in-panel t is remembered; the gone row is in-panel"
node $D dispose $T $f S3-3 "fixed: §2.4 the + thread's t is a new entry via thGo; AC7 checks Back shows the list"
node $D dispose $T $f S3-4 "fixed: §2.9 the card's Escape narrowed to #tl; focus on the panel list closes the panel"
node $D dispose $T $f S3-5 "fixed: §2.5 under a talk/ head a change of t replaces the entry with the page head plus th, t"
node $D dispose $T $f S3-6 "fixed: §2.9 focus returns to the visible button (#tt-peek or .tt), else the peek's or viewer's close"
node $D dispose $T $f S3-7 "fixed: §2.4 in /view/ a thread whose subject isn't this stage's is in-panel"
f=plan-2.md
node $D dispose $T $f P2-1 "fixed: TL;DR is seven bullets"
node $D dispose $T $f P2-2 "fixed: 'the counts as threads move' runs on its own fixture with its numbers stated; Review Focus 4 moved into it"
node $D dispose $T $f P2-3 "fixed: thGo and thHead are T1's; the peek cases of T2 moved to T3"
node $D dispose $T $f P2-4 "fixed: the dock is removed in T1, so no id exists twice"
node $D dispose $T $f P2-5 "fixed: Review Focus 4 names the composer and the fetch hold"
node $D dispose $T $f P2-6 "fixed: the tlHitAt check is at 720x800"
node $D dispose $T $f P2-7 "fixed: T5 opts.inbox matches nothing; the stored panel state cleared before each entry"
node $D dispose $T $f P2-8 "fixed: Global Constraints: each test's own origin, and subtests close the panel"
node $D dispose $T $f P2-9 "fixed: T1 asserts #tt-peek hidden and the drawn tabs' aria-disabled"
node $D dispose $T $f P2-10 "fixed: one timeout (900); dashboard-peek unconditional; the measure through gate; pane-question in every task's five; its line 242 replaced"
node $D dispose $T $f P2-11 "fixed: thread A holds a question asked in it (thread ask)"
