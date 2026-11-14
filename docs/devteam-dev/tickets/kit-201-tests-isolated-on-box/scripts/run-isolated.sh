#!/bin/sh
# Runs kit test files with the fleet's session env removed (ruling m-20261114-215602684-supervisor).
# usage: run-isolated.sh <test file>...
cd "$(dirname "$0")/../../../../.." || exit 1
d=$(mktemp -d)
env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE -u DEVTEAM_SUPERVISOR \
  -u DEVTEAM_PUBLIC_URL -u DEVTEAM_PREVIEWS -u TMUX -u TMUX_PANE TMUX_TMPDIR="$d" nice node --test "$@"
s=$?
rm -rf "$d"
exit $s
