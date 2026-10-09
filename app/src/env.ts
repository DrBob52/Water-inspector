/** Build-time flags. See README for the full list. */
const e = import.meta.env;

export const DEMO = e.VITE_DEMO === '1' || e.VITE_DEMO === 'true';
/** Skip every third-party tile request: minimal local map style and a flat DEM. */
export const OFFLINE_TILES = e.VITE_OFFLINE_TILES === '1' || e.VITE_OFFLINE_TILES === 'true';
/** Optional style URL; when unset the built-in satellite style in map/style.ts is used. */
export const MAP_STYLE_URL: string | undefined =
  (e.VITE_MAP_STYLE_URL as string | undefined) || undefined;
export const DEM_URL: string =
  (e.VITE_DEM_URL as string | undefined) ??
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const DEMO_LABEL = 'Illustrative sample data, not live measurements';
