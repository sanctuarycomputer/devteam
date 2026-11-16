#!/bin/bash
# run-test.sh <file> [name pattern]: one test file on Node 22, the way this ticket runs them on the shared box:
# --test-concurrency=2, niced, on 2 cores, a throwaway HOME and DEVTEAM_BOX=off (the box's own files
# ignored, as on a CI runner), the session's DEVTEAM_* and TMUX* unset, under a 600 s timeout.
set -u
cd "$(dirname "$0")/../../../.."
H=$(mktemp -d)
trap 'rm -rf "${H:?}"' EXIT
ARGS=(--test --test-concurrency=2)
[ -n "${2:-}" ] && ARGS+=(--test-name-pattern="$2")
env -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_RUN -u DEVTEAM_SUPERVISOR -u DEVTEAM_HOME -u DEVTEAM_FEATURE -u TMUX -u TMUX_PANE \
  HOME="$H" DEVTEAM_BOX=off timeout 600 nice taskset -c 0,1 /usr/local/bin/node "${ARGS[@]}" "$1" </dev/null
