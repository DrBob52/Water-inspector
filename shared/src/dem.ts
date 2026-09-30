import type { DemGrid } from './types';

/** Terrarium encoding: elevation = R * 256 + G + B / 256 - 32768. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function encodeTerrarium(elevation: number): [number, number, number] {
  const v = elevation + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.floor((v - Math.floor(v)) * 256);
  return [r, g, b];
}

export const TILE_SIZE = 256;

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

/** Choose a zoom that yields about `targetSamples` samples across the longer bbox side. */
export function chooseZoom(
  bbox: [number, number, number, number],
  targetSamples = 256,
  maxZoom = 12,
): number {
  const [w, s, e, n] = bbox;
  for (let z = maxZoom; z >= 0; z--) {
    const px = (lonToTileX(e, z) - lonToTileX(w, z)) * TILE_SIZE;
    const py = (latToTileY(s, z) - latToTileY(n, z)) * TILE_SIZE;
    if (Math.max(px, py) <= targetSamples * 1.5) return z;
  }
  return 0;
}

export function tilesForBbox(bbox: [number, number, number, number], z: number): TileRef[] {
  const [w, s, e, n] = bbox;
  const x0 = Math.floor(lonToTileX(w, z));
  const x1 = Math.floor(lonToTileX(e, z));
  const y0 = Math.floor(latToTileY(n, z));
  const y1 = Math.floor(latToTileY(s, z));
  const max = 2 ** z - 1;
  const out: TileRef[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(max, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(max, x1); x++) out.push({ z, x, y });
  }
  return out;
}

export interface RgbaTile extends TileRef {
  /** RGBA bytes, 256 x 256. */
  data: Uint8Array | Uint8ClampedArray;
}

/**
 * Stitch decoded Terrarium tiles into an elevation grid of width x height samples covering bbox
 * (bilinear sampling of the decoded tile mosaic).
 */
export function stitchTerrarium(
  tiles: RgbaTile[],
  bbox: [number, number, number, number],
  width: number,
  height: number,
): DemGrid {
  const [w, s, e, n] = bbox;
  const z = tiles[0]?.z ?? 0;
  const byKey = new Map(tiles.map((t) => [`${t.x}/${t.y}`, t]));
  const elevAt = (px: number, py: number): number => {
    const tx = Math.floor(px / TILE_SIZE);
    const ty = Math.floor(py / TILE_SIZE);
    const tile = byKey.get(`${tx}/${ty}`);
    if (!tile) return NaN;
    const ix = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(px - tx * TILE_SIZE)));
    const iy = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(py - ty * TILE_SIZE)));
    const o = (iy * TILE_SIZE + ix) * 4;
    return decodeTerrarium(tile.data[o], tile.data[o + 1], tile.data[o + 2]);
  };
  const px0 = lonToTileX(w, z) * TILE_SIZE;
  const px1 = lonToTileX(e, z) * TILE_SIZE;
  const py0 = latToTileY(n, z) * TILE_SIZE;
  const py1 = latToTileY(s, z) * TILE_SIZE;
  const out = new Array<number>(width * height);
  let last = 0;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const px = px0 + ((i + 0.5) / width) * (px1 - px0);
      const py = py0 + ((j + 0.5) / height) * (py1 - py0);
      const v = elevAt(px, py);
      if (Number.isFinite(v)) last = v;
      out[j * width + i] = Number.isFinite(v) ? Math.round(v * 10) / 10 : last;
    }
  }
  return { bbox, width, height, elevations: out };
}

/** Bilinear elevation lookup in a grid; returns NaN outside the bbox. */
export function sampleDem(grid: DemGrid, lon: number, lat: number): number {
  const [w, s, e, n] = grid.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return NaN;
  const fx = ((lon - w) / (e - w)) * grid.width - 0.5;
  const fy = ((n - lat) / (n - s)) * grid.height - 0.5;
  const x0 = Math.max(0, Math.min(grid.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(grid.height - 1, Math.floor(fy)));
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const g = (x: number, y: number) => grid.elevations[y * grid.width + x];
  return (
    g(x0, y0) * (1 - tx) * (1 - ty) +
    g(x1, y0) * tx * (1 - ty) +
    g(x0, y1) * (1 - tx) * ty +
    g(x1, y1) * tx * ty
  );
}

export function tileUrl(template: string, t: TileRef): string {
  return template
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y));
}

export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
