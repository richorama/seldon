import { randomUUID } from 'node:crypto';
import type { AttributedEffect, Runtime, Vagent, VagentHost } from '@seldon/vagents';
import type { LLMProvider } from '@seldon/llm';
import type { GroundingService } from '@seldon/grounding';
import { SharedContext, type SeldonEffect, type SeldonSnapshot } from './context.js';
import { EntityVagent } from './entity-vagent.js';
import { wikipediaUrl, type Entity, type EntityRef } from './types.js';

export interface EntityVagentHostDeps {
  context: SharedContext;
  provider: LLMProvider;
  today: string;
  grounding?: GroundingService;
  /** Optional per-turn hook, invoked after effects are applied. */
  onTurn?: (turn: number, responsesAdded: number, totalEntities: number) => void;
}

/**
 * Binds the Seldon domain to the generic vagent runtime: builds snapshots,
 * materialises entity vagents (grounding them when enabled), and applies the
 * effects they emit — appending responses, nominating new entities under the
 * cap, and withdrawing entities that bow out.
 */
export class EntityVagentHost implements VagentHost<SeldonSnapshot, SeldonEffect> {
  private readonly deps: EntityVagentHostDeps;
  private readonly meta = new Map<string, EntityRef>();
  private runtime: Runtime<SeldonSnapshot, SeldonEffect> | null = null;
  private producedThisTurn = false;

  constructor(deps: EntityVagentHostDeps) {
    this.deps = deps;
  }

  /** Wire up the runtime this host drives (needed to request/withdraw vagents). */
  bind(runtime: Runtime<SeldonSnapshot, SeldonEffect>): void {
    this.runtime = runtime;
  }

  /** Register a seed entity and queue it for activation. */
  registerSeed(entity: Entity): void {
    this.deps.context.addEntity(entity);
    this.meta.set(entity.slug, { slug: entity.slug, name: entity.name, type: entity.type });
    this.requireRuntime().request(entity.slug);
  }

  snapshot(turn: number): SeldonSnapshot {
    return this.deps.context.snapshot(turn);
  }

  async activate(id: string): Promise<Vagent<SeldonSnapshot, SeldonEffect>> {
    const ref = this.meta.get(id);
    const entity = this.deps.context.getEntity(id);
    const name = ref?.name ?? entity?.name ?? id;
    const type = ref?.type ?? entity?.type ?? 'other';

    let factText: string | undefined;
    let groundedOn: string[] | undefined;
    if (this.deps.grounding) {
      const fact = await this.deps.grounding.ground(id);
      if (fact.status === 'ok' && fact.text) {
        factText = fact.text;
        groundedOn = [id];
      }
    }

    return new EntityVagent({
      entity: entity ?? {
        slug: id,
        name,
        type,
        wikipediaUrl: wikipediaUrl(id),
        status: 'active',
        nominatedBy: null,
        firstSeenTurn: 0
      },
      provider: this.deps.provider,
      today: this.deps.today,
      factText,
      groundedOn
    });
  }

  apply(turn: number, effects: ReadonlyArray<AttributedEffect<SeldonEffect>>): void {
    this.producedThisTurn = false;
    const runtime = this.requireRuntime();
    let responsesAdded = 0;

    for (const { from, effect } of effects) {
      switch (effect.kind) {
        case 'add-response': {
          this.deps.context.addResponse({
            id: randomUUID(),
            entitySlug: from,
            turn,
            date: effect.date,
            text: effect.text,
            confidence: effect.confidence,
            groundedOn: effect.groundedOn
          });
          this.producedThisTurn = true;
          responsesAdded++;
          break;
        }
        case 'suggest-entities': {
          for (const ref of effect.entities) {
            if (this.deps.context.hasEntity(ref.slug)) continue;
            const accepted = runtime.request(ref.slug);
            if (!accepted) continue;
            this.meta.set(ref.slug, ref);
            this.deps.context.addEntity({
              slug: ref.slug,
              name: ref.name,
              type: ref.type,
              wikipediaUrl: wikipediaUrl(ref.slug),
              status: 'active',
              nominatedBy: from,
              firstSeenTurn: turn + 1
            });
            this.producedThisTurn = true;
          }
          break;
        }
        case 'withdraw': {
          this.deps.context.setStatus(from, 'withdrawn');
          runtime.withdraw(from);
          break;
        }
        case 'no-response':
          break;
      }
    }

    this.deps.onTurn?.(turn, responsesAdded, this.deps.context.entityList().length);
  }

  /** Stop when a full turn produced no new responses or nominations (quiescence). */
  isComplete(_turn: number): boolean {
    return !this.producedThisTurn;
  }

  private requireRuntime(): Runtime<SeldonSnapshot, SeldonEffect> {
    if (!this.runtime) throw new Error('EntityVagentHost.bind(runtime) was not called');
    return this.runtime;
  }
}
