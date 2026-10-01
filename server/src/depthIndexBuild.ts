import { centroid as turfCentroid, feature } from '@turf/turf';
import type { Geometry } from 'geojson';
import type { DepthIndexEntry } from './adapters/depth';

/** Bounding boxes that enclose the United States (CONUS, Alaska, Hawaii). */
const US_BOXES: Array<[number, number, number, number]> = [
  [-125, 24.4, -66.5, 49.5],
  [-170, 54, -130, 71.5],
  [-161, 18.5, -154, 22.5],
];

export const MIN_AREA_KM2 = 0.1;

export const inUs = (lon: number, lat: number) =>
  US_BOXES.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);

export interface HydroLakesRecord {
  Hylak_id: number;
  Lake_name?: string;
  Lake_area: number; // km2
  Vol_total: number; // million m3
  Depth_avg: number; // m
  Pour_long?: number;
  Pour_lat?: number;
}

export interface GlobathyRow {
  hylak_id: number;
  maxDepthM: number;
}

/** Parse the GLOBathy table: a CSV with "Hylak_id" and "Max_depth"/"Depth_max" style columns. */
export function parseGlobathyCsv(text: string): Map<number, number> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idCol = head.findIndex((h) => h === 'hylak_id');
  const dCol = head.findIndex((h) => /^(max_?depth|depth_?max|maxdepth)/.test(h));
  if (idCol < 0 || dCol < 0) throw new Error('GLOBathy CSV needs Hylak_id and a max depth column');
  const out = new Map<number, number>();
  for (const l of lines.slice(1)) {
    const cells = l.split(',');
    const id = Number(cells[idCol]);
    const d = Number(cells[dCol]);
    if (Number.isFinite(id) && Number.isFinite(d) && d > 0) out.set(id, d);
  }
  return out;
}

/** Combine one HydroLAKES polygon with the GLOBathy max depth into a compact index entry. */
export function toIndexEntry(
  props: HydroLakesRecord,
  geometry: Geometry | null,
  maxDepth: Map<number, number>,
): DepthIndexEntry | null {
  if (!(props.Lake_area >= MIN_AREA_KM2)) return null;
  const dmax = maxDepth.get(props.Hylak_id);
  if (dmax === undefined) return null;
  let lon = props.Pour_long;
  let lat = props.Pour_lat;
  if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
    const c = turfCentroid(feature(geometry)).geometry.coordinates;
    lon = c[0];
    lat = c[1];
  }
  if (lon === undefined || lat === undefined || !inUs(lon, lat)) return null;
  const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    hylak_id: props.Hylak_id,
    ...(props.Lake_name ? { name: props.Lake_name } : {}),
    lon: r(lon, 5),
    lat: r(lat, 5),
    area_km2: r(props.Lake_area, 3),
    depth_avg_m: r(props.Depth_avg, 2),
    depth_max_m: r(dmax, 2),
    vol_mcm: r(props.Vol_total, 2),
  };
}
