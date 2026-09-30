import { describe, expect, it } from 'vitest';
import type { SceneModel } from '@wi/shared';
import { doAtDepth, doBand, doColor, gridMesh, niceStep, sectionProfile } from './section';

const base: SceneModel = {
  outline: [],
  maxDepthM: 40,
  meanDepthM: 15,
  depthEstimated: false,
  visibilityM: 5,
  waterTint: '#0e5692',
  actors: [],
  pollutants: [],
  pollutantDetails: [],
  listedImpairments: [],
  isRiver: false,
  surfaceElevationM: 0,
  stations: [],
  plantCount: 0,
  name: 'T',
  origin: [0, 0],
  demo: true,
};
const ellipse = (a: number, b: number, rot = 0): Array<[number, number]> =>
  Array.from({ length: 80 }, (_, i) => {
    const t = (2 * Math.PI * i) / 80;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    return [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)] as [
      number,
      number,
    ];
  });

describe('sectionProfile', () => {
  it('follows the longest axis of a long narrow lake, whatever its orientation', () => {
    for (const rot of [0, Math.PI / 4, Math.PI / 2]) {
      const p = sectionProfile({ ...base, outline: ellipse(6000, 1000, rot) });
      expect(p.lengthM).toBeGreaterThan(11000);
      expect(p.lengthM).toBeLessThan(12100);
      expect(
        Math.abs(Math.abs(p.axis[0] * Math.cos(rot) + p.axis[1] * Math.sin(rot)) - 1),
      ).toBeLessThan(0.05);
    }
  });
  it('is deepest in the middle and shallow at the ends, reaching the max depth', () => {
    const p = sectionProfile({ ...base, outline: ellipse(5000, 2000) });
    const mid = p.depth[Math.floor(p.bins / 2)];
    expect(mid).toBeGreaterThan(p.depth[5]);
    expect(mid).toBeGreaterThan(p.depth[p.bins - 6]);
    expect(p.maxDepthM).toBeGreaterThan(30);
    expect(p.maxDepthM).toBeLessThanOrEqual(40.5);
  });
  it('handles a degenerate outline without throwing', () => {
    expect(sectionProfile({ ...base, outline: [] }).depth).toHaveLength(200);
  });
});

describe('dissolved oxygen colours and bands', () => {
  it('is red below 2, amber 2 to 5, blue above 5', () => {
    const c = (v: number) => doColor(v).getHexString();
    expect(c(1)).toBe(c(0.2));
    expect(c(3)).toBe(c(4));
    expect(c(7)).toBe(c(11));
    expect(new Set([c(1), c(3), c(7)]).size).toBe(3);
    const red = doColor(1);
    const amber = doColor(3.5);
    const blue = doColor(8);
    expect(red.r).toBeGreaterThan(red.b);
    expect(amber.r).toBeGreaterThan(amber.b);
    expect(blue.b).toBeGreaterThan(blue.r);
    expect([doBand(1.9), doBand(2), doBand(4.99), doBand(5)]).toEqual([
      'low',
      'moderate',
      'moderate',
      'good',
    ]);
  });
  it('interpolates a DO profile by depth', () => {
    const prof = [
      { depthM: 1, mgL: 9 },
      { depthM: 11, mgL: 1 },
    ];
    expect(doAtDepth(prof, 0)).toBe(9);
    expect(doAtDepth(prof, 6)).toBe(5);
    expect(doAtDepth(prof, 50)).toBe(1);
  });
});

describe('helpers', () => {
  it('builds a grid mesh with the right counts', () => {
    const m = gridMesh(
      4,
      3,
      (i, j) => [i, j, 0],
      () => [1, 1, 1],
    );
    expect(m.positions).toHaveLength(4 * 3 * 3);
    expect(m.indices).toHaveLength(3 * 2 * 6);
  });
  it('chooses nice tick steps', () => {
    expect(niceStep(100)).toBe(20);
    expect(niceStep(122, 6)).toBe(20);
    expect(niceStep(12, 6)).toBe(2);
    expect(niceStep(0.5, 5)).toBe(0.1);
  });
});
