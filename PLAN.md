# Seldon — Plan

An LLM-driven **prediction machine** inspired by Asimov's psychohistory. See
[`DESIGN.md`](./DESIGN.md) for the full architecture. This document is the
build roadmap: what we ship, in what order, and how we know each step is done.

## Decisions locked in

- **Language/runtime:** TypeScript on Node.js, **npm-workspaces monorepo**.
- **Framework extraction:** the virtual-agent runtime (`@seldon/vagents`) is a
  standalone package from day one, with no Seldon-specific knowledge.
- **LLM backend:** Azure OpenAI first, behind a thin `LLMProvider` abstraction so
  OpenAI/Ollama/etc. can slot in later.
- **Data:** JSON for structured records, Markdown for all prose.
- **Persistence:** runs are in-memory and **ephemeral** (predictions are
  hypothetical — not worth keeping); optional `--save`. Internet-sourced **facts
  are cached to disk** because they're reusable and costly.
- **Web grounding:** designed end-to-end now, shipped behind `--ground` with a
  **stub fetcher** in v1; real fetcher is a later phase.
- **Timeline:** every agent response carries a **future date**, so the shared
  context reads as a projected chronology.

## Guiding principles

- Bounded by design: hard caps on turns and total agents so a run can't run away.
- Framework-first: keep `@seldon/vagents` clean enough to reuse for other
  multi-agent deliberations, not just forecasting.
- Cheap to test: a `MockProvider` means the whole pipeline runs with no network
  or spend in CI.

---

## Milestones

### M0 — Scaffold & tooling
- [ ] Root `package.json` with npm workspaces; `tsconfig.base.json`.
- [ ] Packages created: `vagents`, `llm`, `grounding`, `engine`, `cli`.
- [ ] Dev tooling: `vitest`, `eslint`, `prettier`, `tsc` build; a `dev` script.
- [ ] CI-friendly `npm test` runs green (empty suites ok).
- **Done when:** `npm install && npm run build && npm test` succeed from a clean
  checkout.

### M1 — Generic virtual-agent runtime (`@seldon/vagents`)
- [ ] `Vagent`, `VagentContext`, `VagentHost`, `Runtime` types/impls.
- [ ] Turn loop with **post-barrier** effect application (all vagents see the same
      snapshot per turn).
- [ ] Bounded-concurrency scheduler (p-limit style).
- [ ] Cap enforcement (`maxTurns`, `maxVagents`) + deferred activation (spawn on
      turn N activates on N+1).
- [ ] Quiescence / empty-roster early stop via `host.isComplete`.
- [ ] Unit tests for all of the above (no LLM).
- **Done when:** runtime tests pass and the package has zero Seldon imports.

### M2 — LLM provider abstraction (`@seldon/llm`)
- [ ] `LLMProvider` interface + `CompleteOptions` (incl. `json` mode).
- [ ] `AzureOpenAIProvider` (config from env; JSON-mode support).
- [ ] `MockProvider` with scriptable, deterministic responses.
- [ ] Provider contract tests against fixtures.
- **Done when:** a smoke script completes one Azure call given real env vars, and
  Mock-based tests are green.

### M3 — Seldon engine (`@seldon/engine`) — the core loop
- [ ] Domain model (`Entity`, `Response`, `RunManifest`) + Zod schemas.
- [ ] `seed(question)` → initial entities (1 LLM call).
- [ ] `EntityVagent.takeTurn` producing the effect union
      (`AddResponse` / `NoResponse` / `Withdraw` / `SuggestEntities`) with
      **future-dated** Markdown responses + private memory notes.
- [ ] `EntityVagentHost`: snapshot builder (roster + timeline Markdown), effect
      application, nominee activation under `maxAgents`, dropped-nomination log.
- [ ] `summarise()` → Markdown forecast report.
- [ ] Malformed-output handling: Zod validate → one retry → coerce to
      `NoResponse`.
- [ ] Full-run test using `MockProvider` exercising every effect type; assert
      timeline sorts by date and manifest is well-formed.
- **Done when:** an end-to-end mock run yields a sensible manifest + report with
  a correctly ordered future timeline.

### M4 — CLI (`@seldon/cli`)
- [ ] `seldon predict "<question>"` with flags: `--turns`, `--max-agents`,
      `--concurrency`, `--ground`, `--save`, `--seed`, `--json`, `--verbose`.
- [ ] Default: in-memory run → print Markdown report + entity list; discard rest.
- [ ] `--save` writes `./seldon-runs/<timestamp>/{manifest.json,report.md}`.
- [ ] `--verbose` streams per-turn activity.
- [ ] Clear error if Azure env vars are missing (and hint to use Mock in tests).
- **Done when:** a real `seldon predict "..."` against Azure prints a coherent,
  dated forecast and the entity list.

### M5 — Web grounding scaffold (`@seldon/grounding`)
- [ ] `Fetcher` interface + **stub** implementation (returns `unavailable`).
- [ ] `FactCache`: JSON metadata + Markdown body under `~/.seldon/cache/facts/`,
      TTL-aware, keyed by slug.
- [ ] `--ground` wires fact text into entity prompts and records `groundedOn`.
- [ ] Cache round-trip + TTL tests.
- **Done when:** `--ground` runs end-to-end using the stub, caching is exercised,
  and swapping in a real fetcher is a single-file change.

### M6 — Polish & docs
- [ ] README with quickstart, env setup, and an example run transcript.
- [ ] Tune default caps and prompts on a handful of real questions.
- [ ] Cost/turn note and guidance on choosing `--turns` / `--max-agents`.
- **Done when:** a newcomer can go from clone to a forecast in a few minutes.

---

## Backlog / future phases

- **Real web grounding:** Wikipedia REST extract fetcher; then news/search for
  recency; per-source confidence weighting.
- **Entra ID auth** for Azure OpenAI (`DefaultAzureCredential`) instead of keys.
- **Web app:** the "future" mentioned in the brief — an API + UI to launch runs
  and watch the timeline assemble live (SSE/streaming per turn).
- **Determinism/replay:** seed capture so a run can be replayed from its manifest.
- **Calibration:** optional per-response probability and later scoring against
  outcomes.
- **Vagent framework hardening:** publish `@seldon/vagents` independently with its
  own docs and examples beyond forecasting.
- **Multi-model panels:** run the same entity across different models and compare.

---

## Open questions to revisit (not blocking v1)

- Exact default caps (`--turns 4`, `--max-agents 12`) — tune empirically in M6.
- Should agents ever *reactivate* after withdrawing if strongly implicated again?
  (Deferred; keep withdrawal terminal in v1.)
- How aggressively to canonicalise/validate Wikipedia slugs before grounding.

---

## Definition of done (v1)

`seldon predict "<news item>"` against Azure OpenAI:
1. summons a seed roster of Wikipedia-identified entities,
2. runs a bounded, parallel, turn-based deliberation where agents react to each
   other and may nominate new entities,
3. produces a **future-dated timeline** and a reasoned Markdown **forecast**,
4. lists the entities involved,
5. keeps nothing on disk unless `--save` is given, while caching any fetched
   facts,
6. and the generic runtime + LLM layers are covered by tests that run with no
   network via `MockProvider`.
