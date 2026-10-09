import type { StyleSpecification } from 'maplibre-gl';
import { DEM_URL, MAP_STYLE_URL, OFFLINE_TILES } from '../env';
import { FLAT_DEM_TILES } from './flatDem';

const SKY = {
  'sky-color': '#0a2230',
  'horizon-color': '#12404f',
  'fog-color': '#06131a',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.35,
} as const;

/** Shared palette for map layers, matching the CSS tokens in index.css. */
export const MAP_COLORS = {
  ink: '#040b10',
  land: '#0c1a21',
  landEdge: '#1b313b',
  water: '#0a2a37',
  accent: '#5fd4e8',
  accentDeep: '#2fa9c6',
  label: '#d9e8ec',
  labelHalo: 'rgba(4, 11, 16, 0.85)',
};

const FONTS = {
  regular: ['Noto Sans Regular'],
  italic: ['Noto Sans Italic'],
  bold: ['Noto Sans Bold'],
};

/**
 * Live style: USGS orthoimagery (public domain) dimmed and desaturated so the data layers read on
 * top of it, with water, boundaries and labels from the OpenFreeMap vector tiles (OpenMapTiles
 * schema). Water gets a cyan tint so lakes and rivers stand out from the land. The layer ids
 * `water` and `waterway` are kept for hover hit-testing.
 */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Water Inspector satellite',
  sky: SKY,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    imagery: {
      type: 'raster',
      tiles: [
        'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution:
        '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>',
    },
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.ink } },
    {
      id: 'imagery',
      type: 'raster',
      source: 'imagery',
      paint: {
        'raster-saturation': -0.35,
        'raster-brightness-max': 0.72,
        'raster-contrast': 0.08,
        'raster-fade-duration': 200,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: {
        'fill-color': '#0e4a60',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.55, 9, 0.38, 14, 0.25],
      },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal']]],
      paint: {
        'line-color': MAP_COLORS.accentDeep,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.25, 10, 0.6],
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 5, 0.5, 12, 2, 16, 6],
      },
    },
    {
      id: 'boundary-state',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': 'rgba(217, 232, 236, 0.28)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.2],
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': 'rgba(217, 232, 236, 0.45)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 10, 1.8],
      },
    },
    {
      id: 'water-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      minzoom: 5,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONTS.italic,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 12, 14],
        'text-letter-spacing': 0.08,
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#8fe3f2',
        'text-halo-color': MAP_COLORS.labelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      minzoom: 4,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': FONTS.regular,
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          ['match', ['get', 'class'], 'city', 11, 9],
          12,
          ['match', ['get', 'class'], 'city', 16, 13],
        ],
        'text-max-width': 8,
      },
      paint: {
        'text-color': MAP_COLORS.label,
        'text-halo-color': MAP_COLORS.labelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'place-state',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', ['get', 'class'], 'state'],
      maxzoom: 7,
      layout: {
        'text-field': ['upcase', ['coalesce', ['get', 'name:en'], ['get', 'name']]],
        'text-font': FONTS.bold,
        'text-size': 10,
        'text-letter-spacing': 0.25,
        'text-max-width': 8,
      },
      paint: {
        'text-color': 'rgba(217, 232, 236, 0.55)',
        'text-halo-color': MAP_COLORS.labelHalo,
        'text-halo-width': 1,
      },
    },
  ],
};

/**
 * Offline and test style: Natural Earth 1:50m land, lakes and boundaries for North America,
 * served from /offline. No third-party requests and no glyphs, so labels come from the HTML
 * markers only.
 */
export const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Water Inspector offline',
  sky: SKY,
  sources: {
    land: { type: 'geojson', data: '/offline/land.geojson' },
    lakes: { type: 'geojson', data: '/offline/lakes.geojson' },
    states: { type: 'geojson', data: '/offline/states.geojson' },
    countries: { type: 'geojson', data: '/offline/countries.geojson' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.ink } },
    {
      id: 'land',
      type: 'fill',
      source: 'land',
      paint: { 'fill-color': MAP_COLORS.land, 'fill-outline-color': MAP_COLORS.landEdge },
    },
    {
      id: 'land-edge',
      type: 'line',
      source: 'land',
      paint: { 'line-color': '#1f3a45', 'line-width': 1 },
    },
    {
      id: 'lakes',
      type: 'fill',
      source: 'lakes',
      paint: { 'fill-color': MAP_COLORS.water, 'fill-outline-color': '#1d5466' },
    },
    {
      id: 'states',
      type: 'line',
      source: 'states',
      paint: {
        'line-color': 'rgba(150, 205, 222, 0.14)',
        'line-width': 0.8,
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'countries',
      type: 'line',
      source: 'countries',
      paint: { 'line-color': 'rgba(150, 205, 222, 0.3)', 'line-width': 1.1 },
    },
  ],
};

/** VITE_MAP_STYLE_URL overrides the built-in satellite style. */
export const mapStyle: string | StyleSpecification = OFFLINE_TILES
  ? OFFLINE_STYLE
  : (MAP_STYLE_URL ?? SATELLITE_STYLE);
export const demTiles: string[] = OFFLINE_TILES ? FLAT_DEM_TILES : [DEM_URL];

/** Basemap layers that represent water, used for hover hit-testing. */
export const BASEMAP_WATER_LAYERS = ['water', 'waterway'];
export const DEMO_WATER_LAYER = 'demo-water-fill';
