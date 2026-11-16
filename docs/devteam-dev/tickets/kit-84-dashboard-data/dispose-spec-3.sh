#!/bin/sh
# kit-84: dispositions for spec-3.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-84-dashboard-data
R=spec-3.md
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
d F3-1 "fixed: the G1 golden test/fixtures/g1/dashboard-data.txt is asked of the supervisor as a design-change to touches (as kit-81); upkeep_days uses starts_at so G1 untimed keeps it stable; the false settings-golden claim is removed"
d F3-2 "fixed: value keys are shown only when their per-key shape holds and scrubText changes no string; otherwise withheld; the test plants an off-shape release and a token main_branch"
d F3-3 "fixed: the spec states the scan's real reach and why a miss is accepted (every setting has a default)"
d F3-4 "fixed: count is exactly sensor_scrub and secret_commands; the 29/7/2/6 split is stated"
