import type { ParameterKey } from './types';

export interface ParameterMeta {
  key: ParameterKey;
  label: string;
  /** Canonical unit every value is converted to. */
  unit: string;
  /** Decimals to show. */
  decimals: number;
  /** Is this a contaminant for the pollutant view? */
  pollutant: boolean;
}

export const PARAMETERS: Record<ParameterKey, ParameterMeta> = {
  water_temp: {
    key: 'water_temp',
    label: 'Water temperature',
    unit: '°C',
    decimals: 1,
    pollutant: false,
  },
  dissolved_oxygen: {
    key: 'dissolved_oxygen',
    label: 'Dissolved oxygen',
    unit: 'mg/L',
    decimals: 1,
    pollutant: false,
  },
  ph: { key: 'ph', label: 'pH', unit: 'pH', decimals: 2, pollutant: false },
  turbidity: { key: 'turbidity', label: 'Turbidity', unit: 'NTU', decimals: 1, pollutant: false },
  secchi_depth: {
    key: 'secchi_depth',
    label: 'Secchi depth',
    unit: 'm',
    decimals: 1,
    pollutant: false,
  },
  specific_conductance: {
    key: 'specific_conductance',
    label: 'Specific conductance',
    unit: 'µS/cm',
    decimals: 0,
    pollutant: false,
  },
  total_phosphorus: {
    key: 'total_phosphorus',
    label: 'Total phosphorus',
    unit: 'mg/L',
    decimals: 3,
    pollutant: false,
  },
  total_nitrogen: {
    key: 'total_nitrogen',
    label: 'Total nitrogen',
    unit: 'mg/L',
    decimals: 2,
    pollutant: false,
  },
  nitrate: { key: 'nitrate', label: 'Nitrate (as N)', unit: 'mg/L', decimals: 2, pollutant: true },
  chlorophyll_a: {
    key: 'chlorophyll_a',
    label: 'Chlorophyll-a',
    unit: 'µg/L',
    decimals: 1,
    pollutant: false,
  },
  microcystins: {
    key: 'microcystins',
    label: 'Microcystins',
    unit: 'µg/L',
    decimals: 2,
    pollutant: true,
  },
  e_coli: { key: 'e_coli', label: 'E. coli', unit: 'CFU/100 mL', decimals: 0, pollutant: true },
  enterococci: {
    key: 'enterococci',
    label: 'Enterococci',
    unit: 'CFU/100 mL',
    decimals: 0,
    pollutant: true,
  },
  mercury: { key: 'mercury', label: 'Mercury (total)', unit: 'µg/L', decimals: 4, pollutant: true },
  lead: { key: 'lead', label: 'Lead', unit: 'µg/L', decimals: 2, pollutant: true },
  arsenic: { key: 'arsenic', label: 'Arsenic', unit: 'µg/L', decimals: 2, pollutant: true },
  pfas_total: {
    key: 'pfas_total',
    label: 'PFAS (total)',
    unit: 'ng/L',
    decimals: 1,
    pollutant: true,
  },
  pfos: { key: 'pfos', label: 'PFOS', unit: 'ng/L', decimals: 1, pollutant: true },
  pfoa: { key: 'pfoa', label: 'PFOA', unit: 'ng/L', decimals: 1, pollutant: true },
  pcbs: { key: 'pcbs', label: 'PCBs (total)', unit: 'ng/L', decimals: 2, pollutant: true },
  atrazine: { key: 'atrazine', label: 'Atrazine', unit: 'µg/L', decimals: 2, pollutant: true },
  chloride: { key: 'chloride', label: 'Chloride', unit: 'mg/L', decimals: 0, pollutant: true },
  salinity: { key: 'salinity', label: 'Salinity', unit: 'PSU', decimals: 1, pollutant: false },
};

export const PARAMETER_KEYS = Object.keys(PARAMETERS) as ParameterKey[];

export function formatValue(key: ParameterKey, v: number): string {
  const d = PARAMETERS[key].decimals;
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return v.toFixed(d);
}
