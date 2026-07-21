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
  /** ISO timestamp when the fact was fetched. */
  fetchedAt: string;
}

/**
 * Retrieves a current summary for an entity. v1 ships a stub; real
 * implementations (Wikipedia REST, news/search) can be dropped in later.
 */
export interface Fetcher {
  readonly name: string;
  fetch(slug: string): Promise<Fact>;
}

/**
 * The v1 stub fetcher. Reports facts as unavailable so `--ground` works
 * end-to-end without committing to a data source.
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
