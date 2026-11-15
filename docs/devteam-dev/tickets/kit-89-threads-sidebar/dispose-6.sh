#!/bin/sh
# kit-89: dispositions for spec-6 and plan-5.
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
f=spec-6.md
node $D dispose $T $f S6-1 "fixed: §2.1 a + draft becoming its thread keeps the focus"
node $D dispose $T $f S6-2 "fixed: §2.1 focus placed only for changes from panel or Inbox-button controls; a focus left in a closing panel goes to the visible button"
node $D dispose $T $f S6-3 "fixed: §2.6 every floating card hidden at 900px and below while the panel is open"
node $D dispose $T $f S6-4 "fixed: §2.1 each pane draw calls askDraw; .tl-panel .ask sizing moves to #ask-threads .ask"
f=plan-5.md
node $D dispose $T $f P5-1 "fixed: T2 keeps the focus on the draft-to-thread change and tests typing after Send"
node $D dispose $T $f P5-2 "fixed: ~3346 uses [data-tl-back]; closes use #th-close; ~2534 closes the viewer first until T4"
node $D dispose $T $f P5-3 "fixed: POLL_FAST's __threadsHold reused; Review Focus 1 waits 11 s and __threadsRead; T3's fresh tab has its own init script"
node $D dispose $T $f P5-4 "fixed: 380 (or #threads' own width), never the token's text"
node $D dispose $T $f P5-5 "fixed: T0 lists dashboard-pages/peek dock reads; T1 moves each, AC8 included"
