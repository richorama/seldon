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
    expect(fact.text).toBe('');
  });

  it('reports unavailable when the extract is empty', async () => {
    const fetcher = new WikipediaFetcher({
      fetchImpl: async () => jsonResponse({ type: 'standard', title: 'X', extract: '   ' })
    });
    expect((await fetcher.fetch('X')).status).toBe('unavailable');
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
    expect((await fetcher.fetch('Anything')).status).toBe('unavailable');
  });
});
