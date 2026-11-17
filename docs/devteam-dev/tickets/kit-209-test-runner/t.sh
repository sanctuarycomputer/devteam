#!/bin/sh
# Runs one test file the box way (ruling m-20261115-070004373-supervisor): DEVTEAM_* unset,
# --test-concurrency=2. usage: t.sh <node major: 18|20|22|24> <file> [out file]
v=$1; f=$2; out=${3:-/dev/stdout}
n=$(ls -d "$HOME"/.local/share/mise/installs/node/"$v".* 2>/dev/null | sort -V | tail -1)/bin/node
exec env -u DEVTEAM_RUN -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_HOME -u DEVTEAM_SUPERVISOR -u DEVTEAM_FEATURE "$n" --test --test-reporter=tap --test-concurrency=2 "$f" > "$out" 2>&1
