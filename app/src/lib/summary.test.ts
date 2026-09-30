import { describe, expect, it } from 'vitest';
import type { SourceResult, WaterbodyIdentity } from '@wi/shared';
import { buildSummary, displayName, impairmentHeadline, joinList } from './summary';

const prov = { source: 't', url: '', retrievedAt: '2026-01-01T00:00:00Z' };
const ok = <T>(data: T): SourceResult<T> => ({ status: 'ok', data, provenance: prov });
const identity: WaterbodyIdentity = {
  id: 'nhd:x',
  name: 'Test Lake',
  type: 'lake',
  state: 'VT',
  country: 'US',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  bbox: [0, 0, 1, 1],
  centroid: [0.5, 0.5],
};
const m = (value: number, estimated = false) => ({ value, unit: 'x', estimated });

describe('displayName', () => {
  it('falls back to "Unnamed <type>"', () => {
    expect(displayName({ ...identity, name: null })).toBe('Unnamed lake');
    expect(displayName({ ...identity, name: null, type: 'unknown' })).toBe('Unnamed waterbody');
  });
});

describe('impairmentHeadline', () => {
  it('covers impaired, clean, not assessed and errors', () => {
    const base = { assessmentUnits: [], uses: [] };
    expect(
      impairmentHeadline(
        ok({
          ...base,
          causes: [
            { name: 'Mercury in Fish Tissue', group: 'metals', hasTmdl: false },
            { name: 'Phosphorus, Total', group: 'nutrients', hasTmdl: true },
          ],
        }),
      ),
    ).toBe('Listed as impaired for: mercury, phosphorus');
    expect(impairmentHeadline(ok({ ...base, causes: [] }))).toBe('No impairments listed');
    expect(impairmentHeadline({ status: 'empty', data: null, provenance: prov })).toBe(
      'Not assessed',
    );
    expect(
      impairmentHeadline({ status: 'error', data: null, provenance: prov, error: 'x' }),
    ).toMatch(/could not be loaded/);
    expect(impairmentHeadline({ status: 'unsupported', data: null, provenance: prov })).toMatch(
      /United States/,
    );
  });
});

describe('buildSummary', () => {
  it('builds a template paragraph from whatever is available', () => {
    const text = buildSummary({
      identity,
      units: 'metric',
      physical: ok({
        areaKm2: m(12.3),
        perimeterKm: m(20),
        maxDepthM: m(30, true),
        meanDepthM: m(9, true),
      }),
      quality: ok([
        {
          key: 'water_temp',
          label: 'Water temperature',
          unit: '°C',
          latest: { value: 18.25, date: '2026-09-01', stationId: 'a' },
          median5y: 10,
          min: 1,
          max: 20,
          sampleCount: 5,
          series: [],
          status: 'no_reference',
        },
        {
          key: 'e_coli',
          label: 'E. coli',
          unit: 'CFU/100 mL',
          latest: { value: 300, date: '2026-09-01', stationId: 'a' },
          median5y: 10,
          min: 1,
          max: 20,
          sampleCount: 5,
          series: [],
          status: 'exceeds',
        },
      ]),
      life: ok([
        {
          gbifKey: 1,
          scientificName: 'A a',
          commonName: 'Alpha',
          group: 'fish',
          recordCount: 9,
          introduced: false,
        },
        {
          gbifKey: 2,
          scientificName: 'B b',
          commonName: 'Beta',
          group: 'fish',
          recordCount: 8,
          introduced: true,
        },
      ]),
      impairments: ok({ assessmentUnits: [], uses: [], causes: [] }),
    });
    expect(text).toContain('Test Lake is a lake in VT');
    expect(text).toContain('12.3 km²');
    expect(text).toContain('estimated at 30 m');
    expect(text).toContain('modelled');
    expect(text).toContain('water temperature 18.3 °C');
    expect(text).toContain('E. coli reading is above a published screening reference');
    expect(text).toContain(
      '2 species have records here, most often Alpha and Beta; 1 is flagged as introduced',
    );
    expect(text).toContain('No impairments listed');
  });
  it('never gives health or safety advice', () => {
    const text = buildSummary({ identity, units: 'imperial' });
    expect(text).not.toMatch(/safe|unsafe|swim|drink|eat/i);
  });
  it('works with nothing loaded', () => {
    expect(buildSummary({ identity: { ...identity, name: null }, units: 'metric' })).toMatch(
      /^Unnamed lake is a lake in VT/,
    );
  });
  it('joins lists', () => {
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
