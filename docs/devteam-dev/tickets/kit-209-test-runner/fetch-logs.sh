#!/bin/sh
# Downloads every job's log of a test.yml run on the kit's main, for timings-from-ci.mjs (kit-209).
# usage: fetch-logs.sh <out dir> [run id]   (no run id: list the newest green push runs on main)
set -eu
out=$1
mkdir -p "$out"
if [ $# -lt 2 ]; then
  gh run list -R sanctuarycomputer/devteam -w test.yml -b main -e push -s success -L 8 --json databaseId,headSha,createdAt --jq '.[]|[.databaseId,.headSha,.createdAt]|@tsv'
  exit 0
fi
run=$2
gh run view "$run" -R sanctuarycomputer/devteam --json jobs --jq '.jobs[]|[.databaseId,.name]|@tsv' > "$out/jobs.tsv"
while IFS="$(printf '\t')" read -r id name; do
  f="$out/job-$id.log"
  [ -s "$f" ] || gh run view -R sanctuarycomputer/devteam --job "$id" --log > "$f"
  echo "$id $name $(wc -l < "$f") lines"
done < "$out/jobs.tsv"
