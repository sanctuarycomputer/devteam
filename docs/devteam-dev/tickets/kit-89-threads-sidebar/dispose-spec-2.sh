#!/bin/sh
# kit-89: dispositions for spec-2.
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
f=spec-2.md
node $D dispose $T $f N1 "fixed: §2.5 Under a link head (peek, viewer, preview, review, talk card) a Threads change is withPage and the link stays open; remembered state read from the page head in force; AC2 checks the viewer stays"
node $D dispose $T $f N2 "fixed: §2.1 render()'s draft keeping skips #threads too; plan T2 tests a question's field in the in-panel card"
node $D dispose $T $f N3 "fixed: §2.4 a floating row writes the subject's page head with t, th kept above 900px and dropped at 900 and below; AC2 checks both"
node $D dispose $T $f N4 "fixed: §2.8 av-open is never set in /view/; .viewer rules show the mirror at every width and lift the panel; hello every 30 s"
node $D dispose $T $f N5 "fixed: §2.4 in the panel the card's head is hidden and it drops role=dialog"
node $D dispose $T $f N6 "fixed: §2.4 the + draft is in memory, URL unchanged; Send gives t by replaceState; AC2 checks"
node $D dispose $T $f N7 "fixed: §2.5 t without th for an in-panel-only thread gets th=open by replaceState"
node $D dispose $T $f N8 "fixed: AC4 measures a probe element of width var(--av-right, 0px)"
node $D dispose $T $f N9 "fixed: AC8 says what the checks judge with the panel open; the panel and card are overlays left out by design"
node $D dispose $T $f N10 "fixed: §6 Q6, ruled in (m-20261115-210541487); plan T5 changes its navigation"
node $D dispose $T $f N11 "fixed: §7 records m-20261115-205924178 and m-20261115-210541487"
