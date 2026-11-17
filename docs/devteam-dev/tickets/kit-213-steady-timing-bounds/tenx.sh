#!/bin/sh
# kit-213 done-when 3: for each patch, a scratch copy (slow-kit.sh), the affected test run in it
# (run-file.sh), the exit code and the lines that name the failure; then the copy removed.
# Output goes to tenx-<patch>.log in the scratch dir given as $1. usage: tenx.sh <logdir> <patch>...
here=$(cd "$(dirname "$0")" && pwd)
L=${1:?log dir}; shift
for p in "$@"; do
  case "$p" in
    b1-time|b1-count|b2|b2b) f=test/bounds.test.mjs; n='coverage' ;;
    b3) f=test/bounds.test.mjs; n='the Inbox order' ;;
    b4) f=test/bounds.test.mjs; n='search' ;;
    b5) f=test/speed.test.mjs; n='an answer from the dashboard' ;;
    *) echo "unknown patch $p"; exit 2 ;;
  esac
  C=$(sh "$here/slow-kit.sh" "$p" | tail -1)
  [ -d "$C/test" ] || { echo "$p: no copy"; exit 2; }
  sh "$here/run-file.sh" "$f" "$C" --test-name-pattern="$n" > "$L/tenx-$p.log" 2>&1
  s=$?
  echo "== $p: exit $s"
  grep -E "^# (coverage|suggestion|questions|search)|^not ok|^  error: |each glob compiled|no path asked|owner asks|bound [0-9.]+x|replied with send-keys" "$L/tenx-$p.log" | head -8
  case "$C" in "${TMPDIR:-/tmp}"/kit213-slow-*) rm -rf "${C:?}" ;; esac
done
