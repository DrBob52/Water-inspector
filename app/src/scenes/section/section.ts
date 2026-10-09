import { Color, SRGBColorSpace } from 'three';
import { synthesizeBathymetry, type SceneModel } from '@wi/shared';

// Bed profile ---------------------------------------------------------------------------------------

/**
 * Vertical slice along the longest axis of the waterbody: the deepest water across the width at each
 * position (a thalweg profile), smoothed and rescaled so its deepest point is the model's max depth.
 */
export interface SectionProfile {
  lengthM: number;
  /** Number of samples, evenly spaced from one shore (index 0) to the other (index samples - 1). */
  samples: number;
  /** Depth in metres at each sample; 0 at both shores. */
  depth: Float32Array;
  maxDepthM: number;
  /** Unit vector of the axis in local metres, and the local point at sample 0. */
  axis: [number, number];
  start: [number, number];
}

/** Gaussian blur of a 1D signal, treating everything beyond the ends as `edge`. */
export function gaussianSmooth(src: ArrayLike<number>, sigma: number, edge = 0): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (sigma <= 0) {
    for (let i = 0; i < n; i++) out[i] = src[i];
    return out;
  }
  const r = Math.ceil(sigma * 3);
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      const v = j < 0 || j >= n ? edge : src[j];
      s += v * w[k + r];
      ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}

/** Maximum of `src` over a window of +-`r` samples. */
export function runningMax(src: ArrayLike<number>, r: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let m = -Infinity;
    for (let k = Math.max(0, i - r); k <= Math.min(src.length - 1, i + r); k++)
      m = Math.max(m, src[k]);
    out[i] = m;
  }
  return out;
}

export function sectionProfile(model: SceneModel, samples = 241): SectionProfile {
  const flat = (): SectionProfile => ({
    lengthM: 1,
    samples,
    depth: new Float32Array(samples),
    maxDepthM: Math.max(model.maxDepthM, 0.1),
    axis: [1, 0],
    start: [0, 0],
  });
  if (model.outline.length < 3) return flat();
  const grid = synthesizeBathymetry(model.outline, {
    maxDepthM: model.maxDepthM,
    meanDepthM: model.meanDepthM,
    isRiver: model.isRiver,
    samples: 160,
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
  if (cells.length < 3) return flat();
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
  // The outermost cells sit up to half a cell inside the true shore.
  const pad = Math.max(grid.cellX, grid.cellY) * 0.5;
  smin -= pad;
  smax += pad;
  const length = Math.max(smax - smin, 1);

  // Deepest water across the width in each of `bins` slices along the axis.
  const bins = samples - 2;
  const raw = new Float32Array(bins);
  const hit = new Uint8Array(bins);
  for (const [x, y, d] of cells) {
    const s = (x - mx) * ux + (y - my) * uy;
    const b = Math.max(0, Math.min(bins - 1, Math.floor(((s - smin) / length) * bins)));
    hit[b] = 1;
    if (d > raw[b]) raw[b] = d;
  }
  // Bridge empty slices (the axis can be finer than the grid) by linear interpolation.
  let prev = -1;
  for (let b = 0; b < bins; b++) {
    if (!hit[b]) continue;
    if (prev >= 0 && b - prev > 1) {
      for (let k = prev + 1; k < b; k++)
        raw[k] = raw[prev] + ((raw[b] - raw[prev]) * (k - prev)) / (b - prev);
    }
    prev = b;
  }
  // A river's channel keeps its depth where the reach narrows, so follow the deepest water nearby
  // (a running maximum over ~12% of the reach) rather than every pinch in the width.
  const src = model.isRiver ? runningMax(raw, Math.round(bins * 0.06)) : raw;
  // A Gaussian over ~2.5% of the length removes the grid's stair-steps and the spikes where the width
  // changes, while keeping separate basins apart. Beyond the shores counts as zero depth.
  const sm = gaussianSmooth(src, Math.max(1.5, bins * (model.isRiver ? 0.035 : 0.022)), 0);
  const depth = new Float32Array(samples);
  for (let b = 0; b < bins; b++) depth[b + 1] = sm[b];
  // Ease the first and last slices into the shoreline so both ends meet the surface cleanly.
  const ease = Math.max(2, Math.round(samples * 0.02));
  for (let k = 1; k <= ease; k++) {
    const t = k / (ease + 1);
    const f = t * t * (3 - 2 * t);
    depth[k] *= f;
    depth[samples - 1 - k] *= f;
  }
  depth[0] = 0;
  depth[samples - 1] = 0;
  let peak = 0;
  for (const v of depth) peak = Math.max(peak, v);
  const target = Math.max(model.maxDepthM, 0.1);
  if (peak > 0) for (let i = 0; i < samples; i++) depth[i] *= target / peak;
  return {
    lengthM: length,
    samples,
    depth,
    maxDepthM: target,
    axis: [ux, uy],
    start: [mx + smin * ux, my + smin * uy],
  };
}

/** Depth in metres at fraction `f` (0 to 1) along the profile, linearly interpolated. */
export function profileDepthAt(prof: SectionProfile, f: number): number {
  const x = Math.max(0, Math.min(1, f)) * (prof.samples - 1);
  const i = Math.min(prof.samples - 2, Math.floor(x));
  const t = x - i;
  return prof.depth[i] * (1 - t) + prof.depth[i + 1] * t;
}

// Light ---------------------------------------------------------------------------------------------

/**
 * Light falloff from the scene's visibility. The scene model's visibility is 1.5 x Secchi depth, the
 * diffuse attenuation coefficient is about 1.7 / Secchi (Poole and Atkins), and the photic zone ends
 * where 1% of surface light remains (about 2.7 x Secchi).
 */
export function lightModel(visibilityM: number): { kd: number; photicM: number } {
  const secchi = Math.max(0.1, visibilityM / 1.5);
  const kd = 1.7 / secchi;
  return { kd, photicM: Math.log(100) / kd };
}

// Colour ----------------------------------------------------------------------------------------------

/** A colour's display (sRGB) components, 0 to 1. */
export function srgb(c: Color | string): [number, number, number] {
  const col = typeof c === 'string' ? new Color(c) : c;
  const o = { r: 0, g: 0, b: 0 };
  col.getRGB(o, SRGBColorSpace);
  return [o.r, o.g, o.b];
}

const mixRgb = (a: number[], b: number[], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Water column colours (sRGB) from the model's tint: lit shallows, mid water and the dark deep. */
export function waterPalette(tint: string) {
  const t = srgb(tint);
  const lum = 0.3 * t[0] + 0.55 * t[1] + 0.15 * t[2];
  // Normalise brightness so murky and clear tints both read, keeping the hue.
  const k = 0.36 / Math.max(lum, 0.05);
  const mid = t.map((v) => Math.min(1, v * k * 0.82)) as [number, number, number];
  return {
    shallow: mixRgb(mid, [0.62, 0.9, 0.94], 0.55),
    mid,
    deep: mixRgb(
      mid.map((v) => v * 0.22),
      [0.02, 0.05, 0.07],
      0.35,
    ),
  };
}

// Dissolved oxygen ----------------------------------------------------------------------------------

export const DO_COLORS = { low: '#ff6b5e', moderate: '#f2b84b', good: '#3ec7c0' } as const;
const DO_RED = new Color(DO_COLORS.low);
const DO_AMBER = new Color(DO_COLORS.moderate);
const DO_BLUE = new Color(DO_COLORS.good);

/** Red below 2 mg/L, amber 2 to 5, blue-green above 5, blended smoothly between bands. */
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

/**
 * RGBA texels (0 to 255) for the water's DO tint, one per `n` depths from the surface to `maxDepthM`.
 * Alpha fades out below the deepest measurement so the tint never extends past the data.
 */
export function doTintTexels(
  profile: Array<{ depthM: number; mgL: number }>,
  maxDepthM: number,
  n = 128,
): Uint8Array {
  const out = new Uint8Array(n * 4);
  const deepest = Math.max(...profile.map((p) => p.depthM));
  const fade = Math.max(maxDepthM * 0.04, 0.5);
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * maxDepthM;
    const mg = doAtDepth(profile, d);
    doColor(mg, c);
    // Healthy water is barely tinted; low oxygen shows clearly.
    const strength = mg >= 5.4 ? 0.1 : mg <= 2 ? 0.42 : 0.42 - ((mg - 2) / 3.4) * 0.32;
    const a = (d <= deepest ? 1 : Math.max(0, 1 - (d - deepest) / fade)) * strength;
    const [r, g, b] = srgb(c);
    out.set([r * 255, g * 255, b * 255, a * 255].map(Math.round), i * 4);
  }
  return out;
}

// Rulers --------------------------------------------------------------------------------------------

/** Nice tick step (1, 2, 5 x 10^n) giving about `target` ticks across `range`. */
export function niceStep(range: number, target = 6): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

/** Tick values 0, step, 2 step ... up to `max`, rounded to the step's precision. */
export function ticks(max: number, step: number): number[] {
  const out: number[] = [];
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let k = 0; k * step <= max * 1.0001; k++) out.push(Number((k * step).toFixed(digits)));
  return out;
}

/** "x372" style vertical exaggeration label. */
export function exaggerationLabel(exag: number): string {
  if (exag >= 100) return `×${Math.round(exag / 10) * 10}`;
  if (exag >= 10) return `×${Math.round(exag)}`;
  return `×${exag.toFixed(1)}`;
}

// Composition ---------------------------------------------------------------------------------------

/** Free area of the canvas (pixels) left over after the chrome, and the canvas itself. */
export interface Stage {
  width: number;
  height: number;
  /** Width hidden under the inspector on the right. */
  inset: number;
  /** First free pixel row below the top chrome, and last free row above the bottom chrome. */
  top: number;
  bottom: number;
}

/**
 * Pixel layout of the figure. World units equal screen pixels when the camera is fitted, so every
 * value here is both. x runs from the left shore (0) to the right shore (waterW); y is depth below
 * the surface, positive downwards.
 */
export interface Composition {
  waterW: number;
  waterH: number;
  landW: number;
  groundH: number;
  bankH: number;
  /** Screen position (pixels from the canvas top-left) of the left shore at the surface. */
  originX: number;
  originY: number;
  /** Depth ruler: x of the axis line, left of the land. */
  rulerX: number;
  /** Right-hand columns: zone labels start, DO gauge chart left edge and width. */
  zoneX: number;
  gaugeX: number;
  gaugeW: number;
  /** y of the distance ruler's axis line. */
  distY: number;
  /** False on narrow screens, where the zone labels are left out. */
  showZones: boolean;
}

const RULER_W = 50;
const ZONE_W = 92;
const GAUGE_W = 58;
const GAUGE_PAD = 32;
const TOP_PAD = 34;
const DIST_H = 44;

export function compose(stage: Stage): Composition {
  const visibleW = Math.max(320, stage.width - stage.inset);
  const narrow = visibleW < 640;
  const left = narrow ? 12 : 28;
  const right = visibleW - (narrow ? 12 : 28);
  const top = Math.max(stage.top, 0) + 14;
  const bottom = Math.min(stage.bottom, stage.height) - 10;
  const availW = right - left;
  const availH = Math.max(160, bottom - top);
  const rulerW = narrow ? 40 : RULER_W;
  const zoneW = narrow ? 0 : ZONE_W;
  const gaugeBlock = (narrow ? 44 : GAUGE_W) + GAUGE_PAD;
  const blockW = Math.max(160, availW - rulerW - zoneW - gaugeBlock);
  const landW = Math.max(18, Math.min(56, blockW * 0.055));
  const waterW = blockW - 2 * landW;
  let waterH = (availH - TOP_PAD - DIST_H) / 1.22;
  waterH = Math.max(90, Math.min(waterH, waterW * 0.62));
  const groundH = Math.max(34, Math.min(90, waterH * 0.22));
  const bankH = Math.max(6, Math.min(12, waterH * 0.03));
  const used = TOP_PAD + waterH + groundH + DIST_H;
  const y0 = top + Math.max(0, (availH - used) / 2) + TOP_PAD;
  const x0 = left + rulerW + landW;
  return {
    waterW,
    waterH,
    landW,
    groundH,
    bankH,
    originX: x0,
    originY: y0,
    rulerX: -landW - 10,
    zoneX: waterW + landW + 14,
    gaugeX: waterW + landW + zoneW + GAUGE_PAD - (narrow ? 14 : 0),
    gaugeW: narrow ? 44 : GAUGE_W,
    distY: waterH + groundH + 10,
    showZones: !narrow,
  };
}

// Species layout ------------------------------------------------------------------------------------

export type Band = 'surface' | 'littoral' | 'midwater' | 'benthic';
export const asBand = (b: string): Band =>
  b === 'surface' || b === 'littoral' || b === 'benthic' ? b : 'midwater';

export interface LayoutItem {
  band: Band;
  /** Icon box size in pixels (including any introduced ring). */
  w: number;
  h: number;
  /** Label box size in pixels; 0 for none. */
  labelW: number;
  labelH: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type LabelSide = 'below' | 'above' | 'right' | 'left';

export interface Placement {
  x: number;
  y: number;
  /** Where the label sits relative to the icon, or null when there is no room for it. */
  label: LabelSide | null;
  /** True when the item had to leave its band to find room. */
  displaced: boolean;
}

const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** The label's own box for an icon centred at (x, y). */
export function labelBox(it: LayoutItem, x: number, y: number, side: LabelSide): Rect {
  const { w, h, labelW: lw, labelH: lh } = it;
  switch (side) {
    case 'below':
      return { x0: x - lw / 2, x1: x + lw / 2, y0: y + h / 2 + 1, y1: y + h / 2 + 1 + lh };
    case 'above':
      return { x0: x - lw / 2, x1: x + lw / 2, y0: y - h / 2 - 1 - lh, y1: y - h / 2 - 1 };
    case 'right':
      return { x0: x + w / 2 + 3, x1: x + w / 2 + 3 + lw, y0: y - lh / 2, y1: y + lh / 2 };
    case 'left':
      return { x0: x - w / 2 - 3 - lw, x1: x - w / 2 - 3, y0: y - lh / 2, y1: y + lh / 2 };
  }
}

export function itemBox(it: LayoutItem, x: number, y: number, label: LabelSide | null): Rect {
  const r: Rect = { x0: x - it.w / 2, y0: y - it.h / 2, x1: x + it.w / 2, y1: y + it.h / 2 };
  if (!label || it.labelW <= 0) return r;
  const l = labelBox(it, x, y, label);
  return {
    x0: Math.min(r.x0, l.x0),
    y0: Math.min(r.y0, l.y0),
    x1: Math.max(r.x1, l.x1),
    y1: Math.max(r.y1, l.y1),
  };
}

export interface LayoutOptions {
  /** Boxes to keep clear (other annotations), in layout pixels. */
  reserved?: Rect[];
  /** Littoral species stay above this depth (pixels), e.g. the photic depth. */
  littoralMaxPx?: number;
}

/**
 * Place one icon per species in its depth band without overlaps: largest record counts first, each
 * taking the free spot in its band furthest from everything already placed. `depthPx(x)` is the bed
 * depth in pixels at x (0 to waterW). Each label goes below, above or beside its icon, wherever it
 * fits; items that cannot fit with a label drop it, and items that cannot fit in their band at all
 * go to the best free spot anywhere in the water.
 */
export function layoutSpecies(
  items: LayoutItem[],
  waterW: number,
  depthPx: (x: number) => number,
  opts: LayoutOptions = {},
): Placement[] {
  const reserved = opts.reserved ?? [];
  let maxD = 0;
  for (let x = 0; x <= waterW; x += 2) maxD = Math.max(maxD, depthPx(x));
  const littoralMax = Math.max(opts.littoralMaxPx ?? 0, maxD * 0.22);
  const step = Math.max(3, waterW / 220);
  const placed: Rect[] = [];
  const centres: Array<[number, number]> = [];
  const out: Placement[] = new Array(items.length);
  const inWater = (r: Rect) => {
    if (r.x0 < 3 || r.x1 > waterW - 3 || r.y0 < 4) return false;
    const n = Math.max(2, Math.ceil((r.x1 - r.x0) / 3));
    for (let k = 0; k <= n; k++) {
      if (r.y1 > depthPx(r.x0 + ((r.x1 - r.x0) * k) / n) - 3) return false;
    }
    return true;
  };
  const free = (r: Rect) => {
    for (const q of reserved) if (overlaps(r, q, 3)) return false;
    for (const q of placed) if (overlaps(r, q, 6)) return false;
    return true;
  };
  type Cand = { x: number; y: number; pref: number; sides: LabelSide[] };
  const candidates = (it: LayoutItem, band: Band | 'any'): Cand[] => {
    const out: Cand[] = [];
    const sides: LabelSide[] =
      band === 'benthic' ? ['above', 'right', 'left'] : ['below', 'right', 'left', 'above'];
    for (let x = it.w / 2 + 4; x <= waterW - it.w / 2 - 4; x += step) {
      const D = depthPx(x);
      const rel = D / Math.max(maxD, 1);
      const shore = Math.min(x, waterW - x) / waterW;
      if (band === 'surface') {
        out.push({ x, y: 6 + it.h / 2, pref: 0, sides });
      } else if (band === 'littoral') {
        // Shallow water near a shore: stay above the littoral depth; nearer the shore scores better.
        const cap = Math.min(littoralMax, D * 0.6);
        for (const f of [0.35, 0.65, 1]) {
          const y = Math.max(7 + it.h / 2, cap * f);
          out.push({ x, y, pref: -shore * 160 - (y / Math.max(maxD, 1)) * 30, sides });
        }
      } else if (band === 'midwater') {
        if (rel < 0.3) continue;
        for (const f of [0.2, 0.3, 0.4, 0.5, 0.6]) {
          const y = Math.max(10 + it.h / 2, f * D);
          out.push({ x, y, pref: shore * 40, sides });
        }
      } else if (band === 'benthic') {
        if (rel < 0.15) continue;
        // Resting just above the bed; deeper water scores better.
        let bed = D;
        for (let dx = -it.w / 2; dx <= it.w / 2; dx += 2) bed = Math.min(bed, depthPx(x + dx));
        out.push({ x, y: bed - it.h / 2 - 4, pref: rel * 50, sides });
      } else {
        for (const f of [0.15, 0.3, 0.45, 0.6, 0.75]) {
          out.push({ x, y: Math.max(8 + it.h / 2, f * D), pref: 0, sides });
        }
      }
    }
    return out;
  };
  const score = (c: Cand) => {
    let m = 260;
    for (const [cx, cy] of centres) m = Math.min(m, Math.hypot((c.x - cx) * 0.7, (c.y - cy) * 1.4));
    return m + c.pref;
  };
  const best = (it: LayoutItem, cands: Cand[], withLabel: boolean) => {
    let pick: { c: Cand; label: LabelSide | null } | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const icon = itemBox(it, c.x, c.y, null);
      if (!inWater(icon) || !free(icon)) continue;
      const s = score(c);
      if (s <= bestScore) continue;
      if (!withLabel || it.labelW <= 0) {
        bestScore = s;
        pick = { c, label: null };
        continue;
      }
      for (const side of c.sides) {
        const lb = labelBox(it, c.x, c.y, side);
        if (lb.y0 < 3 || lb.x0 < 2 || lb.x1 > waterW - 2 || !free(lb)) continue;
        if (!inWater({ ...lb, y1: lb.y1 - 2 })) continue;
        const natural = side === (it.band === 'benthic' ? 'above' : 'below');
        if (s - (natural ? 0 : 8) <= bestScore) continue;
        bestScore = s - (natural ? 0 : 8);
        pick = { c, label: side };
        break;
      }
    }
    return pick;
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const own = candidates(it, it.band);
    let pick = best(it, own, true) ?? best(it, own, false);
    let displaced = false;
    if (!pick) {
      const any = candidates(it, 'any');
      pick = best(it, any, true) ?? best(it, any, false);
      displaced = true;
    }
    if (!pick) {
      // Nowhere free: fall back to the middle of the band so the species is still shown.
      const c = own[Math.floor(own.length / 2)] ?? {
        x: waterW / 2,
        y: maxD / 2,
        pref: 0,
        sides: [],
      };
      pick = { c, label: null };
    }
    out[i] = { x: pick.c.x, y: pick.c.y, label: pick.label, displaced };
    placed.push(itemBox(it, pick.c.x, pick.c.y, null));
    if (pick.label) placed.push(labelBox(it, pick.c.x, pick.c.y, pick.label));
    centres.push([pick.c.x, pick.c.y]);
  }
  return out;
}

/** Spread label positions (sorted top to bottom) so neighbours are at least `gap` apart. */
export function spreadLabels(ys: number[], gap: number, min = -Infinity, max = Infinity): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const pos = order.map(([y]) => Math.max(min, Math.min(max, y)));
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + gap);
  const over = pos.length ? pos[pos.length - 1] - max : 0;
  if (over > 0) {
    pos[pos.length - 1] -= over;
    for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - gap);
  }
  const out = new Array<number>(ys.length);
  order.forEach(([, i], k) => (out[i] = pos[k]));
  return out;
}
