import type { FeatureCollection } from 'geojson';
import {
  USE_LABELS,
  groupCause,
  normalizeUse,
  type ImpairmentProfile,
  type SourceResult,
  type WaterbodyIdentity,
} from '@wi/shared';
import { representativePoint } from '../geom';
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

export const ATTAINS_SOURCE = 'EPA ATTAINS (Assessment, TMDL Tracking and Implementation System)';
export const ATTAINS_LICENSE = 'US public domain (EPA)';

let warnedDemoKey = false;
export function warnIfDemoKey(key: string) {
  if (key === 'DEMO_KEY' && !warnedDemoKey) {
    warnedDemoKey = true;
    console.warn(
      '[attains] ATTAINS_API_KEY is not set; falling back to DEMO_KEY (heavily rate limited). Get a free api.data.gov key.',
    );
  }
}

interface AuRef {
  id: string;
  name: string;
  cycle: string;
  org: string;
  url?: string;
}

async function attainsLayerIds(ctx: AdapterCtx): Promise<number[]> {
  const { attains } = ctx.config;
  try {
    const svc = await ctx.upstream.json<{ layers?: Array<{ id: number; name: string }> }>({
      source: ATTAINS_SOURCE,
      url: `${attains.geoBaseUrl}?f=pjson`,
      ttlMs: ctx.config.ttl.attains,
      fixture: { file: 'attains-layers' },
    });
    const ids = svc.layers?.filter((l) => attains.layerNames.test(l.name)).map((l) => l.id) ?? [];
    if (ids.length) return ids;
  } catch {
    /* fall through to defaults */
  }
  return [1, 2];
}

export function geoQueryUrl(base: string, layer: number, lon: number, lat: number): string {
  return withQuery(`${base}/${layer}/query`, [
    ['geometry', `${lon},${lat}`],
    ['geometryType', 'esriGeometryPoint'],
    ['inSR', 4326],
    ['spatialRel', 'esriSpatialRelIntersects'],
    [
      'outFields',
      'assessmentunitid,assessmentunitname,organizationid,reportingcycle,waterbodyreportlink',
    ],
    ['returnGeometry', 'false'],
    ['f', 'geojson'],
  ]);
}

export function assessmentsUrl(base: string, ids: string[], apiKey: string): string {
  return withQuery(`${base}/assessments`, [
    ['assessmentUnitIdentifier', ids.join(',')],
    ['api_key', apiKey],
  ]);
}

export function normalizeAuRefs(fc: FeatureCollection): AuRef[] {
  const out = new Map<string, AuRef>();
  for (const f of fc.features ?? []) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const id = str(prop(p, 'assessmentunitid'));
    if (!id || out.has(id)) continue;
    const org = str(prop(p, 'organizationid')) ?? '';
    const cycle = str(prop(p, 'reportingcycle')) ?? '';
    out.set(id, {
      id,
      name: str(prop(p, 'assessmentunitname')) ?? id,
      cycle,
      org,
      url:
        str(prop(p, 'waterbodyreportlink')) ??
        (org ? `https://mywaterway.epa.gov/waterbody-report/${org}/${id}/${cycle}` : undefined),
    });
  }
  return [...out.values()];
}

type UseStatus = ImpairmentProfile['uses'][number]['status'];

const USE_STATUS: Record<string, UseStatus> = {
  'fully supporting': 'fully_supporting',
  'not supporting': 'not_supporting',
  'insufficient information': 'insufficient_info',
  'not assessed': 'not_assessed',
  f: 'fully_supporting',
  n: 'not_supporting',
  i: 'insufficient_info',
  x: 'not_assessed',
};

const SEVERITY: Record<UseStatus, number> = {
  not_assessed: 0,
  fully_supporting: 1,
  insufficient_info: 2,
  not_supporting: 3,
};

interface RawAssessment {
  assessmentUnitIdentifier?: string;
  assessmentUnitName?: string;
  cycleLastAssessedText?: string;
  useAttainments?: Array<{
    useName?: string;
    useAttainmentCodeName?: string;
    useAttainmentCode?: string;
  }>;
  parameters?: Array<{
    parameterName?: string;
    parameterStatusName?: string;
    associatedActions?: Array<{
      associatedActionIdentifier?: string;
      associatedActionType?: string;
    }>;
  }>;
}
interface RawAssessmentsResponse {
  items?: Array<{
    organizationIdentifier?: string;
    reportingCycleText?: string;
    assessments?: RawAssessment[];
    reportingCycles?: Array<{ reportingCycleText?: string; assessments?: RawAssessment[] }>;
  }>;
}

const SMALL_WORDS = new Set(['in', 'of', 'and', 'for', 'to', 'the', 'or']);

/** "MERCURY IN FISH TISSUE" -> "Mercury in fish tissue" style title case; keeps parenthesised acronyms. */
export function titleCase(s: string): string {
  const out = s
    .split(/(\s+)/)
    .map((tok, i) => {
      if (/^\s+$/.test(tok) || tok === '') return tok;
      const m = /^(\(?)([^()]*?)(\)?)$/.exec(tok);
      const [, open, core, close] = m ?? ['', '', tok, ''];
      if (open && core.length <= 5 && core === core.toUpperCase() && /[A-Z]/.test(core)) return tok;
      const lower = core.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return open + lower + close;
      return open + lower.charAt(0).toUpperCase() + lower.slice(1) + close;
    })
    .join('');
  return out
    .replace(/\bPcbs\b/g, 'PCBs')
    .replace(/\(PCBS\)/g, '(PCBs)')
    .replace(/\bPfas\b/g, 'PFAS')
    .replace(/\bEscherichia Coli\b/g, 'Escherichia coli')
    .replace(/\bE\. Coli\b/gi, 'E. coli')
    .replace(/\bTmdl\b/g, 'TMDL');
}

/** Merge ATTAINS assessments for several assessment units into one profile (worst use status wins). */
export function normalizeAssessments(
  raw: RawAssessmentsResponse,
  refs: AuRef[],
): ImpairmentProfile {
  const uses = new Map<string, { use: string; status: UseStatus }>();
  const causes = new Map<string, { name: string; group: string; hasTmdl: boolean }>();
  const wanted = new Set(refs.map((r) => r.id));
  const aus = new Map<string, { id: string; name: string; cycle: string; url: string }>();
  const visit = (a: RawAssessment, cycle: string, org: string) => {
    const id = a.assessmentUnitIdentifier;
    if (!id || (wanted.size && !wanted.has(id))) return;
    const ref = refs.find((r) => r.id === id);
    aus.set(id, {
      id,
      name: a.assessmentUnitName ?? ref?.name ?? id,
      cycle: a.cycleLastAssessedText ?? cycle ?? ref?.cycle ?? '',
      url: ref?.url ?? `https://mywaterway.epa.gov/waterbody-report/${org}/${id}/${cycle}`,
    });
    for (const u of a.useAttainments ?? []) {
      const key = normalizeUse(u.useName ?? '');
      const status =
        USE_STATUS[(u.useAttainmentCodeName ?? u.useAttainmentCode ?? '').toLowerCase()] ??
        'not_assessed';
      const label = key === 'other' ? (u.useName ?? 'Other') : USE_LABELS[key];
      const k = key === 'other' ? `other:${label}` : key;
      const cur = uses.get(k);
      if (!cur || SEVERITY[status] > SEVERITY[cur.status]) uses.set(k, { use: label, status });
    }
    for (const p of a.parameters ?? []) {
      if ((p.parameterStatusName ?? '').toLowerCase() !== 'cause') continue;
      const name = titleCase(p.parameterName ?? '');
      if (!name) continue;
      const tmdl = (p.associatedActions?.length ?? 0) > 0;
      const cur = causes.get(name);
      causes.set(name, { name, group: groupCause(name), hasTmdl: tmdl || !!cur?.hasTmdl });
    }
  };
  for (const item of raw.items ?? []) {
    const org = item.organizationIdentifier ?? '';
    for (const a of item.assessments ?? []) visit(a, item.reportingCycleText ?? '', org);
    for (const c of item.reportingCycles ?? [])
      for (const a of c.assessments ?? []) visit(a, c.reportingCycleText ?? '', org);
  }
  return {
    assessmentUnits: [...aus.values()],
    uses: [...uses.values()],
    causes: [...causes.values()],
  };
}

export async function attainsImpairments(
  ctx: AdapterCtx,
  identity: WaterbodyIdentity,
): Promise<SourceResult<ImpairmentProfile>> {
  if (identity.country !== 'US')
    return {
      ...emptyResult<ImpairmentProfile>(ctx, ATTAINS_SOURCE, ''),
      status: 'unsupported',
      error: 'Outside the United States',
    };
  const { attains, ttl } = ctx.config;
  const [lon, lat] = representativePoint(identity.geometry);
  let url = attains.geoBaseUrl;
  try {
    const layers = await attainsLayerIds(ctx);
    const refs = new Map<string, AuRef>();
    for (const layer of layers) {
      url = geoQueryUrl(attains.geoBaseUrl, layer, lon, lat);
      const fc = await ctx.upstream.json<FeatureCollection>({
        source: ATTAINS_SOURCE,
        url,
        ttlMs: ttl.attains,
        fixture: fx(ctx, 'attains-geo'),
      });
      for (const r of normalizeAuRefs(fc)) refs.set(r.id, r);
    }
    if (!refs.size)
      return emptyResult(ctx, ATTAINS_SOURCE, url, {
        license: ATTAINS_LICENSE,
        note: 'No ATTAINS assessment unit covers this waterbody (not assessed)',
      });
    if (!ctx.upstream.demo) warnIfDemoKey(attains.apiKey);
    url = assessmentsUrl(attains.apiBaseUrl, [...refs.keys()], attains.apiKey);
    const raw = await ctx.upstream.json<RawAssessmentsResponse>({
      source: ATTAINS_SOURCE,
      url,
      ttlMs: ttl.attains,
      fixture: fx(ctx, 'attains-assessments'),
    });
    const profile = normalizeAssessments(raw, [...refs.values()]);
    if (!profile.assessmentUnits.length)
      return emptyResult(ctx, ATTAINS_SOURCE, url, {
        license: ATTAINS_LICENSE,
        note: 'Assessment units found but no assessment returned',
      });
    return okResult(ctx, ATTAINS_SOURCE, url, profile, {
      license: ATTAINS_LICENSE,
      note: `Reporting cycle ${profile.assessmentUnits[0]?.cycle}. Assessments are made by states and tribes, may be years old`,
    });
  } catch (e) {
    return errorResult(ctx, ATTAINS_SOURCE, url, e);
  }
}
