import { describe, expect, it } from 'vitest';
import type { SceneModel } from '@wi/shared';
import { buildDiorama } from '../raised/diorama';
import type { PollutantLayer } from './density';
import { layoutPlumes } from './plumes';

const circle = (r: number, n = 64): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [
    r * Math.cos((2 * Math.PI * i) / n),
    r * Math.sin((2 * Math.PI * i) / n),
  ]);
const model = {
  outline: circle(3000),
  maxDepthM: 20,
  meanDepthM: 8,
  isRiver: false,
  surfaceElevationM: 100,
  origin: [-73, 44],
} as unknown as SceneModel;
const dio = buildDiorama(model, null);
const [east] = dio.lonLatToLocal(-73 + 0.025, 44); // about 2 km east of the centre

const layer = (over: Partial<PollutantLayer>): PollutantLayer => ({
  key: 'microcystins',
  label: 'Microcystins',
  color: '#6ef08c',
  ratio: 1.4,
  over: true,
  sources: [],
  diffuseCount: 0,
  ...over,
});

describe('layoutPlumes', () => {
  it('clusters particles around the site that measured them, inside the water', () => {
    const b = layoutPlumes(
      dio,
      layer({
        sources: [
          {
            stationId: 'A',
            name: 'East',
            lon: -73 + 0.025,
            lat: 44,
            value: 11,
            date: '2026-09-01',
            ratio: 1.4,
            count: 200,
          },
        ],
      }),
    );
    expect(b.count).toBe(200);
    const [sx] = dio.toScene(east, 0);
    let meanX = 0;
    for (let k = 0; k < b.count; k++) {
      const x = b.positions[k * 3];
      const z = b.positions[k * 3 + 2];
      meanX += x / b.count;
      expect(b.positions[k * 3 + 1]).toBeLessThan(0); // under the surface
      expect(Math.hypot(x, z)).toBeLessThan(3000 * dio.S + 0.5); // in the lake
    }
    expect(Math.abs(meanX - sx)).toBeLessThan(0.15 * dio.widthU);
    expect(b.over.every((v) => v === 1)).toBe(true);
  });
  it('spreads a thin cloud through the volume when no site positions are known', () => {
    const b = layoutPlumes(dio, layer({ ratio: 0.2, over: false, diffuseCount: 90 }));
    expect(b.count).toBe(90);
    expect(b.over.every((v) => v === 0)).toBe(true);
  });
  it('draws nothing for a layer with no particles', () => {
    expect(layoutPlumes(dio, layer({})).count).toBe(0);
  });
});
