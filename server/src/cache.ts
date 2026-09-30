import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Entry<T> {
  expires: number;
  value: T;
}

export interface CacheOptions {
  maxEntries?: number;
  /** Optional directory for an on-disk JSON cache that survives restarts. */
  dir?: string | null;
  now?: () => number;
}

/**
 * In-memory LRU cache with per-entry TTL, optional on-disk JSON persistence and in-flight
 * de-duplication so concurrent callers share one upstream request.
 */
export class Cache {
  private map = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly dir: string | null;
  private readonly now: () => number;

  constructor(opts: CacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 500;
    this.dir = opts.dir ?? null;
    this.now = opts.now ?? Date.now;
    if (this.dir) {
      try {
        mkdirSync(this.dir, { recursive: true });
      } catch {
        this.dir = null;
      }
    }
  }

  private file(key: string): string | null {
    return this.dir ? join(this.dir, createHash('sha1').update(key).digest('hex') + '.json') : null;
  }

  get<T>(key: string): T | undefined {
    const hit = this.map.get(key) as Entry<T> | undefined;
    if (hit) {
      if (hit.expires > this.now()) {
        this.map.delete(key);
        this.map.set(key, hit); // refresh LRU position
        return hit.value;
      }
      this.map.delete(key);
    }
    const f = this.file(key);
    if (f) {
      try {
        const e = JSON.parse(readFileSync(f, 'utf8')) as Entry<T>;
        if (e.expires > this.now()) {
          this.setEntry(key, e);
          return e.value;
        }
      } catch {
        /* no disk entry */
      }
    }
    return undefined;
  }

  private setEntry<T>(key: string, e: Entry<T>) {
    this.map.delete(key);
    this.map.set(key, e);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  set<T>(key: string, value: T, ttlMs: number) {
    const e = { expires: this.now() + ttlMs, value };
    this.setEntry(key, e);
    const f = this.file(key);
    if (f) {
      try {
        writeFileSync(f, JSON.stringify(e));
      } catch {
        /* disk cache is best effort */
      }
    }
  }

  /** Return the cached value or compute it once, sharing the promise between concurrent callers. */
  async wrap<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
    shouldCache: (v: T) => boolean = () => true,
  ): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = fn()
      .then((v) => {
        if (shouldCache(v)) this.set(key, v, ttlMs);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
    this.inflight.clear();
  }
}
