#!/bin/sh
# kit-205 T2: show the owner-rule tests fail when the kit lets the supervisor add covered_by.
# A scratch copy of docs/ and test/; GATE_ADD_FIELDS gains covered_by; the second T2 test must fail.
set -u
cd "$(dirname "$0")/../../../.." || exit 2
S=$(mktemp -d) || exit 2
cp -r docs test "$S/"
sed -i "s/^const GATE_ADD_FIELDS = \['cmd', 'paths', 'junit', 'mode'\];/const GATE_ADD_FIELDS = ['cmd', 'paths', 'junit', 'mode', 'covered_by'];/" "$S/docs/devteam/scripts/devteam.mjs"
grep -q "'mode', 'covered_by'" "$S/docs/devteam/scripts/devteam.mjs" || { echo "patch did not apply"; rm -rf "${S:?}"; exit 2; }
H=$(mktemp -d) || exit 2
for v in $(env | sed -n 's/^\(DEVTEAM_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
(cd "$S" && HOME=$H DEVTEAM_HUB_PORT=4792 nice timeout 600 node --test --test-concurrency=2 "--test-name-pattern=not the supervisor" test/kit.test.mjs) > "$S/out.log" 2>&1
rc=$?
grep -E "^(not )?ok|^# (pass|fail)" "$S/out.log"
rm -rf "${S:?}" "${H:?}"
echo "mutated run exit $rc (expected non-zero)"
[ "$rc" -ne 0 ]
