import { describe, expect, it } from 'vitest';
import {
  chooseZoom,
  decodeTerrarium,
  encodeTerrarium,
  latToTileY,
  lonToTileX,
  sampleDem,
  stitchTerrarium,
  tilesForBbox,
  tileUrl,
  tileYToLat,
  TILE_SIZE,
  type RgbaTile,
} from './dem';

describe('terrarium encoding', () => {
  it('decodes sea level and known values', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBeCloseTo(100.5, 6);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });
  it('round-trips within 1/256 m', () => {
    for (const e of [-50, 0, 29.4, 174.25, 1897.8]) {
      const [r, g, b] = encodeTerrarium(e);
      expect(Math.abs(decodeTerrarium(r, g, b) - e)).toBeLessThan(1 / 128);
    }
  });
});

describe('tile math', () => {
  it('converts lon/lat to tile coordinates and back', () => {
    const z = 10;
    const y = latToTileY(44.5, z);
    expect(tileYToLat(y, z)).toBeCloseTo(44.5, 8);
    expect(lonToTileX(-180, z)).toBe(0);
    expect(lonToTileX(0, z)).toBeCloseTo(512, 8);
  });
  it('chooses a zoom giving roughly 256 samples', () => {
    const z = chooseZoom([-73.5, 44.4, -73.3, 44.6], 256);
    const px = (lonToTileX(-73.3, z) - lonToTileX(-73.5, z)) * TILE_SIZE;
    expect(px).toBeLessThanOrEqual(256 * 1.5);
    expect(px).toBeGreaterThan(100);
  });
  it('lists the tiles covering a bbox and fills URL templates', () => {
    const tiles = tilesForBbox([-73.5, 44.4, -73.3, 44.6], 9);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tileUrl('https://x/{z}/{x}/{y}.png', tiles[0])).toBe(
      `https://x/9/${tiles[0].x}/${tiles[0].y}.png`,
    );
  });
});

function flatTile(
  z: number,
  x: number,
  y: number,
  elevation: (px: number, py: number) => number,
): RgbaTile {
  const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const [r, g, b] = encodeTerrarium(elevation(px + x * TILE_SIZE, py + y * TILE_SIZE));
      const o = (py * TILE_SIZE + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { z, x, y, data };
}

describe('stitchTerrarium', () => {
  it('samples a gradient DEM across two tiles', () => {
    const z = 8;
    const bbox: [number, number, number, number] = [-73.6, 44.3, -73.0, 44.7];
    const refs = tilesForBbox(bbox, z);
    const f = (px: number) => px * 0.5; // 0.5 m per pixel eastwards
    const tiles = refs.map((t) => flatTile(z, t.x, t.y, (px) => f(px) - 20000));
    const grid = stitchTerrarium(tiles, bbox, 32, 32);
    expect(grid.elevations).toHaveLength(32 * 32);
    const left = grid.elevations[16 * 32 + 1];
    const right = grid.elevations[16 * 32 + 30];
    expect(right).toBeGreaterThan(left);
    const expectedLeft = f(lonToTileX(-73.6, z) * TILE_SIZE) - 20000;
    expect(Math.abs(left - expectedLeft)).toBeLessThan(10);
  });
});

describe('sampleDem', () => {
  it('bilinearly interpolates and returns NaN outside', () => {
    const grid = {
      bbox: [0, 0, 2, 2] as [number, number, number, number],
      width: 2,
      height: 2,
      elevations: [0, 10, 0, 10],
    };
    expect(sampleDem(grid, 1, 1)).toBeCloseTo(5, 6);
    expect(sampleDem(grid, 5, 1)).toBeNaN();
  });
});
