#!/bin/sh
# kit-213: dispositions for final-1, through the temporary link dispose expects (as dispose-1.sh).
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-213-steady-timing-bounds
cd "$(git rev-parse --show-toplevel)"
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
node "$D" dispose $T final-1.md F1 "fixed: the failed job (dashboard-owner-action.test.mjs after-hook ENOTEMPTY, untouched here; o-20261115-192324709) was re-run; gate ci on run 43751033783 exit 0, attempt 2 success, 8/8 jobs at 402ef7b; verification.md row 4 records it"
node "$D" dispose $T final-1.md F2 "wont-fix: spec wording only; verification.md states the exact count (six coverage runs in all), and the approved spec is not edited after approval"
node "$D" dispose $T final-1.md F3 "wont-fix: the bound catches the 10x the done-when asks (shown by b2); tightening it is beyond this ticket"
