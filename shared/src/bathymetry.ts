import { distToRing, pointInRing, type Ring } from './geo';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function ringBounds(ring: Ring): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

export interface BathymetryOptions {
  maxDepthM: number;
  /** Target mean depth of the synthesised mesh. Unknown: k defaults to 0.7. */
  meanDepthM?: number;
  /** Rivers use a parabolic channel cross-section, deepest on the centreline. */
  isRiver?: boolean;
  /** Grid samples along the longer side of the bounds. */
  samples?: number;
  /** Area covered by the grid. Defaults to the outline bounds. */
  bounds?: Bounds;
}

export const DEFAULT_K = 0.7;
const K_MIN = 0.05;
const K_MAX = 14;

/** Depth shape: fraction of max depth at relative distance-to-shore x in [0, 1]. */
export function depthShape(x: number, k: number, isRiver: boolean): number {
  const c = Math.max(0, Math.min(1, x));
  return isRiver ? 1 - (1 - c) * (1 - c) : Math.pow(c, k);
}

export interface BathymetryGrid {
  nx: number;
  ny: number;
  bounds: Bounds;
  cellX: number;
  cellY: number;
  /** Depth below the surface in metres, 0 outside the waterbody. Row 0 is the minimum-y row. */
  depth: Float32Array;
  /** Signed distance to shore in metres: positive inside, negative outside. */
  signedDistance: Float32Array;
  inside: Uint8Array;
  maxDistanceM: number;
  k: number;
  maxDepthM: number;
  /** Mean depth of the synthesised mesh over inside cells. */
  meanDepthM: number;
  /** Depth at an arbitrary local point (metres), using the same shape as the mesh. */
  depthAt: (x: number, y: number) => number;
}

/** Nearest-edge distance using a precomputed segment list. */
function makeSignedDistance(ring: Ring) {
  return (x: number, y: number) => {
    const d = distToRing(x, y, ring);
    return pointInRing(x, y, ring) ? d : -d;
  };
}

/**
 * Synthesise a bathymetry surface from max depth and shape (spec 8.2): depth = maxDepth * f(d / dMax)
 * with f(x) = x^k, k solved so the mesh's mean depth matches the target (default k = 0.7). Rivers use
 * a parabolic channel. The result is always a model, not a survey.
 */
export function synthesizeBathymetry(outline: Ring, opts: BathymetryOptions): BathymetryGrid {
  const b = opts.bounds ?? ringBounds(outline);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const samples = opts.samples ?? 160;
  const nx = w >= h ? samples : Math.max(8, Math.round((samples * w) / h));
  const ny = h > w ? samples : Math.max(8, Math.round((samples * h) / w));
  const cellX = w / (nx - 1);
  const cellY = h / (ny - 1);
  const sd = new Float32Array(nx * ny);
  const inside = new Uint8Array(nx * ny);
  const signed = makeSignedDistance(outline);
  let dMax = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = signed(b.minX + i * cellX, b.minY + j * cellY);
      const idx = j * nx + i;
      sd[idx] = v;
      if (v > 0) {
        inside[idx] = 1;
        if (v > dMax) dMax = v;
      }
    }
  }
  // The grid can miss the true deepest point; refine dMax with a few local probes around the best cell.
  if (dMax > 0) {
    let bi = 0;
    let best = -1;
    for (let n = 0; n < sd.length; n++) {
      if (sd[n] > best) {
        best = sd[n];
        bi = n;
      }
    }
    const bx = b.minX + (bi % nx) * cellX;
    const by = b.minY + Math.floor(bi / nx) * cellY;
    for (let s = 0; s < 40; s++) {
      const x = bx + ((s % 7) - 3) * cellX * 0.4;
      const y = by + (Math.floor(s / 7) - 2) * cellY * 0.4;
      dMax = Math.max(dMax, signed(x, y));
    }
  }
  const maxDepth = Math.max(0.1, opts.maxDepthM);
  const isRiver = !!opts.isRiver;

  const insideXs: number[] = [];
  for (let n = 0; n < sd.length; n++)
    if (inside[n]) insideXs.push(Math.min(1, sd[n] / Math.max(dMax, 1e-9)));

  const meanFor = (k: number) => {
    if (!insideXs.length) return 0;
    let s = 0;
    for (const x of insideXs) s += depthShape(x, k, isRiver);
    return (s / insideXs.length) * maxDepth;
  };

  let k = DEFAULT_K;
  if (!isRiver && opts.meanDepthM !== undefined && insideXs.length) {
    const target = Math.max(0.02 * maxDepth, Math.min(0.98 * maxDepth, opts.meanDepthM));
    // mean is strictly decreasing in k, so bisect.
    let lo = K_MIN;
    let hi = K_MAX;
    if (meanFor(lo) <= target) k = lo;
    else if (meanFor(hi) >= target) k = hi;
    else {
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        if (meanFor(mid) > target) lo = mid;
        else hi = mid;
      }
      k = (lo + hi) / 2;
    }
  }

  const depth = new Float32Array(nx * ny);
  for (let n = 0; n < depth.length; n++) {
    if (inside[n]) depth[n] = maxDepth * depthShape(sd[n] / Math.max(dMax, 1e-9), k, isRiver);
  }
  const depthAt = (x: number, y: number) => {
    const d = signed(x, y);
    return d > 0 ? maxDepth * depthShape(d / Math.max(dMax, 1e-9), k, isRiver) : 0;
  };

  return {
    nx,
    ny,
    bounds: b,
    cellX,
    cellY,
    depth,
    signedDistance: sd,
    inside,
    maxDistanceM: dMax,
    k,
    maxDepthM: maxDepth,
    meanDepthM: meanFor(k),
    depthAt,
  };
}

/** Choose a contour interval (1, 2, 5, 10, 20, 50, ...) giving roughly 5 to 10 lines. */
export function contourInterval(maxDepthM: number): number {
  const target = maxDepthM / 7;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-6))));
  const f = target / pow;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return Math.max(0.5, nice * pow);
}

export interface ContourLine {
  level: number;
  /** Flat [x1, y1, x2, y2, ...] segment list in local metres. */
  segments: number[];
}

/** Marching squares over the depth grid at every `interval` metres (inside cells only). */
export function contourSegments(grid: BathymetryGrid, interval: number): ContourLine[] {
  const { nx, ny, bounds, cellX, cellY, depth, maxDepthM } = grid;
  const out: ContourLine[] = [];
  for (let level = interval; level < maxDepthM * 0.999; level += interval) {
    const seg: number[] = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = depth[j * nx + i];
        const b = depth[j * nx + i + 1];
        const c = depth[(j + 1) * nx + i + 1];
        const d = depth[(j + 1) * nx + i];
        const mask =
          (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
        if (mask === 0 || mask === 15) continue;
        const x0 = bounds.minX + i * cellX;
        const y0 = bounds.minY + j * cellY;
        const lerp = (v0: number, v1: number) => (level - v0) / (v1 - v0 || 1e-9);
        // edge points: bottom (a-b), right (b-c), top (d-c), left (a-d)
        const eb: [number, number] = [x0 + lerp(a, b) * cellX, y0];
        const er: [number, number] = [x0 + cellX, y0 + lerp(b, c) * cellY];
        const et: [number, number] = [x0 + lerp(d, c) * cellX, y0 + cellY];
        const el: [number, number] = [x0, y0 + lerp(a, d) * cellY];
        const push = (p: [number, number], q: [number, number]) => seg.push(p[0], p[1], q[0], q[1]);
        switch (mask) {
          case 1:
          case 14:
            push(el, eb);
            break;
          case 2:
          case 13:
            push(eb, er);
            break;
          case 3:
          case 12:
            push(el, er);
            break;
          case 4:
          case 11:
            push(er, et);
            break;
          case 5:
            push(el, et);
            push(eb, er);
            break;
          case 6:
          case 9:
            push(eb, et);
            break;
          case 7:
          case 8:
            push(el, et);
            break;
          case 10:
            push(el, eb);
            push(er, et);
            break;
        }
      }
    }
    if (seg.length) out.push({ level, segments: seg });
  }
  return out;
}
