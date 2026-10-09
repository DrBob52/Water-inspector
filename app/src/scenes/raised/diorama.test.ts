import { describe, expect, it } from 'vitest';
import type { DemGrid, SceneModel } from '@wi/shared';
import type { Color } from 'three';
import {
  BLOCK_UNITS,
  GRID_SAMPLES,
  MAX_EXAGGERATION,
  MAX_GRID_SAMPLES,
  MIN_EXAGGERATION,
  PLINTH_HEIGHT_UNITS,
  WALL_THICKNESS_UNITS,
  applyExaggeration,
  autoExaggeration,
  bakeAmbientOcclusion,
  bedTint,
  blockExtent,
  buildDiorama,
  gridSamplesFor,
  hypsometricTint,
  stationOnScene,
} from './diorama';

const circle = (r: number, n = 64): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [
    r * Math.cos((2 * Math.PI * i) / n),
    r * Math.sin((2 * Math.PI * i) / n),
  ]);
const model = (over: Partial<SceneModel> = {}): SceneModel => ({
  outline: circle(2000),
  maxDepthM: 60,
  meanDepthM: 25,
  depthEstimated: false,
  visibilityM: 5,
  waterTint: '#0e5692',
  actors: [],
  pollutants: [],
  pollutantDetails: [],
  listedImpairments: [],
  isRiver: false,
  surfaceElevationM: 100,
  stations: [],
  plantCount: 0,
  name: 'T',
  origin: [-73, 44],
  demo: true,
  ...over,
});
// A DEM that rises 200 m toward the east.
const dem = (): DemGrid => ({
  bbox: [-73.2, 43.8, -72.8, 44.2],
  width: 40,
  height: 40,
  elevations: Array.from({ length: 1600 }, (_, n) => 100 + (n % 40) * 5),
});

describe('buildDiorama', () => {
  it('makes a block of the waterbody plus a 2 km margin, 100 units on its long side', () => {
    const d = buildDiorama(model(), dem());
    expect(d.blockW).toBeCloseTo(8000, 0);
    expect(d.blockH).toBeCloseTo(8000, 0);
    expect(d.widthU).toBeCloseTo(BLOCK_UNITS, 6);
    expect(d.positions).toHaveLength(d.nx * d.ny * 3);
    expect(d.indices).toHaveLength((d.nx - 1) * (d.ny - 1) * 6);
    expect(d.indices.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(d.nx * d.ny);
  });
  it('puts the lake bed below the water surface and the land above it', () => {
    const d = buildDiorama(model(), dem());
    const centre = d.heightAt(0, 0);
    expect(centre).toBeLessThan(0);
    expect(centre / d.S).toBeLessThan(-50); // near max depth 60 m
    const land = d.heightAt(3500, 0);
    expect(land).toBeGreaterThan(0);
    expect(d.heightAt(-3500, 0)).toBeGreaterThan(0);
  });
  it('uses the DEM for land relative to the surface elevation', () => {
    const east = buildDiorama(model(), dem());
    const flat = buildDiorama(model(), null);
    expect(east.heightAt(3500, 0)).not.toBeCloseTo(flat.heightAt(3500, 0), 2);
  });
  it('shades terrain with finite vertex colours', () => {
    const d = buildDiorama(model(), dem());
    expect(d.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1.3)).toBe(true);
  });
  it('builds four walls (top and base rows) with outward normals and strata attributes', () => {
    const d = buildDiorama(model(), dem());
    const cols = d.nx * 2 + d.ny * 2;
    expect(d.wall.positions).toHaveLength(cols * 2 * 3);
    expect(d.wall.top).toHaveLength(cols * 2);
    expect(d.wall.along).toHaveLength(cols * 2);
    expect(d.wall.indices.length).toBe(((d.nx - 1) * 2 + (d.ny - 1) * 2) * 6);
    const normals = new Set<string>();
    for (let i = 0; i < d.wall.normals.length; i += 3)
      normals.add(`${d.wall.normals[i]},${d.wall.normals[i + 1]},${d.wall.normals[i + 2]}`);
    expect([...normals].sort()).toEqual(['-1,0,0', '0,0,-1', '0,0,1', '1,0,0']);
    // Faces wind counter-clockwise seen from outside (front faces point out of the block).
    const p = (v: number) => [
      d.wall.positions[v * 3],
      d.wall.positions[v * 3 + 1],
      d.wall.positions[v * 3 + 2],
    ];
    for (let t = 0; t < d.wall.indices.length; t += 6 * 40) {
      const [a, b, c] = [0, 1, 2].map((k) => p(d.wall.indices[t + k]));
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const vi = d.wall.indices[t] * 3;
      const out = [d.wall.normals[vi], d.wall.normals[vi + 1], d.wall.normals[vi + 2]];
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
    }
  });
  it('has no glass panels when the water does not reach the block edge', () => {
    const d = buildDiorama(model(), dem());
    expect(d.glass.indices).toHaveLength(0);
  });
  it('chooses a contour interval giving 5 to 10 lines', () => {
    const d = buildDiorama(model(), dem());
    expect(d.contourInterval).toBe(10);
    const lines = Math.floor((60 - 1e-6) / d.contourInterval);
    expect(lines).toBeGreaterThanOrEqual(4);
    expect(lines).toBeLessThanOrEqual(11);
  });
  it('keeps the shoreline where the outline is (heights cross zero near the true shore)', () => {
    const d = buildDiorama(model(), dem());
    const { grid } = d;
    const cell = Math.max(grid.cellX, grid.cellY);
    // Along the row through the centre, the height changes sign within a cell of r = 2000 m.
    const j = Math.round((0 - grid.bounds.minY) / grid.cellY);
    let crossing = NaN;
    for (let i = 0; i < grid.nx - 1; i++) {
      const a = d.elevM[j * grid.nx + i];
      const b = d.elevM[j * grid.nx + i + 1];
      if (a < 0 && b >= 0) {
        const x0 = grid.bounds.minX + i * grid.cellX;
        crossing = x0 + (a / (a - b)) * grid.cellX;
      }
    }
    expect(Math.abs(Math.abs(crossing) - 2000)).toBeLessThan(cell);
  });
  it('encodes depth and distance to shore in the water texture', () => {
    const d = buildDiorama(model(), dem());
    const { grid } = d;
    expect(d.waterTex.data).toHaveLength(grid.nx * grid.ny * 4);
    const centre = Math.round(grid.ny / 2) * grid.nx + Math.round(grid.nx / 2);
    expect(d.waterTex.data[centre * 4]).toBeGreaterThan(200);
    expect(d.waterTex.data[0]).toBe(0); // land corner: no depth
  });
  it('frames the block with its plinth', () => {
    const d = buildDiorama(model(), dem());
    const e = blockExtent(d, 4);
    expect(e.width).toBeGreaterThan(d.widthU);
    expect(e.bottom).toBeCloseTo(-d.maxDepthU * 4 - WALL_THICKNESS_UNITS - PLINTH_HEIGHT_UNITS, 5);
    expect(e.top).toBeGreaterThan(0);
  });
  it('maps stations to the scene', () => {
    const d = buildDiorama(model(), dem());
    const s = stationOnScene(d, -73, 44);
    expect(Math.hypot(s.x, s.z)).toBeLessThan(1);
    expect(s.rawY).toBeLessThan(0);
  });
});

describe('vertical exaggeration', () => {
  it('auto exaggeration puts the deepest point at at least 8% of the block width (clamped 1 to 20)', () => {
    expect(autoExaggeration(60, 8000)).toBeCloseTo(10.67, 1);
    expect(autoExaggeration(2000, 8000)).toBe(MIN_EXAGGERATION);
    expect(autoExaggeration(1, 80000)).toBe(MAX_EXAGGERATION);
    const d = buildDiorama(model(), dem());
    expect(d.maxDepthU * d.autoExaggeration).toBeGreaterThanOrEqual(0.08 * BLOCK_UNITS - 1e-6);
  });
  it('scales heights and keeps a constant-thickness base', () => {
    const d = buildDiorama(model(), dem());
    const n = Math.floor(d.ny / 2) * d.nx + Math.floor(d.nx / 2);
    applyExaggeration(d, 1);
    const y1 = d.positions[n * 3 + 1];
    const base1 = Math.min(
      ...Array.from({ length: d.wall.positions.length / 3 }, (_, i) => d.wall.positions[i * 3 + 1]),
    );
    applyExaggeration(d, 5);
    expect(d.positions[n * 3 + 1]).toBeCloseTo(y1 * 5, 5);
    const base5 = Math.min(
      ...Array.from({ length: d.wall.positions.length / 3 }, (_, i) => d.wall.positions[i * 3 + 1]),
    );
    // below the deepest bed by exactly the wall thickness
    expect(base1 + d.maxDepthU).toBeCloseTo(-WALL_THICKNESS_UNITS, 5);
    expect(base5 + d.maxDepthU * 5).toBeCloseTo(-WALL_THICKNESS_UNITS, 5);
    // Each wall column carries its exaggerated top for the strata shader.
    expect(d.wall.top[0]).toBeCloseTo(d.wall.rawTop[0] * 5, 5);
  });
});

describe('terrain shading', () => {
  const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  it('runs from deep green lowland to rock and snow on high peaks', () => {
    const low = hypsometricTint(150, 0.05, 0.05);
    expect(low.g).toBeGreaterThan(low.r);
    expect(low.g).toBeGreaterThan(low.b);
    const peak = hypsometricTint(2900, 0.95, 0.2);
    expect(lum(peak)).toBeGreaterThan(0.6); // snow
    const lowlandTop = hypsometricTint(300, 1, 0.2);
    expect(lum(lowlandTop)).toBeLessThan(0.4); // no snow on low hills
  });
  it('exposes rock on steep slopes', () => {
    const flat = hypsometricTint(400, 0.2, 0.02);
    const steep = hypsometricTint(400, 0.2, 1.2);
    expect(steep.r - steep.g).toBeGreaterThan(flat.r - flat.g);
  });
  it('tints the bed from pale sand in the shallows to deep blue', () => {
    const shallow = bedTint(0);
    const deep = bedTint(1);
    expect(lum(shallow)).toBeGreaterThan(lum(deep));
    expect(deep.b).toBeGreaterThan(deep.r);
  });
  it('bakes ambient occlusion darker in a pit than on a peak', () => {
    const n = 21;
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) h[j * n + i] = Math.hypot(i - 10, j - 10) * 0.5;
    const ao = bakeAmbientOcclusion(h, n, n, 1, 1);
    expect(ao[10 * n + 10]).toBeLessThan(0.7);
    const peak = new Float32Array(n * n).map((_, k) => -h[k]);
    expect(bakeAmbientOcclusion(peak, n, n, 1, 1)[10 * n + 10]).toBe(1);
  });
  it('gives long thin blocks more samples along their length', () => {
    expect(gridSamplesFor(8000, 8000)).toBeGreaterThanOrEqual(GRID_SAMPLES);
    expect(gridSamplesFor(37000, 175000)).toBeGreaterThan(gridSamplesFor(8000, 8000));
    expect(gridSamplesFor(1000, 900000)).toBe(MAX_GRID_SAMPLES);
  });
  it('colours stay finite and in range', () => {
    const d = buildDiorama(model(), dem());
    expect(d.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1.3)).toBe(true);
  });
});
