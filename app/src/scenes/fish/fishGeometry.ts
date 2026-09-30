import { BufferAttribute, BufferGeometry } from 'three';
import type { FishArchetype } from '@wi/shared';

/**
 * Procedural fish meshes built from archetype parameters (body length-to-depth ratio, taper, fin
 * set, tail shape). No external model files. The body is 1 unit long along +X (nose at +0.5, tail
 * at -0.5), dorsal is +Y, lateral is Z. Vertex attribute `aT` runs 0 at the nose to 1 at the tail
 * and drives the swimming wave; `aPart` is 0 for body and 1 for fins.
 */
export interface FishParams {
  /** Half body height and half body width at the thickest point, as a fraction of length. */
  halfHeight: number;
  halfWidth: number;
  /** Where the body is thickest (smaller is nearer the head) and how blunt it is. */
  peak: number;
  blunt: number;
  tail: 'forked' | 'rounded' | 'tiny' | 'lunate';
  dorsal: { start: number; end: number; height: number } | null;
  pectoral: boolean;
  anal: boolean;
  /** Whole-body undulation (eels, lamprey). */
  fullBody: boolean;
  /** Body drawn wider than tall (catfish, sturgeon). */
  flat: boolean;
}

export const FISH_PARAMS: Record<FishArchetype, FishParams> = {
  fusiform: {
    halfHeight: 0.11,
    halfWidth: 0.07,
    peak: 0.36,
    blunt: 0.75,
    tail: 'forked',
    dorsal: { start: 0.38, end: 0.62, height: 0.1 },
    pectoral: true,
    anal: true,
    fullBody: false,
    flat: false,
  },
  compressed: {
    halfHeight: 0.19,
    halfWidth: 0.05,
    peak: 0.4,
    blunt: 0.85,
    tail: 'forked',
    dorsal: { start: 0.25, end: 0.65, height: 0.11 },
    pectoral: true,
    anal: true,
    fullBody: false,
    flat: false,
  },
  elongate: {
    halfHeight: 0.06,
    halfWidth: 0.05,
    peak: 0.42,
    blunt: 0.6,
    tail: 'rounded',
    dorsal: { start: 0.68, end: 0.88, height: 0.07 },
    pectoral: true,
    anal: true,
    fullBody: false,
    flat: false,
  },
  anguilliform: {
    halfHeight: 0.03,
    halfWidth: 0.028,
    peak: 0.25,
    blunt: 0.35,
    tail: 'tiny',
    dorsal: null,
    pectoral: false,
    anal: false,
    fullBody: true,
    flat: false,
  },
  benthic: {
    halfHeight: 0.09,
    halfWidth: 0.12,
    peak: 0.3,
    blunt: 0.7,
    tail: 'rounded',
    dorsal: { start: 0.3, end: 0.5, height: 0.08 },
    pectoral: true,
    anal: false,
    fullBody: false,
    flat: true,
  },
  small: {
    halfHeight: 0.09,
    halfWidth: 0.055,
    peak: 0.35,
    blunt: 0.75,
    tail: 'forked',
    dorsal: { start: 0.4, end: 0.6, height: 0.08 },
    pectoral: true,
    anal: false,
    fullBody: false,
    flat: false,
  },
};

const SEGMENTS = 20;
const RADIAL = 10;
/** The body ends here (fraction of length); the tail fin covers the rest. */
const BODY_END = 0.9;

/** Body radius profile in [0, 1]: zero at the nose, tapering to a thin peduncle. */
export function bodyProfile(t: number, p: FishParams): number {
  const tt = Math.max(0, Math.min(1, t / BODY_END));
  // Re-map so the maximum lies at `peak`: power < 1 pushes it toward the nose.
  const exp = Math.log(0.5) / Math.log(Math.max(0.05, Math.min(0.95, p.peak)));
  const x = Math.pow(tt, exp);
  const round = Math.pow(Math.sin(Math.PI * x), p.blunt);
  const peduncle = 0.12 * (1 - Math.exp(-6 * Math.max(0, tt - 0.6)));
  return Math.max(round, tt > 0.6 ? peduncle : 0);
}

export interface FishGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  aT: Float32Array;
  aPart: Float32Array;
  indices: Uint16Array;
}

export function fishGeometryData(archetype: FishArchetype): FishGeometryData {
  const p = FISH_PARAMS[archetype];
  const pos: number[] = [];
  const aT: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const X = (t: number) => 0.5 - t;

  // Body rings
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (i / SEGMENTS) * BODY_END;
    const r = bodyProfile(t, p);
    for (let j = 0; j < RADIAL; j++) {
      const th = (j / RADIAL) * Math.PI * 2;
      pos.push(X(t), Math.cos(th) * p.halfHeight * r, Math.sin(th) * p.halfWidth * r);
      aT.push(t);
      part.push(0);
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * RADIAL + j;
      const b = i * RADIAL + ((j + 1) % RADIAL);
      const c = (i + 1) * RADIAL + j;
      const d = (i + 1) * RADIAL + ((j + 1) % RADIAL);
      idx.push(a, c, b, b, c, d);
    }
  }
  const finVertex = (x: number, y: number, z: number, t: number) => {
    pos.push(x, y, z);
    aT.push(t);
    part.push(1);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, c: number) => idx.push(a, b, c);
  const topAt = (t: number) => p.halfHeight * bodyProfile(t, p);

  // Caudal fin (vertical plane)
  const t0 = BODY_END - 0.03;
  const y0 = topAt(t0) * 0.8 + 0.004;
  const spread =
    p.tail === 'tiny' ? 0.03 : p.tail === 'rounded' ? 0.11 : p.tail === 'lunate' ? 0.16 : 0.15;
  const tip = p.tail === 'tiny' ? 1.0 : p.tail === 'rounded' ? 1.1 : 1.14;
  const a0 = finVertex(X(t0), y0, 0, t0);
  const a1 = finVertex(X(t0), -y0, 0, t0);
  const top = finVertex(X(tip), spread, 0, tip);
  const bot = finVertex(X(tip), -spread, 0, tip);
  if (p.tail === 'forked' || p.tail === 'lunate') {
    const notch = finVertex(X(tip - 0.06), 0, 0, tip - 0.06);
    tri(a0, top, notch);
    tri(a1, notch, bot);
    tri(a0, notch, a1);
  } else {
    tri(a0, top, bot);
    tri(a0, bot, a1);
  }

  // Dorsal fin
  if (p.dorsal) {
    const d = p.dorsal;
    const b0 = finVertex(X(d.start), topAt(d.start) * 0.92, 0, d.start);
    const b1 = finVertex(X(d.end), topAt(d.end) * 0.92, 0, d.end);
    const apex = finVertex(
      X((d.start + d.end) / 2 + 0.03),
      topAt((d.start + d.end) / 2) + d.height,
      0,
      (d.start + d.end) / 2 + 0.03,
    );
    tri(b0, apex, b1);
  }
  // Anal fin
  if (p.anal) {
    const s = 0.66;
    const e = 0.8;
    const b0 = finVertex(X(s), -topAt(s) * 0.9, 0, s);
    const b1 = finVertex(X(e), -topAt(e) * 0.9, 0, e);
    const apex = finVertex(
      X((s + e) / 2 + 0.02),
      -topAt((s + e) / 2) - 0.05,
      0,
      (s + e) / 2 + 0.02,
    );
    tri(b0, b1, apex);
  }
  // Pectoral fins (one each side)
  if (p.pectoral) {
    for (const side of [1, -1]) {
      const t = 0.26;
      const b0 = finVertex(X(t), -topAt(t) * 0.35, side * p.halfWidth * bodyProfile(t, p) * 0.9, t);
      const b1 = finVertex(
        X(t + 0.03),
        -topAt(t) * 0.2,
        side * p.halfWidth * bodyProfile(t, p) * 0.9,
        t + 0.03,
      );
      const apex = finVertex(
        X(t + 0.12),
        -topAt(t) * 0.75,
        side * (p.halfWidth * bodyProfile(t, p) + 0.07),
        t + 0.12,
      );
      if (side > 0) tri(b0, b1, apex);
      else tri(b0, apex, b1);
    }
  }

  const positions = new Float32Array(pos);
  const n = positions.length / 3;
  const indices = new Uint16Array(idx);
  // Normals: area-weighted from triangles.
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [ia, ib, ic] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [ia, ib, ic]) {
      normals[k] += nx;
      normals[k + 1] += ny;
      normals[k + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
    normals[i * 3] /= l;
    normals[i * 3 + 1] /= l;
    normals[i * 3 + 2] /= l;
  }
  return { positions, normals, aT: new Float32Array(aT), aPart: new Float32Array(part), indices };
}

const cache = new Map<FishArchetype, BufferGeometry>();

export function buildFishGeometry(archetype: FishArchetype): BufferGeometry {
  const hit = cache.get(archetype);
  if (hit) return hit;
  const d = fishGeometryData(archetype);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new BufferAttribute(d.normals, 3));
  g.setAttribute('aT', new BufferAttribute(d.aT, 1));
  g.setAttribute('aPart', new BufferAttribute(d.aPart, 1));
  g.setIndex(new BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  cache.set(archetype, g);
  return g;
}

export const isFishArchetype = (a: string): a is FishArchetype => a in FISH_PARAMS;
