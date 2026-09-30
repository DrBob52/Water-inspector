import type { ParameterKey } from '@wi/shared';

/** The fixture clock: all demo timestamps are relative to this date. */
export const FIXTURE_NOW = '2026-09-30T00:00:00Z';
export const FIXTURE_LAST_SAMPLE = '2026-09-18';

export interface Variant {
  unit: string;
  mul?: number;
  add?: number;
  dp?: number;
}

export interface ParamSpec {
  key: ParameterKey;
  base: number; // canonical units: median (log) or mean
  amp?: number; // seasonal amplitude (canonical units); positive peaks at `peak`
  peak?: number; // day of year
  sd?: number; // noise: absolute sd, or sigma of ln when log
  log?: boolean;
  min?: number;
  max?: number;
  n?: number; // samples per station
  stations?: number[]; // which stations measure it (default all)
  nonDetect?: number; // share of non-detect rows
  summerOnly?: boolean;
  /** Force a few elevated samples (e.g. blooms): [count, multiplier]. */
  spikes?: [number, number];
  /** Force the most recent sample at the first station to this value (canonical units). */
  latest?: number;
}

export interface ProfileSpec {
  key: 'dissolved_oxygen' | 'water_temp';
  date: string;
  depths: number[];
  station: number;
  /** function parameters */
  surface: number;
  bottom: number;
  thermocline?: number;
  width?: number;
}

export interface SpeciesSpec {
  sci: string;
  count: number;
  last: number;
  intro?: boolean;
  /** For species not in the catalog. */
  extra?: { common: string; group: string; family: string; order: string; cls: string; kingdom?: string };
}

export interface ImpairSpec {
  aus: Array<{ id: string; name: string }>;
  cycle: string;
  uses: Array<[string, string]>;
  causes: Array<{ name: string; tmdl: boolean; status?: string }>;
}

export interface DemSpec {
  riseMPerKm: number;
  maxRiseM: number;
  noiseAmpM: number;
  noiseScaleKm: number;
  /** extra ridge on one side: bearing in degrees (0 = north), amplitude m */
  ridge?: { bearing: number; amp: number; width: number };
}

export interface WbSpec {
  slug: string;
  name: string;
  states: string;
  stateCode: string; // WQP StateCode, e.g. "US:50"
  huc8: string;
  kind: 'lake' | 'river';
  ftype: number;
  fcode: number;
  /** Lakes: outline vertices [lon, lat]. */
  ring?: Array<[number, number]>;
  /** Shrink the hand-drawn outline around its centre to match the real surface area. */
  scale?: [number, number];
  /** Rivers: centre line [lon, lat] and half width in metres. */
  centerline?: Array<[number, number]>;
  halfWidthM?: number;
  elevationM: number;
  /** Put the elevation attribute in the NHD record (otherwise null so the DEM fallback is exercised). */
  elevationInNhd: boolean;
  maxDepthM: number;
  meanDepthM: number;
  stations: Array<{ name: string; hint: [number, number] }>;
  outsideStation: { name: string; lon: number; lat: number };
  params: ParamSpec[];
  profiles: ProfileSpec[];
  species: SpeciesSpec[];
  impair: ImpairSpec;
  usgs?: Array<{ param: string; unit: string; value: number }>;
  dem: DemSpec;
  seed: number;
}

const ring = (pts: Array<[number, number]>) => pts;

// --- Lake Champlain ---------------------------------------------------------
const champlainWest: Array<[number, number]> = [
  [-73.41, 43.56], [-73.42, 43.66], [-73.4, 43.74], [-73.43, 43.84], [-73.44, 43.94], [-73.43, 44.03],
  [-73.4, 44.13], [-73.39, 44.23], [-73.4, 44.33], [-73.39, 44.43], [-73.42, 44.52], [-73.46, 44.63],
  [-73.44, 44.72], [-73.4, 44.82], [-73.37, 44.92], [-73.36, 45.01], [-73.25, 45.03],
];
const champlainEast: Array<[number, number]> = [
  [-73.12, 45.0], [-73.2, 44.92], [-73.24, 44.8], [-73.26, 44.68], [-73.25, 44.58], [-73.23, 44.48],
  [-73.26, 44.38], [-73.3, 44.28], [-73.31, 44.18], [-73.36, 44.08], [-73.4, 44.02], [-73.38, 43.93],
  [-73.36, 43.84], [-73.38, 43.75], [-73.37, 43.66], [-73.38, 43.57],
];

// --- Lake Tahoe ---------------------------------------------------------------
const tahoe: Array<[number, number]> = [
  [-120.15, 39.17], [-120.12, 39.22], [-120.05, 39.25], [-119.98, 39.24], [-119.93, 39.2], [-119.92, 39.13],
  [-119.93, 39.07], [-119.93, 39.0], [-119.95, 38.95], [-119.98, 38.93], [-120.03, 38.93], [-120.07, 38.93],
  [-120.1, 38.95], [-120.11, 39.0], [-120.13, 39.06], [-120.14, 39.12],
];

// --- Crater Lake: lobed caldera ring ---------------------------------------------
const crater: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const r = 1 + 0.12 * Math.sin(3 * a + 0.7) + 0.07 * Math.sin(5 * a + 2.1) + 0.04 * Math.sin(9 * a);
    // about 4.5 km mean radius
    out.push([-122.1 + (r * 4.6 * Math.cos(a)) / (111.32 * Math.cos((42.94 * Math.PI) / 180)), 42.94 + (r * 4.0 * Math.sin(a)) / 110.54]);
  }
  return out;
})();

// --- Western Lake Erie -----------------------------------------------------------
const erieWest: Array<[number, number]> = [
  [-83.48, 41.72], [-83.42, 41.68], [-83.27, 41.65], [-83.12, 41.55], [-82.95, 41.52], [-82.8, 41.47],
  [-82.68, 41.48], [-82.6, 41.6], [-82.55, 41.75], [-82.52, 41.93], [-82.65, 41.98], [-82.85, 41.96],
  [-83.05, 41.95], [-83.15, 42.02], [-83.22, 41.97], [-83.35, 41.92], [-83.45, 41.8],
];

// --- Onondaga Lake -----------------------------------------------------------------
const onondaga: Array<[number, number]> = [
  [-76.195, 43.065], [-76.18, 43.08], [-76.175, 43.095], [-76.19, 43.11], [-76.21, 43.125], [-76.23, 43.135],
  [-76.245, 43.13], [-76.235, 43.115], [-76.225, 43.1], [-76.215, 43.085], [-76.21, 43.07], [-76.2, 43.063],
];

// --- Potomac River, Washington DC reach ---------------------------------------------
const potomacLine: Array<[number, number]> = [
  [-77.118, 38.93], [-77.1, 38.918], [-77.085, 38.91], [-77.07, 38.903], [-77.063, 38.893], [-77.052, 38.878],
  [-77.04, 38.866], [-77.03, 38.85], [-77.035, 38.83], [-77.04, 38.805], [-77.038, 38.79],
];

/** Most samples fall in the warm season. */
const SUMMER = { peak: 215 };

export const WATERBODIES: WbSpec[] = [
  {
    slug: 'lake-champlain',
    name: 'Lake Champlain',
    states: 'VT/NY',
    stateCode: 'US:50',
    huc8: '04150408',
    kind: 'lake',
    ftype: 390,
    fcode: 39004,
    ring: ring([...champlainWest, ...champlainEast]),
    scale: [0.78, 1],
    elevationM: 29,
    elevationInNhd: false,
    maxDepthM: 122,
    meanDepthM: 19.5,
    stations: [
      { name: 'Main Lake, Burlington Bay (sample site)', hint: [-73.3, 44.47] },
      { name: 'Malletts Bay (sample site)', hint: [-73.28, 44.58] },
      { name: 'Missisquoi Bay (sample site)', hint: [-73.17, 44.99] },
      { name: 'South Lake (sample site)', hint: [-73.4, 43.75] },
    ],
    outsideStation: { name: 'Inland tributary gauge (sample site)', lon: -73.1, lat: 44.3 },
    params: [
      { key: 'water_temp', base: 12.5, amp: 11, ...SUMMER, sd: 1.3, min: 0.5, max: 26, n: 34 },
      { key: 'dissolved_oxygen', base: 10.2, amp: -1.8, ...SUMMER, sd: 0.6, min: 6, max: 14, n: 34 },
      { key: 'ph', base: 7.95, amp: 0.15, ...SUMMER, sd: 0.14, min: 7.2, max: 8.7, n: 30 },
      { key: 'turbidity', base: 2.6, sd: 0.45, log: true, min: 0.4, max: 25, n: 28 },
      { key: 'secchi_depth', base: 3.6, amp: -0.6, ...SUMMER, sd: 0.7, min: 1.1, max: 8, n: 24 },
      { key: 'specific_conductance', base: 205, sd: 18, min: 120, max: 320, n: 28 },
      { key: 'total_phosphorus', base: 0.017, sd: 0.4, log: true, min: 0.004, max: 0.11, n: 30 },
      { key: 'total_nitrogen', base: 0.48, sd: 0.25, log: true, min: 0.2, max: 1.4, n: 24 },
      { key: 'nitrate', base: 0.22, amp: -0.08, peak: 60, sd: 0.3, log: true, min: 0.02, max: 0.8, n: 20 },
      { key: 'chlorophyll_a', base: 4.6, amp: 2, ...SUMMER, sd: 0.45, log: true, min: 0.8, max: 38, n: 26 },
      { key: 'chloride', base: 14, sd: 2.4, min: 6, max: 26, n: 20 },
      { key: 'e_coli', base: 18, sd: 1.1, log: true, min: 1, max: 900, n: 22, summerOnly: true, stations: [0, 1] },
      { key: 'microcystins', base: 0.35, sd: 0.9, log: true, min: 0.1, max: 4, n: 10, summerOnly: true, stations: [2], nonDetect: 0.3 },
      { key: 'mercury', base: 0.0011, sd: 0.4, log: true, min: 0.0003, max: 0.004, n: 6, stations: [0] },
    ],
    profiles: [
      { key: 'water_temp', date: '2026-08-12', depths: [0.5, 2, 5, 8, 10, 12, 15, 20, 30, 40, 60, 80, 100], station: 0, surface: 23.4, bottom: 4.6, thermocline: 11, width: 3.2 },
      { key: 'dissolved_oxygen', date: '2026-08-12', depths: [0.5, 2, 5, 8, 10, 12, 15, 20, 30, 40, 60, 80, 100], station: 0, surface: 8.6, bottom: 7.1, thermocline: 14, width: 6 },
    ],
    species: [
      { sci: 'Perca flavescens', count: 2200, last: 2026 },
      { sci: 'Micropterus dolomieu', count: 1800, last: 2026 },
      { sci: 'Micropterus salmoides', count: 1500, last: 2026 },
      { sci: 'Esox lucius', count: 900, last: 2026 },
      { sci: 'Sander vitreus', count: 700, last: 2025 },
      { sci: 'Salvelinus namaycush', count: 650, last: 2026 },
      { sci: 'Salmo salar', count: 500, last: 2025 },
      { sci: 'Osmerus mordax', count: 380, last: 2025 },
      { sci: 'Petromyzon marinus', count: 300, last: 2025 },
      { sci: 'Lepomis gibbosus', count: 560, last: 2026 },
      { sci: 'Lepomis macrochirus', count: 340, last: 2026 },
      { sci: 'Ambloplites rupestris', count: 420, last: 2026 },
      { sci: 'Pomoxis nigromaculatus', count: 180, last: 2024 },
      { sci: 'Ameiurus nebulosus', count: 210, last: 2025 },
      { sci: 'Ictalurus punctatus', count: 90, last: 2023 },
      { sci: 'Catostomus commersonii', count: 230, last: 2025 },
      { sci: 'Amia calva', count: 150, last: 2024 },
      { sci: 'Lepisosteus osseus', count: 200, last: 2025 },
      { sci: 'Acipenser fulvescens', count: 120, last: 2024 },
      { sci: 'Anguilla rostrata', count: 140, last: 2024 },
      { sci: 'Lota lota', count: 70, last: 2023 },
      { sci: 'Cottus cognatus', count: 40, last: 2022 },
      { sci: 'Coregonus artedi', count: 30, last: 2020 },
      { sci: 'Fundulus diaphanus', count: 110, last: 2025 },
      { sci: 'Notropis hudsonius', count: 130, last: 2025 },
      { sci: 'Notropis atherinoides', count: 90, last: 2024 },
      { sci: 'Notemigonus crysoleucas', count: 140, last: 2025 },
      { sci: 'Morone americana', count: 260, last: 2025, intro: true },
      { sci: 'Alosa pseudoharengus', count: 120, last: 2024, intro: true },
      { sci: 'Cyprinus carpio', count: 160, last: 2025, intro: true },
      { sci: 'Chrysemys picta', count: 220, last: 2026 },
      { sci: 'Chelydra serpentina', count: 90, last: 2025 },
      { sci: 'Graptemys geographica', count: 60, last: 2024 },
      { sci: 'Lithobates catesbeianus', count: 180, last: 2026 },
      { sci: 'Lithobates clamitans', count: 140, last: 2026 },
      { sci: 'Faxonius rusticus', count: 160, last: 2025, intro: true },
      { sci: 'Dreissena polymorpha', count: 340, last: 2026, intro: true },
      { sci: 'Elliptio complanata', count: 70, last: 2023 },
      { sci: 'Lampsilis siliquoidea', count: 40, last: 2022 },
      { sci: 'Myriophyllum spicatum', count: 310, last: 2026, intro: true },
      { sci: 'Trapa natans', count: 280, last: 2026, intro: true },
      { sci: 'Potamogeton crispus', count: 150, last: 2025, intro: true },
      { sci: 'Vallisneria americana', count: 260, last: 2026 },
      { sci: 'Nymphaea odorata', count: 330, last: 2026 },
      { sci: 'Typha latifolia', count: 240, last: 2026 },
      { sci: 'Microcystis aeruginosa', count: 120, last: 2025 },
    ],
    impair: {
      aus: [
        { id: 'DEMO-VT-LC-MAIN', name: 'Lake Champlain, Main Lake (sample assessment unit)' },
        { id: 'DEMO-VT-LC-MISS', name: 'Lake Champlain, Missisquoi Bay (sample assessment unit)' },
      ],
      cycle: '2024',
      uses: [
        ['Swimming', 'Fully Supporting'],
        ['Fish Consumption', 'Not Supporting'],
        ['Aquatic Life', 'Not Supporting'],
        ['Drinking Water Supply', 'Fully Supporting'],
      ],
      causes: [
        { name: 'Phosphorus, Total', tmdl: true },
        { name: 'Mercury in Fish Tissue', tmdl: true },
        { name: 'Polychlorinated biphenyls (PCBs)', tmdl: false },
      ],
    },
    usgs: [
      { param: '00010', unit: 'degC', value: 16.8 },
      { param: '00300', unit: 'mg/l', value: 9.4 },
      { param: '00095', unit: 'uS/cm', value: 212 },
      { param: '63680', unit: 'FNU', value: 2.1 },
    ],
    dem: { riseMPerKm: 12, maxRiseM: 260, noiseAmpM: 35, noiseScaleKm: 6, ridge: { bearing: 90, amp: 500, width: 20 } },
    seed: 11,
  },
  {
    slug: 'lake-tahoe',
    name: 'Lake Tahoe',
    states: 'CA/NV',
    stateCode: 'US:06',
    huc8: '16050101',
    kind: 'lake',
    ftype: 390,
    fcode: 39004,
    ring: ring(tahoe),
    scale: [0.95, 0.95],
    elevationM: 1897,
    elevationInNhd: true,
    maxDepthM: 501,
    meanDepthM: 303,
    stations: [
      { name: 'Mid-lake (sample site)', hint: [-120.0, 39.1] },
      { name: 'Near shore, South Shore (sample site)', hint: [-120.0, 38.95] },
      { name: 'Near shore, North Shore (sample site)', hint: [-120.05, 39.2] },
    ],
    outsideStation: { name: 'Inland creek gauge (sample site)', lon: -120.25, lat: 39.05 },
    params: [
      { key: 'water_temp', base: 10.8, amp: 7, ...SUMMER, sd: 0.9, min: 3.5, max: 20.5, n: 30 },
      { key: 'dissolved_oxygen', base: 8.1, amp: -0.5, ...SUMMER, sd: 0.35, min: 6.5, max: 9.6, n: 30 },
      { key: 'ph', base: 8.0, sd: 0.12, min: 7.5, max: 8.5, n: 26 },
      { key: 'turbidity', base: 0.18, sd: 0.4, log: true, min: 0.05, max: 1.5, n: 26 },
      { key: 'secchi_depth', base: 22, amp: -3, ...SUMMER, sd: 2.4, min: 12, max: 34, n: 26 },
      { key: 'specific_conductance', base: 98, sd: 3, min: 88, max: 110, n: 24 },
      { key: 'total_phosphorus', base: 0.0032, sd: 0.3, log: true, min: 0.001, max: 0.012, n: 24 },
      { key: 'total_nitrogen', base: 0.085, sd: 0.3, log: true, min: 0.03, max: 0.25, n: 24 },
      { key: 'nitrate', base: 0.025, sd: 0.4, log: true, min: 0.005, max: 0.08, n: 20 },
      { key: 'chlorophyll_a', base: 0.32, sd: 0.4, log: true, min: 0.08, max: 1.4, n: 26 },
      { key: 'chloride', base: 1.1, sd: 0.2, min: 0.5, max: 2.2, n: 12 },
      { key: 'e_coli', base: 4, sd: 1.0, log: true, min: 1, max: 60, n: 18, summerOnly: true, stations: [1, 2] },
      { key: 'arsenic', base: 1.2, sd: 0.2, min: 0.6, max: 2.2, n: 8, stations: [0] },
    ],
    profiles: [
      { key: 'water_temp', date: '2026-08-20', depths: [0.5, 2, 5, 10, 15, 20, 30, 40, 60, 100, 150, 250, 400], station: 0, surface: 20.1, bottom: 4.0, thermocline: 18, width: 7 },
      { key: 'dissolved_oxygen', date: '2026-08-20', depths: [0.5, 2, 5, 10, 15, 20, 30, 40, 60, 100, 150, 250, 400], station: 0, surface: 7.9, bottom: 7.3, thermocline: 25, width: 25 },
    ],
    species: [
      { sci: 'Oncorhynchus nerka', count: 500, last: 2026, intro: true },
      { sci: 'Salvelinus namaycush', count: 420, last: 2026, intro: true },
      { sci: 'Oncorhynchus mykiss', count: 380, last: 2026, intro: true },
      { sci: 'Salmo trutta', count: 210, last: 2025, intro: true },
      { sci: 'Prosopium williamsoni', count: 90, last: 2025 },
      { sci: 'Oncorhynchus clarkii', count: 40, last: 2024 },
      { sci: 'Catostomus tahoensis', count: 300, last: 2026 },
      { sci: 'Richardsonius egregius', count: 280, last: 2026 },
      { sci: 'Siphateles bicolor', count: 60, last: 2024 },
      { sci: 'Micropterus salmoides', count: 350, last: 2026, intro: true },
      { sci: 'Micropterus dolomieu', count: 220, last: 2026, intro: true },
      { sci: 'Lepomis macrochirus', count: 260, last: 2026, intro: true },
      { sci: 'Pomoxis nigromaculatus', count: 40, last: 2022, intro: true },
      { sci: 'Ameiurus nebulosus', count: 100, last: 2025, intro: true },
      { sci: 'Cyprinus carpio', count: 30, last: 2023, intro: true },
      { sci: 'Notemigonus crysoleucas', count: 50, last: 2024, intro: true },
      { sci: 'Pacifastacus leniusculus', count: 400, last: 2026, intro: true },
      { sci: 'Corbicula fluminea', count: 240, last: 2025, intro: true },
      { sci: 'Lithobates catesbeianus', count: 70, last: 2025, intro: true },
      { sci: 'Trachemys scripta', count: 20, last: 2023, intro: true },
      { sci: 'Myriophyllum spicatum', count: 180, last: 2026, intro: true },
      { sci: 'Potamogeton crispus', count: 160, last: 2025, intro: true },
      { sci: 'Elodea canadensis', count: 90, last: 2024 },
      { sci: 'Stuckenia pectinata', count: 70, last: 2024 },
    ],
    impair: {
      aus: [{ id: 'DEMO-CA-LT-01', name: 'Lake Tahoe (sample assessment unit)' }],
      cycle: '2022',
      uses: [
        ['Swimming', 'Fully Supporting'],
        ['Fish Consumption', 'Insufficient Information'],
        ['Aquatic Life', 'Not Supporting'],
        ['Drinking Water Supply', 'Fully Supporting'],
      ],
      causes: [{ name: 'Non-native Aquatic Plants', tmdl: false }],
    },
    dem: { riseMPerKm: 140, maxRiseM: 900, noiseAmpM: 90, noiseScaleKm: 3.5, ridge: { bearing: 270, amp: 400, width: 12 } },
    seed: 23,
  },
  {
    slug: 'crater-lake',
    name: 'Crater Lake',
    states: 'OR',
    stateCode: 'US:41',
    huc8: '18010201',
    kind: 'lake',
    ftype: 390,
    fcode: 39004,
    ring: ring(crater),
    scale: [0.96, 0.96],
    elevationM: 1883,
    elevationInNhd: true,
    maxDepthM: 594,
    meanDepthM: 350,
    stations: [
      { name: 'Lake centre (sample site)', hint: [-122.1, 42.94] },
      { name: 'Wizard Island cove (sample site)', hint: [-122.15, 42.95] },
    ],
    outsideStation: { name: 'Rim spring (sample site)', lon: -122.06, lat: 42.99 },
    params: [
      { key: 'water_temp', base: 8.4, amp: 6, ...SUMMER, sd: 0.7, min: 3.5, max: 17, n: 18 },
      { key: 'dissolved_oxygen', base: 8.2, amp: -0.3, ...SUMMER, sd: 0.3, min: 7, max: 9.4, n: 18 },
      { key: 'ph', base: 7.8, sd: 0.1, min: 7.4, max: 8.2, n: 16 },
      { key: 'turbidity', base: 0.12, sd: 0.35, log: true, min: 0.03, max: 0.6, n: 16 },
      { key: 'secchi_depth', base: 33, amp: -2, ...SUMMER, sd: 3, min: 22, max: 44, n: 18 },
      { key: 'specific_conductance', base: 112, sd: 3, min: 104, max: 120, n: 16 },
      { key: 'total_phosphorus', base: 0.003, sd: 0.25, log: true, min: 0.001, max: 0.008, n: 14 },
      { key: 'nitrate', base: 0.03, sd: 0.4, log: true, min: 0.005, max: 0.09, n: 12 },
      { key: 'chlorophyll_a', base: 0.22, sd: 0.35, log: true, min: 0.05, max: 0.8, n: 16 },
      { key: 'chloride', base: 10.2, sd: 0.6, min: 8.5, max: 12, n: 10 },
    ],
    profiles: [],
    species: [
      { sci: 'Oncorhynchus nerka', count: 25, last: 2024, intro: true },
      { sci: 'Oncorhynchus mykiss', count: 35, last: 2024, intro: true },
      { sci: 'Pacifastacus leniusculus', count: 18, last: 2023, intro: true },
      { sci: 'Taricha granulosa', count: 60, last: 2025 },
    ],
    impair: {
      aus: [{ id: 'DEMO-OR-CL-01', name: 'Crater Lake (sample assessment unit)' }],
      cycle: '2022',
      uses: [
        ['Swimming', 'Fully Supporting'],
        ['Fish Consumption', 'Fully Supporting'],
        ['Aquatic Life', 'Fully Supporting'],
        ['Drinking Water Supply', 'Fully Supporting'],
      ],
      causes: [],
    },
    dem: { riseMPerKm: 260, maxRiseM: 420, noiseAmpM: 40, noiseScaleKm: 2.0 },
    seed: 37,
  },
  {
    slug: 'lake-erie-western-basin',
    name: 'Lake Erie (western basin)',
    states: 'OH/MI',
    stateCode: 'US:39',
    huc8: '04100010',
    kind: 'lake',
    ftype: 390,
    fcode: 39004,
    ring: ring(erieWest),
    elevationM: 174,
    elevationInNhd: true,
    maxDepthM: 19,
    meanDepthM: 7.4,
    stations: [
      { name: 'Maumee Bay (sample site)', hint: [-83.35, 41.72] },
      { name: 'Toledo water intake area (sample site)', hint: [-83.2, 41.72] },
      { name: 'Open water, basin centre (sample site)', hint: [-82.95, 41.75] },
      { name: 'Pelee Passage (sample site)', hint: [-82.7, 41.85] },
    ],
    outsideStation: { name: 'Inland river gauge (sample site)', lon: -83.6, lat: 41.55 },
    params: [
      { key: 'water_temp', base: 14.5, amp: 12.5, ...SUMMER, sd: 1.5, min: 0.3, max: 28, n: 34 },
      { key: 'dissolved_oxygen', base: 9.8, amp: -2.2, ...SUMMER, sd: 0.9, min: 4.5, max: 14, n: 34 },
      { key: 'ph', base: 8.35, amp: 0.3, ...SUMMER, sd: 0.22, min: 7.6, max: 9.3, n: 30 },
      { key: 'turbidity', base: 24, amp: 10, peak: 120, sd: 0.5, log: true, min: 4, max: 140, n: 30 },
      { key: 'secchi_depth', base: 0.75, amp: -0.15, ...SUMMER, sd: 0.25, min: 0.25, max: 2.4, n: 24 },
      { key: 'specific_conductance', base: 290, sd: 26, min: 220, max: 380, n: 28 },
      { key: 'total_phosphorus', base: 0.085, amp: 0.02, peak: 150, sd: 0.4, log: true, min: 0.02, max: 0.42, n: 30 },
      { key: 'total_nitrogen', base: 1.45, sd: 0.3, log: true, min: 0.5, max: 4.2, n: 26 },
      { key: 'nitrate', base: 0.85, amp: 0.6, peak: 130, sd: 0.4, log: true, min: 0.05, max: 3.6, n: 26 },
      { key: 'chlorophyll_a', base: 22, amp: 18, ...SUMMER, sd: 0.55, log: true, min: 2, max: 140, n: 34 },
      { key: 'chloride', base: 27, sd: 3.5, min: 16, max: 42, n: 22 },
      { key: 'microcystins', base: 1.4, amp: 1, peak: 225, sd: 1.0, log: true, min: 0.1, max: 28, n: 28, summerOnly: true, spikes: [3, 6], latest: 11.2 },
      { key: 'e_coli', base: 40, sd: 1.2, log: true, min: 1, max: 1400, n: 20, summerOnly: true, stations: [0, 1] },
      { key: 'atrazine', base: 0.18, amp: 0.25, peak: 160, sd: 0.7, log: true, min: 0.02, max: 1.6, n: 14, stations: [0, 1], nonDetect: 0.1 },
    ],
    profiles: [
      { key: 'water_temp', date: '2026-08-25', depths: [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], station: 2, surface: 25.3, bottom: 23.5, thermocline: 5, width: 4 },
      { key: 'dissolved_oxygen', date: '2026-08-25', depths: [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], station: 2, surface: 8.9, bottom: 3.2, thermocline: 6, width: 2 },
    ],
    species: [
      { sci: 'Perca flavescens', count: 2600, last: 2026 },
      { sci: 'Sander vitreus', count: 2400, last: 2026 },
      { sci: 'Micropterus dolomieu', count: 900, last: 2026 },
      { sci: 'Aplodinotus grunniens', count: 800, last: 2026 },
      { sci: 'Dorosoma cepedianum', count: 700, last: 2026 },
      { sci: 'Neogobius melanostomus', count: 650, last: 2026, intro: true },
      { sci: 'Micropterus salmoides', count: 600, last: 2026 },
      { sci: 'Morone chrysops', count: 500, last: 2025 },
      { sci: 'Notropis atherinoides', count: 450, last: 2025 },
      { sci: 'Ictalurus punctatus', count: 450, last: 2025 },
      { sci: 'Cyprinus carpio', count: 400, last: 2026, intro: true },
      { sci: 'Morone americana', count: 380, last: 2026, intro: true },
      { sci: 'Lepomis macrochirus', count: 200, last: 2025 },
      { sci: 'Pomoxis nigromaculatus', count: 120, last: 2024 },
      { sci: 'Esox lucius', count: 150, last: 2025 },
      { sci: 'Petromyzon marinus', count: 90, last: 2024 },
      { sci: 'Acipenser fulvescens', count: 60, last: 2024 },
      { sci: 'Osmerus mordax', count: 100, last: 2024 },
      { sci: 'Ctenopharyngodon idella', count: 40, last: 2025, intro: true },
      { sci: 'Graptemys geographica', count: 120, last: 2025 },
      { sci: 'Chelydra serpentina', count: 70, last: 2025 },
      { sci: 'Lithobates catesbeianus', count: 90, last: 2025 },
      { sci: 'Faxonius rusticus', count: 80, last: 2024, intro: true },
      { sci: 'Dreissena polymorpha', count: 300, last: 2026, intro: true },
      { sci: 'Dreissena bugensis', count: 260, last: 2026, intro: true },
      { sci: 'Myriophyllum spicatum', count: 110, last: 2025, intro: true },
      { sci: 'Potamogeton crispus', count: 90, last: 2025, intro: true },
      { sci: 'Vallisneria americana', count: 140, last: 2025 },
      { sci: 'Elodea canadensis', count: 60, last: 2024 },
      { sci: 'Microcystis aeruginosa', count: 420, last: 2026 },
      { sci: 'Dolichospermum flosaquae', count: 160, last: 2026 },
    ],
    impair: {
      aus: [{ id: 'DEMO-OH-LE-WB', name: 'Lake Erie, western basin (sample assessment unit)' }],
      cycle: '2024',
      uses: [
        ['Swimming', 'Not Supporting'],
        ['Fish Consumption', 'Not Supporting'],
        ['Aquatic Life', 'Not Supporting'],
        ['Drinking Water Supply', 'Not Supporting'],
      ],
      causes: [
        { name: 'Phosphorus, Total', tmdl: true },
        { name: 'Microcystins', tmdl: false },
        { name: 'Harmful Algal Blooms', tmdl: false },
        { name: 'Polychlorinated biphenyls (PCBs)', tmdl: false },
      ],
    },
    usgs: [
      { param: '00010', unit: 'degC', value: 21.7 },
      { param: '00300', unit: 'mg/l', value: 7.9 },
      { param: '63680', unit: 'FNU', value: 19 },
    ],
    dem: { riseMPerKm: 2.5, maxRiseM: 14, noiseAmpM: 2.5, noiseScaleKm: 7 },
    seed: 41,
  },
  {
    slug: 'onondaga-lake',
    name: 'Onondaga Lake',
    states: 'NY',
    stateCode: 'US:36',
    huc8: '04140202',
    kind: 'lake',
    ftype: 390,
    fcode: 39004,
    ring: ring(onondaga),
    scale: [0.72, 0.8],
    elevationM: 111,
    elevationInNhd: true,
    maxDepthM: 19.5,
    meanDepthM: 10.9,
    stations: [
      { name: 'South Basin (sample site)', hint: [-76.195, 43.085] },
      { name: 'North Basin (sample site)', hint: [-76.225, 43.12] },
    ],
    outsideStation: { name: 'Ninemile Creek gauge (sample site)', lon: -76.28, lat: 43.08 },
    params: [
      { key: 'water_temp', base: 13.5, amp: 12, ...SUMMER, sd: 1.4, min: 0.5, max: 27, n: 30 },
      { key: 'dissolved_oxygen', base: 9.5, amp: -1.6, ...SUMMER, sd: 0.8, min: 5.5, max: 13.5, n: 30 },
      { key: 'ph', base: 8.15, amp: 0.2, ...SUMMER, sd: 0.2, min: 7.3, max: 9.1, n: 28 },
      { key: 'turbidity', base: 3.5, sd: 0.5, log: true, min: 0.8, max: 30, n: 26 },
      { key: 'secchi_depth', base: 2.6, amp: -0.7, ...SUMMER, sd: 0.7, min: 0.8, max: 5.5, n: 26 },
      { key: 'specific_conductance', base: 2600, sd: 260, min: 1700, max: 3400, n: 28 },
      { key: 'total_phosphorus', base: 0.036, sd: 0.4, log: true, min: 0.01, max: 0.15, n: 28 },
      { key: 'total_nitrogen', base: 1.1, sd: 0.25, log: true, min: 0.5, max: 2.6, n: 24 },
      { key: 'nitrate', base: 0.45, amp: 0.3, peak: 60, sd: 0.4, log: true, min: 0.02, max: 1.8, n: 22 },
      { key: 'chlorophyll_a', base: 12, amp: 7, ...SUMMER, sd: 0.5, log: true, min: 1.5, max: 70, n: 28 },
      { key: 'chloride', base: 410, sd: 55, min: 250, max: 620, n: 26 },
      { key: 'mercury', base: 0.0042, sd: 0.5, log: true, min: 0.0008, max: 0.018, n: 10 },
      { key: 'pcbs', base: 0.35, sd: 0.6, log: true, min: 0.05, max: 2.4, n: 8, nonDetect: 0.25 },
      { key: 'e_coli', base: 35, sd: 1.1, log: true, min: 1, max: 800, n: 18, summerOnly: true, stations: [0] },
    ],
    profiles: [
      { key: 'water_temp', date: '2026-08-18', depths: [0.5, 2, 4, 6, 8, 10, 12, 14, 16, 18], station: 0, surface: 24.6, bottom: 9.2, thermocline: 8, width: 2 },
      { key: 'dissolved_oxygen', date: '2026-08-18', depths: [0.5, 2, 4, 6, 8, 10, 12, 14, 16, 18], station: 0, surface: 9.0, bottom: 0.3, thermocline: 8.5, width: 1.4 },
    ],
    species: [
      { sci: 'Micropterus salmoides', count: 600, last: 2026 },
      { sci: 'Lepomis macrochirus', count: 700, last: 2026 },
      { sci: 'Lepomis gibbosus', count: 350, last: 2026 },
      { sci: 'Perca flavescens', count: 420, last: 2026 },
      { sci: 'Pomoxis nigromaculatus', count: 200, last: 2025 },
      { sci: 'Sander vitreus', count: 300, last: 2025 },
      { sci: 'Cyprinus carpio', count: 500, last: 2026, intro: true },
      { sci: 'Dorosoma cepedianum', count: 350, last: 2026 },
      { sci: 'Alosa pseudoharengus', count: 300, last: 2025, intro: true },
      { sci: 'Morone americana', count: 250, last: 2025, intro: true },
      { sci: 'Ameiurus nebulosus', count: 200, last: 2025 },
      { sci: 'Ictalurus punctatus', count: 100, last: 2024 },
      { sci: 'Fundulus diaphanus', count: 140, last: 2025 },
      { sci: 'Notropis atherinoides', count: 100, last: 2024 },
      { sci: 'Notemigonus crysoleucas', count: 130, last: 2025 },
      { sci: 'Aplodinotus grunniens', count: 90, last: 2024 },
      { sci: 'Micropterus dolomieu', count: 120, last: 2025 },
      { sci: 'Esox lucius', count: 60, last: 2023 },
      { sci: 'Chelydra serpentina', count: 50, last: 2024 },
      { sci: 'Chrysemys picta', count: 80, last: 2025 },
      { sci: 'Dreissena polymorpha', count: 200, last: 2026, intro: true },
      { sci: 'Dreissena bugensis', count: 40, last: 2024, intro: true },
      { sci: 'Corbicula fluminea', count: 60, last: 2024, intro: true },
      { sci: 'Myriophyllum spicatum', count: 130, last: 2025, intro: true },
      { sci: 'Potamogeton crispus', count: 110, last: 2025, intro: true },
      { sci: 'Elodea canadensis', count: 70, last: 2024 },
      { sci: 'Microcystis aeruginosa', count: 90, last: 2025 },
    ],
    impair: {
      aus: [{ id: 'DEMO-NY-OL-01', name: 'Onondaga Lake (sample assessment unit)' }],
      cycle: '2024',
      uses: [
        ['Swimming', 'Not Supporting'],
        ['Fish Consumption', 'Not Supporting'],
        ['Aquatic Life', 'Not Supporting'],
        ['Drinking Water Supply', 'Not Assessed'],
      ],
      causes: [
        { name: 'Mercury in Fish Tissue', tmdl: true },
        { name: 'Polychlorinated biphenyls (PCBs)', tmdl: false },
        { name: 'Phosphorus, Total', tmdl: true },
        { name: 'Chloride (salinity)', tmdl: false },
        { name: 'Hexachlorobenzene', tmdl: false },
      ],
    },
    dem: { riseMPerKm: 18, maxRiseM: 110, noiseAmpM: 6, noiseScaleKm: 2.2 },
    seed: 53,
  },
  {
    slug: 'potomac-river-dc',
    name: 'Potomac River at Washington, DC',
    states: 'DC/VA/MD',
    stateCode: 'US:11',
    huc8: '02070008',
    kind: 'river',
    ftype: 460,
    fcode: 46006,
    centerline: potomacLine,
    halfWidthM: 420,
    elevationM: 1,
    elevationInNhd: false,
    maxDepthM: 7.5,
    meanDepthM: 4.2,
    stations: [
      { name: 'Chain Bridge reach (sample site)', hint: [-77.114, 38.927] },
      { name: 'Key Bridge, Georgetown (sample site)', hint: [-77.07, 38.903] },
      { name: 'Memorial Bridge (sample site)', hint: [-77.063, 38.893] },
      { name: 'Hains Point (sample site)', hint: [-77.032, 38.855] },
      { name: 'Woodrow Wilson Bridge (sample site)', hint: [-77.038, 38.791] },
    ],
    outsideStation: { name: 'Anacostia tributary gauge (sample site)', lon: -76.98, lat: 38.87 },
    params: [
      { key: 'water_temp', base: 15.5, amp: 13.5, ...SUMMER, sd: 1.4, min: 0.4, max: 31, n: 32 },
      { key: 'dissolved_oxygen', base: 9.4, amp: -2.4, ...SUMMER, sd: 0.9, min: 4.8, max: 14, n: 32 },
      { key: 'ph', base: 7.8, amp: 0.1, ...SUMMER, sd: 0.22, min: 6.9, max: 8.8, n: 30 },
      { key: 'turbidity', base: 18, sd: 0.7, log: true, min: 2, max: 300, n: 30 },
      { key: 'secchi_depth', base: 0.8, sd: 0.3, min: 0.25, max: 1.8, n: 22 },
      { key: 'specific_conductance', base: 360, sd: 60, min: 190, max: 620, n: 30 },
      { key: 'total_phosphorus', base: 0.07, sd: 0.5, log: true, min: 0.015, max: 0.45, n: 30 },
      { key: 'total_nitrogen', base: 1.7, sd: 0.3, log: true, min: 0.6, max: 4, n: 26 },
      { key: 'nitrate', base: 1.25, amp: 0.4, peak: 60, sd: 0.3, log: true, min: 0.2, max: 3.0, n: 26 },
      { key: 'chlorophyll_a', base: 9, amp: 6, ...SUMMER, sd: 0.6, log: true, min: 1, max: 60, n: 26 },
      { key: 'chloride', base: 48, amp: 14, peak: 40, sd: 12, min: 18, max: 110, n: 26 },
      { key: 'e_coli', base: 130, sd: 1.3, log: true, min: 5, max: 4800, n: 30, summerOnly: true },
      { key: 'enterococci', base: 32, sd: 1.2, log: true, min: 1, max: 900, n: 18, summerOnly: true, stations: [1, 2] },
      { key: 'pfos', base: 3.6, sd: 0.4, log: true, min: 0.8, max: 12, n: 12, stations: [0, 3] },
      { key: 'pfoa', base: 2.8, sd: 0.4, log: true, min: 0.7, max: 9, n: 12, stations: [0, 3] },
      { key: 'pfas_total', base: 17, sd: 0.4, log: true, min: 4, max: 60, n: 12, stations: [0, 3] },
      { key: 'atrazine', base: 0.12, amp: 0.15, peak: 150, sd: 0.6, log: true, min: 0.02, max: 0.9, n: 12, stations: [0, 4], nonDetect: 0.15 },
      { key: 'lead', base: 0.55, sd: 0.5, log: true, min: 0.08, max: 4, n: 10, stations: [1], nonDetect: 0.2 },
      { key: 'arsenic', base: 0.9, sd: 0.3, log: true, min: 0.3, max: 2.5, n: 10, stations: [1] },
    ],
    profiles: [],
    species: [
      { sci: 'Micropterus salmoides', count: 1800, last: 2026 },
      { sci: 'Ictalurus furcatus', count: 1100, last: 2026, intro: true },
      { sci: 'Ictalurus punctatus', count: 900, last: 2026 },
      { sci: 'Morone saxatilis', count: 700, last: 2026 },
      { sci: 'Lepomis macrochirus', count: 600, last: 2026 },
      { sci: 'Morone americana', count: 500, last: 2026 },
      { sci: 'Cyprinus carpio', count: 500, last: 2026, intro: true },
      { sci: 'Pylodictis olivaris', count: 300, last: 2026, intro: true },
      { sci: 'Alosa sapidissima', count: 280, last: 2026 },
      { sci: 'Alosa aestivalis', count: 140, last: 2024 },
      { sci: 'Alosa pseudoharengus', count: 180, last: 2025 },
      { sci: 'Anguilla rostrata', count: 200, last: 2025 },
      { sci: 'Acipenser oxyrinchus', count: 40, last: 2025 },
      { sci: 'Menidia menidia', count: 110, last: 2025 },
      { sci: 'Fundulus heteroclitus', count: 90, last: 2025 },
      { sci: 'Channa argus', count: 240, last: 2026, intro: true },
      { sci: 'Carpiodes cyprinus', count: 130, last: 2025, extra: { common: 'Quillback', group: 'fish', family: 'Catostomidae', order: 'Cypriniformes', cls: 'Actinopterygii' } },
      { sci: 'Petromyzon marinus', count: 20, last: 2022 },
      { sci: 'Callinectes sapidus', count: 300, last: 2026 },
      { sci: 'Eriocheir sinensis', count: 12, last: 2021, intro: true },
      { sci: 'Corbicula fluminea', count: 280, last: 2026, intro: true },
      { sci: 'Elliptio complanata', count: 150, last: 2025 },
      { sci: 'Trachemys scripta', count: 90, last: 2025, intro: true },
      { sci: 'Chelydra serpentina', count: 80, last: 2025 },
      { sci: 'Lithobates catesbeianus', count: 100, last: 2025 },
      { sci: 'Hydrilla verticillata', count: 260, last: 2026, intro: true },
      { sci: 'Vallisneria americana', count: 400, last: 2026 },
      { sci: 'Myriophyllum spicatum', count: 170, last: 2025, intro: true },
      { sci: 'Trapa natans', count: 70, last: 2024, intro: true },
      { sci: 'Tursiops truncatus', count: 14, last: 2024 },
      { sci: 'Trichechus manatus', count: 3, last: 2019 },
    ],
    impair: {
      aus: [{ id: 'DEMO-DC-PR-01', name: 'Potomac River, tidal reach (sample assessment unit)' }],
      cycle: '2024',
      uses: [
        ['Swimming', 'Not Supporting'],
        ['Fish Consumption', 'Not Supporting'],
        ['Aquatic Life', 'Not Supporting'],
        ['Drinking Water Supply', 'Insufficient Information'],
      ],
      causes: [
        { name: 'Escherichia coli (E. coli)', tmdl: true },
        { name: 'Polychlorinated biphenyls (PCBs)', tmdl: true },
        { name: 'Mercury in Fish Tissue', tmdl: false },
        { name: 'Total Suspended Solids (TSS)', tmdl: true },
        { name: 'Nitrogen, Total', tmdl: true },
      ],
    },
    usgs: [
      { param: '00010', unit: 'degC', value: 22.9 },
      { param: '00300', unit: 'mg/l', value: 8.3 },
      { param: '00095', unit: 'uS/cm', value: 341 },
      { param: '63680', unit: 'FNU', value: 14 },
    ],
    dem: { riseMPerKm: 22, maxRiseM: 90, noiseAmpM: 8, noiseScaleKm: 1.6, ridge: { bearing: 315, amp: 35, width: 6 } },
    seed: 67,
  },
];
