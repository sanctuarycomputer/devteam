#!/usr/bin/env bash
# Spawn a worker for one ticket: git worktree on ticket/<id>, a tmux window named <id>,
# the DEVTEAM_* environment, and the agent CLI from the binding.
#
#   spawn-ticket.sh <ticket-id> [--resume]     worker for a ticket (resume uses the binding's resume_command)
#   spawn-ticket.sh --planner <feature>       planner on branch plan/<feature>
#
# Run from the main checkout. Requires git, tmux, node.
set -euo pipefail

die() { echo "spawn-ticket: $*" >&2; exit 1; }

ROLE=worker
RESUME=0
if [[ "${1:-}" == "--planner" ]]; then
  ROLE=planner; FEATURE="${2:-}"; [[ -n "$FEATURE" ]] || die "usage: spawn-ticket.sh --planner <feature>"
  NAME="plan-$FEATURE"; BRANCH="plan/$FEATURE"
else
  TICKET="${1:-}"; [[ -n "$TICKET" ]] || die "usage: spawn-ticket.sh <ticket-id> [--resume]"
  [[ "${2:-}" == "--resume" ]] && RESUME=1
  NAME="$TICKET"; BRANCH="ticket/$TICKET"
fi

command -v tmux >/dev/null || die "tmux not found"
ROOT="$(git rev-parse --show-toplevel)"
COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
MAIN_ROOT="$(dirname "$COMMON")"
[[ "$ROOT" == "$MAIN_ROOT" ]] || die "run from the main checkout ($MAIN_ROOT), not a worktree"
cd "$MAIN_ROOT"

DT="node docs/devteam/scripts/devteam.mjs"
[[ "$ROLE" == planner ]] || [[ -f "docs/devteam/project/graph/$TICKET.json" ]] || die "no ticket $TICKET"

SESSION="$($DT binding --get tmux_session)"
MAIN="$($DT binding --get main_branch)"
if [[ $RESUME == 1 ]]; then AGENT="$($DT binding --get resume_command)"; else AGENT="$($DT binding --get agent_command)"; fi
[[ -n "$AGENT" ]] || die "binding has no agent_command"

RUN="$MAIN_ROOT/docs/devteam/run"
WT="$MAIN_ROOT/.worktrees/$NAME"
mkdir -p "$RUN/prompts" "$MAIN_ROOT/.worktrees"

# Worktree: reuse if present (resume), else branch from the latest main.
if [[ ! -d "$WT" ]]; then
  git fetch --quiet origin "$MAIN" 2>/dev/null || true
  BASE="origin/$MAIN"; git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="$MAIN"
  if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
    git worktree add --quiet "$WT" "$BRANCH"
  else
    git worktree add --quiet -b "$BRANCH" "$WT" "$BASE"
  fi
fi

# Prompt from the template, written to a file so no shell quoting can mangle it.
PROMPT_FILE="$RUN/prompts/$NAME.txt"
if [[ "$ROLE" == planner ]]; then
  sed "s/{{FEATURE}}/$FEATURE/g" docs/devteam/templates/planner-prompt.md > "$PROMPT_FILE"
else
  sed "s/{{TICKET}}/$TICKET/g" docs/devteam/templates/worker-prompt.md > "$PROMPT_FILE"
fi

# tmux: session (supervisor is window 0 by convention), one window per ticket.
tmux has-session -t "$SESSION" 2>/dev/null || tmux new-session -d -s "$SESSION" -n supervisor -c "$MAIN_ROOT"
if tmux list-windows -t "$SESSION" -F '#W' | grep -qx "$NAME"; then
  [[ $RESUME == 1 ]] || die "window $SESSION:$NAME already exists (use --resume to relaunch in it)"
else
  tmux new-window -d -t "$SESSION" -n "$NAME" -c "$WT"
fi
TARGET="$SESSION:$NAME"

ENVLINE="export DEVTEAM_RUN='$RUN' DEVTEAM_SUPERVISOR='$SESSION:0' DEVTEAM_ROLE='$ROLE'"
[[ "$ROLE" == worker ]] && ENVLINE="$ENVLINE DEVTEAM_TICKET='$TICKET'"
tmux send-keys -t "$TARGET" -l "$ENVLINE"; tmux send-keys -t "$TARGET" Enter
tmux send-keys -t "$TARGET" -l "$AGENT \"\$(cat '$PROMPT_FILE')\""; tmux send-keys -t "$TARGET" Enter

if [[ "$ROLE" == worker ]]; then
  # A fresh spawn records phase "spawned". A resume keeps the worker's last recorded phase,
  # which the relaunched worker reads to re-orient (worker.md §2).
  if [[ $RESUME == 0 ]]; then
    ( cd "$WT" && DEVTEAM_RUN="$RUN" DEVTEAM_TICKET="$TICKET" $DT heartbeat --phase spawned --note "spawned in $TARGET" >/dev/null )
  fi
  ( cd "$WT" && DEVTEAM_RUN="$RUN" $DT event --type ticket.spawned --actor supervisor --ticket "$TICKET" --summary "worker in $TARGET, worktree .worktrees/$NAME$([[ $RESUME == 1 ]] && echo ' (resumed)')" >/dev/null )
fi
echo "spawned $ROLE $NAME in $TARGET at $WT"
