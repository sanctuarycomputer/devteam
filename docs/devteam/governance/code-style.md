# Code & System Doctrine

A generic, portable engineering doctrine for building any system — frontend, backend, services, IoT — in any stack (Rails, Next.js, Phoenix, Rust, Go, TypeScript), by human or AI-agent developers. Its purpose is to remove choices: a builder should rarely face a hard judgment call, because the decision is already made and, wherever possible, enforced by a gate rather than a reviewer.

> **The lint/gate configuration is the source of truth; this document is its commentary.** Where the two disagree, the gate config is right and this doc is a bug. Every rule marked **Law** has an ID (e.g. `L-STRUCT-2`) used by the gate config and by the escape hatch (§16).

A Law is enforced only once its gate is commissioned: it needs a row in [`quality.md`](quality.md) §2 and an entry in `settings.gates`. Until then it is reviewed as Doctrine.

## 0. How to read this

- **Law** — must; stated so a linter/type-checker/CI gate enforces it. A rule that *can* be a gate *must* be a gate. Each carries an ID.
- **Doctrine** — should; enforced by review judgment where a gate can't carry it.
- **Binding** — the per-stack translation (Appendix B). **The binding is the resolved answer**: an agent follows its stack's binding and never has to resolve "doctrine vs framework convention" at runtime.
- **Project settings** — the few per-project decisions: the persistence-tier assignment and whether the product is multi-tenant (§4), the "critical operation" list (§7), the retention windows and the PII-erasure mechanism (§11). This file states the *rule*; a project states its *assignments* in `project/settings.md`.

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
- **CRUD ↔ command rule (decided, so it's not a per-case choice).** The HTTP surface is CRUD over resources; a state transition is a sub-resource create (`POST /orders/:id/cancellation`), and behind each action is exactly one command module (`CancelOrder.call`). The sub-resource is the transition row of `L-DATA-4` (the `POST` inserts the `OrderCancellation`); a bare flag with no actor, reason or payload, that happens at most once, is a `PATCH` of the parent. Reach past CRUD only when no resource shape expresses the operation.

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
  - **Doctrine — a lifecycle is a closed sum type.** Each state holds only its own fields: no combinations of boolean flags, no column that is null "except in state X". A state changes only through a named transition function (`cancel(order, reason)`), never by setting a field. The database backs it up with check and unique constraints. `L-LOGIC-5` makes every match over the states exhaustive; the rest is review-enforced.
- **`L-MONEY-1` money is `(amount_minor, currency)`** — an int64 count of the currency's minor unit plus its ISO 4217 code, built and combined only through one `Money` module. No floats, ever. Adding two currencies is a typed error, not a conversion. A split uses largest remainder so the parts sum to the whole. Every rounding names its mode at the call (`half_even`, `half_up`). An exchange rate is a `numeric` (not a minor-unit integer), stored with the instant it was quoted. The minor-unit exponent comes from the ISO 4217 table, not an assumed 2. Gate: none ships; review-enforced (a project can ban float columns named `*amount*`/`*price*` in a schema test).

## 4. Persistence — three tiers

Default to the simplest; escalate only with a stated reason (an ADR for Tier A).

- **Tier C (default) — CRUD + audit columns + tombstone delete.** `created_at`/`updated_at`/`created_by`. Most data is Tier C.
- **Tier B — append-only log + current-state projection.** For data whose history matters. **Permissions/authorization default here** (an append-only audit table satisfies nearly every regulator). A transition that repeats on one parent (a ticket reopened and closed again) is a history, so its rows are Tier B.
- **Tier A (exception, ADR-gated) — event sourcing + projections.** Reserved for **money and legally-disputed records only**; any other domain needs an ADR to justify it ("event sourcing is not a top-level architecture" — Greg Young).
- **`L-DATA-1` a delete goes through the tombstone helper.** `DELETE` runs only inside one helper that, in the same transaction, copies the row and its restricted children into one `deleted_records` table (`table_name`, `record_id`, `tenant_id`, `snapshot jsonb`, `deleted_by`, `reason`, `deleted_at`) and then deletes them. Foreign keys are `ON DELETE RESTRICT`: no cascades, so the helper names every child it removes. Live tables carry no `deleted_at` (except the restore case below), so queries and unique indexes stay plain. The database enforces RESTRICT; the "only through the helper" part is review-enforced until the project adds a lint rule banning raw deletes outside it.
  - **Soft delete only where users restore things** (a trash can, drafts). There the row keeps a `deleted_at` column (the partial unique index needs it in the row), with the actor and reason in a `Deletion` transition row beside it (`L-DATA-4`); the default scope excludes it, unique indexes are partial (`WHERE deleted_at IS NULL`), and restoring is another transition. Anywhere else, tombstone.
  - **A snapshot holds personal data**, so it is listed in the PII registry like any column (`L-PII-1`) and copies each PII field as the live row stored it: ciphertext under that field's own subject key, never re-encrypted as one blob. A row can hold several people's data; shredding any one subject's key then erases their fields in the snapshot too (`L-PII-4`). `tenant_id` is null in a single-tenant product.
  - **A takedown is not a delete.** Hiding content for a legal or moderation reason is a `hidden` (or `legal_hold`) transition row with its actor and reason; the record stays, the default scope hides it, and lifting it is another transition. A record under legal hold is not tombstoned or purged by retention until the hold lifts.
- **`L-DATA-2` forward-only, rollback-safe migrations** — a non-rollback-safe migration is flagged as a one-way door and minimized.
- **`L-DATA-3` event/row shapes are forever** — a shipped Tier A/B shape is never mutated; evolve by versioning + upcasting. (Shape is forever; *rows* live by the retention policy, §11 — no contradiction.)
- **`L-DATA-4` a state change is a row; status is derived.** A transition that has an actor, a reason or a payload, or that can happen more than once, is a row owned by its parent: `OrderCancellation belongs_to :order`. When it happens at most once, a unique index on `order_id` enforces that (not a check in code); when it recurs, its rows are a Tier B history. The parent's status is computed from its transition rows as a closed sum type (§3), or kept in a denormalised column written only inside the transition's own transaction. A bare status column is only for a flag with no actor, reason or payload. Review-enforced; the unique index is the database's.
- **`L-DATA-5` expand → backfill → contract.** A change to a live column or table ships as three PRs: expand (add the new shape, write both), backfill (a batched, resumable, idempotent job, never one long `UPDATE`), contract (drop the old shape once nothing reads it). Never rename a live column or table: add, copy, drop. DDL sets a `lock_timeout` (the migration runner's config, e.g. `StrongMigrations.lock_timeout`, or the SQL migration's own `SET lock_timeout`); indexes on live tables are `CREATE INDEX CONCURRENTLY`. Gate: strong_migrations (Rails) or squawk (plain SQL migrations) catches the unsafe DDL; the three-PR split is review-enforced.
- **`L-TENANT-1` tenant isolation (multi-tenant products only).** Every tenant-owned table has `tenant_id NOT NULL`; it is the first column of every unique index; foreign keys between tenant tables are composite (`(tenant_id, parent_id)` → the parent's unique `(tenant_id, id)`), so a row can't point into another tenant. Code reaches tenant data only through a per-request tenant handle: the ORM scope plus Postgres row-level security, the tenant set with `set_config('app.tenant_id', $1, true)` (that is `SET LOCAL`) at the start of each transaction, never a session-level `SET`, which leaks across pooled connections. Policies read `current_setting('app.tenant_id', true)`, so an unset tenant matches no rows. The app connects as a role that is not the tables' owner and has no `BYPASSRLS`, and tables use `FORCE ROW LEVEL SECURITY`. Code that crosses tenants lives in one admin module with its own role. The database enforces the policies once they exist; that every tenant table has one is review-enforced, or a schema test the project writes (`relrowsecurity` and `relforcerowsecurity` true on every table with a `tenant_id`).
- **Doctrine — search in Postgres first.** Full-text search (`tsvector`) and `pg_trgm` until a stated trigger fires (a measured latency, a ranking need Postgres can't meet). Then a search index is a projection: rebuilt from the write model, never written to directly, with its staleness stated (§5).
- **Doctrine — files in object storage.** The blob lives under a UUIDv7 key with a tenant prefix (`<tenant>/<uuid>`); a database row holds its metadata and is the truth. Uploads go direct with a presigned URL; the server checks the stored object's content type and size before the row is marked usable. A retention job deletes the blob after its row is tombstoned (and erasure deletes it at once, `L-PII-4`).
- **Project settings** — each domain's tier; whether the product is multi-tenant.

## 5. State, consistency, time

- **Doctrine — server-side time-travel is the audit log + projections**, not a product feature; a replay/debugger UI is a separate UI treatment, out of scope here.
- **`L-STATE-1` client-state tools stay on the client** — Redux-style time-travel is a *frontend* concern (§13), never the server's persistence model.
- **Doctrine — consistency is a contract** — any read from a projection/cache is eventually consistent and states its staleness bound where exposed; no read-after-write assumption unless promised.
- **`L-STATE-2` clock & ordering discipline** — never order across processes/nodes by wall-clock; monotonic clock for elapsed/timeouts, a logical/sequence value for ordering; wall clock for display/stamps only. (Clocks are injected — §6.)
- **`L-STATE-3` no missed state.** Anything that consumes a stream of changes (an outbox relay, a sync, an integration import, a projection) reads an ordered log by a durable cursor over a monotonic sequence (a `bigint` position column; the UUIDv7 id only breaks ties). Never poll by `updated_at` (ties and clock skew drop rows) and never page by `OFFSET` (inserts shift the pages). Advance the cursor in the same transaction as the effect, or after an idempotent handler has run, so a crash replays rather than skips.
  - **Guard commit order.** Sequence values are handed out when a row is inserted, but transactions commit in any order: a reader can see row 12 committed while row 11's transaction is still open, move its cursor past 11, and never see it. So read only up to a safe watermark. The exact one: stamp each row with `pg_current_xact_id()` (an `xid8` column), read rows whose xid is below `pg_snapshot_xmin(pg_current_snapshot())`, and order the cursor by `(xid, position)`; every transaction below that line has finished. Simpler where they fit: one writer transaction at a time per stream, or writers serialised by a transaction advisory lock taken before the sequence value is drawn. A lag window ("only rows older than 5 s") is a heuristic that a long transaction defeats; don't rely on it alone. A relay that claims unsent rows (`FOR UPDATE SKIP LOCKED`, then marks them sent) keeps no cursor and has no gap; where order matters it runs one claimer per stream, else consumers rely on the aggregate version (`L-DIST-1`).
  - **List APIs page by keyset.** A response is `{data, next_cursor}`, the cursor opaque and built from the sort key plus the id; `OFFSET` pages only in admin UIs. Review-enforced throughout.
- **`L-TIME-1` time has one storage rule.** An instant is UTC `timestamptz`. A future civil time (an appointment, a 9 am reminder) stores the wall time plus its IANA zone (`Europe/Berlin`), because zone rules change before it arrives; compute the instant when it's needed. A calendar date is a `date`, not a midnight timestamp. The database session runs in UTC. Convert to the viewer's zone only at the edge. Review-enforced.
- **Doctrine — a cache entry is a projection.** Keys are versioned and built from the inputs (`name:v<n>:<tenant>:<id>:<version>`), so a change makes a new key rather than a purge. Every entry has a TTL with jitter. Hot keys coalesce requests (one fill, the rest wait). A result that depends on who is asking has the principal in its key. Caching lives in the shell, never in `domain/`. An authenticated HTTP response defaults to `Cache-Control: private, no-store`. Start with an in-process LRU; a shared cache store (Redis or another) needs an ADR and the owner's one-way-door answer (§14).

## 6. Effects, the bus, dependency injection

- **DI of effects** — the core receives a capabilities record (clock, id, randomness, DB, HTTP, bus, cancellation signal), passed in, never imported.
- **`L-EFFECT-1` determinism in `domain/`** — no wall-clock read, no `uuid`/random, no ambient global in the core; all injected. Gate: ESLint `no-restricted-globals`/`no-restricted-syntax`, clippy `disallowed_methods`, golangci `forbidigo`, a RuboCop cop — scoped to `domain/`.
- **One id scheme: UUIDv7** (RFC 9562; time-ordered, native in Postgres 18) — the injected id generator returns it. No per-feature id choice.
- **Two separate channels — do not conflate them:**
  - **Domain events** → the **transactional outbox**: written in the *same* DB transaction as the state change, published by a relay, **at-least-once ⇒ `L-EFFECT-2` every handler is idempotent**. Binding names the relay (Next: a durable job runner — one, named in the binding; Rust/IoT: a local durable queue, SQLite WAL).
  - **Telemetry** (logs, metrics, exceptions, analytics) → **fire-and-forget, best-effort, never in a DB transaction.** This is where a §3-cat-3 crash is routed and where §9's wide events go.
- **`L-EFFECT-3` no ambient output outside the shell** — ban `console.*`/`puts`/`fmt.Println` in `domain/` (ESLint `no-console`, RuboCop `Rails/Output`, `forbidigo`); the core emits through the injected bus.
- **Postgres is the job queue, in the application's database** (Rails: Solid Queue, schedules from its recurring tasks; TypeScript: pg-boss, schedules enqueued by the platform's cron). No Redis by default: a second store needs an ADR and the owner's answer, because a new datastore is a one-way door (constitution §4).
- **`L-JOB-1` jobs carry ids, not state.** A job's arguments are ids (and an idempotency key where `L-IDEM-1` applies), never a copy of the record; the handler re-reads and applies a conditional write (§7). Enqueue inside the write's own transaction, never from `domain/`: the queue lives in the same database (§14), so the job commits or rolls back with the write: the job row plays the outbox's role for that job. Domain events still go through the outbox table (§6) so the relay can fan out. A queue in any other store is fed only by the relay from an outbox row. A bare enqueue after commit is lossy (a crash between commit and enqueue drops the job) and is not used. Each job declares its max attempts and a deadline it honours through `L-RESIL-1`'s outbound timeouts (plus the runner's own expiry where it has one, e.g. pg-boss `expireInSeconds`); a job out of attempts lands in a dead set that alerts (`L-OBS-1`). The runner's uniqueness option is a hint; the handler dedups. Review-enforced.
- **`L-HOOK-1` a webhook is never the only way a change arrives.** Every inbound webhook endpoint (a payment provider, a CMS revalidation hook, any integration) has a reconciliation job that sweeps the source on a schedule for anything missed, by the source's cursor where it has one (`L-STATE-3`), else by its modified-since filter with an overlap window and an idempotent upsert. For a cache-invalidation hook the sweep is the entry's TTL (§5) or a periodic revalidation of what the hook covers. The webhook handler verifies the signature, dedups on the event id, and enqueues; it only makes things faster. Review-enforced: a webhook PR without its sweep is incomplete.

## 7. Idempotency

- **`L-IDEM-1` external side effects and money carry an idempotency key** end-to-end (the IETF `Idempotency-Key` header; Stripe's model), with a dedup store making a repeat a no-op returning the first result.
- **State transitions use a conditional write** — no key plumbing — unless the **project settings** list a specific transition as critical. The conditional write is the `INSERT` of the transition row (`L-DATA-4`) against its unique index: `INSERT … ON CONFLICT (order_id) DO NOTHING RETURNING id`, where no row back is the typed lost-race error (`AlreadyCancelled`). (A bare unique violation caught at the boundary means the same thing, but it aborts the whole Postgres transaction.) With `L-TENANT-1` the conflict target is `(tenant_id, order_id)`. When the transition's precondition depends on the parent's other transitions (cancel only while unshipped; a recurring reopen), the decision is made on the parent in the same transaction: `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status IN ('placed', 'paid')` on the denormalised status column of `L-DATA-4`, zero rows being the lost-race error, or `SELECT … FOR UPDATE` on the root (`L-CONC-1`). Outside those, `UPDATE … WHERE status = …` is the conditional write only where a flag column is the sole truth.
- **`L-IDEM-2` event handlers are idempotent** (from §6 at-least-once).
- **Retries (§8) are permitted only on idempotent calls.** An agent must not retry a non-idempotent POST.
- **`L-CONC-1` one decision, one lock.** Postgres defaults to READ COMMITTED, where reading a value, checking it in code and then writing races. So a decision is made by the database:
  - **Default: a conditional write** (above): a unique index, or a `WHERE` on the row being changed. Counters are `SET n = n + 1`, never read-add-write.
  - **When the decision spans rows,** `SELECT … FOR UPDATE` on the aggregate root only, taking several roots in id order (no deadlocks), and never holding the lock across a network call.
  - **A resource that isn't a row** (an external account, a file name) takes `pg_advisory_xact_lock` (transaction-scoped; session locks leak through connection poolers), with every key named in one registry module.
  - **A singleton or leader is a leased row** (`holder`, `lease_until` by the database's `now()`, a fencing token that goes up on each acquire and is checked on every write it guards), never "only one replica runs cron". Scheduled jobs need no lease: the queue's recurring tasks (Solid Queue dedups on `(task_key, run_at)`, which needs `preserve_finished_jobs` left on) or a dedup key make them single; the lease is for a long-running leader.
  - Review-enforced; the database does the deciding.

## 8. Resilience — crash-only, bounded, degrade gracefully

- **Crash-only recovery** — survive crash/restart via idempotent handlers + the outbox; state is recoverable from durable stores.
- **`L-RESIL-1` every outbound call has a timeout/deadline** (Go `noctx`/`context`; TS an `AbortSignal` threaded from the shell; Ruby central `Net::HTTP` timeouts), **`L-RESIL-2` a request body-size limit, and a pagination max.** (These are the enforceable slice of "everything bounded"; the broader "bound every loop" is Doctrine.)
- **`L-RESIL-3` retries use exponential backoff + jitter** (Brooker, AWS, "Exponential Backoff and Jitter", 2015). Retry *budgets*, circuit breakers, backpressure/load-shedding, and graceful-degradation modes are **Doctrine** (apply where a dependency is failure-prone or a queue exists).
- **Doctrine — a backup-restore drill** is run; "recoverable from durable stores" is unproven until a restore has been exercised.
- **`L-DIST-1` at-least-once plus an idempotent consumer is the only exactly-once.** Order is promised per aggregate id (consumers check the aggregate's version), never globally. Inside one database an operation across aggregates is one transaction. One that crosses a transaction boundary (an external side effect, another store, a service split under §14) is a chain of commands, each one a transition row (`L-DATA-4`) with a compensating command, plus a reconciler job that finds chains stuck midway and pushes them on or back. Every in-memory queue and buffer has a max depth and returns a typed `Overloaded` error when full; the durable tables (outbox, job queue) are watched by a depth alert (`L-OBS-1`), never bounded by refusing a write. Review-enforced.
- **`L-RATE-1` rate limits are a token bucket.** A token bucket (or GCRA) per (identity, route class), identity taken in order principal > API key > tenant > IP. Limits live in config (`L-SEC-3`). The limiter runs in the shell before the command and answers `429` with `Retry-After`; outbound clients honour a `429`'s `Retry-After`. By default the bucket is in-process, per replica, sized as the configured limit divided by a configured replica count (erring low under autoscaling). A shared limiter store (a Postgres row, or Redis under its ADR and owner answer) comes only when per-replica buckets are measured not to be enough; when it is down, each process falls back to that per-replica bucket: never unlimited, never deny-all. That is not failing open (`L-SEC-2`): every request is still limited, and the per-replica split keeps the total under the limit on the routes that guard a secret (login, one-time codes, password reset). Review-enforced.
- **Non-goal:** a saga framework or partition-tolerance machinery — `L-DIST-1`'s chain and reconciler are the whole of it; don't build for failure modes your deployment doesn't have.

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
- **`L-SEC-4` input parsed + bounded at the boundary** (§3, §8); **rate-limited/quota'd at every external boundary** (`L-RATE-1`).
- **AI-native security (first-class — the product uses models and agents write the code):** `L-SEC-5` treat every model output as untrusted input; guard the **lethal trifecta** (never let untrusted content + private-data access + an exfiltration path coexist on one path — Willison, 2025); sandbox tool/agent capabilities to least privilege; **for AI features, tests are evals** (an eval harness with thresholds), not `assert ==`.
- **Supply chain:** prefer stdlib/a small local helper over a micro-dependency; `L-SEC-6` pin + lockfile + a **dependency cooldown** (7-day minimum release age, advisories override — post-2025-npm-worm standard; pnpm 11 defaults it on); `L-SEC-7` the vetting checklist fires only when a **new top-level dependency** appears (bumps go through cooldown + advisory, not the checklist); `L-SEC-8` gitleaks (extending the kit's `gitleaks.toml`, `quality.md` Secrets) + frozen-lockfile install in CI. An SBOM is Law only if CI emits it with zero human steps, else Appendix C. Signed/attested SLSA provenance → Appendix C.
- **Secret storage — encrypted and checked in.** Secrets live in the repo, encrypted with the framework's standard tool: Rails credentials per environment (`config/credentials/<env>.yml.enc`) for Rails; SOPS with age everywhere else; the platform's native form (sealed secrets, the host's secret store) only where the deploy target requires it. The decryption key is the only thing outside git, one per environment: locally a gitignored key file that `worktree_files` copies into worktrees (development and test keys only), in CI and production the platform's secret store. No plaintext secret is ever committed (`L-SEC-8`).
- **Secrets and agents.** Agents work with development and test keys. Workers read secrets only through the encrypted store; they never receive a value directly. The owner posts a value through an owner-action question that names where it goes (`process/supervisor.md`, owner actions); devteam pipes it there from the owner's own process and logs only the name, so it never passes through the supervisor's context. A production secret goes anywhere only on the owner's question, with its decryption key in the owner's shell, never in a key file on disk or one that `worktree_files` copies.
- **Sensors use the access the project already has.** A production sensor reads through a CLI already logged in on the supervisor's machine (the one production migrations use) or a credential read from the encrypted store into the probe's environment, never argv, never printed (`process/supervisor.md`, Monitoring). Use a read-only token where the tool offers one; a token that can write is kept to reading by probes being reviewed code that only read (`quality.md` §3), and a production write is a remediation on its own ladder class (`process/supervisor.md`, Monitoring: no owner approval is needed for a sensor, because a sensor only reads). Everything a probe prints is redacted of those credentials and scrubbed of personal data (typed placeholders; the owner adds patterns in `sensor_scrub`) before it is stored, and production text reaches an agent only framed as untrusted data (`L-SEC-5`). A probe runs as this user and can read what this user can, so nothing here isolates one sensor's credential from another probe's code.
- **Doctrine — lightweight threat modeling** of the risky/sensitive features (auth, payments, PII, agent-driven paths), not of every feature.
- **Doctrine — security headers / CSP defaults** per OWASP ASVS 5.0 (2025).

## 11. PII & data lifecycle

- **`L-PII-1` every PII field is annotated in a registry** (a single file naming each PII column/field; a gate checks completeness), **encrypted at rest, and erasable.** The erasure **mechanism is a project settings** — crypto-shredding (a per-subject key; destroying it erases the subject from every immutable log) or a vault+tokens. (Crypto-shred keeps framework auth idioms — Devise/NextAuth/`phx.gen.auth` — intact; a central vault is for regulated/multi-store PII, Appendix C.)
- **`L-PII-2` data minimization + purpose limitation** — collect the least PII needed; bind each datum to its purpose.
- **`L-PII-3` retention/TTL** — immutable logs hold erasable-by-mechanism PII, so the log stays shape-immutable while PII is erased; the log itself carries a retention/compaction policy (**project settings** — the windows).
- **`L-PII-4` erasure reaches every copy, on a deadline.** An erasure request removes the subject's personal data from live rows, `deleted_records` snapshots (`L-DATA-1`), stored files (§4), logs and backups. The `L-PII-1` mechanism is what reaches the immutable copies: under crypto-shredding, destroying the subject's key erases them in every log, snapshot and backup at once, which is why snapshots keep each field under its own subject's key. Erasure runs as reviewed code (a job), never a hand-typed query, and is logged without the data it erased. It finishes within the legal deadline (GDPR: one month from the request). A record under a legal hold (§4) is the owner's call, not the job's. Review-enforced; `L-PII-1`'s registry gate is what keeps snapshots and new columns in scope.

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

- **Majestic (modular) monolith by default** — one deployable, one database, modules inside it. Split a service out only at a *proven* boundary (independent scale/deploy you actually need), with an ADR; one that adds a datastore, runtime or vendor is a one-way door (constitution §4). Premature microservices buy the distributed-systems tax for nothing.
- **One datastore by default: Postgres.** It is the database, the job queue (§6) and the search index (§4); caches are in-process (§5). Redis or any other store needs an ADR and the owner's one-way-door answer.
- **Boring-technology budget: three innovation tokens, listed in an ADR**; everything else boring, proven, few dependencies.
- **No premature generality** — build for the cases you have; don't frameworkize ahead of a second real caller.

## 15. Agent ergonomics — the meta-rule

The doctrine removes choices only to the extent it is **decisive** (one way per thing), **machine-checked** (a gate, not prose), and **templated**.

- **`L-ERG-1` size/complexity = the linter's defaults** (RuboCop `Metrics/*`, ESLint `complexity: 10`/`max-lines: 300`, clippy `too_many_lines`, gocyclo 15). "Defaults" is the no-choice answer.
- **Make it a gate, not a guideline.** Anything a linter/type-checker/CI can enforce, must be.
- **`L-ERG-3` one toolchain, declared in `.tool-versions`.** asdf is the version manager. Every runtime and CLI the repo needs (`nodejs`, `ruby`, `python`, `postgres`, …) is pinned to an exact version in a root `.tool-versions`, so a builder, an agent's worktree and CI all run the same versions with no guessing. CI reads it (`asdf-vm/actions`, or a setup action's `*-version-file: .tool-versions`) instead of repeating versions; `.nvmrc`/`.ruby-version` only mirror it where a tool can't read it. Gate: CI fails when `.tool-versions` is missing, or a runtime the repo uses isn't in it.
- **`L-ERG-2` autofix-first** — every gate that can autofix runs in `--fix` (Biome/oxlint, `ruff --fix`, `rubocop -a`, `clippy --fix`) before it fails, to save builder/agent tokens and time.
- **One template per repetitive shape** — command/service object, event, projection, typed error — so the builder fills a skeleton, not invents structure.
- **Self-documenting names; comment the *why*.** An ADR records a decision; it grants nothing. Where the decision is on constitution §4's one-way-door list (a new datastore, runtime, vendor or dependency; a new append-only or event-sourced shape; anything else listed there) the ADR cites the owner's answer, and without one it is a proposal.

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
| Tenant isolation (`L-TENANT-1`) | the product serves more than one tenant from one database |
| A shared cache or second store (Redis…) | an in-process cache measured not to be enough (ADR + owner answer) |
| A search index outside Postgres | the stated trigger of §4 (a projection, ADR) |

---

## Appendix A — Law (gate-enforced) vs Doctrine (review-enforced)

Each Law → a commissioned gate, autofix-first (§15) where possible, catalogued in [`quality.md`](quality.md) §2. IDs match the body.

- `L-STRUCT-1`..`4` core dir / skinny models (no non-relay callbacks) / one-concept-per-file named-exports / thin controllers (cyclo ≤3).
- `L-LOGIC-1`..`5` immutable inputs / result values / typed errors (typed stacks) / parse-at-edge / exhaustive matches (typed stacks). *(Ruby: `L-LOGIC-3`,`5` are Doctrine; proxy = `L-TEST-2`.)*
- `L-MONEY-1` money is (amount_minor, currency) via one module. *(Review-enforced.)*
- `L-DATA-1`..`5` deletes via the tombstone helper (RESTRICT FKs; DB-enforced) / forward-only+rollback-safe / shapes-forever / a state change is a row (review) / expand→backfill→contract (strong_migrations or squawk for the DDL; the split by review).
- `L-TENANT-1` tenant_id + RLS through a per-request handle (multi-tenant only; Postgres enforces the policies, coverage by a project schema test or review).
- `L-STATE-1`..`3` client-state-stays-client / no cross-node wall-clock ordering / ordered cursor + commit-order watermark, keyset pages (review).
- `L-TIME-1` UTC instants, wall time + zone for future civil times, `date` for dates. *(Review-enforced.)*
- `L-EFFECT-1`..`3` determinism in `domain/` / idempotent handlers / no ambient output in core.
- `L-JOB-1` jobs carry ids, enqueued inside the write's transaction (the outbox), attempts+deadline+dead set. *(Review-enforced.)*
- `L-HOOK-1` every inbound webhook has a reconciliation sweep. *(Review-enforced.)*
- `L-IDEM-1`,`2` idempotency key on external+money / idempotent handlers.
- `L-CONC-1` one decision, one lock: conditional write, root-only `FOR UPDATE`, registered advisory locks, leased singletons. *(Review-enforced.)*
- `L-RESIL-1`..`3` outbound timeout+AbortSignal / body-size + pagination max / backoff+jitter.
- `L-DIST-1` at-least-once + idempotent consumer, per-aggregate order, compensated chains + reconciler, bounded in-memory queues. *(Review-enforced.)*
- `L-RATE-1` token bucket per (identity, route class), 429 + Retry-After, per-replica bucket by default, shared store only when measured. *(Review-enforced.)*
- `L-OBS-1`..`3` wide events / trace id / PII-never-in-logs.
- `L-SEC-1`..`8` zero-trust scope check / no-fail-open / central config+secrets / bounded+rate-limited input / model-output-untrusted / pin+lockfile+cooldown / vet-on-new-dep / gitleaks+frozen-lockfile.
- `L-PII-1`..`4` PII registry complete + encrypted + erasable / minimization+purpose / retention policy present / erasure reaches every copy on the deadline (review).
- `L-TEST-1`..`6` per-change check / error-arm coverage / PR-touches-test-or-`no-test` + domain coverage / random order + empty quarantine / prod-shaped seeds / test state per checkout.
- `L-FE-1`,`2` axe-zero / Lighthouse lab budgets.
- `L-ERG-1`..`3` linter-default metrics / autofix-first / toolchain pinned in `.tool-versions` (asdf).
- `L-ESC-1` doctrine-exception is the only suppression; bare disables fail.

The Laws marked *review-enforced* have no off-the-shelf gate: a reviewer checks them, and a project that writes a gate for one (a custom cop, a schema test) commissions it as above.

Doctrine (judgment; no gate): tier assignment, lifecycle as a closed sum type, cache keys and TTLs, search-in-Postgres-first, files in object storage, one datastore by default, the critical-operation list, degraded-mode design, retry budgets / circuit breakers / backpressure, threat-model depth, SLO targets, convention-over-configuration, majestic-monolith-first, boring-tech budget, backup-restore drill, server/client-state split, property/mutation testing scope.

## Appendix B — Per-stack bindings (the resolved answer; one choice each)

- **Rails:** core in `app/domain/`; models associations/scopes only, no callbacks except the `after_commit` outbox relay; commands `Command.call` returning a result value; `dry-schema`/`dry-struct` at the controller edge (not strong params / `params.expect` alone, which don't parse); shape/integrity validations that mirror DB constraints may stay on the model, domain rules live in the command's parse; `L-LOGIC-3`/`5` are Doctrine (error-arm tests the proxy); `Ecto.Multi`-equivalent transaction + `after_commit` relay for the outbox. **Framework control flow (never caught):** `RecordNotFound`→`rescue_from`, `redirect_to`/`head`. **Data:** jobs on Solid Queue in the application's own database (no `connects_to` and no separate `queue` database, which the generator creates by default), with `enqueue_after_transaction_commit` false on `ApplicationJob` (Rails 8.0+; 7.2 takes `:never`) so the enqueue commits with the write; schedules as Solid Queue recurring tasks; strong_migrations as the migration gate; `ActiveRecord::ConnectionAdapters::PostgreSQLAdapter.datetime_type = :timestamptz`; deletes through a small `Tombstone.delete!(record, reason:, by:)` in the shell, no paranoia/discard gem (soft-delete scopes are hand-written where `L-DATA-1` allows them); foreign keys `on_delete: :restrict`, `has_many … dependent: :restrict_with_error`; the tenant handle (`L-TENANT-1`) is a shell transaction wrapper that runs `set_config('app.tenant_id', Current.tenant_id, true)` first.
- **Next.js:** core in `src/domain/`; server actions/components are the shell; `zod` at the boundary + branded types; named exports, `erasableSyntaxOnly: true`; server-state via the data layer, client-state local; thread `AbortSignal`. Outbox relay = one named durable job runner. **Framework control flow (never caught):** `redirect()`, `notFound()`.
- **Phoenix/Elixir:** contexts are the core; `{:ok,_}`/`{:error,_}` + `with`; `Ecto.Multi` outbox; native exhaustiveness; `FallbackController` for `{:error, _}`; jobs on Oban. **Framework control flow:** `Plug` `halt`, `Ecto` `*!` raises caught only at the context edge.
- **Rust:** `Result<T,E>` + a typed error enum; newtypes; clippy `wildcard_enum_match_arm` on `domain/` (do **not** use `#[non_exhaustive]` on app enums); effects behind traits; IoT outbox = SQLite WAL.
- **Go:** `(T,error)` + typed/wrapped errors; small interfaces for effects; packages as the boundary; `context.Context` for deadlines (`noctx`); jobs on River.
- **TypeScript (shared):** discriminated-union results + `assertNever`; `zod` (one lib) at the boundary; named exports (`import/no-default-export`); `AbortSignal` for cancellation/timeouts. **Data (Postgres):** jobs on pg-boss in the application's database, sent inside the write's transaction (pg-boss's `db` option bound to that transaction), schedules enqueued by the platform's cron with a dedup key; squawk on SQL migrations; Prisma relations set `onDelete: Restrict` explicitly; instants are `DateTime @db.Timestamptz` (Prisma's default `DateTime` has no zone); the tenant handle is a Prisma client extension that runs each operation in a transaction beginning `SELECT set_config('app.tenant_id', $1, true)`.

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
- **Saga frameworks / partition tolerance** → non-goal (crash-only); an operation that crosses a transaction boundary is `L-DIST-1`'s compensated chain + reconciler; inside one database it is one transaction.
- **Blanket soft delete (`deleted_at` on every table)** → tombstone into `deleted_records` (`L-DATA-1`); soft delete only where users restore.
- **Redis for queues and caches by default** → Postgres queue + in-process LRU; a second store by ADR and the owner's answer.
