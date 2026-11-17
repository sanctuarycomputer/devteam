#!/usr/bin/env bash
# Checks test-stress.yml's burner cleanup and exit logic: its "# --- burners ---" and "# --- run ---"
# blocks, extracted and run with `node` stubbed by a shell function. Burners become `sleep 300` (no
# load on the box), run.mjs and the summary script return chosen codes. Runs no kit test.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
YML="$ROOT/.github/workflows/test-stress.yml"
T="${TMPDIR:-/tmp}/kit216-exit-$$"
mkdir -m 700 "$T" || exit 1
ALLPIDS="$T/all-pids"
: > "$ALLPIDS"
cleanup() {
  # only pids this script's probes recorded, and only numbers
  local p
  while read -r p; do [[ "$p" =~ ^[0-9]+$ ]] && kill "$p" 2>/dev/null; done < "$ALLPIDS"
  rm -rf "${T:?}"
  return 0
}
trap cleanup EXIT
node "$HERE/extract.mjs" "$YML" between '# --- burners ---' '# --- end burners ---' > "$T/burners.sh" || { echo "FAIL: no burners block"; exit 1; }
node "$HERE/extract.mjs" "$YML" between '# --- run ---' '# --- end run ---' > "$T/run.sh" || { echo "FAIL: no run block"; exit 1; }
cat > "$T/probe.sh" <<'EOF'
set -euo pipefail
node() {
  case "$1" in
    -e) exec sleep 300 ;;
    test/run.mjs) printf '%s\n' "$*" > "$RUNNER_TEMP/args"; printf 'summary: 1 file, concurrency 4\n'; return "$STUB_RC" ;;
    *) while read -r p; do [ -n "$p" ] || continue; if kill -0 "$p" 2>/dev/null; then echo "burner $p alive at summary"; return 99; fi; done < "$RUNNER_TEMP/pids"; return "$SUM_RC" ;;
  esac
}
SEL=(--group chrome,rest)
EOF
{ cat "$T/burners.sh"
  echo 'printf "%s\n" "${BURNERS[@]}" > "$RUNNER_TEMP/pids"'
  echo 'if [ -n "${KILL_ONE:-}" ]; then kill "${BURNERS[0]}"; sleep 0.2; fi'
  echo 'if [ -n "${DIE_EARLY:-}" ]; then exit 7; fi'
  cat "$T/run.sh"; } >> "$T/probe.sh"

fails=0
# case <name> <LOAD> <run.mjs code> <summary code> <want exit> [kill-one] [die-early]
case_() {
  local name=$1 load=$2 stub=$3 sum=$4 want=$5 killone=${6-} die=${7-}
  local rt="$T/rt-$name"
  mkdir "$rt"
  ( ulimit -v 1000000; RUNNER_TEMP=$rt LOAD=$load REPEAT=1 STUB_RC=$stub SUM_RC=$sum KILL_ONE=$killone DIE_EARLY=$die timeout 20 bash "$T/probe.sh" ) > "$rt/out" 2>&1
  local rc=$?
  local ok=1
  [ "$rc" = "$want" ] || { echo "  $name: exit $rc, want $want"; ok=0; }
  if [ -z "$die" ] && [ "$(cat "$rt/args" 2>/dev/null)" != "test/run.mjs --group chrome,rest --repeat 1 --concurrency 4" ]; then echo "  $name: run.mjs args: $(cat "$rt/args" 2>/dev/null)"; ok=0; fi
  local pids=() p n
  if [ -f "$rt/pids" ]; then while read -r p; do [[ "$p" =~ ^[0-9]+$ ]] && pids+=("$p"); done < "$rt/pids"; fi
  printf '%s\n' "${pids[@]}" >> "$ALLPIDS"
  [ "${#pids[@]}" = "$load" ] || { echo "  $name: ${#pids[@]} burners recorded, want $load"; ok=0; }
  for p in "${pids[@]}"; do
    for n in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$p" 2>/dev/null || break; sleep 0.2; done
    if kill -0 "$p" 2>/dev/null; then echo "  $name: burner $p still alive"; ok=0; fi
  done
  if [ "$ok" = 1 ]; then echo "ok   $name"; else echo "FAIL $name"; sed 's/^/    | /' "$rt/out"; fails=$((fails + 1)); fi
}
case_ load0-green 0 0 0 0
case_ load2-green 2 0 0 0
case_ load2-red 2 1 0 1
case_ load2-one-dead 2 0 0 0 1
case_ load0-summary-red 0 0 1 1
case_ load2-runmjs-usage 2 2 1 2
case_ load2-interrupted 2 130 1 130
case_ load2-dies-early 2 0 0 7 '' 1

if [ "$fails" = 0 ]; then echo "check-exit: all ok"; exit 0; fi
echo "check-exit: $fails failed"; exit 1
