import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactCache } from './cache.js';
import { GroundingService } from './service.js';
import { StubFetcher } from './fetcher.js';
import type { Fact, Fetcher } from './fetcher.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'seldon-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function okFact(slug: string, text: string, fetchedAt: string): Fact {
  return { slug, status: 'ok', text, source: 'test', url: `u/${slug}`, fetchedAt };
}

describe('FactCache', () => {
  it('round-trips a fact through JSON metadata + Markdown body', async () => {
    const cache = new FactCache({ dir });
    await cache.set(okFact('European_Union', '# EU\nA union.', new Date().toISOString()));
    const got = await cache.get('European_Union');
    expect(got?.status).toBe('ok');
    expect(got?.text).toBe('# EU\nA union.');
    expect(got?.url).toBe('u/European_Union');
  });

  it('persists the canonical slug through the cache round-trip', async () => {
    const cache = new FactCache({ dir });
    const fact = okFact('U.S._Department_of_Energy', 'body', new Date().toISOString());
    fact.canonicalSlug = 'United_States_Department_of_Energy';
    await cache.set(fact);
    const got = await cache.get('U.S._Department_of_Energy');
    expect(got?.canonicalSlug).toBe('United_States_Department_of_Energy');
  });

  it('returns null for a missing slug', async () => {
    const cache = new FactCache({ dir });
    expect(await cache.get('Nope')).toBeNull();
  });

  it('treats entries older than the TTL as stale', async () => {
    const old = new Date('2020-01-01T00:00:00Z').toISOString();
    const cache = new FactCache({ dir, ttlDays: 7, now: () => new Date('2020-02-01T00:00:00Z') });
    await cache.set(okFact('Old', 'stale', old));
    expect(await cache.get('Old')).toBeNull();
  });

  it('handles slugs with unsafe filename characters', async () => {
    const cache = new FactCache({ dir });
    await cache.set(okFact('a/b:c', 'body', new Date().toISOString()));
    expect((await cache.get('a/b:c'))?.text).toBe('body');
  });

  it('treats entries written by an older schema version as absent', async () => {
    const cache = new FactCache({ dir });
    // Simulate a pre-resolver cache file (no schema field).
    const legacy = {
      slug: 'Old_Entry',
      status: 'unavailable',
      reason: 'not-found',
      source: 'wikipedia',
      fetchedAt: new Date().toISOString()
    };
    await writeFile(join(dir, 'Old_Entry.json'), JSON.stringify(legacy), 'utf8');
    expect(await cache.get('Old_Entry')).toBeNull();
  });
});

describe('GroundingService', () => {
  it('fetches on a miss then serves from cache on the next call', async () => {
    let fetches = 0;
    const fetcher: Fetcher = {
      name: 'counting',
      fetch: async (slug) => {
        fetches++;
        return okFact(slug, `text-${slug}`, new Date().toISOString());
      }
    };
    const service = new GroundingService(fetcher, new FactCache({ dir }));
    const a = await service.ground('X');
    const b = await service.ground('X');
    expect(a.text).toBe('text-X');
    expect(b.text).toBe('text-X');
    expect(fetches).toBe(1);
  });

  it('the stub fetcher reports facts as unavailable', async () => {
    const service = new GroundingService(new StubFetcher(), new FactCache({ dir }));
    const fact = await service.ground('Anything');
    expect(fact.status).toBe('unavailable');
    expect(fact.text).toBe('');
  });

  it('caches stable not-found results (no re-fetch)', async () => {
    let fetches = 0;
    const fetcher: Fetcher = {
      name: 'nf',
      fetch: async (slug) => {
        fetches++;
        return {
          slug,
          status: 'unavailable',
          reason: 'not-found',
          text: '',
          source: 'test',
          fetchedAt: new Date().toISOString()
        };
      }
    };
    const service = new GroundingService(fetcher, new FactCache({ dir }));
    await service.ground('Ghost');
    await service.ground('Ghost');
    expect(fetches).toBe(1);
  });

  it('does not cache transient errors (re-fetches next time)', async () => {
    let fetches = 0;
    const fetcher: Fetcher = {
      name: 'err',
      fetch: async (slug) => {
        fetches++;
        return {
          slug,
          status: 'unavailable',
          reason: 'error',
          text: '',
          source: 'test',
          fetchedAt: new Date().toISOString()
        };
      }
    };
    const service = new GroundingService(fetcher, new FactCache({ dir }));
    await service.ground('Flaky');
    await service.ground('Flaky');
    expect(fetches).toBe(2);
  });
});
