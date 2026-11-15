#!/bin/sh
# kit-213: done-when 5's check. Runs the dashboard reply test in a copy patched by slow-kit.sh
# (hooks-last or hooks-first), which prints "PIDS {dashboard, base, sendKeys}" from inside its cleanup
# and then throws. The test must fail; then no printed pid may be alive, no process may have the
# dashboard's pid as its process group, and no process (its watcher) may name it as its last argument.
# With "first", the test's folder must also be gone (the removal ran after the throw).
# Exits 0 only when all of that holds. usage: check-hooks.sh <copy> <last|first>
C=${1:?copy}
which=${2:?last or first}
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp "${TMPDIR:-/tmp}/kit213-hooks-XXXXXX")
sh "$here/run-file.sh" test/speed.test.mjs "$C" --test-name-pattern='an answer from the dashboard' > "$out" 2>&1
status=$?
echo "test exit: $status"
fail=0
[ "$status" -ne 0 ] || { echo "FAIL: the test passed, but its cleanup was patched to throw"; fail=1; }
grep -q "kit-213 hooks check" "$out" || { echo "FAIL: the patched step's error is not in the output"; fail=1; }
line=$(grep -o 'PIDS {.*}' "$out" | head -1)
[ -n "$line" ] || { echo "FAIL: no PIDS line"; rm -f "$out"; exit 1; }
echo "$line"
json=${line#PIDS }
dash=$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).dashboard??""))')
base=$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).base))')
keys=$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sendKeys.join(" ")))')
[ -n "$dash" ] || { echo "FAIL: no dashboard pid"; fail=1; }
echo "send-keys pids: ${keys:-none}"
for p in $dash $keys; do
  if ps -p "$p" > /dev/null 2>&1; then echo "FAIL: pid $p is alive"; ps -o pid,pgid,args -p "$p"; fail=1; else echo "pid $p: gone"; fi
done
if [ -n "$dash" ]; then
  left=$(ps -eo pid=,pgid=,args= | awk -v g="$dash" '$2 == g || $NF == g')
  if [ -n "$left" ]; then echo "FAIL: left in the dashboard's group or naming it:"; echo "$left"; fail=1; else echo "group $dash and its watcher: none left"; fi
fi
if [ "$which" = first ]; then
  if [ -e "$base" ]; then echo "FAIL: $base still exists"; fail=1; else echo "folder $base: removed"; fi
fi
# hooks-last leaves the folder (its removal was the step made to throw): removed here, guarded
case "$base" in "${TMPDIR:-/tmp}"/devteam-reply-*|/tmp/devteam-reply-*) rm -rf "${base:?}" ;; esac
rm -f "$out"
echo "check-hooks $which: $([ $fail = 0 ] && echo ok || echo FAILED)"
exit $fail
