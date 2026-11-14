#!/bin/sh
# kit-47's mutation check of verify-pins.mjs (a ticket record): each mutation of cloud/Dockerfile,
# made on a scratch copy, must make verify-pins exit 1 naming its rule.
#   sh docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/mutate-pins.sh
set -u
here=$(dirname "$0")
src=cloud/Dockerfile
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bad=0
try() { # name, expected text in the output, then a node script that rewrites $F in place
  name=$1 want=$2 js=$3
  cp "$src" "$tmp/Dockerfile"
  F="$tmp/Dockerfile" node -e "const fs=require('fs');const f=process.env.F;let s=fs.readFileSync(f,'utf8');const t=s;$js;if(s===t){console.error('mutation did nothing');process.exit(3)}fs.writeFileSync(f,s)" || { echo "FAIL $name: mutation didn't apply"; bad=1; return; }
  out=$(node "$here/verify-pins.mjs" "$tmp/Dockerfile"); rc=$?
  if [ "$rc" = 1 ] && printf '%s\n' "$out" | grep -qF "$want"; then echo "ok   $name: $(printf '%s\n' "$out" | grep -F "$want" | head -1)"
  else echo "FAIL $name (exit $rc): $out"; bad=1; fi
}
try 'aarch64 arm reads the x86_64 sum' "aarch64) arm reads \$GH_SHA256_X86_64" \
  "s=s.replace('aarch64) arch=arm64; sum=\$GH_SHA256_AARCH64','aarch64) arch=arm64; sum=\$GH_SHA256_X86_64')"
try 'stamp above a COPY' 'after ARG DEVTEAM_RELEASE rebuilds' \
  "s=s.replace(/ARG DEVTEAM_RELEASE=v0\\.52\\.0\\n/,'');s=s.replace('COPY docs/devteam /opt/devteam/kit','ARG DEVTEAM_RELEASE=v0.52.0\\nCOPY docs/devteam /opt/devteam/kit')"
try 'a hold line' 'is held, and nothing is held today' \
  "s=s.replace('ARG UV_VERSION=','# hold: testing\\nARG UV_VERSION=')"
try "a comment between gh's ARGs" 'want ARG GH_SHA256_X86_64 here' \
  "s=s.replace('ARG GH_SHA256_X86_64=','# stray\\nARG GH_SHA256_X86_64=')"
try 'a swapped mise arch' "MISE's x86_64) arm sets arch=arm64" \
  "s=s.replace('x86_64) arch=x64;','x86_64) arch=arm64;')"
try 'a version literal in a comment' 'appears 2 times' \
  "s=s.replace('# ttyd, the web terminal','# ttyd 1.7.7, the web terminal')"
try 'a typo in a pin reference' 'is not a declared ARG' \
  "s=s.replace('download/v\$GH_VERSION/','download/v\$GH_VERSOIN/')"
try "gh's sum never checked" "GH's RUN never checks its download" \
  "s=s.replace(' && echo \"\$sum  /tmp/gh.tgz\" | sha256sum -c - \\\\\\n','')"
exit $bad
