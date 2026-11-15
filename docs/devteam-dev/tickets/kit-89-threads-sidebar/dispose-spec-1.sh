#!/bin/sh
# kit-89: dispositions for spec-1.
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
D="node $D"
f=spec-1.md
$D dispose $T $f F1 "fixed: §6 Q5 names dashboard-pages.test.mjs and dashboard-peek.test.mjs; sent as a design-change"
$D dispose $T $f F2 "fixed: §2.5 Bad values: the page's router checks th and t after parseHead and drops a bad one by replaceState; no block change"
$D dispose $T $f F3 "fixed: §2.1 #th-card-slot (no pane rewrite touches it), §2.4 the card moves only when its place changes; AC2 types across a poll and a redraw"
$D dispose $T $f F4 "fixed: §2.1 The panel is the layer's own: tlOwn and holding() widened to #threads, tlHitAt gives no subject over the panel"
$D dispose $T $f F5 "fixed: §2.8 the /view/ mechanism (TH in memory, thDraw writes #tt-peek from TL.threads and hello's inbox), its own .viewer rule not kit-141's inset; AC9"
$D dispose $T $f F6 "fixed: §2.4 states the reading (no kit subject lives in a peek), §6 Q4 asks it; AC2 proves it"
$D dispose $T $f F7 "fixed: §2.7 av-open wins over a peek; at 900px and below the mirror hides while the viewer is up; AC4 extended"
$D dispose $T $f F8 "fixed: §2.5 t is remembered only with th"
$D dispose $T $f F9 "fixed: §6 Q3 asks it with the recommendation; §2.3 says what a contrary ruling changes"
$D dispose $T $f F10 "fixed: §2.1 the page sets the disabled tabs' titles after each draw"
$D dispose $T $f F11 "fixed: §3 fixture: a second goal, a gone thread, counts 5/2, and the checks' order"
$D dispose $T $f F12 "fixed: §2.1 count() is null when none is your move; AC3 checks it"
$D dispose $T $f F13 "fixed: §2.2 the mirror copies aria-label and title; AC3 checks"
$D dispose $T $f F14 "fixed: §2.4 #th-card-slot is no-shell and .tl-card.in-panel overrides the floating frame"
$D dispose $T $f F15 "fixed: §2.9 Escape goes to the focused region first"
$D dispose $T $f F16 "fixed: §2.5 the back arrow is a new entry, stated with why; §2.3 the headline is t.title, stated with why"
