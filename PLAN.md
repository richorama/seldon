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
- **Web grounding:** shipped and **on by default**, toggled via the
  `SELDON_GROUNDING` env var. A real English-Wikipedia REST fetcher grounds each
  entity; a `StubFetcher` is the fallback when no fetcher is wired in.
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
- [x] Root `package.json` with npm workspaces; `tsconfig.base.json`.
- [x] Packages created: `vagents`, `llm`, `grounding`, `engine`, `cli`.
- [x] Dev tooling: `vitest`, `eslint`, `prettier`, `tsc` build; a `dev` script.
- [x] CI-friendly `npm test` runs green (empty suites ok).
- **Done when:** `npm install && npm run build && npm test` succeed from a clean
  checkout.

### M1 — Generic virtual-agent runtime (`@seldon/vagents`)
- [x] `Vagent`, `VagentContext`, `VagentHost`, `Runtime` types/impls.
- [x] Turn loop with **post-barrier** effect application (all vagents see the same
      snapshot per turn).
- [x] Bounded-concurrency scheduler (p-limit style).
- [x] Cap enforcement (`maxTurns`, `maxVagents`) + deferred activation (spawn on
      turn N activates on N+1).
- [x] Quiescence / empty-roster early stop via `host.isComplete`.
- [x] Unit tests for all of the above (no LLM).
- **Done when:** runtime tests pass and the package has zero Seldon imports.

### M2 — LLM provider abstraction (`@seldon/llm`)
- [x] `LLMProvider` interface + `CompleteOptions` (incl. `json` mode).
- [x] `AzureOpenAIProvider` (config from env; JSON-mode support).
- [x] `MockProvider` with scriptable, deterministic responses.
- [x] Provider contract tests against fixtures.
- **Done when:** a smoke script completes one Azure call given real env vars, and
  Mock-based tests are green.

### M3 — Seldon engine (`@seldon/engine`) — the core loop
- [x] Domain model (`Entity`, `Response`, `RunManifest`) + Zod schemas.
- [x] `seed(question)` → initial entities (1 LLM call).
- [x] `EntityVagent.takeTurn` producing the effect union
      (`AddResponse` / `NoResponse` / `Withdraw` / `SuggestEntities`) with
      **future-dated** Markdown responses + private memory notes.
- [x] `EntityVagentHost`: snapshot builder (roster + timeline Markdown), effect
      application, nominee activation under `maxAgents`, dropped-nomination log.
- [x] `summarise()` → Markdown forecast report.
- [x] Malformed-output handling: Zod validate → one retry → coerce to
      `NoResponse`.
- [x] Full-run test using `MockProvider` exercising every effect type; assert
      timeline sorts by date and manifest is well-formed.
- **Done when:** an end-to-end mock run yields a sensible manifest + report with
  a correctly ordered future timeline.

### M4 — CLI (`@seldon/cli`)
- [x] `seldon predict "<question>"` with flags: `--turns`, `--max-agents`,
      `--concurrency`, `--save`, `--seed`, `--json`, `--verbose`. Grounding is an
      env setting (`SELDON_GROUNDING`), not a flag.
- [x] Default: in-memory run → print Markdown report + entity list; discard rest.
- [x] `--save` writes `./seldon-runs/<timestamp>/{manifest.json,report.md}`.
- [x] `--verbose` streams per-turn activity.
- [x] Clear error if Azure env vars are missing (and hint to use Mock in tests).
- **Done when:** a real `seldon predict "..."` against Azure prints a coherent,
  dated forecast and the entity list.

### M5 — Web grounding (`@seldon/grounding`)
- [x] `Fetcher` interface + a real **Wikipedia REST** implementation (with a
      `StubFetcher` fallback returning `unavailable`).
- [x] `FactCache`: JSON metadata + Markdown body under `~/.seldon/cache/facts/`,
      TTL-aware, keyed by slug.
- [x] Grounding (default on, via `SELDON_GROUNDING`) wires fact text into entity
      prompts and records `groundedOn`; canonical slugs deduplicate aliases.
- [x] **Grounding gate:** reject entities whose Wikipedia page 404s (likely
      fabricated slugs), fail-open on transient errors; surface `rejectedEntities`
      in the manifest. `Fact.reason` distinguishes `not-found` vs `error`;
      transient errors are not cached. A search-based **slug resolver** recovers
      real actors nominated under an imperfect slug (e.g. `Anthropic_(company)` →
      `Anthropic`) before rejecting, guarded by a title match.
- [x] Cache round-trip + TTL tests.
- **Done when:** grounding runs end-to-end against Wikipedia, caching is
  exercised, and swapping in another fetcher is a single-file change.

### M5a — Quality: real-world framing, anti-fabrication & panel vagents
- [x] Prompt hardening across seed/turn/summary prompts against invented
      programmes, acronyms, figures and exact dates.
- [x] **Real-world framing:** seed/turn/summary prompts steer toward strategic,
      competitive, commercial, political and societal implications in plain
      language; the summary leads with reader-facing sections (implications,
      winners & losers, how key players respond, bigger-picture, what to watch).
- [x] Built-in **red-team `SkepticVagent`** ("Devil's Advocate", `SELDON_SKEPTIC`,
      default on): active from turn 1, injects dated counter-scenarios, exempt
      from grounding, gets its own cap slot, no Wikipedia link.
- [x] Built-in **think-big `VisionaryVagent`** ("Visionary", `SELDON_VISIONARY`,
      default on): pushes for the largest-scale, longest-horizon consequences;
      shares a `PanelVagent` base with the skeptic; own cap slot.
- [x] Tests for gate, panelist participation, reason plumbing, and env toggles.
- **Done when:** hallucinated entities are dropped, dissent and big-picture
  scenarios appear in the timeline, and the summary reads for a general audience.

### M6 — Polish & docs
- [x] README with quickstart, env setup, and an example run transcript.
- [x] Tune default caps and prompts on a handful of real questions.
- [x] Cost/turn note and guidance on choosing `--turns` / `--max-agents`.
- **Done when:** a newcomer can go from clone to a forecast in a few minutes.

---

## Backlog / future phases

- **News/search grounding:** Wikipedia extract grounding has shipped; add
  news/search sources for recency and per-source confidence weighting.
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
- ~~How aggressively to canonicalise/validate Wikipedia slugs before grounding.~~
  Resolved: grounded slugs are canonicalised via Wikipedia redirects and
  deduplicated by canonical slug.

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
