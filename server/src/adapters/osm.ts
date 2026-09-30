import type { LineString, MultiPolygon, Polygon } from 'geojson';
import type { WaterbodyIdentity, WaterbodyType, WaterGeometry } from '@wi/shared';
import { bboxOf, centroidOf, simplifyGeometry } from '../geom';
import { type AdapterCtx, fx, num } from './common';

export const OSM_SOURCE = 'OpenStreetMap (Overpass API)';
export const OSM_LICENSE = 'ODbL 1.0, © OpenStreetMap contributors';

interface OverpassGeomPoint {
  lat: number;
  lon: number;
}
interface OverpassElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassGeomPoint[];
  members?: Array<{ type: string; ref: number; role: string; geometry?: OverpassGeomPoint[] }>;
}
interface OverpassResponse {
  elements?: OverpassElement[];
}

export function overpassQuery(lat: number, lon: number, aroundM: number): string {
  return `[out:json][timeout:25];
is_in(${lat},${lon})->.a;
(
  way(pivot.a)["natural"="water"];
  relation(pivot.a)["natural"="water"];
  way(pivot.a)["waterway"="riverbank"];
  way(around:${aroundM},${lat},${lon})["natural"="water"];
  way(around:${aroundM},${lat},${lon})["waterway"="riverbank"];
  way(around:${aroundM},${lat},${lon})["waterway"~"^(river|stream|canal)$"];
);
out geom tags;`;
}

const toPos = (g: OverpassGeomPoint[]): Array<[number, number]> => g.map((p) => [p.lon, p.lat]);

const closed = (c: Array<[number, number]>) =>
  c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];

/** Join outer way fragments end to end into closed rings. */
export function stitchRings(
  fragments: Array<Array<[number, number]>>,
): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  const pool = fragments.map((f) => f.slice());
  while (pool.length) {
    let cur = pool.shift()!;
    let progress = true;
    while (!closed(cur) && progress) {
      progress = false;
      for (let i = 0; i < pool.length; i++) {
        const f = pool[i];
        const end = cur[cur.length - 1];
        if (f[0][0] === end[0] && f[0][1] === end[1]) cur = cur.concat(f.slice(1));
        else if (f[f.length - 1][0] === end[0] && f[f.length - 1][1] === end[1])
          cur = cur.concat(f.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (closed(cur)) rings.push(cur);
  }
  return rings;
}

function typeOf(tags: Record<string, string>): WaterbodyType {
  const w = tags.water;
  if (w === 'lake') return 'lake';
  if (w === 'reservoir') return 'reservoir';
  if (w === 'pond') return 'pond';
  if (w === 'river' || w === 'canal' || tags.waterway === 'riverbank' || tags.waterway === 'river')
    return 'river';
  if (w === 'stream' || tags.waterway === 'stream') return 'stream';
  if (tags.natural === 'bay') return 'bay';
  if (tags.natural === 'wetland') return 'wetland';
  if (tags.natural === 'water') return 'lake';
  return 'unknown';
}

export function inUnitedStates(lon: number, lat: number): boolean {
  const conus = lon > -125 && lon < -66.5 && lat > 24.4 && lat < 49.5;
  const alaska = lon > -170 && lon < -130 && lat > 54 && lat < 71.5;
  const hawaii = lon > -161 && lon < -154 && lat > 18.5 && lat < 22.5;
  return conus || alaska || hawaii;
}

export function normalizeOverpassElement(
  el: OverpassElement,
  maxVertices: number,
): WaterbodyIdentity | null {
  const tags = el.tags ?? {};
  let geometry: WaterGeometry | null = null;
  if (el.type === 'way' && el.geometry?.length) {
    const c = toPos(el.geometry);
    geometry = closed(c)
      ? ({ type: 'Polygon', coordinates: [c] } as Polygon)
      : ({ type: 'LineString', coordinates: c } as LineString);
  } else if (el.type === 'relation' && el.members) {
    const outers = el.members
      .filter((m) => m.role === 'outer' && m.geometry?.length)
      .map((m) => toPos(m.geometry!));
    const rings = stitchRings(outers);
    if (rings.length === 1) geometry = { type: 'Polygon', coordinates: [rings[0]] } as Polygon;
    else if (rings.length > 1)
      geometry = { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) } as MultiPolygon;
  }
  if (!geometry) return null;
  const geom = simplifyGeometry(geometry, maxVertices);
  const centroid = centroidOf(geom);
  return {
    id: `osm:${el.type}/${el.id}`,
    name: tags.name ?? null,
    type: typeOf(tags),
    country: inUnitedStates(centroid[0], centroid[1]) ? 'US' : 'unknown',
    geometry: geom,
    bbox: bboxOf(geom),
    centroid,
  };
}

/** Global fallback: the smallest polygon containing or touching the point. */
export async function osmIdentityAt(
  ctx: AdapterCtx,
  lon: number,
  lat: number,
): Promise<{ identity: WaterbodyIdentity; url: string } | null> {
  const { overpass, nhd, ttl } = ctx.config;
  const query = overpassQuery(lat, lon, overpass.aroundM);
  const url = `${overpass.url}?data=${encodeURIComponent(query)}`;
  const raw = await ctx.upstream.json<OverpassResponse>({
    source: OSM_SOURCE,
    url,
    ttlMs: ttl.nhd,
    fixture: fx(ctx, 'overpass-sample'),
  });
  const ids = (raw.elements ?? [])
    .map((el) => normalizeOverpassElement(el, nhd.maxGeometryVertices))
    .filter((x): x is WaterbodyIdentity => !!x);
  if (!ids.length) return null;
  // Prefer polygons over lines, and the smallest bbox (most specific waterbody).
  const score = (i: WaterbodyIdentity) => {
    const b = i.bbox;
    return (i.geometry.type.includes('Polygon') ? 0 : 1e6) + (b[2] - b[0]) * (b[3] - b[1]);
  };
  ids.sort((a, b) => score(a) - score(b));
  return { identity: ids[0], url };
}

/** Load by "osm:way/123" or "osm:relation/123". */
export async function osmIdentityById(
  ctx: AdapterCtx,
  id: string,
): Promise<{ identity: WaterbodyIdentity; url: string } | null> {
  const m = /^osm:(way|relation)\/(\d+)$/.exec(id);
  if (!m) return null;
  const { overpass, nhd, ttl } = ctx.config;
  const query = `[out:json][timeout:25];${m[1]}(${m[2]});out geom tags;`;
  const url = `${overpass.url}?data=${encodeURIComponent(query)}`;
  const raw = await ctx.upstream.json<OverpassResponse>({
    source: OSM_SOURCE,
    url,
    ttlMs: ttl.nhd,
    fixture: fx(ctx, 'overpass-sample'),
  });
  const el = raw.elements?.find((e) => e.type === m[1] && e.id === num(m[2]));
  const identity = el ? normalizeOverpassElement(el, nhd.maxGeometryVertices) : null;
  return identity ? { identity, url } : null;
}
