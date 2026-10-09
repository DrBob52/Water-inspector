import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
  type BufferGeometry,
  type ShaderMaterial,
} from 'three';
import type { SceneActor, SceneModel } from '@wi/shared';
import { useRenderQuality } from '../common/SceneCanvas';
import { DEMO } from '../../env';
import { FishSim, mulberry32, type SpeciesSim } from '../fish/boids';
import { buildCritterGeometry } from '../fish/critters';
import { FISH_PARAMS, buildFishGeometry, eyeOf, isFishArchetype } from '../fish/fishGeometry';
import { createFishMaterial } from '../fish/fishMaterial';
import { FISH_VISUAL_SCALE, bedPositions, type World } from './world';
import type { WaterUniforms } from './water';

export interface HoverInfo {
  actor: number;
  instance: number;
  x: number;
  y: number;
}

interface Props {
  model: SceneModel;
  world: World;
  water: WaterUniforms;
  reducedMotion: boolean;
  highlight: string | null;
  onHover: (h: HoverInfo | null) => void;
}

const HUGE = new Sphere(new Vector3(0, -10, 0), 1e4);

function orangeOrPale(a: SceneActor) {
  return a.introduced ? '#ff8a00' : '#bfe9ff';
}

/** Metres: fish are drawn at FISH_VISUAL_SCALE x their typical length so small species stay visible. */
const bodyLength = (a: SceneActor) => Math.max(0.05, (a.lengthCm / 100) * FISH_VISUAL_SCALE);

function speedFor(a: SceneActor, lengthM: number): number {
  return Math.max(0.25, Math.min(1.8, lengthM * (a.schooling ? 2.2 : 1.6)));
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpP = new Vector3();
const tmpS = new Vector3();
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const AXIS_X = new Vector3(1, 0, 0);

interface FishEntry {
  actorIndex: number;
  actor: SceneActor;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  outline: ShaderMaterial;
  mesh: InstancedMesh;
  outlineMesh: InstancedMesh;
  simIndex: number;
  length: number;
  /** Per-instance size jitter. */
  sizes: Float32Array;
}

/**
 * Fish: procedural meshes, one InstancedMesh per species, swimming animation in the vertex shader,
 * boids for schooling species and wander plus obstacle avoidance for solitary ones.
 */
export function Fish({ model, world, water, reducedMotion, highlight, onHover }: Props) {
  const quality = useRenderQuality();
  const hoverRef = useRef<HoverInfo | null>(null);

  const built = useMemo(() => {
    const entries: FishEntry[] = [];
    const specs: SpeciesSim[] = [];
    const rng = mulberry32(99);
    model.actors.forEach((actor, actorIndex) => {
      if (!isFishArchetype(actor.archetype)) return;
      const len = bodyLength(actor);
      const speed = speedFor(actor, len);
      const geometry = buildFishGeometry(actor.archetype).clone();
      const phase = new Float32Array(actor.count);
      const tint = new Float32Array(actor.count);
      const sizes = new Float32Array(actor.count);
      for (let i = 0; i < actor.count; i++) {
        phase[i] = rng() * Math.PI * 2;
        tint[i] = 0.88 + rng() * 0.24;
        sizes[i] = 0.86 + rng() * 0.28;
      }
      geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
      geometry.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));
      const params = FISH_PARAMS[actor.archetype];
      const base = {
        colors: actor.colors,
        water,
        eye: eyeOf(params),
        sheen: actor.archetype === 'benthic' ? 0.5 : 1,
        waveAmp: params.fullBody ? 0.09 : 0.065,
        waveFreq:
          Math.max(4, Math.min(16, 5 + (speed / Math.max(len, 0.1)) * 1.4)) *
          (reducedMotion ? 0.5 : 1),
        fullBody: params.fullBody,
      };
      const material = createFishMaterial(base);
      const outline = createFishMaterial({
        ...base,
        outline: true,
        outlineColor: orangeOrPale(actor),
      });
      const mesh = new InstancedMesh(geometry, material, actor.count);
      const outlineMesh = new InstancedMesh(geometry, outline, 1);
      mesh.frustumCulled = false;
      mesh.boundingSphere = HUGE;
      outlineMesh.frustumCulled = false;
      outlineMesh.visible = false;
      outlineMesh.renderOrder = 2;
      specs.push({
        count: actor.count,
        band: actor.depthBand as SpeciesSim['band'],
        schooling: actor.schooling,
        length: len,
        speed,
      });
      entries.push({
        actorIndex,
        actor,
        geometry,
        material,
        outline,
        mesh,
        outlineMesh,
        simIndex: specs.length - 1,
        length: len,
        sizes,
      });
    });
    // Every species starts around the focus point in front of the camera so the shot is populated.
    const nearSpecies = entries.map((e) => e.simIndex);
    const sim = new FishSim(
      specs,
      { bounds: world.bounds, bedDepth: world.bedDepth, littoralX: world.littoralX },
      {
        seed: 11,
        spawnCentre: [world.focus.x, world.focus.z],
        nearSpecies,
        speedScale: reducedMotion ? 0.4 : 1,
      },
    );
    // Let the schools form before the first frame.
    for (let k = 0; k < 90; k++) sim.update(1 / 15);
    return { entries, sim };
  }, [model, world, water, reducedMotion]);

  useEffect(
    () => () => {
      for (const e of built.entries) {
        e.geometry.dispose();
        e.material.dispose();
        e.outline.dispose();
        e.mesh.dispose();
        e.outlineMesh.dispose();
      }
    },
    [built],
  );

  // Highlight from the Life tab.
  useEffect(() => {
    for (const e of built.entries)
      e.material.uniforms.uGlow.value = highlight && e.actor.scientificName === highlight ? 1 : 0;
  }, [built, highlight]);

  const writeMatrix = (e: FishEntry, i: number, slot: InstancedMesh) => {
    const a = built.sim.agents[built.sim.speciesStart[e.simIndex] + i];
    const { yaw, pitch, roll } = built.sim.heading(a);
    tmpQ.setFromAxisAngle(AXIS_Y, yaw);
    // Fish rarely swim steeply up or down; keep the body near level.
    tmpQ2.setFromAxisAngle(AXIS_Z, Math.max(-0.35, Math.min(0.35, pitch)));
    tmpQ.multiply(tmpQ2);
    tmpQ2.setFromAxisAngle(AXIS_X, roll);
    tmpQ.multiply(tmpQ2);
    tmpP.set(a.x, a.y, a.z);
    const s = e.length * e.sizes[i];
    tmpS.set(s, s, s);
    tmpM.compose(tmpP, tmpQ, tmpS);
    slot.setMatrixAt(i, tmpM);
  };

  const lastPublish = useRef(0);
  useFrame((state, dt) => {
    const cam = state.camera.position;
    built.sim.avoid = {
      x: cam.x,
      y: cam.y,
      z: cam.z,
      r: Math.max(1.7, Math.min(5, world.renderVisibility * 0.6)),
    };
    built.sim.update(reducedMotion ? dt * 0.5 : dt);
    if (DEMO && state.clock.elapsedTime - lastPublish.current > 0.25) {
      // Test hook (demo builds only): where each fish is on screen, so e2e tests can hover one.
      lastPublish.current = state.clock.elapsedTime;
      const rect = state.gl.domElement.getBoundingClientRect();
      const out: Array<{ actor: number; instance: number; x: number; y: number; dist: number }> =
        [];
      for (const e of built.entries) {
        for (let i = 0; i < e.actor.count; i++) {
          const a = built.sim.agents[built.sim.speciesStart[e.simIndex] + i];
          tmpP.set(a.x, a.y, a.z);
          const dist = tmpP.distanceTo(state.camera.position);
          tmpP.project(state.camera);
          if (tmpP.z < -1 || tmpP.z > 1 || Math.abs(tmpP.x) > 0.95 || Math.abs(tmpP.y) > 0.95)
            continue;
          out.push({
            actor: e.actorIndex,
            instance: i,
            x: rect.left + (tmpP.x * 0.5 + 0.5) * rect.width,
            y: rect.top + (1 - (tmpP.y * 0.5 + 0.5)) * rect.height,
            dist,
          });
        }
      }
      (window as unknown as { __wiFish?: unknown }).__wiFish = out
        .sort((p, q) => p.dist - q.dist)
        .slice(0, 20);
    }
    const t = reducedMotion ? state.clock.elapsedTime * 0.4 : state.clock.elapsedTime;
    for (const e of built.entries) {
      e.material.uniforms.uTime.value = t;
      e.outline.uniforms.uTime.value = t;
      const n = Math.max(1, Math.ceil(e.actor.count * quality));
      e.mesh.count = n;
      for (let i = 0; i < n; i++) writeMatrix(e, i, e.mesh);
      e.mesh.instanceMatrix.needsUpdate = true;
      const h = hoverRef.current;
      if (h && h.actor === e.actorIndex && h.instance < n) {
        // The outline mesh has a single slot; move the hovered instance there.
        e.mesh.getMatrixAt(h.instance, tmpM);
        e.outlineMesh.setMatrixAt(0, tmpM);
        e.outlineMesh.instanceMatrix.needsUpdate = true;
        e.outlineMesh.visible = true;
      } else e.outlineMesh.visible = false;
    }
  });

  const handlers = (e: FishEntry) => ({
    onPointerMove: (ev: ThreeEvent<PointerEvent>) => {
      if (ev.instanceId === undefined) return;
      ev.stopPropagation();
      const info = {
        actor: e.actorIndex,
        instance: ev.instanceId,
        x: ev.nativeEvent.clientX,
        y: ev.nativeEvent.clientY,
      };
      hoverRef.current = info;
      onHover(info);
    },
    onPointerOut: () => {
      hoverRef.current = null;
      onHover(null);
    },
    onClick: (ev: ThreeEvent<MouseEvent>) => {
      if (ev.instanceId === undefined) return;
      ev.stopPropagation();
      const info = {
        actor: e.actorIndex,
        instance: ev.instanceId,
        x: ev.nativeEvent.clientX,
        y: ev.nativeEvent.clientY,
      };
      hoverRef.current = info;
      onHover(info);
    },
  });

  return (
    <>
      {built.entries.map((e) => (
        <group key={e.actor.key}>
          <primitive object={e.mesh} {...handlers(e)} />
          <primitive object={e.outlineMesh} />
        </group>
      ))}
    </>
  );
}

// Non-fish animals ------------------------------------------------------------------------------

interface Critter {
  x: number;
  y: number;
  z: number;
  heading: number;
  wa: number;
  speed: number;
  phase: number;
  size: number;
  homeX: number;
  homeZ: number;
}

interface CritterEntry {
  actorIndex: number;
  actor: SceneActor;
  mesh: InstancedMesh;
  outlineMesh: InstancedMesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  outlineMaterial: ShaderMaterial;
  critters: Critter[];
}

export function Critters({ model, world, water, reducedMotion, highlight, onHover }: Props) {
  const hoverRef = useRef<HoverInfo | null>(null);
  const built = useMemo<CritterEntry[]>(() => {
    const rng = mulberry32(42);
    const out: CritterEntry[] = [];
    const b = world.bounds;
    const mx = (b.maxX - b.minX) * 0.5;
    const mz = (b.maxZ - b.minZ) * 0.5;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    model.actors.forEach((actor, actorIndex) => {
      if (isFishArchetype(actor.archetype)) return;
      const geometry = buildCritterGeometry(actor.archetype);
      const base = {
        colors: actor.colors,
        water,
        waveAmp: 0,
        waveFreq: 0,
        fullBody: false,
        sheen: actor.archetype === 'mussel' || actor.archetype === 'turtle' ? 0.6 : 0.35,
      };
      const material = createFishMaterial(base);
      const outlineMaterial = createFishMaterial({
        ...base,
        outline: true,
        outlineColor: orangeOrPale(actor),
      });
      const size = Math.max(0.14, (actor.lengthCm / 100) * FISH_VISUAL_SCALE);
      const a = actor.archetype;
      const n = Math.min(actor.count, a === 'mussel' ? 24 : 12);
      const critters: Critter[] = [];
      const onBed = a === 'crayfish' || a === 'crab' || a === 'mussel';
      const placed = onBed
        ? bedPositions(world, n, 0.8, 30, 300 + actorIndex)
        : a === 'frog'
          ? bedPositions(world, n, 0.4, 5, 400 + actorIndex)
          : [];
      for (let i = 0; i < n; i++) {
        const p = placed[i];
        let x: number;
        let z: number;
        let y: number;
        if (p) {
          x = p.x;
          z = p.z;
          y = p.y;
        } else if (a === 'frog') {
          x = b.minX + rng() * mx;
          z = cz + (rng() - 0.5) * mz;
          y = -0.22;
        } else {
          x = cx + (rng() - 0.5) * mx;
          z = cz + (rng() - 0.5) * mz;
          y = a === 'turtle' ? -(0.8 + rng() * 1.2) : -0.55;
        }
        critters.push({
          x,
          y,
          z,
          heading: rng() * Math.PI * 2,
          wa: rng() * 6,
          speed:
            a === 'turtle'
              ? 0.35
              : a === 'mammal'
                ? 0.7
                : a === 'mussel' || a === 'frog'
                  ? 0
                  : 0.12,
          phase: rng() * 6.28,
          size: size * (0.85 + 0.3 * rng()),
          homeX: x,
          homeZ: z,
        });
      }
      const count = Math.max(1, critters.length);
      const phase = new Float32Array(count);
      const tint = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        phase[i] = rng() * 6.28;
        tint[i] = 0.85 + rng() * 0.3;
      }
      geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
      geometry.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));
      const mesh = new InstancedMesh(geometry, material, count);
      const outlineMesh = new InstancedMesh(geometry, outlineMaterial, 1);
      mesh.frustumCulled = false;
      mesh.boundingSphere = HUGE;
      outlineMesh.frustumCulled = false;
      outlineMesh.visible = false;
      out.push({
        actorIndex,
        actor,
        mesh,
        outlineMesh,
        geometry,
        material,
        outlineMaterial,
        critters,
      });
    });
    return out;
  }, [model, world, water]);

  useEffect(
    () => () => {
      for (const e of built) {
        e.geometry.dispose();
        e.material.dispose();
        e.outlineMaterial.dispose();
        e.mesh.dispose();
        e.outlineMesh.dispose();
      }
    },
    [built],
  );
  useEffect(() => {
    for (const e of built)
      e.material.uniforms.uGlow.value = highlight && e.actor.scientificName === highlight ? 1 : 0;
  }, [built, highlight]);

  useFrame((state, dt) => {
    const step = Math.min(dt, 0.05) * (reducedMotion ? 0.4 : 1);
    const t = state.clock.elapsedTime * (reducedMotion ? 0.4 : 1);
    for (const e of built) {
      e.material.uniforms.uTime.value = t;
      const a = e.actor.archetype;
      e.critters.forEach((c, i) => {
        let roll = 0;
        let pitch = 0;
        if (c.speed > 0) {
          c.wa += Math.sin(t * 0.3 + c.phase) * 0.8 * step;
          c.heading += Math.sin(c.wa) * step * 0.8;
          c.x += Math.cos(c.heading) * c.speed * step;
          c.z -= Math.sin(c.heading) * c.speed * step;
          // stay in the arena
          const b = world.bounds;
          if (c.x < b.minX + 2 || c.x > b.maxX - 2) c.heading = Math.PI - c.heading;
          if (c.z < b.minZ + 2 || c.z > b.maxZ - 2) c.heading = -c.heading;
          c.x = Math.max(b.minX, Math.min(b.maxX, c.x));
          c.z = Math.max(b.minZ, Math.min(b.maxZ, c.z));
        }
        let y = c.y;
        if (a === 'crayfish' || a === 'crab') {
          y = -world.bedDepth(c.x, c.z);
          roll = Math.sin(t * 9 + c.phase) * 0.06; // walking
          pitch = Math.sin(t * 4.5 + c.phase) * 0.04;
        } else if (a === 'mussel') {
          y = -world.bedDepth(c.x, c.z) - 0.02;
        } else if (a === 'turtle') {
          pitch = Math.sin(t * 2.2 + c.phase) * 0.12; // paddling
          roll = Math.sin(t * 1.1 + c.phase) * 0.1;
          y = c.y + Math.sin(t * 0.5 + c.phase) * 0.1;
        } else if (a === 'frog') {
          y = c.y + (c.y > -0.3 ? Math.sin(t * 1.4 + c.phase) * 0.02 : 0);
        } else {
          y = c.y + Math.sin(t * 0.8 + c.phase) * 0.05;
        }
        tmpQ.setFromAxisAngle(AXIS_Y, c.heading);
        tmpQ2.setFromAxisAngle(AXIS_Z, pitch);
        tmpQ.multiply(tmpQ2);
        tmpQ2.setFromAxisAngle(AXIS_X, roll);
        tmpQ.multiply(tmpQ2);
        tmpP.set(c.x, y, c.z);
        tmpS.set(c.size, c.size, c.size);
        tmpM.compose(tmpP, tmpQ, tmpS);
        e.mesh.setMatrixAt(i, tmpM);
      });
      e.mesh.instanceMatrix.needsUpdate = true;
      const h = hoverRef.current;
      if (h && h.actor === e.actorIndex && h.instance < e.critters.length) {
        e.mesh.getMatrixAt(h.instance, tmpM);
        // slightly enlarge the outline hull
        tmpM.decompose(tmpP, tmpQ, tmpS);
        tmpS.multiplyScalar(1.12);
        tmpM.compose(tmpP, tmpQ, tmpS);
        e.outlineMesh.setMatrixAt(0, tmpM);
        e.outlineMesh.instanceMatrix.needsUpdate = true;
        e.outlineMesh.visible = true;
      } else e.outlineMesh.visible = false;
    }
  });

  return (
    <>
      {built.map((e) => (
        <group key={e.actor.key}>
          <primitive
            object={e.mesh}
            onPointerMove={(ev: ThreeEvent<PointerEvent>) => {
              if (ev.instanceId === undefined) return;
              ev.stopPropagation();
              const info = {
                actor: e.actorIndex,
                instance: ev.instanceId,
                x: ev.nativeEvent.clientX,
                y: ev.nativeEvent.clientY,
              };
              hoverRef.current = info;
              onHover(info);
            }}
            onPointerOut={() => {
              hoverRef.current = null;
              onHover(null);
            }}
          />
          <primitive object={e.outlineMesh} />
        </group>
      ))}
    </>
  );
}
