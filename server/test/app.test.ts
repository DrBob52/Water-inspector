import { describe, expect, it } from 'vitest';
import type { DemGrid, IdentityResponse, WaterbodyProfile } from '@wi/shared';
import { createApp } from '../src/app';
import { Cache } from '../src/cache';
import {
  StubUpstream,
  demoConfig,
  liveConfig,
  newCache,
  store,
  fixtureBackedLive,
} from './helpers';

const demoApp = () => createApp({ config: demoConfig(), cache: newCache(), store: store() });
const ID = encodeURIComponent('nhd:demo-lake-champlain');

describe('API in demo mode', () => {
  it('reports health and demo mode', async () => {
    const res = await demoApp().request('/api/health');
    expect(await res.json()).toMatchObject({ ok: true, demo: true });
  });
  it('lists the six demo waterbodies', async () => {
    const j = (await (await demoApp().request('/api/demo/waterbodies')).json()) as {
      waterbodies: Array<{ name: string; id: string }>;
    };
    expect(j.waterbodies).toHaveLength(6);
    expect(j.waterbodies.map((w) => w.name)).toContain('Onondaga Lake');
  });
  it('serves the demo outlines as GeoJSON for the map', async () => {
    const j = (await (await demoApp().request('/api/demo/waterbodies.geojson')).json()) as {
      features: Array<{ properties: { name: string }; geometry: { type: string } }>;
    };
    expect(j.features).toHaveLength(6);
    expect(j.features.every((f) => f.geometry.type === 'Polygon')).toBe(true);
  });
  it('resolves a click on a demo lake', async () => {
    const res = await demoApp().request('/api/waterbody/at?lat=44.4&lon=-73.35');
    expect(res.status).toBe(200);
    const j = (await res.json()) as IdentityResponse;
    expect(j.identity.id).toBe('nhd:demo-lake-champlain');
    expect(j.demo).toBe(true);
    expect(j.provenance.note).toMatch(/Illustrative sample data, not live measurements/);
  });
  it('answers clicks elsewhere with "Live data is off in demo mode"', async () => {
    const res = await demoApp().request('/api/waterbody/at?lat=36&lon=-100');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: 'demo_mode',
      message: 'Live data is off in demo mode',
    });
  });
  it('rejects bad coordinates', async () => {
    expect((await demoApp().request('/api/waterbody/at?lat=abc&lon=1')).status).toBe(400);
    expect((await demoApp().request('/api/waterbody/at?lat=95&lon=1')).status).toBe(400);
    expect((await demoApp().request('/api/search?q=a')).status).toBe(400);
  });
  it('returns the full profile with every section and a flat sources list', async () => {
    const res = await demoApp().request(`/api/waterbody/${ID}/profile`);
    const p = (await res.json()) as WaterbodyProfile;
    expect(p.demo).toBe(true);
    expect(p.identity.name).toBe('Lake Champlain');
    for (const k of ['physical', 'quality', 'impairments', 'life', 'stations'] as const)
      expect(p[k].status).toBe('ok');
    expect(p.sources.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'geometry',
        'physical',
        'stations',
        'quality',
        'usgs',
        'impairments',
        'life',
        'nas',
      ]),
    );
    expect(p.life.data!.some((s) => s.introduced)).toBe(true);
  });
  it('serves each section on its own', async () => {
    const app = demoApp();
    for (const s of ['physical', 'quality', 'life', 'impairments', 'stations']) {
      const res = await app.request(`/api/waterbody/${ID}/${s}`);
      expect(res.status, s).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe('ok');
    }
  });
  it('serves the demo DEM grid', async () => {
    const g = (await (await demoApp().request(`/api/waterbody/${ID}/dem`)).json()) as DemGrid;
    expect(g.elevations.length).toBe(g.width * g.height);
  });
  it('returns 404 for unknown waterbodies and routes', async () => {
    const app = demoApp();
    expect((await app.request('/api/waterbody/nhd%3Ademo-atlantis')).status).toBe(404);
    expect((await app.request('/api/nope')).status).toBe(404);
  });
  it('searches places', async () => {
    const j = (await (await demoApp().request('/api/search?q=burlington')).json()) as {
      status: string;
      data: Array<{ name: string }>;
    };
    expect(j.status).toBe('ok');
    expect(j.data[0].name).toBe('Burlington');
  });
});

describe('profile fan-out', () => {
  it('returns partial results when one source fails, and never caches the failure', async () => {
    let failGbif = true;
    const up = fixtureBackedLive('lake-tahoe', (req) => {
      if (req.url.includes('api.gbif.org') && failGbif) throw new Error('GBIF responded 503');
      return undefined;
    });
    const app = createApp({
      config: { ...liveConfig(), demo: false },
      upstream: up,
      cache: new Cache(),
      store: store(),
    });
    // Put the waterbody in the identity store through a click.
    const hit = await app.request('/api/waterbody/at?lat=39.1&lon=-120.02');
    expect(hit.status).toBe(200);
    const id = encodeURIComponent(((await hit.json()) as IdentityResponse).identity.id);
    const p1 = (await (
      await app.request(`/api/waterbody/${id}/profile`)
    ).json()) as WaterbodyProfile;
    expect(p1.life.status).toBe('error');
    expect(p1.life.error).toMatch(/503/);
    expect(p1.quality.status).toBe('ok');
    expect(p1.impairments.status).toBe('ok');
    expect(p1.demo).toBe(false);
    failGbif = false;
    const p2 = (await (
      await app.request(`/api/waterbody/${id}/profile`)
    ).json()) as WaterbodyProfile;
    expect(p2.life.status).toBe('ok');
  });
  it('times out a hanging adapter at 8 s without blanking the profile', async () => {
    const up = fixtureBackedLive('crater-lake', async (req) => {
      if (req.url.includes('api.gbif.org')) await new Promise(() => undefined);
      return undefined;
    });
    const cfg = { ...liveConfig(), adapterTimeoutMs: 150 };
    const app = createApp({ config: cfg, upstream: up, cache: new Cache(), store: store() });
    const hit = await app.request('/api/waterbody/at?lat=42.94&lon=-122.1');
    const id = encodeURIComponent(((await hit.json()) as IdentityResponse).identity.id);
    const p = (await (
      await app.request(`/api/waterbody/${id}/profile`)
    ).json()) as WaterbodyProfile;
    expect(p.life.status).toBe('error');
    expect(p.life.error).toMatch(/timed out/);
    expect(p.physical.status).toBe('ok');
  });
  it('falls back to OpenStreetMap when NHD has nothing, and labels the source', async () => {
    const overpass = {
      elements: [
        {
          type: 'way',
          id: 42,
          tags: { natural: 'water', water: 'pond', name: 'Fallback Pond' },
          geometry: [
            { lat: 10, lon: 10 },
            { lat: 10, lon: 10.01 },
            { lat: 10.01, lon: 10.01 },
            { lat: 10.01, lon: 10 },
            { lat: 10, lon: 10 },
          ],
        },
      ],
    };
    const up = new StubUpstream((req) => {
      if (req.url.endsWith('?f=pjson'))
        return {
          layers: [
            { id: 10, name: 'Waterbody' },
            { id: 9, name: 'Area' },
            { id: 4, name: 'Flowline - Large Scale' },
          ],
        };
      if (req.url.includes('/query')) return { type: 'FeatureCollection', features: [] };
      if (req.url.includes('overpass')) return overpass;
      throw new Error('unexpected ' + req.url);
    });
    const app = createApp({
      config: { ...liveConfig(), demo: false },
      upstream: up,
      cache: new Cache(),
      store: store(),
    });
    const res = await app.request('/api/waterbody/at?lat=10.005&lon=10.005');
    const j = (await res.json()) as IdentityResponse;
    expect(j.identity.id).toBe('osm:way/42');
    expect(j.identity.country).toBe('unknown');
    expect(j.provenance.source).toMatch(/OpenStreetMap/);
    // Outside the US the US-only sources are "unsupported" and the profile still loads.
    const prof = (await (
      await app.request(`/api/waterbody/${encodeURIComponent(j.identity.id)}/profile`)
    ).json()) as WaterbodyProfile;
    expect(prof.quality.status).toBe('unsupported');
    expect(prof.impairments.status).toBe('unsupported');
    expect(prof.physical.status).toBe('ok');
  });
  it('returns 404 when neither NHD nor OSM know the point', async () => {
    const up = new StubUpstream((req) => {
      if (req.url.endsWith('?f=pjson'))
        return {
          layers: [
            { id: 10, name: 'Waterbody' },
            { id: 9, name: 'Area' },
            { id: 4, name: 'Flowline - Large Scale' },
          ],
        };
      if (req.url.includes('/query')) return { type: 'FeatureCollection', features: [] };
      return { elements: [] };
    });
    const app = createApp({
      config: { ...liveConfig(), demo: false },
      upstream: up,
      cache: new Cache(),
      store: store(),
    });
    const res = await app.request('/api/waterbody/at?lat=0&lon=0');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });
});
