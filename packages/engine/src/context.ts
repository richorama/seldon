import type { Confidence, Entity, EntityRef, Response } from './types.js';

/** The domain effect union emitted by entity vagents each turn. */
export type SeldonEffect =
  | {
      kind: 'add-response';
      date: string;
      text: string;
      confidence?: Confidence;
      groundedOn?: string[];
    }
  | { kind: 'no-response' }
  | { kind: 'withdraw' }
  | { kind: 'suggest-entities'; entities: EntityRef[] };

/** The read-only snapshot handed to every vagent each turn. */
export interface SeldonSnapshot {
  question: string;
  turn: number;
  rosterMarkdown: string;
  timelineMarkdown: string;
}

/**
 * Holds the mutable shared state of a run: the entity roster and the timeline of
 * dated responses. Renders Markdown views for prompts and reports.
 */
export class SharedContext {
  readonly question: string;
  private readonly entities = new Map<string, Entity>();
  private readonly responses: Response[] = [];

  constructor(question: string) {
    this.question = question;
  }

  addEntity(entity: Entity): void {
    if (!this.entities.has(entity.slug)) this.entities.set(entity.slug, entity);
  }

  hasEntity(slug: string): boolean {
    return this.entities.has(slug);
  }

  getEntity(slug: string): Entity | undefined {
    return this.entities.get(slug);
  }

  setStatus(slug: string, status: Entity['status']): void {
    const entity = this.entities.get(slug);
    if (entity) entity.status = status;
  }

  addResponse(response: Response): void {
    this.responses.push(response);
  }

  entityList(): Entity[] {
    return [...this.entities.values()];
  }

  /** Responses sorted by their projected future date (then by turn). */
  timeline(): Response[] {
    return [...this.responses].sort((a, b) =>
      a.date === b.date ? a.turn - b.turn : a.date < b.date ? -1 : 1
    );
  }

  rosterMarkdown(): string {
    const rows = this.entityList().map((e) => {
      const flag = e.status === 'withdrawn' ? ' _(withdrawn)_' : '';
      return `- **${e.name}** (\`${e.slug}\`, ${e.type})${flag}`;
    });
    return rows.length ? rows.join('\n') : '_No entities yet._';
  }

  timelineMarkdown(): string {
    const timeline = this.timeline();
    if (timeline.length === 0) return '_No projected events yet._';
    return timeline
      .map((r) => {
        const entity = this.entities.get(r.entitySlug);
        const name = entity?.name ?? r.entitySlug;
        const conf = r.confidence ? ` _(confidence: ${r.confidence})_` : '';
        return `### ${r.date} — ${name}${conf}\n\n${r.text}`;
      })
      .join('\n\n');
  }

  snapshot(turn: number): SeldonSnapshot {
    return {
      question: this.question,
      turn,
      rosterMarkdown: this.rosterMarkdown(),
      timelineMarkdown: this.timelineMarkdown()
    };
  }
}
