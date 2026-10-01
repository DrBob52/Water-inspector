import type { Polygon, MultiPolygon } from 'geojson';
import { SPECIES_CATALOG, resolveTraits } from './catalog';
import { bufferPolyline, makeProjection, ringArea, type Ring } from './geo';
import { causeToParameter } from './impairments';
import { PARAMETERS } from './parameters';
import { thresholdRatio } from './thresholds';
import type {
  CatalogSpecies,
  ImpairmentProfile,
  ParameterKey,
  ParameterSummary,
  PhysicalProfile,
  PollutantDetail,
  SceneActor,
  SceneModel,
  SourceResult,
  SpeciesRecord,
  StationInfo,
  WaterbodyIdentity,
} from './types';

export interface SceneModelInput {
  identity: WaterbodyIdentity;
  physical?: SourceResult<PhysicalProfile> | null;
  quality?: SourceResult<ParameterSummary[]> | null;
  impairments?: SourceResult<ImpairmentProfile> | null;
  life?: SourceResult<SpeciesRecord[]> | null;
  stations?: SourceResult<StationInfo[]> | null;
  demo?: boolean;
}

export interface SceneModelOptions {
  /** Scientific name to force into the on-screen species (e.g. chosen from the Life tab). */
  pinnedSpecies?: string | null;
  maxSpecies?: number;
  maxActors?: number;
}

export const MAX_SPECIES = 12;
export const MAX_ACTORS = 250;
export const MAX_OUTLINE_VERTICES = 400;

/** count = clamp(round(4 * log10(recordCount + 1)), 1, 24) */
export function actorCount(recordCount: number): number {
  return Math.max(1, Math.min(24, Math.round(4 * Math.log10(recordCount + 1))));
}

// Water visibility and tint -------------------------------------------------------------------

export function computeVisibility(secchiM?: number, ntu?: number): number {
  if (secchiM !== undefined && secchiM > 0) return Math.max(0.3, Math.min(60, 1.5 * secchiM));
  if (ntu !== undefined && ntu >= 0) return Math.max(0.3, Math.min(30, 8 / (ntu + 0.3)));
  return 5;
}

const hex = (r: number, g: number, b: number) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** Bluer when clear, green with high chlorophyll-a, brown with high turbidity. */
export function computeWaterTint(chlorophyllUgL?: number, ntu?: number): string {
  const clear = [14, 86, 146];
  const green = [58, 140, 66];
  const brown = [128, 98, 58];
  let c = clear;
  if (chlorophyllUgL !== undefined) c = mix(c, green, Math.min(1, chlorophyllUgL / 45) * 0.85);
  if (ntu !== undefined) c = mix(c, brown, Math.min(1, ntu / 45) * 0.8);
  return hex(c[0], c[1], c[2]);
}

// Outline ---------------------------------------------------------------------------------------

function douglasPeucker(pts: Ring, tol: number): Ring {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring (open form: first point not repeated) to at most `max` vertices. */
export function simplifyRing(ring: Ring, max = MAX_OUTLINE_VERTICES): Ring {
  if (ring.length <= max) return ring;
  // Anchor on the two points that are furthest apart so the split halves are well conditioned.
  let ai = 0;
  let bi = 0;
  let best = -1;
  const step = Math.max(1, Math.floor(ring.length / 200));
  for (let i = 0; i < ring.length; i += step) {
    for (let j = i + 1; j < ring.length; j += step) {
      const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2;
      if (d > best) {
        best = d;
        ai = i;
        bi = j;
      }
    }
  }
  if (ai > bi) [ai, bi] = [bi, ai];
  const half1 = ring.slice(ai, bi + 1);
  const half2 = [...ring.slice(bi), ...ring.slice(0, ai + 1)];
  const run = (tol: number): Ring => {
    const a = douglasPeucker(half1, tol);
    const b = douglasPeucker(half2, tol);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  };
  let lo = 0;
  let hi = Math.sqrt(best);
  let out = run(hi);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = run(mid);
    if (r.length > max) lo = mid;
    else {
      hi = mid;
      out = r;
    }
  }
  return out.length >= 3 ? out : ring.slice(0, max);
}

function exteriorRing(g: Polygon | MultiPolygon): Array<[number, number]> {
  if (g.type === 'Polygon') return g.coordinates[0] as Array<[number, number]>;
  let best = g.coordinates[0][0];
  let bestArea = -1;
  for (const p of g.coordinates) {
    const a = Math.abs(ringArea(p[0] as Ring));
    if (a > bestArea) {
      bestArea = a;
      best = p[0];
    }
  }
  return best as Array<[number, number]>;
}

/** Local-metre outline (CCW, open ring, centred on the centroid, at most 400 vertices). */
export function buildOutline(identity: WaterbodyIdentity, riverWidthM?: number): Ring {
  const g = identity.geometry;
  const proj = makeProjection(identity.centroid);
  let ring: Ring;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    ring = exteriorRing(g).map(([lon, lat]) => proj.toLocal(lon, lat));
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring = ring.slice(0, -1);
    if (ringArea(ring) < 0) ring = ring.slice().reverse();
  } else {
    // A river centre line: buffer it by half the reach width into a thin polygon.
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), lines[0]);
    const local: Ring = longest.map(([lon, lat]) => proj.toLocal(lon, lat));
    ring = bufferPolyline(local, Math.max(8, (riverWidthM ?? 60) / 2));
  }
  return simplifyRing(ring, MAX_OUTLINE_VERTICES);
}

// Thermocline and dissolved-oxygen profile ---------------------------------------------------

function thermocline(
  temp: ParameterSummary | undefined,
  maxDepthM: number,
  extentM: number,
): { depth: number; estimated: boolean } | undefined {
  if (maxDepthM <= 6) return undefined;
  const prof = temp?.depthProfile;
  if (prof && prof.length >= 3) {
    const pts = [...prof].sort((a, b) => a.depthM - b.depthM);
    const range = pts[0].value - pts[pts.length - 1].value;
    if (range >= 3) {
      let best = 0;
      let bestDepth = pts[0].depthM;
      for (let i = 1; i < pts.length; i++) {
        const g =
          (pts[i - 1].value - pts[i].value) / Math.max(0.01, pts[i].depthM - pts[i - 1].depthM);
        if (g > best) {
          best = g;
          bestDepth = (pts[i].depthM + pts[i - 1].depthM) / 2;
        }
      }
      return { depth: bestDepth, estimated: false };
    }
    return undefined;
  }
  const latest = temp?.latest;
  if (latest && latest.value >= 15) {
    const month = Number(latest.date.slice(5, 7));
    if (month >= 5 && month <= 9) {
      const fetchKm = extentM / 1000;
      const z = Math.max(2, Math.min(0.6 * maxDepthM, 3.95 * Math.sqrt(Math.max(fetchKm, 0.05))));
      return { depth: Math.round(z * 10) / 10, estimated: true };
    }
  }
  return undefined;
}

// Main -----------------------------------------------------------------------------------------

/** Pure function of the profile: everything the 3D scenes need, with no fetching in the scenes. */
export function buildSceneModel(
  profile: SceneModelInput,
  catalog: CatalogSpecies[] = SPECIES_CATALOG,
  opts: SceneModelOptions = {},
): SceneModel {
  const { identity } = profile;
  const isRiver = identity.type === 'river' || identity.type === 'stream';
  const phys = profile.physical?.data ?? undefined;
  const params = profile.quality?.data ?? [];
  const get = (k: ParameterKey) => params.find((p) => p.key === k);

  const widthHint =
    phys && phys.lengthKm && phys.areaKm2
      ? (phys.areaKm2.value * 1e6) / (phys.lengthKm.value * 1000)
      : undefined;
  const outline = buildOutline(identity, widthHint);
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

  // Depth
  let maxDepthM = phys?.maxDepthM?.value;
  let meanDepthM = phys?.meanDepthM?.value;
  let depthEstimated = phys?.maxDepthM?.estimated ?? true;
  if (maxDepthM === undefined) {
    maxDepthM = isRiver ? 4 : 5;
    depthEstimated = true;
  }
  if (meanDepthM === undefined) meanDepthM = isRiver ? (maxDepthM * 2) / 3 : maxDepthM * 0.5;

  const secchi = get('secchi_depth')?.latest?.value;
  const ntu = get('turbidity')?.latest?.value;
  const chl = get('chlorophyll_a')?.latest?.value;
  const temp = get('water_temp');
  const doParam = get('dissolved_oxygen');

  const th = thermocline(temp, maxDepthM, extent);

  // Actors
  const maxSpecies = opts.maxSpecies ?? MAX_SPECIES;
  const maxActors = opts.maxActors ?? MAX_ACTORS;
  const records = (profile.life?.data ?? []).filter(
    (r) => r.group !== 'plant' && r.group !== 'cyanobacteria' && r.group !== 'other',
  );
  const plantCount = (profile.life?.data ?? []).filter((r) => r.group === 'plant').length;
  const sorted = [...records].sort((a, b) => b.recordCount - a.recordCount);
  let chosen = sorted.slice(0, maxSpecies);
  const pinned = opts.pinnedSpecies
    ? sorted.find((r) => r.scientificName === opts.pinnedSpecies)
    : undefined;
  if (pinned && !chosen.includes(pinned)) chosen = [...chosen.slice(0, maxSpecies - 1), pinned];
  if (!chosen.some((r) => r.introduced)) {
    const intro = sorted.find((r) => r.introduced);
    if (intro) {
      const dropIdx = [...chosen]
        .map((r, i) => ({ r, i }))
        .reverse()
        .find(({ r }) => r !== pinned)?.i;
      if (dropIdx !== undefined) chosen = chosen.map((r, i) => (i === dropIdx ? intro : r));
      else chosen = [...chosen, intro];
    }
  }
  chosen.sort((a, b) => b.recordCount - a.recordCount);
  const actors: SceneActor[] = chosen.map((r) => {
    const t = resolveTraits(r, catalog);
    const [lo, hi] = t.lengthCm;
    return {
      key: r.scientificName,
      catalogId: t.catalogId,
      archetype: t.archetype,
      count: actorCount(r.recordCount),
      depthBand: t.depthBand,
      lengthCm: (lo + hi) / 2,
      colors: t.colors,
      introduced: r.introduced,
      label: r.commonName ?? r.scientificName,
      scientificName: r.scientificName,
      recordCount: r.recordCount,
      schooling: t.schooling,
      group: r.group,
      ...(pinned && r === pinned ? { pinned: true } : {}),
    };
  });
  // Cap the total number of animated things.
  let total = actors.reduce((s, a) => s + a.count, 0);
  while (total > maxActors) {
    const biggest = actors.reduce((m, a) => (a.count > m.count ? a : m), actors[0]);
    if (biggest.count <= 1) break;
    biggest.count--;
    total--;
  }

  // Pollutants
  const pollutants: SceneModel['pollutants'] = [];
  const pollutantDetails: PollutantDetail[] = [];
  for (const p of params) {
    const meta = PARAMETERS[p.key];
    if (!meta.pollutant || !p.latest || !p.threshold) continue;
    const ratio = thresholdRatio(p.latest.value, p.threshold);
    if (ratio === null || !(ratio > 0)) continue;
    pollutants.push({ key: p.key, ratio, label: meta.label });
    pollutantDetails.push({
      key: p.key,
      label: meta.label,
      value: p.latest.value,
      unit: p.unit,
      threshold: p.threshold.value,
      thresholdLabel: p.threshold.label,
      ratio,
      date: p.latest.date,
    });
  }
  pollutants.sort((a, b) => b.ratio - a.ratio);
  pollutantDetails.sort((a, b) => b.ratio - a.ratio);

  const listedImpairments = (profile.impairments?.data?.causes ?? []).map((c) => {
    const key = causeToParameter(c.name);
    const measured = key && params.some((p) => p.key === key && p.latest) ? key : undefined;
    return {
      name: c.name,
      group: c.group,
      hasTmdl: c.hasTmdl,
      ...(measured ? { measuredKey: measured } : {}),
    };
  });

  const doProfile = doParam?.depthProfile?.length
    ? doParam.depthProfile.map((d) => ({ depthM: d.depthM, mgL: d.value }))
    : undefined;

  return {
    outline,
    maxDepthM,
    meanDepthM,
    depthEstimated,
    visibilityM: Math.round(computeVisibility(secchi, ntu) * 10) / 10,
    waterTint: computeWaterTint(chl, ntu),
    ...(temp?.latest ? { surfaceTempC: temp.latest.value } : {}),
    ...(th ? { thermoclineM: th.depth, thermoclineEstimated: th.estimated } : {}),
    ...(doProfile ? { doProfile } : {}),
    ...(doParam?.latest ? { surfaceDoMgL: doParam.latest.value } : {}),
    actors,
    pollutants,
    pollutantDetails,
    listedImpairments,
    isRiver,
    surfaceElevationM: phys?.surfaceElevationM?.value ?? 0,
    stations: profile.stations?.data ?? [],
    ...(ntu !== undefined ? { turbidityNtu: ntu } : {}),
    ...(chl !== undefined ? { chlorophyllUgL: chl } : {}),
    plantCount,
    name: identity.name ?? `Unnamed ${identity.type === 'unknown' ? 'waterbody' : identity.type}`,
    origin: identity.centroid,
    demo: profile.demo ?? false,
  };
}
