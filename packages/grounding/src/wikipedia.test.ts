import { describe, it, expect } from 'vitest';
import { WikipediaFetcher } from './wikipedia.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response;
}

describe('WikipediaFetcher', () => {
  it('returns Markdown grounding for a standard page', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async (url) => {
        expect(String(url)).toContain('/page/summary/European_Union');
        expect(String(url)).toContain('redirect=true');
        return jsonResponse({
          type: 'standard',
          title: 'European Union',
          description: 'political and economic union',
          extract: 'The European Union is a union of 27 member states.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/European_Union' } }
        });
      }
    });
    const fact = await fetcher.fetch('European_Union');
    expect(fact.status).toBe('ok');
    expect(fact.source).toBe('wikipedia');
    expect(fact.url).toBe('https://en.wikipedia.org/wiki/European_Union');
    expect(fact.text).toContain('# European Union');
    expect(fact.text).toContain('_political and economic union_');
    expect(fact.text).toContain('27 member states');
  });

  it('reports unavailable on a 404', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async () => jsonResponse({ type: 'Internal error' }, false, 404)
    });
    const fact = await fetcher.fetch('Nonexistent_XYZ');
    expect(fact.status).toBe('unavailable');
    expect(fact.reason).toBe('not-found');
    expect(fact.text).toBe('');
  });

  it('reports unavailable when the extract is empty', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async () => jsonResponse({ type: 'standard', title: 'X', extract: '   ' })
    });
    const fact = await fetcher.fetch('X');
    expect(fact.status).toBe('unavailable');
    expect(fact.reason).toBe('error');
  });

  it('flags disambiguation pages', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async () =>
        jsonResponse({
          type: 'disambiguation',
          title: 'Mercury',
          extract: 'Mercury may refer to...'
        })
    });
    const fact = await fetcher.fetch('Mercury');
    expect(fact.status).toBe('ok');
    expect(fact.text).toContain('disambiguation');
  });

  it('reports unavailable on network error or timeout', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async () => {
        throw new Error('network down');
      }
    });
    const fact = await fetcher.fetch('Anything');
    expect(fact.status).toBe('unavailable');
    expect(fact.reason).toBe('error');
  });

  it('reports a transient error (not not-found) on a non-404 HTTP status', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async () => jsonResponse({ type: 'Internal error' }, false, 503)
    });
    const fact = await fetcher.fetch('Flaky_Page');
    expect(fact.status).toBe('unavailable');
    expect(fact.reason).toBe('error');
  });

  it('resolves a 404 slug to a real page via search (guarded by title match)', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('/summary/Anthropic_(company)')) {
          return jsonResponse(
            { type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' },
            false,
            404
          );
        }
        if (u.includes('/rest.php/v1/search/page')) {
          return jsonResponse({
            pages: [
              { key: 'Grigori_Fursin', title: 'Grigori Fursin' },
              { key: 'Anthropic', title: 'Anthropic' }
            ]
          });
        }
        if (u.includes('/summary/Anthropic?')) {
          return jsonResponse({
            type: 'standard',
            title: 'Anthropic',
            description: 'AI safety company',
            extract: 'Anthropic is an American AI startup.',
            titles: { canonical: 'Anthropic' },
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Anthropic' } }
          });
        }
        throw new Error(`unexpected url ${u}`);
      }
    });
    const fact = await fetcher.fetch('Anthropic_(company)');
    expect(fact.status).toBe('ok');
    // Cache key stays the requested slug; canonical points at the resolved page.
    expect(fact.slug).toBe('Anthropic_(company)');
    expect(fact.canonicalSlug).toBe('Anthropic');
    expect(fact.text).toContain('Anthropic is an American AI startup');
  });

  it('stays not-found when search returns only unrelated pages (fabricated slug)', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('/rest.php/v1/search/page')) {
          return jsonResponse({
            pages: [
              { key: 'Grigori_Fursin', title: 'Grigori Fursin' },
              { key: 'Federated_learning', title: 'Federated learning' }
            ]
          });
        }
        return jsonResponse({ type: 'not_found' }, false, 404);
      }
    });
    const fact = await fetcher.fetch('MLCommons');
    expect(fact.status).toBe('unavailable');
    expect(fact.reason).toBe('not-found');
  });

  it('does not resolve when resolveTitles is disabled', async () => {
    let searchCalls = 0;
    const fetcher = new WikipediaFetcher({
      resolveTitles: false,
      fetchImpl: async (url) => {
        if (String(url).includes('/search/page')) searchCalls++;
        return jsonResponse({ type: 'not_found' }, false, 404);
      }
    });
    const fact = await fetcher.fetch('Anthropic_(company)');
    expect(fact.status).toBe('unavailable');
    expect(searchCalls).toBe(0);
  });
});
