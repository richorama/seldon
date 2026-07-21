#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AzureOpenAIProvider, azureConfigFromEnv, type LLMProvider } from '@seldon/llm';
import { GroundingService } from '@seldon/grounding';
import {
  predict,
  manifestToMarkdown,
  entityListText,
  type PredictEvent,
  type RunOptions
} from '@seldon/engine';
import { parseArgs, HELP } from './args.js';

async function main(rawArgv: string[]): Promise<number> {
  const [command, ...rest] = rawArgv;

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command !== 'predict') {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  }

  const args = parseArgs(rest);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.question) {
    process.stderr.write('Error: a question is required.\n\n' + HELP);
    return 1;
  }

  let provider: LLMProvider;
  try {
    provider = new AzureOpenAIProvider(azureConfigFromEnv());
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  const options: RunOptions = {
    maxTurns: args.turns,
    maxVagents: args.maxAgents,
    concurrency: args.concurrency,
    grounded: args.ground,
    model: process.env.AZURE_OPENAI_DEPLOYMENT ?? 'azure-openai'
  };

  const onEvent = args.verbose ? logEvent : undefined;

  process.stderr.write(`Predicting: "${args.question}"\n`);
  const manifest = await predict({
    question: args.question,
    provider,
    options,
    grounding: args.ground ? new GroundingService() : undefined,
    seedSlugs: args.seed ?? undefined,
    onEvent
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
  } else {
    process.stdout.write('\n' + (manifest.report ?? '(no report)') + '\n');
    process.stdout.write('\nEntities involved:\n' + entityListText(manifest) + '\n');
    if (manifest.droppedNominations.length) {
      process.stdout.write(
        `\nDropped nominations (cap reached): ${manifest.droppedNominations.join(', ')}\n`
      );
    }
  }

  if (args.save !== null) {
    const dir = args.save || join('seldon-runs', timestamp());
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await writeFile(join(dir, 'report.md'), manifestToMarkdown(manifest), 'utf8');
    process.stderr.write(`\nSaved run to ${dir}/\n`);
  }

  return 0;
}

function logEvent(event: PredictEvent): void {
  if (event.type === 'seeded') {
    process.stderr.write(`  seeded ${event.entities.length} entities: ` +
      event.entities.map((e) => e.slug).join(', ') + '\n');
  } else if (event.type === 'turn-complete') {
    process.stderr.write(
      `  turn ${event.turn}: +${event.responses} response(s), ${event.entities} entities\n`
    );
  } else if (event.type === 'summarising') {
    process.stderr.write('  summarising...\n');
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`\nSeldon failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
