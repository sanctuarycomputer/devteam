#!/bin/bash
# run one kit test file in Chrome-capable node 22 with a throwaway HOME, every DEVTEAM_* unset, outside tmux
set -o pipefail
H=$(mktemp -d /data/home/tmp/claude-1000/kit614-home.XXXXXX)
cd /data/home/code/devteam-dev/.worktrees/kit-614-scratch
for v in $(env | grep -o '^DEVTEAM_[A-Z_]*'); do unset "$v"; done
env -u TMUX HOME="$H" timeout 900 /usr/local/bin/node --test --test-concurrency=1 ${2:+--test-name-pattern="$2"} "$1" > /data/home/code/devteam-dev/.worktrees/kit-614-scratch/.out.txt 2>&1
echo "exit $?" >> /data/home/code/devteam-dev/.worktrees/kit-614-scratch/.out.txt
rm -rf "${H:?}"
