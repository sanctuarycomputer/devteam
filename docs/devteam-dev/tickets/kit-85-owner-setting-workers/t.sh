#!/usr/bin/env bash
# run one test file, clean of DEVTEAM_* from the worker's own environment
set -o pipefail
for v in $(env | grep -o '^DEVTEAM_[A-Z_]*'); do unset "$v"; done
timeout 900 node --test --test-concurrency=2 "$@" 2>&1 | tail -${TAIL:-60}
