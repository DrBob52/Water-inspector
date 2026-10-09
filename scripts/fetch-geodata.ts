/**
 * Builds real outlines and elevation grids for the six demo waterbodies.
 *
 * Elevation comes from the AWS Open Data terrain tiles (Terrarium encoding). Lakes and wide rivers
 * are hydro-flattened in those tiles, so each outline is traced by flood-filling the flat water
 * surface from a seed point and contouring the resulting mask. Natural Earth (public domain)
 * centerlines are used for the Potomac's line geometry.
 *
 * Needs network access. Output is committed to scripts/fixtures/geodata/ and read by
 * generate-fixtures.ts, so this only has to be rerun to change the demo geometry.
 *
 *   npx tsx scripts/fetch-geodata.ts [slug...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { simplify, polygon as turfPolygon, area as turfArea } from '@turf/turf';

interface Target {
  slug: string;
  seed: [number, number];
  /** Search window for the flood fill, lon/lat. */
  window: [number, number, number, number];
  zoom: number;
  /** Max allowed difference from the seed elevation, metres. */
  tol: number;
  simplifyDeg: number;
  /** Keep only mask pixels on this side of a line (used to cut Erie's western basin). */
  clip?: { a: [number, number]; b: [number, number]; keepLeft: boolean };
  /** Elevation grid: pixels on the long side. */
  demMax: number;
  /** Opening radius in pixels, cuts thin channels off the main water body. */
  openR?: number;
  /** More seeds for reaches cut off by bridges; their fills are joined with a closing pass. */
  extraSeeds?: Array<[number, number]>;
  closeR?: number;
}

const TARGETS: Target[] = [
  {
    slug: 'lake-champlain',
    seed: [-73.33, 44.55],
    window: [-73.5, 43.52, -73.05, 45.1],
    zoom: 11,
    tol: 0.6,
    simplifyDeg: 0.0012,
    demMax: 256,
  },
  {
    slug: 'lake-tahoe',
    seed: [-120.03, 39.09],
    window: [-120.2, 38.9, -119.88, 39.3],
    zoom: 12,
    tol: 1.5,
    openR: 2,
    simplifyDeg: 0.0005,
    demMax: 256,
  },
  {
    slug: 'crater-lake',
    seed: [-122.11, 42.94],
    window: [-122.2, 42.88, -122.02, 43.0],
    zoom: 14,
    tol: 0.5,
    simplifyDeg: 0.00015,
    demMax: 256,
  },
  {
    slug: 'lake-erie-western-basin',
    seed: [-83.0, 41.75],
    window: [-83.55, 41.35, -82.35, 42.1],
    zoom: 11,
    tol: 0.6,
    simplifyDeg: 0.0012,
    demMax: 256,
    // Western basin: west of the line from Point Pelee to Marblehead.
    clip: { a: [-82.51, 41.92], b: [-82.72, 41.53], keepLeft: true },
  },
  {
    slug: 'onondaga-lake',
    seed: [-76.21, 43.1],
    window: [-76.27, 43.05, -76.15, 43.15],
    zoom: 14,
    tol: 0.5,
    simplifyDeg: 0.0001,
    demMax: 256,
    openR: 4,
  },
  {
    slug: 'potomac-river-dc',
    seed: [-77.03, 38.835],
    window: [-77.09, 38.765, -77.0, 38.915],
    zoom: 14,
    tol: 0.7,
    simplifyDeg: 0.0001,
    demMax: 256,
    extraSeeds: [
      [-77.06, 38.89],
      [-77.07, 38.902],
    ],
    closeR: 4,
  },
];

const TILE = 256;
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * TILE;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * TILE;
};
const x2lon = (x: number, z: number) => (x / (2 ** z * TILE)) * 360 - 180;
const y2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (2 ** z * TILE);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array> {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
      const out = new Float32Array(TILE * TILE);
      for (let i = 0; i < TILE * TILE; i++) {
        const r = png.data[i * 4],
          g = png.data[i * 4 + 1],
          b = png.data[i * 4 + 2];
        out[i] = r * 256 + g + b / 256 - 32768;
      }
      return out;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error('unreachable');
}

interface Mosaic {
  z: number;
  px0: number;
  py0: number;
  w: number;
  h: number;
  elev: Float32Array;
}

async function mosaic(bbox: [number, number, number, number], z: number): Promise<Mosaic> {
  const px0 = Math.floor(lon2x(bbox[0], z)),
    px1 = Math.ceil(lon2x(bbox[2], z));
  const py0 = Math.floor(lat2y(bbox[3], z)),
    py1 = Math.ceil(lat2y(bbox[1], z));
  const w = px1 - px0,
    h = py1 - py0;
  const elev = new Float32Array(w * h);
  const tx0 = Math.floor(px0 / TILE),
    tx1 = Math.floor((px1 - 1) / TILE);
  const ty0 = Math.floor(py0 / TILE),
    ty1 = Math.floor((py1 - 1) / TILE);
  const jobs: Array<Promise<void>> = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      jobs.push(
        fetchTile(z, tx, ty).then((t) => {
          for (let j = 0; j < TILE; j++) {
            const y = ty * TILE + j - py0;
            if (y < 0 || y >= h) continue;
            for (let i = 0; i < TILE; i++) {
              const x = tx * TILE + i - px0;
              if (x < 0 || x >= w) continue;
              elev[y * w + x] = t[j * TILE + i];
            }
          }
        }),
      );
  await Promise.all(jobs);
  return { z, px0, py0, w, h, elev };
}

function floodFill(m: Mosaic, t: Target, seed: [number, number] = t.seed): Uint8Array {
  const mask = new Uint8Array(m.w * m.h);
  const sx = Math.round(lon2x(seed[0], m.z) - m.px0),
    sy = Math.round(lat2y(seed[1], m.z) - m.py0);
  const e0 = m.elev[sy * m.w + sx];
  const side = (x: number, y: number) => {
    if (!t.clip) return true;
    const lon = x2lon(x + m.px0 + 0.5, m.z),
      lat = y2lat(y + m.py0 + 0.5, m.z);
    const [ax, ay] = t.clip.a,
      [bx, by] = t.clip.b;
    const cross = (bx - ax) * (lat - ay) - (by - ay) * (lon - ax);
    return t.clip.keepLeft ? cross < 0 : cross > 0;
  };
  const stack = [sy * m.w + sx];
  mask[stack[0]] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % m.w,
      y = (p - x) / m.w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const q = ny * m.w + nx;
      if (mask[q]) continue;
      if (Math.abs(m.elev[q] - e0) > t.tol) continue;
      if (!side(nx, ny)) continue;
      mask[q] = 1;
      stack.push(q);
    }
  }
  console.log(
    `  seed elevation ${e0.toFixed(2)} m, filled ${mask.reduce((a, b) => a + b, 0)} px of ${m.w * m.h}`,
  );
  return mask;
}

/** Morphological open (erode then dilate) to cut thin leaks along flat shores. */
function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const pass = (src: Uint8Array, erode: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let dy = -r; dy <= r && (erode ? v : !v); dy++)
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx,
              ny = y + dy;
            const s = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : src[ny * w + nx];
            if (erode && !s) {
              v = 0;
              break;
            }
            if (!erode && s) {
              v = 1;
              break;
            }
          }
        out[y * w + x] = v;
      }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** Morphological close (dilate then erode) to bridge narrow gaps such as bridge decks. */
function close(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const o = open(inv, w, h, r);
  for (let i = 0; i < o.length; i++) o[i] = o[i] ? 0 : 1;
  return o;
}

/** Keep the connected component containing the seed, and fill holes (islands). */
function largestFromSeed(mask: Uint8Array, w: number, h: number, seed: number): Uint8Array {
  const keep = new Uint8Array(mask.length);
  if (!mask[seed]) {
    // seed eroded away; pick the nearest set pixel
    let best = -1,
      bd = Infinity;
    const sx = seed % w,
      sy = (seed - sx) / w;
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        const d = ((i % w) - sx) ** 2 + (Math.floor(i / w) - sy) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    seed = best;
  }
  const stack = [seed];
  keep[seed] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w,
      y = (p - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (mask[q] && !keep[q]) {
        keep[q] = 1;
        stack.push(q);
      }
    }
  }
  // fill holes: flood the outside from the border
  const outside = new Uint8Array(mask.length);
  const st: number[] = [];
  for (let x = 0; x < w; x++) {
    st.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    st.push(y * w, y * w + w - 1);
  }
  for (const p of st) if (!keep[p]) outside[p] = 1;
  while (st.length) {
    const p = st.pop()!;
    if (keep[p]) continue;
    const x = p % w,
      y = (p - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!keep[q] && !outside[q]) {
        outside[q] = 1;
        st.push(q);
      }
    }
  }
  const filled = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

/** Trace the outer boundary of a hole-free mask with a Moore-neighbour walk on pixel corners. */
function traceBoundary(mask: Uint8Array, w: number, h: number): Array<[number, number]> {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  // Find a start edge: topmost-leftmost set pixel, its top edge.
  let start = -1;
  for (let i = 0; i < mask.length && start < 0; i++) if (mask[i]) start = i;
  const sx = start % w,
    sy = (start - sx) / w;
  // Walk corners clockwise keeping the filled pixel on the right.
  // Directions: 0=E,1=S,2=W,3=N on the corner lattice.
  const pts: Array<[number, number]> = [];
  let x = sx,
    y = sy,
    dir = 0;
  const startState = `${x},${y},${dir}`;
  let guard = 0;
  do {
    pts.push([x, y]);
    // pixel to the right-front and left-front of the current edge direction
    const step = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ][dir];
    // for each direction, the pixel on the right side of the edge from (x,y) going dir
    const right = (d: number, cx: number, cy: number) =>
      [at(cx, cy), at(cx - 1, cy), at(cx - 1, cy - 1), at(cx, cy - 1)][d];
    const left = (d: number, cx: number, cy: number) =>
      [at(cx, cy - 1), at(cx, cy), at(cx - 1, cy), at(cx - 1, cy - 1)][d];
    x += step[0];
    y += step[1];
    // choose next direction: try turn left, straight, right
    const l = (dir + 3) % 4,
      r = (dir + 1) % 4;
    if (right(l, x, y) && !left(l, x, y)) dir = l;
    else if (!(right(dir, x, y) && !left(dir, x, y))) dir = r;
    if (++guard > 4 * mask.length) throw new Error('trace runaway');
  } while (`${x},${y},${dir}` !== startState);
  return pts;
}

/** Corner-cutting smoothing on a closed ring, removes pixel staircases. */
function chaikin(pts: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    out.push(
      [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]],
      [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]],
    );
  }
  return out;
}

function demGrid(m: Mosaic, bbox: [number, number, number, number], max: number) {
  const fx0 = lon2x(bbox[0], m.z) - m.px0,
    fx1 = lon2x(bbox[2], m.z) - m.px0;
  const fy0 = lat2y(bbox[3], m.z) - m.py0,
    fy1 = lat2y(bbox[1], m.z) - m.py0;
  // aspect in metres
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const wM = (bbox[2] - bbox[0]) * 111320 * Math.cos(midLat),
    hM = (bbox[3] - bbox[1]) * 110540;
  const width = wM >= hM ? max : Math.max(24, Math.round((max * wM) / hM));
  const height = hM > wM ? max : Math.max(24, Math.round((max * hM) / wM));
  const sample = (fx: number, fy: number) => {
    // box filter over the source footprint
    const sxr = (fx1 - fx0) / width / 2,
      syr = (fy1 - fy0) / height / 2;
    let s = 0,
      n = 0;
    for (let y = Math.floor(fy - syr); y <= Math.ceil(fy + syr); y++)
      for (let x = Math.floor(fx - sxr); x <= Math.ceil(fx + sxr); x++) {
        const cx = Math.min(m.w - 1, Math.max(0, x)),
          cy = Math.min(m.h - 1, Math.max(0, y));
        s += m.elev[cy * m.w + cx];
        n++;
      }
    return s / n;
  };
  const elevations: number[] = [];
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const fx = fx0 + ((i + 0.5) / width) * (fx1 - fx0);
      const fy = fy0 + ((j + 0.5) / height) * (fy1 - fy0);
      elevations.push(Math.round(sample(fx, fy) * 10) / 10);
    }
  return { bbox, width, height, elevations };
}

async function build(t: Target) {
  console.log(t.slug);
  const m = await mosaic(t.window, t.zoom);
  const seedIdx =
    Math.round(lat2y(t.seed[1], m.z) - m.py0) * m.w + Math.round(lon2x(t.seed[0], m.z) - m.px0);
  const surfaceM = m.elev[seedIdx];
  let mask = floodFill(m, t);
  if (t.extraSeeds) {
    for (const sd of t.extraSeeds) {
      const more = floodFill(m, t, sd);
      for (let i = 0; i < mask.length; i++) mask[i] |= more[i];
    }
    mask = close(mask, m.w, m.h, t.closeR ?? 3);
  }
  mask = open(mask, m.w, m.h, t.openR ?? 1);
  mask = largestFromSeed(mask, m.w, m.h, seedIdx);
  const px = traceBoundary(mask, m.w, m.h);
  let ring = chaikin(chaikin(px)).map(
    ([x, y]) => [x2lon(x + m.px0, m.z), y2lat(y + m.py0, m.z)] as [number, number],
  );
  ring.push(ring[0]);
  let poly = turfPolygon([ring]);
  poly = simplify(poly, { tolerance: t.simplifyDeg, highQuality: true });
  ring = (poly.geometry.coordinates[0] as Array<[number, number]>).map(([a, b]) => [
    Math.round(a * 1e5) / 1e5,
    Math.round(b * 1e5) / 1e5,
  ]);
  // counter-clockwise exterior (GeoJSON right-hand rule)
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++)
    s += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  if (s > 0) ring.reverse();
  const areaKm2 = turfArea(turfPolygon([ring])) / 1e6;
  // elevation grid over the outline bbox plus a 2 km margin
  const lons = ring.map((p) => p[0]),
    lats = ring.map((p) => p[1]);
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const mx = 2000 / (111320 * Math.cos(midLat)),
    my = 2000 / 110540;
  const bbox: [number, number, number, number] = [
    Math.min(...lons) - mx,
    Math.min(...lats) - my,
    Math.max(...lons) + mx,
    Math.max(...lats) + my,
  ].map((v) => Math.round(v * 1e6) / 1e6) as [number, number, number, number];
  const dm = await mosaic(bbox, Math.min(t.zoom, 13));
  const dem = demGrid(dm, bbox, t.demMax);
  const out = {
    _demo: true,
    slug: t.slug,
    surfaceElevationM: Math.round(surfaceM * 10) / 10,
    areaKm2: Math.round(areaKm2 * 10) / 10,
    ring,
    dem,
    attribution:
      'Outline traced from and elevation sampled from AWS Open Data terrain tiles (Terrarium; sources include USGS 3DEP and SRTM).',
  };
  mkdirSync('scripts/fixtures/geodata', { recursive: true });
  writeFileSync(`scripts/fixtures/geodata/${t.slug}.json`, JSON.stringify(out));
  console.log(
    `  ${ring.length} vertices, ${out.areaKm2} km², surface ${out.surfaceElevationM} m, dem ${dem.width}x${dem.height}`,
  );
}

const only = process.argv.slice(2);
for (const t of TARGETS) if (!only.length || only.includes(t.slug)) await build(t);
