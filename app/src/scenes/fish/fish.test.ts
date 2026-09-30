import { describe, expect, it } from 'vitest';
import type { FishArchetype } from '@wi/shared';
import {
  FISH_PARAMS,
  bodyProfile,
  buildFishGeometry,
  fishGeometryData,
  isFishArchetype,
} from './fishGeometry';
import { FishSim, bandRange, mulberry32, type SpeciesSim } from './boids';
import { buildCritterGeometry } from './critters';

const ARCHETYPES = Object.keys(FISH_PARAMS) as FishArchetype[];

describe('procedural fish geometry', () => {
  it('builds valid meshes for every archetype with the attributes the shader needs', () => {
    for (const a of ARCHETYPES) {
      const d = fishGeometryData(a);
      const n = d.positions.length / 3;
      expect(n).toBeGreaterThan(150);
      expect(d.normals).toHaveLength(d.positions.length);
      expect(d.aT).toHaveLength(n);
      expect(d.aPart).toHaveLength(n);
      expect(d.indices.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(n);
      expect(d.indices.length % 3).toBe(0);
      expect(d.positions.every(Number.isFinite)).toBe(true);
      expect(d.normals.every(Number.isFinite)).toBe(true);
      // body is about one unit long, nose forward (+X)
      const xs = Array.from({ length: n }, (_, i) => d.positions[i * 3]);
      expect(Math.max(...xs)).toBeCloseTo(0.5, 2);
      expect(Math.min(...xs)).toBeGreaterThan(-0.75);
      expect(Math.min(...xs)).toBeLessThan(-0.45);
    }
  });
  it('differs by archetype: body depth-to-length ratio', () => {
    const heightOf = (a: FishArchetype) => {
      const d = fishGeometryData(a);
      let m = 0;
      for (let i = 0; i < d.positions.length / 3; i++)
        if (d.aPart[i] === 0) m = Math.max(m, d.positions[i * 3 + 1]);
      return m * 2;
    };
    expect(heightOf('compressed')).toBeGreaterThan(heightOf('fusiform'));
    expect(heightOf('fusiform')).toBeGreaterThan(heightOf('elongate'));
    expect(heightOf('elongate')).toBeGreaterThan(heightOf('anguilliform'));
  });
  it('tapers to the nose and has a thin tail stalk', () => {
    const p = FISH_PARAMS.fusiform;
    expect(bodyProfile(0, p)).toBeCloseTo(0, 6);
    expect(bodyProfile(0.36, p)).toBeGreaterThan(0.9);
    expect(bodyProfile(0.9, p)).toBeLessThan(0.3);
  });
  it('gives fins (aPart = 1) per archetype: eels have none besides the tiny tail', () => {
    const fins = (a: FishArchetype) => fishGeometryData(a).aPart.filter((v) => v === 1).length;
    expect(fins('fusiform')).toBeGreaterThan(fins('anguilliform'));
    expect(FISH_PARAMS.anguilliform.fullBody).toBe(true);
    expect(FISH_PARAMS.fusiform.fullBody).toBe(false);
  });
  it('caches geometry per archetype and recognises archetype names', () => {
    expect(buildFishGeometry('small')).toBe(buildFishGeometry('small'));
    expect(isFishArchetype('benthic')).toBe(true);
    expect(isFishArchetype('turtle')).toBe(false);
  });
  it('builds critter meshes for the non-fish archetypes', () => {
    for (const a of ['turtle', 'crayfish', 'crab', 'mussel', 'frog', 'mammal']) {
      const g = buildCritterGeometry(a);
      expect(g.attributes.position.count).toBeGreaterThan(100);
      expect(g.attributes.normal.count).toBe(g.attributes.position.count);
    }
  });
});

const flatBed = (d: number) => ({
  bounds: { minX: -80, maxX: 80, minZ: -50, maxZ: 50 },
  bedDepth: () => d,
});
const slopedBed = {
  bounds: { minX: -80, maxX: 80, minZ: -50, maxZ: 50 },
  bedDepth: (x: number) => Math.max(0.5, (x + 100) * 0.12),
};
const sp = (over: Partial<SpeciesSim>): SpeciesSim => ({
  count: 12,
  band: 'midwater',
  schooling: false,
  length: 0.4,
  speed: 0.8,
  ...over,
});

function run(sim: FishSim, seconds: number, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) sim.update(dt);
}

describe('fish movement', () => {
  it('keeps benthic species within 1 m of the bed', () => {
    const sim = new FishSim([sp({ band: 'benthic', count: 10 })], slopedBed, { seed: 3 });
    for (let k = 0; k < 20; k++) {
      run(sim, 2);
      for (const a of sim.agents) {
        const bed = slopedBed.bedDepth(a.x);
        const above = a.y - -bed;
        expect(above).toBeGreaterThanOrEqual(-0.001);
        expect(above).toBeLessThanOrEqual(1.001);
      }
    }
  });
  it('keeps surface species near the surface and midwater species off the bed and surface', () => {
    const sim = new FishSim([sp({ band: 'surface' }), sp({ band: 'midwater' })], flatBed(20), {
      seed: 5,
    });
    run(sim, 40);
    for (const a of sim.agents) {
      if (a.species === 0) expect(a.y).toBeGreaterThan(-2.2);
      else {
        expect(a.y).toBeLessThan(-0.3);
        expect(a.y).toBeGreaterThan(-19.5);
      }
    }
  });
  it('never leaves the swim area or the water column', () => {
    const sim = new FishSim(
      [sp({ schooling: true, count: 24 }), sp({ band: 'littoral' }), sp({ band: 'surface' })],
      slopedBed,
      { seed: 9 },
    );
    for (let k = 0; k < 10; k++) {
      run(sim, 6);
      for (const a of sim.agents) {
        expect(a.x).toBeGreaterThanOrEqual(slopedBed.bounds.minX);
        expect(a.x).toBeLessThanOrEqual(slopedBed.bounds.maxX);
        expect(Math.abs(a.z)).toBeLessThanOrEqual(50);
        expect(a.y).toBeLessThan(0);
        expect(a.y).toBeGreaterThanOrEqual(-slopedBed.bedDepth(a.x) - 0.001);
        expect(Number.isFinite(a.vx + a.vy + a.vz)).toBe(true);
      }
    }
  });
  it('schools stay together (cohesion) while separating (no stacking)', () => {
    const sim = new FishSim(
      [sp({ schooling: true, count: 20, length: 0.25, speed: 0.6 })],
      flatBed(15),
      { seed: 2 },
    );
    run(sim, 30);
    const cx = sim.agents.reduce((s, a) => s + a.x, 0) / 20;
    const cz = sim.agents.reduce((s, a) => s + a.z, 0) / 20;
    const mean = sim.agents.reduce((s, a) => s + Math.hypot(a.x - cx, a.z - cz), 0) / 20;
    expect(mean).toBeLessThan(30);
    let minD = Infinity;
    for (let i = 0; i < 20; i++)
      for (let j = i + 1; j < 20; j++)
        minD = Math.min(
          minD,
          Math.hypot(sim.agents[i].x - sim.agents[j].x, sim.agents[i].z - sim.agents[j].z),
        );
    expect(minD).toBeGreaterThan(0.01);
  });
  it('is deterministic for a seed and moves at roughly the cruise speed', () => {
    const a = new FishSim([sp({})], flatBed(10), { seed: 1 });
    const b = new FishSim([sp({})], flatBed(10), { seed: 1 });
    run(a, 3);
    run(b, 3);
    expect(a.agents.map((x) => x.x)).toEqual(b.agents.map((x) => x.x));
    const speed = Math.hypot(a.agents[0].vx, a.agents[0].vz);
    expect(speed).toBeGreaterThan(0.3);
    expect(speed).toBeLessThan(1.6);
  });
  it('slows down with reduced motion', () => {
    const fast = new FishSim([sp({})], flatBed(10), { seed: 1 });
    const slow = new FishSim([sp({})], flatBed(10), { seed: 1, speedScale: 0.4 });
    run(fast, 5);
    run(slow, 5);
    const v = (s: FishSim) =>
      s.agents.reduce((t, a) => t + Math.hypot(a.vx, a.vz), 0) / s.agents.length;
    expect(v(slow)).toBeLessThan(v(fast) * 0.7);
  });
  it('gives heading angles from velocity', () => {
    const sim = new FishSim([sp({ count: 1 })], flatBed(10), { seed: 1 });
    const a = sim.agents[0];
    Object.assign(a, { vx: 1, vz: 0, vy: 0 });
    expect(sim.heading(a).yaw).toBeCloseTo(0, 6);
    Object.assign(a, { vx: 0, vz: -1, vy: 1 });
    expect(sim.heading(a).yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(sim.heading(a).pitch).toBeGreaterThan(0.5);
  });
  it('defines depth bands', () => {
    expect(bandRange('benthic', 10)).toEqual({ lo: -9.85, hi: -9 });
    expect(bandRange('surface', 10).hi).toBeLessThan(0);
    const r = bandRange('midwater', 30);
    expect(r.lo).toBeLessThan(r.hi);
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
});
