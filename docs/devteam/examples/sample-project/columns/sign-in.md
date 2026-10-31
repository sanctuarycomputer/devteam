# Column: sign-in

## 0. Header

- Status: approved
- Design: `project/designs/sign-in.md`
- Problem statement: users need to sign in with email and password and be returned to sign-in when their session ends.

## 1. Stories

| Id | Story | Acceptance (checked end to end) |
|---|---|---|
| SIGNIN-S1 | When a user submits a valid email and password, the API shall return a session token and the app shall show the home screen. | e2e `sign-in.spec.ts` "valid credentials" passes |
| SIGNIN-S2 | When a session token has expired, the app shall return the user to the sign-in screen. | e2e `sign-in.spec.ts` "expired session" passes |

## 2. Nodes

| Node | Kind | Size | Risk | Serves |
|---|---|---|---|---|
| api-01-session-contract | contract | S | high | SIGNIN-S1, SIGNIN-S2 |
| api-02-password-sign-in | build | M | high | SIGNIN-S1 |
| app-01-sign-in-screen | build | M | high | SIGNIN-S1 |
| app-02-expiry-redirect | build | S | high | SIGNIN-S2 |
| app-03-sign-in-e2e | integration | S | normal | SIGNIN-S1, SIGNIN-S2 |

## 3. Waves and critical path

```
wave 1 (1): api-01-session-contract
wave 2 (3): api-02-password-sign-in, app-01-sign-in-screen, app-02-expiry-redirect
wave 3 (1): app-03-sign-in-e2e
critical path (weight 4, S=1 M=2): api-01-session-contract -> api-02-password-sign-in -> app-03-sign-in-e2e
5 node(s) in 3 wave(s); max parallel width 3
```

## 4. Gaps

- After wave 1, nothing user-visible ships; the contract and fake exist.
- After wave 2, sign-in works against the API but no end-to-end check guards it.

## 5. Owner questions

| Question id | Question | Answer | Date |
|---|---|---|---|
| q-20261031-120000-supervisor | Publish the session token shape as contract 1.0? | Yes | 2026-10-31 |

## 6. Release map

| Story | Expected release |
|---|---|
| SIGNIN-S1 | v0.2.0 |
| SIGNIN-S2 | v0.2.0 |

## 7. Rulings log

| Date | Ruling | Source |
|---|---|---|

## 8. Supersessions

- None.
