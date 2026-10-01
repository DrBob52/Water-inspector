/**
 * Builds the compact lake depth index used to match a selected waterbody to measured depth data.
 *
 *   npx tsx server/scripts/build-lake-depth-index.ts \
 *     --hydrolakes /data/HydroLAKES_polys_v10.shp \
 *     --globathy /data/GLOBathy_basic_parameters.csv \
 *     --out server/data/lake-depth-index.json
 *
 * Inputs are local files (HydroLAKES and GLOBathy are downloads, not APIs). The output holds
 * {hylak_id, lon, lat, area_km2, depth_avg_m, depth_max_m, vol_mcm} for US lakes over 0.1 km2.
 * Do not run this in CI.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { open } from 'shapefile';
import { parseGlobathyCsv, toIndexEntry, type HydroLakesRecord } from '../src/depthIndexBuild';
import type { DepthIndexEntry } from '../src/adapters/depth';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) {
    console.error(`Missing --${name}. See the header of this file for usage.`);
    process.exit(2);
  }
  return v;
}

const shp = arg('hydrolakes');
const csv = arg('globathy');
const out = arg('out');

const depths = parseGlobathyCsv(readFileSync(csv, 'utf8'));
console.log(`GLOBathy: ${depths.size} lakes with a max depth`);

const source = await open(shp);
const lakes: DepthIndexEntry[] = [];
let seen = 0;
for (;;) {
  const r = await source.read();
  if (r.done) break;
  seen++;
  const entry = toIndexEntry(
    r.value.properties as unknown as HydroLakesRecord,
    r.value.geometry,
    depths,
  );
  if (entry) lakes.push(entry);
  if (seen % 100000 === 0) console.log(`  ${seen} polygons read, ${lakes.length} kept`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ generated: new Date().toISOString(), source: 'HydroLAKES + GLOBathy', lakes }) +
    '\n',
);
console.log(`Wrote ${lakes.length} lakes to ${out}`);
