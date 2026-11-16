#!/usr/bin/env bash
# kit-212: fetch one job's log of a test.yml run.
#   bash joblog.sh <run-id> "<job name>" <out-file>
set -euo pipefail
run="$1"; name="$2"; out="$3"
job=$(gh run view "$run" --repo sanctuarycomputer/devteam --json jobs --jq ".jobs[] | select(.name==\"$name\") | .databaseId")
echo "job $job"
gh api --allow-escape-sequences "repos/sanctuarycomputer/devteam/actions/jobs/$job/logs" > "$out"
wc -l "$out"
