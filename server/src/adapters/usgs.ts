import type { Feature, FeatureCollection, Point } from 'geojson';
import {
  PARAMETERS,
  THRESHOLDS,
  convertToCanonical,
  evaluateStatus,
  type ParameterKey,
  type ParameterSummary,
  type SourceResult,
  type WaterbodyIdentity,
} from '@wi/shared';
import { distanceToGeometryM } from '../geom';
import {
  type AdapterCtx,
  emptyResult,
  errorResult,
  fx,
  num,
  okResult,
  prop,
  str,
  withQuery,
} from './common';

export const USGS_SOURCE = 'USGS Water Data OGC API (latest continuous values)';
export const USGS_LICENSE = 'US public domain (USGS). Provisional data, subject to revision';

export interface LatestValue {
  key: ParameterKey;
  value: number;
  unit: string;
  time: string;
  siteId: string;
}

export function latestUrl(ctx: AdapterCtx, bbox: [number, number, number, number]): string {
  const { usgs } = ctx.config;
  return withQuery(`${usgs.baseUrl}/collections/latest-continuous/items`, [
    ['bbox', bbox.map((v) => v.toFixed(5)).join(',')],
    ['parameter_code', Object.keys(usgs.parameterCodes).join(',')],
    ['f', 'json'],
    ['limit', 200],
  ]);
}

export function normalizeLatest(
  ctx: AdapterCtx,
  fc: FeatureCollection,
  identity: WaterbodyIdentity,
): LatestValue[] {
  const out: LatestValue[] = [];
  for (const f of fc.features ?? []) {
    const g = (f as Feature<Point>).geometry;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    if (
      g?.type === 'Point' &&
      distanceToGeometryM(identity.geometry, g.coordinates[0], g.coordinates[1]) >
        ctx.config.wqp.shoreBufferM
    )
      continue;
    const code = str(prop(p, 'parameter_code'));
    const key = code
      ? (ctx.config.usgs.parameterCodes[code] as ParameterKey | undefined)
      : undefined;
    const raw = num(prop(p, 'value'));
    const time = str(prop(p, 'time'));
    if (!key || raw === undefined || !time) continue;
    const conv = convertToCanonical(key, raw, str(prop(p, 'unit_of_measure')));
    if (!conv) continue;
    out.push({
      key,
      value: conv.value,
      unit: conv.unit,
      time,
      siteId: str(prop(p, 'monitoring_location_id')) ?? 'usgs',
    });
  }
  return out;
}

export async function usgsLatest(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
): Promise<SourceResult<LatestValue[]>> {
  if (identity.country !== 'US')
    return {
      ...emptyResult<LatestValue[]>(ctx, USGS_SOURCE, ''),
      status: 'unsupported',
      error: 'Outside the United States',
    };
  const url = latestUrl(ctx, identity.bbox);
  try {
    const fc = await ctx.upstream.json<FeatureCollection>({
      source: USGS_SOURCE,
      url,
      ttlMs: ctx.config.ttl.usgsContinuous,
      fixture: fx(ctx, 'usgs-latest'),
    });
    const vals = normalizeLatest(ctx, fc, identity);
    if (!vals.length)
      return emptyResult(ctx, USGS_SOURCE, url, {
        license: USGS_LICENSE,
        note: 'No near-real-time USGS sensors on this waterbody',
      });
    return okResult(ctx, USGS_SOURCE, url, vals, { license: USGS_LICENSE });
  } catch (e) {
    return errorResult(ctx, USGS_SOURCE, url, e);
  }
}

/** Fold near-real-time values into the WQP summaries: newer readings replace "latest" and extend the series. */
export function mergeLatest(
  summaries: ParameterSummary[],
  latest: LatestValue[],
): ParameterSummary[] {
  const out = summaries.map((s) => ({ ...s, series: [...s.series] }));
  for (const lv of latest) {
    const s = out.find((x) => x.key === lv.key);
    const date = lv.time.slice(0, 10);
    if (!s) continue;
    if (!s.latest || date >= s.latest.date) {
      s.latest = { value: lv.value, date, stationId: lv.siteId };
      s.series.push({ t: date, v: lv.value });
      s.max = Math.max(s.max ?? lv.value, lv.value);
      s.min = Math.min(s.min ?? lv.value, lv.value);
      s.note = [s.note, 'Latest value from a USGS near-real-time sensor (provisional)']
        .filter(Boolean)
        .join(' ');
    }
  }
  return out;
}

/** Summaries built only from near-real-time values (used when the WQP has nothing for the waterbody). */
export function summariesFromLatest(latest: LatestValue[]): ParameterSummary[] {
  const out: ParameterSummary[] = [];
  for (const lv of latest) {
    const meta = PARAMETERS[lv.key];
    const threshold = THRESHOLDS[lv.key];
    out.push({
      key: lv.key,
      label: meta.label,
      unit: meta.unit,
      latest: { value: lv.value, date: lv.time.slice(0, 10), stationId: lv.siteId },
      median5y: null,
      min: lv.value,
      max: lv.value,
      sampleCount: 1,
      series: [{ t: lv.time.slice(0, 10), v: lv.value }],
      status: evaluateStatus(lv.value, threshold),
      ...(threshold ? { threshold } : {}),
      note: 'Single near-real-time USGS sensor reading (provisional); no 5-year history available',
    });
  }
  return out;
}
