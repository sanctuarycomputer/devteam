#!/bin/sh
# kit-84: dispositions for spec-2.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-84-dashboard-data
R=spec-2.md
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
d F2-1 "fixed: §6 shows no credential by construction: per-key show kinds (value, names, count, hidden); free-text commands and upstream_repo hidden; the test plants credentials in every place one could live"
d F2-2 "fixed: sensor_scrub added via SETTINGS_READ_ONLY_HERE; the test scans loadSettings()/settingsAt() reads so a key read anywhere must be listed (44 today)"
d F2-3 "fixed: descriptions true to the code (caps 5 and 2, hold_review_days a parked goal, incident_slots, secret_commands, release); the plan lists every one for review"
d F2-4 "fixed: the review request asks the supervisor to amend the done-when to every setting the kit reads (44 today), or rule"
d F2-5 "fixed: settingsAt(main, { orNull: true }), null falls back to loadSettings() with source; local carries the working-tree value when it differs"
