#!/usr/bin/env bash
# Mutation check for the local check scripts: each mutant of test-stress.yml, in a scratch copy of
# the repo layout, must make the named check fail. Runs no kit test, and no load.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
S="${TMPDIR:-/tmp}/kit216-mut-$$"
mkdir -m 700 "$S" || exit 1
trap 'rm -rf "${S:?}"' EXIT
fails=0
# mutant <name> <check script> <sed expression>
mutant() {
  local name=$1 check=$2 expr=$3 m="$S/$1"
  mkdir -p "$m/.github/workflows" "$m/docs/devteam-dev/tickets"
  cp -r "$HERE" "$m/docs/devteam-dev/tickets/"
  sed -e "$expr" "$ROOT/.github/workflows/test-stress.yml" > "$m/.github/workflows/test-stress.yml"
  if cmp -s "$ROOT/.github/workflows/test-stress.yml" "$m/.github/workflows/test-stress.yml"; then echo "FAIL $name: the mutation changed nothing"; fails=$((fails + 1)); return; fi
  if bash "$m/docs/devteam-dev/tickets/$(basename "$HERE")/$check" > "$m/out" 2>&1; then echo "FAIL $name: $check still passes"; fails=$((fails + 1)); else echo "ok   $name: $check fails"; fi
}
mutant no-trap check-exit.sh '/trap stop_burners EXIT/d'
mutant no-explicit-stop check-exit.sh '/^          stop_burners$/d'
mutant kill-not-guarded check-exit.sh 's/kill "\$p" 2>\/dev\/null || true;/kill "$p";/'
mutant concurrency-2 check-exit.sh 's/--repeat "\$REPEAT" --concurrency 4 2>&1/--repeat "$REPEAT" --concurrency 2 2>\&1/'
# (rc=$? in place of PIPESTATUS[0] is an equivalent mutant under pipefail, so it is not listed)
mutant no-keep-rc check-exit.sh '/if \[ "\$rc" -ne 0 \]; then exit "\$rc"; fi/d'
mutant near-timeout-ok check-summary.sh "s/const isOk = (result) => result.replace(NEAR, '') === 'ok';/const isOk = (result) => \/^ok\/.test(result) || NEAR.test(result);/"
mutant first-header check-summary.sh 's/if (HEADER.test(l)) at = i;/if (HEADER.test(l) \&\& at < 0) at = i;/'
mutant no-dash-check check-inputs.sh 's/ || "\$w" == -\* ]]/ ]]/'
mutant expr-in-run check-inputs.sh 's/read -ra WORDS <<< "\$FILES"/read -ra WORDS <<< "${{ inputs.files }}"/'
if [ "$fails" = 0 ]; then echo "mutate: all caught"; exit 0; fi
echo "mutate: $fails not caught"; exit 1
