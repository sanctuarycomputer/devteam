#!/usr/bin/env bash
# run one test file, clean of DEVTEAM_* from the worker's own environment, on a throwaway HOME
# (boxFilesOff: on a box, the kit's tests see the box their environment describes only then)
set -o pipefail
for v in $(env | grep -o '^DEVTEAM_[A-Z_]*'); do unset "$v"; done
H=$(mktemp -d)
trap 'case "$H" in /tmp/*|"${TMPDIR:-/nonexistent}"/*) rm -rf -- "$H";; esac' EXIT
export HOME="$H" DEVTEAM_HUB_PORT=4399
timeout 900 node --test --test-concurrency=2 "$@" 2>&1 | tail -${TAIL:-60}
