import type { Provenance, SourceResult, SourceStatus } from '@wi/shared';
import type { Config } from '../config';
import { DemoUnavailableError, redactUrl, type FixtureRef, type Upstream } from '../http';

export const DEMO_NOTE = 'Illustrative sample data, not live measurements';

export interface AdapterCtx {
  config: Config;
  upstream: Upstream;
  /** Demo waterbody slug, when the request is about a specific demo waterbody. */
  slug?: string;
  now?: () => Date;
}

export const nowIso = (ctx: AdapterCtx) => (ctx.now ? ctx.now() : new Date()).toISOString();

export function fx(ctx: AdapterCtx, file: string, path?: string[]): FixtureRef {
  return { file, slug: ctx.slug, path };
}

export function makeProvenance(
  ctx: AdapterCtx,
  source: string,
  url: string,
  extra: Partial<Provenance> = {},
): Provenance {
  const note = [extra.note, ctx.upstream.demo ? DEMO_NOTE : undefined].filter(Boolean).join('. ');
  return {
    source,
    url: redactUrl(url),
    retrievedAt: nowIso(ctx),
    ...extra,
    ...(note ? { note } : {}),
  };
}

function result<T>(
  status: SourceStatus,
  data: T | null,
  provenance: Provenance,
  error?: string,
): SourceResult<T> {
  return error ? { status, data, provenance, error } : { status, data, provenance };
}

export const okResult = <T>(
  ctx: AdapterCtx,
  source: string,
  url: string,
  data: T,
  extra?: Partial<Provenance>,
) => result<T>('ok', data, makeProvenance(ctx, source, url, extra));

export const emptyResult = <T>(
  ctx: AdapterCtx,
  source: string,
  url: string,
  extra?: Partial<Provenance>,
) => result<T>('empty', null, makeProvenance(ctx, source, url, extra));

export const unsupportedResult = <T>(ctx: AdapterCtx, source: string, reason: string) =>
  result<T>('unsupported', null, makeProvenance(ctx, source, '', { note: reason }), reason);

export function errorResult<T>(
  ctx: AdapterCtx,
  source: string,
  url: string,
  err: unknown,
): SourceResult<T> {
  if (err instanceof DemoUnavailableError) {
    return result<T>(
      'empty',
      null,
      makeProvenance(ctx, source, url, { note: 'No demo sample for this waterbody' }),
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return result<T>('error', null, makeProvenance(ctx, source, url), msg);
}

export function withQuery(
  base: string,
  params: Array<[string, string | number | undefined]>,
): string {
  const q = params
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return q ? `${base}${base.includes('?') ? '&' : '?'}${q}` : base;
}

/** Case-insensitive property lookup, because ArcGIS services differ in field-name casing. */
export function prop(props: Record<string, unknown> | null | undefined, name: string): unknown {
  if (!props) return undefined;
  if (name in props) return props[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
  return undefined;
}

export const str = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);
export const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
