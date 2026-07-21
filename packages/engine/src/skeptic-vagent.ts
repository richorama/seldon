import type { Vagent, VagentContext } from '@seldon/vagents';
import type { LLMProvider } from '@seldon/llm';
import { skepticTurnMessages } from './prompts.js';
import { parseJsonObject } from './json.js';
import { turnResultSchema } from './types.js';
import type { SeldonEffect, SeldonSnapshot } from './context.js';

/** The fixed id/slug of the built-in red-team vagent. */
export const SKEPTIC_ID = 'seldon-skeptic';
/** The display name shown for the red-team vagent in rosters and timelines. */
export const SKEPTIC_NAME = "Devil's Advocate (red team)";

export interface SkepticVagentDeps {
  provider: LLMProvider;
  today: string;
}

/**
 * A built-in adversarial vagent. Rather than role-playing a real-world entity,
 * it stress-tests the emerging consensus: challenging over-confident claims,
 * surfacing missing dissent, and injecting plausible counter-scenarios as dated
 * timeline entries the other vagents then react to. It never withdraws and does
 * not nominate entities.
 */
export class SkepticVagent implements Vagent<SeldonSnapshot, SeldonEffect> {
  readonly id = SKEPTIC_ID;
  private readonly deps: SkepticVagentDeps;

  constructor(deps: SkepticVagentDeps) {
    this.deps = deps;
  }

  async takeTurn(ctx: VagentContext<SeldonSnapshot>): Promise<SeldonEffect[]> {
    const messages = skepticTurnMessages({
      snapshot: ctx.snapshot,
      memory: ctx.memory,
      today: this.deps.today
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.deps.provider.complete(messages, {
          json: true,
          temperature: 0.9
        });
        const result = turnResultSchema.parse(parseJsonObject(raw));
        if (result.memoryNote) ctx.remember(result.memoryNote);
        if (result.response) {
          return [
            {
              kind: 'add-response',
              date: result.response.date,
              text: result.response.text,
              confidence: result.response.confidence ?? undefined
            }
          ];
        }
        return [{ kind: 'no-response' }];
      } catch {
        // retry once, then give up
      }
    }
    return [{ kind: 'no-response' }];
  }
}
