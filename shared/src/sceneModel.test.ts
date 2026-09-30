import { describe, expect, it } from 'vitest';
import type {
  ImpairmentProfile,
  ParameterKey,
  ParameterSummary,
  SourceResult,
  SpeciesRecord,
  WaterbodyIdentity,
} from './types';
import { THRESHOLDS } from './thresholds';
import { PARAMETERS } from './parameters';
import { isCounterClockwise } from './geo';
import {
  MAX_ACTORS,
  MAX_SPECIES,
  actorCount,
  buildOutline,
  buildSceneModel,
  computeVisibility,
  computeWaterTint,
  simplifyRing,
} from './sceneModel';

const prov = { source: 't', url: '', retrievedAt: '2026-01-01T00:00:00Z' };
const ok = <T>(data: T): SourceResult<T> => ({ status: 'ok', data, provenance: prov });

function circleIdentity(n = 60, r = 0.02): WaterbodyIdentity {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < n; i++)
    ring.push([
      -73 + r * Math.cos((2 * Math.PI * i) / n),
      44 + r * Math.sin((2 * Math.PI * i) / n),
    ]);
  ring.push(ring[0]);
  return {
    id: 'nhd:t',
    name: 'Test Lake',
    type: 'lake',
    country: 'US',
    geometry: { type: 'Polygon', coordinates: [ring] },
    bbox: [-73.02, 43.98, -72.98, 44.02],
    centroid: [-73, 44],
  };
}

const param = (
  key: ParameterKey,
  value: number,
  extra: Partial<ParameterSummary> = {},
): ParameterSummary => ({
  key,
  label: PARAMETERS[key].label,
  unit: PARAMETERS[key].unit,
  latest: { value, date: '2026-08-10', stationId: 's' },
  median5y: value,
  min: value,
  max: value,
  sampleCount: 3,
  series: [],
  status: 'no_reference',
  ...(THRESHOLDS[key] ? { threshold: THRESHOLDS[key] } : {}),
  ...extra,
});

const sp = (n: number, over: Partial<SpeciesRecord> = {}): SpeciesRecord => ({
  gbifKey: n,
  scientificName: `Testus species${n}`,
  commonName: `Test fish ${n}`,
  group: 'fish',
  recordCount: 1000 - n * 10,
  introduced: false,
  ...over,
});

describe('visibility', () => {
  it('is 1.5 x Secchi depth when known', () => {
    expect(computeVisibility(4, 50)).toBe(6);
  });
  it('falls back to clamp(8 / (NTU + 0.3), 0.3, 30)', () => {
    expect(computeVisibility(undefined, 4.7)).toBeCloseTo(1.6, 6);
    expect(computeVisibility(undefined, 0)).toBeCloseTo(26.67, 1);
    expect(computeVisibility(undefined, 0.001)).toBeLessThanOrEqual(30);
    expect(computeVisibility(undefined, 500)).toBe(0.3);
  });
  it('defaults to 5 m', () => {
    expect(computeVisibility()).toBe(5);
  });
});

describe('water tint', () => {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  it('is bluer when clear, greener with chlorophyll, browner with turbidity', () => {
    const clear = rgb(computeWaterTint(0.2, 0.1));
    const algae = rgb(computeWaterTint(60, 2));
    const muddy = rgb(computeWaterTint(1, 60));
    expect(clear[2]).toBeGreaterThan(clear[0]);
    expect(clear[2]).toBeGreaterThan(clear[1]);
    expect(algae[1]).toBeGreaterThan(algae[2]);
    expect(muddy[0]).toBeGreaterThan(muddy[2]);
    expect(computeWaterTint()).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('actorCount', () => {
  it('follows clamp(round(4 x log10(n + 1)), 1, 24)', () => {
    expect(actorCount(0)).toBe(1);
    expect(actorCount(9)).toBe(4);
    expect(actorCount(99)).toBe(8);
    expect(actorCount(999)).toBe(12);
    expect(actorCount(10 ** 9)).toBe(24);
  });
});

describe('outline', () => {
  it('is local metres, centred, counter-clockwise, open and at most 400 vertices', () => {
    const id = circleIdentity(2000, 0.05);
    const o = buildOutline(id);
    expect(o.length).toBeLessThanOrEqual(400);
    expect(o.length).toBeGreaterThan(50);
    expect(isCounterClockwise(o)).toBe(true);
    expect(o[0]).not.toEqual(o[o.length - 1]);
    const xs = o.map((p) => p[0]);
    const ys = o.map((p) => p[1]);
    // 0.05 degrees of longitude at 44 N is about 4.0 km; 0.05 degrees of latitude is about 5.5 km.
    expect(Math.max(...xs)).toBeGreaterThan(3900);
    expect(Math.max(...xs)).toBeLessThan(4100);
    expect(Math.max(...ys)).toBeGreaterThan(5400);
    expect(Math.max(...ys)).toBeLessThan(5600);
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(120);
  });
  it('buffers a river centre line into a polygon of about the given width', () => {
    const id: WaterbodyIdentity = {
      ...circleIdentity(),
      type: 'river',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-73.05, 44],
          [-72.95, 44],
        ],
      },
    };
    const o = buildOutline(id, 100);
    const ys = o.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(90);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(120);
  });
  it('simplifyRing keeps shape within the vertex budget', () => {
    const ring = Array.from({ length: 1000 }, (_, i): [number, number] => [
      1000 * Math.cos((2 * Math.PI * i) / 1000),
      1000 * Math.sin((2 * Math.PI * i) / 1000),
    ]);
    const s = simplifyRing(ring, 100);
    expect(s.length).toBeLessThanOrEqual(100);
    expect(s.length).toBeGreaterThan(40);
  });
});

describe('buildSceneModel', () => {
  const base = { identity: circleIdentity() };

  it('uses depth from the physical profile and flags estimates', () => {
    const m1 = buildSceneModel({
      ...base,
      physical: ok({
        areaKm2: { value: 1, unit: '', estimated: false },
        perimeterKm: { value: 1, unit: '', estimated: false },
        maxDepthM: { value: 122, unit: 'm', estimated: false },
        meanDepthM: { value: 20, unit: 'm', estimated: false },
      }),
    });
    expect(m1).toMatchObject({ maxDepthM: 122, meanDepthM: 20, depthEstimated: false });
    const m2 = buildSceneModel({
      ...base,
      physical: ok({
        areaKm2: { value: 1, unit: '', estimated: false },
        perimeterKm: { value: 1, unit: '', estimated: false },
        maxDepthM: { value: 30, unit: 'm', estimated: true },
      }),
    });
    expect(m2.depthEstimated).toBe(true);
    expect(m2.meanDepthM).toBe(15);
    const m3 = buildSceneModel(base);
    expect(m3.depthEstimated).toBe(true);
    expect(m3.maxDepthM).toBe(5);
  });

  it('derives visibility and tint from the quality data', () => {
    const m = buildSceneModel({
      ...base,
      quality: ok([param('secchi_depth', 2), param('turbidity', 30), param('chlorophyll_a', 50)]),
    });
    expect(m.visibilityM).toBe(3);
    expect(m.turbidityNtu).toBe(30);
    expect(m.chlorophyllUgL).toBe(50);
    expect(m.waterTint).not.toBe(buildSceneModel(base).waterTint);
  });

  it('picks the top 12 species by record count with counts from the formula and a 250 cap', () => {
    const life = Array.from({ length: 30 }, (_, i) => sp(i + 1, { recordCount: 100000 }));
    const m = buildSceneModel({ ...base, life: ok(life) });
    expect(m.actors).toHaveLength(MAX_SPECIES);
    expect(m.actors.reduce((s, a) => s + a.count, 0)).toBeLessThanOrEqual(MAX_ACTORS);
    expect(m.actors.every((a) => a.count >= 1)).toBe(true);
    const small = buildSceneModel({
      ...base,
      life: ok([sp(1, { recordCount: 99 }), sp(2, { recordCount: 9 })]),
    });
    expect(small.actors.map((a) => a.count)).toEqual([8, 4]);
  });

  it('always includes an introduced species when one exists', () => {
    const life = [
      ...Array.from({ length: 20 }, (_, i) => sp(i + 1)),
      sp(99, { introduced: true, recordCount: 3 }),
    ];
    const m = buildSceneModel({ ...base, life: ok(life) });
    expect(m.actors).toHaveLength(MAX_SPECIES);
    expect(m.actors.some((a) => a.introduced && a.scientificName === 'Testus species99')).toBe(
      true,
    );
  });

  it('pins a chosen species even when it is rare', () => {
    const life = Array.from({ length: 20 }, (_, i) => sp(i + 1));
    const m = buildSceneModel({ ...base, life: ok(life) }, undefined, {
      pinnedSpecies: 'Testus species20',
    });
    expect(m.actors.find((a) => a.scientificName === 'Testus species20')?.pinned).toBe(true);
    expect(m.actors).toHaveLength(MAX_SPECIES);
  });

  it('keeps plants and cyanobacteria out of the actors and counts plants', () => {
    const life = [
      sp(1),
      sp(2, { group: 'plant' }),
      sp(3, { group: 'plant' }),
      sp(4, { group: 'cyanobacteria' }),
    ];
    const m = buildSceneModel({ ...base, life: ok(life) });
    expect(m.actors.map((a) => a.scientificName)).toEqual(['Testus species1']);
    expect(m.plantCount).toBe(2);
  });

  it('resolves traits from the supplied catalog, then taxonomic fallbacks', () => {
    const catalog = [
      {
        id: 'testus-species1',
        scientificName: 'Testus species1',
        commonName: 'X',
        archetype: 'elongate' as const,
        lengthCm: [10, 30] as [number, number],
        colors: { back: '#111111', side: '#222222', belly: '#333333', fin: '#444444' },
        depthBand: 'surface' as const,
        schooling: true,
      },
    ];
    const m = buildSceneModel(
      { ...base, life: ok([sp(1), sp(2, { family: 'Anguillidae' })]) },
      catalog,
    );
    expect(m.actors[0]).toMatchObject({
      archetype: 'elongate',
      depthBand: 'surface',
      lengthCm: 20,
      schooling: true,
      catalogId: 'testus-species1',
    });
    expect(m.actors[1]).toMatchObject({ archetype: 'anguilliform', catalogId: null });
  });

  it('computes pollutant ratios (value / threshold) and never invents particles', () => {
    const m = buildSceneModel({
      ...base,
      quality: ok([
        param('e_coli', 252),
        param('microcystins', 4),
        param('water_temp', 20),
        param('total_phosphorus', 0.05),
        param('mercury', 0.001),
      ]),
    });
    expect(m.pollutants.map((p) => [p.key, Math.round(p.ratio * 10000) / 10000])).toEqual([
      ['e_coli', 2],
      ['microcystins', 0.5],
      ['mercury', 0.0005],
    ]);
    expect(m.pollutantDetails[0]).toMatchObject({
      key: 'e_coli',
      value: 252,
      threshold: 126,
      unit: 'CFU/100 mL',
    });
    expect(buildSceneModel(base).pollutants).toEqual([]);
    expect(
      buildSceneModel({ ...base, quality: ok([param('water_temp', 20), param('ph', 7)]) })
        .pollutants,
    ).toEqual([]);
  });

  it('maps impairment causes to measured parameters', () => {
    const imp: ImpairmentProfile = {
      assessmentUnits: [],
      uses: [],
      causes: [
        { name: 'Phosphorus, Total', group: 'nutrients', hasTmdl: true },
        { name: 'Mercury in Fish Tissue', group: 'metals', hasTmdl: false },
        { name: 'Non-native Aquatic Plants', group: 'other', hasTmdl: false },
      ],
    };
    const m = buildSceneModel({
      ...base,
      quality: ok([param('total_phosphorus', 0.03)]),
      impairments: ok(imp),
    });
    expect(m.listedImpairments.map((c) => [c.name, c.measuredKey])).toEqual([
      ['Phosphorus, Total', 'total_phosphorus'],
      ['Mercury in Fish Tissue', undefined],
      ['Non-native Aquatic Plants', undefined],
    ]);
  });

  it('estimates a thermocline only for deep lakes with summer temperatures', () => {
    const physical = (d: number) =>
      ok({
        areaKm2: { value: 1, unit: '', estimated: false },
        perimeterKm: { value: 1, unit: '', estimated: false },
        maxDepthM: { value: d, unit: 'm', estimated: false },
      });
    const deep = buildSceneModel({
      ...base,
      physical: physical(40),
      quality: ok([param('water_temp', 22)]),
    });
    expect(deep.thermoclineM).toBeGreaterThan(1);
    expect(deep.thermoclineEstimated).toBe(true);
    expect(
      buildSceneModel({ ...base, physical: physical(4), quality: ok([param('water_temp', 22)]) })
        .thermoclineM,
    ).toBeUndefined();
    expect(
      buildSceneModel({
        ...base,
        physical: physical(40),
        quality: ok([
          param('water_temp', 5, { latest: { value: 5, date: '2026-01-10', stationId: 's' } }),
        ]),
      }).thermoclineM,
    ).toBeUndefined();
  });

  it('measures the thermocline from a temperature depth profile', () => {
    const physical = ok({
      areaKm2: { value: 1, unit: '', estimated: false },
      perimeterKm: { value: 1, unit: '', estimated: false },
      maxDepthM: { value: 40, unit: 'm', estimated: false },
    });
    const t = param('water_temp', 22, {
      depthProfile: [
        { depthM: 1, value: 22 },
        { depthM: 5, value: 21.5 },
        { depthM: 10, value: 21 },
        { depthM: 14, value: 12 },
        { depthM: 20, value: 7 },
        { depthM: 30, value: 5 },
      ],
    });
    const m = buildSceneModel({ ...base, physical, quality: ok([t]) });
    expect(m.thermoclineM).toBe(12);
    expect(m.thermoclineEstimated).toBe(false);
  });

  it('carries the dissolved oxygen profile and surface value', () => {
    const d = param('dissolved_oxygen', 8.5, {
      depthProfile: [
        { depthM: 1, value: 9 },
        { depthM: 10, value: 4 },
      ],
    });
    const m = buildSceneModel({ ...base, quality: ok([d]) });
    expect(m.doProfile).toEqual([
      { depthM: 1, mgL: 9 },
      { depthM: 10, mgL: 4 },
    ]);
    expect(m.surfaceDoMgL).toBe(8.5);
    expect(
      buildSceneModel({ ...base, quality: ok([param('dissolved_oxygen', 8.5)]) }).doProfile,
    ).toBeUndefined();
  });

  it('marks rivers and carries demo, name and origin', () => {
    const id: WaterbodyIdentity = { ...circleIdentity(), type: 'river', name: null };
    const m = buildSceneModel({ identity: id, demo: true });
    expect(m).toMatchObject({
      isRiver: true,
      demo: true,
      name: 'Unnamed river',
      origin: [-73, 44],
    });
  });
});
