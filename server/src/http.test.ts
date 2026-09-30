import { describe, expect, it } from 'vitest';
import { Cache } from './cache';
import { HostLimiter, HttpUpstream, UpstreamError, redactUrl } from './http';
import { demoConfig } from '../test/helpers';

describe('redactUrl', () => {
  it('hides API keys', () => {
    expect(redactUrl('https://api.epa.gov/attains/assessments?x=1&api_key=SECRET&y=2')).toBe(
      'https://api.epa.gov/attains/assessments?x=1&api_key=REDACTED&y=2',
    );
  });
});

describe('HostLimiter', () => {
  it('runs at most 2 requests at once per host', async () => {
    const lim = new HostLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      lim.run('a.example', async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
      });
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(2);
  });
  it('limits hosts independently', async () => {
    const lim = new HostLimiter(1);
    let active = 0;
    let peak = 0;
    const t = (h: string) =>
      lim.run(h, async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
      });
    await Promise.all([t('a'), t('b'), t('a'), t('b')]);
    expect(peak).toBe(2);
  });
  it('enforces a minimum interval between starts for polite hosts', async () => {
    let now = 10_000;
    const sleeps: number[] = [];
    const lim = new HostLimiter(
      2,
      { 'nominatim.test': 1000 },
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      () => now,
    );
    await lim.run('nominatim.test', async () => undefined);
    await lim.run('nominatim.test', async () => undefined);
    await lim.run('nominatim.test', async () => undefined);
    expect(sleeps).toEqual([1000, 1000]);
  });
});

describe('HttpUpstream', () => {
  const mk = (fetchImpl: typeof fetch, cache = new Cache()) =>
    new HttpUpstream({ ...demoConfig(), demo: false, requestTimeoutMs: 50 }, cache, fetchImpl);

  it('sends a descriptive User-Agent with the repo URL', async () => {
    let ua = '';
    const up = mk((async (_u: unknown, init: RequestInit) => {
      ua = (init.headers as Record<string, string>)['User-Agent'];
      return new Response('{"a":1}', { status: 200 });
    }) as typeof fetch);
    expect(await up.json({ source: 't', url: 'https://x.test/a' })).toEqual({ a: 1 });
    expect(ua).toContain('https://github.com/DrBob52/Water-inspector-');
  });
  it('reports non-2xx as an UpstreamError with the status', async () => {
    const up = mk((async () => new Response('no', { status: 503 })) as typeof fetch);
    await expect(up.json({ source: 'WQP', url: 'https://x.test/a' })).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 503,
    });
  });
  it('times out slow upstreams', async () => {
    const up = mk(
      ((_u: unknown, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        })) as typeof fetch,
    );
    await expect(up.json({ source: 'GBIF', url: 'https://x.test/slow' })).rejects.toThrow(
      /timed out/,
    );
  });
  it('caches responses for the requested TTL', async () => {
    let calls = 0;
    const up = mk((async () => {
      calls++;
      return new Response('{"n":1}');
    }) as typeof fetch);
    const req = { source: 't', url: 'https://x.test/c', ttlMs: 60_000 };
    await up.json(req);
    await up.json(req);
    expect(calls).toBe(1);
  });
  it('wraps network failures', async () => {
    const up = mk((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(up.json({ source: 'NAS', url: 'https://x.test/n' })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});
