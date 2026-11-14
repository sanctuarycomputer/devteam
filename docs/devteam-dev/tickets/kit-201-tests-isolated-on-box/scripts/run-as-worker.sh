#!/bin/sh
# Runs kit test files as a worker's session would: DEVTEAM_RUN, DEVTEAM_HOME, role, ticket, a box's
# address, a tmux pane, all pointed at a fresh decoy (never home's). Fails if anything lands there.
# usage: run-as-worker.sh <node --test args>...
cd "$(dirname "$0")/../../../../.." || exit 1
decoy=$(mktemp -d)
t=$(mktemp -d)
mkdir -p "$decoy/run"
DEVTEAM_RUN="$decoy/run" DEVTEAM_HOME="$decoy" DEVTEAM_ROLE=worker DEVTEAM_TICKET=x-1 DEVTEAM_FEATURE=x \
  DEVTEAM_PUBLIC_URL=https://box.example.com DEVTEAM_PREVIEWS=1 TMUX=x TMUX_PANE=%9 TMUX_TMPDIR="$t" \
  nice node --test "$@"
s=$?
left=$(find "$decoy" -mindepth 1 ! -path "$decoy/run" | head -5)
rm -rf "$decoy" "$t"
if [ -n "$left" ]; then echo "decoy written: $left" >&2; exit 1; fi
exit $s
