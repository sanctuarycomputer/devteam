#!/bin/sh
# Run one test file, isolated from the box's real hub and records, at --test-concurrency=2.
# usage: run-tests.sh [test file] [extra node --test args…]
# default: test/kit.test.mjs filtered to this ticket's tests (every name holds "covered_by").
# Judge the result by this script's exit code, never by piped output.
set -u
cd "$(dirname "$0")/../../../.." || exit 2
file=${1:-test/kit.test.mjs}
[ $# -gt 0 ] && shift
if [ "$file" = test/kit.test.mjs ] && [ $# -eq 0 ]; then set -- --test-name-pattern=covered_by; fi
H=$(mktemp -d) || exit 2
for v in $(env | sed -n 's/^\(DEVTEAM_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
HOME=$H DEVTEAM_HUB_PORT=4791 nice timeout 900 node --test --test-concurrency=2 "$@" "$file"
rc=$?
rm -rf "${H:?}"
echo "exit $rc"
exit $rc
