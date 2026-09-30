import type { Feature, FeatureCollection, Point } from 'geojson';
import type { ParameterSummary, SourceResult, StationInfo, WaterbodyIdentity } from '@wi/shared';
import { distanceToGeometryM } from '../geom';
import { parseCsv } from '../normalizers/csv';
import { CHARACTERISTIC_QUERY_NAMES, parseResultRows, summarize } from '../normalizers/wqp';
import {
  type AdapterCtx,
  emptyResult,
  errorResult,
  fx,
  okResult,
  prop,
  str,
  withQuery,
} from './common';

export const WQP_SOURCE = 'Water Quality Portal (EPA / USGS / states)';
export const WQP_LICENSE = 'Public domain data from participating agencies; see WQP terms';

/** WQP expects MM-DD-YYYY. */
export function wqpDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${d.getUTCFullYear()}`;
}

function startDate(ctx: AdapterCtx): string {
  const now = ctx.now ? ctx.now() : new Date();
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - ctx.config.wqp.lookbackYears);
  return wqpDate(d);
}

function providersQuery(ctx: AdapterCtx): Array<[string, string]> {
  return ctx.config.wqp.providers.map((p) => ['providers', p] as [string, string]);
}

export function stationUrl(
  ctx: AdapterCtx,
  base: string,
  bbox: [number, number, number, number],
): string {
  return withQuery(`${base}/Station/search`, [
    ['bBox', bbox.map((v) => v.toFixed(5)).join(',')],
    ['mimeType', 'geojson'],
    ...providersQuery(ctx),
    ['startDateLo', startDate(ctx)],
    ['sorted', 'no'],
    ['zip', 'no'],
  ]);
}

export function resultUrl(ctx: AdapterCtx, base: string, siteIds: string[]): string {
  return withQuery(`${base}/Result/search`, [
    ...siteIds.map((s) => ['siteid', s] as [string, string]),
    ...CHARACTERISTIC_QUERY_NAMES.map((c) => ['characteristicName', c] as [string, string]),
    ['mimeType', 'csv'],
    ['dataProfile', 'narrowResult'],
    ...providersQuery(ctx),
    ['startDateLo', startDate(ctx)],
    ['sorted', 'no'],
    ['zip', 'no'],
  ]);
}

function bases(ctx: AdapterCtx): Array<{ name: string; base: string }> {
  const { wqp } = ctx.config;
  // Prefer the legacy profile; fall back to the beta (WQX 3.0) profile only if legacy fails.
  return [
    { name: 'legacy', base: `${wqp.baseUrl}${wqp.legacyPath}` },
    { name: 'beta', base: `${wqp.baseUrl}${wqp.betaPath}` },
  ];
}

export function normalizeStations(
  fc: FeatureCollection,
  identity: WaterbodyIdentity,
  shoreBufferM: number,
  maxSites: number,
): StationInfo[] {
  const out: Array<StationInfo & { d: number }> = [];
  for (const f of fc.features ?? []) {
    const g = (f as Feature<Point>).geometry;
    if (!g || g.type !== 'Point') continue;
    const [lon, lat] = g.coordinates;
    const d = distanceToGeometryM(identity.geometry, lon, lat);
    if (d > shoreBufferM) continue;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const id = str(prop(p, 'MonitoringLocationIdentifier'));
    if (!id) continue;
    out.push({
      id,
      name: str(prop(p, 'MonitoringLocationName')) ?? id,
      lon,
      lat,
      org: str(prop(p, 'OrganizationFormalName')) ?? str(prop(p, 'OrganizationIdentifier')) ?? '',
      d,
    });
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, maxSites)
    .map(({ d: _d, ...s }) => s);
}

export async function wqpStations(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
): Promise<SourceResult<StationInfo[]>> {
  if (identity.country !== 'US')
    return {
      ...emptyResult<StationInfo[]>(ctx, WQP_SOURCE, '', {
        note: 'The Water Quality Portal covers the United States',
      }),
      status: 'unsupported',
      error: 'Outside the United States',
    };
  const { wqp, ttl } = ctx.config;
  const pad = 0.002;
  const [w, s, e, n] = identity.bbox;
  const bbox: [number, number, number, number] = [w - pad, s - pad, e + pad, n + pad];
  let lastUrl = '';
  let lastErr: unknown;
  for (const { base } of bases(ctx)) {
    lastUrl = stationUrl(ctx, base, bbox);
    try {
      const fc = await ctx.upstream.json<FeatureCollection>({
        source: WQP_SOURCE,
        url: lastUrl,
        ttlMs: ttl.wqp,
        fixture: fx(ctx, 'wqp-station'),
      });
      const stations = normalizeStations(fc, identity, wqp.shoreBufferM, wqp.maxSites);
      if (!stations.length)
        return emptyResult(ctx, WQP_SOURCE, lastUrl, {
          license: WQP_LICENSE,
          note: 'No monitoring stations inside or within 100 m of this waterbody',
        });
      return okResult(ctx, WQP_SOURCE, lastUrl, stations, {
        license: WQP_LICENSE,
        note: `${stations.length} stations within 100 m of the shoreline`,
      });
    } catch (e2) {
      lastErr = e2;
    }
  }
  return errorResult(ctx, WQP_SOURCE, lastUrl, lastErr);
}

export async function wqpQuality(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
  stations: StationInfo[],
): Promise<SourceResult<ParameterSummary[]>> {
  if (identity.country !== 'US')
    return {
      ...emptyResult<ParameterSummary[]>(ctx, WQP_SOURCE, ''),
      status: 'unsupported',
      error: 'Outside the United States',
    };
  if (!stations.length)
    return emptyResult(ctx, WQP_SOURCE, '', {
      license: WQP_LICENSE,
      note: 'No monitoring stations to query',
    });
  const { wqp, ttl } = ctx.config;
  const ids = stations.map((s) => s.id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += wqp.sitesPerRequest)
    batches.push(ids.slice(i, i + wqp.sitesPerRequest));
  let firstUrl = '';
  let lastErr: unknown;
  for (const { base } of bases(ctx)) {
    try {
      const rows: Array<Record<string, string>> = [];
      for (const batch of batches) {
        const url = resultUrl(ctx, base, batch);
        if (!firstUrl) firstUrl = url;
        const text = await ctx.upstream.text({
          source: WQP_SOURCE,
          url,
          ttlMs: ttl.wqp,
          fixture: fx(ctx, 'wqp-result'),
        });
        rows.push(...parseCsv(text));
      }
      const parsed = parseResultRows(rows, new Set(ids));
      const summaries = summarize(parsed);
      if (!summaries.length)
        return emptyResult(ctx, WQP_SOURCE, firstUrl, {
          license: WQP_LICENSE,
          note: 'No results for the tracked characteristics in the last 5 years',
        });
      const latest = summaries
        .map((s) => s.latest?.date ?? '')
        .sort()
        .pop();
      return okResult(ctx, WQP_SOURCE, firstUrl, summaries, {
        license: WQP_LICENSE,
        note: `${rows.length} result rows from ${stations.length} stations; most recent sample ${latest}. Values are converted to common units`,
      });
    } catch (e) {
      lastErr = e;
      firstUrl = '';
    }
  }
  return errorResult(ctx, WQP_SOURCE, firstUrl, lastErr);
}
