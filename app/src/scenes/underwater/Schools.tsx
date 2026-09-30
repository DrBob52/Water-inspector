import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Sphere,
  Vector3,
  type BufferGeometry,
  type ShaderMaterial,
} from 'three';
import type { SceneActor, SceneModel } from '@wi/shared';
import { useRenderQuality } from '../common/SceneCanvas';
import { FishSim, mulberry32, type SpeciesSim } from '../fish/boids';
import { buildCritterGeometry } from '../fish/critters';
import { FISH_PARAMS, buildFishGeometry, isFishArchetype } from '../fish/fishGeometry';
import { createFishMaterial } from '../fish/fishMaterial';
import { FISH_VISUAL_SCALE, bedPositions, type World } from './world';

export interface HoverInfo {
  actor: number;
  instance: number;
  x: number;
  y: number;
}

interface Props {
  model: SceneModel;
  world: World;
  fogColor: string;
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
}

/**
 * Fish: procedural meshes, one InstancedMesh per species, swimming animation in the vertex shader,
 * boids for schooling species and wander plus obstacle avoidance for solitary ones.
 */
export function Fish({ model, world, fogColor, reducedMotion, highlight, onHover }: Props) {
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
      for (let i = 0; i < actor.count; i++) {
        phase[i] = rng() * Math.PI * 2;
        tint[i] = 0.88 + rng() * 0.24;
      }
      geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
      geometry.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));
      const params = FISH_PARAMS[actor.archetype];
      const base = {
        colors: actor.colors,
        fogColor,
        fogDensity: world.fogDensity,
        surfaceY: 0,
        waveAmp: params.fullBody ? 0.1 : 0.07,
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
      });
    });
    // The pinned species and the most recorded ones start near the camera so something is in view.
    const pinned = model.actors.findIndex((a) => a.pinned);
    const nearSpecies = entries
      .filter((e) => e.actorIndex === pinned || e.actorIndex < 3)
      .map((e) => e.simIndex);
    const ahead = world.curve.getPointAt(0.05);
    const sim = new FishSim(
      specs,
      { bounds: world.bounds, bedDepth: world.bedDepth },
      {
        seed: 11,
        spawnCentre: [ahead.x, ahead.z],
        nearSpecies,
        speedScale: reducedMotion ? 0.4 : 1,
      },
    );
    return { entries, sim };
  }, [model, world, fogColor, reducedMotion]);

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
    const { yaw, pitch } = built.sim.heading(a);
    tmpQ.setFromAxisAngle(AXIS_Y, yaw);
    tmpQ2.setFromAxisAngle(AXIS_Z, pitch);
    tmpQ.multiply(tmpQ2);
    tmpP.set(a.x, a.y, a.z);
    const s = e.length;
    tmpS.set(s, s, s);
    tmpM.compose(tmpP, tmpQ, tmpS);
    slot.setMatrixAt(i, tmpM);
  };

  useFrame((state, dt) => {
    built.sim.update(reducedMotion ? dt * 0.5 : dt);
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
  material: MeshStandardMaterial;
  outlineMaterial: MeshStandardMaterial;
  critters: Critter[];
}

export function Critters({
  model,
  world,
  reducedMotion,
  highlight,
  onHover,
}: Omit<Props, 'fogColor'>) {
  const hoverRef = useRef<HoverInfo | null>(null);
  const built = useMemo<CritterEntry[]>(() => {
    const rng = mulberry32(42);
    const out: CritterEntry[] = [];
    model.actors.forEach((actor, actorIndex) => {
      if (isFishArchetype(actor.archetype)) return;
      const geometry = buildCritterGeometry(actor.archetype);
      const material = new MeshStandardMaterial({
        color: new Color(actor.colors.side),
        roughness: 0.75,
        metalness: 0.05,
      });
      const outlineMaterial = new MeshStandardMaterial({
        color: new Color(orangeOrPale(actor)),
        emissive: new Color(orangeOrPale(actor)),
        side: 1,
      });
      const size = Math.max(0.14, (actor.lengthCm / 100) * FISH_VISUAL_SCALE);
      const a = actor.archetype;
      const n = Math.min(actor.count, a === 'mussel' ? 24 : 12);
      const critters: Critter[] = [];
      const placed =
        a === 'crayfish' || a === 'crab' || a === 'mussel'
          ? bedPositions(world, n, 0.8, 14, 300 + actorIndex)
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
          x = -HALFX + 6 + rng() * 24;
          z = (rng() - 0.5) * 120;
          y = -0.22;
        } else {
          x = (rng() - 0.5) * 120;
          z = (rng() - 0.5) * 120;
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
      const mesh = new InstancedMesh(geometry, material, Math.max(1, critters.length));
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
  }, [model, world]);

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
    for (const e of built) {
      const hl = highlight && e.actor.scientificName === highlight;
      e.material.emissive.set(hl ? '#2a9dc4' : '#000000');
      e.material.emissiveIntensity = hl ? 0.6 : 0;
    }
  }, [built, highlight]);

  useFrame((state, dt) => {
    const step = Math.min(dt, 0.05) * (reducedMotion ? 0.4 : 1);
    const t = state.clock.elapsedTime * (reducedMotion ? 0.4 : 1);
    for (const e of built) {
      const a = e.actor.archetype;
      e.critters.forEach((c, i) => {
        let roll = 0;
        let pitch = 0;
        if (c.speed > 0) {
          c.wa += Math.sin(t * 0.3 + c.phase) * 0.8 * step;
          c.heading += Math.sin(c.wa) * step * 0.8;
          c.x += Math.cos(c.heading) * c.speed * step;
          c.z -= Math.sin(c.heading) * c.speed * step;
          // stay near the patch
          if (c.x < -HALFX + 10 || c.x > HALFX - 10) c.heading = Math.PI - c.heading;
          if (Math.abs(c.z) > HALFX - 10) c.heading = -c.heading;
          c.x = Math.max(-HALFX + 6, Math.min(HALFX - 6, c.x));
          c.z = Math.max(-HALFX + 6, Math.min(HALFX - 6, c.z));
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
          y = c.y + Math.sin(t * 1.4 + c.phase) * 0.02;
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

const HALFX = 100;
