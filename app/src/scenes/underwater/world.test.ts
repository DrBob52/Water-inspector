import { describe, expect, it } from 'vitest';
import type { SceneModel } from '@wi/shared';
import {
  FISH_VISUAL_SCALE,
  HALF,
  MIN_RENDER_VISIBILITY,
  bedPositions,
  buildWorld,
  logPositions,
  particleBudget,
  plantPositions,
  rockPositions,
  waterOptics,
  type World,
} from './world';

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
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

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
      model({ visibilityM: 0.5 }),
      model({ visibilityM: 50, maxDepthM: 590, meanDepthM: 350 }),
    ]) {
      const w = buildWorld(m);
      for (let t = 0; t < 1; t += 0.02) {
        const p = w.curve.getPointAt(t);
        expect(p.y).toBeLessThan(0);
        expect(p.y).toBeGreaterThanOrEqual(-w.bedDepth(p.x, p.z) - 0.3);
      }
      // A slow, composed drift: long enough to move, short enough to keep the framing.
      expect(w.curveLength).toBeGreaterThan(12);
      const p0 = w.curve.getPointAt(0);
      for (let t = 0; t < 1; t += 0.05)
        expect(w.curve.getPointAt(t).distanceTo(p0)).toBeLessThan(35);
    }
  });
  it('frames clear water over a shallow bed (caustics) and comes in close in murky water', () => {
    const clear = buildWorld(model({ visibilityM: 30 }));
    const murky = buildWorld(model({ visibilityM: 0.7 }));
    const c0 = clear.curve.getPointAt(0);
    expect(clear.bedDepth(c0.x, c0.z)).toBeLessThan(8);
    expect(murky.clearance).toBeLessThan(clear.clearance);
    expect(murky.renderVisibility).toBe(MIN_RENDER_VISIBILITY);
    // The arena shrinks with visibility so the fish stay within sight.
    const span = (w: World) => w.bounds.maxX - w.bounds.minX;
    expect(span(murky)).toBeLessThan(span(clear));
    for (const w of [clear, murky]) {
      expect(w.focus.x).toBeGreaterThanOrEqual(w.bounds.minX);
      expect(w.focus.x).toBeLessThanOrEqual(w.bounds.maxX);
      expect(w.littoralX).toBeLessThan(w.focus.x);
    }
  });
  it('sets fog from the visibility, rendered with at least 2.2 m', () => {
    const clear = buildWorld(model({ visibilityM: 30 }));
    const murky = buildWorld(model({ visibilityM: 0.5 }));
    expect(clear.fogDensity).toBeCloseTo(1.5 / 30, 6);
    expect(murky.fogDensity).toBeCloseTo(1.5 / 2.2, 6);
  });
  it('derives the water colour and light from tint, visibility and chlorophyll', () => {
    const tahoe = waterOptics({ visibilityM: 29, waterTint: '#0f5691', chlorophyllUgL: 0.4 });
    const erie = waterOptics({ visibilityM: 0.7, waterTint: '#487251', chlorophyllUgL: 35 });
    // Clear water is blue, the bloom is green.
    expect(tahoe.horizon[2]).toBeGreaterThan(tahoe.horizon[1]);
    expect(erie.horizon[1]).toBeGreaterThan(erie.horizon[2]);
    // Reds go first in clear water; everything goes faster in murky water.
    expect(tahoe.extinction[0]).toBeGreaterThan(tahoe.extinction[2]);
    for (let i = 0; i < 3; i++) expect(erie.extinction[i]).toBeGreaterThan(tahoe.extinction[i]);
    // Long bright shafts and crisp caustics only where the water is clear.
    expect(tahoe.shaftLength).toBeGreaterThan(erie.shaftLength * 4);
    expect(tahoe.causticStrength).toBeGreaterThan(erie.causticStrength * 3);
    expect(tahoe.sunColor[0]).toBeGreaterThan(erie.sunColor[0]);
    expect(tahoe.clarity).toBeGreaterThan(0.9);
    expect(erie.clarity).toBeLessThan(0.05);
    // Looking up is brighter than looking across, which is brighter than looking down.
    for (const o of [tahoe, erie]) {
      expect(lum(o.up)).toBeGreaterThan(lum(o.horizon));
      expect(lum(o.horizon)).toBeGreaterThan(lum(o.deep));
    }
    // Chlorophyll pushes the same tint toward green.
    const blue = waterOptics({ visibilityM: 5, waterTint: '#195e83', chlorophyllUgL: 0 });
    const greener = waterOptics({ visibilityM: 5, waterTint: '#195e83', chlorophyllUgL: 20 });
    expect(greener.horizon[1] / greener.horizon[2]).toBeGreaterThan(
      blue.horizon[1] / blue.horizon[2],
    );
  });
  it('scales suspended sediment with turbidity and algae specks with chlorophyll-a', () => {
    const base = { visibilityM: 5 };
    const a = particleBudget({ ...base, turbidityNtu: 0.5, chlorophyllUgL: 1 });
    const b = particleBudget({ ...base, turbidityNtu: 5, chlorophyllUgL: 1 });
    const c = particleBudget({ ...base, turbidityNtu: 0.5, chlorophyllUgL: 20 });
    expect(b.sediment).toBeGreaterThan(a.sediment);
    expect(c.algae).toBeGreaterThan(a.algae);
    expect(c.sediment).toBe(a.sediment);
    const huge = particleBudget({ visibilityM: 60, turbidityNtu: 100, chlorophyllUgL: 300 });
    expect(huge.sediment).toBeLessThanOrEqual(1800);
    expect(huge.algae).toBeLessThanOrEqual(1200);
    // The box of water drawn around the camera follows the visibility.
    expect(particleBudget({ visibilityM: 30 }).box).toBeGreaterThan(
      particleBudget({ visibilityM: 1 }).box,
    );
  });
  it('places plants in clumps on the shallow littoral bed, clear of the camera path', () => {
    for (const m of [model(), model({ visibilityM: 1, maxDepthM: 10, meanDepthM: 4 })]) {
      const w = buildWorld(m);
      const plants = plantPositions(w, 300, 3, 2);
      expect(plants.length).toBeGreaterThan(50);
      const path = Array.from({ length: 40 }, (_, i) => w.curve.getPointAt(i / 40));
      for (const p of plants) {
        expect(-p.y).toBeLessThanOrEqual(7);
        expect(-p.y).toBeGreaterThanOrEqual(0.5);
        expect(p.h).toBeLessThan(-p.y);
        expect(p.x).toBeGreaterThanOrEqual(w.bounds.minX);
        expect(p.x).toBeLessThanOrEqual(w.bounds.maxX);
        const near = Math.min(...path.map((q) => Math.hypot(q.x - p.x, q.z - p.z)));
        expect(near).toBeGreaterThan(0.6);
      }
      expect(new Set(plants.map((p) => p.kind)).size).toBe(2);
    }
  });
  it('rests rocks, logs and bed critters on the bed', () => {
    const w = buildWorld(model());
    const rocks = rockPositions(w, 40);
    expect(rocks.length).toBe(40);
    for (const r of rocks) {
      const bed = -w.bedDepth(r.x, r.z);
      expect(r.y).toBeLessThanOrEqual(bed);
      expect(r.y).toBeGreaterThan(bed - r.sy);
      expect(r.sy).toBeLessThan(w.bedDepth(r.x, r.z));
    }
    const logs = logPositions(w, 2);
    expect(logs).toHaveLength(2);
    for (const l of logs) {
      expect(Math.abs(l.y + w.bedDepth(l.x, l.z))).toBeLessThan(1.2);
      expect(Math.abs(l.pitch)).toBeLessThan(0.8);
    }
    for (const c of bedPositions(w, 10, 0.8, 30, 1)) {
      expect(c.y).toBeCloseTo(-w.bedDepth(c.x, c.z), 6);
      expect(c.x).toBeGreaterThanOrEqual(w.bounds.minX);
      expect(c.x).toBeLessThanOrEqual(w.bounds.maxX);
    }
  });
  it('keeps the simulation area inside the patch', () => {
    const w = buildWorld(model());
    expect(w.bounds.minX).toBeGreaterThanOrEqual(-HALF);
    expect(w.bounds.maxX).toBeLessThanOrEqual(HALF);
    expect(FISH_VISUAL_SCALE).toBeGreaterThan(1);
  });
});
