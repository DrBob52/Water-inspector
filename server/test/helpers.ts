import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../src/config';
import { Cache } from '../src/cache';
import { FixtureStore } from '../src/fixtures';
import { FixtureUpstream, type Upstream, type UpstreamRequest } from '../src/http';
import type { AdapterCtx } from '../src/adapters/common';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

export const demoConfig = (): Config => ({
  ...loadConfig({ DEMO_MODE: '1', FIXTURES_DIR } as NodeJS.ProcessEnv),
  cacheDir: null,
});
export const liveConfig = (): Config => ({
  ...loadConfig({ FIXTURES_DIR, ATTAINS_API_KEY: 'secret-key' } as NodeJS.ProcessEnv),
  cacheDir: null,
});

export const store = () => new FixtureStore(FIXTURES_DIR);
export const newCache = () => new Cache({ dir: null });

export function demoCtx(slug?: string): AdapterCtx {
  return { config: demoConfig(), upstream: new FixtureUpstream(store()), slug };
}

type Handler = (req: UpstreamRequest) => unknown | Promise<unknown>;

/** A "live" upstream (demo: false) driven by a handler, recording every request it receives. */
export class StubUpstream implements Upstream {
  readonly demo = false;
  readonly requests: UpstreamRequest[] = [];
  constructor(private readonly handler: Handler) {}

  private async run(req: UpstreamRequest) {
    this.requests.push(req);
    return this.handler(req);
  }
  async json<T>(req: UpstreamRequest): Promise<T> {
    return (await this.run(req)) as T;
  }
  async text(req: UpstreamRequest): Promise<string> {
    const v = (await this.run(req)) as unknown;
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof (v as { body?: unknown }).body === 'string')
      return (v as { body: string }).body;
    return JSON.stringify(v);
  }
  async buffer(req: UpstreamRequest): Promise<Uint8Array> {
    return (await this.run(req)) as Uint8Array;
  }
}

/** Live-shaped upstream that answers from the fixture of one demo waterbody. */
export function fixtureBackedLive(
  slug: string,
  overrides: Handler = () => undefined,
): StubUpstream {
  const s = store();
  return new StubUpstream(async (req) => {
    const o = await overrides(req);
    if (o !== undefined) return o;
    const f = req.fixture;
    if (!f) throw new Error(`no fixture for ${req.url}`);
    if (f.root) return s.readRoot(f.file);
    if (f.all) return s.all(f.file).find((x) => x.slug === slug)?.data;
    try {
      return s.read(f.file, f.slug ?? slug, f.path);
    } catch {
      return s.read(f.file, undefined, f.path);
    }
  });
}

export const liveCtx = (upstream: Upstream, slug?: string): AdapterCtx => ({
  config: liveConfig(),
  upstream,
  slug,
  now: () => new Date('2026-09-30T12:00:00Z'),
});
