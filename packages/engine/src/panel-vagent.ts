import type { Vagent, VagentContext } from '@seldon/vagents';
import type { LLMMessage, LLMProvider } from '@seldon/llm';
import { parseJsonObject } from './json.js';
import { turnResultSchema } from './types.js';
import type { SeldonEffect, SeldonSnapshot } from './context.js';

export interface PanelVagentDeps {
  provider: LLMProvider;
  today: string;
}

/**
 * Base for built-in "panel" vagents that represent no real-world entity but
 * shape the deliberation (challenging it, or pushing it to think bigger). Each
 * turn is one structured LLM call that may add a single dated response to the
 * timeline. Panelists never nominate entities and never withdraw, and they are
 * exempt from grounding.
 */
export abstract class PanelVagent implements Vagent<SeldonSnapshot, SeldonEffect> {
  abstract readonly id: string;
  protected readonly deps: PanelVagentDeps;

  constructor(deps: PanelVagentDeps) {
    this.deps = deps;
  }

  /** Build the LLM messages for this panelist's turn. */
  protected abstract buildMessages(ctx: VagentContext<SeldonSnapshot>): LLMMessage[];

  async takeTurn(ctx: VagentContext<SeldonSnapshot>): Promise<SeldonEffect[]> {
    const messages = this.buildMessages(ctx);
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
