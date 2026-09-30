import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { DemGrid, WaterbodyIdentity } from '@wi/shared';
import { encodeTerrarium } from '@wi/shared';
import {
  nhdIdentityAt,
  nhdIdentityById,
  pointQueryUrl,
  resolveNhdLayers,
} from '../src/adapters/nhd';
import { osmIdentityAt, overpassQuery, stitchRings } from '../src/adapters/osm';
import { normalizeSearch, searchPlaces } from '../src/adapters/nominatim';
import { wqpDate, wqpQuality, wqpStations, resultUrl, stationUrl } from '../src/adapters/wqp';
import { mergeLatest, usgsLatest } from '../src/adapters/usgs';
import { attainsImpairments, assessmentsUrl, titleCase } from '../src/adapters/attains';
import { gbifSpecies, occurrenceFacetUrl } from '../src/adapters/gbif';
import { applyIntroduced, nasIntroduced, normalizeNas } from '../src/adapters/nas';
import {
  buildPhysical,
  estimateDepthFromDem,
  estimateRiverDepth,
  loadDepthIndex,
  matchDepthIndex,
  physicalSection,
} from '../src/adapters/depth';
import { decodePngRgba, loadDemGrid } from '../src/dem';
import { DemoUnavailableError } from '../src/http';
import { FIXTURES_DIR, StubUpstream, demoCtx, fixtureBackedLive, liveCtx } from './helpers';

async function identityOf(slug: string): Promise<WaterbodyIdentity> {
  const r = await nhdIdentityById(demoCtx(slug), `nhd:demo-${slug}`);
  if (!r) throw new Error('no identity');
  return r.identity;
}

describe('NHD adapter', () => {
  it('discovers layer ids from the service description', async () => {
    const layers = await resolveNhdLayers(demoCtx());
    expect(layers).toEqual({ waterbody: 10, area: 9, flowline: 4 });
  });
  it('builds the documented point query', () => {
    const url = pointQueryUrl(
      'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer',
      10,
      -73.3,
      44.4,
      'waterbody',
      30,
    );
    const q = new URL(url).searchParams;
    expect(url).toContain('/nhd/MapServer/10/query?');
    expect(q.get('geometry')).toBe('-73.3,44.4');
    expect(q.get('geometryType')).toBe('esriGeometryPoint');
    expect(q.get('inSR')).toBe('4326');
    expect(q.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(q.get('outFields')).toBe('*');
    expect(q.get('returnGeometry')).toBe('true');
    expect(q.get('outSR')).toBe('4326');
    expect(q.get('f')).toBe('geojson');
    expect(q.get('distance')).toBeNull();
  });
  it('buffers flowline queries by 30 m', () => {
    const q = new URL(pointQueryUrl('https://x/MapServer', 4, 1, 2, 'flowline', 30)).searchParams;
    expect(q.get('distance')).toBe('30');
    expect(q.get('units')).toBe('esriSRUnit_Meter');
  });
  it('finds each demo lake at its own centroid-ish point and reads attributes', async () => {
    const hit = await nhdIdentityAt(demoCtx(), -73.3, 44.4);
    expect(hit?.identity).toMatchObject({
      id: 'nhd:demo-lake-champlain',
      name: 'Lake Champlain',
      type: 'lake',
      state: 'VT/NY',
      country: 'US',
      huc8: '04150408',
    });
    expect(hit?.slug).toBe('lake-champlain');
    expect(hit?.identity.geometry.type).toBe('Polygon');
    expect(hit?.identity.bbox[0]).toBeLessThan(hit!.identity.bbox[2]);
    const tahoe = await nhdIdentityAt(demoCtx(), -120.02, 39.1);
    expect(tahoe?.elevationM).toBe(1897);
  });
  it('returns null away from any demo waterbody', async () => {
    expect(await nhdIdentityAt(demoCtx(), -100, 40)).toBeNull();
  });
  it('finds the wide river through the Area layer', async () => {
    const hit = await nhdIdentityAt(demoCtx(), -77.0655, 38.894);
    expect(hit?.kind).toBe('area');
    expect(hit?.identity.type).toBe('river');
    expect(hit?.identity.id).toBe('nhd:demo-potomac-river-dc');
  });
  it('falls back to a buffered Flowline for narrow rivers (LineString geometry)', async () => {
    const fc = JSON.parse(
      readFileSync(join(FIXTURES_DIR, '_shared', 'nhd-flowline-only.json'), 'utf8'),
    );
    const empty = { type: 'FeatureCollection', features: [] };
    const up = new StubUpstream((req) => {
      if (req.url.endsWith('?f=pjson'))
        return {
          layers: [
            { id: 10, name: 'Waterbody' },
            { id: 9, name: 'Area' },
            { id: 4, name: 'Flowline - Large Scale' },
          ],
        };
      return req.url.includes('/4/query') ? fc : empty;
    });
    const hit = await nhdIdentityAt(liveCtx(up), -89.995, 40.002);
    expect(hit?.kind).toBe('flowline');
    expect(hit?.identity).toMatchObject({
      id: 'nhd:demo-creek',
      type: 'stream',
      name: 'Demo Creek',
    });
    expect(hit?.identity.geometry.type).toBe('LineString');
    const flowlineReq = up.requests.find((r) => r.url.includes('/4/query'))!;
    expect(flowlineReq.url).toContain('distance=30');
  });
  it('loads an identity by id and returns null for unknown ids', async () => {
    const r = await nhdIdentityById(demoCtx('crater-lake'), 'nhd:demo-crater-lake');
    expect(r?.identity.name).toBe('Crater Lake');
    expect(await nhdIdentityById(demoCtx('crater-lake'), 'nhd:demo-nope')).toBeNull();
  });
  it('simplifies very large geometries', async () => {
    const n = 8000;
    const ring = Array.from({ length: n }, (_, i) => [
      -90 + 0.05 * Math.cos((2 * Math.PI * i) / n) * (1 + 0.01 * Math.sin(50 * i)),
      40 + 0.05 * Math.sin((2 * Math.PI * i) / n),
    ]);
    ring.push(ring[0]);
    const up = new StubUpstream((req) => {
      if (req.url.endsWith('?f=pjson'))
        return {
          layers: [
            { id: 10, name: 'Waterbody' },
            { id: 9, name: 'Area' },
            { id: 4, name: 'Flowline - Large Scale' },
          ],
        };
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: {
              permanent_identifier: 'big',
              gnis_name: 'Big Lake',
              ftype: 390,
              areasqkm: 30,
            },
          },
        ],
      };
    });
    const hit = await nhdIdentityAt(liveCtx(up), -90, 40);
    expect(
      (hit!.identity.geometry as { coordinates: number[][][] }).coordinates[0].length,
    ).toBeLessThanOrEqual(3000);
  });
  it('surfaces upstream errors to the caller', async () => {
    const up = new StubUpstream((req) => {
      if (req.url.endsWith('?f=pjson'))
        return {
          layers: [
            { id: 10, name: 'Waterbody' },
            { id: 9, name: 'Area' },
            { id: 4, name: 'Flowline - Large Scale' },
          ],
        };
      throw new Error('NHD responded 500');
    });
    await expect(nhdIdentityAt(liveCtx(up), 1, 1)).rejects.toThrow(/500/);
  });
});

describe('OpenStreetMap adapter', () => {
  it('builds an Overpass query with is_in and around clauses', () => {
    const q = overpassQuery(45.5, -122.7, 30);
    expect(q).toContain('is_in(45.5,-122.7)');
    expect(q).toContain('around:30,45.5,-122.7');
    expect(q).toContain('"natural"="water"');
    expect(q).toContain('"waterway"="riverbank"');
    expect(q).toContain('out geom');
  });
  it('parses ways and multipolygon relations and prefers the smaller polygon', async () => {
    const up = fixtureBackedLive('lake-tahoe', (req) =>
      req.fixture?.file === 'overpass-sample'
        ? JSON.parse(readFileSync(join(FIXTURES_DIR, '_shared', 'overpass-sample.json'), 'utf8'))
        : undefined,
    );
    const hit = await osmIdentityAt(liveCtx(up), -122.699, 45.5007);
    expect(hit?.identity).toMatchObject({
      id: 'osm:way/123456789',
      name: 'Demo Pond',
      type: 'pond',
      country: 'US',
    });
    expect(hit?.identity.geometry.type).toBe('Polygon');
  });
  it('stitches fragments into closed rings', () => {
    const rings = stitchRings([
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });
});

describe('Nominatim adapter', () => {
  it('normalises results and swaps the bounding box into west,south,east,north', () => {
    const hits = normalizeSearch([
      {
        name: 'X',
        display_name: 'X, Y',
        lat: '10',
        lon: '20',
        boundingbox: ['9', '11', '19', '21'],
      },
    ]);
    expect(hits[0]).toMatchObject({ name: 'X', lat: 10, lon: 20, bbox: [19, 9, 21, 11] });
  });
  it('searches the demo places', async () => {
    const r = await searchPlaces(demoCtx(), 'champlain');
    expect(r.status).toBe('ok');
    expect(r.data![0].name).toBe('Lake Champlain');
    expect((await searchPlaces(demoCtx(), 'zzzzzz')).status).toBe('empty');
  });
});

describe('Water Quality Portal adapter', () => {
  it('formats dates as MM-DD-YYYY and builds the documented station and result queries', async () => {
    expect(wqpDate(new Date('2021-09-30T00:00:00Z'))).toBe('09-30-2021');
    const ctx = liveCtx(fixtureBackedLive('lake-champlain'));
    const su = new URL(
      stationUrl(ctx, 'https://www.waterqualitydata.us/data', [-73.5, 43.5, -73.1, 45.1]),
    );
    expect(su.searchParams.get('bBox')).toBe('-73.50000,43.50000,-73.10000,45.10000');
    expect(su.searchParams.get('mimeType')).toBe('geojson');
    expect(su.searchParams.getAll('providers')).toEqual(['NWIS', 'STORET']);
    expect(su.searchParams.get('startDateLo')).toBe('09-30-2021');
    const ru = new URL(resultUrl(ctx, 'https://www.waterqualitydata.us/data', ['A-1', 'A-2']));
    expect(ru.searchParams.getAll('siteid')).toEqual(['A-1', 'A-2']);
    expect(ru.searchParams.get('mimeType')).toBe('csv');
    expect(ru.searchParams.getAll('characteristicName')).toContain('Temperature, water');
  });
  it('keeps only stations inside or within 100 m of the shore', async () => {
    const id = await identityOf('lake-champlain');
    const st = await wqpStations(demoCtx('lake-champlain'), id);
    expect(st.status).toBe('ok');
    expect(st.data!.length).toBe(4);
    expect(st.data!.some((s) => s.id.endsWith('9999'))).toBe(false);
  });
  it('aggregates results end to end from the raw CSV fixture', async () => {
    const id = await identityOf('lake-champlain');
    const ctx = demoCtx('lake-champlain');
    const st = await wqpStations(ctx, id);
    const q = await wqpQuality(ctx, id, st.data!);
    expect(q.status).toBe('ok');
    const byKey = Object.fromEntries(q.data!.map((p) => [p.key, p]));
    expect(byKey.water_temp.latest!.date >= '2026-08-01').toBe(true);
    expect(byKey.water_temp.unit).toBe('°C');
    // Some stations report temperature in deg F; after conversion everything is a plausible °C value.
    expect(byKey.water_temp.max!).toBeLessThan(35);
    expect(byKey.water_temp.depthProfile!.length).toBeGreaterThanOrEqual(10);
    expect(byKey.dissolved_oxygen.depthProfile![0].value).toBeGreaterThan(
      byKey.dissolved_oxygen.depthProfile!.at(-1)!.value,
    );
    expect(byKey.total_phosphorus.threshold).toBeUndefined();
    expect(byKey.total_phosphorus.max!).toBeLessThan(1);
    expect(byKey.e_coli.threshold!.value).toBe(126);
    expect(byKey.series).toBeUndefined();
    expect(Object.values(byKey).every((p) => p.series.length <= 500)).toBe(true);
    // Rows for other characteristics, sediment and rejected results never appear.
    expect(Object.keys(byKey)).not.toContain('calcium');
  });
  it('is empty when there are no stations and errors cleanly when the upstream fails', async () => {
    const id = await identityOf('crater-lake');
    expect((await wqpQuality(demoCtx('crater-lake'), id, [])).status).toBe('empty');
    const failing = new StubUpstream(() => {
      throw new Error('WQP responded 503');
    });
    const st = await wqpStations(liveCtx(failing), id);
    expect(st.status).toBe('error');
    expect(st.error).toMatch(/503/);
  });
  it('prefers the legacy profile and only falls back to beta on failure', async () => {
    const id = await identityOf('lake-tahoe');
    const seen: string[] = [];
    const up = fixtureBackedLive('lake-tahoe', (req) => {
      seen.push(req.url);
      if (req.url.includes('/data/Station') && !req.url.includes('/beta/'))
        throw new Error('legacy down');
      return undefined;
    });
    const st = await wqpStations(liveCtx(up, 'lake-tahoe'), id);
    expect(st.status).toBe('ok');
    expect(seen[0]).toContain('waterqualitydata.us/data/Station');
    expect(seen[1]).toContain('waterqualitydata.us/beta/data/Station');
  });
  it('reports unsupported outside the United States', async () => {
    const id = { ...(await identityOf('crater-lake')), country: 'unknown' };
    expect((await wqpStations(demoCtx('crater-lake'), id)).status).toBe('unsupported');
  });
});

describe('USGS OGC adapter', () => {
  it('reads near-real-time values and converts units', async () => {
    const id = await identityOf('lake-champlain');
    const r = await usgsLatest(demoCtx('lake-champlain'), id);
    expect(r.status).toBe('ok');
    const t = r.data!.find((v) => v.key === 'water_temp')!;
    expect(t).toMatchObject({ value: 16.8, unit: '°C' });
  });
  it('is empty where no sensors exist', async () => {
    const id = await identityOf('crater-lake');
    expect((await usgsLatest(demoCtx('crater-lake'), id)).status).toBe('empty');
  });
  it('merges newer readings into the WQP summaries', () => {
    const merged = mergeLatest(
      [
        {
          key: 'water_temp',
          label: 'Water temperature',
          unit: '°C',
          latest: { value: 10, date: '2026-09-01', stationId: 'A' },
          median5y: 12,
          min: 1,
          max: 20,
          sampleCount: 3,
          series: [{ t: '2026-09-01', v: 10 }],
          status: 'no_reference',
        },
      ],
      [
        {
          key: 'water_temp',
          value: 15,
          unit: '°C',
          time: '2026-09-29T23:45:00+00:00',
          siteId: 'RT',
        },
      ],
    );
    expect(merged[0].latest).toEqual({ value: 15, date: '2026-09-29', stationId: 'RT' });
    expect(merged[0].series).toHaveLength(2);
  });
});

describe('ATTAINS adapter', () => {
  it('reads assessment units, uses and causes from raw ATTAINS shapes', async () => {
    const id = await identityOf('lake-champlain');
    const r = await attainsImpairments(demoCtx('lake-champlain'), id);
    expect(r.status).toBe('ok');
    expect(r.data!.assessmentUnits.map((a) => a.id)).toEqual([
      'DEMO-VT-LC-MAIN',
      'DEMO-VT-LC-MISS',
    ]);
    expect(r.data!.uses.find((u) => u.use === 'Fish consumption')!.status).toBe('not_supporting');
    expect(r.data!.uses.find((u) => u.use === 'Swimming / recreation')!.status).toBe(
      'fully_supporting',
    );
    const p = r.data!.causes.find((c) => c.name === 'Phosphorus, Total')!;
    expect(p).toMatchObject({ group: 'nutrients', hasTmdl: true });
    expect(r.data!.causes.find((c) => c.name.startsWith('Polychlorinated'))!.hasTmdl).toBe(false);
  });
  it('returns no causes for a clean lake', async () => {
    const r = await attainsImpairments(demoCtx('crater-lake'), await identityOf('crater-lake'));
    expect(r.data!.causes).toEqual([]);
    expect(r.data!.uses.every((u) => u.status === 'fully_supporting')).toBe(true);
  });
  it('is empty (not assessed) when no assessment unit covers the waterbody', async () => {
    const up = new StubUpstream((req) =>
      req.url.includes('/query')
        ? { type: 'FeatureCollection', features: [] }
        : {
            layers: [
              { id: 1, name: 'Assessment Lines' },
              { id: 2, name: 'Assessment Areas' },
            ],
          },
    );
    const r = await attainsImpairments(liveCtx(up), await identityOf('crater-lake'));
    expect(r.status).toBe('empty');
  });
  it('redacts the API key in provenance and uses the documented URL shape', async () => {
    const up = fixtureBackedLive('lake-champlain');
    const r = await attainsImpairments(
      liveCtx(up, 'lake-champlain'),
      await identityOf('lake-champlain'),
    );
    expect(r.provenance.url).toContain('api_key=REDACTED');
    expect(r.provenance.url).not.toContain('secret-key');
    const apiReq = up.requests.find((x) => x.url.includes('api.epa.gov'))!;
    expect(apiReq.url).toContain('/attains/assessments?assessmentUnitIdentifier=');
    expect(apiReq.url).toContain('api_key=secret-key');
    expect(assessmentsUrl('https://api.epa.gov/attains', ['A', 'B'], 'K')).toBe(
      'https://api.epa.gov/attains/assessments?assessmentUnitIdentifier=A%2CB&api_key=K',
    );
  });
  it('title-cases cause names sensibly', () => {
    expect(titleCase('MERCURY IN FISH TISSUE')).toBe('Mercury in Fish Tissue');
    expect(titleCase('ESCHERICHIA COLI (E. COLI)')).toBe('Escherichia coli (E. coli)');
    expect(titleCase('TOTAL SUSPENDED SOLIDS (TSS)')).toBe('Total Suspended Solids (TSS)');
    expect(titleCase('POLYCHLORINATED BIPHENYLS (PCBS)')).toBe('Polychlorinated Biphenyls (PCBs)');
  });
});

describe('GBIF and NAS adapters', () => {
  it('builds the documented facet query with a short WKT geometry', async () => {
    const id = await identityOf('lake-champlain');
    const up = fixtureBackedLive('lake-champlain');
    const r = await gbifSpecies(liveCtx(up, 'lake-champlain'), id);
    expect(r.status).toBe('ok');
    const req = up.requests.find(
      (x) => x.url.includes('occurrence/search') && x.url.includes('facet=speciesKey'),
    )!;
    const q = new URL(req.url).searchParams;
    expect(q.get('geometry')!.length).toBeLessThanOrEqual(1500);
    expect(q.get('geometry')).toMatch(/^POLYGON\(\(/);
    expect(q.get('hasCoordinate')).toBe('true');
    expect(q.get('occurrenceStatus')).toBe('PRESENT');
    expect(q.get('limit')).toBe('0');
    expect(q.get('facetLimit')).toBe('200');
    expect(q.getAll('taxonKey').length).toBeGreaterThanOrEqual(1);
    expect(
      occurrenceFacetUrl('https://api.gbif.org/v1', 'POLYGON((0 0,1 0,1 1,0 0))', [1, 2]),
    ).toContain('taxonKey=1&taxonKey=2');
  });
  it('returns species sorted by record count with names, groups, catalog ids and last year', async () => {
    const id = await identityOf('lake-champlain');
    const r = await gbifSpecies(demoCtx('lake-champlain'), id);
    const d = r.data!;
    expect(d[0]).toMatchObject({
      scientificName: 'Perca flavescens',
      commonName: 'Yellow perch',
      group: 'fish',
      recordCount: 2200,
      catalogId: 'perca-flavescens',
      lastObserved: '2026',
    });
    expect(d.map((s) => s.recordCount)).toEqual(
      [...d.map((s) => s.recordCount)].sort((a, b) => b - a),
    );
    expect(d.some((s) => s.group === 'lamprey' && s.scientificName === 'Petromyzon marinus')).toBe(
      true,
    );
    expect(new Set(d.map((s) => s.group))).toContain('mollusc');
    expect(d.every((s) => s.introduced === false)).toBe(true);
  });
  it('resolves names for species outside the catalog via vernacular names', async () => {
    const r = await gbifSpecies(demoCtx('potomac-river-dc'), await identityOf('potomac-river-dc'));
    const q = r.data!.find((s) => s.scientificName === 'Carpiodes cyprinus')!;
    expect(q.commonName).toBe('Quillback');
    expect(q.catalogId).toBeUndefined();
    expect(q.family).toBe('Catostomidae');
  });
  it('flags introduced species from NAS', async () => {
    const id = await identityOf('lake-tahoe');
    const ctx = demoCtx('lake-tahoe');
    const nas = await nasIntroduced(ctx, id);
    expect(nas.status).toBe('ok');
    const life = await gbifSpecies(ctx, id);
    const flagged = applyIntroduced(life.data!, nas.data);
    expect(flagged.find((s) => s.scientificName === 'Salvelinus namaycush')!.introduced).toBe(true);
    expect(flagged.find((s) => s.scientificName === 'Prosopium williamsoni')!.introduced).toBe(
      false,
    );
    expect(
      normalizeNas({
        results: [
          { scientificName: 'Dreissena polymorpha (Pallas, 1771)', status: 'established' },
          { scientificName: 'Gone gone', status: 'failed' },
        ],
      }).has('dreissena polymorpha'),
    ).toBe(true);
  });
  it('is empty for a waterbody with no GBIF records and errors when GBIF is down', async () => {
    const id = await identityOf('crater-lake');
    const none = new StubUpstream((req) => {
      if (req.url.includes('/species/match')) return { usageKey: 1 };
      return { facets: [] };
    });
    expect((await gbifSpecies(liveCtx(none), id)).status).toBe('empty');
    const down = new StubUpstream((req) => {
      if (req.url.includes('/species/match')) return { usageKey: 1 };
      throw new Error('GBIF responded 502');
    });
    const r = await gbifSpecies(liveCtx(down), id);
    expect(r.status).toBe('error');
  });
  it('keeps going with partial details when the time budget is exhausted', async () => {
    const id = await identityOf('lake-champlain');
    const r = await gbifSpecies(demoCtx('lake-champlain'), id, { budgetMs: -1 });
    // No details can be loaded after the deadline, so nothing is returned as records.
    expect(['empty', 'ok']).toContain(r.status);
  });
});

describe('depth and physical profile', () => {
  it('matches the depth index by centroid-in-polygon and area within 30%', async () => {
    const id = await identityOf('lake-champlain');
    const index = (await loadDepthIndex(demoCtx()))!;
    const area = 1145.43;
    expect(matchDepthIndex(id, area, index)?.depth_max_m).toBe(122);
    expect(matchDepthIndex(id, area * 2, index)).toBeNull();
    expect(matchDepthIndex(id, area * 1.25, index)?.depth_max_m).toBe(122);
    const tahoe = await identityOf('lake-tahoe');
    expect(matchDepthIndex(tahoe, 509, index)?.depth_max_m).toBe(501);
  });
  it('builds a physical profile with a measured depth from the index', async () => {
    const r = await physicalSection(
      demoCtx('lake-tahoe'),
      await identityOf('lake-tahoe'),
      1897,
      () => loadDemGrid(demoCtx('lake-tahoe'), {} as WaterbodyIdentity),
    );
    const p = r.data!;
    expect(p.maxDepthM).toMatchObject({ value: 501, estimated: false });
    expect(p.meanDepthM!.value).toBe(303);
    expect(p.surfaceElevationM).toMatchObject({ value: 1897, estimated: false });
    expect(p.shorelineDevelopment!.value).toBeGreaterThan(1);
    expect(p.areaKm2.unit).toBe('km²');
  });
  it('samples the DEM for elevation when NHD has none, and marks it estimated', async () => {
    const id = await identityOf('lake-champlain');
    const dem = await loadDemGrid(demoCtx('lake-champlain'), id);
    const p = buildPhysical({ identity: id, dem, index: null });
    expect(p.surfaceElevationM!.estimated).toBe(true);
    expect(p.surfaceElevationM!.value).toBeCloseTo(29, 0);
    expect(p.maxDepthM?.estimated).toBe(true);
    expect(p.maxDepthM!.method).toBe('Estimated from surrounding terrain');
    expect(p.maxDepthM!.value).toBeGreaterThanOrEqual(1);
    expect(p.maxDepthM!.value).toBeLessThanOrEqual(300);
  });
  it('estimates depth from terrain slope x distance to shore x 0.5, clamped', async () => {
    const id = await identityOf('onondaga-lake');
    const steep: DemGrid = {
      bbox: [id.bbox[0] - 0.1, id.bbox[1] - 0.1, id.bbox[2] + 0.1, id.bbox[3] + 0.1],
      width: 40,
      height: 40,
      elevations: Array.from({ length: 1600 }, (_, i) => (i % 40) * 40),
    };
    const est = estimateDepthFromDem(id, steep)!;
    expect(est.maxDistanceToShoreM).toBeGreaterThan(100);
    expect(est.maxDepthM).toBeCloseTo(
      Math.min(300, Math.max(1, est.slope * est.maxDistanceToShoreM * 0.5)),
      6,
    );
    const flat: DemGrid = { ...steep, elevations: new Array(1600).fill(100) };
    expect(estimateDepthFromDem(id, flat)!.maxDepthM).toBe(1);
    const huge: DemGrid = {
      ...steep,
      elevations: Array.from({ length: 1600 }, (_, i) => (i % 40) * 4000),
    };
    expect(estimateDepthFromDem(id, huge)!.maxDepthM).toBe(300);
  });
  it('estimates river depth from width', () => {
    const d = estimateRiverDepth(840);
    expect(d.maxDepthM).toBeGreaterThan(5);
    expect(d.maxDepthM).toBeLessThan(10);
    expect(d.meanDepthM).toBeLessThan(d.maxDepthM);
  });
  it('gives the river a length and an estimated depth', async () => {
    const id = await identityOf('potomac-river-dc');
    const flow = (await nhdIdentityAt(demoCtx(), -77.05, 38.878))!;
    expect(flow.identity.type).toBe('river');
    const p = buildPhysical({
      identity: {
        ...id,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-77.118, 38.93],
            [-77.038, 38.79],
          ],
        },
      },
      dem: null,
      index: null,
    });
    expect(p.lengthKm!.value).toBeGreaterThan(10);
  });
});

describe('DEM loading', () => {
  it('reads the fixture grid in demo mode', async () => {
    const g = await loadDemGrid(demoCtx('crater-lake'), await identityOf('crater-lake'));
    expect(g.elevations).toHaveLength(g.width * g.height);
    expect(g._demo).toBe(true);
  });
  it('downloads and stitches Terrarium tiles in live mode', async () => {
    const id = await identityOf('onondaga-lake');
    const requested: string[] = [];
    const up = new StubUpstream((req) => {
      requested.push(req.url);
      const png = new PNG({ width: 256, height: 256 });
      const [r, g, b] = encodeTerrarium(111);
      for (let i = 0; i < 256 * 256; i++) {
        png.data[i * 4] = r;
        png.data[i * 4 + 1] = g;
        png.data[i * 4 + 2] = b;
        png.data[i * 4 + 3] = 255;
      }
      return new Uint8Array(PNG.sync.write(png));
    });
    const grid = await loadDemGrid(liveCtx(up), id);
    expect(requested.length).toBeGreaterThanOrEqual(1);
    expect(requested[0]).toMatch(
      /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/,
    );
    expect(grid.elevations.every((v) => Math.abs(v - 111) < 0.01)).toBe(true);
  });
  it('rejects tiles of the wrong size', () => {
    const png = new PNG({ width: 4, height: 4 });
    expect(() => decodePngRgba(new Uint8Array(PNG.sync.write(png)))).toThrow(/tile size/);
  });
  it('is unavailable as binary in demo mode', async () => {
    await expect(demoCtx().upstream.buffer({ source: 't', url: 'x' })).rejects.toBeInstanceOf(
      DemoUnavailableError,
    );
  });
});
