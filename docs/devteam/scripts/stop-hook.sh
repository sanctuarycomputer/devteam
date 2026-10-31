#!/usr/bin/env bash
# Refuse to let a worker session end while its run state is stale.
# Wire it as your agent's stop/exit hook. Exit 2 blocks the stop and the message on stderr
# is shown to the agent (Claude Code Stop hook semantics; adapt for other agents).
set -uo pipefail

NODE="${DEVTEAM_NODE:-}"
[[ -n "$NODE" ]] || exit 0   # not a devteam worker
RUN="${DEVTEAM_RUN:-}"
[[ -n "$RUN" ]] || exit 0
STATE="$RUN/nodes/$NODE.json"

if [[ ! -f "$STATE" ]]; then
  echo "devteam: no run state for $NODE. Run: node docs/devteam/scripts/devteam.mjs heartbeat --phase <phase> --note \"...\"" >&2
  exit 2
fi

PHASE="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$STATE','utf8')).phase||'')")"
[[ "$PHASE" == "done" || "$PHASE" == "parked" ]] && exit 0

BEAT="$(node -e "console.log(Math.floor(Date.parse(JSON.parse(require('fs').readFileSync('$STATE','utf8')).heartbeat_at)/1000))")"
LAST_COMMIT="$(git log -1 --format=%ct 2>/dev/null || echo 0)"
if (( LAST_COMMIT > BEAT )); then
  echo "devteam: your last commit is newer than your heartbeat. Before stopping, run: node docs/devteam/scripts/devteam.mjs heartbeat --phase <phase> --task <task> --note \"<where you are>\"" >&2
  exit 2
fi
exit 0
