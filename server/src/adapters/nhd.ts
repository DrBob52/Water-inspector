import type { Feature, FeatureCollection } from 'geojson';
import type { WaterbodyIdentity, WaterbodyType, WaterGeometry } from '@wi/shared';
import { bboxOf, centroidOf, distanceToGeometryM, simplifyGeometry } from '../geom';
import { type AdapterCtx, fx, makeProvenance, num, prop, str, withQuery } from './common';

export const NHD_SOURCE = 'USGS NHD (The National Map)';
export const NHD_LICENSE = 'US public domain (USGS)';

export interface NhdLayers {
  waterbody: number;
  area: number;
  flowline: number;
}

interface ServiceLayers {
  layers?: Array<{ id: number; name: string }>;
}

/** Look up the Waterbody, Area and Flowline layer ids from the service description. */
export async function resolveNhdLayers(ctx: AdapterCtx): Promise<NhdLayers> {
  const { nhd } = ctx.config;
  if (
    nhd.layerIds?.waterbody !== undefined &&
    nhd.layerIds.area !== undefined &&
    nhd.layerIds.flowline !== undefined
  ) {
    return nhd.layerIds as NhdLayers;
  }
  const svc = await ctx.upstream.json<ServiceLayers>({
    source: NHD_SOURCE,
    url: `${nhd.baseUrl}?f=pjson`,
    ttlMs: ctx.config.ttl.nhd,
    fixture: { file: 'nhd-layers' },
  });
  const find = (re: RegExp) => svc.layers?.find((l) => re.test(l.name))?.id;
  const out = {
    waterbody: nhd.layerIds?.waterbody ?? find(nhd.layerNames.waterbody),
    area: nhd.layerIds?.area ?? find(nhd.layerNames.area),
    flowline: nhd.layerIds?.flowline ?? find(nhd.layerNames.flowline),
  };
  if (out.waterbody === undefined || out.area === undefined || out.flowline === undefined) {
    throw new Error('Could not find NHD Waterbody/Area/Flowline layers in the service description');
  }
  return out as NhdLayers;
}

type Kind = 'waterbody' | 'area' | 'flowline';

export function pointQueryUrl(
  base: string,
  layer: number,
  lon: number,
  lat: number,
  kind: Kind,
  toleranceM: number,
): string {
  return withQuery(`${base}/${layer}/query`, [
    ['geometry', `${lon},${lat}`],
    ['geometryType', 'esriGeometryPoint'],
    ['inSR', 4326],
    ['spatialRel', 'esriSpatialRelIntersects'],
    ['distance', kind === 'flowline' ? toleranceM : undefined],
    ['units', kind === 'flowline' ? 'esriSRUnit_Meter' : undefined],
    ['outFields', '*'],
    ['returnGeometry', 'true'],
    ['outSR', 4326],
    ['f', 'geojson'],
  ]);
}

export function idQueryUrl(base: string, layer: number, permanentId: string): string {
  return withQuery(`${base}/${layer}/query`, [
    ['where', `permanent_identifier='${permanentId.replace(/'/g, "''")}'`],
    ['outFields', '*'],
    ['returnGeometry', 'true'],
    ['outSR', 4326],
    ['f', 'geojson'],
  ]);
}

type RawCollection = FeatureCollection | Array<{ slug: string; data: FeatureCollection }>;

/** In demo mode the fixture store returns every demo file; emulate the spatial query here. */
function demoFilterPoint(
  raw: RawCollection,
  lon: number,
  lat: number,
  toleranceM: number,
): Array<{ f: Feature; slug?: string }> {
  if (!Array.isArray(raw)) return raw.features.map((f) => ({ f }));
  const out: Array<{ f: Feature; slug?: string }> = [];
  for (const { slug, data } of raw) {
    for (const f of data.features ?? []) {
      const g = f.geometry as WaterGeometry | null;
      if (g && distanceToGeometryM(g, lon, lat) <= toleranceM) out.push({ f, slug });
    }
  }
  return out;
}

function typeFrom(kind: Kind, ftype: number | undefined, name: string | undefined): WaterbodyType {
  if (kind === 'area') return 'river';
  if (kind === 'flowline') return 'stream';
  const n = name ?? '';
  switch (ftype) {
    case 436:
      return 'reservoir';
    case 493:
      return 'estuary';
    case 466:
      return 'wetland';
    case 390:
    case undefined:
    default:
      if (/\bbay\b/i.test(n)) return 'bay';
      if (/\breservoir\b/i.test(n)) return 'reservoir';
      if (/\bpond\b/i.test(n)) return 'pond';
      return ftype === 390 || ftype === undefined ? 'lake' : 'unknown';
  }
}

export interface NormalizedNhd {
  identity: WaterbodyIdentity;
  /** NHD elevation attribute in metres, when present. */
  elevationM?: number;
}

export function normalizeNhdFeature(
  f: Feature,
  kind: Kind,
  maxVertices: number,
): NormalizedNhd | null {
  const geometry = f.geometry as WaterGeometry | null;
  if (!geometry) return null;
  if (!['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry.type))
    return null;
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const perm =
    str(prop(props, 'permanent_identifier')) ??
    str(prop(props, 'nhdplusid')) ??
    (f.id !== undefined ? String(f.id) : undefined);
  if (!perm) return null;
  const name = str(prop(props, 'gnis_name')) ?? str(prop(props, 'name')) ?? null;
  const ftype = num(prop(props, 'ftype'));
  const geom = simplifyGeometry(geometry, maxVertices);
  const states = str(prop(props, 'states')) ?? str(prop(props, 'state'));
  return {
    identity: {
      id: `nhd:${perm}`,
      name,
      type: typeFrom(kind, ftype, name ?? undefined),
      state: states,
      country: 'US',
      huc8: str(prop(props, 'huc8')) ?? str(prop(props, 'huc_8')),
      geometry: geom,
      bbox: bboxOf(geom),
      centroid: centroidOf(geom),
    },
    elevationM: num(prop(props, 'elevation')),
  };
}

function areaScore(f: Feature): number {
  const a = num(prop((f.properties ?? {}) as Record<string, unknown>, 'areasqkm'));
  return a ?? Number.POSITIVE_INFINITY;
}

export interface IdentityLookup extends NormalizedNhd {
  slug?: string;
  url: string;
  kind: Kind;
}

/** Find the waterbody at a point: Waterbody layer, then wide-river Area, then buffered Flowline. */
export async function nhdIdentityAt(
  ctx: AdapterCtx,
  lon: number,
  lat: number,
): Promise<IdentityLookup | null> {
  const { nhd, ttl } = ctx.config;
  const layers = await resolveNhdLayers(ctx);
  const plan: Array<[Kind, number, string]> = [
    ['waterbody', layers.waterbody, 'nhd-waterbody'],
    ['area', layers.area, 'nhd-area'],
    ['flowline', layers.flowline, 'nhd-flowline'],
  ];
  for (const [kind, layer, file] of plan) {
    const tol = kind === 'flowline' ? nhd.flowlineToleranceM : 0;
    const url = pointQueryUrl(nhd.baseUrl, layer, lon, lat, kind, nhd.flowlineToleranceM);
    const raw = await ctx.upstream.json<RawCollection>({
      source: NHD_SOURCE,
      url,
      ttlMs: ttl.nhd,
      fixture: { file, all: true },
    });
    const hits = demoFilterPoint(raw, lon, lat, tol).sort(
      (a, b) => areaScore(a.f) - areaScore(b.f),
    );
    for (const h of hits) {
      const n = normalizeNhdFeature(h.f, kind, nhd.maxGeometryVertices);
      if (n) return { ...n, slug: h.slug, url, kind };
    }
  }
  return null;
}

/** Load an identity by "nhd:{permanent_identifier}". Throws on upstream errors; null when absent. */
export async function nhdIdentityById(
  ctx: AdapterCtx,
  id: string,
): Promise<(NormalizedNhd & { url: string }) | null> {
  const perm = id.replace(/^nhd:/, '');
  const { nhd, ttl } = ctx.config;
  const layers = await resolveNhdLayers(ctx);
  const plan: Array<[Kind, number, string]> = [
    ['waterbody', layers.waterbody, 'nhd-waterbody'],
    ['area', layers.area, 'nhd-area'],
    ['flowline', layers.flowline, 'nhd-flowline'],
  ];
  for (const [kind, layer, file] of plan) {
    const url = idQueryUrl(nhd.baseUrl, layer, perm);
    const raw = await ctx.upstream.json<FeatureCollection>({
      source: NHD_SOURCE,
      url,
      ttlMs: ttl.nhd,
      fixture: fx(ctx, file),
    });
    const f = raw.features?.find(
      (x) =>
        str(prop((x.properties ?? {}) as Record<string, unknown>, 'permanent_identifier')) === perm,
    );
    if (f) {
      const n = normalizeNhdFeature(f, kind, nhd.maxGeometryVertices);
      if (n) return { ...n, url };
    }
  }
  return null;
}

export function identityProvenance(ctx: AdapterCtx, url: string) {
  return makeProvenance(ctx, NHD_SOURCE, url, { license: NHD_LICENSE });
}

/** HUC8 from the watershed boundary dataset when the NHD record has none. */
export async function huc8AtPoint(
  ctx: AdapterCtx,
  lon: number,
  lat: number,
): Promise<string | undefined> {
  const { wbd, ttl } = ctx.config;
  if (ctx.upstream.demo) return undefined;
  const svc = await ctx.upstream.json<ServiceLayers>({
    source: 'USGS WBD',
    url: `${wbd.baseUrl}?f=pjson`,
    ttlMs: ttl.nhd,
  });
  const layer = svc.layers?.find((l) => wbd.huc8LayerName.test(l.name))?.id;
  if (layer === undefined) return undefined;
  const url = withQuery(`${wbd.baseUrl}/${layer}/query`, [
    ['geometry', `${lon},${lat}`],
    ['geometryType', 'esriGeometryPoint'],
    ['inSR', 4326],
    ['spatialRel', 'esriSpatialRelIntersects'],
    ['outFields', 'huc8'],
    ['returnGeometry', 'false'],
    ['f', 'json'],
  ]);
  try {
    const raw = await ctx.upstream.json<{
      features?: Array<{ attributes?: Record<string, unknown> }>;
    }>({ source: 'USGS WBD', url, ttlMs: ttl.nhd });
    return str(prop(raw.features?.[0]?.attributes, 'huc8'));
  } catch {
    return undefined;
  }
}
