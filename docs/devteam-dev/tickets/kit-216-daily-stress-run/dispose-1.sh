#!/usr/bin/env bash
# Fills the Disposition cells of spec-1 and plan-1 (pass-1 reviews) with devteam dispose.
set -euo pipefail
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
R=docs/devteam-dev/tickets/kit-216-daily-stress-run/reviews
T=kit-216-daily-stress-run
for id in F1-1 F1-2 F1-3 F1-4 F1-5 F1-6; do node "$D" dispose "$T" "$R/spec-1.md" "$id" fixed; done
for id in P1-1 P1-2 P1-3 P1-4 P1-5 P1-6; do node "$D" dispose "$T" "$R/plan-1.md" "$id" fixed; done
