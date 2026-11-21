# Code & System Doctrine

A generic, portable engineering doctrine for building any system — frontend, backend, services, IoT — in any stack (Rails, Next.js, Phoenix, Rust, Go, TypeScript), by human or AI-agent developers. Its purpose is to remove choices: a builder should rarely face a hard judgment call, because the decision is already made and, wherever possible, enforced by a gate rather than a reviewer.

> **The lint/gate configuration is the source of truth; this document is its commentary.** Where the two disagree, the gate config is right and this doc is a bug. Every rule marked **Law** has an ID (e.g. `L-STRUCT-2`) used by the gate config and by the escape hatch (§16).

A Law is enforced only once its gate is commissioned: it needs a row in [`quality.md`](quality.md) §2 and an entry in `settings.gates`. Until then it is reviewed as Doctrine.

## 0. How to read this

- **Law** — must; stated so a linter/type-checker/CI gate enforces it. A rule that *can* be a gate *must* be a gate. Each carries an ID.
- **Doctrine** — should; enforced by review judgment where a gate can't carry it.
- **Binding** — the per-stack translation (Appendix B). **The binding is the resolved answer**: an agent follows its stack's binding and never has to resolve "doctrine vs framework convention" at runtime.
- **Default stack** — the language, framework, datastore, host and vendors for each kind of project (Appendix D). The owner chose them, so picking a default, or an alternative Appendix D calls acceptable, needs no owner question; using something else needs an ADR and is the owner's one-way door (`constitution.md` §4).
- **Project settings** — the few per-project decisions: the persistence-tier assignment (§4), the "critical operation" list (§7), the retention windows and the PII-erasure mechanism (§11). This file states the *rule*; a project states its *assignments* in `project/settings.md`.

Precedence when rules appear to conflict: the user's explicit instruction → this doctrine *as resolved by the stack binding* → the framework's convention → the builder's judgment. Because the binding resolves framework-specific cases ahead of time (e.g. framework control-flow throws, §3), precedence is rarely exercised live.

## 1. The spine

**Functional core, imperative shell, inside the framework's conventional skeleton.**

Build the conventional way the framework wants (MVC, convention over configuration). *Inside* that, put all real logic in pure functions over immutable data returning result values; push every side effect — I/O, DB, network, clock, randomness, the bus — to a thin shell at the edges. Most of the rest of this doc is a consequence: logic is functions not stateful objects; a "service object" is the shell's command handler (stateless, one entry, orchestrates pure functions + injected effects); the pure core can't throw, so expected failures are values; its inputs are parsed into precise types, so illegal states can't reach it; and it's trivially testable.

## 2. Structure — MVC, convention over configuration

- **`L-STRUCT-1` the core lives in `domain/`** — `app/domain/` (Rails), `src/domain/` (Next, Rust), `internal/domain/` (Go); Phoenix contexts are the core. Every path-scoped gate (§3, §6) targets it.
- **`L-STRUCT-2` skinny models** — persistence mapping, associations, scopes only. No domain logic; no lifecycle callbacks that branch on domain rules (the outbox relay, §6, is the one carved-out exception; gate: Rails cop bans `after_*` in models except the relay).
- **`L-STRUCT-3` one domain concept per file, grouped (not loose)** — functions grouped by concept in a module/package. TS: named exports only (gate `import/no-default-export`, `erasableSyntaxOnly: true`); do **not** wrap exports in an object or a runtime `namespace`. Go packages and Rust modules satisfy this natively.
- **`L-STRUCT-4` thin controllers** — parse input, invoke one command, render the result. Gate: cyclomatic ≤ 3 on `controllers/**`.
- **Doctrine — convention over configuration.** Follow the framework's conventions and defaults; don't configure what a convention decides. One way per thing.
- **CRUD ↔ command rule (decided, so it's not a per-case choice).** The HTTP surface is CRUD over resources; a state transition is a sub-resource create (`POST /orders/:id/cancellation`), and behind each action is exactly one command module (`CancelOrder.call`). Reach past CRUD only when no resource shape expresses the operation.
- **Doctrine — one place for each command.** A command lives at `domain/<aggregate>/<VerbNoun>`: the folder named for the aggregate in the plural, the file in the stack's own case. `app/domain/orders/cancel_order.rb` defines `Orders::CancelOrder` (the plural keeps it out of the `Order` model's constant); `src/domain/orders/cancel-order.ts` exports `cancelOrder`. The aggregate's pure functions sit beside it (`L-STRUCT-3`). A command takes its effects injected (§6), so it stays deterministic (`L-EFFECT-1`).

## 3. Logic, errors, and types

- **`L-LOGIC-1` immutable inputs** — the core never mutates its inputs.
- **`L-LOGIC-2` result values, not exceptions, for expected outcomes** — a function you own that can fail returns `{ok}|{error e}` (Rust `Result`; Go `(T, error)`; TS discriminated union; Elixir `{:ok,_}`/`{:error,_}`; Ruby a result value object).
- **The four error categories — decided, so "tuple or raise?" is never a judgment call:**
  1. **Expected error** → a typed value in the result. Never thrown.
  2. **Boundary throw** → a library/IO call may throw; catch it *at that boundary only* and convert to a result. try/catch appears only here.
  3. **Bug / invariant violation** → allowed to crash; caught once at the top-level shell handler and sent to **telemetry** (§6), never to the outbox, never swallowed.
  4. **Framework control flow** → a throw the framework *owns and consumes* (Next `redirect()`/`notFound()`, Rails `RecordNotFound`→`rescue_from`, Phoenix/Plug `halt`). **Never caught, never converted.** The per-stack binding (Appendix B) lists each, so an agent never wraps one.
- **`L-LOGIC-3` typed errors, not strings** (a closed sum type) — **Law on typed stacks (Rust/Go/TS); Doctrine in Ruby** (no Sorbet mandate; the proxy gate is error-arm test coverage, §12).
- **Make impossible states impossible.**
  - **`L-LOGIC-4` parse, don't validate** — one parse step at each entry turns untrusted input into a precise domain type (for *shape*). Downstream does not re-validate shape; DB constraints remain as integrity invariants; authorization is a *policy* check that lives in the command (§10), not a re-parse.
  - **Branded/opaque types + smart constructors** — a checked value carries a type that proves it.
  - **`L-LOGIC-5` exhaustive matches over sum types** — **Law on typed stacks** (TS `assertNever`; Rust clippy `wildcard_enum_match_arm` on `domain/`; Go partial); **Doctrine in Ruby** (`else raise`, proxied by error-arm tests).

## 4. Persistence — three tiers

Default to the simplest; escalate only with a stated reason (an ADR for Tier A).

- **Tier C (default) — CRUD + audit columns + soft-aware delete.** `created_at`/`updated_at`/`created_by`. **`L-DATA-1` no hard delete without an erasure reason**; the mechanism (`deleted_at` column vs a `deleted_records` table) is a **project setting** (blanket `deleted_at` is contested — it burdens every query and breaks unique indexes; Brandur, "Soft Deletion Probably Isn't Worth It", 2022). Most data is Tier C.
- **Tier B — append-only log + current-state projection.** For data whose history matters. **Permissions/authorization default here** (an append-only audit table satisfies nearly every regulator).
- **Tier A (exception, ADR-gated) — event sourcing + projections.** Reserved for **money and legally-disputed records only**; any other domain needs an ADR to justify it ("event sourcing is not a top-level architecture" — Greg Young).
- **`L-DATA-2` forward-only, rollback-safe migrations** — a non-rollback-safe migration is flagged as a one-way door and minimized.
- **`L-DATA-3` event/row shapes are forever** — a shipped Tier A/B shape is never mutated; evolve by versioning + upcasting. (Shape is forever; *rows* live by the retention policy, §11 — no contradiction.)
- **Project settings** — each domain's tier.

## 5. State, consistency, time

- **Doctrine — server-side time-travel is the audit log + projections**, not a product feature; a replay/debugger UI is a separate UI treatment, out of scope here.
- **`L-STATE-1` client-state tools stay on the client** — Redux-style time-travel is a *frontend* concern (§13), never the server's persistence model.
- **Doctrine — consistency is a contract** — any read from a projection/cache is eventually consistent and states its staleness bound where exposed; no read-after-write assumption unless promised.
- **`L-STATE-2` clock & ordering discipline** — never order across processes/nodes by wall-clock; monotonic clock for elapsed/timeouts, a logical/sequence value for ordering; wall clock for display/stamps only. (Clocks are injected — §6.)

## 6. Effects, the bus, dependency injection

- **DI of effects** — the core receives a capabilities record (clock, id, randomness, DB, HTTP, bus, cancellation signal), passed in, never imported.
- **`L-EFFECT-1` determinism in `domain/`** — no wall-clock read, no `uuid`/random, no ambient global in the core; all injected. Gate: ESLint `no-restricted-globals`/`no-restricted-syntax`, clippy `disallowed_methods`, golangci `forbidigo`, a RuboCop cop — scoped to `domain/`.
- **One id scheme: UUIDv7** (RFC 9562; time-ordered, native in Postgres 18) — the injected id generator returns it. No per-feature id choice.
- **Two separate channels — do not conflate them:**
  - **Domain events** → the **transactional outbox**: written in the *same* DB transaction as the state change, published by a relay, **at-least-once ⇒ `L-EFFECT-2` every handler is idempotent**. Binding names the relay (Next: a durable job runner — one, named in the binding; Rust/IoT: a local durable queue, SQLite WAL).
  - **Telemetry** (logs, metrics, exceptions, analytics) → **fire-and-forget, best-effort, never in a DB transaction.** This is where a §3-cat-3 crash is routed and where §9's wide events go.
- **`L-EFFECT-3` no ambient output outside the shell** — ban `console.*`/`puts`/`fmt.Println` in `domain/` (ESLint `no-console`, RuboCop `Rails/Output`, `forbidigo`); the core emits through the injected bus.

## 7. Idempotency

- **`L-IDEM-1` external side effects and money carry an idempotency key** end-to-end (the IETF `Idempotency-Key` header; Stripe's model), with a dedup store making a repeat a no-op returning the first result.
- **State transitions use a conditional write** (optimistic lock, `UPDATE … WHERE status = 'pending'`) — no key plumbing — unless the **project settings** list a specific transition as critical.
- **`L-IDEM-2` event handlers are idempotent** (from §6 at-least-once).
- **Retries (§8) are permitted only on idempotent calls.** An agent must not retry a non-idempotent POST.

## 8. Resilience — crash-only, bounded, degrade gracefully

- **Crash-only recovery** — survive crash/restart via idempotent handlers + the outbox; state is recoverable from durable stores.
- **`L-RESIL-1` every outbound call has a timeout/deadline** (Go `noctx`/`context`; TS an `AbortSignal` threaded from the shell; Ruby central `Net::HTTP` timeouts), **`L-RESIL-2` a request body-size limit, and a pagination max.** (These are the enforceable slice of "everything bounded"; the broader "bound every loop" is Doctrine.)
- **`L-RESIL-3` retries use exponential backoff + jitter** (Brooker, AWS, "Exponential Backoff and Jitter", 2015). Retry *budgets*, circuit breakers, backpressure/load-shedding, and graceful-degradation modes are **Doctrine** (apply where a dependency is failure-prone or a queue exists).
- **Doctrine — a backup-restore drill** is run; "recoverable from durable stores" is unproven until a restore has been exercised.
- **Non-goal:** distributed sagas / partition-tolerance machinery — don't build for failure modes your deployment doesn't have.

## 9. Observability

- **`L-OBS-1` structured, wide events via the telemetry channel** — one rich structured event per unit of work (observability 2.0), not scattered prints/metrics. Queryable after the fact.
- **`L-OBS-2` one trace id threaded boundary-to-boundary** — W3C Trace Context (`traceparent`) + OpenTelemetry semantic conventions as the *vocabulary* (no collector/backend mandate).
- **`L-OBS-3` PII never in a log/event payload** — runtime redaction filters (`filter_parameters`, pino `redact`) plus the §11 annotation registry; a request-body log at the boundary must redact by the registry.
- **`L-OBS-4` one event bus, written and owned by the project; every vendor is a subscriber.** Application code sends every outbound signal (logs, exceptions, metrics, analytics, ad conversions, notifications) through one bus module (`src/bus/`, `app/bus/`). Each signal vendor (Sentry, Google Analytics, Ahoy, Meta, Resend) is one subscriber in `bus/subscribers/`, and only that file calls it; Noticed is the library the Rails notification subscriber uses. A call that needs an answer back (creating a Stripe Checkout Session) is not a signal: it is an injected effect (§6) behind one adapter, and its webhooks come in through the outbox. Gate: lint bans each vendor's SDK outside its subscriber (ESLint `no-restricted-imports`; `no-restricted-globals` and `no-restricted-properties` for `gtag`, `fbq` and `dataLayer`, `window.` forms included, outside the browser's bus, `src/bus/client.ts`; Ruby: a cop, or a `git grep` gate over `app/` that leaves out `app/bus/`). Exempt: the SDK's boot and config files (`instrumentation.ts`, `sentry.*.config.ts`, `next.config.*`, `config/initializers/sentry.rb`) and the framework's own request log. A §3 category-3 crash reaches Sentry through the top-level handler's `emit`; Sentry's automatic capture stays on as the backstop for what never reaches that handler, and a repeat is dropped (the JS SDK's Dedupe integration; in Rails a rescued error never reaches Sentry's middleware).
- **The bus carries §6's two channels as its two delivery modes, never mixed.**
  - **Durable:** `publish` a domain event. It is written to the outbox in the state change's own transaction and delivered at least once by the relay, so every subscriber is idempotent (`L-EFFECT-2`). A subscriber that must not lose an event uses this mode: a notification, a Turbo or LiveView broadcast, a purchase sent to an ad platform from the server.
  - **Best-effort:** `emit` a telemetry signal: logs, exceptions, metrics, page and product analytics. Never inside a transaction; a subscriber's failure never fails or slows the caller.
  - The relay may also hand a committed domain event to best-effort subscribers (an analytics event for an order placed). A telemetry signal never becomes a domain event.
- **Doctrine — consent and ad conversions.** Analytics and ad subscribers send only what the visitor's consent allows (Google Consent Mode v2; the Meta Pixel and Conversions API only after consent where the law asks for it). The bus reads the consent state; no call site does. A conversion goes to both the Meta Pixel and the Conversions API with the same `event_id`, so Meta counts it once. The server subscriber looks up and SHA-256-hashes the identifiers Meta matches on (email, phone) when it sends, so they never sit in the event payload (`L-OBS-3`). That flow, with the IP address, user agent and `fbp`/`fbc` cookies it also sends unhashed, is a purpose in the §11 registry (`L-PII-2`).
- **Doctrine — define "healthy" and alert on it** — a lightweight per-surface SLO (latency/availability/correctness); no formal error-budget-freeze policy for a standard product.
- **Doctrine — disciplined log levels** (error = needs a human; warn = degraded; info = a business event; debug = off in prod).

## 10. Security — a priority, not a pass

- **`L-SEC-1` zero-trust, least privilege** — every call between components carries its own credential; the data's owner checks the caller's scope; nothing inherits trust from being "inside."
- **`L-SEC-2` never fail open** — a failed authorization/safety check denies; fail-open is owner-only.
- **`L-SEC-3` config & secrets in one module, parsed once at boot** — all `process.env`/`ENV[]`/`os.Getenv` reads centralized (ESLint `no-process-env`, a cop); secrets never in code/logs/events, short-lived/rotated where the platform allows; TLS in transit everywhere (mTLS only where the deployment/threat model needs it — Appendix C).
- **`L-SEC-4` input parsed + bounded at the boundary** (§3, §8); **rate-limited/quota'd at every external boundary.**
- **AI-native security (first-class — the product uses models and agents write the code):** `L-SEC-5` treat every model output as untrusted input; guard the **lethal trifecta** (never let untrusted content + private-data access + an exfiltration path coexist on one path — Willison, 2025); sandbox tool/agent capabilities to least privilege; **for AI features, tests are evals** (an eval harness with thresholds), not `assert ==`.
- **Supply chain:** prefer stdlib/a small local helper over a micro-dependency; `L-SEC-6` pin + lockfile + a **dependency cooldown** (7-day minimum release age, advisories override — post-2025-npm-worm standard; pnpm 11 defaults it on); `L-SEC-7` the vetting checklist fires only when a **new top-level dependency** appears (bumps go through cooldown + advisory, not the checklist); `L-SEC-8` gitleaks (extending the kit's `gitleaks.toml`, `quality.md` Secrets) + frozen-lockfile install in CI. An SBOM is Law only if CI emits it with zero human steps, else Appendix C. Signed/attested SLSA provenance → Appendix C.
- **Secret storage — encrypted and checked in.** Secrets live in the repo, encrypted with the framework's standard tool: Rails credentials per environment (`config/credentials/<env>.yml.enc`) for Rails; SOPS with age everywhere else; the platform's native form (sealed secrets, the host's secret store) only where the deploy target requires it. The decryption key is the only thing outside git, one per environment: locally a gitignored key file that `worktree_files` copies into worktrees (development and test keys only), in CI and production the platform's secret store. No plaintext secret is ever committed (`L-SEC-8`).
- **Secrets and agents.** Agents work with development and test keys. Workers read secrets only through the encrypted store; they never receive a value directly. The owner posts a value through an owner-action question that names where it goes (`process/supervisor.md`, owner actions); devteam pipes it there from the owner's own process and logs only the name, so it never passes through the supervisor's context. A production secret goes anywhere only on the owner's question, with its decryption key in the owner's shell, never in a key file on disk or one that `worktree_files` copies.
- **Sensors use the access the project already has.** A production sensor reads through a CLI already logged in on the supervisor's machine (the one production migrations use) or a credential read from the encrypted store into the probe's environment, never argv, never printed (`process/supervisor.md`, Monitoring). Use a read-only token where the tool offers one; a token that can write is kept to reading by probes being reviewed code that only read (`quality.md` §3), and a production write is a remediation on its own ladder class (`process/supervisor.md`, Monitoring: no owner approval is needed for a sensor, because a sensor only reads). Everything a probe prints is redacted of those credentials and scrubbed of personal data (typed placeholders; the owner adds patterns in `sensor_scrub`) before it is stored, and production text reaches an agent only framed as untrusted data (`L-SEC-5`). A probe runs as this user and can read what this user can, so nothing here isolates one sensor's credential from another probe's code.
- **Doctrine — lightweight threat modeling** of the risky/sensitive features (auth, payments, PII, agent-driven paths), not of every feature.
- **Doctrine — security headers / CSP defaults** per OWASP ASVS 5.0 (2025).
- **`L-SEC-10` never roll your own auth; a user's session lives in the database.** Authentication comes from the binding's library (Rails: Devise; TypeScript: Better Auth, or Auth.js set up as below), set up for database sessions: the cookie holds an opaque session id, the session row lives in Postgres, and signing out or revoking deletes the row. No JWT and no signed or encrypted cookie holds a user's session. Rails' default `CookieStore` is one, so Rails sessions use `activerecord-session_store`; Better Auth's `session.cookieCache` stays off; Auth.js runs `session.strategy: "database"` with its database adapter and no Credentials provider (Credentials works only with JWTs, so email and password means Better Auth). A JWT is fine for what isn't a user's session, such as checking a provider's ID token. Remember-me lengthens the database session's expiry; Devise's `rememberable` (a signed cookie) stays off. On Rails the answer is Devise, not Rails 8's `authentication` generator. Gate: a lint and manifest deny-list (`jsonwebtoken`, `passport-jwt`, `@nestjs/jwt`, `devise-jwt`, a direct `bcrypt` or `argon2` import, `has_secure_password`, `strategy: "jwt"`, `cookieCache`, an import of Auth.js's Credentials provider from any of its packages, `**/providers/credentials`). It catches the common ways; review holds the rest.
- **`L-SEC-11` the session cookie is locked down.** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and the `__Host-` name prefix; `SameSite=Strict` where nobody arrives signed in from a link on another site (an admin app). A cookie that must be shared across subdomains sets `Domain` to the shared parent and takes the `__Secure-` prefix instead, since `__Host-` forbids `Domain`. Gate: a request test, run over HTTPS with production cookie settings, asserts each attribute on the sign-in response's `Set-Cookie`.
- **Doctrine — the session's life.** Rotate the session id at sign-in and at any change of privilege; expire it after an idle window and an absolute one; ask for the password again before changing an email, a password or a payout detail. A mobile app holds an opaque session token from the same library (Better Auth's Expo client), kept in the platform's secure storage (`expo-secure-store`), sent as the library's cookie header (its Bearer plugin only for an API that can't read cookies), and revoked like a cookie session. A mobile client of a Rails API holds an opaque token backed by the database: random, stored only as a hash, revocable by deleting its row, kept in the device's keychain (`expo-secure-store`), never a JWT.
- **Doctrine — CSRF and CORS.** Cookie sessions keep CSRF protection on: Rails' `protect_from_forgery` (never skipped on a route that reads the session cookie), the Origin check Next.js server actions make on their own, and an Origin check or a token on every other state-changing route (Better Auth checks its own routes against `trustedOrigins`). `SameSite` is a second layer, never the defence: every subdomain of a site is same-site, so a sibling subdomain can still forge a request. Nothing changes state on a `GET`. CORS is an explicit allow-list of origins read from config: never `*` with credentials, never the request's own `Origin` echoed back, never `null`.
- **Doctrine — config is one typed object.** The config module (`L-SEC-3`) parses the environment once at boot into one typed, frozen object (`zod` in TypeScript; a `dry-struct` over `ENV` in Rails), and the app reads only that object. A feature flag is a boolean key in it named `feature_<x>`, and the line that declares it names the ticket that removes it.

## 11. PII & data lifecycle

- **`L-PII-1` every PII field is annotated in a registry** (a single file naming each PII column/field; a gate checks completeness), **encrypted at rest, and erasable.** The erasure **mechanism is a project settings** — crypto-shredding (a per-subject key; destroying it erases the subject from every immutable log) or a vault+tokens. (Crypto-shred keeps framework auth idioms — Devise/NextAuth/`phx.gen.auth` — intact; a central vault is for regulated/multi-store PII, Appendix C.)
- **`L-PII-2` data minimization + purpose limitation** — collect the least PII needed; bind each datum to its purpose.
- **`L-PII-3` retention/TTL** — immutable logs hold erasable-by-mechanism PII, so the log stays shape-immutable while PII is erased; the log itself carries a retention/compaction policy (**project settings** — the windows).

## 12. Testing

- **`L-TEST-1` a machine-runnable check ships with every change**, and **`L-TEST-2` every error arm of every result has a test** (resilience comes from the unexpected paths).
- **Test-first → Doctrine** (a diff can't prove authorship order); the proxy gate is **`L-TEST-3` every PR touches a test file or carries `no-test:<reason>`**, plus branch-coverage thresholds on `domain/**`.
- **`L-TEST-4` random test order + an empty quarantine list to release** (RSpec `--order random`, vitest `sequence.shuffle`, `go test -shuffle on`). "No flakes" is the policy; this is its gate.
- **`L-TEST-5` prod-shaped seeds + crossed-order runs** — realistic seeds, varied order; catches ordering/query-planner flakes that isolated empty-DB tests and mutation testing miss (CI is often a different DB version than local — never rely on a local gate alone for DB behavior).
- **`L-TEST-6` test state is per checkout.** Workers, merge gates and reviewers run suites at the same time in separate worktrees, so anything a suite shares (the test database, a port, a cache dir, a fixed temp path) is named from the checkout itself, not from an environment variable a process might not set: e.g. Rails `database: app_test_<%= Digest::SHA1.hexdigest(Rails.root.to_s)[0, 8] %>`, a port derived the same way. Gate: two concurrent runs of the suite in two worktrees both pass.
- **Doctrine — property-based tests and incremental mutation testing**, both scoped to `domain/**` only, so CI time stays bounded.
- **AI features — evals with thresholds** (§10).

(The "a fix wave gets a cold confirming re-review" rule is review policy, not code doctrine: see [`quality.md`](quality.md) §3.)

## 13. Frontend (where there is a UI)

- **`L-FE-1` accessibility gate: axe-core zero violations in CI** — honest about scope (automated checks catch a minority, ~57% by volume); **manual WCAG 2.2 AA review is Doctrine** for the rest.
- **`L-FE-2` lab performance budgets in CI** (Lighthouse CI: the four category scores, LCP, CLS, TBT), on every project with a UI, with Appendix D's budgets. Field Core Web Vitals (LCP, CLS, INP; INP, a Core Web Vital since 2024, is field-only) are **monitored + alerted** against Appendix D's targets, not CI-enforced.
- **Doctrine — separate server state from client state** (server state is fetched/cached, not "owned" by the client); optimistic UI + reconciliation; error boundaries + graceful UI degradation; progressive enhancement. Client-state time-travel lives here and only here.
- The TS `AbortSignal` of §8 threads through the client's data layer for cancellation.
- **`L-FE-3` images go through the framework's image component** (`next/image`, `expo-image`; Rails `image_tag`): explicit width and height, lazy below the fold, the largest image above the fold loaded eagerly at high priority, served as AVIF or WebP. Gate: `@next/next/no-img-element` on Next.js; everywhere, Lighthouse CI asserts `unsized-images` and `image-delivery-insight` (Lighthouse 13 and later, the version pinned) in `L-FE-2`'s run. Lazy loading below the fold, and any page Lighthouse doesn't visit, are review.
- **Doctrine — semantic HTML first:** a button is a `<button>`, a link an `<a>`, one `<h1>`, landmarks for the page's regions; `eslint-plugin-jsx-a11y` where there is JSX. axe (`L-FE-1`) catches what it can of the rest.
- **Doctrine — JSON-LD on content pages** (schema.org `Article`, `Product`, `Organization`, `BreadcrumbList`), built from the same data as the page and checked by a test that parses it.
- **Doctrine — i18n from day one.** Every string a user reads goes through the framework's i18n (Rails `I18n.t`, `next-intl`; an Expo app reads the same catalogue), even with one language; dates, numbers and money go through locale formatters. Lint with `eslint-plugin-i18next`'s `no-literal-string` where it is commissioned, and `i18n-tasks` for missing and unused keys in Rails.

## 14. Architecture defaults — what NOT to do (Doctrine)

- **Majestic monolith first** — one deployable app holds the API, the web app and the admin, cut into modules inside. Split a service out only at a *proven* boundary (independent scale/deploy you actually need), with an ADR (`project/designs/adr/<n>-<slug>.md`, `process/planning.md`). Premature microservices buy the distributed-systems tax for nothing.
- **Boring-technology budget: three innovation tokens, listed in an ADR**; an Appendix D default spends none; everything else boring, proven, few dependencies.
- **One repo per product** — its apps side by side (`/cms` beside `/www`; a Rails app beside a React Native app), shared TypeScript in packages, as pnpm workspaces under Turborepo. A non-TypeScript app keeps its own toolchain, pinned in the root `.tool-versions` (`L-ERG-3`); each app's gates use `paths` (`quality.md` §2).
- **Dependency order** — the standard library, then the framework's built-in, then the Appendix D default, then a well-known library that passes the dependency checklist: popular in its ecosystem, over a year old, more than one maintainer, a release in the last six months, and no overlap with an Appendix D default (`L-SEC-7`'s vetting checks the minimum). A step down this order says why in the PR. A library that passes the checklist needs no owner question; one that fails it, or that brings a runtime, a datastore or a vendor, is the owner's `new-dependency` question (`constitution.md` §4).
- **No premature generality** — build for the cases you have; don't frameworkize ahead of a second real caller.

## 15. Agent ergonomics — the meta-rule

The doctrine removes choices only to the extent it is **decisive** (one way per thing), **machine-checked** (a gate, not prose), and **templated**.

- **`L-ERG-1` size/complexity = the linter's defaults** (RuboCop `Metrics/*`, ESLint `complexity: 10`/`max-lines: 300`, clippy `too_many_lines`, gocyclo 15). "Defaults" is the no-choice answer.
- **Make it a gate, not a guideline.** Anything a linter/type-checker/CI can enforce, must be.
- **`L-ERG-3` one toolchain, declared in `.tool-versions`.** asdf is the version manager. Every runtime and CLI the repo needs (`nodejs`, `ruby`, `python`, `postgres`, …) is pinned to an exact version in a root `.tool-versions`, so a builder, an agent's worktree and CI all run the same versions with no guessing. CI reads it (`asdf-vm/actions`, or a setup action's `*-version-file: .tool-versions`) instead of repeating versions; `.nvmrc`/`.ruby-version` only mirror it where a tool can't read it. Gate: CI fails when `.tool-versions` is missing, or a runtime the repo uses isn't in it.
- **`L-ERG-2` autofix-first** — every gate that can autofix runs in `--fix` (`eslint --fix`, `prettier --write`, `ruff --fix`, `rubocop -a`, `clippy --fix`) before it fails, to save builder/agent tokens and time.
- **One template per repetitive shape** — command/service object, event, projection, typed error — so the builder fills a skeleton, not invents structure.
- **Self-documenting names; comment the *why*.** An ADR records a decision.

## 16. The escape hatch

**`L-ESC-1` the only sanctioned way to suppress a gate is `// doctrine-exception(<rule-id>): <reason>`** (adapted to the stack's comment syntax). A CI gate counts them and lists them on the PR; a **bare `eslint-disable`/`rubocop:disable`/`#[allow]` fails CI.** Every Law has an ID (§0) for exactly this. An exception is a visible, reviewed, counted decision — never a silent workaround.

## 17. Day-one floor vs escalation triggers

To protect speed, a new system ships on the **floor**, not the full doctrine:

**Floor (every project, day one):** the framework skeleton · `domain/` with pure functions + result values · parse-at-the-edge (one schema lib per binding) · typed errors (typed stacks) · an outbox *table* · the bus module (`L-OBS-4`, best-effort `emit` at least) · a `.tool-versions` (`L-ERG-3`) · the lint gates of Appendix A.

**Turn on when its trigger fires:**

| Mechanism | Escalation trigger |
|---|---|
| The outbox relay and the bus's durable `publish` | the first durable subscriber (a notification, a broadcast, a server-side conversion) or cross-component event consumer |
| Read projections (CQRS) | a read that the write model genuinely can't serve |
| Tier B (append-only log) | a domain whose history is required (audit, permissions) |
| Tier A (event sourcing) | money or legally-disputed records (ADR) |
| Idempotency-key store | the first external side effect or money path |
| PII vault (vs crypto-shred) | regulated or multi-store PII (Appendix C) |
| Circuit breaker / backpressure | a failure-prone dependency or a real queue |
| Retry budget | fleet-scale load |

---

## Appendix A — Law (gate-enforced) vs Doctrine (review-enforced)

Each Law → a commissioned gate, autofix-first (§15) where possible, catalogued in [`quality.md`](quality.md) §2. IDs match the body.

- `L-STRUCT-1`..`4` core dir / skinny models (no non-relay callbacks) / one-concept-per-file named-exports / thin controllers (cyclo ≤3).
- `L-LOGIC-1`..`5` immutable inputs / result values / typed errors (typed stacks) / parse-at-edge / exhaustive matches (typed stacks). *(Ruby: `L-LOGIC-3`,`5` are Doctrine; proxy = `L-TEST-2`.)*
- `L-DATA-1`..`3` no-hard-delete-without-reason / forward-only+rollback-safe / shapes-forever.
- `L-STATE-1`,`2` client-state-stays-client / no cross-node wall-clock ordering.
- `L-EFFECT-1`..`3` determinism in `domain/` / idempotent handlers / no ambient output in core.
- `L-IDEM-1`,`2` idempotency key on external+money / idempotent handlers.
- `L-RESIL-1`..`3` outbound timeout+AbortSignal / body-size + pagination max / backoff+jitter.
- `L-OBS-1`..`3` wide events / trace id / PII-never-in-logs.
- `L-SEC-1`..`8` zero-trust scope check / no-fail-open / central config+secrets / bounded+rate-limited input / model-output-untrusted / pin+lockfile+cooldown / vet-on-new-dep / gitleaks+frozen-lockfile.
- `L-PII-1`..`3` PII registry complete + encrypted + erasable / minimization+purpose / retention policy present.
- `L-TEST-1`..`6` per-change check / error-arm coverage / PR-touches-test-or-`no-test` + domain coverage / random order + empty quarantine / prod-shaped seeds / test state per checkout.
- `L-FE-1`,`2` axe-zero / Lighthouse lab budgets.
- `L-ERG-1`..`3` linter-default metrics / autofix-first / toolchain pinned in `.tool-versions` (asdf).
- `L-ESC-1` doctrine-exception is the only suppression; bare disables fail.
- Added with Appendix D: `L-OBS-4` a vendor only inside its bus subscriber / `L-SEC-10` auth library + database sessions, no JWT sessions (deny-list) / `L-SEC-11` session cookie attributes (request test) / `L-FE-3` images through the framework's component.

Doctrine (judgment; no gate): tier assignment, the critical-operation list, degraded-mode design, retry budgets / circuit breakers / backpressure, threat-model depth, SLO targets, convention-over-configuration, majestic-monolith-first, boring-tech budget, backup-restore drill, server/client-state split, property/mutation testing scope.

## Appendix B — Per-stack bindings (the resolved answer; one choice each)

- **Rails:** core in `app/domain/`; models associations/scopes only, no callbacks except the `after_commit` outbox relay; commands `Command.call` returning a result value; `dry-schema`/`dry-struct` at the controller edge (not strong params / `params.expect` alone, which don't parse); shape/integrity validations that mirror DB constraints may stay on the model, domain rules live in the command's parse; `L-LOGIC-3`/`5` are Doctrine (error-arm tests the proxy); `Ecto.Multi`-equivalent transaction + `after_commit` relay for the outbox. **Framework control flow (never caught):** `RecordNotFound`→`rescue_from`, `redirect_to`/`head`.
- **Next.js:** core in `src/domain/`; server actions/components are the shell; `zod` at the boundary + branded types; named exports, `erasableSyntaxOnly: true`; server-state via the data layer, client-state local; thread `AbortSignal`. Outbox relay = one named durable job runner: pg-boss where a long-lived worker runs (Render); on Vercel, where no process lives between requests, a drain of the outbox right after commit (`after()`), with a Vercel Cron Job every minute (a paid plan; the free plan runs cron once a day) as the sweep that catches a missed drain; the relay claims rows with `FOR UPDATE SKIP LOCKED`, so two drains at once never deliver one row twice. **Framework control flow (never caught):** `redirect()`, `notFound()`.
- **Phoenix/Elixir:** contexts are the core; `{:ok,_}`/`{:error,_}` + `with`; `Ecto.Multi` outbox; native exhaustiveness; `FallbackController` for `{:error, _}`. **Framework control flow:** `Plug` `halt`, `Ecto` `*!` raises caught only at the context edge.
- **Rust:** `Result<T,E>` + a typed error enum; newtypes; clippy `wildcard_enum_match_arm` on `domain/` (do **not** use `#[non_exhaustive]` on app enums); effects behind traits; IoT outbox = SQLite WAL.
- **Go:** `(T,error)` + typed/wrapped errors; small interfaces for effects; packages as the boundary; `context.Context` for deadlines (`noctx`).
- **TypeScript (shared):** discriminated-union results + `assertNever`; `zod` (one lib) at the boundary; named exports (`import/no-default-export`); `AbortSignal` for cancellation/timeouts.
- **Rails jobs and auth:** Solid Queue runs every background job and the outbox relay; schedules live in `config/recurring.yml`. Devise for sign-in, on `activerecord-session_store` (`L-SEC-10`). Pundit for authorization, in controllers and ActiveAdmin alike, over a default-deny `ApplicationPolicy` (`L-SEC-2`). Noticed for notifications (Appendix D), called only from the notification subscriber (`L-OBS-4`).
- **Rails — Hotwire:** Turbo Frames and Streams are rendering, in the shell. A Stimulus controller holds client state only (`L-STATE-1`), never a domain rule. A broadcast goes out from a durable bus subscriber after commit, never from a model's `broadcasts_to` or `after_*_commit` (a model callback, `L-STRUCT-2`). After a Turbo form submit, redirect with `status: :see_other`.
- **Rails — ActiveAdmin:** a resource in `app/admin/**` is shell code. A `member_action`, `batch_action` or `controller do` block parses its input and calls one command, as a controller does (`L-STRUCT-4`). The index, form and filter DSL is configuration: it sits outside the `controllers/**` complexity glob, and holds no domain rule all the same (review). ActiveAdmin's built-in create and update write through the model only for Tier C data with no domain rule; anything else routes through a command. Admins sign in through Devise; authorization is `ActiveAdmin::PunditAdapter` over a default-deny `ApplicationPolicy` (`L-SEC-2`), since ActiveAdmin's own adapter allows everything.
- **Phoenix — LiveView:** a LiveView is shell code. `mount` and `handle_event` parse their params and call one context function; assigns hold UI state only. A PubSub broadcast goes out after the transaction commits (from the outbox relay), never inside an `Ecto.Multi`. `push_navigate` and `redirect` are return values, so there is nothing to catch.
- **NestJS:** core in `src/domain/`; modules, controllers and providers are the shell. Controllers are thin (`L-STRUCT-4`; the complexity glob includes `**/*.controller.ts`). `zod` at the boundary through one validation pipe, not `class-validator` (one schema library, as TypeScript shared says). Prisma only inside repository providers, never imported in `domain/`. pg-boss runs every job and the outbox relay; a schedule is the host's cron (a Render Cron Job) enqueueing a pg-boss job. One global exception filter turns errors into Problem Details (Appendix D). **Framework control flow (never caught):** `HttpException` and its subclasses, which the exception filter consumes.
- **Next.js with Sanity:** content through `next-sanity`; the webhook route checks Sanity's signature before it calls `revalidateTag`.
- **React Native (Expo):** core in a shared workspace package (`packages/domain`) or `src/domain/`; Expo Router; EAS Build and Submit for store builds; EAS Update for JavaScript-only changes, pinned to a runtime version. An update to the production channel is a production release, like a store submission (`release-production`, `constitution.md` §1): cut from a release tag (`quality.md` §5), its notes naming the runtime version and the update group. Native code only for a strong performance reason, by ADR. Unit tests on `jest-expo` (Vitest doesn't run React Native); end-to-end on Maestro.

## Appendix C — Filtered out / downgraded (impractical for standard end-user / SaaS / product / IoT; kept the pragmatic floor)

- **Central PII vault + tokens** → crypto-shred or vault is a project settings; central vault only for *regulated / multi-store* PII.
- **mTLS between every service** → TLS-in-transit + short-lived creds; mTLS only where the threat model needs it.
- **Full SLSA signed/attested/reproducible builds** → pin + lockfile + cooldown + vet + (CI-emitted) SBOM is the floor; attestation only for supply-chain targets / at scale.
- **Hash-chained tamper-evident audit** → Tier-A / money / compliance only.
- **Hermetic / bit-reproducible builds** → pinned toolchains + lockfiles.
- **Formal SLO + error-budget release-freeze** → "define healthy + alert."
- **STRIDE every feature** → threat-model the risky features only.
- **Full OpenTelemetry collector/backend stack** → wide events + W3C trace-context vocabulary, no vendor mandate.
- **Tier-A event sourcing as a default** → money + legally-disputed only (ADR); permissions default Tier B.
- **Retry budgets, circuit breakers, backpressure** → Doctrine, applied where a dependency/queue warrants.
- **Distributed sagas / partition tolerance** → non-goal (crash-only).

## Appendix D — Default stack (decided; deviate only by ADR)

The owner chose these, so a project never debates them. Picking the default for the job it names, or an alternative it calls acceptable without an ADR, needs no owner question (`constitution.md` §4): the design uses it and `architecture.md` §4 lists it. Anything else for a job this appendix covers, or anything it marks **by ADR**, is a one-way door: the owner's `new-dependency` question and an ADR at `project/designs/adr/<n>-<slug>.md` (`process/planning.md` §2) naming the question's id. Ask it `--kind one-way-door`, so `approve-plan` can cite it. A reviewer who finds a deviation with no ADR linked from `architecture.md` §4 records an Important finding citing this appendix (Doctrine: review, no gate). A default spends no innovation token (§14).

**Languages.** TypeScript first, everywhere it fits: the team knows it. Rust where performance is the point (systems, CLIs, hot paths). Ruby for the Rails monolith. Elixir for realtime. Python only for a component doing heavy AI or embeddings work. Go by ADR. Nothing obscure.

**By kind of project:**

| Kind of project | Stack | Host |
|---|---|---|
| Majestic monolith: API, web app and admin together, a fit for the Ruby ecosystem and ActiveAdmin | Rails 8, Postgres, Solid Queue, Hotwire, ActiveAdmin, Devise, Ahoy + Google Analytics, Noticed | Render |
| A tight, fast, stateless API | Next.js route handlers, serverless | Vercel |
| An API with server-side state and little admin | NestJS (TypeScript), Prisma (Drizzle acceptable, named in `architecture.md`), pg-boss for jobs, the host's cron for schedules | Render |
| A marketing or CMS-driven site | One repo: `/cms` (Sanity Studio) and `/www` (Next.js, ISR). Sanity is the CMS | Vercel |
| A mobile app | React Native + Expo (EAS Build, Submit, Update) | EAS, the app stores |
| Performance-critical code, systems, CLIs | Rust: `tokio`, `axum` for HTTP, `clap` for CLIs, `sqlx` for Postgres | by deploy target |
| Realtime | Phoenix LiveView; ActionCable on Solid Cable inside a Rails app when the realtime part is small | Fly (Phoenix); the Rails app's host |
| An AI or embeddings-heavy component | Python: FastAPI, `uv`, embeddings in Postgres with `pgvector` | Render |

**ISR sites have a stated staleness bound** (§5). A Sanity publish fires a signed webhook that revalidates the changed pages by tag, so a publish usually shows within seconds. Every ISR page also sets a time-based `revalidate` of 15 minutes, the sweep that covers a lost webhook; never rely on the webhook alone. The bound when a webhook is lost: the page goes stale 15 minutes after it was built, the first visit after that still gets the old page and starts the rebuild, and the visit after gets the new one. On a quiet page that can be hours; the webhook is what makes publishes fast.

**Data and infrastructure.** Postgres always, the version pinned (`L-ERG-3`). Queues in Postgres (Solid Queue, pg-boss); caches in process (a bounded LRU) or in Postgres (Solid Cache). No Redis, and no Supabase: each by ADR, when a project clearly gains from it.
- **Search:** Postgres full-text search, `pg_trgm` and `pgvector`. `architecture.md` states the trigger that would outgrow them (a corpus size, a query latency, a feature Postgres lacks). A search engine only by ADR, once that trigger is hit.
- **CDN:** Bunny CDN in front of static assets and public pages off Vercel (Rails `asset_host` on Render), the cheapest; Cloudflare is acceptable without an ADR. On Vercel, Vercel's edge serves the app's own pages and build assets.
- **Files:** Bunny Storage, through its S3-compatible API, the cheapest. Turn S3 on when the storage zone is created (it can't be added later) and pick a region that has an S3 endpoint; set `Cache-Control` and CORS on the pull zone, not on the objects. Cloudflare R2, or the host's own blob store (Vercel Blob), is acceptable without an ADR. The app reaches the store through one adapter, an injected effect (§6).
- **Sanity's assets go through Bunny CDN.** A Bunny pull zone sits in front of `cdn.sanity.io`, image API included, and every Sanity image and file URL the site renders points at it (`@sanity/image-url`'s `baseUrl`). The zone caches by the full query string and varies on image-format support, or every size and format collapses into the first one cached. On Next.js, the Sanity image component passes `next/image` a `loader` prop that builds that URL (`L-FE-3`); never the global `images.loaderFile`, which would send the app's own images there too. Vercel's image optimizer never touches a Sanity asset, and Sanity's bandwidth is paid only on a cache miss.

**`Cache-Control` defaults.** Fingerprinted assets: `public, max-age=31536000, immutable`. Any response for a signed-in user, or one that sets a cookie: `private, no-store`. ISR and other public HTML: what the framework sets (`s-maxage` with `stale-while-revalidate`). Nothing personal is ever cached publicly.

**Auth** (§10). Server-side sessions in Postgres behind a locked-down cookie (`L-SEC-10`, `L-SEC-11`): Devise on Rails, Better Auth on TypeScript. Auth.js is acceptable without an ADR, with database sessions only: its database adapter, `session.strategy: "database"`, and no Credentials provider (Credentials forces JWT sessions, so email and password means Better Auth). A product with a mobile app uses Better Auth, for its Expo client (§10, the session's life). Never roll your own; no JWT sessions.

**Vendors every project has.**
- **Sentry** for exceptions, on the server, in the browser and in the app: releases tagged, source maps uploaded, `sendDefaultPii: false`, the trace id attached (`L-OBS-2`).
- **Google Analytics** (GA4), always, at least.
- **Ready for Meta ads.** The Meta Pixel and Conversions API subscribers are built from day one and stay off until their ids are in config. The conversions (sign-up, lead, purchase, and any the product adds) are named once, in the bus's event catalogue, each mapped to a GA key event and a Meta standard event (`CompleteRegistration`, `Lead`, `Purchase`).

**Vendors when the job needs them.**
- **Resend** sends email, with SPF, DKIM and DMARC on the sending domain. Templates owe nothing to Resend: React Email in TypeScript, Action Mailer views in Rails. Changing the sender changes only its subscriber.
- **Payments: Shopify or Stripe.** Shopify when a project sells physical goods shipped from a warehouse: Shopify holds the catalogue, checkout and fulfilment. Stripe for every other payment: hosted Checkout and Billing, so card data never touches our servers. Either one is called through one adapter as an injected effect (§6); its webhooks are checked by signature and handled idempotently by event id (Stripe's `event.id`, Shopify's `X-Shopify-Webhook-Id` header; `L-IDEM-1`, `L-EFFECT-2`); money is Tier A (§4).

A vendor's account and keys are the owner's to give (an owner action), asked for up front. A signal vendor is a subscriber of the bus, never called from anywhere else (`L-OBS-4`).

**Notifications, modelled once.**
- A notification has a **subject**, its category (`order-shipped`, `security-new-sign-in`), declared once in a catalogue in code with its default for each channel and whether it is transactional.
- It is delivered per **channel**: email (Resend), push (Expo's push service), in-app (a `notifications` table), SMS (vendor by ADR).
- **Preferences are ours:** a table of (user, subject, channel, enabled), a row only where the user changed the default; otherwise the catalogue's default applies.
- **Transactional and security subjects can't be turned off** (a receipt, a password reset, a new sign-in, a legal notice). Every other email carries one-click unsubscribe (`List-Unsubscribe` with `List-Unsubscribe-Post`, RFC 8058).
- A durable bus subscriber of the domain event delivers it, idempotent by (event, user, channel). On Rails, a Noticed notifier is a subject and its delivery methods are channels; each delivery method's `if:` checks the preference.

**APIs.**
- **Errors are Problem Details** (RFC 9457): `Content-Type: application/problem+json` with `type` (a URI per kind of error, documented), `title`, `status`, `detail` and `instance`; field errors in an `errors` member. Each typed expected error (`L-LOGIC-3`) maps to one `type` in the shell. A crash (§3, category 3) returns a plain 500 problem with the trace id and nothing of the internals.
- **Versioned in the path, `/v1/`,** for any API another app or party calls. An additive change (a new field, endpoint or optional parameter) never bumps the version, and clients ignore fields they don't know. A removal or narrowing is `/v2/` beside `/v1/`, and a one-way door (`constitution.md` §4). Routes only the app's own pages call (Hotwire, server actions) aren't versioned.

**AI, with no vendor.** No model provider is a default, and nothing here prefers one. Code calls models through a standard chat-completions-style API, behind one adapter (an injected effect, §6), with the provider, model and base URL in config, so a project can switch providers, or run against local inference, without a code change. TypeScript uses the Vercel AI SDK (`@ai-sdk/openai-compatible` takes any base URL), or OpenRouter or another gateway. Embeddings live in Postgres with `pgvector`. Heavy AI or embeddings work may be a Python component (FastAPI, `uv`). Which provider a project uses is the owner's, like any vendor's account and keys.

**Feature flags and CI.**
- **Flags are typed config** (`feature_<x>`, §10's config doctrine), with no vendor. A flag vendor only by ADR.
- **GitHub Actions runs every gate.** The host only builds and deploys; it runs no gate of ours, and a build that fails there is a gap in CI (`quality.md` §2).

**Testing and frontend.** TypeScript: ESLint + Prettier for lint and format, Vitest for unit tests, Playwright end-to-end, axe run inside Playwright (`L-FE-1`); React Native: `jest-expo` and Maestro (Appendix B). Accessibility is WCAG 2.2 AA: axe at zero violations (`L-FE-1`), the rest by manual review. Lighthouse CI on every UI (`L-FE-2`), on its default mobile emulation (no desktop preset), fails under 0.9 in any of its four categories (performance, accessibility, best practices, SEO), or over LCP 2.5 s, CLS 0.1 or TBT 200 ms. TBT is the lab stand-in for INP, which only the field measures. In the field the Core Web Vitals targets are LCP under 2.5 s, CLS under 0.1 and INP under 200 ms, monitored and alerted (`L-FE-2`). On the web, Tailwind CSS with shadcn/ui components. JSON-LD on content pages and i18n from day one (§13).
