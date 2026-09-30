import type {
  IdentityResponse,
  ImpairmentProfile,
  ParameterSummary,
  PhysicalProfile,
  Provenance,
  SourceRecord,
  SourceResult,
  SpeciesRecord,
  StationInfo,
  WaterbodyIdentity,
  WaterbodyProfile,
  DemGrid,
} from '@wi/shared';
import type { Cache } from './cache';
import type { Config } from './config';
import { DemoUnavailableError, type Upstream } from './http';
import { slugFromId, type FixtureStore } from './fixtures';
import { DEMO_NOTE, errorResult, makeProvenance, type AdapterCtx } from './adapters/common';
import { huc8AtPoint, identityProvenance, nhdIdentityAt, nhdIdentityById } from './adapters/nhd';
import { osmIdentityAt, osmIdentityById, OSM_LICENSE, OSM_SOURCE } from './adapters/osm';
import { reverseState } from './adapters/nominatim';
import { physicalSection } from './adapters/depth';
import { wqpQuality, wqpStations } from './adapters/wqp';
import { mergeLatest, summariesFromLatest, usgsLatest } from './adapters/usgs';
import { attainsImpairments } from './adapters/attains';
import { gbifSpecies } from './adapters/gbif';
import { applyIntroduced, nasIntroduced } from './adapters/nas';
import { loadDemGrid } from './dem';

export class NotFoundError extends Error {
  constructor(message = 'Waterbody not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

interface Entry {
  identity: WaterbodyIdentity;
  slug?: string;
  elevationM?: number;
  provenance: Provenance;
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout()), ms);
    }),
  ]);
}

const record = (key: string, label: string, r: SourceResult<unknown>): SourceRecord => ({
  key,
  label,
  status: r.status,
  provenance: r.provenance,
  ...(r.error ? { error: r.error } : {}),
});

export class WaterbodyService {
  private entries = new Map<string, Entry>();

  constructor(
    readonly config: Config,
    readonly upstream: Upstream,
    readonly cache: Cache,
    readonly store: FixtureStore,
  ) {}

  get demo() {
    return this.config.demo;
  }

  private ctx(slug?: string): AdapterCtx {
    return { config: this.config, upstream: this.upstream, slug };
  }

  private remember(e: Entry): Entry {
    this.entries.set(e.identity.id, e);
    if (this.entries.size > 500) this.entries.delete(this.entries.keys().next().value as string);
    return e;
  }

  private toResponse(e: Entry): IdentityResponse {
    return { identity: e.identity, provenance: e.provenance, demo: this.demo };
  }

  /** Resolve the waterbody at a point: NHD first, OpenStreetMap as the global fallback. */
  async identityAt(lon: number, lat: number): Promise<IdentityResponse> {
    const ctx = this.ctx();
    let nhdError: unknown;
    try {
      const hit = await nhdIdentityAt(ctx, lon, lat);
      if (hit) {
        const slug = hit.slug;
        const c = this.ctx(slug);
        const identity = { ...hit.identity };
        if (!identity.huc8)
          identity.huc8 = await huc8AtPoint(c, identity.centroid[0], identity.centroid[1]);
        if (!identity.state)
          identity.state = await reverseState(c, identity.centroid[0], identity.centroid[1]);
        return this.toResponse(
          this.remember({
            identity,
            slug,
            elevationM: hit.elevationM,
            provenance: identityProvenance(c, hit.url),
          }),
        );
      }
    } catch (e) {
      nhdError = e;
      if (this.demo) throw e;
    }
    if (this.demo) throw new DemoUnavailableError();
    try {
      const osm = await osmIdentityAt(ctx, lon, lat);
      if (osm) {
        return this.toResponse(
          this.remember({
            identity: osm.identity,
            provenance: makeProvenance(ctx, OSM_SOURCE, osm.url, {
              license: OSM_LICENSE,
              note: 'Global fallback geometry; reduced data coverage',
            }),
          }),
        );
      }
    } catch (e) {
      if (nhdError) throw nhdError;
      throw e;
    }
    throw new NotFoundError('No mapped waterbody at this location');
  }

  async identity(id: string): Promise<Entry> {
    const known = this.entries.get(id);
    if (known) return known;
    if (id.startsWith('nhd:')) {
      const slug = this.demo ? slugFromId(id) : undefined;
      if (this.demo && !slug) throw new DemoUnavailableError();
      const c = this.ctx(slug);
      const hit = await nhdIdentityById(c, id);
      if (!hit) throw new NotFoundError();
      const identity = { ...hit.identity };
      if (!identity.huc8)
        identity.huc8 = await huc8AtPoint(c, identity.centroid[0], identity.centroid[1]);
      if (!identity.state)
        identity.state = await reverseState(c, identity.centroid[0], identity.centroid[1]);
      return this.remember({
        identity,
        slug,
        elevationM: hit.elevationM,
        provenance: identityProvenance(c, hit.url),
      });
    }
    if (id.startsWith('osm:') && !this.demo) {
      const c = this.ctx();
      const osm = await osmIdentityById(c, id);
      if (!osm) throw new NotFoundError();
      return this.remember({
        identity: osm.identity,
        provenance: makeProvenance(c, OSM_SOURCE, osm.url, { license: OSM_LICENSE }),
      });
    }
    throw this.demo ? new DemoUnavailableError() : new NotFoundError('Unrecognised waterbody id');
  }

  async identityResponse(id: string): Promise<IdentityResponse> {
    return this.toResponse(await this.identity(id));
  }

  private section<T>(name: string, id: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    // Never cache failures: a transient upstream error must not stick for days.
    return this.cache.wrap(
      `section:${name}:${id}`,
      ttl,
      fn,
      (v) => (v as { status?: string } | null)?.status !== 'error',
    );
  }

  async dem(id: string): Promise<DemGrid> {
    const e = await this.identity(id);
    return this.section('dem', id, this.config.ttl.dem, () =>
      loadDemGrid(this.ctx(e.slug), e.identity),
    );
  }

  async physical(id: string): Promise<SourceResult<PhysicalProfile>> {
    const e = await this.identity(id);
    const ctx = this.ctx(e.slug);
    return this.section('physical', id, this.config.ttl.nhd, () =>
      physicalSection(ctx, e.identity, e.elevationM, () => this.dem(id)),
    );
  }

  async stations(id: string): Promise<SourceResult<StationInfo[]>> {
    const e = await this.identity(id);
    return this.section('stations', id, this.config.ttl.wqp, () =>
      wqpStations(this.ctx(e.slug), e.identity),
    );
  }

  async quality(id: string): Promise<SourceResult<ParameterSummary[]>> {
    const e = await this.identity(id);
    const ctx = this.ctx(e.slug);
    return this.section('quality', id, this.config.ttl.usgsContinuous, async () => {
      const stations = await this.stations(id);
      const [wqp, usgs] = await Promise.all([
        wqpQuality(ctx, e.identity, stations.data ?? []),
        usgsLatest(ctx, e.identity),
      ]);
      const extras: SourceRecord[] = [record('usgs', 'USGS near-real-time', usgs)];
      if (wqp.data && usgs.data) return { ...wqp, data: mergeLatest(wqp.data, usgs.data), extras };
      if (!wqp.data && usgs.data) {
        return {
          status: 'ok' as const,
          data: summariesFromLatest(usgs.data),
          provenance: usgs.provenance,
          extras: [record('wqp', 'Water Quality Portal', wqp)],
        };
      }
      return { ...wqp, extras };
    });
  }

  async impairments(id: string): Promise<SourceResult<ImpairmentProfile>> {
    const e = await this.identity(id);
    return this.section('impairments', id, this.config.ttl.attains, () =>
      attainsImpairments(this.ctx(e.slug), e.identity),
    );
  }

  async life(id: string): Promise<SourceResult<SpeciesRecord[]>> {
    const e = await this.identity(id);
    const ctx = this.ctx(e.slug);
    return this.section('life', id, this.config.ttl.gbif, async () => {
      const [gbif, nas] = await Promise.all([
        gbifSpecies(ctx, e.identity),
        nasIntroduced(ctx, e.identity),
      ]);
      const extras = [record('nas', 'USGS NAS (introduced species)', nas)];
      if (!gbif.data) return { ...gbif, extras };
      return { ...gbif, data: applyIntroduced(gbif.data, nas.data), extras };
    });
  }

  /** Full profile: every section in parallel with a per-adapter timeout; partial results allowed. */
  async profile(id: string): Promise<WaterbodyProfile> {
    const e = await this.identity(id);
    const t = this.config.adapterTimeoutMs;
    const guard = <T>(label: string, p: Promise<SourceResult<T>>): Promise<SourceResult<T>> =>
      withTimeout(
        p.catch((err) => errorResult<T>(this.ctx(e.slug), label, '', err)),
        t,
        () =>
          errorResult<T>(
            this.ctx(e.slug),
            label,
            '',
            new Error(`${label} timed out after ${t / 1000} s`),
          ),
      );
    const [physical, quality, impairments, life, stations] = await Promise.all([
      guard('Physical profile', this.physical(id)),
      guard('Water quality', this.quality(id)),
      guard('ATTAINS', this.impairments(id)),
      guard('Life', this.life(id)),
      guard('Stations', this.stations(id)),
    ]);
    const sources: SourceRecord[] = [
      { key: 'geometry', label: 'Waterbody geometry', status: 'ok', provenance: e.provenance },
      record('physical', 'Physical profile', physical),
      record('stations', 'Monitoring stations', stations),
      record('quality', 'Water quality', quality),
      ...(quality.extras ?? []),
      record('impairments', 'Impairments and assessments', impairments),
      record('life', 'Species records', life),
      ...(life.extras ?? []),
    ];
    return {
      identity: e.identity,
      physical,
      quality,
      impairments,
      life,
      stations,
      sources,
      generatedAt: new Date().toISOString(),
      demo: this.demo,
    };
  }
}

export { DEMO_NOTE };
