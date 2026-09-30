import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS,
  evaluateStatus,
  thresholdRatio,
  trophicBand,
  trophicNote,
  tsiChlorophyll,
} from './thresholds';

describe('evaluateStatus', () => {
  it('max thresholds: good, watch within 20%, exceeds beyond', () => {
    const t = THRESHOLDS.e_coli;
    expect(evaluateStatus(50, t)).toBe('good');
    expect(evaluateStatus(101, t)).toBe('watch'); // >= 80% of 126
    expect(evaluateStatus(126, t)).toBe('watch');
    expect(evaluateStatus(127, t)).toBe('exceeds');
  });
  it('dissolved oxygen: watch below 5, exceeds below 2', () => {
    const t = THRESHOLDS.dissolved_oxygen;
    expect(evaluateStatus(8, t)).toBe('good');
    expect(evaluateStatus(5, t)).toBe('good');
    expect(evaluateStatus(3.5, t)).toBe('watch');
    expect(evaluateStatus(1.9, t)).toBe('exceeds');
  });
  it('pH range', () => {
    const t = THRESHOLDS.ph;
    expect(evaluateStatus(7.6, t)).toBe('good');
    expect(evaluateStatus(6.6, t)).toBe('watch');
    expect(evaluateStatus(8.9, t)).toBe('watch');
    expect(evaluateStatus(9.4, t)).toBe('exceeds');
    expect(evaluateStatus(6.0, t)).toBe('exceeds');
  });
  it('no_reference without a threshold', () => {
    expect(evaluateStatus(3, undefined)).toBe('no_reference');
    expect(THRESHOLDS.total_phosphorus).toBeUndefined();
  });
  it('carries citations for every threshold', () => {
    for (const t of Object.values(THRESHOLDS)) expect(t.citation).toMatch(/^https:\/\//);
  });
  it('PFOA/PFOS use 4 ng/L', () => {
    expect(THRESHOLDS.pfoa?.value).toBe(4);
    expect(THRESHOLDS.pfos?.unit).toBe('ng/L');
  });
});

describe('thresholdRatio', () => {
  it('is value over limit for max thresholds only', () => {
    expect(thresholdRatio(252, THRESHOLDS.e_coli)).toBe(2);
    expect(thresholdRatio(7, THRESHOLDS.dissolved_oxygen)).toBeNull();
    expect(thresholdRatio(1, undefined)).toBeNull();
  });
});

describe('trophic state', () => {
  it('bands', () => {
    expect(trophicBand(25)).toBe('oligotrophic');
    expect(trophicBand(45)).toBe('mesotrophic');
    expect(trophicBand(60)).toBe('eutrophic');
    expect(trophicBand(75)).toBe('hypereutrophic');
  });
  it('chlorophyll TSI of 1 ug/L is 30.6', () => {
    expect(tsiChlorophyll(1)).toBeCloseTo(30.6, 1);
  });
  it('notes are reference only', () => {
    expect(trophicNote('chlorophyll_a', 20)).toMatch(/eutrophic/);
    expect(trophicNote('ph', 7)).toBeUndefined();
  });
});
