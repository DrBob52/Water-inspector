import {
  thresholdRatio,
  type ParameterKey,
  type ParameterSummary,
  type SceneModel,
  type StationInfo,
} from '@wi/shared';

/**
 * Particle count for one pollutant: density proportional to ratio (value over threshold) on a log
 * scale, capped. Returns 0 only for a ratio of 0 (nothing is ever invented for missing data).
 */
export const MAX_POLLUTANT_PARTICLES = 600;
export const MIN_POLLUTANT_PARTICLES = 6;
/** Share of a full plume each monitoring site gets, so several sites do not swamp the lake. */
export const SITE_SHARE = 0.6;

export function particleCount(ratio: number): number {
  if (!(ratio > 0)) return 0;
  const n = Math.round(120 * (Math.log10(ratio) + 2.5));
  return Math.max(MIN_POLLUTANT_PARTICLES, Math.min(MAX_POLLUTANT_PARTICLES, n));
}

/**
 * Glow colours that read on a dark volume and stay clear of the cyan used for water. Stable per
 * pollutant, so the same substance has the same colour on every waterbody.
 */
export const POLLUTANT_COLOR_BY_KEY: Partial<Record<ParameterKey, string>> = {
  microcystins: '#6ef08c',
  e_coli: '#ffb44d',
  enterococci: '#ffe07a',
  nitrate: '#d2f25c',
  chloride: '#b6a1ff',
  mercury: '#ff6464',
  lead: '#ff9468',
  arsenic: '#ff5f9a',
  pfas_total: '#e48bff',
  pfos: '#ff7ad9',
  pfoa: '#a98bff',
  pcbs: '#ffa45c',
  atrazine: '#8ef0c8',
};
/** Fallback palette for anything not listed above. */
export const POLLUTANT_COLORS = [
  '#ff6f91',
  '#ffb44d',
  '#6ef08c',
  '#b6a1ff',
  '#ff7ad9',
  '#d2f25c',
  '#ff9468',
  '#e48bff',
];

export function pollutantColor(key: ParameterKey, index: number): string {
  return POLLUTANT_COLOR_BY_KEY[key] ?? POLLUTANT_COLORS[index % POLLUTANT_COLORS.length];
}

export interface PlumeSource {
  stationId: string;
  name: string;
  lon: number;
  lat: number;
  value: number;
  date: string;
  /** This site's latest value over the screening threshold. */
  ratio: number;
  count: number;
}

export interface PollutantLayer {
  key: ParameterKey;
  label: string;
  color: string;
  /** Latest value over threshold (the legend's ratio). */
  ratio: number;
  over: boolean;
  /** One plume per monitoring site that measured it. Empty: one diffuse lake-wide plume. */
  sources: PlumeSource[];
  /** Particles in the lake-wide plume when no site positions are known. */
  diffuseCount: number;
}

/**
 * The plumes for each measured pollutant: one per monitoring site with a reading of it, sized by
 * that site's own value over the threshold. Only sites with a real reading and a known position get
 * a plume; if none are known the latest value spreads thinly through the whole volume.
 */
export function pollutantLayers(
  model: SceneModel,
  quality: ParameterSummary[],
  stations: StationInfo[] = model.stations,
): PollutantLayer[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  return model.pollutants.map((p, i) => {
    const summary = quality.find((q) => q.key === p.key);
    const sources: PlumeSource[] = [];
    for (const [id, r] of Object.entries(summary?.latestByStation ?? {})) {
      const st = byId.get(id);
      const ratio = thresholdRatio(r.value, summary?.threshold);
      if (!st || ratio === null || !(ratio > 0)) continue;
      sources.push({
        stationId: id,
        name: st.name,
        lon: st.lon,
        lat: st.lat,
        value: r.value,
        date: r.date,
        ratio,
        count: Math.max(MIN_POLLUTANT_PARTICLES, Math.round(particleCount(ratio) * SITE_SHARE)),
      });
    }
    // Keep the total within the cap, trimming every plume in proportion.
    const total = sources.reduce((s, x) => s + x.count, 0);
    if (total > MAX_POLLUTANT_PARTICLES) {
      const k = MAX_POLLUTANT_PARTICLES / total;
      for (const s of sources) s.count = Math.max(MIN_POLLUTANT_PARTICLES, Math.floor(s.count * k));
    }
    sources.sort((a, b) => b.ratio - a.ratio);
    return {
      key: p.key,
      label: p.label,
      color: pollutantColor(p.key, i),
      ratio: p.ratio,
      over: p.ratio > 1,
      sources,
      diffuseCount: sources.length ? 0 : particleCount(p.ratio),
    };
  });
}

/** Glow strength for a plume: full above the threshold, dimmer the further below it. */
export function plumeIntensity(ratio: number): number {
  if (ratio > 1) return 1;
  const t = Math.max(0, Math.min(1, (Math.log10(Math.max(ratio, 1e-6)) + 2) / 2));
  return 0.28 + 0.4 * t;
}

/** Ratio bar position on a log axis from 0.01x to 100x (threshold at the middle). */
export function ratioBar(ratio: number): number {
  if (!(ratio > 0)) return 0;
  return Math.max(0, Math.min(1, (Math.log10(ratio) + 2) / 4));
}
