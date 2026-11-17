#!/bin/sh
# Fill spec-3/plan-3 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-240-relaunch-work-in-progress-first
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d spec-3.md F3-1 "fixed: the header names kit-202, kit-239 and kit-86"
d plan-3.md F3-1 "fixed: hasSetup checks repoReadable(repoOfTicketLink(t)) before repoOfTicket; an unreadable repo counts as having a setup"
d plan-3.md F3-2 "fixed: T4 says the first relaunch has up to 100 s; a later one starts only with the full 100 s when there is a worktree_setup"
