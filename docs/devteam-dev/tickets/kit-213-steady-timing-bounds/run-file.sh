#!/bin/sh
# Runs one kit test file in isolation, as the box allows: its own HOME, every DEVTEAM_* unset, a
# hub port away from 4320, nice, under a timeout, at --test-concurrency=2. Exits with node's status.
# usage: run-file.sh <test file> [kit root (default: this worktree)] [extra node --test args...]
f=${1:?test file}
root=${2:-$(git rev-parse --show-toplevel)}
[ $# -ge 2 ] && shift 2 || shift 1
H=$(mktemp -d "${TMPDIR:-/tmp}/kit213-home-XXXXXX")
for v in $(env | sed -n 's/^\(DEVTEAM_[A-Z0-9_]*\)=.*/\1/p'); do unset "$v"; done
export HOME="$H" DEVTEAM_HUB_PORT=4791
cd "$root" || exit 2
timeout 600 nice node --test --test-concurrency=2 "$@" "$f"
s=$?
rm -rf "${H:?}"
echo "run-file: $f at $root exited $s"
exit $s
