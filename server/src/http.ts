import type { Config } from './config';
import type { Cache } from './cache';
import { FixtureMissingError } from './fixtures';
import type { FixtureStore } from './fixtures';

export interface FixtureRef {
  file: string;
  slug?: string;
  /** Walk into the fixture JSON before returning it. */
  path?: string[];
  /** Return `[{slug, data}]` for every demo waterbody (used to emulate spatial queries). */
  all?: boolean;
  /** `file` is a path relative to the fixtures root rather than a per-waterbody or shared file. */
  root?: boolean;
}

export interface UpstreamRequest {
  /** Human name of the source, used in errors. */
  source: string;
  url: string;
  headers?: Record<string, string>;
  ttlMs?: number;
  fixture?: FixtureRef;
}

export interface Upstream {
  readonly demo: boolean;
  json<T = unknown>(req: UpstreamRequest): Promise<T>;
  text(req: UpstreamRequest): Promise<string>;
  buffer(req: UpstreamRequest): Promise<Uint8Array>;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class DemoUnavailableError extends Error {
  constructor(message = 'Live data is off in demo mode') {
    super(message);
    this.name = 'DemoUnavailableError';
  }
}

export function redactUrl(url: string): string {
  return url.replace(/([?&](?:api_key|apikey|key|token)=)[^&]*/gi, '$1REDACTED');
}

/** Limits concurrency per host and optionally enforces a minimum gap between request starts. */
export class HostLimiter {
  private active = new Map<string, number>();
  private queues = new Map<string, Array<() => void>>();
  private lastStart = new Map<string, number>();

  constructor(
    private readonly maxPerHost: number,
    private readonly minIntervalMs: Record<string, number> = {},
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(host);
    try {
      const gap = this.minIntervalMs[host];
      if (gap) {
        const wait = (this.lastStart.get(host) ?? 0) + gap - this.now();
        if (wait > 0) await this.sleep(wait);
        this.lastStart.set(host, this.now());
      }
      return await fn();
    } finally {
      this.release(host);
    }
  }

  private acquire(host: string): Promise<void> {
    const n = this.active.get(host) ?? 0;
    const limit = this.minIntervalMs[host] ? 1 : this.maxPerHost;
    if (n < limit) {
      this.active.set(host, n + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const q = this.queues.get(host) ?? [];
      q.push(() => {
        this.active.set(host, (this.active.get(host) ?? 0) + 1);
        resolve();
      });
      this.queues.set(host, q);
    });
  }

  private release(host: string) {
    this.active.set(host, Math.max(0, (this.active.get(host) ?? 1) - 1));
    const next = this.queues.get(host)?.shift();
    if (next) next();
  }

  activeCount(host: string) {
    return this.active.get(host) ?? 0;
  }
}

/** Live upstream: real HTTP with timeout, UA, per-host concurrency and TTL caching. */
export class HttpUpstream implements Upstream {
  readonly demo = false;
  private limiter: HostLimiter;

  constructor(
    private readonly config: Config,
    private readonly cache: Cache,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.limiter = new HostLimiter(config.maxConcurrentPerHost, config.hostMinIntervalMs);
  }

  private async fetchRaw(req: UpstreamRequest): Promise<Response> {
    const host = new URL(req.url).host;
    return this.limiter.run(host, async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.config.requestTimeoutMs);
      try {
        const res = await this.fetchImpl(req.url, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': this.config.userAgent,
            Accept: 'application/json, text/csv, */*',
            ...req.headers,
          },
        });
        if (!res.ok) throw new UpstreamError(`${req.source} responded ${res.status}`, res.status);
        return res;
      } catch (e) {
        if (e instanceof UpstreamError) throw e;
        if ((e as Error).name === 'AbortError') throw new UpstreamError(`${req.source} timed out`);
        throw new UpstreamError(`${req.source} request failed: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private cached<T>(kind: string, req: UpstreamRequest, fn: () => Promise<T>): Promise<T> {
    if (!req.ttlMs) return fn();
    return this.cache.wrap(`${kind}:${req.url}`, req.ttlMs, fn);
  }

  json<T>(req: UpstreamRequest): Promise<T> {
    return this.cached('json', req, async () => (await (await this.fetchRaw(req)).json()) as T);
  }

  text(req: UpstreamRequest): Promise<string> {
    return this.cached('text', req, async () => (await this.fetchRaw(req)).text());
  }

  async buffer(req: UpstreamRequest): Promise<Uint8Array> {
    // Binary tiles are not JSON-cacheable on disk; rely on the HTTP layer and the DEM cache above.
    return new Uint8Array(await (await this.fetchRaw(req)).arrayBuffer());
  }
}

/** Demo upstream: never touches the network; answers from the fixture store. */
export class FixtureUpstream implements Upstream {
  readonly demo = true;

  constructor(private readonly store: FixtureStore) {}

  private resolve(req: UpstreamRequest): unknown {
    const f = req.fixture;
    if (!f) throw new DemoUnavailableError();
    try {
      if (f.root) return this.store.readRoot(f.file);
      if (f.all) return this.store.all(f.file);
      return this.store.read(f.file, f.slug, f.path);
    } catch (e) {
      if (e instanceof FixtureMissingError) throw new DemoUnavailableError();
      throw e;
    }
  }

  async json<T>(req: UpstreamRequest): Promise<T> {
    return this.resolve(req) as T;
  }

  async text(req: UpstreamRequest): Promise<string> {
    const v = this.resolve(req);
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof (v as { body?: unknown }).body === 'string') {
      return (v as { body: string }).body;
    }
    return JSON.stringify(v);
  }

  async buffer(_req: UpstreamRequest): Promise<Uint8Array> {
    throw new DemoUnavailableError('Binary tiles are not available in demo mode');
  }
}

export function createUpstream(config: Config, cache: Cache, store: FixtureStore): Upstream {
  return config.demo ? new FixtureUpstream(store) : new HttpUpstream(config, cache);
}
