# AI features

The few rules every AI feature follows, whatever the project. Most of an AI feature is project-specific: the model, the prompts, the eval cases and the threshold are the design's to choose. This file only fixes what keeps that choice open and checked.

Law and Doctrine mean what they mean in `code-style.md` §0; a Law is enforced once its gate is commissioned (the gate table below counts as rows of `quality.md` §2), and review holds it until then. The tools this file names for a job are the owner's choice for that job (`constitution.md` §4): using one needs no one-way-door question.

- **`L-AI-1` provider-agnostic.** Every model call goes through one adapter, an injected effect (`code-style.md` §6), speaking a standard chat-completions-style API (messages in, text, tool calls or structured output back). The provider, base URL and model id come from the typed config (`L-SEC-3`), the model id pinned as a checked-in default that the environment may override only outside production, so switching provider, or pointing at local inference (any server with an OpenAI-compatible endpoint), is a config change. Never build on a feature only one vendor has. The design names the capability it needs, not a vendor. The provider is a vendor, so picking it is the owner's one-way door (`constitution.md` §4), asked with a recommendation that weighs cost, quality and latency on the eval set, and never assumes one provider; its keys are an owner action. Gate: lint bans the provider SDKs outside the adapter (`no-restricted-imports`, or the stack's equivalent; lint gate).
- **The libraries.** TypeScript uses the Vercel AI SDK, or OpenRouter, behind that adapter. Any other gateway is a one-way door. Embeddings live in Postgres with `pgvector`, never a separate vector store (a new datastore is a one-way door, `constitution.md` §4). Python is allowed for a component doing heavy AI or embedding work, with its own toolchain pinned (`L-ERG-3`).
- **`L-AI-2` every AI feature has an eval set, and CI holds its threshold.** The cases are checked in beside the feature, with the threshold they must reach. An `evals` gate runs them against the configured model on every PR that changes the feature, its prompts or the pinned model id (a gate with `paths`, `quality.md` §2), and fails under the threshold. Changing the model is a PR that runs the evals. These are the feature's tests (`code-style.md` §10, AI-native security). Gate: `evals`.
- **`L-AI-3` prompts are versioned in the repo.** A prompt is a file or a constant in the code, changed by a PR like any code, never edited in a vendor's console. Each call carries the prompt's version (its file's hash, or a version constant). Review-enforced.
- **`L-AI-4` every call is measured.** Each model call emits one wide event (`L-OBS-1`) through the project's bus, on its telemetry channel (`code-style.md` §6), with the model id, the prompt version, input and output tokens, cost (from a per-model price table checked in beside the adapter) and latency. Prompt and completion text stay out of it unless redacted by the PII registry (`L-OBS-3`). Gate: a test of the adapter asserts the event's fields (test gate).
- **Model output is untrusted input** (`L-SEC-5`). Parse it with the boundary's schema before anything acts on it (`L-LOGIC-4`), give a tool-calling model the least privilege the job needs, and never let untrusted content, private data and a way out meet on one path.
- **Doctrine — bounded like any outbound call.** A model call has a timeout (`L-RESIL-1`), retries only when the call is idempotent (`code-style.md` §7, §8), and a stated fallback when the model is down or slow.

## Gates

| Gate | Fails on | Law |
|---|---|---|
| lint | a provider SDK imported outside the adapter | `L-AI-1` |
| evals | an AI feature's eval set under its threshold | `L-AI-2` |
| test | a model call's event missing a field | `L-AI-4` |
