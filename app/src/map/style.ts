import type { StyleSpecification } from 'maplibre-gl';
import { DEM_URL, MAP_STYLE_URL, OFFLINE_TILES } from '../env';
import { FLAT_DEM_TILES } from './flatDem';

/**
 * Minimal local style for offline and test mode: a plain background. The demo waterbody outlines
 * are added as a GeoJSON source by the map component, so nothing here touches the network.
 */
export const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Water Inspector offline',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dde6e3' } }],
};

export const mapStyle: string | StyleSpecification = OFFLINE_TILES ? OFFLINE_STYLE : MAP_STYLE_URL;
export const demTiles: string[] = OFFLINE_TILES ? FLAT_DEM_TILES : [DEM_URL];

/** Basemap layers that represent water in the OpenFreeMap style, used for hover hit-testing. */
export const BASEMAP_WATER_LAYERS = ['water', 'waterway'];
export const DEMO_WATER_LAYER = 'demo-water-fill';
