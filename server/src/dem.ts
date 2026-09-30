import { PNG } from 'pngjs';
import {
  blockBbox,
  chooseZoom,
  stitchTerrarium,
  tilesForBbox,
  tileUrl,
  TILE_SIZE,
  type DemGrid,
  type RgbaTile,
  type WaterbodyIdentity,
} from '@wi/shared';
import type { AdapterCtx } from './adapters/common';
import { fx } from './adapters/common';

export const DEM_SOURCE = 'AWS Open Data terrain tiles (Terrarium)';
export const MAX_DEM_TILES = 36;

export function decodePngRgba(buf: Uint8Array): Uint8Array {
  const png = PNG.sync.read(Buffer.from(buf));
  if (png.width !== TILE_SIZE || png.height !== TILE_SIZE) {
    throw new Error(`Unexpected terrain tile size ${png.width}x${png.height}`);
  }
  return new Uint8Array(png.data);
}

/**
 * Elevation grid covering the diorama block (waterbody bbox plus a 2 km margin). Demo mode reads a
 * fixture grid; live mode downloads and stitches Terrarium tiles.
 */
export async function loadDemGrid(ctx: AdapterCtx, identity: WaterbodyIdentity): Promise<DemGrid> {
  if (ctx.upstream.demo) {
    return (await ctx.upstream.json<DemGrid>({
      source: DEM_SOURCE,
      url: 'fixture:dem',
      fixture: fx(ctx, 'dem'),
    })) as DemGrid;
  }
  const bbox = blockBbox(identity.bbox, 2000);
  const target = ctx.config.terrarium.targetSamples;
  let z = chooseZoom(bbox, target);
  let refs = tilesForBbox(bbox, z);
  while (refs.length > MAX_DEM_TILES && z > 0) {
    z--;
    refs = tilesForBbox(bbox, z);
  }
  const tiles: RgbaTile[] = await Promise.all(
    refs.map(async (t) => {
      const url = tileUrl(ctx.config.terrarium.urlTemplate, t);
      const buf = await ctx.upstream.buffer({ source: DEM_SOURCE, url });
      return { ...t, data: decodePngRgba(buf) };
    }),
  );
  const [w, s, e, n] = bbox;
  const cosLat = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const wM = (e - w) * cosLat;
  const hM = n - s;
  const width = wM >= hM ? target : Math.max(16, Math.round((target * wM) / hM));
  const height = hM > wM ? target : Math.max(16, Math.round((target * hM) / wM));
  return stitchTerrarium(tiles, bbox, width, height);
}
