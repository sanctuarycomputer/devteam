#!/bin/sh
# kit-205 task 1: the coverage tests must fail under each mutation, each in its own scratch copy.
#   last:  forgeCoverage judges only the last entry of a name (T1-1)
#   no-pr: the "no PR to read" guard removed (final-1b F2)
# Exit 0 only when every mutated run fails.
set -u
cd "$(dirname "$0")/../../../.." || exit 2
for v in $(env | sed -n 's/^\(DEVTEAM_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
F=docs/devteam/scripts/devteam.mjs
one() { # <name> <sed expression> <grep proof that the patch applied>
  S=$(mktemp -d) || exit 2
  H=$(mktemp -d) || exit 2
  cp -r docs test "$S/"
  sed -i "$2" "$S/$F"
  if ! grep -qF "$3" "$S/$F"; then echo "$1: patch did not apply"; rm -rf "${S:?}" "${H:?}"; exit 2; fi
  (cd "$S" && HOME=$H DEVTEAM_HUB_PORT=4793 nice timeout 900 node --test --test-concurrency=2 "--test-name-pattern=when coverage fails" test/kit.test.mjs) > "$S/out.log" 2>&1
  rc=$?
  grep -E "^ *not ok|^# (pass|fail)" "$S/out.log"
  rm -rf "${S:?}" "${H:?}"
  echo "$1: mutated run exit $rc (expected non-zero)"
  [ "$rc" -ne 0 ] || exit 1
}
one last "s/    const bad = mine.find((e) => e.state !== 'SUCCESS');/    const bad = mine.slice(-1).find((e) => e.state !== 'SUCCESS');/" "mine.slice(-1)"
one no-pr "s/      else if (!pr.number) fresh = { why: 'no PR to read' };/      else if (false) fresh = { why: 'no PR to read (mutated)' };/" "no PR to read (mutated)"
echo "every mutation caught"
