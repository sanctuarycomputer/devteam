#!/usr/bin/env bash
# Checks test-stress.yml's summary script (extracted from its heredoc) against crafted run.mjs logs.
# Runs no kit test. Each case runs under timeout with a memory cap (lesson k-20261115-174344487).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
YML="$ROOT/.github/workflows/test-stress.yml"
T="${TMPDIR:-/tmp}/kit216-sum-$$"
mkdir -m 700 "$T" || exit 1
trap 'rm -rf "${T:?}"' EXIT
node "$HERE/fixtures/make.mjs" || exit 1
node "$HERE/extract.mjs" "$YML" between "cat > \"\$RUNNER_TEMP/summary.mjs\" <<'EOF'" EOF > "$T/summary.mjs" || { echo "FAIL: no summary script in $YML"; exit 1; }

fails=0
num=0
# case <log> <repeat> <expected exit> <grep -E pattern that must match>... ; a pattern starting with ! must not match
case_() {
  local log=$1 rep=$2 want=$3; shift 3
  num=$((num + 1)); local out="$T/out-$num-$log.md" step="$T/step-$num-$log.md"
  ( ulimit -v 4000000; GITHUB_STEP_SUMMARY="$step" STRESS_TITLE="t" timeout 20 node "$T/summary.mjs" "$HERE/fixtures/$log" "$rep" ) > "$out" 2>&1
  local rc=$?
  local ok=1
  [ "$rc" = "$want" ] || { echo "  $log: exit $rc, want $want"; ok=0; }
  cmp -s "$out" "$step" || { echo "  $log: step summary differs from stdout"; ok=0; }
  local p
  for p in "$@"; do
    if [ "${p:0:1}" = '!' ]; then grep -qE -- "${p:1}" "$out" && { echo "  $log: unexpected /${p:1}/"; ok=0; }
    else grep -qE -- "$p" "$out" || { echo "  $log: missing /$p/"; ok=0; }; fi
  done
  if [ "$ok" = 1 ]; then echo "ok   $log"; else echo "FAIL $log"; sed 's/^/    | /' "$out"; fails=$((fails + 1)); fi
}

case_ green-r2.log 2 0 '^\| File \| Run 1 \| Run 2 \|$' '^\| `test/b.test.mjs` \| ok 260.0 s \(near timeout\) \| ok 40.2 s \|$' '^\| `test/a.test.mjs` \| ok 12.3 s \| ok 11.9 s \|$' '!Failed'
case_ red-r3.log 3 1 'Failed' '`test/a.test.mjs` run 2: failed \(exit 1\)' '`test/b.test.mjs` run 3: timed out, near timeout' '^timed out: test/b.test.mjs after 300 s' '\*\*timed out, near timeout\*\* 300.1 s' '!`failed:'
case_ red-near.log 1 1 'run 1: failed \(exit 1\), near timeout' '\*\*failed \(exit 1\), near timeout\*\*'
case_ r1.log 1 0 '^\| File \| Run 1 \|$' '^\| `test/search.test.mjs` \| ok 3.4 s \|$'
case_ nosummary.log 3 1 '[Nn]o summary'
case_ signal.log 1 1 'failed \(signal SIGKILL\)'
case_ twosummary.log 1 0 '^\| `test/a.test.mjs` \| ok 1.0 s \|$' '!fake'
# a run shorter than asked (an interrupted repeat) is not green
case_ green-r2.log 3 1 'not run'

if [ "$fails" = 0 ]; then echo "check-summary: all ok"; exit 0; fi
echo "check-summary: $fails failed"; exit 1
