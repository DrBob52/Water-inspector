import { Color } from 'three';
import {
  contourInterval,
  makeProjection,
  sampleDem,
  synthesizeBathymetry,
  type BathymetryGrid,
  type DemGrid,
  type SceneModel,
} from '@wi/shared';

/** The diorama: the waterbody plus a 2 km margin of land, cut out as a block with strata walls. */
export const BLOCK_MARGIN_M = 2000;
/** Longest side of the block in scene units. */
export const BLOCK_UNITS = 100;
/** Grid samples along the long side for a square block; long thin blocks get more. */
export const GRID_SAMPLES = 192;
export const MAX_GRID_SAMPLES = 480;
/** Rough vertex budget for the terrain grid (keeps 60 fps on integrated graphics). */
export const VERTEX_BUDGET = 62000;
export const WALL_THICKNESS_UNITS = 5;
/** The dark plinth the block stands on. */
export const PLINTH_HEIGHT_UNITS = 1.6;
export const PLINTH_PAD_UNITS = 1.4;
export const MIN_EXAGGERATION = 1;
export const MAX_EXAGGERATION = 20;

export interface Diorama {
  grid: BathymetryGrid;
  /** Scene units per metre. */
  S: number;
  nx: number;
  ny: number;
  blockW: number;
  blockH: number;
  widthU: number;
  heightU: number;
  /** Unexaggerated heights in scene units, relative to the water surface (y = 0). */
  raw: Float32Array;
  /** Highest land point, unexaggerated scene units. */
  landMaxU: number;
  positions: Float32Array;
  /** Linear RGB vertex colours: hypsometric tint, slope rock, snow and baked ambient occlusion. */
  colors: Float32Array;
  /** Per-vertex height in metres relative to the water surface (negative under water). */
  elevM: Float32Array;
  /** Per-vertex signed distance to the shore in metres (positive in the water). */
  shoreM: Float32Array;
  indices: Uint32Array;
  wall: {
    positions: Float32Array;
    normals: Float32Array;
    /** Exaggerated top of the wall column each vertex belongs to (scene units). */
    top: Float32Array;
    /** Coordinate along the wall (scene units), drives the strata warp. */
    along: Float32Array;
    indices: Uint32Array;
    rawTop: Float32Array;
  };
  /** Glass panels where the water column meets the block edge (empty when the lake is inland). */
  glass: { positions: Float32Array; rawBottom: Float32Array; indices: Uint32Array };
  /** RGBA8 grid texture for the water shader: R depth / max depth, G distance from the shore. */
  waterTex: { data: Uint8Array; width: number; height: number; shoreScaleM: number };
  autoExaggeration: number;
  /** Outline in scene units: x east, y north (rotate -90 degrees about X to lay it flat). */
  outlineU: Array<[number, number]>;
  maxDepthU: number;
  contourInterval: number;
  toScene: (xm: number, ym: number) => [number, number];
  /** Unexaggerated terrain height in scene units at a local point (nearest grid cell). */
  heightAt: (xm: number, ym: number) => number;
  centre: [number, number];
  lonLatToLocal: (lon: number, lat: number) => [number, number];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Deterministic value noise for colour variation (no textures are downloaded).
const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm = (x: number, y: number) =>
  0.55 * vnoise(x, y) +
  0.3 * vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) +
  0.15 * vnoise(x * 4.3, y * 4.3);

/** Hypsometric ramp: lowland deep green, green, olive, tan, then bare rock. */
const RAMP: Array<[number, Color]> = [
  [0.0, new Color('#2d5426')],
  [0.22, new Color('#3f6a2e')],
  [0.42, new Color('#6e7a3c')],
  [0.6, new Color('#a08d5c')],
  [0.78, new Color('#8a8072')],
  [1.0, new Color('#9a948a')],
];
const ROCK = new Color('#7f7a72');
const SNOW = new Color('#f1f4f6');
const BEACH = new Color('#cdbd91');
const COOL_GREEN = new Color(0.78, 0.92, 0.82);
/** Bathymetric ramp for the bed: pale sand shallows to deep slate blue. */
const BED: Array<[number, Color]> = [
  [0.0, new Color('#d6c69a')],
  [0.1, new Color('#b8b083')],
  [0.32, new Color('#7f9a87')],
  [0.62, new Color('#4b7184')],
  [1.0, new Color('#26405f')],
];

function ramp(stops: Array<[number, Color]>, t: number, out: Color): Color {
  const x = clamp01(t);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      return out.copy(ca).lerp(cb, (x - a) / (b - a));
    }
  }
  return out.copy(stops[stops.length - 1][1]);
}

/** Snow starts around 2400 m (the Sierra Nevada and Cascades lakes), only on the upper slopes. */
export const SNOW_LINE_M = 2400;

/**
 * Land colour from real elevation. `absM` is metres above sea level, `rel` the height within the
 * block's land relief (0 at the shore, 1 at the highest point), `slope` the ground gradient (rise
 * over run). Steep ground shows rock; the highest ground above the snow line shows snow.
 */
export function hypsometricTint(absM: number, rel: number, slope: number, out = new Color()) {
  const u = 0.62 * clamp01(rel) + 0.38 * smooth(500, 3500, absM);
  ramp(RAMP, u, out);
  const rock = smooth(0.32, 0.8, slope) * (0.35 + 0.65 * smooth(0.15, 0.6, u));
  out.lerp(ROCK, rock * 0.85);
  const snow = smooth(SNOW_LINE_M, SNOW_LINE_M + 250, absM) * smooth(0.4, 0.65, rel);
  out.lerp(SNOW, snow * (1 - 0.55 * smooth(0.6, 1.1, slope)));
  return out;
}

/** Bed colour from the fraction of maximum depth. */
export function bedTint(depthFraction: number, out = new Color()) {
  return ramp(BED, depthFraction, out);
}

export function autoExaggeration(maxDepthM: number, blockLongM: number): number {
  return Math.max(
    MIN_EXAGGERATION,
    Math.min(MAX_EXAGGERATION, (0.08 * blockLongM) / Math.max(maxDepthM, 0.1)),
  );
}

/** Grid samples along the long side: long thin blocks get more so the short side stays detailed. */
export function gridSamplesFor(blockW: number, blockH: number): number {
  const aspect = Math.max(blockW, blockH) / Math.max(1e-9, Math.min(blockW, blockH));
  return Math.round(
    Math.max(GRID_SAMPLES, Math.min(MAX_GRID_SAMPLES, Math.sqrt(VERTEX_BUDGET * aspect))),
  );
}

/**
 * Horizon-based ambient occlusion on a height grid (scene units): for 8 directions, find the
 * steepest rise within a short radius; the sky that hides is the occlusion. Returns 0..1 (1 = open).
 */
export function bakeAmbientOcclusion(
  h: Float32Array,
  nx: number,
  ny: number,
  cellX: number,
  cellY: number,
): Float32Array {
  const ao = new Float32Array(nx * ny);
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  const steps = [1, 2, 3, 5, 8, 12];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const h0 = h[j * nx + i];
      let occ = 0;
      for (const [dx, dy] of dirs) {
        let best = 0;
        for (const s of steps) {
          const x = i + dx * s;
          const y = j + dy * s;
          if (x < 0 || y < 0 || x >= nx || y >= ny) break;
          const run = Math.hypot(dx * s * cellX, dy * s * cellY);
          const rise = h[y * nx + x] - h0;
          if (rise > 0) best = Math.max(best, rise / run);
        }
        occ += best / Math.sqrt(1 + best * best); // sin of the horizon angle
      }
      ao[j * nx + i] = 1 - occ / dirs.length;
    }
  }
  return ao;
}

export function buildDiorama(model: SceneModel, dem: DemGrid | null): Diorama {
  const xs = model.outline.map((p) => p[0]);
  const ys = model.outline.map((p) => p[1]);
  const bounds = {
    minX: Math.min(...xs) - BLOCK_MARGIN_M,
    maxX: Math.max(...xs) + BLOCK_MARGIN_M,
    minY: Math.min(...ys) - BLOCK_MARGIN_M,
    maxY: Math.max(...ys) + BLOCK_MARGIN_M,
  };
  const blockW = bounds.maxX - bounds.minX;
  const blockH = bounds.maxY - bounds.minY;
  const long = Math.max(blockW, blockH);
  const S = BLOCK_UNITS / long;
  const grid = synthesizeBathymetry(model.outline, {
    maxDepthM: model.maxDepthM,
    meanDepthM: model.meanDepthM,
    isRiver: model.isRiver,
    samples: gridSamplesFor(blockW, blockH),
    bounds,
  });
  const { nx, ny, cellX, cellY } = grid;
  const N = nx * ny;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const toScene = (xm: number, ym: number): [number, number] => [(xm - cx) * S, -(ym - cy) * S];
  const maxDepth = Math.max(model.maxDepthM, 0.1);
  const autoE = autoExaggeration(maxDepth, long);
  const proj = makeProjection(model.origin);
  const sd = grid.signedDistance;

  // 1. Land from the DEM, relative to the water surface.
  const land = new Float32Array(N);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      if (grid.inside[n]) continue;
      const x = bounds.minX + i * cellX;
      const y = bounds.minY + j * cellY;
      let h = 2 + 3 * Math.sin(x / 700) * Math.cos(y / 900); // gentle relief if no DEM
      if (dem) {
        const [lon, lat] = proj.toLonLat(x, y);
        const e = sampleDem(
          dem,
          Math.min(dem.bbox[2], Math.max(dem.bbox[0], lon)),
          Math.min(dem.bbox[3], Math.max(dem.bbox[1], lat)),
        );
        if (Number.isFinite(e)) h = e - model.surfaceElevationM;
      }
      land[n] = Math.max(0.25, h);
    }
  }

  // Under strong exaggeration single DEM samples turn into needles; soften the land a little.
  const blurPasses = autoE > 8 ? 2 : autoE > 4 ? 1 : 0;
  for (let pass = 0; pass < blurPasses; pass++) {
    const src = Float32Array.from(land);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i;
        if (grid.inside[n]) continue;
        let s = 0;
        let c = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || grid.inside[jj * nx + ii]) continue;
            const w = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
            s += src[jj * nx + ii] * w;
            c += w;
          }
        }
        land[n] = s / c;
      }
    }
  }

  // 2. Heights. Land vertices next to the water take the bed's slope, so the linear surface crosses
  // the waterline where the true shoreline is (no grid staircase), then rise to the real terrain.
  const rel = new Float32Array(N);
  const cell = Math.max(cellX, cellY);
  const band = 1.5 * cell;
  const easeShore = smooth(4, 12, autoE);
  let landMax = 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      if (grid.inside[n]) {
        rel[n] = -grid.depth[n];
        continue;
      }
      let h = land[n];
      if (-sd[n] < band) {
        let s = 0;
        let c = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
            const m = jj * nx + ii;
            if (!grid.inside[m]) continue;
            s += grid.depth[m] / Math.max(sd[m], 0.05 * Math.min(cellX, cellY));
            c++;
          }
        }
        if (c > 0) h = Math.max(0.05, Math.min(land[n], (-sd[n] * s) / c));
      } else if (easeShore > 0 && -sd[n] < band + 2 * cell) {
        // Under strong exaggeration, ease the first cells up to the real terrain so shores do not
        // read as a row of spikes.
        const t = 0.35 + 0.65 * smooth(band, band + 2 * cell, -sd[n]);
        h = Math.max(0.05, land[n] * (1 - easeShore * (1 - t)));
      }
      rel[n] = h;
      if (h > landMax) landMax = h;
    }
  }

  const raw = new Float32Array(N);
  const positions = new Float32Array(N * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      raw[n] = rel[n] * S;
      const [X, Z] = toScene(bounds.minX + i * cellX, bounds.minY + j * cellY);
      positions[n * 3] = X;
      positions[n * 3 + 1] = raw[n];
      positions[n * 3 + 2] = Z;
    }
  }

  // 3. Colours: hypsometric tint, slope rock, snow and baked ambient occlusion.
  const aoHeights = new Float32Array(N);
  for (let n = 0; n < N; n++) aoHeights[n] = raw[n] * autoE;
  const ao = bakeAmbientOcclusion(aoHeights, nx, ny, cellX * S, cellY * S);
  const colors = new Float32Array(N * 3);
  const tmp = new Color();
  const alt = new Color();
  const slopeE = Math.min(Math.max(autoE, 1), 3); // judge steepness roughly as it is seen
  const nScale = 9 / BLOCK_UNITS;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      const X = positions[n * 3];
      const Z = positions[n * 3 + 2];
      const v = fbm(X * nScale, Z * nScale);
      if (grid.inside[n]) {
        bedTint(grid.depth[n] / maxDepth, tmp);
        tmp.multiplyScalar(0.94 + 0.12 * v);
      } else {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(nx - 1, i + 1);
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(ny - 1, j + 1);
        const gx = (rel[j * nx + i1] - rel[j * nx + i0]) / ((i1 - i0) * cellX);
        const gy = (rel[j1 * nx + i] - rel[j0 * nx + i]) / ((j1 - j0) * cellY);
        const slope = Math.hypot(gx, gy) * slopeE;
        hypsometricTint(model.surfaceElevationM + rel[n], rel[n] / landMax, slope, tmp);
        // Patchy vegetation: drift toward a cooler, darker green in places.
        alt.copy(tmp).multiply(COOL_GREEN);
        tmp.lerp(alt, smooth(0.45, 0.75, fbm(X * nScale * 2.3 + 11, Z * nScale * 2.3 - 7)));
        tmp.multiplyScalar(0.9 + 0.2 * v);
        // A pale strand along the waterline.
        tmp.lerp(BEACH, 0.55 * (1 - smooth(0, band, -sd[n])) * (1 - smooth(1, 25, rel[n])));
      }
      const occ = 0.4 + 0.6 * Math.pow(ao[n], 1.4);
      colors[n * 3] = tmp.r * occ;
      colors[n * 3 + 1] = tmp.g * occ;
      colors[n * 3 + 2] = tmp.b * occ;
    }
  }

  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }

  // 4. Walls: four sides, two rows per column (the strata are drawn by the wall shader).
  const sides: Array<{
    count: number;
    idx: (s: number) => number;
    nrm: [number, number, number];
    flip: boolean;
    along: (n: number) => number;
  }> = [
    { count: nx, idx: (s) => s, nrm: [0, 0, 1], flip: false, along: (n) => positions[n * 3] },
    {
      count: nx,
      idx: (s) => (ny - 1) * nx + s,
      nrm: [0, 0, -1],
      flip: true,
      along: (n) => 137 - positions[n * 3],
    },
    {
      count: ny,
      idx: (s) => s * nx,
      nrm: [-1, 0, 0],
      flip: true,
      along: (n) => 271 + positions[n * 3 + 2],
    },
    {
      count: ny,
      idx: (s) => s * nx + nx - 1,
      nrm: [1, 0, 0],
      flip: false,
      along: (n) => 409 - positions[n * 3 + 2],
    },
  ];
  const totalCols = sides.reduce((s, x) => s + x.count, 0);
  const wPos = new Float32Array(totalCols * 2 * 3);
  const wNrm = new Float32Array(totalCols * 2 * 3);
  const wTop = new Float32Array(totalCols * 2);
  const wAlong = new Float32Array(totalCols * 2);
  const rawTop = new Float32Array(totalCols);
  const wIdx: number[] = [];
  const gPos: number[] = [];
  const gBottom: number[] = [];
  const gIdx: number[] = [];
  let col = 0;
  for (const side of sides) {
    const first = col;
    let prevGlass = -1;
    for (let s = 0; s < side.count; s++) {
      const n = side.idx(s);
      rawTop[col] = raw[n];
      for (let r = 0; r < 2; r++) {
        const o = (col * 2 + r) * 3;
        wPos[o] = positions[n * 3];
        wPos[o + 1] = raw[n]; // updated by applyExaggeration
        wPos[o + 2] = positions[n * 3 + 2];
        wNrm[o] = side.nrm[0];
        wNrm[o + 1] = side.nrm[1];
        wNrm[o + 2] = side.nrm[2];
        wAlong[col * 2 + r] = side.along(n);
      }
      // Where the water reaches the block edge, a glass panel shows the water column.
      if (raw[n] < 0) {
        const g = gPos.length / 3;
        gPos.push(positions[n * 3], 0, positions[n * 3 + 2]);
        gPos.push(positions[n * 3], raw[n], positions[n * 3 + 2]);
        gBottom.push(0, raw[n]);
        if (prevGlass >= 0 && prevGlass === g - 2) {
          if (side.flip) gIdx.push(prevGlass, g, prevGlass + 1, g, g + 1, prevGlass + 1);
          else gIdx.push(prevGlass, prevGlass + 1, g, g, prevGlass + 1, g + 1);
        }
        prevGlass = g;
      } else prevGlass = -1;
      col++;
    }
    for (let s = 0; s < side.count - 1; s++) {
      const a = (first + s) * 2;
      const b = (first + s + 1) * 2;
      const c2 = a + 1;
      const d = b + 1;
      if (side.flip) wIdx.push(a, b, c2, b, d, c2);
      else wIdx.push(a, c2, b, b, c2, d);
    }
  }

  // 5. Water texture for the shader: depth and distance from the shore, per grid cell.
  const shoreScaleM = 8 * Math.max(cellX, cellY);
  const tex = new Uint8Array(N * 4);
  for (let n = 0; n < N; n++) {
    tex[n * 4] = Math.round(255 * clamp01(grid.depth[n] / maxDepth));
    tex[n * 4 + 1] = Math.round(255 * clamp01((sd[n] + shoreScaleM / 4) / shoreScaleM));
    tex[n * 4 + 2] = 0;
    tex[n * 4 + 3] = 255;
  }
  const elevM = new Float32Array(N);
  for (let n = 0; n < N; n++) elevM[n] = rel[n];

  const d: Diorama = {
    grid,
    S,
    nx,
    ny,
    blockW,
    blockH,
    widthU: blockW * S,
    heightU: blockH * S,
    raw,
    landMaxU: landMax * S,
    positions,
    colors,
    elevM,
    shoreM: Float32Array.from(sd),
    indices,
    wall: {
      positions: wPos,
      normals: wNrm,
      top: wTop,
      along: wAlong,
      indices: new Uint32Array(wIdx),
      rawTop,
    },
    glass: {
      positions: new Float32Array(gPos),
      rawBottom: new Float32Array(gBottom),
      indices: new Uint32Array(gIdx),
    },
    waterTex: { data: tex, width: nx, height: ny, shoreScaleM },
    autoExaggeration: autoE,
    outlineU: model.outline.map(([x, y]) => [(x - cx) * S, (y - cy) * S] as [number, number]),
    maxDepthU: maxDepth * S,
    contourInterval: contourInterval(maxDepth),
    toScene,
    heightAt: (xm, ym) => {
      const i = Math.max(0, Math.min(nx - 1, Math.round((xm - bounds.minX) / cellX)));
      const j = Math.max(0, Math.min(ny - 1, Math.round((ym - bounds.minY) / cellY)));
      return raw[j * nx + i];
    },
    centre: [cx, cy],
    lonLatToLocal: (lon, lat) => proj.toLocal(lon, lat),
  };
  applyExaggeration(d, d.autoExaggeration);
  return d;
}

/** Bottom of the block (top of the plinth) for an exaggeration. */
export const blockBase = (d: Diorama, E: number) => -d.maxDepthU * E - WALL_THICKNESS_UNITS;

/** Scale the vertical axis in place (terrain, walls and glass). The base stays a constant thickness. */
export function applyExaggeration(d: Diorama, E: number) {
  for (let n = 0; n < d.raw.length; n++) d.positions[n * 3 + 1] = d.raw[n] * E;
  const base = blockBase(d, E);
  const w = d.wall;
  for (let c = 0; c < w.rawTop.length; c++) {
    const top = w.rawTop[c] * E;
    w.positions[c * 6 + 1] = top;
    w.positions[c * 6 + 4] = base;
    w.top[c * 2] = top;
    w.top[c * 2 + 1] = top;
  }
  const g = d.glass;
  for (let v = 0; v < g.rawBottom.length; v++) g.positions[v * 3 + 1] = g.rawBottom[v] * E;
}

/** Local frame of the block for framing: footprint and vertical extent at an exaggeration. */
export function blockExtent(d: Diorama, E: number) {
  return {
    width: d.widthU + 2 * PLINTH_PAD_UNITS,
    depth: d.heightU + 2 * PLINTH_PAD_UNITS,
    top: Math.max(d.landMaxU * E, 1.5),
    bottom: blockBase(d, E) - PLINTH_HEIGHT_UNITS,
  };
}

export function stationOnScene(
  d: Diorama,
  lon: number,
  lat: number,
): { x: number; z: number; rawY: number } {
  const [xm, ym] = d.lonLatToLocal(lon, lat);
  const [x, z] = d.toScene(xm, ym);
  return { x, z, rawY: d.heightAt(xm, ym) };
}
