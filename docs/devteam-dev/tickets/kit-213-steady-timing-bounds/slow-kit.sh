#!/bin/sh
# kit-213: a scratch copy of this worktree's tests and kit with one temporary patch applied, to show
# a bound fails when its code does 10x the work (or, for "hooks", that cleanup leaves no process).
# Never committed: the copy lives in a private mktemp folder, and its path is the last line printed.
# usage: slow-kit.sh <b1-time|b1-count|b2|b2b|b3|b4|b5|hooks-last|hooks-first>
set -e
patch=${1:?patch name}
W=$(git rev-parse --show-toplevel)
C=$(mktemp -d "${TMPDIR:-/tmp}/kit213-slow-XXXXXX")
mkdir -p "$C/docs/devteam"
cp -r "$W/test" "$C/test"
for d in "$W"/docs/devteam/*; do b=$(basename "$d"); case "$b" in project|run) ;; *) cp -r "$d" "$C/docs/devteam/$b" ;; esac; done
python3 - "$C" "$patch" <<'EOF'
import sys
root, name = sys.argv[1], sys.argv[2]
K = 'docs/devteam/scripts/devteam.mjs'
T = 'test/speed.test.mjs'
P = {
  'b1-time': [(K, "    const owners = ownersIn(p, L, count);\n", "    for (let k = 0; k < 9; k++) ownersIn(p, L, null);\n    const owners = ownersIn(p, L, count);\n")],
  'b1-count': [(K, "  const hit = globCache.get(g);\n", "  const hit = null;\n"), (K, "  let m = matcherCache.get(entry);\n", "  let m;\n")],
  'b2': [(K, "      if (who === undefined) who = ownerOf(p);\n", "      if (who === undefined) { for (let k = 0; k < 9; k++) ownerOf(p); who = ownerOf(p); }\n")],
  'b2b': [(K, "  return (dir) => {\n    for (let d = dir;", "  return (dir) => {\n    for (let k = 0; k < 9; k++) for (let d = dir; d && d !== './'; d = d.slice(0, d.slice(0, -1).lastIndexOf('/') + 1)) if (first.has(d)) break;\n    for (let d = dir;")],
  'b3': [(K, "function cmdQuestions() {\n  let qs = questions();\n", "function cmdQuestions() {\n  for (let k = 0; k < 9; k++) rankQuestions(questionsNow());\n  let qs = questions();\n")],
  'b4': [(K, "  const hits = searchRank(searchIndex(docs), q, { limit });\n", "  for (let k = 0; k < 9; k++) searchRank(searchIndex(docs), q, { limit });\n  const hits = searchRank(searchIndex(docs), q, { limit });\n")],
  'b5': [(K, "  if (REPLY_FD !== null) return void queuedNudges.push(line);\n", "")],
  'hooks-last': [(T, "() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));", "() => { console.log(PIDS()); throw new Error('the removal throws (kit-213 hooks check)'); }));")],
  'hooks-first': [(T, "t.after(() => cleanup(() => fs.writeFileSync(release, ''),", "t.after(() => cleanup(() => { console.log(PIDS()); throw new Error('the first step throws (kit-213 hooks check)'); },")],
}
PIDS = "  const PIDS = () => `PIDS ${JSON.stringify({ dashboard: dash?.p.pid ?? null, base, sendKeys: fs.existsSync(typing) ? fs.readFileSync(typing, 'utf8').split('\\n').filter(Boolean).map(Number) : [] })}`;\n"
for f, a, b in P[name]:
    p = f"{root}/{f}"
    s = open(p).read()
    assert s.count(a) == 1, f'{name}: the text to patch occurs {s.count(a)} times in {f}'
    s = s.replace(a, b)
    if name.startswith('hooks'):
        anchor = "  const typing = path.join(base, 'send-keys.pids');\n"
        assert s.count(anchor) == 1
        s = s.replace(anchor, anchor + PIDS)
    open(p, 'w').write(s)
    print(f'patched {name} in {f}')
EOF
echo "$C"
