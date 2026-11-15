#!/usr/bin/env bash
# Checks test-stress.yml's input checks (the "# --- inputs ---" block, extracted and run with
# FILES, REPEAT and LOAD set) and that no run: block holds a ${{ expression. Runs no kit test.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
YML="$ROOT/.github/workflows/test-stress.yml"
T="${TMPDIR:-/tmp}/kit216-in-$$"
mkdir -m 700 "$T" || exit 1
trap 'rm -rf "${T:?}"' EXIT
node "$HERE/extract.mjs" "$YML" between '# --- inputs ---' '# --- end inputs ---' > "$T/inputs.sh" || { echo "FAIL: no inputs block"; exit 1; }
# the block, then the args it built, one per line in <>
{ echo 'set -euo pipefail'; cat "$T/inputs.sh"; echo 'printf "<%s>\n" "${SEL[@]}"'; } > "$T/probe.sh"

fails=0
# case <name> <FILES> <REPEAT> <LOAD> <want exit> [<expected output, lines joined by spaces>]
case_() {
  local name=$1 files=$2 rep=$3 load=$4 want=$5 expect=${6-}
  local out rc
  out=$( ( ulimit -v 1000000; FILES=$files REPEAT=$rep LOAD=$load timeout 10 bash "$T/probe.sh" ) 2>/dev/null )
  rc=$?
  local got
  got=$(printf '%s' "$out" | tr '\n' ' ' | sed 's/ $//')
  if [ "$rc" != "$want" ]; then echo "FAIL $name: exit $rc, want $want (out: $got)"; fails=$((fails + 1)); return; fi
  if [ "$want" = 0 ] && [ "$got" != "$expect" ]; then echo "FAIL $name: got '$got', want '$expect'"; fails=$((fails + 1)); return; fi
  echo "ok   $name"
}
NL=$'\n'
case_ empty '' 3 0 0 '<--group> <chrome,rest>'
case_ spaces-only '   ' 3 0 0 '<--group> <chrome,rest>'
case_ two-files 'test/a.test.mjs test/b.test.mjs' 2 2 0 '<test/a.test.mjs> <test/b.test.mjs>'
case_ extra-spaces '  test/a.test.mjs   test/b.test.mjs ' 1 8 0 '<test/a.test.mjs> <test/b.test.mjs>'
case_ option '--timings /x' 3 0 2
case_ option-after-file 'test/a.test.mjs --repeat' 3 0 2
case_ subst '$(id)' 3 0 2
case_ backtick '`id`' 3 0 2
case_ glob '*' 3 0 2
case_ semicolon 'a;id' 3 0 2
case_ newline "test/a.test.mjs${NL}--timings" 3 0 2
case_ tab "test/a.test.mjs"$'\t'"test/b.test.mjs" 3 0 2
case_ repeat-0 '' 0 0 2
case_ repeat-6 '' 6 0 2
case_ repeat-x '' x 0 2
case_ repeat-05 '' 05 0 2
case_ repeat-empty '' '' 0 2
case_ load-9 '' 3 9 2
case_ load-08 '' 3 08 2
case_ load-neg '' 3 -1 2
case_ load-empty '' 3 '' 2

# no ${{ in any run: block (the summary script's heredoc included): inputs reach the shell through env only
node "$HERE/extract.mjs" "$YML" run-blocks > "$T/runs.txt" || { echo "FAIL: run-blocks"; exit 1; }
if grep -n '\${{' "$T/runs.txt"; then echo 'FAIL no-expr-in-run: ${{ inside a run: block (above)'; fails=$((fails + 1)); else echo 'ok   no-expr-in-run'; fi
# the summary script is inside a run: block, so the scan covered it
if grep -q 'GITHUB_STEP_SUMMARY' "$T/runs.txt"; then echo 'ok   scan-covers-summary'; else echo 'FAIL scan-covers-summary'; fails=$((fails + 1)); fi

if [ "$fails" = 0 ]; then echo "check-inputs: all ok"; exit 0; fi
echo "check-inputs: $fails failed"; exit 1
