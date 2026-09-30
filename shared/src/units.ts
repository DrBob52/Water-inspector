import type { ParameterKey } from './types';
import { PARAMETERS } from './parameters';

/** Normalise a unit string: lower case, no spaces, ASCII micro sign. */
export function normalizeUnit(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/\s+/g, '')
    .replace(/°/g, 'deg')
    .replace(/³/g, '3')
    .replace(/\./g, '');
}

/** Factor that converts a mass-per-volume unit into mg/L, or null if not a known one. */
const MASS_CONC_TO_MG_L: Record<string, number> = {
  'mg/l': 1,
  'ug/l': 1e-3,
  'ng/l': 1e-6,
  'pg/l': 1e-9,
  'g/l': 1e3,
  ppm: 1,
  ppb: 1e-3,
  'mg/m3': 1e-3,
  'ug/m3': 1e-6,
  'ug/ml': 1,
  'mg/ml': 1e3,
  'ng/ml': 1e-3,
  'mg/kg': 1,
};

const TARGET_MASS_UNIT_TO_MG_L: Record<string, number> = {
  'mg/L': 1,
  'µg/L': 1e-3,
  'ng/L': 1e-6,
};

const TEMP_UNITS = new Set(['degc', 'c', 'degreec', 'degreesc']);
const TEMP_F = new Set(['degf', 'f', 'degreef', 'degreesf']);
const TEMP_K = new Set(['degk', 'k', 'kelvin']);
const LENGTH_TO_M: Record<string, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
  'ft/s': NaN,
};
const TURB_UNITS = new Set(['ntu', 'fnu', 'ftu', 'jtu', 'fnmu', 'ntru', 'fau', 'ntmu']);
const COND_TO_US_CM: Record<string, number> = {
  'us/cm': 1,
  'umho/cm': 1,
  'us/cm@25c': 1,
  'umho/cm@25c': 1,
  'ms/cm': 1000,
  'mmho/cm': 1000,
  's/m': 10000,
};
const COUNT_PER_100ML = new Set([
  'cfu/100ml',
  'mpn/100ml',
  '#/100ml',
  'count/100ml',
  'cfu/100',
  'mpn/100',
  'col/100ml',
  'colonies/100ml',
  'mpn/100ml(cfu)',
]);
const PH_UNITS = new Set(['stdunits', 'none', 'phunits', 'ph', 'su', 'stdunit', '']);
const SALINITY_UNITS = new Set(['psu', 'ppt', 'ppth', 'g/kg', 'pss', '0/00', 'pss-78']);

export interface Converted {
  value: number;
  unit: string;
}

/**
 * Convert a raw measurement into the canonical unit of a parameter. Returns null if the unit is
 * unknown or incompatible, so callers can drop the value instead of guessing.
 */
export function convertToCanonical(
  key: ParameterKey,
  value: number,
  rawUnit: string | null | undefined,
): Converted | null {
  if (!Number.isFinite(value)) return null;
  const target = PARAMETERS[key].unit;
  const u = normalizeUnit(rawUnit);
  switch (key) {
    case 'water_temp':
      if (TEMP_UNITS.has(u)) return { value, unit: target };
      if (TEMP_F.has(u)) return { value: ((value - 32) * 5) / 9, unit: target };
      if (TEMP_K.has(u)) return { value: value - 273.15, unit: target };
      return null;
    case 'ph':
      return PH_UNITS.has(u) ? { value, unit: target } : null;
    case 'turbidity':
      return TURB_UNITS.has(u) ? { value, unit: target } : null;
    case 'secchi_depth': {
      const f = LENGTH_TO_M[u];
      return f && Number.isFinite(f) ? { value: value * f, unit: target } : null;
    }
    case 'specific_conductance': {
      const f = COND_TO_US_CM[u];
      return f ? { value: value * f, unit: target } : null;
    }
    case 'e_coli':
    case 'enterococci':
      if (COUNT_PER_100ML.has(u)) return { value, unit: target };
      if (u === 'cfu/ml' || u === 'mpn/ml') return { value: value * 100, unit: target };
      return null;
    case 'salinity':
      return SALINITY_UNITS.has(u) ? { value, unit: target } : null;
    default: {
      const from = MASS_CONC_TO_MG_L[u];
      const to = TARGET_MASS_UNIT_TO_MG_L[target];
      if (from === undefined || to === undefined) return null;
      return { value: (value * from) / to, unit: target };
    }
  }
}

// Display conversions ---------------------------------------------------------

export type UnitSystem = 'metric' | 'imperial';

const M_PER_FT = 0.3048;
const KM2_PER_MI2 = 2.589988;
const KM_PER_MI = 1.609344;
const MCM_PER_ACRE_FT = 0.001233482;

export const mToFt = (m: number) => m / M_PER_FT;
export const cToF = (c: number) => (c * 9) / 5 + 32;

export function formatLength(m: number, sys: UnitSystem): string {
  if (sys === 'imperial') {
    const ft = mToFt(m);
    return ft >= 5280
      ? `${(ft / 5280).toFixed(1)} mi`
      : `${Math.round(ft).toLocaleString('en-US')} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m >= 100 ? Math.round(m) : m.toFixed(1)} m`;
}

export function formatDepth(m: number, sys: UnitSystem): string {
  if (sys === 'imperial') return `${mToFt(m).toFixed(m < 30 ? 1 : 0)} ft`;
  return `${m.toFixed(m < 30 ? 1 : 0)} m`;
}

export function formatArea(km2: number, sys: UnitSystem): string {
  if (sys === 'imperial') return `${(km2 / KM2_PER_MI2).toFixed(km2 < 10 ? 2 : 1)} mi²`;
  return `${km2.toFixed(km2 < 10 ? 2 : 1)} km²`;
}

export function formatDistanceKm(km: number, sys: UnitSystem): string {
  if (sys === 'imperial') return `${(km / KM_PER_MI).toFixed(1)} mi`;
  return `${km.toFixed(1)} km`;
}

export function formatVolume(mcm: number, sys: UnitSystem): string {
  if (sys === 'imperial') {
    const acreFt = mcm / MCM_PER_ACRE_FT / 1e6;
    return acreFt >= 1e6
      ? `${(acreFt / 1e6).toFixed(1)} million acre-ft`
      : `${Math.round(acreFt).toLocaleString('en-US')} acre-ft`;
  }
  return mcm >= 1000
    ? `${(mcm / 1000).toFixed(1)} km³`
    : `${mcm.toFixed(mcm < 10 ? 2 : 0)} million m³`;
}

export function formatTemp(c: number, sys: UnitSystem): string {
  return sys === 'imperial' ? `${cToF(c).toFixed(0)} °F` : `${c.toFixed(1)} °C`;
}
