import { CatmullRomCurve3, Color, Vector3 } from 'three';
import { depthShape, synthesizeBathymetry, type SceneModel } from '@wi/shared';
import { mulberry32 } from '../fish/boids';

/** The underwater patch is a 200 m x 200 m box; x = -100 is the shoreline, +x is deeper water. */
export const PATCH = 200;
export const HALF = PATCH / 2;
/** Visibility-exaggeration applied to fish lengths so small species stay visible. */
export const FISH_VISUAL_SCALE = 2.2;
/** Murkier water than this is still rendered with this much visibility so the scene stays legible. */
export const MIN_RENDER_VISIBILITY = 2.2;

type RGB = [number, number, number];

/** Water colour and light, all derived from the model's visibility and tint (linear RGB). */
export interface WaterOptics {
  /** In-scattered colour looking straight up just under the surface. */
  up: RGB;
  /** Looking horizontally near the surface. */
  horizon: RGB;
  /** Looking straight down into the deep. */
  deep: RGB;
  /** Downwelling attenuation per metre, per channel (red goes first in clear water). */
  extinction: RGB;
  /** Per-channel multiplier on the fog density, so distant reds fade first. */
  fogTint: RGB;
  sunColor: RGB;
  /** 0 (murky) to 1 (very clear). */
  clarity: number;
  causticStrength: number;
  /** Caustics fade out by this depth (metres). */
  causticMaxDepth: number;
  /** How far the light shafts reach below the surface (metres) and how bright they are. */
  shaftLength: number;
  shaftIntensity: number;
}

export interface World {
  /** Depth of the bed below the surface (positive metres) at x, z. */
  bedDepth: (x: number, z: number) => number;
  shelfDepthM: number;
  maxPatchDepth: number;
  /** Camera drift path: a slow closed loop through the water column. */
  curve: CatmullRomCurve3;
  curveLength: number;
  fogDensity: number;
  /** Visibility used for rendering (the model's, but at least MIN_RENDER_VISIBILITY). */
  renderVisibility: number;
  /** The direction the drifting camera faces (radians about +Y; 0 looks toward -Z). */
  heroYaw: number;
  heroPitch: number;
  /** Camera height above the bed. */
  clearance: number;
  /** Where the action is: a point in front of the camera, used to spawn fish. */
  focus: Vector3;
  /** Fish, critter and plant area (a compact arena around the camera path). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** x the littoral fish drift toward (the shallow side of the arena). */
  littoralX: number;
  optics: WaterOptics;
}

function hash2(ix: number, iz: number, seed: number) {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  return (
    hash2(ix, iz, seed) * (1 - sx) * (1 - sz) +
    hash2(ix + 1, iz, seed) * sx * (1 - sz) +
    hash2(ix, iz + 1, seed) * (1 - sx) * sz +
    hash2(ix + 1, iz + 1, seed) * sx * sz
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const scaleTo = (c: RGB, target: number): RGB => {
  const k = target / Math.max(1e-5, lum(c));
  return [c[0] * k, c[1] * k, c[2] * k];
};
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Water optics from the data: `waterTint` sets the hue, `visibilityM` how fast light and contrast
 * fall away. Clear water is blue with a bright surface and long shafts; murky water is a flatter,
 * closer haze with short shafts and blurred caustics.
 */
export function waterOptics(
  model: Pick<SceneModel, 'visibilityM' | 'waterTint' | 'chlorophyllUgL'>,
): WaterOptics {
  const vis = Math.max(MIN_RENDER_VISIBILITY, model.visibilityM);
  const c = new Color(model.waterTint); // linear
  // Phytoplankton pushes the in-water colour toward green beyond what the surface tint shows.
  const green = 0.5 * Math.sqrt(Math.min(1, (model.chlorophyllUgL ?? 0) / 30));
  c.lerp(new Color(0.05, 0.16, 0.06), green * 0.6);
  const tint: RGB = [c.r, c.g, c.b];
  const mx = Math.max(1e-4, ...tint);
  const n: RGB = [tint[0] / mx, tint[1] / mx, tint[2] / mx];
  const clarity = smooth(2, 26, vis);

  // Hue: the tint, desaturated a touch so it reads as water rather than paint.
  const hue: RGB = mixRGB(n, [lum(n), lum(n), lum(n)], 0.1 + 0.3 * (1 - clarity));
  const cyan: RGB = [0.55, 0.9, 1.0];
  // Murky water scatters more light, so near the surface it looks paler than clear water does.
  const horizon = scaleTo(mixRGB(hue, cyan, 0.12 + 0.12 * clarity), 0.07 + 0.012 * (1 - clarity));
  const up = scaleTo(mixRGB(hue, cyan, 0.3 + 0.25 * clarity), 0.42 - 0.12 * (1 - clarity));
  const ink: RGB = [0.0013, 0.0037, 0.0054];
  const deep = mixRGB(ink, scaleTo(hue, 0.006 + 0.03 * (1 - clarity)), 0.7);

  // Pure water takes the reds first; particles and dissolved matter add attenuation that follows
  // the water's own colour (green water eats blue, blue water eats red).
  const pure: RGB = [0.24, 0.045, 0.016];
  const c0 = 0.6 / vis;
  const extinction: RGB = [
    pure[0] + c0 * (0.25 + 1.2 * (1 - n[0])),
    pure[1] + c0 * (0.25 + 1.2 * (1 - n[1])),
    pure[2] + c0 * (0.25 + 1.2 * (1 - n[2])),
  ];
  const fogTint: RGB = [0.7 + 0.6 * (1 - n[0]), 0.7 + 0.6 * (1 - n[1]), 0.7 + 0.6 * (1 - n[2])];
  const fm = (fogTint[0] + fogTint[1] + fogTint[2]) / 3;
  const sunK = 0.3 + 0.7 * smooth(1.5, 6, vis);
  return {
    up,
    horizon,
    deep,
    extinction,
    fogTint: [fogTint[0] / fm, fogTint[1] / fm, fogTint[2] / fm],
    // In murky water the direct beam is scattered away: things read as silhouettes on the haze.
    sunColor: [2.3 * sunK, 2.2 * sunK, 2.0 * sunK],
    clarity,
    causticStrength: 0.12 + 0.88 * smooth(1.5, 14, vis),
    causticMaxDepth: 8,
    shaftLength: clamp(vis * 0.9, 3, 42),
    shaftIntensity: 0.5 + 0.35 * clarity,
  };
}

/** Suspended particles: counts for the box of water drawn around the camera. */
export function particleBudget(
  model: Pick<SceneModel, 'visibilityM' | 'turbidityNtu' | 'chlorophyllUgL'>,
) {
  const vis = Math.max(MIN_RENDER_VISIBILITY, model.visibilityM);
  const box = clamp(vis * 1.4, 4, 20);
  const vol = box * box * box;
  const ntu = model.turbidityNtu ?? 1;
  const chl = model.chlorophyllUgL ?? 1;
  // Densities per cubic metre scale with turbidity and with chlorophyll-a.
  const sediment = Math.round(Math.min(1800, vol * (0.03 + 0.75 * ntu)));
  const algae = Math.round(Math.min(1200, vol * 0.12 * chl));
  return { box, sediment, algae };
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
    // The shelf edge wanders a little along the shore so the drop-off is not a ruler line.
    const edge = 60 + (noise2(z / 23, 3.7, 5) - 0.5) * 16;
    const beyond = Math.max(0, u - edge) * slope;
    let d = Math.min(cap, shelf + beyond);
    const n = (noise2(x / 11, z / 11, 17) - 0.5) * 2;
    const n2 = (noise2(x / 3.3, z / 3.3, 91) - 0.5) * 2;
    d += (0.05 * d + 0.35) * n + 0.06 * n2;
    const nearShore = Math.min(1, Math.max(0, u / 6));
    return Math.max(0, d) * nearShore;
  };

  const vis = Math.max(MIN_RENDER_VISIBILITY, model.visibilityM);
  // Framing: hover a few metres over a bed that sits just past the shelf, so the shelf rises on one
  // side and the slope falls away into the haze on the other. Murky water brings the camera close.
  const clearance = clamp(vis * 0.28, 0.9, 3.6);
  // Under 8 m so the foreground bed catches caustics; the slope beyond drops into the deep.
  const bedTarget = clamp(vis * 0.5, 3.2, 6.5);
  let cx = HALF - 30;
  for (let x = -HALF + 20; x <= HALF - 30; x += 1) {
    if (bedDepth(x, 0) >= bedTarget) {
      cx = x;
      break;
    }
  }
  cx = clamp(cx, -HALF + 30, HALF - 30);
  const heroYaw = -0.55; // look along the shore, turned toward the deep
  const fwd = new Vector3(-Math.sin(heroYaw), 0, -Math.cos(heroYaw));
  const az = clamp(vis * 0.45, 4, 15);
  // Sideways sway: less in murky water, where the plants that frame the shot stand close.
  const ax = az * (0.08 + 0.2 * smooth(2, 10, vis));
  const camY = (x: number, z: number) => {
    const bed = bedDepth(x, z);
    const want = -Math.max(0.9, bed - clearance);
    return Math.min(Math.max(want, -bed + 0.9), -0.6);
  };
  const pts: Vector3[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Mostly a dolly along the view direction, with a slow sideways sway.
    const along = Math.sin(a) * az;
    const side = Math.sin(a * 2) * ax;
    const x = cx + fwd.x * along - fwd.z * side;
    const z = fwd.z * along + fwd.x * side;
    pts.push(new Vector3(x, camY(x, z), z));
  }
  const curve = new CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

  // The arena: centred a little ahead of the camera, sized to what the water lets you see.
  const ahead = Math.min(vis * 0.45, 14);
  const focus = new Vector3(cx + fwd.x * ahead, 0, fwd.z * ahead);
  focus.y = Math.min(-0.8, -Math.max(0.8, bedDepth(focus.x, focus.z) - clearance));
  const hs = clamp(vis * 1.3, 5, 48);
  const lim = HALF - 6;
  const bounds = {
    minX: Math.max(-lim, focus.x - hs),
    maxX: Math.min(lim, focus.x + hs),
    minZ: Math.max(-lim, focus.z - hs),
    maxZ: Math.min(lim, focus.z + hs),
  };
  // Clear water: tip down to the bed and the drop-off. Murky water: level, toward the bright haze.
  const heroPitch = -clamp(0.05 + clearance * 0.018, 0.05, 0.16) * smooth(1.5, 6, vis);
  return {
    bedDepth,
    shelfDepthM,
    maxPatchDepth: bedDepth(HALF - 1, 0),
    curve,
    curveLength: curve.getLength(),
    // Rendered with at least MIN_RENDER_VISIBILITY so very turbid water stays readable.
    fogDensity: 1.5 / vis,
    renderVisibility: vis,
    heroYaw,
    heroPitch,
    clearance,
    focus,
    bounds,
    littoralX: bounds.minX + (bounds.maxX - bounds.minX) * 0.3,
    optics: waterOptics(model),
  };
}

export interface PlantSpot {
  x: number;
  z: number;
  y: number;
  /** Stalk height (m). */
  h: number;
  phase: number;
  /** Lean direction (radians) and blade kind: 0 ribbon (eelgrass), 1 leafy stem (pondweed). */
  rot: number;
  kind: 0 | 1;
}

/**
 * Littoral plants grow in clumps on the shallow bed (0.5 to 7 m) inside the arena, with the camera
 * foreground favoured so plants frame the shot.
 */
export function plantPositions(world: World, count: number, seed = 3, kinds = 1): PlantSpot[] {
  const rng = mulberry32(seed);
  const out: PlantSpot[] = [];
  const b = world.bounds;
  const okDepth = (d: number) => d >= 0.5 && d <= 7;
  // Keep a clear corridor around the camera path so the lens is never inside a clump.
  const path = Array.from({ length: 48 }, (_, i) => world.curve.getPointAt(i / 48));
  const clear = Math.max(0.75, world.clearance * 1.1);
  const inCorridor = (x: number, z: number) =>
    path.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < clear * clear);
  // Framing clumps first: just off to each side of the drift path, a little ahead.
  const fx = -Math.sin(world.heroYaw);
  const fz = -Math.cos(world.heroYaw);
  const framing: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const p = world.curve.getPointAt(i / 8);
    const side =
      (i % 2 === 0 ? -1 : 1) * (clear + 0.1 + rng() * Math.min(2.2, world.renderVisibility * 0.25));
    const ahead = 0.8 + rng() * Math.min(6, world.renderVisibility * 0.8);
    framing.push([p.x + fx * ahead - fz * side, p.z + fz * ahead + fx * side]);
  }
  let guard = 0;
  while (out.length < count && guard++ < count * 6) {
    // Clump centre: the framing spots, then half near the camera path, half anywhere shallow.
    let cx: number;
    let cz: number;
    const f = framing.pop();
    if (f) {
      cx = f[0];
      cz = f[1];
    } else if (rng() < 0.5) {
      const p = world.curve.getPointAt(rng());
      cx = p.x + (rng() - 0.5) * 16;
      cz = p.z + (rng() - 0.5) * 16;
    } else {
      cx = b.minX + rng() * (b.maxX - b.minX);
      cz = b.minZ + rng() * (b.maxZ - b.minZ);
    }
    if (!okDepth(world.bedDepth(cx, cz)) || inCorridor(cx, cz)) continue;
    const kind: 0 | 1 = kinds > 1 && rng() < 0.32 ? 1 : 0;
    const blades = kind === 1 ? 3 + Math.floor(rng() * 4) : 7 + Math.floor(rng() * 12);
    const radius = 0.35 + rng() * 0.9;
    const tall = 0.7 + rng() * 0.6;
    for (let k = 0; k < blades && out.length < count; k++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const d = world.bedDepth(x, z);
      if (!okDepth(d) || inCorridor(x, z)) continue;
      const h = Math.min(d * 0.72, (kind === 1 ? 0.7 : 0.45) + tall * (0.4 + rng() * 1.1));
      out.push({ x, z, y: -d, h, phase: rng() * 6.28, rot: rng() * Math.PI * 2, kind });
    }
  }
  return out;
}

/** Benthic critters rest on the bed: positions in a depth range inside the arena. */
export function bedPositions(
  world: World,
  count: number,
  minD: number,
  maxD: number,
  seed: number,
) {
  const rng = mulberry32(seed);
  const b = world.bounds;
  const out: Array<{ x: number; z: number; y: number; rot: number }> = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    // Bias toward the middle of the arena, where the camera looks.
    const u = (rng() + rng()) / 2;
    const v = (rng() + rng()) / 2;
    const x = b.minX + u * (b.maxX - b.minX);
    const z = b.minZ + v * (b.maxZ - b.minZ);
    const d = world.bedDepth(x, z);
    if (d < minD || d > maxD) continue;
    out.push({ x, z, y: -d, rot: rng() * Math.PI * 2 });
  }
  return out;
}

export interface RockSpot {
  x: number;
  y: number;
  z: number;
  /** Radii of the (squashed) boulder. */
  sx: number;
  sy: number;
  sz: number;
  rot: number;
}

/**
 * Boulders and cobbles: a scatter across the arena, denser along the shelf edge, plus a few larger
 * anchors beside the camera path so the foreground has something solid in it.
 */
export function rockPositions(world: World, count: number, seed = 21): RockSpot[] {
  const rng = mulberry32(seed);
  const b = world.bounds;
  const out: RockSpot[] = [];
  const add = (x: number, z: number, size: number) => {
    const d = world.bedDepth(x, z);
    if (d < 0.4) return;
    const s = Math.min(size, Math.max(0.15, d * 0.3));
    const sy = s * (0.45 + rng() * 0.35);
    out.push({
      x,
      z,
      y: -d - sy * 0.25,
      sx: s * (0.8 + rng() * 0.5),
      sy,
      sz: s * (0.8 + rng() * 0.5),
      rot: rng() * Math.PI * 2,
    });
  };
  // Foreground anchors: off to the sides of the drift path, a few metres ahead.
  const anchors = Math.min(4, Math.max(2, Math.round(count * 0.05)));
  for (let i = 0; i < anchors; i++) {
    const p = world.curve.getPointAt((i + 0.5) / anchors);
    const side = i % 2 === 0 ? -1 : 1;
    const fx = -Math.sin(world.heroYaw);
    const fz = -Math.cos(world.heroYaw);
    const ahead = 3.5 + rng() * Math.min(9, world.renderVisibility * 0.7);
    const off = (2.2 + rng() * 3) * side;
    add(p.x + fx * ahead - fz * off, p.z + fz * ahead + fx * off, 0.5 + rng() * 0.8);
  }
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    // Clusters: a parent position with a few children around it.
    const x = b.minX + rng() * (b.maxX - b.minX);
    const z = b.minZ + rng() * (b.maxZ - b.minZ);
    const d = world.bedDepth(x, z);
    const edge = Math.abs(world.bedDepth(x + 3, z) - world.bedDepth(x - 3, z));
    if (rng() > 0.35 + edge * 0.4) continue;
    const kids = 1 + Math.floor(rng() * 4);
    for (let k = 0; k < kids && out.length < count; k++) {
      const big = k === 0 ? 0.6 + rng() * 1.6 : 0.2 + rng() * 0.6;
      add(x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3, big * (d > 20 ? 1.4 : 1));
    }
  }
  return out;
}

export interface LogSpot {
  x: number;
  y: number;
  z: number;
  length: number;
  radius: number;
  yaw: number;
  /** Tilt so the log follows the bed slope. */
  pitch: number;
}

/** A couple of sunken logs on the bed near the camera path, as composition anchors. */
export function logPositions(world: World, count = 2, seed = 8): LogSpot[] {
  const rng = mulberry32(seed);
  const out: LogSpot[] = [];
  const fx = -Math.sin(world.heroYaw);
  const fz = -Math.cos(world.heroYaw);
  for (let i = 0; i < count; i++) {
    const p = world.curve.getPointAt(0.1 + (i / Math.max(1, count)) * 0.7);
    const ahead = 4 + rng() * Math.min(10, world.renderVisibility * 0.7);
    const side = (i % 2 === 0 ? 1 : -1) * (1 + rng() * 3);
    const x = p.x + fx * ahead - fz * side;
    const z = p.z + fz * ahead + fx * side;
    const length = 3 + rng() * 4;
    // Lie roughly across the view so the log reads as a log, not a post.
    const yaw = world.heroYaw + Math.PI / 2 + (rng() - 0.5) * 0.9;
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);
    const d0 = world.bedDepth(x - ca * length * 0.5, z + sa * length * 0.5);
    const d1 = world.bedDepth(x + ca * length * 0.5, z - sa * length * 0.5);
    const radius = 0.22 + rng() * 0.16;
    out.push({
      x,
      z,
      y: -(d0 + d1) / 2 + radius * 0.4,
      length,
      radius,
      yaw,
      pitch: Math.atan2(d0 - d1, length),
    });
  }
  return out;
}
