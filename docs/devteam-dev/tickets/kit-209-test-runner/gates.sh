#!/bin/sh
# kit-209 verification gates, run through devteam's recorder, one file at a time (the box rule,
# m-20261115-070004373-supervisor): run.test.mjs on each Node major, and done-when 1's exact command
# (node test/run.mjs test/search.test.mjs) on each major. Output goes to <out dir>.
# usage: gates.sh <out dir>
set -u
out=$1
mkdir -p "$out"
cd "$(dirname "$0")/../../../.."
D='/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs'
for v in 18 20 22 24; do
  n=$(ls -d "$HOME"/.local/share/mise/installs/node/"$v".* | sort -V | tail -1)/bin/node
  echo "== node $v ($("$n" --version))"
  node "$D" gate "test-run-node$v" -- env -u DEVTEAM_RUN -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_SUPERVISOR "$n" --test --test-reporter=tap --test-concurrency=2 test/run.test.mjs > "$out/run-test-$v.txt" 2>&1
  echo "run.test.mjs exit $?: $(grep -E '^# (pass|fail|skipped|duration_ms)' "$out/run-test-$v.txt" | tr '\n' ' ')"
  node "$D" gate "test-search-node$v" -- env -u DEVTEAM_RUN -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_SUPERVISOR "$n" test/run.mjs test/search.test.mjs > "$out/search-$v.txt" 2>&1
  echo "run.mjs search exit $?: $(grep -E '^summary:|^test/search' "$out/search-$v.txt" | tr '\n' ' ')"
done
