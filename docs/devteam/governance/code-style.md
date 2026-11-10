# Code & System Doctrine

A generic, portable engineering doctrine for building any system — frontend, backend, services, IoT — in any stack (Rails, Next.js, Phoenix, Rust, Go, TypeScript), by human or AI-agent developers. Its purpose is to remove choices: a builder should rarely face a hard judgment call, because the decision is already made and, wherever possible, enforced by a gate rather than a reviewer.

> **The lint/gate configuration is the source of truth; this document is its commentary.** Where the two disagree, the gate config is right and this doc is a bug. Every rule marked **Law** has an ID (e.g. `L-STRUCT-2`) used by the gate config and by the escape hatch (§16).

A Law is enforced only once its gate is commissioned: it needs a row in [`quality.md`](quality.md) §2 and an entry in `settings.gates`. Until then it is reviewed as Doctrine.

## 0. How to read this

- **Law** — must; stated so a linter/type-checker/CI gate enforces it. A rule that *can* be a gate *must* be a gate. Each carries an ID.
- **Doctrine** — should; enforced by review judgment where a gate can't carry it.
- **Binding** — the per-stack translation (Appendix B). **The binding is the resolved answer**: an agent follows its stack's binding and never has to resolve "doctrine vs framework convention" at runtime.
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
- **Doctrine — define "healthy" and alert on it** — a lightweight per-surface SLO (latency/availability/correctness); no formal error-budget-freeze policy for a standard product.
- **Doctrine — disciplined log levels** (error = needs a human; warn = degraded; info = a business event; debug = off in prod).

## 10. Security — a priority, not a pass

- **`L-SEC-1` zero-trust, least privilege** — every call between components carries its own credential; the data's owner checks the caller's scope; nothing inherits trust from being "inside."
- **`L-SEC-2` never fail open** — a failed authorization/safety check denies; fail-open is owner-only.
- **`L-SEC-3` config & secrets in one module, parsed once at boot** — all `process.env`/`ENV[]`/`os.Getenv` reads centralized (ESLint `no-process-env`, a cop); secrets never in code/logs/events, short-lived/rotated where the platform allows; TLS in transit everywhere (mTLS only where the deployment/threat model needs it — Appendix C).
- **`L-SEC-4` input parsed + bounded at the boundary** (§3, §8); **rate-limited/quota'd at every external boundary.**
- **AI-native security (first-class — the product uses models and agents write the code):** `L-SEC-5` treat every model output as untrusted input; guard the **lethal trifecta** (never let untrusted content + private-data access + an exfiltration path coexist on one path — Willison, 2025); sandbox tool/agent capabilities to least privilege; **for AI features, tests are evals** (an eval harness with thresholds), not `assert ==`.
- **Supply chain:** prefer stdlib/a small local helper over a micro-dependency; `L-SEC-6` pin + lockfile + a **dependency cooldown** (7-day minimum release age, advisories override — post-2025-npm-worm standard; pnpm 11 defaults it on); `L-SEC-7` the vetting checklist fires only when a **new top-level dependency** appears (bumps go through cooldown + advisory, not the checklist); `L-SEC-8` gitleaks + frozen-lockfile install in CI. An SBOM is Law only if CI emits it with zero human steps, else Appendix C. Signed/attested SLSA provenance → Appendix C.
- **Secret storage — encrypted and checked in.** Secrets live in the repo, encrypted with the framework's standard tool: Rails credentials per environment (`config/credentials/<env>.yml.enc`) for Rails; SOPS with age everywhere else; the platform's native form (sealed secrets, the host's secret store) only where the deploy target requires it. The decryption key is the only thing outside git, one per environment: locally a gitignored key file that `worktree_files` copies into worktrees (development and test keys only), in CI and production the platform's secret store. No plaintext secret is ever committed (`L-SEC-8`).
- **Secrets and agents.** Agents work with development and test keys. Workers read secrets only through the encrypted store; they never receive a value directly. The owner posts a value through an owner-action question that names where it goes (`process/supervisor.md`, owner actions); devteam pipes it there from the owner's own process and logs only the name, so it never passes through the supervisor's context. A production secret goes anywhere only on the owner's question, with its decryption key in the owner's shell, never in a key file on disk or one that `worktree_files` copies.
- **Sensors use the access the project already has.** A production sensor reads through a CLI already logged in on the supervisor's machine (the one production migrations use) or a credential read from the encrypted store into the probe's environment, never argv, never printed (`process/supervisor.md`, Monitoring). Use a read-only token where the tool offers one; a token that can write is kept to reading by probes being reviewed code that only read (`quality.md` §3), and a production write is a remediation on its own ladder class (`process/supervisor.md`, Monitoring: no owner approval is needed for a sensor, because a sensor only reads). Everything a probe prints is redacted of those credentials and scrubbed of personal data (typed placeholders; the owner adds patterns in `sensor_scrub`) before it is stored, and production text reaches an agent only framed as untrusted data (`L-SEC-5`). A probe runs as this user and can read what this user can, so nothing here isolates one sensor's credential from another probe's code.
- **Doctrine — lightweight threat modeling** of the risky/sensitive features (auth, payments, PII, agent-driven paths), not of every feature.
- **Doctrine — security headers / CSP defaults** per OWASP ASVS 5.0 (2025).

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

- **`L-FE-1` accessibility gate: axe-core zero violations in CI** — honest about scope (automated checks catch a minority, ~57% by volume); **manual WCAG review is Doctrine** for the rest.
- **`L-FE-2` lab performance budgets in CI** (Lighthouse CI: LCP/CLS/TBT). Field Core Web Vitals (INP, field-only since 2024) are **monitored + alerted**, not CI-enforced.
- **Doctrine — separate server state from client state** (server state is fetched/cached, not "owned" by the client); optimistic UI + reconciliation; error boundaries + graceful UI degradation; progressive enhancement. Client-state time-travel lives here and only here.
- The TS `AbortSignal` of §8 threads through the client's data layer for cancellation.

## 14. Architecture defaults — what NOT to do (Doctrine)

- **Modular monolith first** — split a service out only at a *proven* boundary (independent scale/deploy you actually need). Premature microservices buy the distributed-systems tax for nothing.
- **Boring-technology budget: three innovation tokens, listed in an ADR**; everything else boring, proven, few dependencies.
- **No premature generality** — build for the cases you have; don't frameworkize ahead of a second real caller.

## 15. Agent ergonomics — the meta-rule

The doctrine removes choices only to the extent it is **decisive** (one way per thing), **machine-checked** (a gate, not prose), and **templated**.

- **`L-ERG-1` size/complexity = the linter's defaults** (RuboCop `Metrics/*`, ESLint `complexity: 10`/`max-lines: 300`, clippy `too_many_lines`, gocyclo 15). "Defaults" is the no-choice answer.
- **Make it a gate, not a guideline.** Anything a linter/type-checker/CI can enforce, must be.
- **`L-ERG-3` one toolchain, declared in `.tool-versions`.** asdf is the version manager. Every runtime and CLI the repo needs (`nodejs`, `ruby`, `python`, `postgres`, …) is pinned to an exact version in a root `.tool-versions`, so a builder, an agent's worktree and CI all run the same versions with no guessing. CI reads it (`asdf-vm/actions`, or a setup action's `*-version-file: .tool-versions`) instead of repeating versions; `.nvmrc`/`.ruby-version` only mirror it where a tool can't read it. Gate: CI fails when `.tool-versions` is missing, or a runtime the repo uses isn't in it.
- **`L-ERG-2` autofix-first** — every gate that can autofix runs in `--fix` (Biome/oxlint, `ruff --fix`, `rubocop -a`, `clippy --fix`) before it fails, to save builder/agent tokens and time.
- **One template per repetitive shape** — command/service object, event, projection, typed error — so the builder fills a skeleton, not invents structure.
- **Self-documenting names; comment the *why*.** An ADR records a decision.

## 16. The escape hatch

**`L-ESC-1` the only sanctioned way to suppress a gate is `// doctrine-exception(<rule-id>): <reason>`** (adapted to the stack's comment syntax). A CI gate counts them and lists them on the PR; a **bare `eslint-disable`/`rubocop:disable`/`#[allow]` fails CI.** Every Law has an ID (§0) for exactly this. An exception is a visible, reviewed, counted decision — never a silent workaround.

## 17. Day-one floor vs escalation triggers

To protect speed, a new system ships on the **floor**, not the full doctrine:

**Floor (every project, day one):** the framework skeleton · `domain/` with pure functions + result values · parse-at-the-edge (one schema lib per binding) · typed errors (typed stacks) · an outbox *table* · a `.tool-versions` (`L-ERG-3`) · the lint gates of Appendix A.

**Turn on when its trigger fires:**

| Mechanism | Escalation trigger |
|---|---|
| A published event bus + relay | the first real cross-component event consumer |
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

Doctrine (judgment; no gate): tier assignment, the critical-operation list, degraded-mode design, retry budgets / circuit breakers / backpressure, threat-model depth, SLO targets, convention-over-configuration, modular-monolith-first, boring-tech budget, backup-restore drill, server/client-state split, property/mutation testing scope.

## Appendix B — Per-stack bindings (the resolved answer; one choice each)

- **Rails:** core in `app/domain/`; models associations/scopes only, no callbacks except the `after_commit` outbox relay; commands `Command.call` returning a result value; `dry-schema`/`dry-struct` at the controller edge (not strong params / `params.expect` alone, which don't parse); shape/integrity validations that mirror DB constraints may stay on the model, domain rules live in the command's parse; `L-LOGIC-3`/`5` are Doctrine (error-arm tests the proxy); `Ecto.Multi`-equivalent transaction + `after_commit` relay for the outbox. **Framework control flow (never caught):** `RecordNotFound`→`rescue_from`, `redirect_to`/`head`.
- **Next.js:** core in `src/domain/`; server actions/components are the shell; `zod` at the boundary + branded types; named exports, `erasableSyntaxOnly: true`; server-state via the data layer, client-state local; thread `AbortSignal`. Outbox relay = one named durable job runner. **Framework control flow (never caught):** `redirect()`, `notFound()`.
- **Phoenix/Elixir:** contexts are the core; `{:ok,_}`/`{:error,_}` + `with`; `Ecto.Multi` outbox; native exhaustiveness; `FallbackController` for `{:error, _}`. **Framework control flow:** `Plug` `halt`, `Ecto` `*!` raises caught only at the context edge.
- **Rust:** `Result<T,E>` + a typed error enum; newtypes; clippy `wildcard_enum_match_arm` on `domain/` (do **not** use `#[non_exhaustive]` on app enums); effects behind traits; IoT outbox = SQLite WAL.
- **Go:** `(T,error)` + typed/wrapped errors; small interfaces for effects; packages as the boundary; `context.Context` for deadlines (`noctx`).
- **TypeScript (shared):** discriminated-union results + `assertNever`; `zod` (one lib) at the boundary; named exports (`import/no-default-export`); `AbortSignal` for cancellation/timeouts.

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
