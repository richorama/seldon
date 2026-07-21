import type { LLMProvider } from '@seldon/llm';
import { seedMessages } from './prompts.js';
import { parseJsonObject } from './json.js';
import { seedResultSchema, wikipediaUrl, type Entity } from './types.js';

/**
 * Seeds a run: asks the model for the initial set of entities most likely to be
 * involved in the question. Returns fully-formed Entity records (turn 0).
 */
export async function seed(
  provider: LLMProvider,
  question: string,
  today: string
): Promise<Entity[]> {
  const raw = await provider.complete(seedMessages(question, today), {
    json: true,
    temperature: 0.7
  });
  const parsed = seedResultSchema.parse(parseJsonObject(raw));

  const seen = new Set<string>();
  const entities: Entity[] = [];
  for (const ref of parsed.entities) {
    if (seen.has(ref.slug)) continue;
    seen.add(ref.slug);
    entities.push({
      slug: ref.slug,
      name: ref.name,
      type: ref.type,
      wikipediaUrl: wikipediaUrl(ref.slug),
      status: 'active',
      nominatedBy: null,
      firstSeenTurn: 0
    });
  }
  return entities;
}
