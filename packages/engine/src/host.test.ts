import { describe, it, expect } from 'vitest';
import type { Fact, GroundingService } from '@seldon/grounding';
import type { LLMProvider } from '@seldon/llm';
import type { Runtime } from '@seldon/vagents';
import { SharedContext, type SeldonEffect, type SeldonSnapshot } from './context.js';
import { EntityVagentHost } from './host.js';

/** Minimal fake runtime: always accepts requests, tracks ids. */
function fakeRuntime() {
  const requested: string[] = [];
  const withdrawn: string[] = [];
  const runtime = {
    request(id: string) {
      requested.push(id);
      return true;
    },
    withdraw(id: string) {
      withdrawn.push(id);
    }
  } as unknown as Runtime<SeldonSnapshot, SeldonEffect>;
  return { runtime, requested, withdrawn };
}

/** Grounding stub that maps aliases to a shared canonical slug. */
function aliasGrounding(map: Record<string, string>): GroundingService {
  return {
    async ground(slug: string): Promise<Fact> {
      const canonical = map[slug] ?? slug;
      return {
        slug,
        canonicalSlug: canonical,
        status: 'ok',
        text: `Background on ${canonical}.`,
        source: 'test',
        fetchedAt: new Date().toISOString()
      };
    }
  } as unknown as GroundingService;
}

const provider = {} as LLMProvider;

describe('EntityVagentHost admission', () => {
  it('deduplicates aliases by canonical slug when grounding is enabled', async () => {
    const context = new SharedContext('Q?');
    const grounding = aliasGrounding({
      'U.S._Department_of_Energy': 'United_States_Department_of_Energy'
    });
    const host = new EntityVagentHost({ context, provider, today: '2025-01-01', grounding });
    const { runtime, requested } = fakeRuntime();
    host.bind(runtime);

    await host.admitSeed({
      slug: 'United_States_Department_of_Energy',
      name: 'US DOE',
      type: 'organisation'
    });
    // Same actor nominated under an alias slug: must not create a second entity.
    const added = await host['admit'](
      { slug: 'U.S._Department_of_Energy', name: 'DOE', type: 'organisation' },
      'someone',
      1
    );

    expect(added).toBe(false);
    expect(context.entityList()).toHaveLength(1);
    expect(context.entityList()[0].slug).toBe('United_States_Department_of_Energy');
    expect(requested).toEqual(['United_States_Department_of_Energy']);
  });

  it('activates using the canonical slug and reuses the grounding fact', async () => {
    const context = new SharedContext('Q?');
    const grounding = aliasGrounding({ Alias_X: 'Canonical_X' });
    const host = new EntityVagentHost({ context, provider, today: '2025-01-01', grounding });
    const { runtime } = fakeRuntime();
    host.bind(runtime);

    await host.admitSeed({ slug: 'Alias_X', name: 'X', type: 'company' });

    expect(context.hasEntity('Canonical_X')).toBe(true);
    const vagent = await host.activate('Canonical_X');
    expect(vagent.id).toBe('Canonical_X');
  });
});
