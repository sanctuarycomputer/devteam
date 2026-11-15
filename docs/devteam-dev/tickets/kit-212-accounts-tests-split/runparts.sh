#!/usr/bin/env bash
# kit-212 plan T1 step 5: each part alone through the gate recorder, niced, one at a time.
#   bash runparts.sh <out-dir> [part...]
set -uo pipefail
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
out="$1"; shift
parts=("$@"); [ ${#parts[@]} -eq 0 ] && parts=(rotation leaving restart restart-guards untrusted supervisor)
mkdir -p "$out"
for p in "${parts[@]}"; do
  nice timeout 600 node "$D" gate test -- node --test --test-concurrency=2 "test/accounts.$p.test.mjs" > "$out/$p.tap" 2>&1 </dev/null
  echo "$p exit $? $(node "$(dirname "$0")/tapsum.mjs" "$out/$p.tap")"
done
