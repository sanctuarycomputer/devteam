#!/usr/bin/env bash
# Saves a test-stress run's facts and its stress step's log under this ticket's run-logs/ folder
# (not committed), for verification.md. Usage: fetch-run.sh <run id>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ID=${1:?run id}
[[ "$ID" =~ ^[0-9]+$ ]] || { echo "not a run id: $ID"; exit 2; }
OUT="$HERE/run-logs"
mkdir -p "$OUT"
timeout 60 gh run view "$ID" --repo sanctuarycomputer/devteam --json databaseId,event,headSha,status,conclusion,url,jobs > "$OUT/$ID.json"
timeout 120 gh run view "$ID" --repo sanctuarycomputer/devteam --log > "$OUT/$ID.log"
echo "saved $OUT/$ID.json and $OUT/$ID.log ($(wc -l < "$OUT/$ID.log") lines)"
