import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findCatalogEntry } from './catalog';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ROOT).filter((f) => f.endsWith('.json'));

describe('fixtures', () => {
  it('has a folder for each of the six demo waterbodies', () => {
    const dirs = readdirSync(ROOT).filter(
      (f) => statSync(join(ROOT, f)).isDirectory() && !f.startsWith('_'),
    );
    expect(dirs.sort()).toEqual([
      'crater-lake',
      'lake-champlain',
      'lake-erie-western-basin',
      'lake-tahoe',
      'onondaga-lake',
      'potomac-river-dc',
    ]);
  });
  it('marks every fixture file with "_demo": true', () => {
    expect(files.length).toBeGreaterThan(60);
    for (const f of files) {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      expect(j._demo, f).toBe(true);
    }
  });
  it('gives each waterbody one file per adapter', () => {
    for (const slug of ['lake-champlain', 'potomac-river-dc']) {
      for (const n of [
        'nhd-waterbody',
        'nhd-area',
        'nhd-flowline',
        'wqp-station',
        'wqp-result',
        'usgs-latest',
        'attains-geo',
        'attains-assessments',
        'gbif-facets',
        'gbif-species',
        'nas',
        'dem',
      ]) {
        expect(
          files.some((f) => f.endsWith(`${slug}/${n}.json`)),
          `${slug}/${n}`,
        ).toBe(true);
      }
    }
  });
  it('resolves most fixture species in the bundled catalog', () => {
    const f = files.filter((x) => x.endsWith('gbif-species.json'));
    let total = 0;
    let hit = 0;
    for (const file of f) {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      for (const s of Object.values<{ scientificName: string }>(j.species)) {
        total++;
        if (findCatalogEntry(s.scientificName)) hit++;
      }
    }
    expect(hit / total).toBeGreaterThan(0.95);
  });
});
