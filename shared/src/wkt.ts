import { simplify, polygon as turfPolygon, bbox as turfBbox, bboxPolygon } from '@turf/turf';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import { isCounterClockwise, type Ring } from './geo';

export const WKT_MAX_CHARS = 1500;

const fmt = (n: number, d: number) => Number(n.toFixed(d)).toString();

function ringToWkt(ring: Position[], decimals: number): string {
  return '(' + ring.map(([x, y]) => `${fmt(x, decimals)} ${fmt(y, decimals)}`).join(',') + ')';
}

/** Force the exterior ring counter-clockwise (GBIF expects it) and close it. */
export function ccwRing(ring: Position[]): Position[] {
  const r = ring.map((p) => [p[0], p[1]] as Position);
  const first = r[0];
  const last = r[r.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) r.push([first[0], first[1]]);
  return isCounterClockwise(r as Ring) ? r : r.reverse();
}

function largestExterior(geom: Polygon | MultiPolygon): Position[] {
  if (geom.type === 'Polygon') return geom.coordinates[0];
  let best = geom.coordinates[0][0];
  let bestArea = -1;
  for (const p of geom.coordinates) {
    const a = Math.abs(
      p[0].reduce((s, pt, i, arr) => {
        const prev = arr[(i + arr.length - 1) % arr.length];
        return s + prev[0] * pt[1] - pt[0] * prev[1];
      }, 0),
    );
    if (a > bestArea) {
      bestArea = a;
      best = p[0];
    }
  }
  return best;
}

export interface WktResult {
  wkt: string;
  simplified: boolean;
  usedBbox: boolean;
}

/**
 * Build a GBIF-compatible POLYGON WKT under `maxChars`. Simplifies the largest exterior ring
 * with increasing tolerance, then reduces coordinate precision, and finally falls back to the
 * bounding box. The ring is always counter-clockwise and closed.
 */
export function buildGbifWkt(geom: Polygon | MultiPolygon, maxChars = WKT_MAX_CHARS): WktResult {
  const ring = largestExterior(geom);
  const direct = `POLYGON(${ringToWkt(ccwRing(ring), 5)})`;
  if (direct.length <= maxChars) return { wkt: direct, simplified: false, usedBbox: false };

  const poly = turfPolygon([ring]);
  let tol = 0.0002;
  for (let i = 0; i < 30; i++) {
    const s = simplify(poly, { tolerance: tol, highQuality: true });
    const c = ccwRing(s.geometry.coordinates[0]);
    if (c.length >= 4) {
      for (const dec of [5, 4, 3]) {
        const wkt = `POLYGON(${ringToWkt(c, dec)})`;
        if (wkt.length <= maxChars) return { wkt, simplified: true, usedBbox: false };
      }
    }
    tol *= 1.5;
  }
  const [minX, minY, maxX, maxY] = turfBbox(poly);
  const bb = bboxPolygon([minX, minY, maxX, maxY]);
  return {
    wkt: `POLYGON(${ringToWkt(ccwRing(bb.geometry.coordinates[0]), 4)})`,
    simplified: true,
    usedBbox: true,
  };
}
