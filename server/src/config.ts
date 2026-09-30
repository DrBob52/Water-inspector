import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

export const REPO_URL = 'https://github.com/DrBob52/Water-inspector-';

/**
 * All upstream base URLs, layer names, TTLs and limits live here so they can be corrected without
 * touching adapter code. Endpoint details were checked in September 2026.
 */
export interface Config {
  demo: boolean;
  port: number;
  fixturesDir: string;
  staticDir: string;
  cacheDir: string | null;
  userAgent: string;
  adapterTimeoutMs: number;
  requestTimeoutMs: number;
  maxConcurrentPerHost: number;
  /** Minimum gap between requests to specific hosts (Nominatim policy: 1 request per second). */
  hostMinIntervalMs: Record<string, number>;
  ttl: {
    nhd: number;
    depthIndex: number;
    attains: number;
    wqp: number;
    usgsContinuous: number;
    gbif: number;
    nas: number;
    search: number;
    dem: number;
  };
  nhd: {
    baseUrl: string;
    /** Optional fixed layer ids; otherwise looked up from ?f=pjson by name. */
    layerIds?: { waterbody?: number; area?: number; flowline?: number };
    layerNames: { waterbody: RegExp; area: RegExp; flowline: RegExp };
    flowlineToleranceM: number;
    maxGeometryVertices: number;
  };
  wbd: { baseUrl: string; huc8LayerName: RegExp };
  overpass: { url: string; aroundM: number };
  nominatim: { searchUrl: string; reverseUrl: string };
  depth: { indexPath: string | null; areaTolerance: number };
  wqp: {
    baseUrl: string;
    legacyPath: string;
    betaPath: string;
    providers: string[];
    lookbackYears: number;
    shoreBufferM: number;
    maxSites: number;
    sitesPerRequest: number;
  };
  usgs: { baseUrl: string; parameterCodes: Record<string, string> };
  attains: {
    geoBaseUrl: string;
    apiBaseUrl: string;
    apiKey: string;
    layerNames: RegExp;
  };
  gbif: {
    baseUrl: string;
    groups: Array<{ id: string; names: string[] }>;
    facetLimit: number;
    maxSpeciesDetails: number;
    maxVernacular: number;
    maxLastObserved: number;
    budgetMs: number;
  };
  nas: { baseUrl: string };
  terrarium: { urlTemplate: string; targetSamples: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = resolve(here, '..', '..');
  const demo = env.DEMO_MODE === '1' || env.DEMO_MODE === 'true';
  return {
    demo,
    port: Number(env.PORT ?? 8787),
    fixturesDir: env.FIXTURES_DIR ?? join(root, 'fixtures'),
    staticDir: env.STATIC_DIR ?? join(root, 'app', 'dist'),
    cacheDir: demo ? null : (env.CACHE_DIR ?? join(root, 'server', '.cache')),
    userAgent: `WaterInspector/1.0 (+${REPO_URL})`,
    adapterTimeoutMs: 8000,
    requestTimeoutMs: 7000,
    maxConcurrentPerHost: 2,
    hostMinIntervalMs: { 'nominatim.openstreetmap.org': 1000 },
    ttl: {
      nhd: 30 * DAY,
      depthIndex: 30 * DAY,
      attains: 7 * DAY,
      wqp: 1 * DAY,
      usgsContinuous: 15 * 60 * 1000,
      gbif: 7 * DAY,
      nas: 7 * DAY,
      search: 1 * DAY,
      dem: 30 * DAY,
    },
    nhd: {
      baseUrl: 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer',
      layerNames: {
        waterbody: /^waterbody$/i,
        area: /^area$/i,
        flowline: /^flowline\s*-\s*large/i,
      },
      flowlineToleranceM: 30,
      maxGeometryVertices: 3000,
    },
    wbd: {
      baseUrl: 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer',
      huc8LayerName: /huc\s*-?\s*8|8-digit/i,
    },
    overpass: { url: 'https://overpass-api.de/api/interpreter', aroundM: 30 },
    nominatim: {
      searchUrl: 'https://nominatim.openstreetmap.org/search',
      reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
    },
    depth: {
      indexPath: env.DEPTH_INDEX_PATH ?? join(root, 'server', 'data', 'lake-depth-index.json'),
      areaTolerance: 0.3,
    },
    wqp: {
      baseUrl: 'https://www.waterqualitydata.us',
      legacyPath: '/data',
      betaPath: '/beta/data',
      providers: ['NWIS', 'STORET'],
      lookbackYears: 5,
      shoreBufferM: 100,
      maxSites: 100,
      sitesPerRequest: 25,
    },
    usgs: {
      baseUrl: 'https://api.waterdata.usgs.gov/ogcapi/v0',
      parameterCodes: {
        '00010': 'water_temp',
        '00300': 'dissolved_oxygen',
        '00400': 'ph',
        '63680': 'turbidity',
        '00095': 'specific_conductance',
      },
    },
    attains: {
      geoBaseUrl: 'https://gispub.epa.gov/arcgis/rest/services/OW/ATTAINS_Assessment/MapServer',
      apiBaseUrl: 'https://api.epa.gov/attains',
      apiKey: env.ATTAINS_API_KEY ?? 'DEMO_KEY',
      layerNames: /assessment\s*(areas?|lines?)/i,
    },
    gbif: {
      baseUrl: 'https://api.gbif.org/v1',
      groups: [
        { id: 'fish', names: ['Actinopterygii'] },
        { id: 'lamprey', names: ['Petromyzontiformes'] },
        { id: 'turtle', names: ['Testudines'] },
        { id: 'amphibian', names: ['Amphibia'] },
        { id: 'crustacean', names: ['Decapoda'] },
        { id: 'mollusc', names: ['Bivalvia', 'Gastropoda'] },
        { id: 'mammal', names: ['Cetacea', 'Sirenia'] },
        {
          id: 'plant',
          names: [
            'Nymphaeaceae',
            'Potamogetonaceae',
            'Hydrocharitaceae',
            'Typhaceae',
            'Haloragaceae',
            'Ceratophyllaceae',
            'Lythraceae',
          ],
        },
        { id: 'cyanobacteria', names: ['Cyanobacteria'] },
      ],
      facetLimit: 200,
      maxSpeciesDetails: 60,
      maxVernacular: 20,
      maxLastObserved: 12,
      budgetMs: 6500,
    },
    nas: { baseUrl: 'https://nas.er.usgs.gov/api/v2' },
    terrarium: {
      urlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      targetSamples: 256,
    },
  };
}

export const DAY_MS = DAY;
