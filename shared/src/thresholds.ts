import type { ParameterKey, ParameterStatus, ThresholdRef } from './types';

/**
 * Screening references used for colour coding only. They are not health or safety advice.
 * Values marked "verify" could not be confirmed from the build container.
 */
export const THRESHOLDS: Partial<Record<ParameterKey, ThresholdRef>> = {
  dissolved_oxygen: {
    label: 'Common aquatic-life guidance (minimum)',
    value: 5,
    unit: 'mg/L',
    direction: 'min',
    hardLimit: 2,
    citation: 'https://www.epa.gov/wqc/aquatic-life-criteria-and-methods-toxics',
    note: 'Watch below 5 mg/L, exceeds below 2 mg/L. State criteria vary.', // verify
  },
  ph: {
    label: 'EPA aquatic life criteria range',
    value: 6.5,
    rangeMax: 9.0,
    unit: 'pH',
    direction: 'range',
    citation:
      'https://www.epa.gov/wqc/national-recommended-water-quality-criteria-aquatic-life-criteria-table',
  },
  e_coli: {
    label: 'EPA 2012 recreational criterion (geometric mean)',
    value: 126,
    unit: 'CFU/100 mL',
    direction: 'max',
    citation: 'https://www.epa.gov/wqc/2012-recreational-water-quality-criteria',
  },
  enterococci: {
    label: 'EPA 2012 recreational criterion (geometric mean)',
    value: 35,
    unit: 'CFU/100 mL',
    direction: 'max',
    citation: 'https://www.epa.gov/wqc/2012-recreational-water-quality-criteria',
  },
  microcystins: {
    label: 'EPA 2019 recreational criterion',
    value: 8,
    unit: 'µg/L',
    direction: 'max',
    citation: 'https://www.epa.gov/cyanohabs/epa-drinking-water-health-advisories-cyanotoxins',
    note: 'EPA 2019 recommended recreational criteria for microcystins.', // verify
  },
  nitrate: {
    label: 'EPA drinking water MCL (as N)',
    value: 10,
    unit: 'mg/L',
    direction: 'max',
    citation:
      'https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations',
  },
  arsenic: {
    label: 'EPA drinking water MCL',
    value: 10,
    unit: 'µg/L',
    direction: 'max',
    citation:
      'https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations',
  },
  mercury: {
    label: 'EPA drinking water MCL (inorganic)',
    value: 2,
    unit: 'µg/L',
    direction: 'max',
    citation:
      'https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations',
  },
  lead: {
    label: 'EPA drinking water action level',
    value: 15,
    unit: 'µg/L',
    direction: 'max',
    citation:
      'https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations',
    note: 'The 2024 Lead and Copper Rule Improvements lower this to 10 µg/L on its compliance date.', // verify
  },
  pfoa: {
    label: 'EPA 2024 PFAS drinking water MCL',
    value: 4.0,
    unit: 'ng/L',
    direction: 'max',
    citation: 'https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas',
  },
  pfos: {
    label: 'EPA 2024 PFAS drinking water MCL',
    value: 4.0,
    unit: 'ng/L',
    direction: 'max',
    citation: 'https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas',
  },
  chloride: {
    label: 'EPA aquatic life chronic criterion',
    value: 230,
    unit: 'mg/L',
    direction: 'max',
    citation:
      'https://www.epa.gov/wqc/national-recommended-water-quality-criteria-aquatic-life-criteria-table',
  },
};

export const WATCH_FRACTION = 0.2;

/**
 * Status rule: good within the threshold, watch within 20% of the limit, exceeds beyond it,
 * no_reference when no threshold applies.
 */
export function evaluateStatus(value: number, t: ThresholdRef | undefined): ParameterStatus {
  if (!t || !Number.isFinite(value)) return 'no_reference';
  if (t.direction === 'max') {
    if (value > t.value) return 'exceeds';
    if (value >= t.value * (1 - WATCH_FRACTION)) return 'watch';
    return 'good';
  }
  if (t.direction === 'min') {
    const hard = t.hardLimit ?? t.value * (1 - WATCH_FRACTION);
    if (value < hard) return 'exceeds';
    if (value < t.value) return 'watch';
    return 'good';
  }
  const lo = t.value;
  const hi = t.rangeMax ?? t.value;
  if (value < lo || value > hi) return 'exceeds';
  const margin = (hi - lo) * WATCH_FRACTION;
  if (value < lo + margin || value > hi - margin) return 'watch';
  return 'good';
}

/** value / limit for pollutant particle density. For range/min thresholds returns null. */
export function thresholdRatio(value: number, t: ThresholdRef | undefined): number | null {
  if (!t || t.direction !== 'max' || t.value <= 0) return null;
  return value / t.value;
}

// Carlson trophic state index ------------------------------------------------

export type TrophicBand = 'oligotrophic' | 'mesotrophic' | 'eutrophic' | 'hypereutrophic';

export function trophicBand(tsi: number): TrophicBand {
  if (tsi < 40) return 'oligotrophic';
  if (tsi < 50) return 'mesotrophic';
  if (tsi < 70) return 'eutrophic';
  return 'hypereutrophic';
}

/** Carlson (1977). chlorophyll in µg/L, total phosphorus in µg/L, secchi in m. */
export const tsiChlorophyll = (chlUgL: number) => 9.81 * Math.log(chlUgL) + 30.6;
export const tsiPhosphorus = (tpUgL: number) => 14.42 * Math.log(tpUgL) + 4.15;
export const tsiSecchi = (secchiM: number) => 60 - 14.41 * Math.log(secchiM);

export function trophicNote(key: ParameterKey, latest: number): string | undefined {
  let tsi: number | undefined;
  let basis = '';
  if (key === 'chlorophyll_a' && latest > 0) {
    tsi = tsiChlorophyll(latest);
    basis = 'chlorophyll-a';
  } else if (key === 'total_phosphorus' && latest > 0) {
    tsi = tsiPhosphorus(latest * 1000);
    basis = 'total phosphorus';
  } else if (key === 'secchi_depth' && latest > 0) {
    tsi = tsiSecchi(latest);
    basis = 'Secchi depth';
  }
  if (tsi === undefined || !Number.isFinite(tsi)) return undefined;
  return `Carlson TSI ${Math.round(tsi)} (${trophicBand(tsi)}) from ${basis}. Reference only, not a legal criterion.`;
}
