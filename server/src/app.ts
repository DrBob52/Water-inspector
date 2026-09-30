import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import type { ApiErrorBody } from '@wi/shared';
import { Cache } from './cache';
import { loadConfig, type Config } from './config';
import { FixtureStore } from './fixtures';
import { DemoUnavailableError, createUpstream, type Upstream } from './http';
import { NotFoundError, WaterbodyService } from './service';
import { searchPlaces } from './adapters/nominatim';
import type { AdapterCtx } from './adapters/common';

export interface AppDeps {
  config?: Config;
  upstream?: Upstream;
  cache?: Cache;
  store?: FixtureStore;
}

export function createApp(deps: AppDeps = {}) {
  const config = deps.config ?? loadConfig();
  const cache = deps.cache ?? new Cache({ dir: config.cacheDir });
  const store = deps.store ?? new FixtureStore(config.fixturesDir);
  const upstream = deps.upstream ?? createUpstream(config, cache, store);
  const service = new WaterbodyService(config, upstream, cache, store);
  const app = new Hono();

  app.use('/api/*', cors());

  const fail = (status: 400 | 404 | 500 | 502, error: string, message: string): Response =>
    new Response(JSON.stringify({ error, message, demo: config.demo } satisfies ApiErrorBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  app.onError((err) => {
    if (err instanceof DemoUnavailableError)
      return fail(404, 'demo_mode', 'Live data is off in demo mode');
    if (err instanceof NotFoundError) return fail(404, 'not_found', err.message);
    console.error('[server]', err);
    return fail(500, 'internal', err instanceof Error ? err.message : 'Internal error');
  });

  app.get('/api/health', (c) => c.json({ ok: true, demo: config.demo, version: '1.0.0' }));

  app.get('/api/demo/waterbodies', (c) => {
    if (!config.demo) return fail(404, 'not_demo', 'Demo mode is off');
    return c.json({ demo: true, waterbodies: store.demoWaterbodies() });
  });

  app.get('/api/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return fail(400, 'bad_request', 'Query "q" must be at least 2 characters');
    const ctx: AdapterCtx = { config, upstream };
    const res = await searchPlaces(ctx, q);
    return c.json({ ...res, demo: config.demo });
  });

  app.get('/api/waterbody/at', async (c) => {
    const lat = Number(c.req.query('lat'));
    const lon = Number(c.req.query('lon'));
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      return fail(400, 'bad_request', 'lat and lon must be valid coordinates');
    }
    return c.json(await service.identityAt(lon, lat));
  });

  app.get('/api/waterbody/:id', async (c) =>
    c.json(await service.identityResponse(c.req.param('id'))),
  );
  app.get('/api/waterbody/:id/profile', async (c) =>
    c.json(await service.profile(c.req.param('id'))),
  );
  app.get('/api/waterbody/:id/physical', async (c) =>
    c.json(await service.physical(c.req.param('id'))),
  );
  app.get('/api/waterbody/:id/quality', async (c) =>
    c.json(await service.quality(c.req.param('id'))),
  );
  app.get('/api/waterbody/:id/life', async (c) => c.json(await service.life(c.req.param('id'))));
  app.get('/api/waterbody/:id/impairments', async (c) =>
    c.json(await service.impairments(c.req.param('id'))),
  );
  app.get('/api/waterbody/:id/stations', async (c) =>
    c.json(await service.stations(c.req.param('id'))),
  );
  app.get('/api/waterbody/:id/dem', async (c) => c.json(await service.dem(c.req.param('id'))));

  app.all('/api/*', () => fail(404, 'not_found', 'Unknown API route'));

  // Serve the built client when it exists (single-origin production and e2e runs).
  if (existsSync(config.staticDir)) {
    const rel = relative(process.cwd(), config.staticDir) || '.';
    app.use('/*', serveStatic({ root: rel }));
    app.get('*', serveStatic({ root: rel, path: 'index.html' }));
  }

  return Object.assign(app, { service });
}
