import { describe, expect, it } from 'vitest';
import { convertToCanonical, formatArea, formatDepth, mToFt, cToF } from './units';

describe('convertToCanonical', () => {
  it('converts temperature from °F and K', () => {
    expect(convertToCanonical('water_temp', 68, 'deg F')?.value).toBeCloseTo(20, 5);
    expect(convertToCanonical('water_temp', 293.15, 'deg K')?.value).toBeCloseTo(20, 5);
    expect(convertToCanonical('water_temp', 12, 'deg C')).toEqual({ value: 12, unit: '°C' });
  });
  it('converts mass concentrations between mg/L, µg/L and ng/L', () => {
    expect(convertToCanonical('total_phosphorus', 25, 'ug/l')?.value).toBeCloseTo(0.025, 6);
    expect(convertToCanonical('mercury', 5, 'ng/L')?.value).toBeCloseTo(0.005, 9);
    expect(convertToCanonical('mercury', 0.002, 'mg/L')?.value).toBeCloseTo(2, 9);
    expect(convertToCanonical('pfos', 0.004, 'ug/L')?.value).toBeCloseTo(4, 9);
    expect(convertToCanonical('chloride', 1, 'g/L')?.value).toBe(1000);
    expect(convertToCanonical('chlorophyll_a', 3, 'mg/m3')?.value).toBeCloseTo(3, 9);
    expect(convertToCanonical('dissolved_oxygen', 9, 'ppm')?.value).toBe(9);
  });
  it('accepts the Greek mu and µ signs', () => {
    expect(convertToCanonical('microcystins', 2, 'µg/L')?.value).toBe(2);
    expect(convertToCanonical('microcystins', 2, 'μg/L')?.value).toBe(2);
    expect(convertToCanonical('microcystins', 2000, 'ng/L')?.value).toBe(2);
  });
  it('converts lengths to metres for Secchi depth', () => {
    expect(convertToCanonical('secchi_depth', 10, 'ft')?.value).toBeCloseTo(3.048, 5);
    expect(convertToCanonical('secchi_depth', 150, 'cm')?.value).toBeCloseTo(1.5, 9);
  });
  it('converts conductance and counts', () => {
    expect(convertToCanonical('specific_conductance', 0.25, 'mS/cm')?.value).toBe(250);
    expect(convertToCanonical('e_coli', 20, 'MPN/100mL')?.value).toBe(20);
    expect(convertToCanonical('e_coli', 0.5, 'cfu/mL')?.value).toBe(50);
  });
  it('treats NTU, FNU and FTU as equal for turbidity', () => {
    expect(convertToCanonical('turbidity', 4, 'FNU')?.value).toBe(4);
    expect(convertToCanonical('turbidity', 4, 'NTU')?.value).toBe(4);
  });
  it('returns null for unknown or incompatible units', () => {
    expect(convertToCanonical('mercury', 5, 'mg/kg dry wt')).toBeNull();
    expect(convertToCanonical('water_temp', 5, 'furlongs')).toBeNull();
    expect(convertToCanonical('e_coli', 5, 'mg/L')).toBeNull();
    expect(convertToCanonical('mercury', Number.NaN, 'ug/L')).toBeNull();
  });
});

describe('display helpers', () => {
  it('feet and Fahrenheit', () => {
    expect(mToFt(304.8)).toBeCloseTo(1000, 6);
    expect(cToF(100)).toBe(212);
  });
  it('formats depth and area per system', () => {
    expect(formatDepth(122, 'metric')).toBe('122 m');
    expect(formatDepth(10, 'imperial')).toBe('32.8 ft');
    expect(formatArea(1130, 'metric')).toBe('1,130 km²');
    expect(formatArea(509.26, 'metric')).toBe('509.3 km²');
    expect(formatArea(5.4, 'metric')).toBe('5.40 km²');
    expect(formatArea(2.59, 'imperial')).toMatch(/mi²/);
  });
});
