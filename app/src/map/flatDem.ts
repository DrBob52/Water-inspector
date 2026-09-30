import { encodeTerrarium } from '@wi/shared';

let tile: ArrayBuffer | null = null;

/**
 * Builds a 256 x 256 Terrarium PNG of constant elevation. Used in offline/test mode so the terrain
 * source works without any tile request. Elevation is flat on purpose: it is not real terrain.
 */
async function buildFlatTile(elevationM: number): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const [r, g, b] = encodeTerrarium(elevationM);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 256, 256);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  return blob.arrayBuffer();
}

interface ProtocolHost {
  addProtocol: (name: string, handler: () => Promise<{ data: ArrayBuffer }>) => void;
}

let registered = false;

export function registerFlatDemProtocol(host: ProtocolHost) {
  if (registered) return;
  registered = true;
  host.addProtocol('flatdem', async () => {
    tile ??= await buildFlatTile(0);
    return { data: tile.slice(0) };
  });
}

export const FLAT_DEM_TILES = ['flatdem://{z}/{x}/{y}'];
