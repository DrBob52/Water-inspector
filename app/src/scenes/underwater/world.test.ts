import { describe, expect, it } from 'vitest';
import type { SceneModel } from '@wi/shared';
import { FISH_VISUAL_SCALE, HALF, buildWorld, plantPositions } from './world';

const circle = (r: number): Array<[number, number]> =>
  Array.from({ length: 64 }, (_, i) => [
    r * Math.cos((2 * Math.PI * i) / 64),
    r * Math.sin((2 * Math.PI * i) / 64),
  ]);
const model = (over: Partial<SceneModel> = {}): SceneModel => ({
  outline: circle(5000),
  maxDepthM: 120,
  meanDepthM: 40,
  depthEstimated: false,
  visibilityM: 8,
  waterTint: '#0e5692',
  actors: [],
  pollutants: [],
  pollutantDetails: [],
  listedImpairments: [],
  isRiver: false,
  surfaceElevationM: 0,
  stations: [],
  plantCount: 3,
  name: 'T',
  origin: [0, 0],
  demo: true,
  ...over,
});

describe('underwater world', () => {
  it('has a shoreline shelf on one side and deeper water on the other', () => {
    const w = buildWorld(model());
    expect(w.bedDepth(-HALF, 0)).toBeLessThan(0.3);
    expect(w.bedDepth(-HALF + 30, 0)).toBeLessThan(w.shelfDepthM + 1.5);
    expect(w.bedDepth(HALF - 5, 0)).toBeGreaterThan(w.bedDepth(-HALF + 30, 0) + 3);
  });
  it('never exceeds the lake max depth and is never negative', () => {
    const w = buildWorld(model({ maxDepthM: 6 }));
    for (let x = -HALF; x <= HALF; x += 10)
      for (let z = -HALF; z <= HALF; z += 25) {
        expect(w.bedDepth(x, z)).toBeGreaterThanOrEqual(0);
        expect(w.bedDepth(x, z)).toBeLessThanOrEqual(6 * 1.15 + 0.5);
      }
  });
  it('keeps the camera path inside the water column, above the bed', () => {
    for (const m of [
      model(),
      model({ maxDepthM: 4, meanDepthM: 2 }),
      model({ maxDepthM: 500, meanDepthM: 300 }),
      model({ isRiver: true, maxDepthM: 7, meanDepthM: 4 }),
    ]) {
      const w = buildWorld(m);
      for (let t = 0; t < 1; t += 0.02) {
        const p = w.curve.getPointAt(t);
        expect(p.y).toBeLessThan(0);
        expect(p.y).toBeGreaterThanOrEqual(-w.bedDepth(p.x, p.z) - 0.3);
      }
      expect(w.curveLength).toBeGreaterThan(80);
    }
  });
  it('sets fog from the visibility, rendered with at least 2.2 m', () => {
    const clear = buildWorld(model({ visibilityM: 30 }));
    const murky = buildWorld(model({ visibilityM: 0.5 }));
    expect(clear.fogDensity).toBeCloseTo(1.5 / 30, 6);
    expect(murky.fogDensity).toBeCloseTo(1.5 / 2.2, 6);
  });
  it('places plants only in shallow water near the shore', () => {
    const w = buildWorld(model());
    const plants = plantPositions(w, 200);
    expect(plants.length).toBeGreaterThan(50);
    for (const p of plants) {
      expect(-p.y).toBeLessThanOrEqual(7);
      expect(p.x).toBeLessThan(-HALF + 80);
    }
  });
  it('keeps the simulation area inside the patch', () => {
    const w = buildWorld(model());
    expect(w.bounds.minX).toBeGreaterThanOrEqual(-HALF);
    expect(w.bounds.maxX).toBeLessThanOrEqual(HALF);
    expect(FISH_VISUAL_SCALE).toBeGreaterThan(1);
  });
});
