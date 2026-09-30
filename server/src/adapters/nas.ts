import type { SourceResult, SpeciesRecord, WaterbodyIdentity } from '@wi/shared';
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

export const NAS_SOURCE = 'USGS Nonindigenous Aquatic Species (NAS)';
export const NAS_LICENSE = 'US public domain (USGS)';

interface NasResponse {
  results?: Array<Record<string, unknown>>;
}

export function nasUrl(base: string, huc8: string): string {
  return withQuery(`${base}/occurrence/search`, [['huc8', huc8]]);
}

const binomial = (n: string) => n.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();

/** Scientific names (lower-case binomials) recorded as nonindigenous in the HUC8. */
export function normalizeNas(raw: NasResponse): Set<string> {
  const out = new Set<string>();
  for (const r of raw.results ?? []) {
    const status = (str(prop(r, 'status')) ?? 'established').toLowerCase();
    if (status === 'failed' || status === 'extirpated') continue;
    const sci =
      str(prop(r, 'scientificName')) ??
      [str(prop(r, 'genus')), str(prop(r, 'species'))].filter(Boolean).join(' ');
    if (sci) out.add(binomial(sci));
  }
  return out;
}

export async function nasIntroduced(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
): Promise<SourceResult<Set<string>>> {
  if (identity.country !== 'US')
    return {
      ...emptyResult<Set<string>>(ctx, NAS_SOURCE, ''),
      status: 'unsupported',
      error: 'Outside the United States',
    };
  if (!identity.huc8)
    return emptyResult(ctx, NAS_SOURCE, '', {
      note: 'No HUC8 for this waterbody, so introduced-species flags are unavailable',
    });
  const url = nasUrl(ctx.config.nas.baseUrl, identity.huc8);
  try {
    const raw = await ctx.upstream.json<NasResponse>({
      source: NAS_SOURCE,
      url,
      ttlMs: ctx.config.ttl.nas,
      fixture: fx(ctx, 'nas'),
    });
    const set = normalizeNas(raw);
    if (!set.size) return emptyResult(ctx, NAS_SOURCE, url, { license: NAS_LICENSE });
    return okResult(ctx, NAS_SOURCE, url, set, {
      license: NAS_LICENSE,
      note: `HUC8 ${identity.huc8}. Introduced means nonindigenous to the region per NAS`,
    });
  } catch (e) {
    return errorResult(ctx, NAS_SOURCE, url, e);
  }
}

/** Flag records whose binomial appears in the NAS set. */
export function applyIntroduced(
  records: SpeciesRecord[],
  nas: Set<string> | null,
): SpeciesRecord[] {
  if (!nas) return records;
  return records.map((r) => ({ ...r, introduced: nas.has(binomial(r.scientificName)) }));
}
