# Seldon — Design

> A Foundation-inspired **prediction machine**. Given a question or a piece of
> news, Seldon summons the entities that would plausibly be involved (countries,
> leaders, companies, charities — anything with a Wikipedia page), gives each one
> a **virtual agent**, and lets them deliberate over a small number of turns. The
> shared, time-stamped context that emerges is summarised into a reasoned forecast.
>
> This is *psychohistory* by LLM rather than by statistical mechanics: instead of
> modelling a population as gas particles, we model the salient actors as
> reasoning agents and observe the interaction.

---

## 1. Design goals

1. **Virtual agents ("vagents").** Agents are addressable by a stable identity
   (a Wikipedia slug), created on demand, hold private memory, and are cheap to
   activate/deactivate — conceptually like Microsoft Orleans grains, but with
   **no Orleans and no distributed runtime**. It's a single-process, turn-based
   scheduler.
2. **Emergent roster.** We don't hand-author the participants. A seed step
   proposes an initial set, and agents may nominate further entities as the
   deliberation unfolds — bounded by hard caps so it can't run away.
3. **Rich interaction.** Every turn, each active agent sees the *updated* shared
   context (what everyone else said) and can react to it.
4. **Timeline output.** Every response an agent adds is tagged with a **future
   date**, so the shared context reads as a projected chronology of events.
5. **Reusable framework.** The turn scheduler, vagent lifecycle, and caps are a
   generic library (`@seldon/vagents`) with **no knowledge of Seldon**. The
   prediction logic sits on top.
6. **Provider-agnostic, Azure-first.** Azure OpenAI is the primary backend behind
   a thin `LLMProvider` interface; OpenAI / Ollama / others can slot in later.
7. **JSON for structure, Markdown for prose.** Structured records (entities,
   responses, run manifest) are JSON; all human-authored text (responses,
   reasoning, final report) is Markdown.
8. **Predictions are ephemeral; facts are cached.** A run lives in memory and is
   thrown away unless `--save` is passed — predictions are hypothetical and not
   worth hoarding. Internet-sourced *facts*, by contrast, are expensive and
   reusable, so they persist in an on-disk cache.

### Non-goals (v1)

- No distributed/multi-process execution, no persistence server, no web UI.
- No claim of *calibrated* probabilities — this is reasoned narrative forecasting,
  not a scored forecasting tournament (though confidence hints are captured).
- No long-term storage of predictions.

---

## 2. Repository shape

npm workspaces monorepo, TypeScript throughout.

```
seldon/
├── PLAN.md
├── DESIGN.md
├── package.json                 # workspaces root
├── tsconfig.base.json
└── packages/
    ├── vagents/                  # @seldon/vagents — generic virtual-agent runtime
    │   └── src/
    │       ├── vagent.ts         # Vagent interface + base class
    │       ├── runtime.ts       # activation registry, turn loop, caps, barriers
    │       ├── scheduler.ts     # parallel fan-out with concurrency limit
    │       └── types.ts
    ├── llm/                     # @seldon/llm — provider abstraction
    │   └── src/
    │       ├── provider.ts      # LLMProvider interface
    │       ├── azure-openai.ts  # AzureOpenAIProvider
    │       └── mock.ts          # deterministic provider for tests
    ├── grounding/               # @seldon/grounding — web fact fetch + disk cache
    │   └── src/
    │       ├── fetcher.ts       # Fetcher interface (stub impl in v1)
    │       └── cache.ts         # JSON+Markdown fact cache
    ├── engine/                  # @seldon/engine — Seldon prediction domain
    │   └── src/
    │       ├── entity-vagent.ts  # Vagent implementation for an Entity
    │       ├── seed.ts          # question -> initial entities
    │       ├── actions.ts       # NoResponse / Withdraw / AddResponse / SuggestEntities
    │       ├── context.ts       # shared context + timeline
    │       ├── summarise.ts     # final report generator
    │       └── run.ts           # orchestrates a full prediction run
    └── cli/                     # @seldon/cli — the `seldon` command
        └── src/index.ts
```

**Dependency direction:** `cli → engine → { vagents, llm, grounding }`.
`vagents` depends on nothing Seldon-specific. `llm` and `grounding` are
independent leaves.

---

## 3. The generic runtime — `@seldon/vagents`

The framework worth extracting. It knows about *vagents* and *turns*, nothing else.

### 3.1 Concepts

- **Vagent** — an addressable, on-demand agent with private state. Identified by a
  string `VagentId`. In Seldon, the id is a Wikipedia slug (e.g.
  `United_Nations`), but the runtime treats it as opaque.
- **Activation** — a vagent becomes *active* when first addressed; it stays active
  until it withdraws or the run ends. The runtime holds a registry of activations.
- **Turn** — a synchronised round. On each turn the runtime hands every active
  vagent a read-only snapshot of the shared context and collects each vagent's
  emitted effects **in parallel** (bounded concurrency). Effects are applied
  *after* the barrier, so within a turn all vagents see the same snapshot (no
  intra-turn ordering bias).
- **Caps** — `maxTurns` and `maxVagents` are enforced by the runtime, so growth is
  bounded regardless of what vagents request.

### 3.2 Interfaces (illustrative)

```ts
export type VagentId = string;

export interface VagentContext<Snapshot> {
  readonly turn: number;
  readonly self: VagentId;
  readonly snapshot: Snapshot;     // read-only shared context for this turn
  readonly memory: string[];       // this vagent's private, append-only notes
}

// Effects are generic; the host app defines the concrete union.
export interface Vagent<Snapshot, Effect> {
  readonly id: VagentId;
  /** Called once per turn while active. Returns effects to apply post-barrier. */
  takeTurn(ctx: VagentContext<Snapshot>): Promise<Effect[]>;
  /** Optional: called when the vagent is deactivated. */
  onWithdraw?(): Promise<void>;
}

export interface RuntimeOptions {
  maxTurns: number;
  maxVagents: number;
  concurrency: number;             // parallel vagent turns in flight
}

export interface VagentHost<Snapshot, Effect> {
  /** Build the read-only snapshot handed to vagents this turn. */
  snapshot(turn: number): Snapshot;
  /** Apply the effects collected after the barrier; may spawn/withdraw vagents. */
  apply(turn: number, effects: Array<{ from: VagentId; effect: Effect }>): void;
  /** Factory: materialise a vagent for a freshly-requested id. */
  activate(id: VagentId): Promise<Vagent<Snapshot, Effect>>;
  /** Optional: stop early when true (e.g. everyone withdrew / converged). */
  isComplete?(turn: number): boolean;
}

export class Runtime<Snapshot, Effect> {
  constructor(host: VagentHost<Snapshot, Effect>, opts: RuntimeOptions);
  request(id: VagentId): void;                 // queue activation (respects maxVagents)
  run(): Promise<void>;                        // drive the turn loop to completion
}
```

### 3.3 Turn loop

```
seed: host.request(...) for initial ids
for turn in 1..maxTurns:
    activeIds = registry.active()
    snapshot = host.snapshot(turn)
    effects = await scheduler.map(activeIds, id =>
                  vagent(id).takeTurn({ turn, self:id, snapshot, memory }))   // parallel, bounded
    host.apply(turn, flatten(effects))         // spawn/withdraw/append happen here
    if no active vagents OR host.isComplete(turn): break
```

Spawns requested on turn *N* activate on turn *N+1*, so newly-summoned entities
first observe the context before contributing. `maxVagents` is enforced at
`request` time (excess nominations are dropped, logged, and reported).

---

## 4. The Seldon engine — `@seldon/engine`

### 4.1 Domain data model (JSON)

```ts
type EntityType =
  | 'country' | 'organisation' | 'company' | 'person'
  | 'charity' | 'institution' | 'movement' | 'other';

interface Entity {
  slug: string;              // Wikipedia slug — the VagentId, e.g. "European_Union"
  name: string;              // display name
  type: EntityType;
  wikipediaUrl: string;      // https://en.wikipedia.org/wiki/<slug>
  status: 'active' | 'withdrawn';
  nominatedBy: string | null;// slug of the entity that suggested it, or null (seed)
  firstSeenTurn: number;
}

interface Response {
  id: string;                // uuid
  entitySlug: string;
  turn: number;
  date: string;              // FUTURE event date, ISO 8601 (YYYY-MM-DD)
  text: string;              // Markdown — the public statement / projected action
  confidence?: 'low' | 'medium' | 'high';
  groundedOn?: string[];     // fact-cache keys used, when grounding is enabled
}

interface RunManifest {
  question: string;
  createdAt: string;         // ISO timestamp (real "now")
  options: { maxTurns; maxVagents; concurrency; grounded: boolean; model: string };
  entities: Entity[];
  timeline: Response[];      // all responses; render sorted by `date`
  report: string | null;    // Markdown final summary (filled at the end)
  droppedNominations: string[];
}
```

The **shared context** presented to agents each turn is derived from
`entities` + `timeline`. The **timeline**, sorted by future `date`, is the
projected chronology — the heart of the output.

### 4.2 Agent effects (the `Effect` union for the runtime)

Each entity-vagent, on its turn, returns zero or more of:

| Effect            | Meaning                                                        |
|-------------------|----------------------------------------------------------------|
| `AddResponse`     | Append a dated Markdown statement to the shared timeline.      |
| `NoResponse`      | Nothing to add this turn (stays active, keeps watching).       |
| `Withdraw`        | Exit the deliberation (deactivate; won't be called again).     |
| `SuggestEntities` | Nominate one or more slugs to bring into the run.              |

An agent may combine e.g. `AddResponse` + `SuggestEntities` in a single turn.
`NoResponse` and `Withdraw` are mutually exclusive with the others.

### 4.3 An entity-vagent's turn

Each `takeTurn` is one structured LLM call. The prompt carries:

- **System/role:** "You are role-playing *{name}* (`{slug}`), a {type}. Respond
  only as this entity would plausibly act. It is {realNow}; reason about the
  future." Includes the entity's Wikipedia summary (from grounding cache if
  available, else the model's own knowledge).
- **The question / news item.**
- **Shared context this turn:** the current roster + the timeline so far
  (Markdown), so the agent reacts to others.
- **This vagent's private memory:** its own prior internal reasoning (append-only).
- **Instructions:** choose effects; if adding a response, give a **future date**
  and Markdown text; optionally record a private reasoning note; optionally
  nominate missing entities by Wikipedia slug.

The model returns **structured JSON** (validated with Zod) describing the effects
plus an optional `memoryNote` appended to private memory. Malformed output is
retried once, then coerced to `NoResponse`.

### 4.4 Seeding

`seed(question)` is a single LLM call that returns an initial set of entities
(slug, name, type) most likely to be involved — typically 3–7. These are the
first activations. The seeder is instructed to prefer entities that genuinely
have (or would have) a Wikipedia page and to use canonical slugs.

### 4.5 Summarisation

After the turn loop ends (caps hit, everyone withdrew, or convergence), a final
LLM call receives the full roster + timeline and produces the **Markdown report**:

- **Executive forecast** — the most probable trajectory, in prose.
- **Projected timeline** — key dated milestones (from the sorted timeline).
- **Key actors & their stances** — who mattered and how they moved.
- **Uncertainties & branch points** — where the future could fork.
- **Confidence & caveats** — explicitly flags this as hypothetical LLM reasoning.

The CLI also prints the **entities involved** (name, type, Wikipedia link,
active/withdrawn).

### 4.6 Convergence / stopping

The run stops at the first of:
- `maxTurns` reached;
- all vagents withdrawn;
- **quiescence**: a full turn in which every active vagent returned `NoResponse`
  (`host.isComplete`).

---

## 5. LLM provider abstraction — `@seldon/llm`

```ts
export interface LLMMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;            // request structured JSON output
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  complete(messages: LLMMessage[], opts?: CompleteOptions): Promise<string>;
}
```

**`AzureOpenAIProvider`** wraps the `openai` SDK targeting Azure's **v1 API**
(`<host>/openai/v1/`), so both classic `*.openai.azure.com` and newer
`*.services.ai.azure.com` (AI Foundry) endpoints work; a full endpoint path is
normalised automatically. For reasoning models that reject a non-default
`temperature`, the provider detects the rejection and retries without it. Config
via environment (12-factor):

| Env var                     | Purpose                                  |
|-----------------------------|------------------------------------------|
| `AZURE_OPENAI_ENDPOINT`     | `https://<resource>.services.ai.azure.com` or `*.openai.azure.com` |
| `AZURE_OPENAI_API_KEY`      | key — `AZURE_OPENAI_KEY` also accepted (or Entra ID later) |
| `AZURE_OPENAI_DEPLOYMENT`   | deployment/model name                    |
| `AZURE_OPENAI_API_VERSION`  | optional, e.g. `2024-10-21`              |

A **`MockProvider`** returns deterministic canned effects so the engine and
runtime can be tested without network or spend.

---

## 6. Web grounding — `@seldon/grounding`

Enabled by default; controlled via the `SELDON_GROUNDING` env var (set to
`false`/`0`/`off`/`no` to disable). Two pieces:

- **`Fetcher`** — `fetch(slug): Promise<Fact>` retrieves a current summary for an
  entity. `WikipediaFetcher` (English Wikipedia REST summary) is the default
  real implementation; a `StubFetcher` that returns `{ status: 'unavailable' }`
  is the fallback used when no fetcher is wired in. The interface is pluggable to
  news/search sources later. A `Fact` also carries a `canonicalSlug` (the
  redirect-resolved Wikipedia slug), which the engine uses to **deduplicate**
entities nominated under different aliases. An unavailable `Fact` carries a
`reason`: `'not-found'` (HTTP 404 — the page genuinely does not exist, so the
entity is likely a hallucinated slug) or `'error'` (transient network/timeout/
non-404 failure, treated fail-open).
- **`FactCache`** — persistent on-disk cache (predictions aren't kept, but facts
are). Layout under `~/.seldon/cache/facts/`:
- `<slug>.json` — `{ slug, status, reason?, source, url, canonicalSlug, fetchedAt }`
- `<slug>.md`   — the human-readable fact text (Markdown)

Lookups honour a TTL (a cache-level option); stale entries are refetched. The
cache is keyed by slug so re-runs and different questions share grounding.
Entries cached before `canonicalSlug` existed are backfilled from the page URL.
Only `ok` and stable `not-found` facts are cached; transient `error` facts are
**not** cached, so a flaky fetch retries on the next run.

**Grounding gate.** When grounding is on, the engine's admission path rejects any
entity whose fact is `unavailable` with reason `not-found` — a fabricated
Wikipedia slug never gets to deliberate. Rejected entities are surfaced in the
run manifest under `rejectedEntities`. Transient `error` results fail open (we
cannot prove non-existence), and the gate is inactive when grounding is off.

When grounded, an entity-vagent's prompt includes its cached fact text, and any
`Response` records the cache keys it drew on in `groundedOn`.

---

## 6a. Red-team vagent — the skeptic

Enabled by default (`SELDON_SKEPTIC`, `false`/`0`/`off`/`no` to disable), the
`SkepticVagent` ("Devil's Advocate") is a built-in adversarial vagent that
represents no real-world entity. It is active from turn 1 and each turn may add a
dated counter-scenario/challenge to the shared timeline, so other vagents react
to dissent instead of converging on false consensus. It never withdraws, does not
nominate entities, and is exempt from grounding. It joins the roster with an empty
`wikipediaUrl` (rendered without a hyperlink) and is given its own runtime slot
(`maxVagents + 1`) so it never displaces a real entity under the cap.

---

## 7. CLI — `@seldon/cli`

```
seldon predict "<question or news item>" [options]

Options:
  --turns <n>           max deliberation turns          (default 4)
  --max-agents <n>      hard cap on total entities       (default 12)
  --concurrency <n>     parallel LLM calls               (default 4)
  --save [path]         persist the run manifest (JSON) + report (MD)
                        default off; predictions are ephemeral
  --seed <slug,slug>    force initial entities instead of the seed LLM step
  --json                emit the RunManifest JSON to stdout
  --verbose             stream per-turn activity
```

Default behaviour: run in memory, print the Markdown report and the entity list
to stdout, discard everything else. `--save` writes
`./seldon-runs/<timestamp>/manifest.json` + `report.md` for the curious.

Settings such as `SELDON_GROUNDING` (grounding on/off), `SELDON_SKEPTIC`
(red-team vagent on/off) and the Azure OpenAI credentials are read from the
environment or a `.env` file, not from flags.

Example:

```
seldon predict "OPEC+ announces a surprise production cut" --turns 5 --max-agents 15 --verbose
```

---

## 8. Control flow (end to end)

```
1. CLI parses args, constructs AzureOpenAIProvider (or Mock).
2. engine.seed(question) -> initial Entity[]         [1 LLM call]
3. Build EntityVagentHost (owns entities + timeline + fact cache).
4. Runtime.run():
     for each turn (<= maxTurns):
        snapshot = roster + timeline (Markdown)
        parallel: each active vagent.takeTurn() -> effects   [N LLM calls, bounded]
        apply effects: append responses, spawn nominees (<= maxAgents),
                       withdraw exiters, append private memory
        stop if quiescent / empty / cap
5. engine.summarise(roster, timeline) -> Markdown report   [1 LLM call]
6. Print report + entity list. If --save, write manifest.json + report.md.
```

Token budget per run ≈ `1 (seed) + Σturns(activeVagents) + 1 (summary)` calls.
With defaults (≤12 agents, ≤4 turns) that's a small, bounded number — the caps
exist precisely to keep this predictable.

---

## 9. Testing strategy

- **`@seldon/vagents`**: pure unit tests with a synthetic host — verify barrier
  semantics (all vagents see the same snapshot), cap enforcement, deferred
  activation, quiescence stop. No LLM involved.
- **`@seldon/engine`**: drive a full run with `MockProvider` scripted to exercise
  every effect type; assert timeline ordering by date and manifest shape.
- **`@seldon/llm`**: contract test the provider against recorded fixtures.
- **`@seldon/grounding`**: cache TTL + JSON/MD round-trip.

Runner: `vitest`. Lint/format: `eslint` + `prettier`. Types: `tsc --noEmit`.

---

## 10. Key risks & mitigations

| Risk | Mitigation |
|------|------------|
| Runaway entity growth | Hard `maxVagents`; nominations past the cap are dropped and reported. |
| Duplicate entities under alias slugs | When grounded, slugs are canonicalised via Wikipedia redirects and deduplicated by canonical slug. |
| Runaway token spend | `maxTurns` cap; bounded concurrency; quiescence early-stop. |
| Echo-chamber / everyone agrees | Prompt agents to stay in character and surface genuine conflicts; summariser explicitly reports branch points. |
| Hallucinated Wikipedia slugs | Seeder/nominator instructed to use canonical slugs; optional grounding validates existence; invalid slugs flagged. |
| Non-JSON model output | Zod validation + one retry + coerce to `NoResponse`. |
| Presenting fiction as fact | Report carries an explicit "hypothetical LLM reasoning" caveat; predictions not persisted by default. |

---

## 11. Naming (Foundation flavour, kept light)

- **`seldon`** — the project / CLI.
- **`@seldon/vagents`** — the extractable virtual-agent runtime (Orleans nod).
- Internally, the shared time-stamped context is the **timeline**; the final
  document is the **forecast**. (We resist over-theming the code.)
