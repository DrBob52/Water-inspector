import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DemoWaterbodyInfo } from '@wi/shared';

export class FixtureMissingError extends Error {
  constructor(public readonly file: string) {
    super(`No demo fixture: ${file}`);
    this.name = 'FixtureMissingError';
  }
}

/** Reads demo fixtures from disk. Every fixture file is marked "_demo": true. */
export class FixtureStore {
  private cache = new Map<string, unknown>();

  constructor(private readonly dir: string) {}

  private load(rel: string): unknown {
    if (this.cache.has(rel)) return this.cache.get(rel);
    const full = join(this.dir, rel);
    if (!existsSync(full)) throw new FixtureMissingError(rel);
    const j = JSON.parse(readFileSync(full, 'utf8'));
    this.cache.set(rel, j);
    return j;
  }

  slugs(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter(
      (f) => !f.startsWith('_') && statSync(join(this.dir, f)).isDirectory(),
    );
  }

  hasSlug(slug: string): boolean {
    return this.slugs().includes(slug);
  }

  /** Read `{slug}/{file}.json` (or `_shared/{file}.json` when slug is omitted) and walk `path`. */
  read(file: string, slug?: string, path: string[] = []): unknown {
    const rel = slug ? `${slug}/${file}.json` : `_shared/${file}.json`;
    let cur = this.load(rel);
    for (const p of path) {
      if (cur && typeof cur === 'object' && p in (cur as object))
        cur = (cur as Record<string, unknown>)[p];
      else throw new FixtureMissingError(`${rel}#${path.join('.')}`);
    }
    return cur;
  }

  /** Read a file at the fixtures root, e.g. lake-depth-index.sample.json. */
  readRoot(name: string): unknown {
    return this.load(name);
  }

  all(file: string): Array<{ slug: string; data: unknown }> {
    return this.slugs().map((slug) => ({ slug, data: this.read(file, slug) }));
  }

  /** Outlines of the demo waterbodies (Polygon features) for the map, with id and name. */
  demoGeoJson(): { type: 'FeatureCollection'; features: unknown[] } {
    const list = this.demoWaterbodies();
    const features = list.flatMap((w) => {
      for (const file of ['nhd-waterbody', 'nhd-area']) {
        const fc = this.read(file, w.slug) as { features?: Array<{ geometry: unknown }> };
        const g = fc.features?.[0]?.geometry;
        if (g)
          return [
            {
              type: 'Feature',
              id: w.id,
              geometry: g,
              properties: { id: w.id, name: w.name, slug: w.slug },
            },
          ];
      }
      return [];
    });
    return { type: 'FeatureCollection', features };
  }

  demoWaterbodies(): DemoWaterbodyInfo[] {
    const j = this.readRoot('_demo-waterbodies.json') as { waterbodies: DemoWaterbodyInfo[] };
    return j.waterbodies;
  }
}

export const DEMO_ID_PREFIX = 'nhd:demo-';

/** "nhd:demo-lake-tahoe" -> "lake-tahoe" */
export function slugFromId(id: string): string | undefined {
  return id.startsWith(DEMO_ID_PREFIX) ? id.slice(DEMO_ID_PREFIX.length) : undefined;
}
