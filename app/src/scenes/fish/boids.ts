/**
 * Fish movement: boids (separation, alignment, cohesion) for schooling species, wander plus
 * obstacle avoidance for solitary ones, each constrained to its depth band. Benthic species stay
 * within 1 m of the bed. Pure TypeScript so it can be unit tested without WebGL.
 */

export type DepthBand = 'surface' | 'littoral' | 'midwater' | 'benthic';

export interface SimBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SimEnv {
  bounds: SimBounds;
  /** Bed depth below the surface (positive metres) at x, z. */
  bedDepth: (x: number, z: number) => number;
  /** x the littoral species drift toward (the shallow side); defaults to -45. */
  littoralX?: number;
}

export interface SpeciesSim {
  count: number;
  band: DepthBand;
  schooling: boolean;
  /** Body length in metres. */
  length: number;
  /** Cruising speed in m/s. */
  speed: number;
}

export interface Agent {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  species: number;
  /** Slowly varying wander angles. */
  wa: number;
  wb: number;
  speedJitter: number;
  /** Bank angle about the body axis (radians), leaning into turns. */
  roll: number;
  /** Heading on the previous step, for the turn rate. */
  prevYaw: number;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vertical range (negative y, surface at 0) a fish of this band may occupy at a point. */
export function bandRange(band: DepthBand, bed: number): { lo: number; hi: number } {
  const floor = Math.max(0.3, bed);
  switch (band) {
    case 'surface':
      return { lo: -Math.min(1.6, floor - 0.2), hi: -0.25 };
    case 'littoral':
      return { lo: -Math.min(Math.max(floor - 0.3, 0.4), 5), hi: -0.3 };
    case 'midwater':
      return { lo: -Math.max(0.8, Math.min(floor - 0.8, 16)), hi: -Math.min(2, floor * 0.35) };
    case 'benthic':
      return { lo: -floor + 0.15, hi: -floor + 1.0 };
  }
}

export interface SimOptions {
  seed?: number;
  /** Multiplier for speeds (reduced motion uses less than 1). */
  speedScale?: number;
  /** Spawn near this point (e.g. in front of the camera) for species with `near` set. */
  spawnCentre?: [number, number];
  nearSpecies?: number[];
}

export class FishSim {
  readonly agents: Agent[] = [];
  readonly speciesStart: number[] = [];
  private rng: () => number;
  /** One wander heading per species, so a school turns as one. */
  private schoolHeading: number[] = [];
  speedScale: number;
  /** A point fish keep clear of (the camera), with its radius. */
  avoid: { x: number; y: number; z: number; r: number } | null = null;

  constructor(
    readonly species: SpeciesSim[],
    readonly env: SimEnv,
    opts: SimOptions = {},
  ) {
    this.rng = mulberry32(opts.seed ?? 7);
    this.speedScale = opts.speedScale ?? 1;
    const { bounds } = env;
    const cx = opts.spawnCentre?.[0] ?? (bounds.minX + bounds.maxX) / 2;
    const cz = opts.spawnCentre?.[1] ?? (bounds.minZ + bounds.maxZ) / 2;
    species.forEach((s, si) => {
      this.speciesStart.push(this.agents.length);
      this.schoolHeading.push(this.rng() * Math.PI * 2);
      const near = opts.nearSpecies?.includes(si);
      // Schools spawn as a loose cluster, solitary fish anywhere.
      const gx = near
        ? cx + (this.rng() - 0.5) * 16
        : bounds.minX + (bounds.maxX - bounds.minX) * (0.1 + 0.8 * this.rng());
      const gz = near
        ? cz + (this.rng() - 0.5) * 16
        : bounds.minZ + (bounds.maxZ - bounds.minZ) * (0.1 + 0.8 * this.rng());
      for (let i = 0; i < s.count; i++) {
        const spread = s.schooling ? 2 + s.length * 5 : 0;
        const x = s.schooling
          ? gx + (this.rng() - 0.5) * spread
          : near
            ? cx + (this.rng() - 0.5) * 20
            : bounds.minX + (bounds.maxX - bounds.minX) * this.rng();
        const z = s.schooling
          ? gz + (this.rng() - 0.5) * spread
          : near
            ? cz + (this.rng() - 0.5) * 20
            : bounds.minZ + (bounds.maxZ - bounds.minZ) * this.rng();
        const bed = env.bedDepth(x, z);
        const r = bandRange(s.band, bed);
        const a = this.rng() * Math.PI * 2;
        const sp = s.speed * (0.8 + 0.4 * this.rng());
        this.agents.push({
          x,
          y: r.lo + (r.hi - r.lo) * this.rng(),
          z,
          vx: Math.cos(a) * sp,
          vy: 0,
          vz: Math.sin(a) * sp,
          species: si,
          wa: this.rng() * Math.PI * 2,
          wb: this.rng() * Math.PI * 2,
          speedJitter: 0.85 + 0.3 * this.rng(),
          roll: 0,
          prevYaw: Math.atan2(-Math.sin(a), Math.cos(a)),
        });
      }
    });
  }

  /** Advance the simulation by dt seconds. */
  update(dt: number) {
    const step = Math.min(dt, 0.05);
    const { bounds } = this.env;
    for (let si = 0; si < this.species.length; si++) {
      const sp = this.species[si];
      const start = this.speciesStart[si];
      const end = start + sp.count;
      const cruise = sp.speed * this.speedScale;
      // The school's shared heading drifts slowly; members steer toward it, so turns are collective.
      this.schoolHeading[si] += (this.rng() - 0.5) * 0.9 * step;
      if (sp.schooling && sp.count > 1) {
        // ...but it follows where the school actually goes, so walls and the bed can turn it.
        let mvx = 0;
        let mvz = 0;
        for (let i = start; i < end; i++) {
          mvx += this.agents[i].vx;
          mvz += this.agents[i].vz;
        }
        let d = Math.atan2(mvz, mvx) - this.schoolHeading[si];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.schoolHeading[si] += d * Math.min(1, step * 0.8);
      }
      const sh = this.schoolHeading[si];
      for (let i = start; i < end; i++) {
        const a = this.agents[i];
        let ax = 0;
        let ay = 0;
        let az = 0;
        if (sp.schooling && sp.count > 1) {
          let cx = 0;
          let cy = 0;
          let cz = 0;
          let avx = 0;
          let avy = 0;
          let avz = 0;
          let sx = 0;
          let sz = 0;
          let n = 0;
          const sepR = Math.max(0.3, sp.length * 1.5);
          for (let j = start; j < end; j++) {
            if (j === i) continue;
            const b = this.agents[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > 144) continue; // 12 m neighbourhood
            n++;
            cx += b.x;
            cy += b.y;
            cz += b.z;
            avx += b.vx;
            avy += b.vy;
            avz += b.vz;
            if (d2 < sepR * sepR && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              sx -= (dx / d) * (sepR - d);
              sz -= (dz / d) * (sepR - d);
              ay -= (dy / d) * (sepR - d) * 1.2;
            }
          }
          if (n > 0) {
            ax += (cx / n - a.x) * 0.5 + sx * 2.6 + (avx / n - a.vx) * 1.6;
            ay += (cy / n - a.y) * 0.4 + (avy / n - a.vy) * 1.2;
            az += (cz / n - a.z) * 0.5 + sz * 2.6 + (avz / n - a.vz) * 1.6;
          }
          ax += Math.cos(sh) * 0.7 * cruise;
          az += Math.sin(sh) * 0.7 * cruise;
        }
        // Wander: slowly varying steering, always present but weaker for schools.
        a.wa += (this.rng() - 0.5) * 1.6 * step;
        a.wb += (this.rng() - 0.5) * 1.0 * step;
        const wander = sp.schooling ? 0.12 : 0.9;
        ax += Math.cos(a.wa) * wander * cruise;
        az += Math.sin(a.wa) * wander * cruise;
        ay += Math.sin(a.wb) * 0.1 * cruise;

        // Stay in the swim area (soft wall) with a margin.
        const m = Math.min(
          12,
          0.22 * Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ),
        );
        if (a.x < bounds.minX + m) ax += (bounds.minX + m - a.x) * 0.6;
        if (a.x > bounds.maxX - m) ax -= (a.x - (bounds.maxX - m)) * 0.6;
        if (a.z < bounds.minZ + m) az += (bounds.minZ + m - a.z) * 0.6;
        if (a.z > bounds.maxZ - m) az -= (a.z - (bounds.maxZ - m)) * 0.6;

        // Obstacle avoidance: look ahead at the bed.
        const look = 2.5;
        const sp2 = Math.hypot(a.vx, a.vz) || 1;
        const fx = a.x + (a.vx / sp2) * look;
        const fz = a.z + (a.vz / sp2) * look;
        const bedHere = this.env.bedDepth(a.x, a.z);
        const bedAhead = this.env.bedDepth(fx, fz);
        if (sp.band !== 'benthic' && bedAhead < -a.y + 0.6 && bedAhead < bedHere) {
          // Shallower ahead than we are deep: turn back toward deeper water.
          ax -= (a.vx / sp2) * 2.5 * cruise;
          az -= (a.vz / sp2) * 2.5 * cruise;
          ay += 0.5;
        }

        // Keep clear of the viewer: fish give a diver a little room.
        const av = this.avoid;
        if (av) {
          const dx = a.x - av.x;
          const dy = a.y - av.y;
          const dz = a.z - av.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < av.r * av.r && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const k = ((av.r - d) / av.r) * 6 * Math.max(cruise, 0.3);
            ax += (dx / d) * k;
            ay += (dy / d) * k * 0.4;
            az += (dz / d) * k;
          }
        }

        // Depth band: spring toward the allowed range.
        const r = bandRange(sp.band, bedHere);
        if (a.y > r.hi) ay -= (a.y - r.hi) * 2.2;
        else if (a.y < r.lo) ay += (r.lo - a.y) * 2.2;
        if (sp.band === 'littoral') {
          // Prefer the shallows near the shore (negative x).
          const lx = Math.max(bounds.minX, Math.min(bounds.maxX, this.env.littoralX ?? -45));
          ax += (lx - a.x) * 0.01;
        }

        a.vx += ax * step;
        a.vy += ay * step;
        a.vz += az * step;
        // Speed limit around the cruise speed.
        const horiz = Math.hypot(a.vx, a.vz);
        const target = cruise * a.speedJitter;
        if (horiz > 1e-6) {
          // Ease toward the cruise speed and never exceed 1.4 x of it.
          const eased = horiz + (target - horiz) * Math.min(1, step * 2);
          const k = Math.min(eased, target * 1.4) / horiz;
          a.vx *= k;
          a.vz *= k;
        } else {
          a.vx = target;
        }
        a.vy *= 1 - Math.min(1, step * 2.5);
        a.x += a.vx * step;
        a.y += a.vy * step;
        a.z += a.vz * step;

        // Hard constraints: benthic fish hug the bed, everyone stays inside the water column.
        const bedNow = this.env.bedDepth(a.x, a.z);
        const rr = bandRange(sp.band, bedNow);
        if (sp.band === 'benthic') a.y = Math.min(rr.hi, Math.max(rr.lo, a.y));
        else a.y = Math.min(-0.15, Math.max(-bedNow + 0.3, a.y));
        a.x = Math.min(bounds.maxX, Math.max(bounds.minX, a.x));
        a.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, a.z));
        if (av) {
          // Never closer than 60 % of the keep-clear radius, whatever the other forces say.
          const dx = a.x - av.x;
          const dz = a.z - av.z;
          const dh = Math.hypot(dx, dz);
          const rMin = av.r * 0.6;
          if (dh < rMin && Math.abs(a.y - av.y) < rMin) {
            const k = dh > 1e-4 ? rMin / dh : 0;
            a.x = av.x + (dh > 1e-4 ? dx * k : rMin);
            a.z = av.z + (dh > 1e-4 ? dz * k : 0);
          }
        }

        // Bank into turns: roll toward the inside of the turn, in proportion to the turn rate.
        const yaw = Math.atan2(-a.vz, a.vx);
        let dyaw = yaw - a.prevYaw;
        if (dyaw > Math.PI) dyaw -= Math.PI * 2;
        else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        a.prevYaw = yaw;
        const want = Math.max(-0.7, Math.min(0.7, (-dyaw / Math.max(step, 1e-4)) * 0.45));
        a.roll += (want - a.roll) * Math.min(1, step * 3);
      }
    }
  }

  /** Heading angles for rendering: yaw about Y, pitch about Z and bank (roll) about X. */
  heading(a: Agent): { yaw: number; pitch: number; roll: number } {
    const horiz = Math.hypot(a.vx, a.vz);
    return {
      yaw: Math.atan2(-a.vz, a.vx),
      pitch: Math.atan2(a.vy, Math.max(horiz, 1e-6)),
      roll: a.roll,
    };
  }
}
