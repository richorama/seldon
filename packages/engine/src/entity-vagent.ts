import type { Vagent, VagentContext } from '@seldon/vagents';
import type { LLMProvider } from '@seldon/llm';
import { entityTurnMessages } from './prompts.js';
import { parseJsonObject } from './json.js';
import { turnResultSchema, type Entity, type TurnResult } from './types.js';
import type { SeldonEffect, SeldonSnapshot } from './context.js';

export interface EntityVagentDeps {
  entity: Entity;
  provider: LLMProvider;
  today: string;
  /** Grounding text for this entity, when grounding supplied a fact. */
  factText?: string;
  /** Cache keys this entity's responses were grounded on. */
  groundedOn?: string[];
}

/**
 * A vagent that role-plays a single entity. Each turn is one structured LLM
 * call whose JSON output is validated and mapped to domain effects. Malformed
 * output is retried once, then coerced to a no-op.
 */
export class EntityVagent implements Vagent<SeldonSnapshot, SeldonEffect> {
  readonly id: string;
  private readonly deps: EntityVagentDeps;

  constructor(deps: EntityVagentDeps) {
    this.deps = deps;
    this.id = deps.entity.slug;
  }

  async takeTurn(ctx: VagentContext<SeldonSnapshot>): Promise<SeldonEffect[]> {
    const messages = entityTurnMessages({
      entity: this.deps.entity,
      snapshot: ctx.snapshot,
      memory: ctx.memory,
      today: this.deps.today,
      factText: this.deps.factText
    });

    const result = await this.completeWithRetry(messages);
    if (!result) return [{ kind: 'no-response' }];

    if (result.memoryNote) ctx.remember(result.memoryNote);

    const effects: SeldonEffect[] = [];
    if (result.response) {
      effects.push({
        kind: 'add-response',
        date: result.response.date,
        text: result.response.text,
        confidence: result.response.confidence ?? undefined,
        groundedOn: this.deps.groundedOn
      });
    }
    if (result.suggestEntities.length > 0) {
      effects.push({ kind: 'suggest-entities', entities: result.suggestEntities });
    }
    if (result.withdraw) {
      effects.push({ kind: 'withdraw' });
    }
    if (effects.length === 0) effects.push({ kind: 'no-response' });
    return effects;
  }

  private async completeWithRetry(
    messages: Parameters<LLMProvider['complete']>[0]
  ): Promise<TurnResult | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.deps.provider.complete(messages, {
          json: true,
          temperature: 0.8
        });
        return turnResultSchema.parse(parseJsonObject(raw));
      } catch {
        // retry once, then give up (coerced to no-op by the caller)
      }
    }
    return null;
  }
}
