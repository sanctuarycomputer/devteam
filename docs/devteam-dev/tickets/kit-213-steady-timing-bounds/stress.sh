#!/bin/sh
# kit-213 done-when 2: dispatch test-stress.yml on this branch (both files, repeat 3, load 4), find
# the run for the pushed head, wait for it, and print its id, head and conclusion. Exits 0 only on
# a successful conclusion. usage: stress.sh
B=ticket/kit-213-steady-timing-bounds
H=$(git rev-parse HEAD)
[ "$(git rev-parse "origin/$B")" = "$H" ] || { echo "push first: origin/$B is not $H"; exit 2; }
timeout 60 gh workflow run test-stress.yml --ref "$B" -f files="test/bounds.test.mjs test/speed.test.mjs" -f repeat=3 -f load=4 || exit 2
id=
for i in $(seq 1 30); do
  sleep 5
  id=$(timeout 60 gh run list --workflow test-stress.yml --branch "$B" --event workflow_dispatch --json databaseId,headSha --jq "[.[] | select(.headSha == \"$H\")][0].databaseId")
  [ -n "$id" ] && [ "$id" != null ] && break
done
[ -n "$id" ] && [ "$id" != null ] || { echo "no run found for $H"; exit 2; }
echo "run $id at $H"
timeout 3600 gh run watch "$id" --exit-status > /dev/null 2>&1
c=$(timeout 60 gh run view "$id" --json conclusion --jq .conclusion)
echo "run $id conclusion: $c"
[ "$c" = success ]
