import { describe, expect, it } from 'vitest';
import { MAX_POLLUTANT_PARTICLES, MIN_POLLUTANT_PARTICLES, particleCount } from './density';

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
