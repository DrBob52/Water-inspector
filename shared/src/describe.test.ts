import { describe, expect, it } from 'vitest';
import type { SceneModel } from './types';
import { describeScene } from './describe';

const model = (over: Partial<SceneModel> = {}): SceneModel => ({
  outline: [
    [-1000, -500],
    [1000, -500],
    [1000, 500],
    [-1000, 500],
  ],
  maxDepthM: 122,
  meanDepthM: 20,
  depthEstimated: false,
  visibilityM: 4,
  waterTint: '#0e5692',
  actors: Array.from({ length: 12 }, (_, i) => ({
    key: `s${i}`,
    catalogId: null,
    archetype: 'fusiform',
    count: 5,
    depthBand: 'midwater',
    lengthCm: 30,
    colors: { back: '#000', side: '#000', belly: '#000', fin: '#000' },
    introduced: false,
    label: 'x',
    scientificName: 'x y',
    recordCount: 10,
    schooling: false,
    group: 'fish' as const,
  })),
  pollutants: [],
  pollutantDetails: [],
  listedImpairments: [],
  isRiver: false,
  surfaceElevationM: 0,
  stations: [],
  plantCount: 0,
  name: 'Test Lake',
  origin: [0, 0],
  demo: true,
  ...over,
});

describe('describeScene', () => {
  it('matches the spec example for the underwater view', () => {
    expect(describeScene(model(), 'underwater')).toBe(
      '12 species shown; visibility about 4.0 m; max depth 122 m, bed shape modelled.',
    );
  });
  it('says estimated when depth is estimated', () => {
    expect(describeScene(model({ depthEstimated: true }), 'underwater')).toContain(
      'estimated and modelled',
    );
  });
  it('describes the cross-section with and without a DO profile', () => {
    expect(
      describeScene(
        model({
          doProfile: [
            { depthM: 1, mgL: 8 },
            { depthM: 50, mgL: 4 },
          ],
        }),
        'section',
      ),
    ).toContain('dissolved oxygen profile from 2 depths');
    expect(describeScene(model({ surfaceDoMgL: 8.4 }), 'section')).toContain(
      'no depth profile measured; surface dissolved oxygen 8.4 mg/L',
    );
  });
  it('describes pollutants and the empty case', () => {
    expect(describeScene(model(), 'pollutants')).toMatch(/No pollutant measurements/);
    expect(
      describeScene(
        model({
          pollutants: [
            { key: 'e_coli', ratio: 2, label: 'E. coli' },
            { key: 'nitrate', ratio: 0.1, label: 'Nitrate' },
          ],
        }),
        'pollutants',
      ),
    ).toContain(
      '2 measured pollutants shown as particles; 1 above their screening reference (E. coli)',
    );
  });
  it('honours imperial units', () => {
    expect(describeScene(model({ maxDepthM: 10 }), 'raised', 'imperial')).toContain(
      'max depth 32.8 ft',
    );
  });
});
