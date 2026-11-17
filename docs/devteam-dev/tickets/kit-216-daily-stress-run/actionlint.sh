#!/usr/bin/env bash
# Runs actionlint (v1.7.7) with shellcheck (v0.10.0), both pinned and sha256-checked, on
# .github/workflows/test-stress.yml. Exits with actionlint's status.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
AL_V=1.7.7
AL_SHA=023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757 # actionlint_1.7.7_checksums.txt
SC_V=0.10.0
SC_SHA=6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87 # computed from the release asset; the release publishes none
T="${TMPDIR:-/tmp}/kit216-lint-$$"
mkdir -m 700 "$T"
trap 'rm -rf "${T:?}"' EXIT
curl -fsSL --retry 3 --max-time 120 -o "$T/al.tgz" "https://github.com/rhysd/actionlint/releases/download/v${AL_V}/actionlint_${AL_V}_linux_amd64.tar.gz"
curl -fsSL --retry 3 --max-time 120 -o "$T/sc.txz" "https://github.com/koalaman/shellcheck/releases/download/v${SC_V}/shellcheck-v${SC_V}.linux.x86_64.tar.xz"
echo "${AL_SHA}  $T/al.tgz" | sha256sum -c -
echo "${SC_SHA}  $T/sc.txz" | sha256sum -c -
tar -xzf "$T/al.tgz" -C "$T" actionlint
tar -xJf "$T/sc.txz" -C "$T" "shellcheck-v${SC_V}/shellcheck"
"$T/actionlint" -version
"$T/shellcheck-v${SC_V}/shellcheck" --version | sed -n 2p
cd "$ROOT"
set +e
( ulimit -v 4000000; timeout 120 "$T/actionlint" -shellcheck "$T/shellcheck-v${SC_V}/shellcheck" .github/workflows/test-stress.yml )
rc=$?
echo "actionlint exit: $rc"
exit "$rc"
