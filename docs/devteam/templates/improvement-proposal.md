# <Improvement title>

A research note for a proposal. Save at `project/improvement/research/<date>-<slug>.md` and link it from the `proposal` question (`--note`) or the trial act. Decisions, trial starts and outcomes live in the log (`process/log.md`), not here.

Source: retro | research | architecture | upstream
Serves goal: <g-… id>
Written: <date>

## Evidence

What the metrics, events, reviews or research show. Link the research note and sources.

## Change

What exactly changes, and where (settings, a prompt, a process doc, the roadmap, the architecture).

## Expected gain

| Dimension | Expected effect | How measured |
|---|---|---|
| speed | | cycle time, phase time |
| quality | must not get worse | escaped defects, first-pass rejection rate |
| cost | | cost per merged ticket |

## Risk and undo

What could go wrong, and how to revert.

## Trial

- Slice: <feature, component, or next N tickets>
- Started: <date>
- Before: <metrics snapshot>
- During: <metrics snapshot>

## Outcome

Kept or reverted, with the numbers. Upstream PR, if any: <link>
