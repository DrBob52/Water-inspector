/**
 * Particle count for one pollutant: density proportional to ratio (value over threshold) on a log
 * scale, capped. Returns 0 only for a ratio of 0 (nothing is ever invented for missing data).
 */
export const MAX_POLLUTANT_PARTICLES = 600;
export const MIN_POLLUTANT_PARTICLES = 6;

export function particleCount(ratio: number): number {
  if (!(ratio > 0)) return 0;
  const n = Math.round(120 * (Math.log10(ratio) + 2.5));
  return Math.max(MIN_POLLUTANT_PARTICLES, Math.min(MAX_POLLUTANT_PARTICLES, n));
}

export const POLLUTANT_COLORS = [
  '#ff5d73',
  '#ffb703',
  '#3ddc97',
  '#4cc9f0',
  '#b388ff',
  '#ff8fab',
  '#c8f560',
  '#f4a261',
];
