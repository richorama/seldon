import { Runtime } from '@seldon/vagents';
import type { LLMProvider } from '@seldon/llm';
import { GroundingService } from '@seldon/grounding';
import { SharedContext, type SeldonEffect, type SeldonSnapshot } from './context.js';
import { EntityVagentHost } from './host.js';
import { seed } from './seed.js';
import { summarise } from './summarise.js';
import { wikipediaUrl, type Entity, type RunManifest, type RunOptions } from './types.js';

export interface PredictParams {
  question: string;
  provider: LLMProvider;
  options: RunOptions;
  /** Optional grounding service (used when options.grounded is true). */
  grounding?: GroundingService;
  /** Force initial entities (slugs) instead of the seeding LLM step. */
  seedSlugs?: string[];
  /** Injectable clock for deterministic runs/tests. */
  now?: () => Date;
  /** Optional progress hook for CLI verbosity. */
  onEvent?: (event: PredictEvent) => void;
}

export type PredictEvent =
  | { type: 'seeded'; entities: Entity[] }
  | { type: 'turn-complete'; turn: number; responses: number; entities: number }
  | { type: 'summarising' };

const ISO_DAY = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Runs a full prediction: seed -> bounded turn-based deliberation -> summary.
 * Returns an in-memory RunManifest; persistence is the caller's concern.
 */
export async function predict(params: PredictParams): Promise<RunManifest> {
  const { question, provider, options, onEvent } = params;
  const now = params.now ?? (() => new Date());
  const today = ISO_DAY(now());

  const context = new SharedContext(question);
  const grounding = options.grounded ? (params.grounding ?? new GroundingService()) : undefined;
  const host = new EntityVagentHost({
    context,
    provider,
    today,
    grounding,
    skeptic: options.skeptic,
    onTurn: (turn, responses, entities) =>
      onEvent?.({ type: 'turn-complete', turn, responses, entities })
  });
  const runtime = new Runtime<SeldonSnapshot, SeldonEffect>(host, {
    maxTurns: options.maxTurns,
    // The skeptic occupies its own slot so it never displaces a real entity.
    maxVagents: options.maxVagents + (options.skeptic ? 1 : 0),
    concurrency: options.concurrency
  });
  host.bind(runtime);

  if (options.skeptic) host.registerSkeptic();

  const seedEntities = params.seedSlugs?.length
    ? seedFromSlugs(params.seedSlugs)
    : await seed(provider, question, today);
  for (const entity of seedEntities) {
    await host.admitSeed({ slug: entity.slug, name: entity.name, type: entity.type });
  }
  onEvent?.({ type: 'seeded', entities: context.entityList() });

  const summary = await runtime.run();

  onEvent?.({ type: 'summarising' });
  const report = await summarise(provider, context, today);

  return {
    question,
    createdAt: now().toISOString(),
    options,
    entities: context.entityList(),
    timeline: context.timeline(),
    report,
    droppedNominations: summary.droppedRequests,
    rejectedEntities: host.rejectedEntities(),
    stoppedBecause: summary.stoppedBecause,
    turnsRun: summary.turnsRun
  };
}

function seedFromSlugs(slugs: string[]): Entity[] {
  return slugs.map((slug) => ({
    slug,
    name: slug.replace(/_/g, ' '),
    type: 'other' as const,
    wikipediaUrl: wikipediaUrl(slug),
    status: 'active' as const,
    nominatedBy: null,
    firstSeenTurn: 0
  }));
}
