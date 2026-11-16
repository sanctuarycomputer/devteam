#!/bin/sh
# kit-205: wait (up to 90 min) for test.yml at a head sha to finish, then print its conclusion.
# usage: ci-wait.sh <sha>   exit 0 only when the run's conclusion is success.
set -u
sha=${1:?sha}
i=0
while [ $i -lt 180 ]; do
  line=$(timeout 60 gh run list --workflow test.yml --commit "$sha" --json databaseId,status,conclusion --jq '.[0] | "\(.databaseId) \(.status) \(.conclusion)"' 2>/dev/null)
  case "$line" in
    *" completed "*) echo "test.yml at $sha: $line"; [ "${line##* }" = success ]; exit $? ;;
  esac
  i=$((i+1))
  sleep 30
done
echo "test.yml at $sha: not finished after 90 min ($line)"
exit 3
