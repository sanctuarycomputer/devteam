#!/bin/sh
# kit-215: runs test.yml's own coverage step (extracted from the workflow, as written) on lists
# laid out as actions/download-artifact@v4 writes them, in four cases:
#   real lists -> 0; a file duplicated in one major -> 1; a file missing from one major -> 1;
#   one major's lists absent -> 1.
# Exits 0 only when every case gives what it should; 2 when the workflow has no coverage step.
# Runs no test: the lists come from `node test/run.mjs --list`, which runs nothing.
# Usage (from anywhere in the worktree): sh docs/devteam-dev/tickets/kit-215-sharded-test-yml/coverage-step.sh
set -eu
ROOT=$(git rev-parse --show-toplevel)
WF="$ROOT/.github/workflows/test.yml"
S=$(mktemp -d)
trap 'rm -rf "${S:?}"' EXIT

# The coverage step's `run: |` block, de-indented: the lines after `run: |` that follow the
# `- name: coverage` line, up to the first line indented no deeper than the `run:` key.
awk '
  /^[[:space:]]*- name: coverage[[:space:]]*$/ { found = 1; next }
  found && !inrun && /^[[:space:]]*run: \|[[:space:]]*$/ { inrun = 1; match($0, /^[[:space:]]*/); key = RLENGTH; next }
  inrun {
    if ($0 ~ /^[[:space:]]*$/) { print ""; next }
    match($0, /^[[:space:]]*/)
    if (RLENGTH <= key) exit
    if (!ind) ind = RLENGTH
    print substr($0, ind + 1)
  }
' "$WF" > "$S/coverage.sh"
if [ ! -s "$S/coverage.sh" ]; then echo "coverage-step: no 'coverage' step with a run: | block in $WF" >&2; exit 2; fi

# The 16 matrix rows: node key args (rest-1 also lists --group alone first).
rows='18 chain --group chain
18 rest-1 --group rest,chrome --shard 1/2
18 rest-2 --group rest,chrome --shard 2/2
20 chain --group chain
20 rest-1 --group rest,chrome --shard 1/2
20 rest-2 --group rest,chrome --shard 2/2
22 chain --group chain
22 rest-1 --group rest --shard 1/2
22 rest-2 --group rest --shard 2/2
22 chrome-1 --group chrome --shard 1/2
22 chrome-2 --group chrome --shard 2/2
24 chain --group chain
24 rest-1 --group rest --shard 1/2
24 rest-2 --group rest --shard 2/2
24 chrome-1 --group chrome --shard 1/2
24 chrome-2 --group chrome --shard 2/2'

fresh() {
  rm -rf "${S:?}/work"
  mkdir -p "$S/work/lists"
  ln -s "$ROOT/test" "$S/work/test"
  echo "$rows" | while read -r node key args; do
    d="$S/work/lists/list-$node-$key"
    mkdir -p "$d"
    : > "$d/list.txt"
    if [ "$key" = rest-1 ]; then (cd "$ROOT" && timeout 60 node test/run.mjs --list --group alone) >> "$d/list.txt"; fi
    # shellcheck disable=SC2086
    (cd "$ROOT" && timeout 60 node test/run.mjs --list $args) >> "$d/list.txt"
  done
}
run_case() {
  set +e
  (cd "$S/work" && timeout 60 bash -e "$S/coverage.sh") > "$S/out.txt" 2>&1
  code=$?
  set -e
  echo "case $1: exit $code (want $2)"
  sed 's/^/    /' "$S/out.txt" | head -n 12
  [ "$code" = "$2" ] || bad=1
}

bad=0
fresh; run_case real 0
fresh; head -n 1 "$S/work/lists/list-22-rest-2/list.txt" >> "$S/work/lists/list-22-rest-2/list.txt"; run_case duplicate 1
fresh; sed -i '1d' "$S/work/lists/list-18-chain/list.txt"; run_case missing-file 1
fresh; rm -rf "${S:?}"/work/lists/list-24-*; run_case missing-major 1
if [ "$bad" = 0 ]; then echo "coverage-step: all four cases as expected"; else echo "coverage-step: a case did not give its expected exit" >&2; fi
exit "$bad"
