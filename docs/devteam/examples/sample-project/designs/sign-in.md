# Sign-in

Status: approved
Column: sign-in

## 1. Context and goals

Users can't sign in yet. Goal: email and password sign-in that returns a session token, and a clean return to sign-in when the session ends. Non-goals: social login, password reset (a later column).

## 2. Components and boundaries

| Component | Changes | Owns |
|---|---|---|
| api | new session endpoint and domain module | credentials check, token issue, rate limit |
| app | sign-in screen, expiry handling | session storage on the device |

## 3. Contracts

| Contract | Provider | Consumers | Shape (summary) | Version change |
|---|---|---|---|---|
| `docs/contracts/session.md` | api | app | token, expiry, typed errors | new, 1.0 |

## 4. Data

| Data | Tier | Migration | Rollback-safe? |
|---|---|---|---|
| sessions | B (append-only log + current state) | new table | yes |

## 5. Failure modes

API down: the app shows a retry state, never a blank screen. Clock skew: expiry is enforced by the API, not the device clock.

## 6. Security and PII

Email is PII (registered). Passwords are hashed with the framework default; failed attempts are rate limited per account and per IP.

## 7. Alternatives considered

| Option | Why it lost |
|---|---|
| magic links only | needs email delivery first; slower to ship |

## 8. One-way doors

- Publishing the session token shape (answered by the owner: q-20261031-120000-supervisor).

## 9. Risks and unknowns

None after research.
