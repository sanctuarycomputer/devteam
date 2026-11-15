#!/bin/sh
# kit-213 done-when 4: find test.yml's run for the pushed head, record it through devteam's gate
# (gate ci -- gh run watch <id> --exit-status, output to a file, never piped), then print the run's
# conclusion and every job's. Exits with the gate's status. usage: ci.sh <logfile>
L=${1:?log file}
H=$(git rev-parse HEAD)
id=
for i in $(seq 1 40); do
  id=$(timeout 60 gh run list --workflow test.yml --commit "$H" --json databaseId --jq '.[0].databaseId')
  [ -n "$id" ] && [ "$id" != null ] && break
  sleep 15
done
[ -n "$id" ] && [ "$id" != null ] || { echo "no test.yml run for $H"; exit 2; }
echo "test.yml run $id at $H"
timeout 3600 node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate ci -- gh run watch "$id" --exit-status > "$L" 2>&1
s=$?
echo "gate ci exit: $s"
timeout 60 gh run view "$id" --json conclusion,jobs --jq '"conclusion: \(.conclusion)", (.jobs[] | "  \(.name): \(.conclusion)")'
exit $s
