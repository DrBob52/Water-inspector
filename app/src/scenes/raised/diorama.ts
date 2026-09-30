import { Color } from 'three';
import {
  contourInterval,
  contourSegments,
  makeProjection,
  sampleDem,
  synthesizeBathymetry,
  type BathymetryGrid,
  type ContourLine,
  type DemGrid,
  type SceneModel,
} from '@wi/shared';

/** The diorama: the waterbody plus a 2 km margin of land, cut out as a block with soil-coloured walls. */
export const BLOCK_MARGIN_M = 2000;
/** Longest side of the block in scene units. */
export const BLOCK_UNITS = 100;
export const GRID_SAMPLES = 192;
export const WALL_THICKNESS_UNITS = 5;
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
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  wall: {
    positions: Float32Array;
    normals: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
    rawTop: Float32Array;
  };
  autoExaggeration: number;
  /** Outline in scene units: x east, y north (rotate -90 degrees about X to lay it flat). */
  outlineU: Array<[number, number]>;
  maxDepthU: number;
  contours: { level: number; positions: Float32Array; rawY: number }[];
  contourInterval: number;
  toScene: (xm: number, ym: number) => [number, number];
  /** Unexaggerated terrain height in scene units at a local point (nearest grid cell). */
  heightAt: (xm: number, ym: number) => number;
  centre: [number, number];
  lonLatToLocal: (lon: number, lat: number) => [number, number];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const lerpColor = (out: Color, a: Color, b: Color, t: number) =>
  out.copy(a).lerp(b, Math.max(0, Math.min(1, t)));

const C = {
  sandShallow: new Color('#c9b98a'),
  bedMid: new Color('#7d8a7a'),
  bedDeep: new Color('#27455a'),
  shore: new Color('#cdbf94'),
  grass: new Color('#6f9350'),
  scrub: new Color('#8a8a55'),
  rock: new Color('#8d8679'),
  snow: new Color('#e9eef0'),
  soil: [new Color('#6d5537'), new Color('#5a452c'), new Color('#473620'), new Color('#2a2016')],
};

export function autoExaggeration(maxDepthM: number, blockLongM: number): number {
  return Math.max(
    MIN_EXAGGERATION,
    Math.min(MAX_EXAGGERATION, (0.08 * blockLongM) / Math.max(maxDepthM, 0.1)),
  );
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
    samples: GRID_SAMPLES,
    bounds,
  });
  const { nx, ny, cellX, cellY } = grid;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const toScene = (xm: number, ym: number): [number, number] => [(xm - cx) * S, -(ym - cy) * S];

  const proj = makeProjection(model.origin);
  const raw = new Float32Array(nx * ny);
  const colors = new Float32Array(nx * ny * 3);
  const positions = new Float32Array(nx * ny * 3);
  const tmp = new Color();
  const rel = new Float32Array(nx * ny); // metres relative to the surface
  let landMax = 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      const x = bounds.minX + i * cellX;
      const y = bounds.minY + j * cellY;
      let h: number;
      if (grid.inside[n]) h = -grid.depth[n];
      else {
        let land = 2 + 3 * Math.sin(x / 700) * Math.cos(y / 900); // gentle relief if no DEM
        if (dem) {
          const [lon, lat] = proj.toLonLat(x, y);
          const e = sampleDem(
            dem,
            Math.min(dem.bbox[2], Math.max(dem.bbox[0], lon)),
            Math.min(dem.bbox[3], Math.max(dem.bbox[1], lat)),
          );
          if (Number.isFinite(e)) land = Math.max(0.25, e - model.surfaceElevationM);
        }
        // Blend up from the waterline so the shore is continuous with the bed.
        const dShore = -grid.signedDistance[n];
        h = land * smooth(0, 90, dShore);
        if (dShore < 90) h = Math.max(h, 0.05 + 0.25 * smooth(0, 90, dShore) * land);
        if (h > landMax) landMax = h;
      }
      rel[n] = h;
      raw[n] = h * S;
    }
  }
  const maxDepth = Math.max(model.maxDepthM, 0.1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      const [X, Z] = toScene(bounds.minX + i * cellX, bounds.minY + j * cellY);
      positions[n * 3] = X;
      positions[n * 3 + 1] = raw[n];
      positions[n * 3 + 2] = Z;
      const h = rel[n];
      const noise = 0.94 + 0.12 * (Math.sin(i * 1.7) * Math.sin(j * 2.3) * 0.5 + 0.5);
      if (grid.inside[n]) {
        const d = grid.depth[n];
        lerpColor(tmp, C.sandShallow, C.bedMid, smooth(0, Math.min(maxDepth * 0.25, 18), d));
        lerpColor(tmp, tmp, C.bedDeep, smooth(Math.min(maxDepth * 0.25, 18), maxDepth, d));
      } else {
        const t = h / Math.max(landMax, 1);
        if (h < 1.2) tmp.copy(C.shore);
        else if (t < 0.45) lerpColor(tmp, C.grass, C.scrub, t / 0.45);
        else if (t < 0.85 || model.surfaceElevationM + h < 3000)
          lerpColor(tmp, C.scrub, C.rock, Math.min(1, (t - 0.45) / 0.4));
        else lerpColor(tmp, C.rock, C.snow, (t - 0.85) / 0.15);
      }
      colors[n * 3] = tmp.r * noise;
      colors[n * 3 + 1] = tmp.g * noise;
      colors[n * 3 + 2] = tmp.b * noise;
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

  // Walls: four sides, four rows each (top + three strata), outward normals.
  const sides: Array<{
    count: number;
    idx: (s: number) => number;
    nrm: [number, number, number];
    flip: boolean;
  }> = [
    { count: nx, idx: (s) => s, nrm: [0, 0, 1], flip: false }, // south (j = 0): Z largest
    { count: nx, idx: (s) => (ny - 1) * nx + s, nrm: [0, 0, -1], flip: true }, // north
    { count: ny, idx: (s) => s * nx, nrm: [-1, 0, 0], flip: true }, // west
    { count: ny, idx: (s) => s * nx + nx - 1, nrm: [1, 0, 0], flip: false }, // east
  ];
  const totalCols = sides.reduce((s, x) => s + x.count, 0);
  const wPos = new Float32Array(totalCols * 4 * 3);
  const wNrm = new Float32Array(totalCols * 4 * 3);
  const wCol = new Float32Array(totalCols * 4 * 3);
  const rawTop = new Float32Array(totalCols);
  const wIdx: number[] = [];
  let col = 0;
  for (const side of sides) {
    const first = col;
    for (let s = 0; s < side.count; s++) {
      const n = side.idx(s);
      rawTop[col] = raw[n];
      for (let r = 0; r < 4; r++) {
        const o = (col * 4 + r) * 3;
        wPos[o] = positions[n * 3];
        wPos[o + 1] = raw[n]; // updated by applyExaggeration
        wPos[o + 2] = positions[n * 3 + 2];
        wNrm[o] = side.nrm[0];
        wNrm[o + 1] = side.nrm[1];
        wNrm[o + 2] = side.nrm[2];
        const c = C.soil[r];
        const band = 0.92 + 0.16 * Math.abs(Math.sin(s * 0.37 + r * 2.1));
        wCol[o] = c.r * band;
        wCol[o + 1] = c.g * band;
        wCol[o + 2] = c.b * band;
      }
      col++;
    }
    for (let s = 0; s < side.count - 1; s++) {
      for (let r = 0; r < 3; r++) {
        const a = (first + s) * 4 + r;
        const b = (first + s + 1) * 4 + r;
        const c2 = (first + s) * 4 + r + 1;
        const d = (first + s + 1) * 4 + r + 1;
        if (side.flip) wIdx.push(a, c2, b, b, c2, d);
        else wIdx.push(a, b, c2, b, d, c2);
      }
    }
  }

  const interval = contourInterval(maxDepth);
  const contours = contourSegments(grid, interval).map((l: ContourLine) => {
    const pos = new Float32Array((l.segments.length / 2) * 3);
    for (let s = 0; s < l.segments.length; s += 2) {
      const [X, Z] = toScene(l.segments[s], l.segments[s + 1]);
      const o = (s / 2) * 3;
      pos[o] = X;
      pos[o + 1] = -l.level * S + 0.02;
      pos[o + 2] = Z;
    }
    return { level: l.level, positions: pos, rawY: -l.level * S };
  });

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
    positions,
    colors,
    indices,
    wall: { positions: wPos, normals: wNrm, colors: wCol, indices: new Uint32Array(wIdx), rawTop },
    autoExaggeration: autoExaggeration(maxDepth, long),
    outlineU: model.outline.map(([x, y]) => [(x - cx) * S, (y - cy) * S] as [number, number]),
    maxDepthU: maxDepth * S,
    contours,
    contourInterval: interval,
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

/** Scale the vertical axis in place (terrain, walls and contours). The base stays a constant thickness. */
export function applyExaggeration(d: Diorama, E: number) {
  for (let n = 0; n < d.raw.length; n++) d.positions[n * 3 + 1] = d.raw[n] * E;
  const base = -d.maxDepthU * E - WALL_THICKNESS_UNITS;
  const w = d.wall;
  for (let c = 0; c < w.rawTop.length; c++) {
    const top = w.rawTop[c] * E;
    for (let r = 0; r < 4; r++) w.positions[(c * 4 + r) * 3 + 1] = top + ((base - top) * r) / 3;
  }
  d.contours.forEach((l) => {
    for (let v = 0; v < l.positions.length / 3; v++) l.positions[v * 3 + 1] = l.rawY * E + 0.02;
  });
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
