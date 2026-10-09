/**
 * Generates the demo fixtures under /fixtures. Everything here is illustrative sample data,
 * not live measurements. Every emitted file carries "_demo": true.
 *
 * Run with: npm run fixtures
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  area as turfArea,
  bbox as turfBbox,
  buffer as turfBuffer,
  centroid as turfCentroid,
  length as turfLength,
  lineString,
  simplify,
  polygon as turfPolygon,
} from '@turf/turf';
import type { Feature, LineString, Polygon } from 'geojson';
import {
  PARAMETERS,
  SPECIES_CATALOG,
  blockBbox,
  ccwRing,
  distToRing,
  findCatalogEntry,
  makeProjection,
  pointInRing,
  type ParameterKey,
  type Ring,
} from '@wi/shared';
import {
  FIXTURE_LAST_SAMPLE,
  WATERBODIES,
  type ParamSpec,
  type Variant,
  type WbSpec,
} from './fixtures/specs';
import {
  dayOfYear,
  gauss,
  hashString,
  isoDate,
  makeNoise,
  mulberry32,
  smoothstep,
  type Rng,
} from './fixtures/util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function write(path: string, data: unknown) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  const body =
    typeof data === 'object' && data !== null ? { _demo: true, ...(data as object) } : data;
  writeFileSync(full, JSON.stringify(body) + '\n');
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

interface Geo {
  polygon: Polygon;
  ring: Ring; // exterior, lon/lat
  line?: LineString;
  bbox: [number, number, number, number];
  centroid: [number, number];
  areaKm2: number;
}

interface GeoData {
  surfaceElevationM: number;
  ring: Ring;
  dem: { bbox: number[]; width: number; height: number; elevations: number[] };
}

/** Real outline and elevation grid traced by scripts/fetch-geodata.ts, when present. */
function loadGeoData(slug: string): GeoData | null {
  const path = `scripts/fixtures/geodata/${slug}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as GeoData) : null;
}

function buildGeo(wb: WbSpec): Geo {
  let polygon: Polygon;
  let line: LineString | undefined;
  const real = loadGeoData(wb.slug);
  if (real) {
    polygon = { type: 'Polygon', coordinates: [ccwRing(real.ring)] };
    if (wb.kind === 'river') line = { type: 'LineString', coordinates: wb.centerline! };
  } else if (wb.kind === 'lake' && wb.ring) {
    let pts = wb.ring;
    if (wb.scale) {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      pts = pts.map(
        ([x, y]) =>
          [cx + (x - cx) * wb.scale![0], cy + (y - cy) * wb.scale![1]] as [number, number],
      );
    }
    polygon = { type: 'Polygon', coordinates: [ccwRing(pts)] };
  } else {
    line = { type: 'LineString', coordinates: wb.centerline! };
    const buf = turfBuffer(lineString(wb.centerline!), (wb.halfWidthM ?? 300) / 1000, {
      units: 'kilometers',
      steps: 4,
    })!;
    const simp = simplify(buf, { tolerance: 0.00008, highQuality: true });
    polygon = {
      type: 'Polygon',
      coordinates: [ccwRing((simp.geometry as Polygon).coordinates[0])],
    };
  }
  const feat = turfPolygon(polygon.coordinates);
  const c = turfCentroid(feat).geometry.coordinates as [number, number];
  return {
    polygon,
    ring: polygon.coordinates[0] as Ring,
    line,
    bbox: turfBbox(feat) as [number, number, number, number],
    centroid: c,
    areaKm2: turfArea(feat) / 1e6,
  };
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const roundCoords = (c: unknown): unknown =>
  Array.isArray(c)
    ? typeof c[0] === 'number'
      ? c.map((v) => r5(v as number))
      : c.map(roundCoords)
    : c;
const roundGeom = <T extends { coordinates: unknown }>(g: T): T => ({
  ...g,
  coordinates: roundCoords(g.coordinates),
});

function randomInside(
  rng: Rng,
  ring: Ring,
  hint: [number, number],
  bbox: number[],
): [number, number] {
  for (let rad = 0.004; rad < 0.5; rad *= 1.3) {
    for (let i = 0; i < 60; i++) {
      const x = hint[0] + (rng() - 0.5) * 2 * rad;
      const y = hint[1] + (rng() - 0.5) * 2 * rad;
      if (pointInRing(x, y, ring)) return [r5(x), r5(y)];
    }
  }
  return [r5((bbox[0] + bbox[2]) / 2), r5((bbox[1] + bbox[3]) / 2)];
}

// ---------------------------------------------------------------------------------------------
// Water quality
// ---------------------------------------------------------------------------------------------

const CHAR: Record<ParameterKey, { name: string; fraction?: string; variants: Variant[] }> = {
  water_temp: {
    name: 'Temperature, water',
    variants: [
      { unit: 'deg C', dp: 1 },
      { unit: 'deg F', mul: 1.8, add: 32, dp: 1 },
    ],
  },
  dissolved_oxygen: { name: 'Dissolved oxygen (DO)', variants: [{ unit: 'mg/l', dp: 2 }] },
  ph: { name: 'pH', variants: [{ unit: 'std units', dp: 2 }] },
  turbidity: {
    name: 'Turbidity',
    variants: [
      { unit: 'NTU', dp: 2 },
      { unit: 'FNU', dp: 2 },
    ],
  },
  secchi_depth: {
    name: 'Depth, Secchi disk depth',
    variants: [
      { unit: 'm', dp: 2 },
      { unit: 'ft', mul: 3.28084, dp: 1 },
    ],
  },
  specific_conductance: { name: 'Specific conductance', variants: [{ unit: 'uS/cm', dp: 0 }] },
  total_phosphorus: {
    name: 'Phosphorus',
    fraction: 'Total',
    variants: [
      { unit: 'mg/l', dp: 4 },
      { unit: 'ug/l', mul: 1000, dp: 1 },
    ],
  },
  total_nitrogen: { name: 'Nitrogen', fraction: 'Total', variants: [{ unit: 'mg/l', dp: 3 }] },
  nitrate: { name: 'Nitrate', fraction: 'Dissolved', variants: [{ unit: 'mg/l', dp: 3 }] },
  chlorophyll_a: {
    name: 'Chlorophyll a',
    variants: [
      { unit: 'ug/l', dp: 2 },
      { unit: 'mg/m3', dp: 2 },
    ],
  },
  microcystins: {
    name: 'Microcystin',
    fraction: 'Total',
    variants: [
      { unit: 'ug/l', dp: 2 },
      { unit: 'ng/l', mul: 1000, dp: 0 },
    ],
  },
  e_coli: {
    name: 'Escherichia coli',
    variants: [
      { unit: 'cfu/100mL', dp: 0 },
      { unit: 'MPN/100mL', dp: 0 },
    ],
  },
  enterococci: { name: 'Enterococcus', variants: [{ unit: 'cfu/100mL', dp: 0 }] },
  mercury: {
    name: 'Mercury',
    fraction: 'Total',
    variants: [
      { unit: 'ng/l', mul: 1000, dp: 2 },
      { unit: 'ug/l', dp: 4 },
    ],
  },
  lead: { name: 'Lead', fraction: 'Total', variants: [{ unit: 'ug/l', dp: 2 }] },
  arsenic: { name: 'Arsenic', fraction: 'Total', variants: [{ unit: 'ug/l', dp: 2 }] },
  pfas_total: { name: 'Total PFAS', variants: [{ unit: 'ng/l', dp: 1 }] },
  pfos: { name: 'Perfluorooctanesulfonic acid', variants: [{ unit: 'ng/l', dp: 2 }] },
  pfoa: { name: 'Perfluorooctanoic acid', variants: [{ unit: 'ng/l', dp: 2 }] },
  pcbs: {
    name: 'Polychlorinated Biphenyls (PCBs)',
    fraction: 'Total',
    variants: [{ unit: 'ng/l', dp: 2 }],
  },
  atrazine: { name: 'Atrazine', variants: [{ unit: 'ug/l', dp: 3 }] },
  chloride: { name: 'Chloride', variants: [{ unit: 'mg/l', dp: 1 }] },
  salinity: { name: 'Salinity', variants: [{ unit: 'PSU', dp: 1 }] },
};

const CSV_COLUMNS = [
  'OrganizationIdentifier',
  'OrganizationFormalName',
  'ActivityIdentifier',
  'ActivityTypeCode',
  'ActivityMediaName',
  'ActivityStartDate',
  'ActivityDepthHeightMeasure/MeasureValue',
  'ActivityDepthHeightMeasure/MeasureUnitCode',
  'MonitoringLocationIdentifier',
  'ResultIdentifier',
  'ResultDetectionConditionText',
  'CharacteristicName',
  'ResultSampleFractionText',
  'ResultMeasureValue',
  'ResultMeasure/MeasureUnitCode',
  'ResultStatusIdentifier',
  'DetectionQuantitationLimitMeasure/MeasureValue',
  'DetectionQuantitationLimitMeasure/MeasureUnitCode',
];

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ORG_ID = 'DEMO';
const ORG_NAME = 'Illustrative sample data (demo)';

function sampleDates(rng: Rng, n: number, summerOnly: boolean): Date[] {
  const start = Date.UTC(2021, 9, 1);
  const end = Date.parse(FIXTURE_LAST_SAMPLE + 'T12:00:00Z');
  const out: Date[] = [];
  while (out.length < n - 1) {
    const d = new Date(start + rng() * (end - start));
    const m = d.getUTCMonth();
    const inSummer = m >= 5 && m <= 8;
    const inShoulder = m === 4 || m === 9;
    const accept = summerOnly ? inSummer : inSummer ? 0.95 : inShoulder ? 0.6 : 0.22;
    if (summerOnly ? inSummer : rng() < (accept as number)) {
      d.setUTCHours(10 + Math.floor(rng() * 5), 0, 0, 0);
      out.push(d);
    }
  }
  // Always one recent late-summer sample so "latest" is current.
  out.push(
    new Date(Date.UTC(2026, 7 + Math.floor(rng() * 2), 6 + Math.floor(rng() * 12), 11, 0, 0)),
  );
  return out.sort((a, b) => a.getTime() - b.getTime());
}

function generateValue(rng: Rng, p: ParamSpec, d: Date): number {
  const season = p.amp ? Math.cos((2 * Math.PI * (dayOfYear(d) - (p.peak ?? 200))) / 365) : 0;
  const mean = p.base + (p.amp ?? 0) * season;
  let v: number;
  if (p.log) v = Math.exp(Math.log(Math.max(mean, 1e-9)) + (p.sd ?? 0.3) * gauss(rng));
  else v = mean + (p.sd ?? 0) * gauss(rng);
  if (p.min !== undefined) v = Math.max(p.min, v);
  if (p.max !== undefined) v = Math.min(p.max, v);
  return v;
}

function logistic(z: number, surface: number, bottom: number, zth: number, width: number) {
  return bottom + (surface - bottom) / (1 + Math.exp((z - zth) / width));
}

function buildResultsCsv(wb: WbSpec, stationIds: string[], rng: Rng): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  let rid = 1;
  const push = (o: Record<string, string | number | undefined>) => {
    rows.push(CSV_COLUMNS.map((c) => csvCell(o[c])).join(','));
  };
  const fmt = (v: number, dp: number) => v.toFixed(dp);
  const stationIdx = (p: ParamSpec) => p.stations ?? stationIds.map((_, i) => i);

  for (const p of wb.params) {
    const ch = CHAR[p.key];
    for (const si of stationIdx(p)) {
      if (si >= stationIds.length) continue;
      const variant = ch.variants[si % ch.variants.length];
      const dates = sampleDates(rng, p.n ?? 20, !!p.summerOnly);
      const spikeIdx = new Set<number>();
      if (p.spikes)
        for (let k = 0; k < p.spikes[0]; k++) spikeIdx.add(Math.floor(rng() * dates.length));
      dates.forEach((d, di) => {
        let canon = generateValue(rng, p, d);
        if (p.latest !== undefined && si === stationIdx(p)[0] && di === dates.length - 1)
          canon = p.latest;
        if (spikeIdx.has(di)) canon = Math.min(p.max ?? canon * p.spikes![1], canon * p.spikes![1]);
        const forcedLatest =
          p.latest !== undefined && si === stationIdx(p)[0] && di === dates.length - 1;
        const sampleDate = forcedLatest ? new Date(Date.UTC(2026, 8, 19, 11)) : d;
        const nonDetect = p.nonDetect !== undefined && rng() < p.nonDetect;
        const raw = canon * (variant.mul ?? 1) + (variant.add ?? 0);
        const depth = rng() < 0.85 ? '0.5' : '';
        const aid = `${ORG_ID}-${wb.slug}-${stationIds[si].split('-').pop()}-${isoDate(sampleDate).replace(/-/g, '')}`;
        push({
          OrganizationIdentifier: ORG_ID,
          OrganizationFormalName: ORG_NAME,
          ActivityIdentifier: aid,
          ActivityTypeCode: 'Sample-Routine',
          ActivityMediaName: 'Water',
          ActivityStartDate: isoDate(sampleDate),
          'ActivityDepthHeightMeasure/MeasureValue': depth,
          'ActivityDepthHeightMeasure/MeasureUnitCode': depth ? 'm' : '',
          MonitoringLocationIdentifier: stationIds[si],
          ResultIdentifier: `${ORG_ID}-${rid++}`,
          ResultDetectionConditionText: nonDetect ? 'Not Detected' : '',
          CharacteristicName: ch.name,
          ResultSampleFractionText: ch.fraction ?? '',
          ResultMeasureValue: nonDetect ? '' : fmt(raw, variant.dp ?? 2),
          'ResultMeasure/MeasureUnitCode': variant.unit,
          ResultStatusIdentifier: 'Final',
          'DetectionQuantitationLimitMeasure/MeasureValue': nonDetect
            ? fmt(Math.max(p.min ?? 0, canon * 0.3) * (variant.mul ?? 1), variant.dp ?? 2)
            : '',
          'DetectionQuantitationLimitMeasure/MeasureUnitCode': nonDetect ? variant.unit : '',
        });
      });
    }
  }

  // Depth profiles (one station, one day): dissolved oxygen and temperature by depth.
  for (const pr of wb.profiles) {
    const ch = CHAR[pr.key];
    const variant = ch.variants[0];
    for (const z of pr.depths) {
      const v =
        logistic(z, pr.surface, pr.bottom, pr.thermocline ?? 10, pr.width ?? 3) +
        (pr.key === 'dissolved_oxygen' ? 0.05 * gauss(rng) : 0.05 * gauss(rng));
      push({
        OrganizationIdentifier: ORG_ID,
        OrganizationFormalName: ORG_NAME,
        ActivityIdentifier: `${ORG_ID}-${wb.slug}-profile-${pr.date.replace(/-/g, '')}-${z}`,
        ActivityTypeCode: 'Field Msr/Obs-Portable Data Logger',
        ActivityMediaName: 'Water',
        ActivityStartDate: pr.date,
        'ActivityDepthHeightMeasure/MeasureValue': z,
        'ActivityDepthHeightMeasure/MeasureUnitCode': 'm',
        MonitoringLocationIdentifier: stationIds[pr.station],
        ResultIdentifier: `${ORG_ID}-${rid++}`,
        CharacteristicName: ch.name,
        ResultMeasureValue: v.toFixed(2),
        'ResultMeasure/MeasureUnitCode': variant.unit,
        ResultStatusIdentifier: 'Final',
      });
    }
  }

  // Rows the normalizer must ignore: other characteristics, sediment, rejected, unknown unit.
  const base = {
    OrganizationIdentifier: ORG_ID,
    OrganizationFormalName: ORG_NAME,
    ActivityTypeCode: 'Sample-Routine',
    ActivityStartDate: '2026-08-05',
    MonitoringLocationIdentifier: stationIds[0],
  };
  push({
    ...base,
    ActivityIdentifier: 'ignored-1',
    ActivityMediaName: 'Water',
    ResultIdentifier: `${ORG_ID}-${rid++}`,
    CharacteristicName: 'Calcium',
    ResultSampleFractionText: 'Total',
    ResultMeasureValue: '21',
    'ResultMeasure/MeasureUnitCode': 'mg/l',
    ResultStatusIdentifier: 'Final',
  });
  push({
    ...base,
    ActivityIdentifier: 'ignored-2',
    ActivityMediaName: 'Sediment',
    ResultIdentifier: `${ORG_ID}-${rid++}`,
    CharacteristicName: 'Mercury',
    ResultSampleFractionText: 'Total',
    ResultMeasureValue: '120',
    'ResultMeasure/MeasureUnitCode': 'ug/kg',
    ResultStatusIdentifier: 'Final',
  });
  push({
    ...base,
    ActivityIdentifier: 'ignored-3',
    ActivityMediaName: 'Water',
    ResultIdentifier: `${ORG_ID}-${rid++}`,
    CharacteristicName: 'Dissolved oxygen (DO)',
    ResultMeasureValue: '0.1',
    'ResultMeasure/MeasureUnitCode': 'mg/l',
    ResultStatusIdentifier: 'Rejected',
  });
  push({
    ...base,
    ActivityIdentifier: 'ignored-4',
    ActivityMediaName: 'Water',
    ResultIdentifier: `${ORG_ID}-${rid++}`,
    CharacteristicName: 'Temperature, water',
    ResultMeasureValue: '17',
    'ResultMeasure/MeasureUnitCode': 'furlongs',
    ResultStatusIdentifier: 'Final',
  });
  return rows.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Life
// ---------------------------------------------------------------------------------------------

const GROUP_CLASS: Record<
  string,
  { cls: string; order?: string; kingdom: string; phylum?: string }
> = {
  fish: { cls: 'Actinopterygii', kingdom: 'Animalia', phylum: 'Chordata' },
  lamprey: {
    cls: 'Petromyzonti',
    order: 'Petromyzontiformes',
    kingdom: 'Animalia',
    phylum: 'Chordata',
  },
  turtle: { cls: 'Testudines', order: 'Testudines', kingdom: 'Animalia', phylum: 'Chordata' },
  amphibian: { cls: 'Amphibia', kingdom: 'Animalia', phylum: 'Chordata' },
  crustacean: { cls: 'Malacostraca', order: 'Decapoda', kingdom: 'Animalia', phylum: 'Arthropoda' },
  mollusc: { cls: 'Bivalvia', kingdom: 'Animalia', phylum: 'Mollusca' },
  mammal: { cls: 'Mammalia', kingdom: 'Animalia', phylum: 'Chordata' },
  plant: { cls: 'Magnoliopsida', kingdom: 'Plantae', phylum: 'Tracheophyta' },
  cyanobacteria: { cls: 'Cyanophyceae', kingdom: 'Bacteria', phylum: 'Cyanobacteria' },
};

const FAMILY_ORDER: Record<string, string> = {
  Centrarchidae: 'Centrarchiformes',
  Percidae: 'Perciformes',
  Esocidae: 'Esociformes',
  Salmonidae: 'Salmoniformes',
  Osmeridae: 'Osmeriformes',
  Ictaluridae: 'Siluriformes',
  Cyprinidae: 'Cypriniformes',
  Leuciscidae: 'Cypriniformes',
  Catostomidae: 'Cypriniformes',
  Lepisosteidae: 'Lepisosteiformes',
  Amiidae: 'Amiiformes',
  Acipenseridae: 'Acipenseriformes',
  Clupeidae: 'Clupeiformes',
  Anguillidae: 'Anguilliformes',
  Moronidae: 'Moroniformes',
  Sciaenidae: 'Acanthuriformes',
  Gobiidae: 'Gobiiformes',
  Cottidae: 'Scorpaeniformes',
  Lotidae: 'Gadiformes',
  Fundulidae: 'Cyprinodontiformes',
  Atherinopsidae: 'Atheriniformes',
  Cambaridae: 'Decapoda',
  Astacidae: 'Decapoda',
  Portunidae: 'Decapoda',
  Varunidae: 'Decapoda',
};

const GBIF_GROUPS = [
  'fish',
  'lamprey',
  'turtle',
  'amphibian',
  'crustacean',
  'mollusc',
  'mammal',
  'plant',
  'cyanobacteria',
];

/** Stable synthetic GBIF-style key. These are NOT real GBIF keys. */
function syntheticKey(sci: string): number {
  return 9_000_000 + (hashString(sci) % 900_000);
}

const GASTROPODS = new Set(['Potamopyrgus antipodarum', 'Bithynia tentaculata']);

function buildLife(wb: WbSpec) {
  const facets: Record<string, unknown> = {};
  const speciesDetail: Record<string, unknown> = {};
  const vernacular: Record<string, unknown> = {};
  const years: Record<string, unknown> = {};
  const byGroup: Record<string, Array<{ name: string; count: number }>> = {};
  const nas: unknown[] = [];

  for (const s of wb.species) {
    const cat = findCatalogEntry(s.sci);
    const group = s.extra?.group ?? cat?.group ?? 'other';
    const gc = GROUP_CLASS[group] ?? GROUP_CLASS.fish;
    const key = syntheticKey(s.sci);
    const family = s.extra?.family ?? cat?.family ?? 'Unknown';
    const [genus, species] = s.sci.split(' ');
    const cls = s.extra?.cls ?? (GASTROPODS.has(s.sci) ? 'Gastropoda' : gc.cls);
    const order = s.extra?.order ?? gc.order ?? FAMILY_ORDER[family];
    (byGroup[group] ??= []).push({ name: String(key), count: s.count });
    speciesDetail[String(key)] = {
      key,
      scientificName: s.sci,
      canonicalName: s.sci,
      rank: 'SPECIES',
      taxonomicStatus: 'ACCEPTED',
      kingdom: gc.kingdom,
      phylum: gc.phylum,
      class: cls,
      order,
      family,
      genus,
      species: s.sci,
      ...(cat ? { vernacularName: cat.commonName } : {}),
    };
    if (!cat && s.extra) {
      vernacular[String(key)] = {
        offset: 0,
        limit: 20,
        endOfRecords: true,
        results: [
          { vernacularName: s.extra.common, language: 'eng', source: 'demo' },
          { vernacularName: 'Serpent-tête', language: 'fra', source: 'demo' },
        ],
      };
    }
    const span = 2026 - s.last;
    years[String(key)] = {
      offset: 0,
      limit: 0,
      endOfRecords: false,
      count: s.count,
      results: [],
      facets: [
        {
          field: 'YEAR',
          counts: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2015]
            .filter((y) => y <= s.last)
            .map((y, i) => ({
              name: String(y),
              count: Math.max(1, Math.round(s.count / (3 + i * 2) / (1 + span))),
            })),
        },
      ],
    };
    if (s.intro) {
      nas.push({
        speciesID: 1000 + (hashString(s.sci) % 9000),
        scientificName: s.sci,
        genus,
        species,
        commonName: cat?.commonName ?? s.extra?.common ?? s.sci,
        group:
          group === 'fish'
            ? 'Fishes'
            : group === 'plant'
              ? 'Plants'
              : group === 'mollusc'
                ? 'Mollusks-Bivalves'
                : group === 'crustacean'
                  ? 'Crustaceans-Decapods'
                  : 'Other',
        status: 'established',
        huc8: wb.huc8,
        state: wb.states.split('/')[0],
        year: 1990 + (hashString(s.sci) % 30),
      });
    }
  }
  for (const g of GBIF_GROUPS) {
    const counts = (byGroup[g] ?? []).sort((a, b) => b.count - a.count);
    facets[g] = {
      offset: 0,
      limit: 0,
      endOfRecords: false,
      count: counts.reduce((s, c) => s + c.count, 0),
      results: [],
      facets: counts.length ? [{ field: 'SPECIES_KEY', counts }] : [],
    };
  }
  return { facets, speciesDetail, vernacular, years, nas };
}

// ---------------------------------------------------------------------------------------------
// ATTAINS
// ---------------------------------------------------------------------------------------------

const USE_CODE: Record<string, string> = {
  'Fully Supporting': 'F',
  'Not Supporting': 'N',
  'Insufficient Information': 'I',
  'Not Assessed': 'X',
};

function buildAttains(wb: WbSpec) {
  const geo = {
    type: 'FeatureCollection',
    features: wb.impair.aus.map((au, i) => ({
      type: 'Feature',
      id: i + 1,
      geometry: null,
      properties: {
        assessmentunitid: au.id,
        assessmentunitname: au.name,
        organizationid: ORG_ID,
        reportingcycle: wb.impair.cycle,
        waterbodyreportlink: `https://mywaterway.epa.gov/waterbody-report/${ORG_ID}/${au.id}/${wb.impair.cycle}`,
      },
    })),
  };
  const assessments = {
    items: [
      {
        organizationIdentifier: ORG_ID,
        organizationName: ORG_NAME,
        organizationTypeText: 'State',
        reportingCycleText: wb.impair.cycle,
        assessments: wb.impair.aus.map((au) => ({
          assessmentUnitIdentifier: au.id,
          assessmentUnitName: au.name,
          cycleLastAssessedText: wb.impair.cycle,
          agencyCode: 'S',
          useAttainments: wb.impair.uses.map(([useName, status]) => ({
            useName,
            useAttainmentCodeName: status,
            useAttainmentCode: USE_CODE[status] ?? 'X',
          })),
          parameters: wb.impair.causes.map((c) => ({
            parameterName: c.name.toUpperCase(),
            parameterStatusName: c.status ?? 'Cause',
            associatedUses: wb.impair.uses
              .filter(([, st]) => st === 'Not Supporting')
              .map(([u]) => ({ associatedUseName: u, parameterAttainmentCode: 'N' })),
            associatedActions: c.tmdl
              ? [
                  {
                    associatedActionIdentifier: `DEMO-TMDL-${hashString(c.name) % 1000}`,
                    associatedActionAgency: 'S',
                    associatedActionType: 'TMDL',
                  },
                ]
              : [],
          })),
        })),
      },
    ],
  };
  return { geo, assessments };
}

// ---------------------------------------------------------------------------------------------
// DEM
// ---------------------------------------------------------------------------------------------

function buildDem(wb: WbSpec, geo: Geo) {
  const real = loadGeoData(wb.slug);
  if (real) return real.dem;
  const bb = blockBbox(geo.bbox, 2000);
  const proj = makeProjection(geo.centroid);
  const [x0, y0] = proj.toLocal(bb[0], bb[1]);
  const [x1, y1] = proj.toLocal(bb[2], bb[3]);
  const wM = x1 - x0;
  const hM = y1 - y0;
  const MAX = 128;
  const width = wM >= hM ? MAX : Math.max(16, Math.round((MAX * wM) / hM));
  const height = hM > wM ? MAX : Math.max(16, Math.round((MAX * hM) / wM));
  const noise = makeNoise(wb.seed * 1013);
  const ringLocal: Ring = geo.ring.map(([lon, lat]) => proj.toLocal(lon, lat));
  const d = wb.dem;
  const elev: number[] = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = x0 + ((i + 0.5) / width) * wM;
      const y = y1 - ((j + 0.5) / height) * hM;
      const inside = pointInRing(x, y, ringLocal);
      let e = wb.elevationM;
      if (!inside) {
        const km = distToRing(x, y, ringLocal) / 1000;
        const base = Math.min(d.maxRiseM, d.riseMPerKm * Math.pow(km, 0.95));
        const n = (noise(x / (d.noiseScaleKm * 1000), y / (d.noiseScaleKm * 1000)) - 0.5) * 2;
        e += base * smoothstep(0, 0.35, km) + d.noiseAmpM * n * smoothstep(0.1, 1.2, km);
        if (d.ridge) {
          const b = (d.ridge.bearing * Math.PI) / 180;
          const p = (x * Math.sin(b) + y * Math.cos(b)) / 1000;
          e +=
            d.ridge.amp * smoothstep(d.ridge.width * 0.25, d.ridge.width, p + d.ridge.width * 0.5);
        }
        e = Math.max(wb.elevationM + 0.3, e);
      }
      elev.push(Math.round(e * 10) / 10);
    }
  }
  return { bbox: bb.map((v) => Math.round(v * 1e6) / 1e6), width, height, elevations: elev };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const depthIndex: unknown[] = [];
const demoList: unknown[] = [];
const nominatim: unknown[] = [];

WATERBODIES.forEach((wb, wbIdx) => {
  const real = loadGeoData(wb.slug);
  if (real) wb.elevationM = Math.round(real.surfaceElevationM * 10) / 10;
  const rng = mulberry32(wb.seed * 7919 + hashString(wb.slug));
  const geo = buildGeo(wb);
  const id = `demo-${wb.slug}`;
  const areaKm2 = geo.areaKm2;
  const lengthKm = geo.line
    ? turfLength(lineString(geo.line.coordinates), { units: 'kilometers' })
    : undefined;
  const dir = wb.slug;

  // NHD (raw ArcGIS f=geojson shape; property names are lower case as configured in server/src/config.ts)
  const commonProps = {
    permanent_identifier: id,
    gnis_name: wb.name,
    states: wb.states,
    huc8: wb.huc8,
    ftype: wb.ftype,
    fcode: wb.fcode,
    reachcode: `${wb.huc8}${String(100000 + wbIdx).slice(1)}`.slice(0, 14),
    fdate: '2026-01-15T00:00:00Z',
  };
  const empty = { type: 'FeatureCollection', features: [] };
  if (wb.kind === 'lake') {
    write(`${dir}/nhd-waterbody.json`, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: wbIdx + 1,
          geometry: roundGeom(geo.polygon),
          properties: {
            ...commonProps,
            areasqkm: Math.round(areaKm2 * 100) / 100,
            elevation: wb.elevationInNhd ? wb.elevationM : null,
          },
        },
      ],
    });
    write(`${dir}/nhd-area.json`, empty);
    write(`${dir}/nhd-flowline.json`, empty);
  } else {
    write(`${dir}/nhd-waterbody.json`, empty);
    write(`${dir}/nhd-area.json`, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 1,
          geometry: roundGeom(geo.polygon),
          properties: { ...commonProps, areasqkm: Math.round(areaKm2 * 100) / 100 },
        },
      ],
    });
    write(`${dir}/nhd-flowline.json`, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 1,
          geometry: roundGeom(geo.line!),
          properties: {
            ...commonProps,
            permanent_identifier: `${id}-flowline`,
            lengthkm: Math.round((lengthKm ?? 0) * 100) / 100,
            ftype: 460,
            fcode: 46006,
          },
        },
      ],
    });
  }

  // Stations
  const stationIds: string[] = [];
  const stationFeatures: Feature[] = [];
  wb.stations.forEach((s, i) => {
    const [lon, lat] = randomInside(rng, geo.ring, s.hint, geo.bbox);
    const sid = `${ORG_ID}-${wb.stateCode.split(':')[1]}-${String(i + 1).padStart(4, '0')}`;
    stationIds.push(sid);
    stationFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        OrganizationIdentifier: ORG_ID,
        OrganizationFormalName: ORG_NAME,
        MonitoringLocationIdentifier: sid,
        MonitoringLocationName: s.name,
        MonitoringLocationTypeName:
          wb.kind === 'lake' ? 'Lake, Reservoir, Impoundment' : 'River/Stream',
        HUCEightDigitCode: wb.huc8,
        StateCode: wb.stateCode,
        ProviderName: 'DEMO',
      },
    });
  });
  const o = wb.outsideStation;
  stationFeatures.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
    properties: {
      OrganizationIdentifier: ORG_ID,
      OrganizationFormalName: ORG_NAME,
      MonitoringLocationIdentifier: `${ORG_ID}-${wb.stateCode.split(':')[1]}-9999`,
      MonitoringLocationName: o.name,
      MonitoringLocationTypeName: 'Stream',
      HUCEightDigitCode: wb.huc8,
      StateCode: wb.stateCode,
      ProviderName: 'DEMO',
    },
  });
  write(`${dir}/wqp-station.json`, { type: 'FeatureCollection', features: stationFeatures });
  write(`${dir}/wqp-result.json`, { _format: 'csv', body: buildResultsCsv(wb, stationIds, rng) });

  // USGS near-real-time
  if (wb.usgs) {
    const sp = stationFeatures[0].geometry as { coordinates: number[] };
    write(`${dir}/usgs-latest.json`, {
      type: 'FeatureCollection',
      features: wb.usgs.map((u, i) => ({
        type: 'Feature',
        id: `demo-latest-${i}`,
        geometry: { type: 'Point', coordinates: sp.coordinates },
        properties: {
          monitoring_location_id: `${ORG_ID}-RT-${String(wbIdx + 1).padStart(3, '0')}`,
          parameter_code: u.param,
          statistic_id: '00011',
          time: '2026-09-29T23:45:00+00:00',
          value: String(u.value),
          unit_of_measure: u.unit,
          approval_status: 'Provisional',
        },
      })),
      numberReturned: wb.usgs.length,
    });
  } else {
    write(`${dir}/usgs-latest.json`, {
      type: 'FeatureCollection',
      features: [],
      numberReturned: 0,
    });
  }

  // Impairments
  const att = buildAttains(wb);
  write(`${dir}/attains-geo.json`, att.geo);
  write(`${dir}/attains-assessments.json`, att.assessments);

  // Life
  const life = buildLife(wb);
  write(`${dir}/gbif-facets.json`, { groups: life.facets });
  write(`${dir}/gbif-species.json`, { species: life.speciesDetail, vernacular: life.vernacular });
  write(`${dir}/gbif-years.json`, { species: life.years });
  write(`${dir}/nas.json`, { count: life.nas.length, results: life.nas });

  // DEM
  write(`${dir}/dem.json`, buildDem(wb, geo));

  // Index entries (lakes only; HydroLAKES does not cover rivers)
  if (wb.kind === 'lake') {
    depthIndex.push({
      hylak_id: 900001 + wbIdx,
      name: wb.name,
      lon: r5(geo.centroid[0]),
      lat: r5(geo.centroid[1]),
      area_km2: Math.round(areaKm2 * 100) / 100,
      depth_avg_m: wb.meanDepthM,
      depth_max_m: wb.maxDepthM,
      vol_mcm: Math.round(areaKm2 * wb.meanDepthM),
    });
  }
  demoList.push({
    slug: wb.slug,
    id: `nhd:${id}`,
    name: wb.name,
    centroid: [r5(geo.centroid[0]), r5(geo.centroid[1])],
    bbox: geo.bbox.map(r5),
  });
  nominatim.push({
    place_id: 7_000_000 + wbIdx,
    osm_type: 'relation',
    osm_id: 9_000_000 + wbIdx,
    lat: String(r5(geo.centroid[1])),
    lon: String(r5(geo.centroid[0])),
    display_name: `${wb.name}, ${wb.states} (demo)`,
    name: wb.name,
    type: wb.kind === 'lake' ? 'water' : 'river',
    boundingbox: [geo.bbox[1], geo.bbox[3], geo.bbox[0], geo.bbox[2]].map((v) => String(r5(v))),
    _slug: wb.slug,
  });
  console.log(`${wb.slug}: area ${areaKm2.toFixed(1)} km2, ${wb.species.length} species`);
});

// Shared (non-waterbody) fixtures
write('lake-depth-index.sample.json', {
  note: 'Demo lakes only. Built by hand from the demo outlines, not from HydroLAKES.',
  lakes: depthIndex,
});
write('_demo-waterbodies.json', { waterbodies: demoList });

write('_shared/nhd-layers.json', {
  currentVersion: 10.91,
  serviceDescription: 'National Hydrography Dataset (demo copy of the service description)',
  layers: [
    { id: 0, name: 'Non-Network Flowline', parentLayerId: -1, subLayerIds: null },
    { id: 4, name: 'Flowline - Large Scale', parentLayerId: -1, subLayerIds: null },
    { id: 9, name: 'Area', parentLayerId: -1, subLayerIds: null },
    { id: 10, name: 'Waterbody', parentLayerId: -1, subLayerIds: null },
  ],
});
write('_shared/attains-layers.json', {
  layers: [
    { id: 0, name: 'Assessment Points' },
    { id: 1, name: 'Assessment Lines' },
    { id: 2, name: 'Assessment Areas' },
  ],
});
const groupNames: Record<string, string[]> = {
  fish: ['Actinopterygii'],
  lamprey: ['Petromyzontiformes'],
  turtle: ['Testudines'],
  amphibian: ['Amphibia'],
  crustacean: ['Decapoda'],
  mollusc: ['Bivalvia', 'Gastropoda'],
  mammal: ['Cetacea', 'Sirenia'],
  plant: [
    'Nymphaeaceae',
    'Potamogetonaceae',
    'Hydrocharitaceae',
    'Typhaceae',
    'Haloragaceae',
    'Ceratophyllaceae',
    'Lythraceae',
  ],
  cyanobacteria: ['Cyanobacteria'],
};
const match: Record<string, unknown> = {};
for (const names of Object.values(groupNames)) {
  for (const n of names)
    match[n] = {
      usageKey: syntheticKey(`taxon:${n}`),
      scientificName: n,
      matchType: 'EXACT',
      confidence: 98,
      status: 'ACCEPTED',
    };
}
write('_shared/gbif-match.json', { matches: match });
write('_shared/nominatim-search.json', {
  results: [
    ...nominatim,
    {
      place_id: 7100001,
      lat: '44.47593',
      lon: '-73.21207',
      display_name: 'Burlington, Chittenden County, Vermont, United States (demo)',
      name: 'Burlington',
      type: 'city',
      boundingbox: ['44.42', '44.53', '-73.29', '-73.15'],
    },
    {
      place_id: 7100002,
      lat: '39.52963',
      lon: '-119.8138',
      display_name: 'Reno, Washoe County, Nevada, United States (demo)',
      name: 'Reno',
      type: 'city',
      boundingbox: ['39.42', '39.66', '-119.93', '-119.69'],
    },
    {
      place_id: 7100003,
      lat: '38.89511',
      lon: '-77.03637',
      display_name: 'Washington, District of Columbia, United States (demo)',
      name: 'Washington',
      type: 'city',
      boundingbox: ['38.79', '38.99', '-77.12', '-76.91'],
    },
    {
      place_id: 7100004,
      lat: '41.66394',
      lon: '-83.55521',
      display_name: 'Toledo, Lucas County, Ohio, United States (demo)',
      name: 'Toledo',
      type: 'city',
      boundingbox: ['41.58', '41.73', '-83.70', '-83.45'],
    },
    {
      place_id: 7100005,
      lat: '43.04812',
      lon: '-76.14742',
      display_name: 'Syracuse, Onondaga County, New York, United States (demo)',
      name: 'Syracuse',
      type: 'city',
      boundingbox: ['42.98', '43.10', '-76.25', '-76.05'],
    },
    {
      place_id: 7100006,
      lat: '42.22487',
      lon: '-121.78167',
      display_name: 'Klamath Falls, Klamath County, Oregon, United States (demo)',
      name: 'Klamath Falls',
      type: 'city',
      boundingbox: ['42.17', '42.27', '-121.85', '-121.70'],
    },
  ],
});
write('_shared/nominatim-reverse.json', {
  address: {
    state: 'Vermont',
    'ISO3166-2-lvl4': 'US-VT',
    country: 'United States',
    country_code: 'us',
  },
});

// Small fixtures used by unit tests of the non-NHD code paths.
write('_shared/overpass-sample.json', {
  version: 0.6,
  generator: 'demo',
  elements: [
    {
      type: 'way',
      id: 123456789,
      tags: { natural: 'water', water: 'pond', name: 'Demo Pond' },
      geometry: [
        { lat: 45.5, lon: -122.7 },
        { lat: 45.5, lon: -122.698 },
        { lat: 45.5015, lon: -122.698 },
        { lat: 45.5015, lon: -122.7 },
        { lat: 45.5, lon: -122.7 },
      ],
    },
    {
      type: 'relation',
      id: 987654321,
      tags: { natural: 'water', water: 'lake', name: 'Demo Mere', type: 'multipolygon' },
      members: [
        {
          type: 'way',
          ref: 1,
          role: 'outer',
          geometry: [
            { lat: 45.6, lon: -122.8 },
            { lat: 45.6, lon: -122.78 },
            { lat: 45.62, lon: -122.78 },
            { lat: 45.62, lon: -122.8 },
            { lat: 45.6, lon: -122.8 },
          ],
        },
      ],
    },
  ],
});
write('_shared/nhd-flowline-only.json', {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-90.0, 40.0],
          [-89.995, 40.002],
          [-89.99, 40.0],
          [-89.985, 40.003],
        ],
      },
      properties: {
        permanent_identifier: 'demo-creek',
        gnis_name: 'Demo Creek',
        ftype: 460,
        fcode: 46006,
        lengthkm: 1.2,
        huc8: '07130001',
      },
    },
  ],
});

void PARAMETERS;
void SPECIES_CATALOG;
