#!/bin/bash
# kit-245 done-when 3: break the relay two ways, run the two preview tests, restore cloud/gateway.mjs.
# Run from the repo root: sh docs/devteam-dev/tickets/kit-245-steady-preview-relay-tests/evidence/mutate.sh
set -u
G=cloud/gateway.mjs
orig=$(git hash-object "$G")
run() { timeout 120 node --test --test-concurrency=2 --test-name-pattern="^a preview(:|'s WebSocket)" test/gateway.test.mjs 2>&1 | grep -E "^(not )?ok [0-9]+ - a preview|^# (pass|fail) |^  error:|^    [a-z].*(dev port|first socket|frame)|no frame" | cut -c1-400; }
echo "== mutation a: the relay tries ::1 only (never reaches a dev server on 127.0.0.1)"
sed -i "s/next(\['127.0.0.1', '::1'\]);/next(['::1']);/; s/attempt(\['127.0.0.1', '::1'\]);/attempt(['::1']);/" "$G"
git diff --stat -- "$G"
run
git checkout -- "$G"
echo "== mutation b: the dev server's frames are not relayed back to the client after the handshake"
sed -i "s/^        pipeline(up, socket, () => {});$/        \/\/ mutated/" "$G"
git diff --stat -- "$G"
run
git checkout -- "$G"
[ "$(git hash-object "$G")" = "$orig" ] && echo "== restored $G" || echo "== NOT RESTORED $G"
