import { Color } from 'three';
import { synthesizeBathymetry, type SceneModel } from '@wi/shared';

/** Vertical slice along the longest axis of the waterbody: the deepest water across the width at each position. */
export interface SectionProfile {
  lengthM: number;
  bins: number;
  /** Depth in metres at each bin (0 where the axis leaves the water). */
  depth: Float32Array;
  maxDepthM: number;
  /** Unit vector of the axis in local metres, and the local point at bin 0. */
  axis: [number, number];
  start: [number, number];
}

export function sectionProfile(model: SceneModel, bins = 200): SectionProfile {
  const grid = synthesizeBathymetry(model.outline, {
    maxDepthM: model.maxDepthM,
    meanDepthM: model.meanDepthM,
    isRiver: model.isRiver,
    samples: 140,
  });
  const cells: Array<[number, number, number]> = [];
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const n = j * grid.nx + i;
      if (grid.inside[n])
        cells.push([
          grid.bounds.minX + i * grid.cellX,
          grid.bounds.minY + j * grid.cellY,
          grid.depth[n],
        ]);
    }
  }
  if (!cells.length) {
    return {
      lengthM: 1,
      bins,
      depth: new Float32Array(bins),
      maxDepthM: model.maxDepthM,
      axis: [1, 0],
      start: [0, 0],
    };
  }
  // Principal axis of the water cells.
  const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const my = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of cells) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let smin = Infinity;
  let smax = -Infinity;
  for (const [x, y] of cells) {
    const s = (x - mx) * ux + (y - my) * uy;
    if (s < smin) smin = s;
    if (s > smax) smax = s;
  }
  const length = Math.max(smax - smin, 1);
  const depth = new Float32Array(bins);
  for (const [x, y, d] of cells) {
    const s = (x - mx) * ux + (y - my) * uy;
    const b = Math.max(0, Math.min(bins - 1, Math.floor(((s - smin) / length) * bins)));
    if (d > depth[b]) depth[b] = d;
  }
  // Light smoothing removes grid stair-steps.
  const sm = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const a = depth[Math.max(0, b - 1)];
    const c = depth[Math.min(bins - 1, b + 1)];
    sm[b] = depth[b] === 0 ? 0 : a > 0 && c > 0 ? a * 0.25 + depth[b] * 0.5 + c * 0.25 : depth[b];
  }
  let maxD = 0;
  for (const v of sm) maxD = Math.max(maxD, v);
  return {
    lengthM: length,
    bins,
    depth: sm,
    maxDepthM: Math.max(maxD, 0.1),
    axis: [ux, uy],
    start: [mx + smin * ux, my + smin * uy],
  };
}

// Dissolved oxygen colouring ------------------------------------------------------------------------

const DO_RED = new Color('#d32f2f');
const DO_AMBER = new Color('#f2a81d');
const DO_BLUE = new Color('#2b7bd1');

/** Red below 2 mg/L, amber 2 to 5, blue above 5, blended smoothly between bands. */
export function doColor(mgL: number, out = new Color()): Color {
  if (mgL <= 2) return out.copy(DO_RED);
  if (mgL < 2.6) return out.copy(DO_RED).lerp(DO_AMBER, (mgL - 2) / 0.6);
  if (mgL <= 4.6) return out.copy(DO_AMBER);
  if (mgL < 5.4) return out.copy(DO_AMBER).lerp(DO_BLUE, (mgL - 4.6) / 0.8);
  return out.copy(DO_BLUE);
}

export type DoBand = 'low' | 'moderate' | 'good';
export const doBand = (mgL: number): DoBand => (mgL < 2 ? 'low' : mgL < 5 ? 'moderate' : 'good');

/** Linear interpolation of the profile at a depth; constant beyond the ends. */
export function doAtDepth(profile: Array<{ depthM: number; mgL: number }>, depthM: number): number {
  const p = [...profile].sort((a, b) => a.depthM - b.depthM);
  if (depthM <= p[0].depthM) return p[0].mgL;
  if (depthM >= p[p.length - 1].depthM) return p[p.length - 1].mgL;
  for (let i = 1; i < p.length; i++) {
    if (depthM <= p[i].depthM) {
      const t = (depthM - p[i - 1].depthM) / (p[i].depthM - p[i - 1].depthM || 1);
      return p[i - 1].mgL + (p[i].mgL - p[i - 1].mgL) * t;
    }
  }
  return p[p.length - 1].mgL;
}

// Mesh helper -------------------------------------------------------------------------------------

export interface MeshData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** A (cols x rows) vertex grid with per-vertex position and colour. */
export function gridMesh(
  cols: number,
  rows: number,
  pos: (i: number, j: number) => [number, number, number],
  color: (i: number, j: number) => [number, number, number],
  flip = false,
): MeshData {
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      const p = pos(i, j);
      const c = color(i, j);
      positions.set(p, n * 3);
      colors.set(c, n * 3);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  return { positions, colors, indices: new Uint32Array(idx) };
}

/** Nice tick step (1, 2, 5 x 10^n) giving about `target` ticks across `range`. */
export function niceStep(range: number, target = 6): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}
