# Architecture

Status: draft | in review | approved
Read against: <commit sha>

The whole system as planned now: the sum of every feature design so far. Written at bootstrap (from the code when adopting an existing codebase, `process/bootstrap.md` §5.1; nearly empty for a new repo), then updated by every feature's planning PR that changes something described here (`process/planning.md` P6). Every design's research starts here, and an architecture reassessment reads it against the goals and the roadmap (`process/improvement.md` §3.3). The version at adoption is in git history.

A feature's changes appear here when its plan lands, before its tickets do; whether they have landed in code is computed from the feature's tickets (the Changed by table names the feature), never written here.

## 1. Components

| Component | Path | Stack | Owns | Talks to |
|---|---|---|---|---|
| | | | | |

## 2. Existing contracts

Explicit or implied interfaces between components, and where each is defined.

| Contract | Provider | Consumers | Defined in | Versioned? |
|---|---|---|---|---|
| | | | | |

## 3. Persistence

| Domain | Store | Tier as it stands (`code-style.md` §4) | Notes |
|---|---|---|---|
| | | | |

## 4. External dependencies and deployment

| Dependency or vendor | Used for | Owned by | One-way door? |
|---|---|---|---|
| | | | |

Deployment shape: where each component runs, how it ships, which rings (`release.md`).

## 5. Distance from the code rules

| Component | Laws met | Laws violated (how widely) | Gate mode |
|---|---|---|---|
| | | | enforced / ratchet |

## 6. Hotspots

Files most changed and most depended on; footprints that touch these will overlap.

| Path | Why it is hot |
|---|---|
| | |

## 7. Tests and CI

- Coverage:
- Flaky tests:
- Suite duration:

## 8. In flight

Work that was already underway at adoption (`process/bootstrap.md` §5.2).

| PR / branch | Files it changes | Decision | Notes |
|---|---|---|---|
| | | finish outside / adopted as `<ticket-id>` / closed | |

## 9. Changed by

One row per feature whose plan changed this file.

| Feature | Design | Date | What changed |
|---|---|---|---|
| | `project/designs/<slug>.md` | | |
