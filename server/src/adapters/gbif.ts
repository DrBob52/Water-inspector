import {
  buildGbifWkt,
  findCatalogEntry,
  groupFromTaxonomy,
  type SourceResult,
  type SpeciesGroup,
  type SpeciesRecord,
  type WaterbodyIdentity,
} from '@wi/shared';
import { polygonize } from '../geom';
import {
  type AdapterCtx,
  emptyResult,
  errorResult,
  fx,
  num,
  okResult,
  str,
  withQuery,
} from './common';

export const GBIF_SOURCE = 'GBIF occurrence search';
export const GBIF_LICENSE =
  'Records carry per-dataset licenses (CC0, CC BY, CC BY-NC); see gbif.org';

interface FacetResponse {
  count?: number;
  facets?: Array<{ field: string; counts: Array<{ name: string; count: number }> }>;
}

interface SpeciesDetail {
  key: number;
  scientificName?: string;
  canonicalName?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
}

interface Vernacular {
  results?: Array<{ vernacularName?: string; language?: string }>;
}

interface MatchResponse {
  usageKey?: number;
}

/** Resolve a higher taxon name to a GBIF usage key (cached for 30 days by the upstream layer). */
export async function resolveTaxonKey(ctx: AdapterCtx, name: string): Promise<number | undefined> {
  const url = withQuery(`${ctx.config.gbif.baseUrl}/species/match`, [['name', name]]);
  const m = await ctx.upstream.json<MatchResponse>({
    source: GBIF_SOURCE,
    url,
    ttlMs: ctx.config.ttl.nas,
    fixture: { file: 'gbif-match', path: ['matches', name] },
  });
  return num(m.usageKey);
}

export function occurrenceFacetUrl(base: string, wkt: string, taxonKeys: number[]): string {
  return withQuery(`${base}/occurrence/search`, [
    ['geometry', wkt],
    ['hasCoordinate', 'true'],
    ['occurrenceStatus', 'PRESENT'],
    ['facet', 'speciesKey'],
    ['limit', 0],
    ['facetLimit', 200],
    ...taxonKeys.map((k) => ['taxonKey', k] as [string, number]),
  ]);
}

export function yearFacetUrl(base: string, wkt: string, speciesKey: number): string {
  return withQuery(`${base}/occurrence/search`, [
    ['geometry', wkt],
    ['hasCoordinate', 'true'],
    ['occurrenceStatus', 'PRESENT'],
    ['speciesKey', speciesKey],
    ['facet', 'year'],
    ['limit', 0],
    ['facetLimit', 200],
  ]);
}

/** Run `fn` over `items` with at most `n` in flight; stops taking new work after the deadline. */
async function pool<T, R>(
  items: T[],
  n: number,
  deadline: number,
  fn: (x: T) => Promise<R>,
): Promise<Array<R | undefined>> {
  const out: Array<R | undefined> = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (Date.now() > deadline) return;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

export interface GbifOptions {
  budgetMs?: number;
}

export async function gbifSpecies(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
  opts: GbifOptions = {},
): Promise<SourceResult<SpeciesRecord[]>> {
  const { gbif, ttl } = ctx.config;
  const deadline = Date.now() + (opts.budgetMs ?? gbif.budgetMs);
  const wkt = buildGbifWkt(polygonize(identity.geometry, 100)).wkt;
  let firstUrl = '';
  try {
    // 1. Species keys and counts per taxonomic group.
    const names = [...new Set(gbif.groups.flatMap((g) => g.names))];
    const settled = await Promise.allSettled(names.map((n) => resolveTaxonKey(ctx, n)));
    const keyByName = new Map<string, number>();
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value !== undefined) keyByName.set(names[i], r.value);
    });
    if (!keyByName.size) {
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    }
    const groupResults = await Promise.all(
      gbif.groups.map(async (g) => {
        const keys = g.names
          .map((n) => keyByName.get(n))
          .filter((k): k is number => k !== undefined);
        if (!keys.length)
          return {
            group: g.id as SpeciesGroup,
            counts: [] as Array<{ name: string; count: number }>,
          };
        const url = occurrenceFacetUrl(gbif.baseUrl, wkt, keys);
        if (!firstUrl) firstUrl = url;
        const r = await ctx.upstream.json<FacetResponse>({
          source: GBIF_SOURCE,
          url,
          ttlMs: ttl.gbif,
          fixture: fx(ctx, 'gbif-facets', ['groups', g.id]),
        });
        const counts = r.facets?.find((f) => f.field === 'SPECIES_KEY')?.counts ?? [];
        return { group: g.id as SpeciesGroup, counts };
      }),
    );
    const flat = groupResults
      .flatMap((g) =>
        g.counts.map((c) => ({ key: Number(c.name), count: c.count, group: g.group })),
      )
      .filter((x) => Number.isFinite(x.key));
    flat.sort((a, b) => b.count - a.count);
    if (!flat.length)
      return emptyResult(ctx, GBIF_SOURCE, firstUrl, {
        license: GBIF_LICENSE,
        note: 'No GBIF occurrence records in this waterbody for the tracked groups',
      });

    // 2. Names and taxonomy for the most-recorded species.
    const top = flat.slice(0, gbif.maxSpeciesDetails);
    const details = await pool(top, ctx.config.maxConcurrentPerHost, deadline, (x) =>
      ctx.upstream.json<SpeciesDetail>({
        source: GBIF_SOURCE,
        url: `${gbif.baseUrl}/species/${x.key}`,
        ttlMs: ttl.gbif,
        fixture: fx(ctx, 'gbif-species', ['species', String(x.key)]),
      }),
    );

    // 3. Common names for species neither GBIF nor the catalog names.
    const needVern = top
      .map((x, i) => ({ x, d: details[i] }))
      .filter(
        ({ d }) =>
          d && !d.vernacularName && !findCatalogEntry(d.canonicalName ?? d.scientificName ?? ''),
      )
      .slice(0, gbif.maxVernacular);
    const verns = await pool(needVern, ctx.config.maxConcurrentPerHost, deadline, ({ x }) =>
      ctx.upstream.json<Vernacular>({
        source: GBIF_SOURCE,
        url: `${gbif.baseUrl}/species/${x.key}/vernacularNames?limit=50`,
        ttlMs: ttl.gbif,
        fixture: fx(ctx, 'gbif-species', ['vernacular', String(x.key)]),
      }),
    );
    const vernByKey = new Map<number, string>();
    needVern.forEach(({ x }, i) => {
      const eng = verns[i]?.results?.find((v) => v.language === 'eng')?.vernacularName;
      if (eng) vernByKey.set(x.key, eng);
    });

    // 4. Last observed year for the top species.
    const topYears = top.slice(0, gbif.maxLastObserved);
    const years = await pool(topYears, ctx.config.maxConcurrentPerHost, deadline, (x) =>
      ctx.upstream.json<FacetResponse>({
        source: GBIF_SOURCE,
        url: yearFacetUrl(gbif.baseUrl, wkt, x.key),
        ttlMs: ttl.gbif,
        fixture: fx(ctx, 'gbif-years', ['species', String(x.key)]),
      }),
    );
    const lastByKey = new Map<number, string>();
    topYears.forEach((x, i) => {
      const ys = years[i]?.facets
        ?.find((f) => f.field === 'YEAR')
        ?.counts.map((c) => Number(c.name))
        .filter(Number.isFinite);
      if (ys?.length) lastByKey.set(x.key, String(Math.max(...ys)));
    });

    const records: SpeciesRecord[] = [];
    top.forEach((x, i) => {
      const d = details[i];
      if (!d) return;
      const sci = d.canonicalName ?? d.scientificName;
      if (!sci) return;
      const cat = findCatalogEntry(sci);
      const group =
        x.group ??
        groupFromTaxonomy({ class: d.class, order: d.order, kingdom: d.kingdom, phylum: d.phylum });
      records.push({
        gbifKey: x.key,
        scientificName: sci,
        commonName: cat?.commonName ?? str(d.vernacularName) ?? vernByKey.get(x.key) ?? null,
        group,
        recordCount: x.count,
        lastObserved: lastByKey.get(x.key),
        introduced: false,
        iucn: cat?.iucn,
        catalogId: cat?.id,
        family: d.family,
        order: d.order,
        taxClass: d.class,
      });
    });
    if (!records.length) return emptyResult(ctx, GBIF_SOURCE, firstUrl, { license: GBIF_LICENSE });
    return okResult(ctx, GBIF_SOURCE, firstUrl, records, {
      license: GBIF_LICENSE,
      note: `${flat.length} species with records; details for the ${records.length} most recorded. Counts are occurrence records, not population sizes`,
    });
  } catch (e) {
    return errorResult(ctx, GBIF_SOURCE, firstUrl, e);
  }
}
