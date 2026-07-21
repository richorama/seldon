/** A grounding fact about an entity, keyed by its Wikipedia slug. */
export interface Fact {
  slug: string;
  /** 'ok' when text is present; 'unavailable' when no source could supply it. */
  status: 'ok' | 'unavailable';
  /** Markdown summary text (empty when unavailable). */
  text: string;
  /** Where the fact came from, e.g. 'wikipedia', 'stub'. */
  source: string;
  /** Source URL, when applicable. */
  url?: string;
  /**
   * The canonical slug for this entity, after resolving redirects/aliases.
   * Used to deduplicate entities nominated under different slugs. Undefined
   * when the source cannot canonicalise (e.g. the stub).
   */
  canonicalSlug?: string;
  /** ISO timestamp when the fact was fetched. */
  fetchedAt: string;
}

/**
 * Retrieves a current summary for an entity. `WikipediaFetcher` is the default
 * real implementation; other sources (news/search) can be dropped in later.
 */
export interface Fetcher {
  readonly name: string;
  fetch(slug: string): Promise<Fact>;
}

/**
 * A fallback fetcher that reports every fact as unavailable. Used as the default
 * when no real fetcher is wired in, so grounding is a no-op rather than an error.
 */
export class StubFetcher implements Fetcher {
  readonly name = 'stub';

  async fetch(slug: string): Promise<Fact> {
    return {
      slug,
      status: 'unavailable',
      text: '',
      source: 'stub',
      fetchedAt: new Date().toISOString()
    };
  }
}
