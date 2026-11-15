#!/bin/sh
# kit-209 verification checks that aren't test files: lib/kit.mjs unchanged, the search run's
# header, --list's defaults, shard coverage over the real file list, and test/timings.json against
# the merge base.
set -u
cd "$(dirname "$0")/../../../.."
MB=$(git merge-base HEAD origin/main)
echo "head $(git rev-parse HEAD), merge base $MB"
git diff --quiet "$MB" -- test/lib/kit.mjs && echo "lib/kit.mjs unchanged since the merge base: yes" || echo "lib/kit.mjs CHANGED"
echo "--list defaults:"; node test/run.mjs --list test/kit.test.mjs test/dashboard.test.mjs test/bounds.test.mjs test/search.test.mjs test/hub-overview.test.mjs
all=$(ls test/*.test.mjs | sort)
for n in 1 2 3 4; do
  got=$(for i in $(seq 1 "$n"); do node test/run.mjs --list --shard "$i/$n" | awk '{print $1}'; done | sort)
  [ "$got" = "$all" ] && echo "--shard i/$n: every file once ($(echo "$got" | wc -l) files)" || echo "--shard i/$n: MISMATCH"
done
node test/run.mjs --list --shard 3/2 > /dev/null 2>&1; echo "--shard 3/2 exit $?"
want=$(git ls-tree --name-only "$MB" test/ | grep -E '^test/[^/]+\.test\.mjs$' | sort)
have=$(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('test/timings.json','utf8')).files).sort().join('\n'))")
[ "$want" = "$have" ] && echo "timings.json lists every test/*.test.mjs at the merge base: yes ($(echo "$have" | wc -l))" || echo "timings.json MISMATCH"
node -e "const t=JSON.parse(require('fs').readFileSync('test/timings.json','utf8')); console.log('timings.json run', t.run, Number(t.run) >= 43670286370 ? '(>= 43670286370)' : '(TOO OLD)')"
