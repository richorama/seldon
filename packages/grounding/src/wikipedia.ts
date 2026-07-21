import type { Fact, Fetcher } from './fetcher.js';

export interface WikipediaFetcherOptions {
  /** Wikipedia language subdomain. Defaults to 'en'. */
  lang?: string;
  /** Request timeout in milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  /** User-Agent to send (Wikipedia asks clients to identify themselves). */
  userAgent?: string;
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * When a slug has no summary page (404), try to resolve it to a real title via
   * Wikipedia search before giving up (recovers real actors nominated under an
   * imperfect slug, e.g. "Anthropic_(company)" -> "Anthropic"). Defaults to true.
   */
  resolveTitles?: boolean;
  /** How many search candidates to consider when resolving a slug. Defaults to 5. */
  searchLimit?: number;
}

interface WikiSummary {
  type?: string;
  title?: string;
  description?: string;
  extract?: string;
  titles?: { canonical?: string };
  content_urls?: { desktop?: { page?: string } };
}

interface SearchResponse {
  pages?: { key?: string; title?: string }[];
}

/**
 * Grounds an entity from its English Wikipedia summary via the REST API
 * (`/api/rest_v1/page/summary/<slug>`). Returns Markdown text; reports
 * `unavailable` for missing pages, network errors or timeouts so a run can
 * proceed without grounding for that entity. When a slug 404s, it first attempts
 * to resolve it to a real title via Wikipedia search (guarded by a title match)
 * so real actors nominated under an imperfect slug are still grounded.
 */
export class WikipediaFetcher implements Fetcher {
  readonly name = 'wikipedia';
  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveTitles: boolean;
  private readonly searchLimit: number;

  constructor(options: WikipediaFetcherOptions = {}) {
    this.lang = options.lang ?? 'en';
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.userAgent = options.userAgent ?? 'seldon/0.1 (https://github.com/richorama/seldon)';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveTitles = options.resolveTitles ?? true;
    this.searchLimit = options.searchLimit ?? 5;
  }

  async fetch(slug: string): Promise<Fact> {
    const primary = await this.fetchSummary(slug);
    if (primary.status === 'ok') return primary;
    // Only try to resolve genuine 404s; transient errors fail open and retry.
    if (primary.reason !== 'not-found' || !this.resolveTitles) return primary;

    const resolved = await this.resolveSlug(slug);
    if (resolved && resolved !== slug) {
      const alt = await this.fetchSummary(resolved);
      if (alt.status === 'ok') {
        // Keep the requested slug as the cache key; expose the resolved page as
        // the canonical slug so the engine dedups/admits under the real actor.
        return { ...alt, slug, canonicalSlug: alt.canonicalSlug ?? resolved };
      }
    }
    return primary;
  }

  /** Fetch the REST summary for exactly this slug (no resolution). */
  private async fetchSummary(slug: string): Promise<Fact> {
    const url =
      `https://${this.lang}.wikipedia.org/api/rest_v1/page/summary/` +
      `${encodeURIComponent(slug)}?redirect=true`;

    try {
      const res = await this.request(url);
      if (!res.ok) {
        // 404 means the page genuinely does not exist (likely a hallucinated
        // slug); any other status is a transient/server error (fail open).
        return this.unavailable(slug, res.status === 404 ? 'not-found' : 'error');
      }

      const data = (await res.json()) as WikiSummary;
      const extract = (data.extract ?? '').trim();
      if (!extract) return this.unavailable(slug, 'error');

      return {
        slug,
        status: 'ok',
        text: this.toMarkdown(data, extract),
        source: 'wikipedia',
        url: data.content_urls?.desktop?.page ?? `https://${this.lang}.wikipedia.org/wiki/${slug}`,
        canonicalSlug: data.titles?.canonical ?? slug,
        fetchedAt: new Date().toISOString()
      };
    } catch {
      return this.unavailable(slug, 'error');
    }
  }

  /**
   * Resolve a slug with no summary page to a real page key via full-text search.
   * Returns the key of the best candidate whose title plausibly matches the
   * query, or null when nothing matches (guards against admitting an unrelated
   * page for a genuinely fabricated slug).
   */
  private async resolveSlug(slug: string): Promise<string | null> {
    const query = slug.replace(/_/g, ' ');
    const url =
      `https://${this.lang}.wikipedia.org/w/rest.php/v1/search/page?` +
      `q=${encodeURIComponent(query)}&limit=${this.searchLimit}`;
    try {
      const res = await this.request(url);
      if (!res.ok) return null;
      const data = (await res.json()) as SearchResponse;
      for (const page of data.pages ?? []) {
        if (page.key && page.title && this.titlesMatch(query, page.title)) {
          return page.key;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Whether a search-result title plausibly refers to the queried slug. Compares
   * alphanumeric-only, lower-cased forms (ignoring parenthetical qualifiers) and
   * accepts an exact match or one being contained in the other.
   */
  private titlesMatch(query: string, title: string): boolean {
    const norm = (s: string): string =>
      s
        .toLowerCase()
        .replace(/\([^)]*\)/g, '')
        .replace(/[^a-z0-9]/g, '');
    const q = norm(query);
    const t = norm(title);
    if (!q || !t) return false;
    return q === t || q.includes(t) || t.includes(q);
  }

  /** Issue a GET with the standard headers and a per-request timeout. */
  private async request(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': this.userAgent },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private toMarkdown(data: WikiSummary, extract: string): string {
    const parts: string[] = [];
    if (data.title) parts.push(`# ${data.title}`);
    if (data.description) parts.push(`_${data.description}_`);
    if (data.type === 'disambiguation') {
      parts.push('> Note: this Wikipedia title is a disambiguation page.');
    }
    parts.push(extract);
    return parts.join('\n\n');
  }

  private unavailable(slug: string, reason: 'not-found' | 'error'): Fact {
    return {
      slug,
      status: 'unavailable',
      reason,
      text: '',
      source: 'wikipedia',
      fetchedAt: new Date().toISOString()
    };
  }
}
