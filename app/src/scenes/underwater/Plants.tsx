import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  Vector3,
} from 'three';
import { CAUSTIC_GLSL, HASH_GLSL, UNDERWATER_GLSL } from '../common/glsl';
import { useRenderQuality } from '../common/SceneCanvas';
import { plantPositions, type World } from './world';
import type { WaterUniforms } from './water';

/**
 * Plant shapes, 1 unit tall with the base at y = 0. `aH` is height along the plant (0 to 1) and
 * `aLeaf` the across-leaf coordinate (-1 to 1) for shading the midrib.
 */
function ribbonGeometry(): BufferGeometry {
  // Eelgrass / tape grass: a long ribbon of constant width with a rounded tip.
  const seg = 14;
  const pos: number[] = [];
  const h: number[] = [];
  const leaf: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = 0.5 * (t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1);
    pos.push(-w, t, 0, w, t, 0);
    h.push(t, t);
    leaf.push(-1, 1);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aH', new BufferAttribute(new Float32Array(h), 1));
  g.setAttribute('aLeaf', new BufferAttribute(new Float32Array(leaf), 1));
  g.setIndex(idx);
  return g;
}

function pondweedGeometry(): BufferGeometry {
  // Pondweed: a thin stem with alternating oval leaves that get smaller toward the top.
  const pos: number[] = [];
  const h: number[] = [];
  const leaf: number[] = [];
  const idx: number[] = [];
  const quad = (pts: number[][], hs: number[], ls: number[]) => {
    const b = pos.length / 3;
    pts.forEach((p, i) => {
      pos.push(p[0], p[1], p[2]);
      h.push(hs[i]);
      leaf.push(ls[i]);
    });
    return b;
  };
  // stem
  const sw = 0.04;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    quad(
      [
        [-sw, t, 0],
        [sw, t, 0],
      ],
      [t, t],
      [-0.2, 0.2],
    );
    if (i < 8) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const leaves = 7;
  for (let k = 0; k < leaves; k++) {
    const t = 0.18 + (k / leaves) * 0.8;
    const len = 0.32 * (1 - 0.45 * (k / leaves));
    const wid = len * 0.32;
    const a = k * 2.4;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // leaf blade: 5 rows along its length, tilted up 35 deg
    const rows = 5;
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const u = r / rows;
      const w = wid * Math.sin(Math.PI * Math.min(0.98, Math.max(0.02, u)));
      const along = u * len;
      const cx = dx * along * 0.82;
      const cz = dz * along * 0.82;
      const cy = t + along * 0.57;
      quad(
        [
          [cx - dz * w, cy, cz + dx * w],
          [cx + dz * w, cy, cz - dx * w],
        ],
        [t + along * 0.57, t + along * 0.57],
        [-1, 1],
      );
      if (r < rows) {
        const a0 = base + r * 2;
        idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aH', new BufferAttribute(new Float32Array(h), 1));
  g.setAttribute('aLeaf', new BufferAttribute(new Float32Array(leaf), 1));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
attribute float aH;
attribute float aLeaf;
attribute float aPhase;
attribute float aTint;
uniform float uTime;
uniform float uWidth;
uniform float uTwist;
varying float vH;
varying float vLeaf;
varying float vTint;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 p = position;
  float h = aH;
  // Ribbons twist slowly along their length so they never read as flat cards.
  float tw = uTwist * h * (1.5 + aPhase * 0.2);
  float c = cos(tw);
  float s = sin(tw);
  p.x *= uWidth;
  p.xz = mat2(c, -s, s, c) * p.xz;
  vec3 n = vec3(-s, 0.0, c);
  // Sway: a slow surge plus a travelling wave up the stalk, growing toward the tip.
  float sway = sin(uTime * 0.7 + aPhase + h * 1.8) * 0.5 + sin(uTime * 1.6 + aPhase * 2.0 + h * 4.0) * 0.12;
  float bend = h * h;
  vec4 w0 = instanceMatrix * vec4(p, 1.0);
  float H = length(instanceMatrix[1].xyz);
  w0.x += (sway * 0.32 + 0.3) * bend * H * 0.6;
  w0.z += cos(uTime * 0.55 + aPhase * 1.3 + h * 1.4) * 0.16 * bend * H * 0.5;
  w0.y -= 0.12 * bend * H * abs(sway) * 0.5;
  vec4 w = modelMatrix * w0;
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * n);
  vH = h;
  vLeaf = aLeaf;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTip;
varying float vH;
varying float vLeaf;
varying float vTint;
varying vec3 vWorld;
varying vec3 vNormalW;
${HASH_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
void main() {
  vec3 albedo = mix(uBase, uTip, smoothstep(0.0, 1.0, vH)) * vTint;
  // midrib and edges
  albedo *= 0.85 + 0.25 * (1.0 - abs(vLeaf));
  // older tips go yellow-brown
  albedo = mix(albedo, vec3(0.16, 0.13, 0.04), smoothstep(0.82, 1.0, vH) * 0.45 * vTint);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float depth = max(-vWorld.y, 0.0);
  vec3 T = downwell(depth);
  vec3 col = underwaterLight(albedo, N, vWorld, 0.6, 0.55 + 0.45 * vH);
  // Light through the leaf when looking toward the sun.
  float back = pow(max(dot(-V, -uSunDir), 0.0), 3.0);
  col += albedo * vec3(0.9, 1.5, 0.5) * uSunColor * T * back * 0.7;
  col += albedo * uSunColor * T * causticAt(vWorld) * 0.8;
  gl_FragColor = vec4(underwaterFog(col, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Props {
  world: World;
  water: WaterUniforms;
  plantSpecies: number;
  reducedMotion: boolean;
}

/** Eelgrass and pondweed in clumps on the littoral bed, present only when plant species are recorded. */
export function Plants({ world, water, plantSpecies, reducedMotion }: Props) {
  const quality = useRenderQuality();
  const total = Math.min(1500, plantSpecies * 260);
  const built = useMemo(() => {
    const spots = plantPositions(world, total, 3, plantSpecies);
    const make = (kind: 0 | 1) => {
      const list = spots.filter((p) => p.kind === kind);
      const geo = kind === 0 ? ribbonGeometry() : pondweedGeometry();
      const phase = new Float32Array(Math.max(1, list.length));
      const tint = new Float32Array(Math.max(1, list.length));
      const mat = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        uniforms: {
          ...water,
          uTime: { value: 0 },
          uWidth: { value: kind === 0 ? 0.05 : 0.8 },
          uTwist: { value: kind === 0 ? 2.2 : 0.4 },
          uBase: {
            value: kind === 0 ? new Vector3(0.03, 0.075, 0.02) : new Vector3(0.04, 0.08, 0.02),
          },
          uTip: {
            value: kind === 0 ? new Vector3(0.17, 0.32, 0.06) : new Vector3(0.2, 0.3, 0.07),
          },
        },
      });
      const mesh = new InstancedMesh(geo, mat, Math.max(1, list.length));
      const o = new Object3D();
      list.forEach((p, i) => {
        o.position.set(p.x, p.y - 0.05, p.z);
        // Blades lean out of the clump and toward the light a little.
        o.rotation.set(Math.sin(p.phase * 2.3) * 0.28, p.rot, Math.cos(p.phase * 1.7) * 0.28);
        o.scale.set(1, p.h, 1);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        phase[i] = p.phase;
        tint[i] = 0.75 + 0.5 * Math.abs(Math.sin(p.phase * 3.1));
      });
      geo.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
      geo.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));
      mesh.count = list.length;
      mesh.frustumCulled = false;
      return { mesh, mat, n: list.length };
    };
    return [make(0), make(1)];
  }, [world, water, total, plantSpecies]);
  useEffect(
    () => () => {
      for (const b of built) {
        b.mesh.geometry.dispose();
        b.mat.dispose();
      }
    },
    [built],
  );
  useFrame((s) => {
    for (const b of built) {
      b.mat.uniforms.uTime.value = reducedMotion ? 0 : s.clock.elapsedTime;
      b.mesh.count = Math.max(0, Math.ceil(b.n * Math.max(0.5, quality)));
    }
  });
  if (plantSpecies <= 0) return null;
  return (
    <>
      {built.map((b, i) => (
        <primitive key={i} object={b.mesh} />
      ))}
    </>
  );
}
