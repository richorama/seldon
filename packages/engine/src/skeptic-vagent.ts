import type { VagentContext } from '@seldon/vagents';
import type { LLMMessage } from '@seldon/llm';
import { PanelVagent } from './panel-vagent.js';
import { skepticTurnMessages } from './prompts.js';
import type { SeldonSnapshot } from './context.js';

/** The fixed id/slug of the built-in red-team vagent. */
export const SKEPTIC_ID = 'seldon-skeptic';
/** The display name shown for the red-team vagent in rosters and timelines. */
export const SKEPTIC_NAME = "Devil's Advocate (red team)";

/**
 * A built-in adversarial vagent. Rather than role-playing a real-world entity,
 * it stress-tests the emerging consensus: challenging over-confident claims,
 * surfacing missing dissent, and injecting plausible counter-scenarios as dated
 * timeline entries the other vagents then react to.
 */
export class SkepticVagent extends PanelVagent {
  readonly id = SKEPTIC_ID;

  protected buildMessages(ctx: VagentContext<SeldonSnapshot>): LLMMessage[] {
    return skepticTurnMessages({
      snapshot: ctx.snapshot,
      memory: ctx.memory,
      today: this.deps.today
    });
  }
}
