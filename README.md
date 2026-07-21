# Seldon

[![CI](https://github.com/richorama/seldon/actions/workflows/ci.yml/badge.svg)](https://github.com/richorama/seldon/actions/workflows/ci.yml)

> A Foundation-inspired **prediction machine**. Give it a question or a piece of
> news; Seldon summons the entities that would plausibly be involved (countries,
> leaders, companies, charities — anything with a Wikipedia page), gives each one
> a **virtual agent** (a _vagent_), and lets them deliberate over a few turns. The
> shared, time-stamped context that emerges is summarised into a reasoned forecast.

This is _psychohistory_ by LLM rather than by statistical mechanics: instead of
modelling a population as gas particles, we model the salient actors as reasoning
agents and observe the interaction.

See [`DESIGN.md`](./DESIGN.md) for the architecture and [`PLAN.md`](./PLAN.md) for
the roadmap.

## How it works

1. **Seed** — the model proposes the initial entities most likely to be involved
   (identified by Wikipedia slug, e.g. `European_Union`).
2. **Deliberate** — each entity becomes a _vagent_. Every turn, all active vagents
   see the same updated shared context and, in parallel, may:
   - add a **future-dated** response to the shared timeline,
   - stay silent (and optionally **withdraw**), or
   - **nominate** further entities to join.
3. **Summarise** — the dated timeline is distilled into a Markdown forecast, plus
   the list of entities involved.

Runs are bounded by hard caps on turns and total agents, so they can't run away.

## Packages

| Package             | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `@seldon/vagents`   | Generic virtual-agent runtime: barrier turn loop, caps, bounded concurrency. Orleans-style, but single-process and LLM-oriented. Reusable beyond Seldon. |
| `@seldon/llm`       | Thin `LLMProvider` abstraction. `AzureOpenAIProvider` + a deterministic `MockProvider` for tests. |
| `@seldon/grounding` | Web grounding: a `Fetcher` interface with a Wikipedia REST implementation, and a TTL-aware, on-disk `FactCache` (JSON + Markdown). |
| `@seldon/engine`    | The Seldon domain: seeding, entity vagents, the shared context/timeline, summarisation, and the `predict()` orchestrator. |
| `@seldon/cli`       | The `seldon` command-line interface.                                       |

Data convention: **JSON for structured records, Markdown for prose.** Predictions
are ephemeral (kept in memory, discarded unless `--save`); fetched **facts are
cached** to disk because they're reusable.

## Quickstart

```bash
npm install
npm run build
npm test
```

Configure Azure OpenAI (via environment or a `.env` file in the working directory):

```bash
export AZURE_OPENAI_ENDPOINT="https://<resource>.services.ai.azure.com"  # or the classic *.openai.azure.com
export AZURE_OPENAI_API_KEY="<key>"        # AZURE_OPENAI_KEY is also accepted
export AZURE_OPENAI_DEPLOYMENT="<deployment-name>"   # e.g. gpt-5-mini
export AZURE_OPENAI_API_VERSION="2024-10-21"   # optional
```

Optional Seldon settings (also read from the environment / `.env`):

```bash
export SELDON_GROUNDING="true"   # Wikipedia grounding, on by default; false/0/off/no to disable
export SELDON_SKEPTIC="true"      # red-team "Devil's Advocate" vagent, on by default; false/0/off/no to disable
export SELDON_VISIONARY="true"    # "think big" visionary vagent, on by default; false/0/off/no to disable
```

The provider targets Azure's **v1 API** (`<host>/openai/v1/`), so both classic
`*.openai.azure.com` and newer `*.services.ai.azure.com` Foundry endpoints work —
a full endpoint path (e.g. ending `/openai/v1/responses`) is normalised
automatically. For reasoning models (e.g. the GPT‑5 family) that only allow the
default sampling temperature, the provider detects the rejection and retries
without `temperature`.

A `.env` file (git-ignored) is loaded automatically by the CLI.

Run a prediction — `npm install` builds the CLI automatically (via `prepare`),
which links the `seldon` command, so you can use `npx`:

```bash
npx seldon predict "OPEC+ announces a surprise production cut" --turns 5 --max-agents 15 --verbose
```

Equivalent npm scripts (handy from the repo root):

```bash
npm run predict -- "Will the EU and UK agree a new fishing deal?" --save
npm run seldon  -- predict "..." --verbose      # full CLI, any command/flags
```

Or invoke the built CLI directly:

```bash
node packages/cli/dist/index.js predict "Will the EU and UK agree a new fishing deal?" --save
```

## CLI

```
seldon predict "<question or news item>" [options]

  --turns <n>         max deliberation turns            (default 4)
  --max-agents <n>    hard cap on total entities         (default 12)
  --concurrency <n>   parallel LLM calls                 (default 4)
  --seed <a,b,c>      force initial entity slugs instead of the seeding step
  --save [path]       persist manifest.json + report.md (default ./seldon-runs/<ts>)
  --json              print the run manifest as JSON to stdout
  --verbose           stream per-turn progress to stderr
  -h, --help          show this help
```

## Web grounding (`SELDON_GROUNDING`)

Grounding is **on by default** and controlled via the `SELDON_GROUNDING`
environment variable (`.env` supported); set it to `false`/`0`/`off`/`no` to
disable. Each entity is grounded on its **English Wikipedia summary**
(via the REST API) before it deliberates, so agents reason from a real, current
description rather than the model's frozen prior. Network errors and timeouts
degrade gracefully to "unavailable" for that entity (fail-open) — the run
continues. When grounding is on, entities whose Wikipedia page genuinely does
**not exist** (HTTP 404) are treated as likely fabricated slugs and are
**rejected** rather than allowed to deliberate; they are listed under
`rejectedEntities` in the manifest. Facts persist under
`~/.seldon/cache/facts/` as a JSON metadata file plus a Markdown body per slug,
honouring a TTL, so re-runs reuse them (transient errors are not cached, so they
retry).

The fetcher sits behind a `Fetcher` interface, so swapping in additional sources
(news, search) is a single-file change. Responses record which fact-cache keys
they were grounded on (`groundedOn`).

## Panel vagents (`SELDON_SKEPTIC`, `SELDON_VISIONARY`)

Alongside the entities, Seldon adds two built-in "panel" vagents that play no
real-world entity but shape the deliberation. Both are on by default, active from
turn 1, exempt from grounding, never withdraw or nominate, and each occupies its
own slot so it never displaces a real entity under `--max-agents`.

- **Devil's Advocate (red team)** — stress-tests the emerging consensus:
  challenges over-confident claims, exposes unstated assumptions, and injects the
  strongest realistic counter-scenario as a dated timeline entry. Disable with
  `SELDON_SKEPTIC=false`.
- **Visionary (think big)** — counters small, incremental thinking: pushes the
  panel toward the largest-scale, highest-stakes and longest-horizon consequences
  — bold strategic moves, second-order and systemic effects, and how the
  situation could reshape an industry, market or geopolitical order. Disable with
  `SELDON_VISIONARY=false`.

Prompts are tuned to keep the forecast focused on **real-world implications**
(strategic, competitive, commercial, political and societal consequences) in
plain language for a general reader, rather than technical/process minutiae.

## Development

```bash
npm run build          # tsc project references
npm test               # vitest (all packages)
npm run lint           # eslint
npm run format         # prettier --write
```

CI (GitHub Actions) runs lint, format check, build and tests on Node 20 & 22.

## Caveat

Seldon produces **hypothetical LLM reasoning**, not calibrated probabilities or
fact. Forecasts are speculative and should be read as structured "what if"
narratives, not predictions to bet on.

## License

[MIT](./LICENSE)
