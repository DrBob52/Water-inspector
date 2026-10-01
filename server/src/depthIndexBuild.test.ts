import { describe, expect, it } from 'vitest';
import { inUs, parseGlobathyCsv, toIndexEntry } from './depthIndexBuild';

const square = (lon: number, lat: number, d = 0.02) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [lon - d, lat - d],
      [lon + d, lat - d],
      [lon + d, lat + d],
      [lon - d, lat + d],
      [lon - d, lat - d],
    ],
  ],
});
const rec = {
  Hylak_id: 7,
  Lake_name: 'Test',
  Lake_area: 5.4,
  Vol_total: 120.5,
  Depth_avg: 22.3333,
};

describe('depth index build', () => {
  it('parses the GLOBathy CSV by column name', () => {
    const m = parseGlobathyCsv('Hylak_id,Max_depth,Other\n7,55.5,x\n8,,y\n9,12,z\n');
    expect([...m.entries()]).toEqual([
      [7, 55.5],
      [9, 12],
    ]);
    expect(() => parseGlobathyCsv('a,b\n1,2')).toThrow(/Hylak_id/);
  });
  it('builds a compact entry with the polygon centroid', () => {
    const e = toIndexEntry(rec, square(-73.3, 44.4), new Map([[7, 55.5]]));
    expect(e).toEqual({
      hylak_id: 7,
      name: 'Test',
      lon: -73.3,
      lat: 44.4,
      area_km2: 5.4,
      depth_avg_m: 22.33,
      depth_max_m: 55.5,
      vol_mcm: 120.5,
    });
  });
  it('drops lakes under 0.1 km2, without a max depth, or outside the United States', () => {
    const d = new Map([[7, 55.5]]);
    expect(toIndexEntry({ ...rec, Lake_area: 0.05 }, square(-73, 44), d)).toBeNull();
    expect(toIndexEntry(rec, square(-73, 44), new Map())).toBeNull();
    expect(toIndexEntry(rec, square(10, 50), d)).toBeNull();
    expect(inUs(-150, 64)).toBe(true);
    expect(inUs(2, 48)).toBe(false);
  });
});
