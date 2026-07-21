import type { LLMProvider } from '@seldon/llm';
import { summaryMessages } from './prompts.js';
import type { SharedContext } from './context.js';

/** Produces the final Markdown forecast report from the deliberation. */
export async function summarise(
  provider: LLMProvider,
  context: SharedContext,
  today: string
): Promise<string> {
  return provider.complete(
    summaryMessages({
      question: context.question,
      rosterMarkdown: context.rosterMarkdown(),
      timelineMarkdown: context.timelineMarkdown(),
      today
    }),
    { temperature: 0.5 }
  );
}
