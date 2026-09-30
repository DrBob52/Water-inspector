import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { buildGbifWkt, ccwRing } from './wkt';
import { isCounterClockwise, type Ring } from './geo';

function wobblyCircle(n: number, cx = -73.3, cy = 44.5, r = 0.2): Polygon {
  const ring: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = -((2 * Math.PI * i) / n); // clockwise on purpose
    const rr = r * (1 + 0.15 * Math.sin(7 * a) + 0.05 * Math.sin(23 * a));
    ring.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function parse(wkt: string): number[][] {
  const inner = wkt.replace(/^POLYGON\(\(/, '').replace(/\)\)$/, '');
  return inner.split(',').map((p) => p.split(' ').map(Number));
}

describe('buildGbifWkt', () => {
  it('keeps small polygons as they are, counter-clockwise and closed', () => {
    const r = buildGbifWkt(wobblyCircle(12));
    expect(r.simplified).toBe(false);
    const pts = parse(r.wkt);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    expect(isCounterClockwise(pts as Ring)).toBe(true);
  });
  it('simplifies a 2000-vertex polygon to under 1500 characters', () => {
    const r = buildGbifWkt(wobblyCircle(2000));
    expect(r.wkt.length).toBeLessThanOrEqual(1500);
    expect(r.simplified).toBe(true);
    const pts = parse(r.wkt);
    expect(pts.length).toBeGreaterThanOrEqual(4);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    expect(isCounterClockwise(pts as Ring)).toBe(true);
  });
  it('produces a valid WKT polygon string', () => {
    const r = buildGbifWkt(wobblyCircle(500));
    expect(r.wkt).toMatch(
      /^POLYGON\(\((-?\d+(\.\d+)? -?\d+(\.\d+)?,)+-?\d+(\.\d+)? -?\d+(\.\d+)?\)\)$/,
    );
  });
  it('falls back to the bbox when nothing else fits', () => {
    const r = buildGbifWkt(wobblyCircle(2000), 60);
    expect(r.usedBbox).toBe(true);
    expect(parse(r.wkt)).toHaveLength(5);
    expect(isCounterClockwise(parse(r.wkt) as Ring)).toBe(true);
  });
  it('uses the largest polygon of a MultiPolygon', () => {
    const big = wobblyCircle(10, 0, 0, 1).coordinates;
    const small = wobblyCircle(10, 5, 5, 0.1).coordinates;
    const r = buildGbifWkt({ type: 'MultiPolygon', coordinates: [small, big] });
    const pts = parse(r.wkt);
    expect(Math.max(...pts.map((p) => Math.abs(p[0])))).toBeLessThan(2);
  });
});

describe('ccwRing', () => {
  it('reverses clockwise rings and closes open ones', () => {
    const cw = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    const out = ccwRing(cw);
    expect(out[0]).toEqual(out[out.length - 1]);
    expect(isCounterClockwise(out as Ring)).toBe(true);
  });
});
