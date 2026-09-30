import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';

export type SourceStatus = 'ok' | 'empty' | 'error' | 'unsupported';

export interface Provenance {
  source: string; // "USGS NHD", "EPA WQP", ...
  url: string; // exact request URL, keys redacted
  retrievedAt: string; // ISO timestamp
  license?: string;
  note?: string;
}

export interface SourceResult<T> {
  status: SourceStatus;
  data: T | null;
  provenance: Provenance;
  error?: string;
  /** Additive: provenance of secondary sources merged into this section (e.g. USGS, NAS). */
  extras?: SourceRecord[];
}

export type WaterbodyType =
  'lake' | 'reservoir' | 'pond' | 'river' | 'stream' | 'estuary' | 'bay' | 'wetland' | 'unknown';

export type WaterGeometry = Polygon | MultiPolygon | LineString | MultiLineString;

export interface WaterbodyIdentity {
  id: string; // "nhd:…" | "osm:…"
  name: string | null;
  type: WaterbodyType;
  state?: string;
  country: string;
  huc8?: string;
  geometry: WaterGeometry;
  bbox: [number, number, number, number];
  centroid: [number, number];
}

export interface Measured<T = number> {
  value: T;
  unit: string;
  estimated: boolean;
  method?: string;
}

export interface PhysicalProfile {
  areaKm2: Measured;
  perimeterKm: Measured;
  shorelineDevelopment?: Measured;
  surfaceElevationM?: Measured;
  maxDepthM?: Measured;
  meanDepthM?: Measured;
  volumeMcm?: Measured; // million cubic metres
  lengthKm?: Measured; // rivers
}

export type ParameterKey =
  | 'water_temp'
  | 'dissolved_oxygen'
  | 'ph'
  | 'turbidity'
  | 'secchi_depth'
  | 'specific_conductance'
  | 'total_phosphorus'
  | 'total_nitrogen'
  | 'nitrate'
  | 'chlorophyll_a'
  | 'microcystins'
  | 'e_coli'
  | 'enterococci'
  | 'mercury'
  | 'lead'
  | 'arsenic'
  | 'pfas_total'
  | 'pfos'
  | 'pfoa'
  | 'pcbs'
  | 'atrazine'
  | 'chloride'
  | 'salinity';

export interface ThresholdRef {
  label: string; // "EPA recreational criterion"
  value: number;
  unit: string;
  direction: 'max' | 'min' | 'range';
  rangeMax?: number;
  /** For "min" thresholds: below this the status is "exceeds" rather than "watch". */
  hardLimit?: number;
  citation: string; // URL
  note?: string;
}

export type ParameterStatus = 'good' | 'watch' | 'exceeds' | 'no_reference';

export interface ParameterSummary {
  key: ParameterKey;
  label: string;
  unit: string;
  latest: { value: number; date: string; stationId: string } | null;
  median5y: number | null;
  min: number | null;
  max: number | null;
  sampleCount: number;
  series: Array<{ t: string; v: number }>;
  threshold?: ThresholdRef;
  status: ParameterStatus;
  /** Extra context, e.g. a Carlson trophic state index line. */
  note?: string;
  /** Depth-resolved readings from the most recent profile day (temperature, dissolved oxygen). */
  depthProfile?: Array<{ depthM: number; value: number }>;
  depthProfileDate?: string;
  /** Most recent surface reading at each station (used by the station pins). */
  latestByStation?: Record<string, { value: number; date: string }>;
}

export interface ImpairmentProfile {
  assessmentUnits: Array<{ id: string; name: string; cycle: string; url: string }>;
  uses: Array<{
    use: string;
    status: 'fully_supporting' | 'not_supporting' | 'insufficient_info' | 'not_assessed';
  }>;
  causes: Array<{ name: string; group: string; hasTmdl: boolean }>;
}

export type SpeciesGroup =
  | 'fish'
  | 'lamprey'
  | 'turtle'
  | 'amphibian'
  | 'crustacean'
  | 'mollusc'
  | 'mammal'
  | 'plant'
  | 'cyanobacteria'
  | 'other';

export interface SpeciesRecord {
  gbifKey: number;
  scientificName: string;
  commonName: string | null;
  group: SpeciesGroup;
  recordCount: number;
  lastObserved?: string;
  introduced: boolean; // from NAS
  iucn?: 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'DD';
  catalogId?: string; // match in species-catalog.json
  /** Taxonomy from GBIF, used to pick a generic archetype for species not in the catalog. */
  family?: string;
  order?: string;
  taxClass?: string;
}

export interface StationInfo {
  id: string;
  name: string;
  lon: number;
  lat: number;
  org: string;
}

/** One row of the Sources table: every adapter result, flattened. */
export interface SourceRecord {
  key: string; // "geometry" | "physical" | "quality" | ...
  label: string;
  status: SourceStatus;
  provenance: Provenance;
  error?: string;
}

export interface WaterbodyProfile {
  identity: WaterbodyIdentity;
  physical: SourceResult<PhysicalProfile>;
  quality: SourceResult<ParameterSummary[]>;
  impairments: SourceResult<ImpairmentProfile>;
  life: SourceResult<SpeciesRecord[]>;
  stations: SourceResult<StationInfo[]>;
  /** Additive to the spec: flat list of every provenance including geometry. */
  sources: SourceRecord[];
  generatedAt: string;
  demo: boolean;
}

// species-catalog.json entries
export type FishArchetype =
  | 'fusiform' // trout, salmon, bass
  | 'compressed' // sunfish, crappie, shad
  | 'elongate' // pike, gar, muskellunge
  | 'anguilliform' // eel, lamprey
  | 'benthic' // catfish, sturgeon, carp
  | 'small'; // minnows, darters

export type Archetype =
  FishArchetype | 'turtle' | 'crayfish' | 'crab' | 'mussel' | 'frog' | 'plant' | 'mammal';

export interface CatalogColors {
  back: string;
  side: string;
  belly: string;
  fin: string;
  pattern?: 'bars' | 'spots' | 'stripe' | 'mottled' | 'none';
}

export interface CatalogSpecies {
  id: string; // "micropterus-salmoides"
  scientificName: string;
  commonName: string;
  archetype: Archetype;
  lengthCm: [number, number]; // typical adult range
  colors: CatalogColors;
  depthBand: 'surface' | 'littoral' | 'midwater' | 'benthic';
  schooling: boolean;
  tempPrefC?: [number, number];
  notes?: string;
  /** Additive: group and family let the Life tab and generic fallbacks work without GBIF. */
  group?: SpeciesGroup;
  family?: string;
  iucn?: 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'DD';
}

// Scene model ---------------------------------------------------------------

export interface SceneActor {
  key: string; // scientific name
  catalogId: string | null;
  archetype: string;
  count: number;
  depthBand: string;
  lengthCm: number;
  colors: CatalogColors;
  introduced: boolean;
  label: string;
  scientificName: string;
  recordCount: number;
  schooling: boolean;
  group: SpeciesGroup;
  pinned?: boolean;
}

export interface SceneModel {
  outline: Array<[number, number]>; // local metres, centred on centroid, simplified to <= 400 vertices
  maxDepthM: number;
  meanDepthM: number;
  depthEstimated: boolean;
  visibilityM: number;
  waterTint: string; // hex
  surfaceTempC?: number;
  thermoclineM?: number;
  thermoclineEstimated?: boolean;
  doProfile?: Array<{ depthM: number; mgL: number }>;
  surfaceDoMgL?: number;
  actors: SceneActor[];
  pollutants: Array<{ key: ParameterKey; ratio: number; label: string }>; // value / threshold
  /** Additive: legend rows for the pollutant view. */
  pollutantDetails: PollutantDetail[];
  listedImpairments: Array<{
    name: string;
    group: string;
    hasTmdl: boolean;
    measuredKey?: ParameterKey;
  }>;
  isRiver: boolean;
  surfaceElevationM: number;
  stations: StationInfo[];
  turbidityNtu?: number;
  chlorophyllUgL?: number;
  plantCount: number;
  name: string;
  /** lon/lat the local metre outline is centred on. */
  origin: [number, number];
  demo: boolean;
}

export interface PollutantDetail {
  key: ParameterKey;
  label: string;
  value: number;
  unit: string;
  threshold: number;
  thresholdLabel: string;
  ratio: number;
  date: string;
}

/** Elevation grid in row-major order, row 0 at the north edge. */
export interface DemGrid {
  bbox: [number, number, number, number];
  width: number;
  height: number;
  elevations: number[];
  _demo?: boolean;
}

export interface DemoWaterbodyInfo {
  slug: string;
  id: string;
  name: string;
  centroid: [number, number];
  bbox: [number, number, number, number];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  demo?: boolean;
}

export type GeoFeature = Feature<WaterGeometry>;

/** Response of the identity endpoints. */
export interface IdentityResponse {
  identity: WaterbodyIdentity;
  provenance: Provenance;
  demo: boolean;
}
