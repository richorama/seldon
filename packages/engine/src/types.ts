import { z } from 'zod';

export const ENTITY_TYPES = [
  'country',
  'organisation',
  'company',
  'person',
  'charity',
  'institution',
  'movement',
  'other'
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type Confidence = 'low' | 'medium' | 'high';

/** A participant in the deliberation, identified by its Wikipedia slug. */
export interface Entity {
  slug: string;
  name: string;
  type: EntityType;
  wikipediaUrl: string;
  status: 'active' | 'withdrawn';
  nominatedBy: string | null;
  firstSeenTurn: number;
}

/** A single dated statement/projected action added to the shared timeline. */
export interface Response {
  id: string;
  entitySlug: string;
  turn: number;
  /** The FUTURE date this projected event is expected, ISO 8601 (YYYY-MM-DD). */
  date: string;
  /** Markdown statement. */
  text: string;
  confidence?: Confidence;
  groundedOn?: string[];
}

export interface RunOptions {
  maxTurns: number;
  maxVagents: number;
  concurrency: number;
  grounded: boolean;
  model: string;
}

export interface RunManifest {
  question: string;
  createdAt: string;
  options: RunOptions;
  entities: Entity[];
  timeline: Response[];
  report: string | null;
  droppedNominations: string[];
  stoppedBecause: string;
  turnsRun: number;
}

// ---------------------------------------------------------------------------
// Zod schemas for validating structured LLM output.
// ---------------------------------------------------------------------------

export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const entityRefSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  type: entityTypeSchema
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const seedResultSchema = z.object({
  entities: z.array(entityRefSchema).min(1)
});
export type SeedResult = z.infer<typeof seedResultSchema>;

export const turnResultSchema = z.object({
  /** Optional private reasoning note appended to the vagent's memory. */
  memoryNote: z.string().optional().nullable(),
  /** A dated public statement to add to the timeline, or null for nothing. */
  response: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
      text: z.string().min(1),
      confidence: z.enum(['low', 'medium', 'high']).optional().nullable()
    })
    .optional()
    .nullable(),
  /** Whether this entity withdraws from the deliberation. */
  withdraw: z.boolean().optional().default(false),
  /** Additional entities this vagent nominates to join. */
  suggestEntities: z.array(entityRefSchema).optional().default([])
});
export type TurnResult = z.infer<typeof turnResultSchema>;

export function wikipediaUrl(slug: string): string {
  return `https://en.wikipedia.org/wiki/${slug}`;
}
