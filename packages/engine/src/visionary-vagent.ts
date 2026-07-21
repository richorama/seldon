import type { VagentContext } from '@seldon/vagents';
import type { LLMMessage } from '@seldon/llm';
import { PanelVagent } from './panel-vagent.js';
import { visionaryTurnMessages } from './prompts.js';
import type { SeldonSnapshot } from './context.js';

/** The fixed id/slug of the built-in "think big" vagent. */
export const VISIONARY_ID = 'seldon-visionary';
/** The display name shown for the visionary vagent in rosters and timelines. */
export const VISIONARY_NAME = 'Visionary (big-picture red team)';

/**
 * A built-in "think big" vagent. It represents no real-world entity; instead it
 * pushes the deliberation to consider the largest-scale, highest-stakes and
 * longest-horizon consequences the other vagents are underweighting — bold
 * strategic moves, second-order and systemic effects, and how the situation
 * could reshape an industry, market or geopolitical order. It contributes dated
 * big-picture projections other vagents then react to.
 */
export class VisionaryVagent extends PanelVagent {
  readonly id = VISIONARY_ID;

  protected buildMessages(ctx: VagentContext<SeldonSnapshot>): LLMMessage[] {
    return visionaryTurnMessages({
      snapshot: ctx.snapshot,
      memory: ctx.memory,
      today: this.deps.today
    });
  }
}
