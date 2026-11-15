#!/bin/sh
# kit-205 T1-1: the re-run rows must fail when forgeCoverage judges only the last entry of a name.
# A scratch copy of docs/ and test/; exit 0 only when the mutated run fails.
set -u
cd "$(dirname "$0")/../../../.." || exit 2
for v in $(env | sed -n 's/^\(DEVTEAM_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
F=docs/devteam/scripts/devteam.mjs
S=$(mktemp -d) || exit 2
H=$(mktemp -d) || exit 2
cp -r docs test "$S/"
sed -i "s/    const bad = mine.find((e) => e.state !== 'SUCCESS');/    const bad = mine.slice(-1).find((e) => e.state !== 'SUCCESS');/" "$S/$F"
if ! grep -qF "mine.slice(-1)" "$S/$F"; then echo "patch did not apply"; rm -rf "${S:?}" "${H:?}"; exit 2; fi
(cd "$S" && HOME=$H DEVTEAM_HUB_PORT=4793 nice timeout 900 node --test --test-concurrency=2 "--test-name-pattern=when coverage fails" test/kit.test.mjs) > "$S/out.log" 2>&1
rc=$?
grep -E "^ *not ok|^# (pass|fail)" "$S/out.log"
grep -m1 "regular expression" "$S/out.log"
rm -rf "${S:?}" "${H:?}"
echo "mutated run exit $rc (expected non-zero)"
[ "$rc" -ne 0 ]
