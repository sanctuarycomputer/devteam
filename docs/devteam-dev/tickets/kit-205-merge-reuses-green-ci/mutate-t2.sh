#!/bin/sh
# kit-205 T2: show each owner-rule test fails when the kit lets the supervisor set covered_by.
#   add:  GATE_ADD_FIELDS gains covered_by       -> "covered_by on a new gate…" must fail
#   edit: gateAdditions' edit check ignores covered_by -> "covered_by on an existing gate…" must fail
# Each runs in its own scratch copy of docs/ and test/. Exit 0 only when both mutated runs fail.
set -u
cd "$(dirname "$0")/../../../.." || exit 2
for v in $(env | sed -n 's/^\(DEVTEAM_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
F=docs/devteam/scripts/devteam.mjs
one() { # <name> <sed expression> <grep proof> <test name pattern>
  S=$(mktemp -d) || exit 2
  H=$(mktemp -d) || exit 2
  cp -r docs test "$S/"
  sed -i "$2" "$S/$F"
  if ! grep -qF "$3" "$S/$F"; then echo "$1: patch did not apply"; rm -rf "${S:?}" "${H:?}"; exit 2; fi
  (cd "$S" && HOME=$H DEVTEAM_HUB_PORT=4792 nice timeout 600 node --test --test-concurrency=2 "--test-name-pattern=$4" test/kit.test.mjs) > "$S/out.log" 2>&1
  rc=$?
  grep -E "^not ok|^# (pass|fail)" "$S/out.log"
  rm -rf "${S:?}" "${H:?}"
  echo "$1: mutated run exit $rc (expected non-zero)"
  [ "$rc" -ne 0 ] || exit 1
}
one add "s/^const GATE_ADD_FIELDS = \['cmd', 'paths', 'junit', 'mode'\];/const GATE_ADD_FIELDS = ['cmd', 'paths', 'junit', 'mode', 'covered_by'];/" "'mode', 'covered_by'" "not the supervisor"
one edit "s/const edited = was.filter((k) => JSON.stringify(before\[k\]) !== JSON.stringify(b.gates\[k\]));/const noCov = (x) => (isObj(x) ? { ...x, covered_by: undefined } : x); const edited = was.filter((k) => JSON.stringify(noCov(before[k])) !== JSON.stringify(noCov(b.gates[k])));/" "const noCov" "existing gate is the owner"
echo "both mutations caught"
