import { mulberry32 } from '../fish/boids';
import type { Diorama } from '../raised/diorama';
import {
  MAX_POLLUTANT_PARTICLES,
  MIN_POLLUTANT_PARTICLES,
  plumeIntensity,
  type PollutantLayer,
} from './density';

/** Fraction of particles drawn as large faint haze sprites (the volume of the cloud). */
export const HAZE_SHARE = 0.35;

export interface PlumeBuffers {
  /** x, raw y (unexaggerated, below the surface), z in scene units. */
  positions: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  /** Glow strength per particle (from its site's ratio). */
  intensity: Float32Array;
  /** 1 where its site is above the screening threshold (pulses), else 0. */
  over: Float32Array;
  count: number;
}

function seedFor(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Nearest water cell to a local point, or -1 if there is no water at all. */
function nearestWaterCell(dio: Diorama, xm: number, ym: number): number {
  const { grid } = dio;
  const i = Math.round((xm - grid.bounds.minX) / grid.cellX);
  const j = Math.round((ym - grid.bounds.minY) / grid.cellY);
  if (i >= 0 && j >= 0 && i < grid.nx && j < grid.ny && grid.inside[j * grid.nx + i])
    return j * grid.nx + i;
  let best = -1;
  let bestD = Infinity;
  for (let n = 0; n < grid.inside.length; n++) {
    if (!grid.inside[n]) continue;
    const di = (n % grid.nx) - i;
    const dj = Math.floor(n / grid.nx) - j;
    const d = di * di * grid.cellX * grid.cellX + dj * dj * grid.cellY * grid.cellY;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/**
 * Lay out one pollutant's particles: a soft cloud around each monitoring site that measured it
 * (Gaussian over the water cells near it, spread through the local water column), sized and lit by that
 * site's own ratio. Without site positions, a thin cloud through the whole volume. No layer, no
 * particles: nothing is invented.
 */
export function layoutPlumes(dio: Diorama, layer: PollutantLayer): PlumeBuffers {
  const { grid, S } = dio;
  const rng = mulberry32(seedFor(layer.key));
  const water: number[] = [];
  for (let n = 0; n < grid.inside.length; n++) if (grid.inside[n]) water.push(n);
  const total = layer.sources.length
    ? layer.sources.reduce((s, x) => s + x.count, 0)
    : layer.diffuseCount;
  const count = water.length ? total : 0;
  const out: PlumeBuffers = {
    positions: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    phases: new Float32Array(count),
    intensity: new Float32Array(count),
    over: new Float32Array(count),
    count,
  };
  if (!count) return out;
  const long = Math.max(dio.blockW, dio.blockH);
  const cell = Math.max(grid.cellX, grid.cellY);
  let k = 0;
  const put = (n: number, xm: number, ym: number, ratio: number, dim = 1) => {
    const [X, Z] = dio.toScene(xm, ym);
    const depthU = Math.max(grid.depth[n], 0.2) * S;
    out.positions[k * 3] = X;
    out.positions[k * 3 + 1] = -(0.06 + 0.86 * rng()) * depthU;
    out.positions[k * 3 + 2] = Z;
    const haze = rng() < HAZE_SHARE;
    out.sizes[k] = haze ? 3.5 + 3.5 * rng() : 0.5 + 1.1 * rng() * rng();
    out.phases[k] = rng() * Math.PI * 2;
    out.intensity[k] = plumeIntensity(ratio) * (haze ? 0.3 : 0.9) * dim;
    out.over[k] = ratio > 1 ? 1 : 0;
    k++;
  };
  if (layer.sources.length) {
    for (const src of layer.sources) {
      const [sx, sy] = dio.lonLatToLocal(src.lon, src.lat);
      const anchor = nearestWaterCell(dio, sx, sy);
      if (anchor < 0) continue;
      const ai = anchor % grid.nx;
      const aj = Math.floor(anchor / grid.nx);
      const strength =
        (src.count - MIN_POLLUTANT_PARTICLES) / (MAX_POLLUTANT_PARTICLES - MIN_POLLUTANT_PARTICLES);
      const sigma = Math.max(2 * cell, 0.045 * long * (0.7 + 0.8 * strength));
      // Water cells around the site, weighted by a Gaussian of their distance: the cloud follows
      // the water (a narrow bay or a river) instead of piling up where the open water ends.
      const ri = Math.ceil((2.6 * sigma) / grid.cellX);
      const rj = Math.ceil((2.6 * sigma) / grid.cellY);
      const cells: number[] = [];
      const cum: number[] = [];
      let sum = 0;
      for (let j = Math.max(0, aj - rj); j <= Math.min(grid.ny - 1, aj + rj); j++) {
        for (let i = Math.max(0, ai - ri); i <= Math.min(grid.nx - 1, ai + ri); i++) {
          const n = j * grid.nx + i;
          if (!grid.inside[n]) continue;
          const dx = (i - ai) * grid.cellX;
          const dy = (j - aj) * grid.cellY;
          sum += Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          cells.push(n);
          cum.push(sum);
        }
      }
      // Where the water is narrow the same particles crowd into less room: dim each one so the
      // plume reads as dense rather than burning out to white.
      const ideal = (2 * Math.PI * sigma * sigma) / (grid.cellX * grid.cellY);
      const crowd = Math.max(0.3, Math.min(1, Math.sqrt(sum / ideal)));
      for (let c = 0; c < src.count; c++) {
        const r = rng() * sum;
        let lo = 0;
        let hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < r) lo = mid + 1;
          else hi = mid;
        }
        const n = cells[lo] ?? anchor;
        const xm = grid.bounds.minX + ((n % grid.nx) + rng() - 0.5) * grid.cellX;
        const ym = grid.bounds.minY + (Math.floor(n / grid.nx) + rng() - 0.5) * grid.cellY;
        put(n, xm, ym, src.ratio, crowd);
      }
    }
  } else {
    for (let c = 0; c < count; c++) {
      const n = water[Math.floor(rng() * water.length)];
      const xm = grid.bounds.minX + ((n % grid.nx) + rng() - 0.5) * grid.cellX;
      const ym = grid.bounds.minY + (Math.floor(n / grid.nx) + rng() - 0.5) * grid.cellY;
      put(n, xm, ym, layer.ratio);
    }
  }
  if (k < count) {
    out.count = k;
  }
  // Shuffle so a reduced draw range (adaptive quality) thins every plume evenly.
  for (let i = out.count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    for (const [arr, w] of [
      [out.positions, 3],
      [out.sizes, 1],
      [out.phases, 1],
      [out.intensity, 1],
      [out.over, 1],
    ] as const) {
      for (let q = 0; q < w; q++) {
        const t = arr[i * w + q];
        arr[i * w + q] = arr[j * w + q];
        arr[j * w + q] = t;
      }
    }
  }
  return out;
}
