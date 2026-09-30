import { describe, expect, it } from 'vitest';
import type { Ring } from './geo';
import {
  DEFAULT_K,
  contourInterval,
  contourSegments,
  depthShape,
  synthesizeBathymetry,
} from './bathymetry';

function circle(r: number, n = 120): Ring {
  return Array.from({ length: n }, (_, i): [number, number] => [
    r * Math.cos((2 * Math.PI * i) / n),
    r * Math.sin((2 * Math.PI * i) / n),
  ]);
}
function blob(): Ring {
  return Array.from({ length: 200 }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / 200;
    const r = 3000 * (1 + 0.25 * Math.sin(3 * a) + 0.1 * Math.cos(5 * a));
    return [1.6 * r * Math.cos(a), r * Math.sin(a)];
  });
}
function river(): Ring {
  return [
    [-5000, -40],
    [5000, -40],
    [5000, 40],
    [-5000, 40],
  ];
}

describe('synthesizeBathymetry', () => {
  it('matches the target mean depth within 10% for a range of depth ratios', () => {
    for (const [max, mean] of [
      [122, 19.5],
      [501, 303],
      [19, 7.4],
      [594, 350],
      [40, 6],
      [19.5, 10.9],
    ]) {
      for (const outline of [circle(4000), blob()]) {
        const g = synthesizeBathymetry(outline, { maxDepthM: max, meanDepthM: mean, samples: 120 });
        expect(Math.abs(g.meanDepthM - mean) / mean, `max ${max} mean ${mean}`).toBeLessThan(0.1);
        // and the actual mesh agrees with the reported mean
        let s = 0;
        let n = 0;
        for (let i = 0; i < g.depth.length; i++) {
          if (g.inside[i]) {
            s += g.depth[i];
            n++;
          }
        }
        expect(Math.abs(s / n - mean) / mean).toBeLessThan(0.1);
        expect(Math.max(...g.depth)).toBeLessThanOrEqual(max + 1e-3);
        expect(Math.max(...g.depth)).toBeGreaterThan(max * 0.93);
      }
    }
  });
  it('uses k = 0.7 when the mean depth is unknown', () => {
    expect(synthesizeBathymetry(circle(2000), { maxDepthM: 30, samples: 60 }).k).toBe(DEFAULT_K);
  });
  it('is zero outside the waterbody and at the shoreline, deepest inside', () => {
    const g = synthesizeBathymetry(circle(1000), {
      maxDepthM: 50,
      meanDepthM: 20,
      samples: 80,
      bounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
    });
    expect(g.depthAt(1800, 0)).toBe(0);
    expect(g.depthAt(999, 0)).toBeLessThan(2);
    expect(g.depthAt(0, 0)).toBeGreaterThan(45);
    expect(g.depth[0]).toBe(0);
  });
  it('gives rivers a parabolic channel, deepest on the centre line', () => {
    const g = synthesizeBathymetry(river(), { maxDepthM: 8, isRiver: true, samples: 200 });
    expect(g.depthAt(0, 0)).toBeGreaterThan(7.6);
    expect(g.depthAt(0, 30)).toBeLessThan(g.depthAt(0, 10));
    expect(g.depthAt(0, 39)).toBeLessThan(1);
    // parabola: mean / max tends to 2/3 across the channel
    expect(g.meanDepthM / 8).toBeGreaterThan(0.55);
    expect(g.meanDepthM / 8).toBeLessThan(0.75);
  });
  it('clamps impossible mean depths instead of failing', () => {
    const g = synthesizeBathymetry(circle(1000), { maxDepthM: 10, meanDepthM: 10, samples: 60 });
    expect(Number.isFinite(g.k)).toBe(true);
    expect(g.meanDepthM).toBeLessThanOrEqual(10);
  });
});

describe('depthShape', () => {
  it('is x^k for lakes and a parabola for rivers', () => {
    expect(depthShape(0.5, 2, false)).toBeCloseTo(0.25, 9);
    expect(depthShape(0.5, 2, true)).toBeCloseTo(0.75, 9);
    expect(depthShape(2, 2, false)).toBe(1);
    expect(depthShape(-1, 2, false)).toBe(0);
  });
});

describe('contours', () => {
  it('chooses an interval giving 5 to 10 lines', () => {
    for (const d of [3, 12, 19.5, 50, 122, 501, 594]) {
      const n = Math.floor((d * 0.999) / contourInterval(d));
      expect(n, `depth ${d}`).toBeGreaterThanOrEqual(4);
      expect(n, `depth ${d}`).toBeLessThanOrEqual(11);
    }
  });
  it('produces closed-looking loops at each level for a bowl', () => {
    const g = synthesizeBathymetry(circle(2000), { maxDepthM: 60, meanDepthM: 25, samples: 120 });
    const lines = contourSegments(g, 10);
    expect(lines.map((l) => l.level)).toEqual([10, 20, 30, 40, 50]);
    for (const l of lines) {
      expect(l.segments.length).toBeGreaterThan(40);
      // every segment endpoint sits at the requested depth within a cell
      for (let i = 0; i < l.segments.length; i += 4) {
        const d = g.depthAt(l.segments[i], l.segments[i + 1]);
        expect(Math.abs(d - l.level)).toBeLessThan(6);
      }
    }
    // deeper contours are smaller loops
    expect(lines[4].segments.length).toBeLessThan(lines[0].segments.length);
  });
});
