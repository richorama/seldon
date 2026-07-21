import { FactCache } from './cache.js';
import type { Fact, Fetcher } from './fetcher.js';
import { StubFetcher } from './fetcher.js';

/**
 * Cache-first grounding: returns a cached fact when fresh, otherwise fetches,
 * caches, and returns it.
 */
export class GroundingService {
  private readonly fetcher: Fetcher;
  private readonly cache: FactCache;

  constructor(fetcher: Fetcher = new StubFetcher(), cache: FactCache = new FactCache()) {
    this.fetcher = fetcher;
    this.cache = cache;
  }

  async ground(slug: string): Promise<Fact> {
    const cached = await this.cache.get(slug);
    if (cached) return cached;
    const fact = await this.fetcher.fetch(slug);
    // Cache successes and stable "not-found" results, but not transient errors,
    // so a flaky fetch is retried on the next run rather than sticking.
    if (fact.status === 'ok' || fact.reason === 'not-found') {
      await this.cache.set(fact);
    }
    return fact;
  }
}
