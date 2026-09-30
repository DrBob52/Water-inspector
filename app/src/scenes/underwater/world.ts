import { CatmullRomCurve3, Vector3 } from 'three';
import { depthShape, synthesizeBathymetry, type SceneModel } from '@wi/shared';
import { mulberry32 } from '../fish/boids';

/** The underwater patch is a 200 m x 200 m box; x = -100 is the shoreline, +x is deeper water. */
export const PATCH = 200;
export const HALF = PATCH / 2;
/** Visibility-exaggeration applied to fish lengths so small species stay visible. */
export const FISH_VISUAL_SCALE = 2.2;

export interface World {
  /** Depth of the bed below the surface (positive metres) at x, z. */
  bedDepth: (x: number, z: number) => number;
  shelfDepthM: number;
  maxPatchDepth: number;
  curve: CatmullRomCurve3;
  curveLength: number;
  fogDensity: number;
  /** Simulation area (a little inside the patch). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function noise2(x: number, z: number, seed: number): number {
  const h = (ix: number, iz: number) => {
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  return (
    h(ix, iz) * (1 - sx) * (1 - sz) +
    h(ix + 1, iz) * sx * (1 - sz) +
    h(ix, iz + 1) * (1 - sx) * sz +
    h(ix + 1, iz + 1) * sx * sz
  );
}

/**
 * Build the underwater patch from the synthesised bathymetry: a transect from the shoreline shelf
 * toward deeper water following the lake's own depth profile, so the littoral shelf is always
 * visible on one side.
 */
export function buildWorld(model: SceneModel): World {
  const bathy = synthesizeBathymetry(model.outline, {
    maxDepthM: model.maxDepthM,
    meanDepthM: model.meanDepthM,
    isRiver: model.isRiver,
    samples: 48,
  });
  const dMax = Math.max(bathy.maxDistanceM, 1);
  const modelDepth = (u: number) => model.maxDepthM * depthShape(u / dMax, bathy.k, model.isRiver);
  const shelfDepthM = Math.max(1, Math.min(5, model.maxDepthM * 0.1));
  const slope = Math.max(0.02, Math.min(1.2, (modelDepth(200) - modelDepth(60)) / 140));
  const cap = Math.max(model.maxDepthM, 1);

  const bedDepth = (x: number, z: number) => {
    const u = x + HALF;
    const shelf = Math.min(0.05 * Math.max(u, 0), shelfDepthM);
    const beyond = Math.max(0, u - 60) * slope;
    let d = Math.min(cap, shelf + beyond);
    const n = (noise2(x / 11, z / 11, 17) - 0.5) * 2;
    const n2 = (noise2(x / 3.3, z / 3.3, 91) - 0.5) * 2;
    d += (0.05 * d + 0.35) * n + 0.06 * n2;
    const nearShore = Math.min(1, Math.max(0, u / 6));
    return Math.max(0, d) * nearShore;
  };

  // Camera path: a slow closed loop through the water column, centred where the bed is about
  // 12 m deep so the shelf, the slope and some open water are all in view.
  const target = Math.min(12, Math.max(1.5, 0.8 * bedDepth(HALF - 1, 0)));
  let xt = HALF - 10;
  for (let x = -HALF + 5; x <= HALF - 5; x += 2) {
    if (bedDepth(x, 0) >= target) {
      xt = x;
      break;
    }
  }
  const cx = Math.max(-45, Math.min(45, xt - 12));
  const rx = Math.min(45, cx + 82);
  const pts: Vector3[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const z = Math.sin(a) * 34;
    const bed = bedDepth(x, z);
    const want = -Math.max(1.0, Math.min(14, bed - 3.2)) - 0.25 * Math.sin(a * 2);
    const y = Math.min(Math.max(want, -bed + 0.8), -0.6); // stay under the surface and off the bed
    pts.push(new Vector3(x, y, z));
  }
  const curve = new CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const maxPatchDepth = bedDepth(HALF - 1, 0);
  return {
    bedDepth,
    shelfDepthM,
    maxPatchDepth,
    curve,
    curveLength: curve.getLength(),
    // Rendered with at least 2.2 m of visibility so very turbid water stays readable.
    fogDensity: 1.5 / Math.max(2.2, model.visibilityM),
    bounds: {
      minX: Math.max(-HALF + 6, cx - 60),
      maxX: Math.min(HALF - 6, cx + 60),
      minZ: -52,
      maxZ: 52,
    },
  };
}

/** Positions for littoral plants: shallow water near the shore. */
export function plantPositions(
  world: World,
  count: number,
  seed = 3,
): Array<{ x: number; z: number; y: number; h: number; phase: number }> {
  const rng = mulberry32(seed);
  const out: Array<{ x: number; z: number; y: number; h: number; phase: number }> = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const x = -HALF + 4 + rng() * 70;
    const z = (rng() - 0.5) * (PATCH - 10);
    const d = world.bedDepth(x, z);
    if (d < 0.6 || d > 7) continue;
    out.push({ x, z, y: -d, h: Math.min(d * 0.85, 0.8 + rng() * 1.9), phase: rng() * 6.28 });
  }
  return out;
}

/** Benthic critters rest on the bed: choose positions in a given depth range. */
export function bedPositions(
  world: World,
  count: number,
  minD: number,
  maxD: number,
  seed: number,
) {
  const rng = mulberry32(seed);
  const out: Array<{ x: number; z: number; y: number; rot: number }> = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const x = -HALF + 8 + rng() * (PATCH - 16);
    const z = (rng() - 0.5) * (PATCH - 16);
    const d = world.bedDepth(x, z);
    if (d < minD || d > maxD) continue;
    out.push({ x, z, y: -d, rot: rng() * Math.PI * 2 });
  }
  return out;
}
