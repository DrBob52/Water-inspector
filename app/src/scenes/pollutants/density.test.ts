import { describe, expect, it } from 'vitest';
import type { ParameterSummary, SceneModel } from '@wi/shared';
import {
  MAX_POLLUTANT_PARTICLES,
  MIN_POLLUTANT_PARTICLES,
  POLLUTANT_COLOR_BY_KEY,
  particleCount,
  plumeIntensity,
  pollutantColor,
  pollutantLayers,
  ratioBar,
} from './density';

describe('particleCount', () => {
  it('grows with the ratio on a log scale', () => {
    const a = particleCount(0.1);
    const b = particleCount(1);
    const c = particleCount(10);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(b - a).toBe(c - b); // equal steps per decade
  });
  it('is capped and has a small floor for real but tiny measurements', () => {
    expect(particleCount(1e9)).toBe(MAX_POLLUTANT_PARTICLES);
    expect(particleCount(1e-6)).toBe(MIN_POLLUTANT_PARTICLES);
  });
  it('never invents particles for missing or zero values', () => {
    expect(particleCount(0)).toBe(0);
    expect(particleCount(-1)).toBe(0);
    expect(particleCount(Number.NaN)).toBe(0);
  });
});

const threshold = (value: number) => ({
  label: 'ref',
  value,
  unit: 'u',
  direction: 'max' as const,
  citation: 'https://example.org',
});
const summary = (
  key: ParameterSummary['key'],
  byStation: Record<string, number>,
  t = 8,
): ParameterSummary => ({
  key,
  label: key,
  unit: 'u',
  latest: null,
  median5y: null,
  min: null,
  max: null,
  sampleCount: 1,
  series: [],
  threshold: threshold(t),
  status: 'good',
  latestByStation: Object.fromEntries(
    Object.entries(byStation).map(([k, v]) => [k, { value: v, date: '2026-09-01' }]),
  ),
});
const model = (pollutants: SceneModel['pollutants']): SceneModel =>
  ({
    pollutants,
    stations: [
      { id: 'A', name: 'Bay', lon: -83.3, lat: 41.7, org: 'x' },
      { id: 'B', name: 'Open water', lon: -83.0, lat: 41.75, org: 'x' },
    ],
  }) as unknown as SceneModel;

describe('pollutantLayers', () => {
  it('puts one plume at each site that measured the pollutant, sized by that site’s ratio', () => {
    const m = model([{ key: 'microcystins', ratio: 1.4, label: 'Microcystins' }]);
    const [layer] = pollutantLayers(m, [summary('microcystins', { A: 11.2, B: 0.4 })]);
    expect(layer.sources.map((s) => s.stationId)).toEqual(['A', 'B']);
    expect(layer.sources[0].ratio).toBeCloseTo(1.4, 6);
    expect(layer.sources[0].count).toBeGreaterThan(layer.sources[1].count);
    expect(layer.over).toBe(true);
    expect(layer.diffuseCount).toBe(0);
    expect(layer.color).toBe(POLLUTANT_COLOR_BY_KEY.microcystins);
  });
  it('ignores sites without a position and falls back to one thin lake-wide cloud', () => {
    const m = model([{ key: 'chloride', ratio: 0.1, label: 'Chloride' }]);
    const [layer] = pollutantLayers(m, [summary('chloride', { Z: 23 }, 230)]);
    expect(layer.sources).toHaveLength(0);
    expect(layer.diffuseCount).toBe(particleCount(0.1));
  });
  it('makes no layers (and so no particles) when nothing was measured', () => {
    expect(pollutantLayers(model([]), [summary('microcystins', { A: 11 })])).toEqual([]);
  });
  it('keeps every layer within the particle cap', () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [i < 2 ? ['A', 'B'][i] : `S${i}`, 800]),
    );
    const m = model([{ key: 'e_coli', ratio: 100, label: 'E. coli' }]);
    const [layer] = pollutantLayers(m, [summary('e_coli', many)]);
    expect(layer.sources.reduce((s, x) => s + x.count, 0)).toBeLessThanOrEqual(
      MAX_POLLUTANT_PARTICLES,
    );
  });
});

describe('legend helpers', () => {
  it('glows fully above the threshold and dimmer below it', () => {
    expect(plumeIntensity(3)).toBe(1);
    expect(plumeIntensity(0.5)).toBeLessThan(1);
    expect(plumeIntensity(0.01)).toBeLessThan(plumeIntensity(0.5));
  });
  it('places the ratio bar on a log axis with the threshold in the middle', () => {
    expect(ratioBar(1)).toBeCloseTo(0.5, 6);
    expect(ratioBar(0.01)).toBe(0);
    expect(ratioBar(1000)).toBe(1);
    expect(ratioBar(0)).toBe(0);
  });
  it('has a stable colour per pollutant and a fallback palette', () => {
    expect(pollutantColor('e_coli', 5)).toBe(POLLUTANT_COLOR_BY_KEY.e_coli);
    expect(pollutantColor('salinity', 0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
