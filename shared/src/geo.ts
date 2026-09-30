import type { WaterGeometry } from './types';

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

/** Equirectangular projection to local metres around an origin (good for < ~200 km). */
export function makeProjection(origin: [number, number]) {
  const [lon0, lat0] = origin;
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal: (lon: number, lat: number): [number, number] => [
      (lon - lon0) * kx,
      (lat - lat0) * M_PER_DEG_LAT,
    ],
    toLonLat: (x: number, y: number): [number, number] => [lon0 + x / kx, lat0 + y / M_PER_DEG_LAT],
  };
}

export type Ring = Array<[number, number]>;

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** True if the ring is counter-clockwise (positive signed area) in x-right, y-up space. */
export const isCounterClockwise = (ring: Ring) => ringArea(ring) > 0;

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to the nearest edge of a ring (always >= 0). */
export function distToRing(x: number, y: number, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = distToSegment(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    if (d < best) best = d;
  }
  return best;
}

/** Positive inside, negative outside. */
export function signedDistance(x: number, y: number, ring: Ring): number {
  const d = distToRing(x, y, ring);
  return pointInRing(x, y, ring) ? d : -d;
}

export function geometryBbox(g: WaterGeometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  visit(g.coordinates);
  return [minX, minY, maxX, maxY];
}

/** Expand a lon/lat bbox by a margin in metres on every side (default 2 km for the diorama block). */
export function blockBbox(
  bbox: [number, number, number, number],
  marginM = 2000,
): [number, number, number, number] {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const dLat = marginM / M_PER_DEG_LAT;
  const dLon = marginM / (M_PER_DEG_LON_EQ * Math.cos((midLat * Math.PI) / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}
