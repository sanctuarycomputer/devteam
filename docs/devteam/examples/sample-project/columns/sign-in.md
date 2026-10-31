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
| app-02-expiry-redirect | build | S | normal | SIGNIN-S2 |
| app-03-sign-in-e2e | integration | S | normal | SIGNIN-S1, SIGNIN-S2 |

## 3. Waves and critical path

(output of `devteam.mjs waves --column sign-in`)
