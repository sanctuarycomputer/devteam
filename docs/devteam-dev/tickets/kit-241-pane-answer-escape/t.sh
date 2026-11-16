#!/bin/sh
# usage: t.sh <test file>...  runs each file alone at concurrency 2 with a throwaway HOME (the box's
# /etc/devteam and /opt/devteam files otherwise make every fixture a box; boxFilesOff needs HOME changed)
set -e
cd /data/home/code/devteam-dev/.worktrees/kit-241-pane-answer-escape
H=$(mktemp -d)
cp ~/.gitconfig "$H/" 2>/dev/null || true
for f in "$@"; do
  HOME="$H" timeout 900 node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test --junit reports/junit.xml -- node --test --test-concurrency=2 --test-reporter=spec ${PAT:+--test-name-pattern="$PAT"} "$f"
done
rm -rf "${H:?}"
