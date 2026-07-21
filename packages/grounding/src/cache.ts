import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from './fetcher.js';

interface FactMeta {
  slug: string;
  status: Fact['status'];
  source: string;
  url?: string;
  fetchedAt: string;
}

export interface FactCacheOptions {
  /** Root directory for the cache. Defaults to ~/.seldon/cache/facts. */
  dir?: string;
  /** Time-to-live in days before a cached fact is considered stale. */
  ttlDays?: number;
  /** Injectable clock for testing. */
  now?: () => Date;
}

/**
 * Persistent, TTL-aware cache for grounding facts. Predictions are ephemeral,
 * but facts are expensive to fetch and reusable, so they are cached to disk as
 * a JSON metadata file plus a Markdown body per slug.
 */
export class FactCache {
  private readonly dir: string;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(options: FactCacheOptions = {}) {
    this.dir = options.dir ?? join(homedir(), '.seldon', 'cache', 'facts');
    this.ttlMs = (options.ttlDays ?? 7) * 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  /** Returns a fresh cached fact, or null if absent or stale. */
  async get(slug: string): Promise<Fact | null> {
    let metaRaw: string;
    try {
      metaRaw = await readFile(this.metaPath(slug), 'utf8');
    } catch {
      return null;
    }
    const meta = JSON.parse(metaRaw) as FactMeta;
    if (this.isStale(meta.fetchedAt)) return null;

    let text = '';
    if (meta.status === 'ok') {
      try {
        text = await readFile(this.bodyPath(slug), 'utf8');
      } catch {
        return null;
      }
    }
    return { ...meta, text };
  }

  /** Persists a fact (metadata JSON + Markdown body). */
  async set(fact: Fact): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const meta: FactMeta = {
      slug: fact.slug,
      status: fact.status,
      source: fact.source,
      url: fact.url,
      fetchedAt: fact.fetchedAt
    };
    await writeFile(this.metaPath(fact.slug), JSON.stringify(meta, null, 2), 'utf8');
    await writeFile(this.bodyPath(fact.slug), fact.text, 'utf8');
  }

  private isStale(fetchedAt: string): boolean {
    const age = this.now().getTime() - new Date(fetchedAt).getTime();
    return age > this.ttlMs;
  }

  private metaPath(slug: string): string {
    return join(this.dir, `${safe(slug)}.json`);
  }

  private bodyPath(slug: string): string {
    return join(this.dir, `${safe(slug)}.md`);
  }
}

/** Make a slug safe for use as a filename. */
function safe(slug: string): string {
  return slug.replace(/[^A-Za-z0-9_.-]/g, '_');
}
