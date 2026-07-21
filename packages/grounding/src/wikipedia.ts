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
}

interface WikiSummary {
  type?: string;
  title?: string;
  description?: string;
  extract?: string;
  titles?: { canonical?: string };
  content_urls?: { desktop?: { page?: string } };
}

/**
 * Grounds an entity from its English Wikipedia summary via the REST API
 * (`/api/rest_v1/page/summary/<slug>`). Returns Markdown text; reports
 * `unavailable` for missing pages, network errors or timeouts so a run can
 * proceed without grounding for that entity.
 */
export class WikipediaFetcher implements Fetcher {
  readonly name = 'wikipedia';
  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WikipediaFetcherOptions = {}) {
    this.lang = options.lang ?? 'en';
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.userAgent = options.userAgent ?? 'seldon/0.1 (https://github.com/richorama/seldon)';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetch(slug: string): Promise<Fact> {
    const url =
      `https://${this.lang}.wikipedia.org/api/rest_v1/page/summary/` +
      `${encodeURIComponent(slug)}?redirect=true`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': this.userAgent },
        signal: controller.signal
      });
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
