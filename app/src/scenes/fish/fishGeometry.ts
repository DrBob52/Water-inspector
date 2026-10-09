import { BufferAttribute, BufferGeometry } from 'three';
import type { FishArchetype } from '@wi/shared';

/**
 * Procedural fish meshes built from archetype parameters (body length-to-depth ratio, taper, fin
 * set, tail shape). No external model files. The body is 1 unit long along +X (nose at +0.5, tail
 * at -0.5), dorsal is +Y, lateral is Z. Vertex attribute `aT` runs 0 at the nose to 1 at the tail
 * and drives the swimming wave; `aPart` is 0 for body and 1 for fins; `aFin` holds fin coordinates
 * (x: 0 at the fin base to 1 at its edge, y: position across the fin rays).
 */
export interface FishParams {
  /** Half body height and half body width at the thickest point, as a fraction of length. */
  halfHeight: number;
  halfWidth: number;
  /** Where the body is thickest (fraction of the body, smaller is nearer the head) and how blunt it is. */
  peak: number;
  blunt: number;
  tail: 'forked' | 'emarginate' | 'rounded' | 'tiny' | 'lunate';
  dorsal: { start: number; end: number; height: number } | null;
  pectoral: boolean;
  anal: boolean;
  /** Whole-body undulation (eels, lamprey). */
  fullBody: boolean;
  /** Body drawn wider than tall with a flat belly (catfish, sturgeon). */
  flat: boolean;
  /** How much higher the back arches than the belly sags (0 = symmetric). */
  arch: number;
  /** Tail stalk height as a fraction of the maximum body height. */
  peduncle: number;
  /** Half-span of the caudal fin, as a fraction of length. */
  tailSpan: number;
  /** Eye radius as a fraction of length. */
  eye: number;
  pelvic: boolean;
  /** A small adipose fin between dorsal and tail (salmonids, catfish). */
  adipose: boolean;
}

export const FISH_PARAMS: Record<FishArchetype, FishParams> = {
  fusiform: {
    halfHeight: 0.11,
    halfWidth: 0.065,
    peak: 0.36,
    blunt: 0.75,
    tail: 'forked',
    dorsal: { start: 0.33, end: 0.56, height: 0.085 },
    pectoral: true,
    anal: true,
    fullBody: false,
    flat: false,
    arch: 0.14,
    peduncle: 0.32,
    tailSpan: 0.13,
    eye: 0.021,
    pelvic: true,
    adipose: false,
  },
  compressed: {
    halfHeight: 0.19,
    halfWidth: 0.048,
    peak: 0.4,
    blunt: 0.85,
    tail: 'emarginate',
    dorsal: { start: 0.25, end: 0.68, height: 0.1 },
    pectoral: true,
    anal: true,
    fullBody: false,
    flat: false,
    arch: 0.16,
    peduncle: 0.24,
    tailSpan: 0.15,
    eye: 0.03,
    pelvic: true,
    adipose: false,
  },
  elongate: {
    halfHeight: 0.06,
    halfWidth: 0.05,
    peak: 0.45,
    blunt: 0.55,
    tail: 'emarginate',
    dorsal: { start: 0.66, end: 0.82, height: 0.07 },
    pectoral: true,
    anal: true,
    fullBody: false,
    flat: false,
    arch: 0.06,
    peduncle: 0.5,
    tailSpan: 0.1,
    eye: 0.016,
    pelvic: true,
    adipose: false,
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
    arch: 0,
    peduncle: 0.55,
    tailSpan: 0.03,
    eye: 0.009,
    pelvic: false,
    adipose: false,
  },
  benthic: {
    halfHeight: 0.095,
    halfWidth: 0.115,
    peak: 0.3,
    blunt: 0.7,
    tail: 'emarginate',
    dorsal: { start: 0.28, end: 0.48, height: 0.09 },
    pectoral: true,
    anal: false,
    fullBody: false,
    flat: true,
    arch: 0.22,
    peduncle: 0.38,
    tailSpan: 0.12,
    eye: 0.014,
    pelvic: true,
    adipose: true,
  },
  small: {
    halfHeight: 0.095,
    halfWidth: 0.055,
    peak: 0.35,
    blunt: 0.75,
    tail: 'forked',
    dorsal: { start: 0.4, end: 0.58, height: 0.08 },
    pectoral: true,
    anal: false,
    fullBody: false,
    flat: false,
    arch: 0.1,
    peduncle: 0.3,
    tailSpan: 0.13,
    eye: 0.034,
    pelvic: true,
    adipose: false,
  },
};

const SEGMENTS = 30;
const RADIAL = 16;
/** The body ends here (fraction of length); the tail fin covers the rest. */
const BODY_END = 0.9;

/**
 * Body radius profile in [0, 1]: zero at the nose, a rounded head, the thickest point at `peak`,
 * then a smooth taper to a narrow tail stalk (the peduncle).
 */
export function bodyProfile(t: number, p: FishParams): number {
  const tt = Math.max(0, Math.min(1, t / BODY_END));
  const peak = Math.max(0.05, Math.min(0.9, p.peak));
  if (tt <= peak) {
    const u = tt / peak;
    // Elliptical head, sharper for low `blunt`.
    return Math.pow(1 - (1 - u) * (1 - u), 0.35 + 0.45 * p.blunt);
  }
  const u = (tt - peak) / (1 - peak);
  const ped = Math.max(0.08, Math.min(0.8, p.peduncle * 0.45));
  const fall = Math.pow(Math.cos((Math.PI / 2) * Math.pow(u, 1.15)), 1.5);
  // A slight flare just before the tail where the caudal rays attach.
  const flare = 0.05 * Math.exp(-Math.pow((u - 0.97) / 0.05, 2));
  return ped + (1 - ped) * fall + flare;
}

export interface FishGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  aT: Float32Array;
  aPart: Float32Array;
  aFin: Float32Array;
  indices: Uint16Array;
}

/** Top and bottom half-heights and half-width of the body cross-section at t. */
export function bodySection(t: number, p: FishParams) {
  const r = bodyProfile(t, p);
  const top = p.halfHeight * r * (1 + p.arch);
  const bottom = p.halfHeight * r * (1 - p.arch * 0.5) * (p.flat ? 0.78 : 1);
  return { top, bottom, width: p.halfWidth * r };
}

/** Where the eye sits (object space) and its radius. */
export function eyeOf(p: FishParams): { x: number; y: number; r: number } {
  const t = Math.max(0.05, p.eye * 2.6 + 0.03);
  const s = bodySection(t, p);
  return { x: 0.5 - t, y: s.top * 0.3, r: p.eye };
}

export function fishGeometryData(archetype: FishArchetype): FishGeometryData {
  const p = FISH_PARAMS[archetype];
  const pos: number[] = [];
  const aT: number[] = [];
  const part: number[] = [];
  const fin: number[] = [];
  const idx: number[] = [];
  const X = (t: number) => 0.5 - t;
  const ex = p.flat ? 0.75 : 0.9; // super-ellipse exponent: flat fish are boxier

  // Body rings
  for (let i = 0; i <= SEGMENTS; i++) {
    // Denser rings at the head and tail where the shape changes fastest.
    const s = i / SEGMENTS;
    const t = (0.5 - 0.5 * Math.cos(Math.PI * s)) * 0.35 * BODY_END + s * 0.65 * BODY_END;
    const sec = bodySection(t, p);
    for (let j = 0; j < RADIAL; j++) {
      const th = (j / RADIAL) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const cy = Math.sign(c) * Math.pow(Math.abs(c), ex);
      const sz = Math.sign(sn) * Math.pow(Math.abs(sn), ex);
      pos.push(X(t), cy * (c >= 0 ? sec.top : sec.bottom), sz * sec.width);
      aT.push(t);
      part.push(0);
      fin.push(0, 0);
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
  // Close the tail end of the body.
  {
    const centre = pos.length / 3;
    pos.push(X(BODY_END), 0, 0);
    aT.push(BODY_END);
    part.push(0);
    fin.push(0, 0);
    const last = SEGMENTS * RADIAL;
    for (let j = 0; j < RADIAL; j++) idx.push(last + j, centre, last + ((j + 1) % RADIAL));
  }

  const vertex = (x: number, y: number, z: number, t: number, fu: number, fv: number) => {
    pos.push(x, y, z);
    aT.push(t);
    part.push(1);
    fin.push(fu, fv);
    return pos.length / 3 - 1;
  };
  /**
   * A fin as a fan from a base centre to an outline. Points are [t, y, z]; the outline runs from one
   * end of the base, around the edge, to the other end of the base.
   */
  const fan = (centre: [number, number, number], outline: Array<[number, number, number]>) => {
    const c = vertex(X(centre[0]), centre[1], centre[2], centre[0], 0, 0.5);
    const ids = outline.map(([t, y, z], k) => {
      const ends = k === 0 || k === outline.length - 1;
      return vertex(X(t), y, z, t, ends ? 0.15 : 1, k / (outline.length - 1));
    });
    for (let k = 0; k < ids.length - 1; k++) idx.push(c, ids[k], ids[k + 1]);
  };
  const topAt = (t: number) => bodySection(t, p).top;
  const botAt = (t: number) => bodySection(t, p).bottom;
  const widthAt = (t: number) => bodySection(t, p).width;

  // Caudal fin (vertical plane)
  const tb = BODY_END - 0.035;
  const yb = Math.max(topAt(tb), 0.012) * 1.05;
  const s = p.tailSpan;
  const tail: Array<[number, number, number]> = [];
  if (p.tail === 'tiny') {
    tail.push(
      [tb, yb, 0],
      [tb + 0.05, yb * 0.9, 0],
      [tb + 0.11, 0, 0],
      [tb + 0.05, -yb * 0.9, 0],
      [tb, -yb, 0],
    );
  } else if (p.tail === 'rounded') {
    tail.push([tb, yb, 0]);
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI / 2 - (k / 8) * Math.PI;
      tail.push([tb + 0.035 + Math.cos(a) * 0.13, Math.sin(a) * s, 0]);
    }
    tail.push([tb, -yb, 0]);
  } else {
    const len = p.tail === 'lunate' ? 0.2 : p.tail === 'forked' ? 0.21 : 0.17;
    const notch = p.tail === 'lunate' ? 0.07 : p.tail === 'forked' ? 0.1 : 0.14;
    for (const sg of [1, -1]) {
      const lobe: Array<[number, number, number]> = [
        [tb, sg * yb, 0],
        [tb + len * 0.3, sg * s * 0.55, 0],
        [tb + len * 0.65, sg * s * 0.86, 0],
        [tb + len, sg * s, 0],
        [tb + len * 0.82, sg * s * 0.62, 0],
        [tb + (len + notch) * 0.5, sg * s * 0.3, 0],
      ];
      if (sg > 0) tail.push(...lobe);
      else tail.push(...lobe.reverse());
    }
    // the fork notch sits between the two lobes
    tail.splice(6, 0, [tb + notch, 0, 0]);
  }
  fan([tb - 0.01, 0, 0], tail);

  // Dorsal fin: a taller leading edge sweeping back (spiny-rayed look), on the back line.
  if (p.dorsal) {
    const d = p.dorsal;
    const L = d.end - d.start;
    const base = (t: number) => topAt(t) * 0.93;
    const pts: Array<[number, number, number]> = [
      [d.start, base(d.start), 0],
      [d.start + L * 0.08, base(d.start + L * 0.08) + d.height * 0.95, 0],
      [d.start + L * 0.22, base(d.start + L * 0.22) + d.height, 0],
      [d.start + L * 0.45, base(d.start + L * 0.45) + d.height * 0.78, 0],
      [d.start + L * 0.7, base(d.start + L * 0.7) + d.height * 0.62, 0],
      [d.end + 0.015, base(d.end) + d.height * 0.42, 0],
      [d.end, base(d.end), 0],
    ];
    fan([(d.start + d.end) / 2, base((d.start + d.end) / 2) * 0.9, 0], pts);
  }
  if (p.adipose) {
    const t0 = 0.72;
    const t1 = 0.78;
    fan(
      [(t0 + t1) / 2, topAt((t0 + t1) / 2) * 0.85, 0],
      [
        [t0, topAt(t0) * 0.92, 0],
        [t0 + 0.02, topAt(t0) + 0.022, 0],
        [t1, topAt(t1) + 0.018, 0],
        [t1, topAt(t1) * 0.92, 0],
      ],
    );
  }
  // Anal fin
  if (p.anal) {
    const a0 = 0.6;
    const a1 = 0.76;
    const h = Math.max(0.04, p.halfHeight * 0.42);
    fan(
      [(a0 + a1) / 2, -botAt((a0 + a1) / 2) * 0.9, 0],
      [
        [a0, -botAt(a0) * 0.93, 0],
        [a0 + 0.03, -botAt(a0 + 0.03) - h * 0.95, 0],
        [a0 + 0.07, -botAt(a0 + 0.07) - h, 0],
        [a1 - 0.02, -botAt(a1 - 0.02) - h * 0.55, 0],
        [a1 + 0.01, -botAt(a1) - h * 0.3, 0],
        [a1, -botAt(a1) * 0.93, 0],
      ],
    );
  }
  // Eels: continuous low dorsal and ventral fringes that run into the tail.
  if (p.fullBody) {
    for (const [sg, from] of [
      [1, 0.38],
      [-1, 0.52],
    ] as const) {
      const pts: Array<[number, number, number]> = [];
      const n = 12;
      for (let k = 0; k <= n; k++) {
        const t = from + ((tb - from) * k) / n;
        const edge = sg * ((sg > 0 ? topAt(t) : botAt(t)) + 0.012 + 0.006 * (k / n));
        pts.push([t, edge, 0]);
      }
      const baseIds: number[] = [];
      const edgeIds: number[] = [];
      pts.forEach(([t, y], k) => {
        const b = sg * (sg > 0 ? topAt(t) : botAt(t)) * 0.9;
        baseIds.push(vertex(X(t), b, 0, t, 0, k / n));
        edgeIds.push(vertex(X(t), y, 0, t, 1, k / n));
      });
      for (let k = 0; k < n; k++)
        idx.push(
          baseIds[k],
          edgeIds[k],
          baseIds[k + 1],
          baseIds[k + 1],
          edgeIds[k],
          edgeIds[k + 1],
        );
    }
  }
  // Pectoral fins: paddles behind the gill cover, angled out, back and down.
  if (p.pectoral) {
    const t = 0.23;
    const w = widthAt(t) * 0.92;
    const y0 = -botAt(t) * (p.flat ? 0.55 : 0.4);
    const L = p.flat ? 0.16 : 0.13;
    for (const side of [1, -1]) {
      fan(
        [t + 0.012, y0, side * w],
        [
          [t, y0 + 0.006, side * w],
          [t + L * 0.55, y0 + 0.004, side * (w + L * 0.42)],
          [t + L, y0 - 0.012, side * (w + L * 0.5)],
          [t + L * 0.85, y0 - 0.03, side * (w + L * 0.36)],
          [t + 0.03, y0 - 0.008, side * w],
        ],
      );
    }
  }
  // Pelvic fins: small, under the belly.
  if (p.pelvic) {
    const t = p.flat ? 0.42 : 0.4;
    const w = widthAt(t) * 0.4;
    const y0 = -botAt(t) * 0.95;
    for (const side of [1, -1]) {
      fan(
        [t + 0.01, y0, side * w],
        [
          [t, y0, side * w],
          [t + 0.06, y0 - 0.02, side * (w + 0.025)],
          [t + 0.09, y0 - 0.032, side * (w + 0.018)],
          [t + 0.07, y0 - 0.036, side * w],
          [t + 0.025, y0 - 0.004, side * w],
        ],
      );
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
    // A collapsed nose vertex can come out degenerate: point it forward.
    if (!(l > 0) || (normals[i * 3] === 0 && normals[i * 3 + 1] === 0 && normals[i * 3 + 2] === 0))
      normals[i * 3] = 1;
  }
  return {
    positions,
    normals,
    aT: new Float32Array(aT),
    aPart: new Float32Array(part),
    aFin: new Float32Array(fin),
    indices,
  };
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
  g.setAttribute('aFin', new BufferAttribute(d.aFin, 2));
  g.setIndex(new BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  cache.set(archetype, g);
  return g;
}

export const isFishArchetype = (a: string): a is FishArchetype => a in FISH_PARAMS;
