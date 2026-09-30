import { describe, expect, it } from 'vitest';
import {
  CHARACTERISTIC_QUERY_NAMES,
  decimate,
  mapCharacteristic,
  parseResultRows,
  pickDepthProfile,
  summarize,
} from './wqp';

const row = (o: Record<string, string>): Record<string, string> => ({
  MonitoringLocationIdentifier: 'S1',
  ActivityMediaName: 'Water',
  ResultStatusIdentifier: 'Final',
  ActivityStartDate: '2026-08-01',
  ...o,
});

describe('characteristic mapping', () => {
  it('maps WQP characteristic names to parameter keys', () => {
    expect(mapCharacteristic('Temperature, water', '')).toBe('water_temp');
    expect(mapCharacteristic('Dissolved oxygen (DO)', '')).toBe('dissolved_oxygen');
    expect(mapCharacteristic('Depth, Secchi disk depth', '')).toBe('secchi_depth');
    expect(mapCharacteristic('Phosphorus', 'Total')).toBe('total_phosphorus');
    expect(mapCharacteristic('Perfluorooctanesulfonic acid', '')).toBe('pfos');
    expect(mapCharacteristic('Escherichia coli', '')).toBe('e_coli');
    expect(mapCharacteristic('Microcystin', 'Total')).toBe('microcystins');
    expect(mapCharacteristic('Chlorophyll a, corrected for pheophytin', '')).toBe('chlorophyll_a');
  });
  it('rejects unmapped names and unwanted fractions', () => {
    expect(mapCharacteristic('Calcium', 'Total')).toBeNull();
    expect(mapCharacteristic('Phosphorus', 'Dissolved')).toBeNull();
    expect(mapCharacteristic('Mercury', 'Dissolved')).toBeNull();
    expect(mapCharacteristic('Nitrate', 'Dissolved')).toBe('nitrate');
  });
  it('requests every mapped characteristic name', () => {
    expect(CHARACTERISTIC_QUERY_NAMES).toContain('Temperature, water');
    expect(new Set(CHARACTERISTIC_QUERY_NAMES).size).toBe(CHARACTERISTIC_QUERY_NAMES.length);
  });
});

describe('parseResultRows', () => {
  it('converts units: F to C, ug/L to mg/L, ft to m, ng/L to ug/L', () => {
    const p = parseResultRows([
      row({
        CharacteristicName: 'Temperature, water',
        ResultMeasureValue: '68',
        'ResultMeasure/MeasureUnitCode': 'deg F',
      }),
      row({
        CharacteristicName: 'Phosphorus',
        ResultSampleFractionText: 'Total',
        ResultMeasureValue: '25',
        'ResultMeasure/MeasureUnitCode': 'ug/l',
      }),
      row({
        CharacteristicName: 'Depth, Secchi disk depth',
        ResultMeasureValue: '10',
        'ResultMeasure/MeasureUnitCode': 'ft',
      }),
      row({
        CharacteristicName: 'Mercury',
        ResultSampleFractionText: 'Total',
        ResultMeasureValue: '5',
        'ResultMeasure/MeasureUnitCode': 'ng/l',
      }),
    ]);
    expect(p.surface.get('water_temp')![0].v).toBeCloseTo(20, 6);
    expect(p.surface.get('total_phosphorus')![0].v).toBeCloseTo(0.025, 9);
    expect(p.surface.get('secchi_depth')![0].v).toBeCloseTo(3.048, 6);
    expect(p.surface.get('mercury')![0].v).toBeCloseTo(0.005, 9);
  });
  it('skips non-detects, rejected results, non-water media, unknown units and stations not wanted', () => {
    const p = parseResultRows(
      [
        row({
          CharacteristicName: 'Lead',
          ResultSampleFractionText: 'Total',
          ResultMeasureValue: '',
          ResultDetectionConditionText: 'Not Detected',
          'ResultMeasure/MeasureUnitCode': 'ug/l',
        }),
        row({
          CharacteristicName: 'pH',
          ResultMeasureValue: '7',
          'ResultMeasure/MeasureUnitCode': 'std units',
          ResultStatusIdentifier: 'Rejected',
        }),
        row({
          CharacteristicName: 'pH',
          ResultMeasureValue: '7',
          'ResultMeasure/MeasureUnitCode': 'std units',
          ActivityMediaName: 'Sediment',
        }),
        row({
          CharacteristicName: 'Temperature, water',
          ResultMeasureValue: '5',
          'ResultMeasure/MeasureUnitCode': 'furlongs',
        }),
        row({
          CharacteristicName: 'pH',
          ResultMeasureValue: '7',
          'ResultMeasure/MeasureUnitCode': 'std units',
          MonitoringLocationIdentifier: 'OTHER',
        }),
        row({
          CharacteristicName: 'pH',
          ResultMeasureValue: 'abc',
          'ResultMeasure/MeasureUnitCode': 'std units',
        }),
      ],
      new Set(['S1']),
    );
    expect(p.surface.size).toBe(0);
    expect(p.skipped).toBe(6);
  });
  it('routes readings deeper than 2 m to the depth profile', () => {
    const p = parseResultRows([
      row({
        CharacteristicName: 'Dissolved oxygen (DO)',
        ResultMeasureValue: '8',
        'ResultMeasure/MeasureUnitCode': 'mg/l',
        'ActivityDepthHeightMeasure/MeasureValue': '0.5',
        'ActivityDepthHeightMeasure/MeasureUnitCode': 'm',
      }),
      row({
        CharacteristicName: 'Dissolved oxygen (DO)',
        ResultMeasureValue: '3',
        'ResultMeasure/MeasureUnitCode': 'mg/l',
        'ActivityDepthHeightMeasure/MeasureValue': '30',
        'ActivityDepthHeightMeasure/MeasureUnitCode': 'ft',
      }),
    ]);
    expect(p.surface.get('dissolved_oxygen')).toHaveLength(1);
    expect(p.profile.get('dissolved_oxygen')).toHaveLength(2);
    expect(p.profile.get('dissolved_oxygen')![1].depthM).toBeCloseTo(9.144, 3);
  });
});

describe('summarize', () => {
  const rows = (vals: Array<[string, number]>) =>
    vals.map(([d, v]) =>
      row({
        ActivityStartDate: d,
        CharacteristicName: 'Escherichia coli',
        ResultMeasureValue: String(v),
        'ResultMeasure/MeasureUnitCode': 'cfu/100mL',
      }),
    );

  it('computes latest, median, min, max, count and status against the threshold', () => {
    const [s] = summarize(
      parseResultRows(
        rows([
          ['2024-06-01', 10],
          ['2025-06-01', 300],
          ['2026-06-01', 120],
          ['2026-08-01', 200],
        ]),
      ),
    );
    expect(s.key).toBe('e_coli');
    expect(s.latest).toEqual({ value: 200, date: '2026-08-01', stationId: 'S1' });
    expect(s.median5y).toBe(160);
    expect([s.min, s.max, s.sampleCount]).toEqual([10, 300, 4]);
    expect(s.status).toBe('exceeds');
    expect(s.threshold?.value).toBe(126);
    expect(s.series.map((p) => p.t)).toEqual([
      '2024-06-01',
      '2025-06-01',
      '2026-06-01',
      '2026-08-01',
    ]);
  });
  it('gives no_reference for phosphorus and adds a trophic-state note', () => {
    const [s] = summarize(
      parseResultRows([
        row({
          CharacteristicName: 'Phosphorus',
          ResultSampleFractionText: 'Total',
          ResultMeasureValue: '0.05',
          'ResultMeasure/MeasureUnitCode': 'mg/l',
        }),
      ]),
    );
    expect(s.status).toBe('no_reference');
    expect(s.threshold).toBeUndefined();
    expect(s.note).toMatch(/Carlson TSI/);
  });
  it('omits parameters without data', () => {
    expect(summarize(parseResultRows([]))).toEqual([]);
  });
  it('caps series at 500 points and keeps the latest', () => {
    const many = Array.from(
      { length: 1200 },
      (_, i) => [`2022-01-${String((i % 28) + 1).padStart(2, '0')}`, i] as [string, number],
    );
    const [s] = summarize(
      parseResultRows(
        rows(
          many.map(([, v], i) => [
            `${2021 + Math.floor(i / 400)}-${String(1 + ((i % 400) % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
            v,
          ]),
        ),
      ),
    );
    expect(s.series.length).toBeLessThanOrEqual(500);
    expect(s.sampleCount).toBe(1200);
  });
});

describe('decimate', () => {
  it('keeps first and last', () => {
    const d = decimate(
      Array.from({ length: 1000 }, (_, i) => i),
      100,
    );
    expect(d).toHaveLength(100);
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(999);
  });
});

describe('pickDepthProfile', () => {
  it('uses the most recent day with at least 3 depths', () => {
    const mk = (t: string, depthM: number, v: number) => ({ t, stationId: 'S1', depthM, v });
    const p = pickDepthProfile([
      mk('2026-07-01', 1, 9),
      mk('2026-07-01', 5, 8),
      mk('2026-07-01', 9, 7),
      mk('2026-08-01', 1, 9),
      mk('2026-08-01', 5, 6),
    ]);
    expect(p?.date).toBe('2026-07-01');
    expect(p?.points.map((x) => x.depthM)).toEqual([1, 5, 9]);
  });
  it('returns null when no day has enough depths', () => {
    expect(pickDepthProfile([{ t: '2026-07-01', stationId: 'S1', depthM: 3, v: 1 }])).toBeNull();
    expect(pickDepthProfile(undefined)).toBeNull();
  });
});
