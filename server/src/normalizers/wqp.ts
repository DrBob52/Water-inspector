import {
  PARAMETERS,
  THRESHOLDS,
  convertToCanonical,
  evaluateStatus,
  trophicNote,
  type ParameterKey,
  type ParameterSummary,
} from '@wi/shared';

interface CharRule {
  key: ParameterKey;
  /** WQP CharacteristicName values to request. */
  names: string[];
  test: RegExp;
  /** Allowed ResultSampleFractionText values (lower case). Blank is always allowed. */
  fractions?: string[];
}

const TOTAL = ['total', 'total recoverable', 'total/ recoverable'];

/** WQP characteristic name -> ParameterKey. The single source of truth for the mapping. */
export const CHARACTERISTIC_RULES: CharRule[] = [
  { key: 'water_temp', names: ['Temperature, water'], test: /^temperature, water$/i },
  {
    key: 'dissolved_oxygen',
    names: ['Dissolved oxygen (DO)'],
    test: /^dissolved oxygen( \(do\))?$/i,
  },
  { key: 'ph', names: ['pH'], test: /^ph$/i },
  { key: 'turbidity', names: ['Turbidity'], test: /^turbidity$/i },
  { key: 'secchi_depth', names: ['Depth, Secchi disk depth'], test: /secchi/i },
  { key: 'specific_conductance', names: ['Specific conductance'], test: /^specific conductance$/i },
  { key: 'total_phosphorus', names: ['Phosphorus'], test: /^phosphorus$/i, fractions: TOTAL },
  { key: 'total_nitrogen', names: ['Nitrogen'], test: /^nitrogen$/i, fractions: TOTAL },
  {
    key: 'nitrate',
    names: ['Nitrate'],
    test: /^nitrate( as n)?$/i,
    fractions: [...TOTAL, 'dissolved'],
  },
  { key: 'chlorophyll_a', names: ['Chlorophyll a'], test: /^chlorophyll a/i },
  { key: 'microcystins', names: ['Microcystin', 'Microcystins'], test: /^microcystins?/i },
  { key: 'e_coli', names: ['Escherichia coli'], test: /^escherichia coli$/i },
  { key: 'enterococci', names: ['Enterococcus'], test: /^enterococc/i },
  { key: 'mercury', names: ['Mercury'], test: /^mercury$/i, fractions: TOTAL },
  { key: 'lead', names: ['Lead'], test: /^lead$/i, fractions: TOTAL },
  { key: 'arsenic', names: ['Arsenic'], test: /^arsenic$/i, fractions: TOTAL },
  { key: 'pfas_total', names: ['Total PFAS'], test: /^total pfas$/i },
  {
    key: 'pfos',
    names: ['Perfluorooctanesulfonic acid'],
    test: /perfluorooctanesulfonic acid|^pfos$/i,
  },
  { key: 'pfoa', names: ['Perfluorooctanoic acid'], test: /perfluorooctanoic acid|^pfoa$/i },
  {
    key: 'pcbs',
    names: ['Polychlorinated Biphenyls (PCBs)'],
    test: /polychlorinated biphenyls|^pcbs?$/i,
    fractions: TOTAL,
  },
  { key: 'atrazine', names: ['Atrazine'], test: /^atrazine$/i },
  { key: 'chloride', names: ['Chloride'], test: /^chloride$/i },
  { key: 'salinity', names: ['Salinity'], test: /^salinity$/i },
];

export const CHARACTERISTIC_QUERY_NAMES = CHARACTERISTIC_RULES.flatMap((r) => r.names);

export function mapCharacteristic(name: string, fraction: string): ParameterKey | null {
  const n = name.trim();
  const fr = fraction.trim().toLowerCase();
  for (const r of CHARACTERISTIC_RULES) {
    if (!r.test.test(n)) continue;
    if (r.fractions && fr !== '' && !r.fractions.includes(fr)) return null;
    return r.key;
  }
  return null;
}

export interface Sample {
  t: string;
  v: number;
  stationId: string;
}

export interface ProfileSample {
  t: string;
  stationId: string;
  depthM: number;
  v: number;
}

const DEPTH_TO_M: Record<string, number> = { m: 1, cm: 0.01, ft: 0.3048, in: 0.0254, mm: 0.001 };
/** Readings deeper than this are treated as depth-profile data, not surface series. */
export const SURFACE_MAX_DEPTH_M = 2;
export const MAX_SERIES_POINTS = 500;

export interface ParsedRows {
  surface: Map<ParameterKey, Sample[]>;
  profile: Map<ParameterKey, ProfileSample[]>;
  skipped: number;
}

/** Turn WQP result rows into surface and depth-profile samples in canonical units. */
export function parseResultRows(
  rows: Array<Record<string, string>>,
  stationIds?: Set<string>,
): ParsedRows {
  const surface = new Map<ParameterKey, Sample[]>();
  const profile = new Map<ParameterKey, ProfileSample[]>();
  let skipped = 0;
  for (const r of rows) {
    const station = r['MonitoringLocationIdentifier'];
    if (stationIds && !stationIds.has(station)) {
      skipped++;
      continue;
    }
    const status = (r['ResultStatusIdentifier'] ?? '').toLowerCase();
    if (status === 'rejected' || status === 'preliminary-rejected') {
      skipped++;
      continue;
    }
    const media = (r['ActivityMediaName'] ?? '').toLowerCase();
    if (media && media !== 'water') {
      skipped++;
      continue;
    }
    if ((r['ResultDetectionConditionText'] ?? '').trim() !== '') {
      skipped++;
      continue;
    }
    const key = mapCharacteristic(
      r['CharacteristicName'] ?? '',
      r['ResultSampleFractionText'] ?? '',
    );
    const raw = (r['ResultMeasureValue'] ?? '').trim();
    if (!key || raw === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(raw)) {
      skipped++;
      continue;
    }
    const conv = convertToCanonical(key, Number(raw), r['ResultMeasure/MeasureUnitCode']);
    const date = (r['ActivityStartDate'] ?? '').slice(0, 10);
    if (!conv || !date) {
      skipped++;
      continue;
    }
    let depthM: number | null = null;
    const dRaw = (r['ActivityDepthHeightMeasure/MeasureValue'] ?? '').trim();
    if (dRaw !== '' && Number.isFinite(Number(dRaw))) {
      const f =
        DEPTH_TO_M[(r['ActivityDepthHeightMeasure/MeasureUnitCode'] ?? 'm').trim().toLowerCase()] ??
        1;
      depthM = Number(dRaw) * f;
    }
    if (depthM !== null && depthM > SURFACE_MAX_DEPTH_M) {
      const arr = profile.get(key) ?? [];
      arr.push({ t: date, stationId: station, depthM, v: conv.value });
      profile.set(key, arr);
    } else {
      const arr = surface.get(key) ?? [];
      arr.push({ t: date, v: conv.value, stationId: station });
      surface.set(key, arr);
      // A near-surface reading also anchors the top of a depth profile.
      if (depthM !== null) {
        const p = profile.get(key) ?? [];
        p.push({ t: date, stationId: station, depthM, v: conv.value });
        profile.set(key, p);
      }
    }
  }
  return { surface, profile, skipped };
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/** Most recent day with at least 3 distinct depths at one station, averaged per depth. */
export function pickDepthProfile(
  samples: ProfileSample[] | undefined,
): { date: string; points: Array<{ depthM: number; value: number }> } | null {
  if (!samples?.length) return null;
  const groups = new Map<string, ProfileSample[]>();
  for (const s of samples) {
    const k = `${s.t}|${s.stationId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  let best: { date: string; list: ProfileSample[] } | null = null;
  for (const [k, list] of groups) {
    const depths = new Set(list.map((s) => Math.round(s.depthM * 10)));
    if (depths.size < 3) continue;
    const date = k.split('|')[0];
    if (!best || date > best.date || (date === best.date && list.length > best.list.length))
      best = { date, list };
  }
  if (!best) return null;
  const byDepth = new Map<number, number[]>();
  for (const s of best.list) {
    const d = Math.round(s.depthM * 10) / 10;
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(s.v);
  }
  const points = [...byDepth.entries()]
    .map(([depthM, v]) => ({ depthM, value: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => a.depthM - b.depthM);
  return { date: best.date, points };
}

/** Aggregate parsed samples into one ParameterSummary per characteristic that has data. */
export function summarize(parsed: ParsedRows): ParameterSummary[] {
  const out: ParameterSummary[] = [];
  for (const key of Object.keys(PARAMETERS) as ParameterKey[]) {
    const all = parsed.surface.get(key);
    if (!all?.length) continue;
    const sorted = [...all].sort((a, b) => (a.t === b.t ? 0 : a.t < b.t ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    const values = sorted.map((s) => s.v);
    const meta = PARAMETERS[key];
    const threshold = THRESHOLDS[key];
    const summary: ParameterSummary = {
      key,
      label: meta.label,
      unit: meta.unit,
      latest: { value: latest.v, date: latest.t, stationId: latest.stationId },
      median5y: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
      sampleCount: sorted.length,
      series: decimate(sorted, MAX_SERIES_POINTS).map((s) => ({ t: s.t, v: s.v })),
      status: evaluateStatus(latest.v, threshold),
    };
    if (threshold) summary.threshold = threshold;
    const byStation: Record<string, { value: number; date: string }> = {};
    for (const smp of sorted) byStation[smp.stationId] = { value: smp.v, date: smp.t };
    summary.latestByStation = byStation;
    const note = trophicNote(key, latest.v);
    if (note) summary.note = note;
    if (key === 'dissolved_oxygen' || key === 'water_temp') {
      const prof = pickDepthProfile(parsed.profile.get(key));
      if (prof) {
        summary.depthProfile = prof.points;
        summary.depthProfileDate = prof.date;
      }
    }
    out.push(summary);
  }
  return out;
}
