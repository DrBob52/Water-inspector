import { type AdapterCtx, errorResult, num, okResult, str, withQuery } from './common';
import type { SourceResult } from '@wi/shared';

export const NOMINATIM_SOURCE = 'OpenStreetMap Nominatim';
export const NOMINATIM_LICENSE = 'ODbL 1.0, © OpenStreetMap contributors';

export interface SearchHit {
  name: string;
  displayName: string;
  lon: number;
  lat: number;
  /** [west, south, east, north] */
  bbox?: [number, number, number, number];
  kind?: string;
}

interface NominatimResult {
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: string[];
  type?: string;
  category?: string;
  class?: string;
}

export function searchUrl(base: string, q: string, limit = 8): string {
  return withQuery(base, [
    ['q', q],
    ['format', 'jsonv2'],
    ['limit', limit],
    ['addressdetails', 0],
  ]);
}

export function normalizeSearch(raw: NominatimResult[]): SearchHit[] {
  const out: SearchHit[] = [];
  for (const r of raw) {
    const lat = num(r.lat);
    const lon = num(r.lon);
    if (lat === undefined || lon === undefined) continue;
    const bb = r.boundingbox?.map(Number);
    out.push({
      name: str(r.name) ?? str(r.display_name)?.split(',')[0] ?? 'Unnamed place',
      displayName: str(r.display_name) ?? '',
      lon,
      lat,
      // Nominatim order is [south, north, west, east]
      bbox:
        bb && bb.length === 4 && bb.every(Number.isFinite)
          ? [bb[2], bb[0], bb[3], bb[1]]
          : undefined,
      kind: str(r.type),
    });
  }
  return out;
}

export async function searchPlaces(ctx: AdapterCtx, q: string): Promise<SourceResult<SearchHit[]>> {
  const url = searchUrl(ctx.config.nominatim.searchUrl, q);
  try {
    const raw = await ctx.upstream.json<NominatimResult[] | { results: NominatimResult[] }>({
      source: NOMINATIM_SOURCE,
      url,
      ttlMs: ctx.config.ttl.search,
      fixture: { file: 'nominatim-search' },
    });
    let list = Array.isArray(raw) ? raw : raw.results;
    if (ctx.upstream.demo) {
      // The demo fixture holds a fixed set of places; filter it the way a search would.
      const needle = q.trim().toLowerCase();
      list = list.filter((r) =>
        `${r.name ?? ''} ${r.display_name ?? ''}`.toLowerCase().includes(needle),
      );
    }
    const hits = normalizeSearch(list);
    if (!hits.length)
      return {
        ...okResult<SearchHit[]>(ctx, NOMINATIM_SOURCE, url, [], { license: NOMINATIM_LICENSE }),
        status: 'empty',
        data: null,
      };
    return okResult(ctx, NOMINATIM_SOURCE, url, hits, { license: NOMINATIM_LICENSE });
  } catch (e) {
    return errorResult(ctx, NOMINATIM_SOURCE, url, e);
  }
}

/** Reverse geocode to a US state abbreviation (for waterbodies whose source has no state). */
export async function reverseState(
  ctx: AdapterCtx,
  lon: number,
  lat: number,
): Promise<string | undefined> {
  if (ctx.upstream.demo) return undefined;
  const url = withQuery(ctx.config.nominatim.reverseUrl, [
    ['lat', lat],
    ['lon', lon],
    ['zoom', 5],
    ['format', 'jsonv2'],
    ['addressdetails', 1],
  ]);
  try {
    const raw = await ctx.upstream.json<{ address?: Record<string, string> }>({
      source: NOMINATIM_SOURCE,
      url,
      ttlMs: ctx.config.ttl.nhd,
    });
    const iso = raw.address?.['ISO3166-2-lvl4'];
    return iso?.startsWith('US-') ? iso.slice(3) : (raw.address?.state ?? undefined);
  } catch {
    return undefined;
  }
}
