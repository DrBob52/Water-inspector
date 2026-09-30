import {
  bbox as turfBbox,
  booleanPointInPolygon,
  buffer as turfBuffer,
  centroid as turfCentroid,
  area as turfArea,
  length as turfLength,
  pointOnFeature,
  simplify,
  feature,
} from '@turf/turf';
import type { Feature, LineString, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson';
import { distToRing, makeProjection, pointInRing, type Ring, type WaterGeometry } from '@wi/shared';

export const isPolygonal = (g: WaterGeometry): g is Polygon | MultiPolygon =>
  g.type === 'Polygon' || g.type === 'MultiPolygon';

export function countVertices(g: WaterGeometry): number {
  let n = 0;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') n++;
    else if (Array.isArray(c)) c.forEach(visit);
  };
  visit(g.coordinates);
  return n;
}

/** Simplify until the geometry has at most `maxVertices` vertices. */
export function simplifyGeometry<G extends WaterGeometry>(g: G, maxVertices: number): G {
  if (countVertices(g) <= maxVertices) return g;
  let tol = 0.00005;
  let cur: G = g;
  for (let i = 0; i < 24 && countVertices(cur) > maxVertices; i++) {
    cur = simplify(feature(g), { tolerance: tol, highQuality: false }).geometry as G;
    tol *= 1.6;
  }
  return cur;
}

export function bboxOf(g: WaterGeometry): [number, number, number, number] {
  return turfBbox(feature(g)) as [number, number, number, number];
}

/** Centroid, falling back to a point on the surface when the centroid is outside the polygon. */
export function centroidOf(g: WaterGeometry): [number, number] {
  const f = feature(g);
  if (isPolygonal(g)) {
    const c = turfCentroid(f);
    if (booleanPointInPolygon(c, f as Feature<Polygon | MultiPolygon>)) {
      return c.geometry.coordinates as [number, number];
    }
    return pointOnFeature(f).geometry.coordinates as [number, number];
  }
  return pointOnFeature(f).geometry.coordinates as [number, number];
}

/** A point guaranteed to lie on the geometry (used for point-intersect queries). */
export function representativePoint(g: WaterGeometry): [number, number] {
  return pointOnFeature(feature(g)).geometry.coordinates as [number, number];
}

function exteriorRings(g: Polygon | MultiPolygon): Position2[][] {
  return g.type === 'Polygon'
    ? [g.coordinates[0] as Position2[]]
    : g.coordinates.map((p) => p[0] as Position2[]);
}
type Position2 = [number, number];

export function areaKm2(g: WaterGeometry): number {
  return isPolygonal(g) ? turfArea(feature(g)) / 1e6 : 0;
}

export function perimeterKm(g: WaterGeometry): number {
  if (isPolygonal(g)) {
    if (g.type === 'Polygon')
      return g.coordinates.reduce((s, r) => s + ringLengthKm(r as Position2[]), 0);
    return g.coordinates.reduce(
      (s, p) => s + p.reduce((s2, r) => s2 + ringLengthKm(r as Position2[]), 0),
      0,
    );
  }
  return 0;
}

function ringLengthKm(r: Position2[]): number {
  return turfLength(
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } },
    { units: 'kilometers' },
  );
}

export function lengthKm(g: WaterGeometry): number {
  if (g.type === 'LineString' || g.type === 'MultiLineString')
    return turfLength(feature(g), { units: 'kilometers' });
  return 0;
}

/** Distance in metres from a lon/lat point to the geometry (0 if inside a polygon). */
export function distanceToGeometryM(g: WaterGeometry, lon: number, lat: number): number {
  const proj = makeProjection([lon, lat]);
  if (isPolygonal(g)) {
    let best = Infinity;
    for (const ring of exteriorRings(g)) {
      const local: Ring = ring.map(([x, y]) => proj.toLocal(x, y));
      if (pointInRing(0, 0, local)) return 0;
      best = Math.min(best, distToRing(0, 0, local));
    }
    return best;
  }
  const lines: Position2[][] =
    g.type === 'LineString' ? [g.coordinates as Position2[]] : (g.coordinates as Position2[][]);
  let best = Infinity;
  for (const line of lines) {
    const local = line.map(([x, y]) => proj.toLocal(x, y));
    for (let i = 1; i < local.length; i++) {
      const [ax, ay] = local[i - 1];
      const [bx, by] = local[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

/** Buffer a line (or pass a polygon through) into something with area, e.g. for GBIF or the scene. */
export function polygonize(g: WaterGeometry, bufferM: number): Polygon | MultiPolygon {
  if (isPolygonal(g)) return g;
  const buf = turfBuffer(feature(g as LineString | MultiLineString), bufferM / 1000, {
    units: 'kilometers',
    steps: 4,
  });
  return buf!.geometry as Polygon | MultiPolygon;
}

export const pointFeature = (lon: number, lat: number): Feature<Point> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: [lon, lat] },
});
