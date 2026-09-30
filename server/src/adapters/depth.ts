import { readFileSync, existsSync } from 'node:fs';
import { booleanPointInPolygon, point as turfPoint, feature } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  distToRing,
  makeProjection,
  pointInRing,
  sampleDem,
  type DemGrid,
  type Measured,
  type PhysicalProfile,
  type Ring,
  type SourceResult,
  type WaterbodyIdentity,
} from '@wi/shared';
import { areaKm2, isPolygonal, lengthKm, perimeterKm } from '../geom';
import { type AdapterCtx, errorResult, okResult } from './common';

export const DEPTH_SOURCE = 'HydroLAKES / GLOBathy depth index';

export interface DepthIndexEntry {
  hylak_id: number;
  name?: string;
  lon: number;
  lat: number;
  area_km2: number;
  depth_avg_m: number;
  depth_max_m: number;
  vol_mcm: number;
}

interface DepthIndexFile {
  lakes: DepthIndexEntry[];
}

export async function loadDepthIndex(ctx: AdapterCtx): Promise<DepthIndexEntry[] | null> {
  try {
    if (ctx.upstream.demo) {
      const raw = await ctx.upstream.json<DepthIndexFile>({
        source: DEPTH_SOURCE,
        url: 'fixture:lake-depth-index.sample.json',
        fixture: { file: 'lake-depth-index.sample.json', root: true },
      });
      return raw.lakes;
    }
    const p = ctx.config.depth.indexPath;
    if (!p || !existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as DepthIndexFile | DepthIndexEntry[];
    return Array.isArray(raw) ? raw : raw.lakes;
  } catch {
    return null;
  }
}

/** Centroid-in-polygon plus area within tolerance; closest area wins. */
export function matchDepthIndex(
  identity: WaterbodyIdentity,
  areaKm2Value: number,
  index: DepthIndexEntry[],
  tolerance = 0.3,
): DepthIndexEntry | null {
  if (!isPolygonal(identity.geometry)) return null;
  const f = feature(identity.geometry) as Feature<Polygon | MultiPolygon>;
  let best: DepthIndexEntry | null = null;
  let bestDiff = Infinity;
  for (const e of index) {
    if (!booleanPointInPolygon(turfPoint([e.lon, e.lat]), f)) continue;
    const diff = Math.abs(e.area_km2 - areaKm2Value) / Math.max(areaKm2Value, 1e-9);
    if (diff <= tolerance && diff < bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
}

function exteriorOf(g: WaterbodyIdentity['geometry']): Array<[number, number]> | null {
  if (g.type === 'Polygon') return g.coordinates[0] as Array<[number, number]>;
  if (g.type === 'MultiPolygon') {
    let best = g.coordinates[0][0];
    let n = 0;
    for (const p of g.coordinates) {
      if (p[0].length > n) {
        best = p[0];
        n = p[0].length;
      }
    }
    return best as Array<[number, number]>;
  }
  return null;
}

/** Up to `count` well-spread points inside the polygon (centroid first). */
export function interiorPoints(identity: WaterbodyIdentity, count = 5): Array<[number, number]> {
  const ring = exteriorOf(identity.geometry);
  if (!ring) return [identity.centroid];
  const [w, s, e, n] = identity.bbox;
  const pts: Array<[number, number]> = [];
  if (
    booleanPointInPolygon(
      turfPoint(identity.centroid),
      feature(identity.geometry) as Feature<Polygon | MultiPolygon>,
    )
  )
    pts.push(identity.centroid);
  const steps = 7;
  const candidates: Array<[number, number]> = [];
  for (let j = 1; j < steps; j++) {
    for (let i = 1; i < steps; i++) {
      const p: [number, number] = [w + ((e - w) * i) / steps, s + ((n - s) * j) / steps];
      if (pointInRing(p[0], p[1], ring as Ring)) candidates.push(p);
    }
  }
  const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, count - pts.length)));
  for (let i = 0; i < candidates.length && pts.length < count; i += stride) pts.push(candidates[i]);
  return pts.length ? pts : [identity.centroid];
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median DEM elevation at interior points (used when NHD has no elevation attribute). */
export function demSurfaceElevation(identity: WaterbodyIdentity, dem: DemGrid): number | null {
  const vals = interiorPoints(identity, 5)
    .map(([lon, lat]) => sampleDem(dem, lon, lat))
    .filter(Number.isFinite);
  return vals.length ? Math.round(median(vals) * 10) / 10 : null;
}

export interface DepthEstimate {
  maxDepthM: number;
  meanDepthM: number;
  slope: number;
  maxDistanceToShoreM: number;
}

/** Fraction of max depth a typical (x^0.7) basin holds on average. */
export const ESTIMATED_MEAN_FRACTION = 0.4;

/**
 * Spec 6.2 fallback: maxDepth ~ slope x maxDistanceToShore x 0.5, clamped to [1, 300] m, where
 * slope is the median DEM slope in a 500 m ring around the shoreline.
 */
export function estimateDepthFromDem(
  identity: WaterbodyIdentity,
  dem: DemGrid,
): DepthEstimate | null {
  const ring = exteriorOf(identity.geometry);
  if (!ring) return null;
  const proj = makeProjection(identity.centroid);
  const local: Ring = ring.map(([lon, lat]) => proj.toLocal(lon, lat));
  // Max distance to shore: sample a grid of interior points.
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const [x, y] of local) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  let maxD = 0;
  const N = 40;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = xmin + ((xmax - xmin) * i) / N;
      const y = ymin + ((ymax - ymin) * j) / N;
      if (pointInRing(x, y, local)) maxD = Math.max(maxD, distToRing(x, y, local));
    }
  }
  if (maxD <= 0) return null;
  // Slope of the terrain in a 250-500 m ring around the shoreline.
  const slopes: number[] = [];
  const step = 100;
  const elevAt = (x: number, y: number) => {
    const [lon, lat] = proj.toLonLat(x, y);
    return sampleDem(dem, lon, lat);
  };
  const stride = Math.max(1, Math.floor(local.length / 80));
  for (let k = 0; k < local.length; k += stride) {
    const a = local[k];
    const b = local[(k + 1) % local.length];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    for (const nd of [1, -1]) {
      const nx = (nd * ty) / len;
      const ny = (-nd * tx) / len;
      for (const dist of [250, 400, 500]) {
        const x = a[0] + nx * dist;
        const y = a[1] + ny * dist;
        if (pointInRing(x, y, local)) continue;
        const e0 = elevAt(x, y);
        const ex = elevAt(x + step, y);
        const ey = elevAt(x, y + step);
        if ([e0, ex, ey].every(Number.isFinite)) slopes.push(Math.hypot(ex - e0, ey - e0) / step);
      }
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const maxDepthM = Math.min(300, Math.max(1, slope * maxD * 0.5));
  return {
    maxDepthM,
    meanDepthM: maxDepthM * ESTIMATED_MEAN_FRACTION,
    slope,
    maxDistanceToShoreM: maxD,
  };
}

/** Hydraulic-geometry estimate for rivers: mean depth ~ 0.27 x width^0.4, max ~ 1.8 x mean. */
export function estimateRiverDepth(widthM: number): { maxDepthM: number; meanDepthM: number } {
  const mean = 0.27 * Math.pow(Math.max(widthM, 1), 0.4);
  return { meanDepthM: Math.min(35, mean), maxDepthM: Math.min(40, Math.max(0.3, mean * 1.8)) };
}

const m = (value: number, unit: string, estimated: boolean, method?: string): Measured => ({
  value,
  unit,
  estimated,
  method,
});
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface PhysicalInputs {
  identity: WaterbodyIdentity;
  nhdElevationM?: number;
  dem?: DemGrid | null;
  index?: DepthIndexEntry[] | null;
}

/** Assemble the physical profile: geometry measures, elevation, depth and volume. */
export function buildPhysical(inp: PhysicalInputs): PhysicalProfile {
  const { identity, dem, index } = inp;
  const area = areaKm2(identity.geometry);
  const perim = perimeterKm(identity.geometry);
  const len = lengthKm(identity.geometry);
  const phys: PhysicalProfile = {
    areaKm2: m(r2(area), 'km²', false, 'Computed from geometry'),
    perimeterKm: m(r2(perim), 'km', false, 'Computed from geometry'),
  };
  if (area > 0 && perim > 0) {
    phys.shorelineDevelopment = m(
      r2(perim / (2 * Math.sqrt(Math.PI * area))),
      '',
      false,
      'Perimeter / circumference of an equal-area circle',
    );
  }
  if (inp.nhdElevationM !== undefined) {
    phys.surfaceElevationM = m(inp.nhdElevationM, 'm', false, 'NHD attribute');
  } else if (dem) {
    const e = demSurfaceElevation(identity, dem);
    if (e !== null)
      phys.surfaceElevationM = m(e, 'm', true, 'Median of the terrain model at 5 interior points');
  }
  if (identity.type === 'river' || identity.type === 'stream') {
    if (len > 0) phys.lengthKm = m(r2(len), 'km', false, 'Computed from geometry');
    const lenKm = len > 0 ? len : undefined;
    if (area > 0 && lenKm) {
      const d = estimateRiverDepth((area * 1e6) / (lenKm * 1000));
      phys.maxDepthM = m(
        r2(d.maxDepthM),
        'm',
        true,
        'Estimated from channel width (hydraulic geometry)',
      );
      phys.meanDepthM = m(
        r2(d.meanDepthM),
        'm',
        true,
        'Estimated from channel width (hydraulic geometry)',
      );
    }
    return phys;
  }
  const hit = index ? matchDepthIndex(identity, area, index) : null;
  if (hit) {
    const method = `HydroLAKES / GLOBathy match (id ${hit.hylak_id})`;
    phys.maxDepthM = m(hit.depth_max_m, 'm', false, method);
    phys.meanDepthM = m(hit.depth_avg_m, 'm', false, method);
    phys.volumeMcm = m(hit.vol_mcm, 'million m³', false, method);
  } else if (dem) {
    const est = estimateDepthFromDem(identity, dem);
    if (est) {
      const method = 'Estimated from surrounding terrain';
      phys.maxDepthM = m(r2(est.maxDepthM), 'm', true, method);
      phys.meanDepthM = m(r2(est.meanDepthM), 'm', true, method);
      phys.volumeMcm = m(Math.round(area * est.meanDepthM), 'million m³', true, method);
    }
  }
  return phys;
}

export async function physicalSection(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
  nhdElevationM: number | undefined,
  getDem: () => Promise<DemGrid>,
): Promise<SourceResult<PhysicalProfile>> {
  const src = 'Computed from geometry (turf), HydroLAKES / GLOBathy index, terrain model';
  try {
    const [index, dem] = await Promise.all([loadDepthIndex(ctx), getDem().catch(() => null)]);
    const phys = buildPhysical({ identity, nhdElevationM, dem, index });
    return okResult(ctx, src, ctx.upstream.demo ? 'fixture:physical' : 'computed', phys, {
      note: 'Depth, volume and elevation are matched from an index or estimated from terrain; see each value for its method',
    });
  } catch (e) {
    return errorResult(ctx, src, 'computed', e);
  }
}
