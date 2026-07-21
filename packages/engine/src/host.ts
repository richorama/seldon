import { randomUUID } from 'node:crypto';
import type { AttributedEffect, Runtime, Vagent, VagentHost } from '@seldon/vagents';
import type { LLMProvider } from '@seldon/llm';
import type { Fact, GroundingService } from '@seldon/grounding';
import { SharedContext, type SeldonEffect, type SeldonSnapshot } from './context.js';
import { EntityVagent } from './entity-vagent.js';
import { SkepticVagent, SKEPTIC_ID, SKEPTIC_NAME } from './skeptic-vagent.js';
import { wikipediaUrl, type EntityRef, type EntityType } from './types.js';

export interface EntityVagentHostDeps {
  context: SharedContext;
  provider: LLMProvider;
  today: string;
  grounding?: GroundingService;
  /** Include the built-in red-team skeptic vagent. */
  skeptic?: boolean;
  /** Optional per-turn hook, invoked after effects are applied. */
  onTurn?: (turn: number, responsesAdded: number, totalEntities: number) => void;
}

interface Admitted {
  ref: EntityRef;
  fact?: Fact;
}

/**
 * Binds the Seldon domain to the generic vagent runtime: builds snapshots,
 * materialises entity vagents (grounding them when enabled), and applies the
 * effects they emit — appending responses, nominating new entities under the
 * cap, and withdrawing entities that bow out.
 *
 * Entities are admitted through a single path that grounds each one once,
 * canonicalises its Wikipedia slug (resolving redirects/aliases so the same
 * real-world actor nominated under different slugs is deduplicated), and caches
 * the grounding fact for reuse at activation.
 */
export class EntityVagentHost implements VagentHost<SeldonSnapshot, SeldonEffect> {
  private readonly deps: EntityVagentHostDeps;
  private readonly admitted = new Map<string, Admitted>();
  private readonly rejected: EntityRef[] = [];
  private runtime: Runtime<SeldonSnapshot, SeldonEffect> | null = null;
  private producedThisTurn = false;

  constructor(deps: EntityVagentHostDeps) {
    this.deps = deps;
  }

  /** Wire up the runtime this host drives (needed to request/withdraw vagents). */
  bind(runtime: Runtime<SeldonSnapshot, SeldonEffect>): void {
    this.runtime = runtime;
  }

  /**
   * Register the built-in red-team vagent so it is active from turn 1. It joins
   * the roster as a non-Wikipedia entity and is exempt from grounding.
   */
  registerSkeptic(): void {
    const runtime = this.requireRuntime();
    if (!runtime.request(SKEPTIC_ID)) return;
    this.deps.context.addEntity({
      slug: SKEPTIC_ID,
      name: SKEPTIC_NAME,
      type: 'other',
      wikipediaUrl: '',
      status: 'active',
      nominatedBy: null,
      firstSeenTurn: 0
    });
  }

  /** Entities rejected because grounding found no such page (likely fabricated). */
  rejectedEntities(): EntityRef[] {
    return [...this.rejected];
  }

  /** Admit a seed entity (first turn), grounding and canonicalising its slug. */
  async admitSeed(ref: EntityRef): Promise<void> {
    await this.admit(ref, null, 0);
  }

  snapshot(turn: number): SeldonSnapshot {
    return this.deps.context.snapshot(turn);
  }

  async activate(id: string): Promise<Vagent<SeldonSnapshot, SeldonEffect>> {
    if (id === SKEPTIC_ID) {
      return new SkepticVagent({ provider: this.deps.provider, today: this.deps.today });
    }
    const admitted = this.admitted.get(id);
    const entity = this.deps.context.getEntity(id);
    const name = admitted?.ref.name ?? entity?.name ?? id;
    const type: EntityType = admitted?.ref.type ?? entity?.type ?? 'other';

    let factText: string | undefined;
    let groundedOn: string[] | undefined;
    const fact = admitted?.fact;
    if (fact && fact.status === 'ok' && fact.text) {
      factText = fact.text;
      groundedOn = [id];
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

  async apply(turn: number, effects: ReadonlyArray<AttributedEffect<SeldonEffect>>): Promise<void> {
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
            const added = await this.admit(ref, from, turn + 1);
            if (added) this.producedThisTurn = true;
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

  /**
   * Grounds and canonicalises a nominated entity, then admits it under the cap.
   * Returns true if a new entity was added to the run.
   */
  private async admit(
    ref: EntityRef,
    nominatedBy: string | null,
    firstSeenTurn: number
  ): Promise<boolean> {
    let slug = ref.slug;
    let fact: Fact | undefined;

    if (this.deps.grounding) {
      fact = await this.deps.grounding.ground(ref.slug);
      if (fact.status === 'ok' && fact.canonicalSlug) slug = fact.canonicalSlug;
      // Gate hallucinated entities: when grounding can verify existence and the
      // source has no such page ('not-found'), reject rather than deliberate.
      // Transient errors fail open (we cannot prove the entity is fictional).
      if (fact.status === 'unavailable' && fact.reason === 'not-found') {
        if (!this.rejected.some((r) => r.slug === ref.slug)) {
          this.rejected.push({ slug: ref.slug, name: ref.name, type: ref.type });
        }
        return false;
      }
    }

    // Deduplicate by (canonical) slug: same actor nominated twice is admitted once.
    if (this.deps.context.hasEntity(slug)) return false;

    const runtime = this.requireRuntime();
    if (!runtime.request(slug)) return false; // cap reached — dropped and reported

    this.admitted.set(slug, { ref: { slug, name: ref.name, type: ref.type }, fact });
    this.deps.context.addEntity({
      slug,
      name: ref.name,
      type: ref.type,
      wikipediaUrl: wikipediaUrl(slug),
      status: 'active',
      nominatedBy,
      firstSeenTurn
    });
    return true;
  }

  private requireRuntime(): Runtime<SeldonSnapshot, SeldonEffect> {
    if (!this.runtime) throw new Error('EntityVagentHost.bind(runtime) was not called');
    return this.runtime;
  }
}
