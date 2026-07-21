import type { LLMMessage } from '@seldon/llm';
import { ENTITY_TYPES, type Entity } from './types.js';
import type { SeldonSnapshot } from './context.js';

const TYPES = ENTITY_TYPES.join(', ');

export function seedMessages(question: string, today: string): LLMMessage[] {
  return [
    {
      role: 'system',
      content:
        "You are the seeding step of a prediction engine inspired by Asimov's psychohistory. " +
        'Given a question or news item, identify the entities most likely to be involved in, ' +
        'or to respond to, the situation. Entities are real-world actors that plausibly have a ' +
        'Wikipedia page: countries, leaders/persons, companies, organisations, charities, ' +
        'institutions or movements. Use canonical English Wikipedia slugs (the part after ' +
        '/wiki/, using underscores), e.g. "United_Nations", "European_Union", "OpenAI".\n' +
        `Today is ${today}. Reason about who matters for what comes next.`
    },
    {
      role: 'user',
      content:
        `Question / news item:\n"""${question}"""\n\n` +
        'Return 3-7 seed entities as JSON of exactly this shape:\n' +
        '{"entities":[{"slug":"Wikipedia_Slug","name":"Display Name","type":"<type>"}]}\n' +
        `Valid types: ${TYPES}. Return ONLY the JSON object.`
    }
  ];
}

export function entityTurnMessages(params: {
  entity: Entity;
  snapshot: SeldonSnapshot;
  memory: readonly string[];
  today: string;
  factText?: string;
}): LLMMessage[] {
  const { entity, snapshot, memory, today, factText } = params;
  const factBlock =
    factText && factText.trim()
      ? `\nBackground on you (grounding):\n"""${factText.trim()}"""\n`
      : '';
  const memoryBlock = memory.length
    ? `\nYour private notes so far:\n${memory.map((m) => `- ${m}`).join('\n')}\n`
    : '';

  return [
    {
      role: 'system',
      content:
        `You are role-playing the real-world entity "${entity.name}" ` +
        `(Wikipedia slug: ${entity.slug}, type: ${entity.type}) inside a multi-agent ` +
        'prediction simulation. Respond ONLY as this entity would plausibly act, given its ' +
        'known interests, incentives and character. Stay in character; surface genuine ' +
        'conflicts of interest rather than bland agreement.\n' +
        'Contribute ONLY when you have something new and material to add — a fresh action, ' +
        'a distinct stance, a reaction to another entity, or a genuinely missing entity. ' +
        'Simulation resources are limited: do not restate what is already in the timeline, ' +
        'do not echo or agree with others for its own sake, and do not pad. If you have ' +
        'nothing new to contribute this turn, stay silent (null response); if you have no ' +
        'further role to play in this scenario at all, withdraw so resources go elsewhere.\n' +
        `Today is ${today}. When you add a response, describe a concrete projected action or ` +
        'statement and assign it a realistic FUTURE date (after today).' +
        factBlock
    },
    {
      role: 'user',
      content:
        `The situation:\n"""${snapshot.question}"""\n\n` +
        `Current entities (turn ${snapshot.turn}):\n${snapshot.rosterMarkdown}\n\n` +
        `Projected timeline so far:\n${snapshot.timelineMarkdown}\n` +
        memoryBlock +
        '\nDecide how you (and only you) respond THIS turn. Return ONLY a JSON object:\n' +
        '{\n' +
        '  "memoryNote": "optional private reasoning to remember, or null",\n' +
        '  "response": {"date":"YYYY-MM-DD","text":"markdown statement","confidence":"low|medium|high"} or null,\n' +
        '  "withdraw": false,\n' +
        '  "suggestEntities": [{"slug":"Wikipedia_Slug","name":"Name","type":"<type>"}]\n' +
        '}\n' +
        'Set "response" to null if you have nothing new to add this turn — silence is the ' +
        'expected default unless you have a fresh, material contribution. Set "withdraw" to ' +
        'true if you have no further role to play in this scenario. Suggest entities only if ' +
        `genuinely missing. Valid types: ${TYPES}.`
    }
  ];
}

export function summaryMessages(params: {
  question: string;
  rosterMarkdown: string;
  timelineMarkdown: string;
  today: string;
}): LLMMessage[] {
  const { question, rosterMarkdown, timelineMarkdown, today } = params;
  return [
    {
      role: 'system',
      content:
        'You are the summarisation step of a psychohistory-style prediction engine. You are ' +
        'given the entities that deliberated and the projected timeline they produced. Write ' +
        'a clear, reasoned forecast in Markdown. Be explicit that this is hypothetical ' +
        'reasoning, not certainty.\n' +
        `Today is ${today}.`
    },
    {
      role: 'user',
      content:
        `Question / news item:\n"""${question}"""\n\n` +
        `Entities involved:\n${rosterMarkdown}\n\n` +
        `Projected timeline:\n${timelineMarkdown}\n\n` +
        'Write the forecast as Markdown with these sections:\n' +
        '## Executive forecast\n## Projected timeline\n## Key actors & stances\n' +
        '## Uncertainties & branch points\n## Confidence & caveats\n' +
        'Return only the Markdown report.'
    }
  ];
}
