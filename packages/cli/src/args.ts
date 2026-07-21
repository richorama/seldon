export interface ParsedArgs {
  question: string;
  turns: number;
  maxAgents: number;
  concurrency: number;
  ground: boolean;
  save: string | null; // null = don't save; '' = default path; else explicit path
  seed: string[] | null;
  json: boolean;
  verbose: boolean;
  help: boolean;
}

const DEFAULTS = {
  turns: 4,
  maxAgents: 12,
  concurrency: 4
};

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    question: '',
    turns: DEFAULTS.turns,
    maxAgents: DEFAULTS.maxAgents,
    concurrency: DEFAULTS.concurrency,
    ground: false,
    save: null,
    seed: null,
    json: false,
    verbose: false,
    help: false
  };

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--turns':
        args.turns = requireInt(arg, argv[++i]);
        break;
      case '--max-agents':
        args.maxAgents = requireInt(arg, argv[++i]);
        break;
      case '--concurrency':
        args.concurrency = requireInt(arg, argv[++i]);
        break;
      case '--ground':
        args.ground = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--seed':
        args.seed = requireValue(arg, argv[++i])
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--save':
        // Optional value: consume the next token only if it isn't another flag.
        if (argv[i + 1] && !argv[i + 1].startsWith('-')) args.save = argv[++i];
        else args.save = '';
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        positionals.push(arg);
    }
  }

  args.question = positionals.join(' ').trim();
  return args;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`Option ${flag} requires a value`);
  return value;
}

function requireInt(flag: string, value: string | undefined): number {
  const n = Number(requireValue(flag, value));
  if (!Number.isInteger(n) || n < 1) throw new Error(`Option ${flag} requires a positive integer`);
  return n;
}

export const HELP = `seldon — an LLM prediction machine inspired by Asimov's psychohistory

Usage:
  seldon predict "<question or news item>" [options]

Options:
  --turns <n>         max deliberation turns            (default ${DEFAULTS.turns})
  --max-agents <n>    hard cap on total entities         (default ${DEFAULTS.maxAgents})
  --concurrency <n>   parallel LLM calls                 (default ${DEFAULTS.concurrency})
  --ground            enable web grounding (v1: stub + disk cache)
  --seed <a,b,c>      force initial entity slugs instead of the seeding step
  --save [path]       persist manifest.json + report.md (default ./seldon-runs/<ts>)
  --json              print the run manifest as JSON to stdout
  --verbose           stream per-turn progress to stderr
  -h, --help          show this help

Azure OpenAI configuration (environment):
  AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION (optional)
`;
