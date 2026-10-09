import { useEffect, useMemo } from 'react';
import type { BufferGeometry } from 'three';
import {
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type NormalBufferAttributes,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAUSTIC_GLSL, FBM_GLSL, HASH_GLSL, UNDERWATER_GLSL } from '../common/glsl';
import { mulberry32 } from '../fish/boids';
import { logPositions, rockPositions, type World } from './world';
import type { WaterUniforms } from './water';

/** Smooth 3D value noise for displacing the boulder mesh (CPU side, once). */
function noise3(seed: number) {
  const h = (x: number, y: number, z: number) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number, z: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(
        l(h(ix, iy, iz), h(ix + 1, iy, iz), sx),
        l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx),
        sy,
      ),
      l(
        l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx),
        l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx),
        sy,
      ),
      sz,
    );
  };
}

/** A lumpy, slightly faceted boulder about 2 units across, flattened underneath. */
export function boulderGeometry(seed = 4): BufferGeometry {
  // Icosahedron faces come unshared; weld them so the displaced boulder shades smoothly.
  const ico = new IcosahedronGeometry(1, 4);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico, 1e-4);
  const n = noise3(seed);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d =
      1 +
      0.32 * (n(v.x * 1.3 + 5, v.y * 1.3, v.z * 1.3) - 0.5) +
      0.14 * (n(v.x * 3.1, v.y * 3.1 + 2, v.z * 3.1) - 0.5) +
      0.05 * (n(v.x * 7, v.y * 7, v.z * 7 + 9) - 0.5);
    v.multiplyScalar(d);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A sunken log along X (metres) with two broken branch stubs. */
export function logGeometry(
  length: number,
  radius: number,
  seed = 2,
): BufferGeometry<NormalBufferAttributes> {
  const rng = mulberry32(seed);
  const n3 = noise3(seed * 7 + 1);
  const trunk = new CylinderGeometry(radius * 0.78, radius, length, 22, 28, false);
  trunk.rotateZ(Math.PI / 2);
  const pos = trunk.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = v.x / length; // -0.5 .. 0.5 along the trunk
    const a = Math.atan2(v.z, v.y);
    // Knobbly, weathered and a little flattened where it has settled into the silt.
    const k =
      1 +
      0.18 * (n3(u * 6, Math.cos(a) * 1.5, Math.sin(a) * 1.5) - 0.5) +
      0.06 * Math.sin(a * 7 + u * 30) * (n3(u * 20, 1, 2) - 0.3);
    const settle = v.y < 0 ? 0.8 : 1;
    // a broken, splintered end
    const broken = u > 0.47 ? 1 - (u - 0.47) * 6 * n3(a * 2, 3, 5) : 1;
    pos.setXYZ(
      i,
      v.x,
      (v.y * k * settle + radius * 0.35 * Math.sin(u * 2.6)) * broken,
      v.z * k * broken,
    );
  }
  const parts: BufferGeometry[] = [trunk.toNonIndexed()];
  for (let b = 0; b < 2; b++) {
    const h = radius * (2 + rng() * 2.5);
    const stub = new CylinderGeometry(radius * 0.22, radius * 0.4, h, 8, 1, false);
    stub.translate(0, h / 2, 0);
    // branches lie along the trunk and out to the side, never straight up
    stub.rotateZ(-1.05 - rng() * 0.35);
    stub.rotateY((rng() - 0.5) * 1.6);
    stub.translate((b === 0 ? -0.15 : 0.22) * length, radius * 0.3, 0);
    parts.push(stub.toNonIndexed());
  }
  const merged = mergeGeometries(parts, false) as BufferGeometry<NormalBufferAttributes>;
  merged.computeVertexNormals();
  return merged;
}

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vObj;
varying float vSeed;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(m) * normal);
  vObj = position;
  vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.291);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform float uAlgae;
uniform float uWood;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vObj;
varying float vSeed;
${HASH_GLSL}
${FBM_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
void main() {
  vec3 N = normalize(vNormalW);
  vec3 albedo;
  float ao = 1.0;
  if (uWood > 0.5) {
    // Bark: furrows along the trunk, waterlogged and dark.
    float ang = atan(vObj.z, vObj.y);
    float furrow = vnoise(vec2(ang * 5.0, vObj.x * 1.4 + vSeed * 9.0));
    furrow = smoothstep(0.35, 0.75, furrow);
    albedo = mix(vec3(0.12, 0.1, 0.075), vec3(0.5, 0.44, 0.34), furrow);
    albedo *= 0.8 + 0.4 * vnoise(vObj.xz * 6.0 + vSeed * 4.0);
    ao = 0.6 + 0.4 * furrow;
  } else {
    // Granite-ish boulder: speckled, with darker cracks and a lighter crown.
    vec3 o = vObj * 2.3 + vSeed * 17.0;
    float n = fbm3(o.xy + o.z * 0.7) * 0.6 + fbm3(o.zy * 1.7) * 0.4;
    // round mineral grains
    vec2 gq = vObj.xy * 26.0 + vObj.z * 9.0;
    vec2 gi = floor(gq);
    vec2 gf = fract(gq) - 0.5 - (vec2(hash21(gi), hash21(gi + 7.0)) - 0.5) * 0.5;
    float speck = (1.0 - smoothstep(0.12, 0.22, length(gf))) * step(0.55, hash21(gi + 3.0));
    vec3 a = mix(vec3(0.09, 0.085, 0.078), vec3(0.4, 0.37, 0.33), smoothstep(0.25, 0.8, n));
    a = mix(a, vec3(0.5, 0.48, 0.44), speck * 0.45);
    // weathered banding
    a *= 0.85 + 0.3 * vnoise(vec2(o.y * 3.0, o.x * 0.5 + o.z * 0.5));
    a *= 0.75 + 0.5 * vSeed;
    albedo = a;
    ao = 0.55 + 0.45 * smoothstep(-0.45, 0.4, vObj.y);
  }
  // Algae and silt settle on the upward faces.
  float top = smoothstep(0.35, 0.9, N.y);
  vec3 film = mix(vec3(0.06, 0.07, 0.04), vec3(0.04, 0.1, 0.02), clamp(uAlgae * 1.4, 0.0, 1.0));
  albedo = mix(albedo, film, top * (0.35 + 0.45 * uAlgae) * (0.6 + 0.4 * vnoise(vWorld.xz * 3.0)));
  vec3 col = underwaterLight(albedo, N, vWorld, 0.2, ao);
  vec3 T = downwell(max(-vWorld.y, 0.0));
  col += albedo * uSunColor * T * causticAt(vWorld) * max(N.y, 0.0) * 2.0;
  gl_FragColor = vec4(underwaterFog(col, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Props {
  world: World;
  water: WaterUniforms;
  algae: number;
  rockCount: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p = new Vector3();
const s = new Vector3();

/** Boulders scattered over the bed (denser along the shelf edge) and a couple of sunken logs. */
export function Rocks({ world, water, algae, rockCount }: Props) {
  const built = useMemo(() => {
    const rocks = rockPositions(world, rockCount);
    const logs = logPositions(world, 2);
    const mat = (wood: boolean) =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { ...water, uAlgae: { value: algae }, uWood: { value: wood ? 1 : 0 } },
      });
    const rockMat = mat(false);
    const logMat = mat(true);
    const rockGeo = boulderGeometry();
    const rockMesh = new InstancedMesh(rockGeo, rockMat, Math.max(1, rocks.length));
    rocks.forEach((r, i) => {
      e.set(0, r.rot, 0);
      q.setFromEuler(e);
      m4.compose(p.set(r.x, r.y, r.z), q, s.set(r.sx, r.sy, r.sz));
      rockMesh.setMatrixAt(i, m4);
    });
    rockMesh.count = rocks.length;
    rockMesh.computeBoundingSphere();
    const logMeshes = logs.map((l, i) => {
      const g = logGeometry(l.length, l.radius, 2 + i);
      const mesh = new InstancedMesh(g, logMat, 1);
      e.set(0, l.yaw, l.pitch, 'YZX');
      q.setFromEuler(e);
      m4.compose(p.set(l.x, l.y, l.z), q, s.set(1, 1, 1));
      mesh.setMatrixAt(0, m4);
      mesh.computeBoundingSphere();
      return mesh;
    });
    return { rockMesh, logMeshes, rockMat, logMat, rockGeo };
  }, [world, water, algae, rockCount]);
  useEffect(
    () => () => {
      built.rockGeo.dispose();
      for (const l of built.logMeshes) l.geometry.dispose();
      built.rockMat.dispose();
      built.logMat.dispose();
    },
    [built],
  );
  return (
    <>
      <primitive object={built.rockMesh} />
      {built.logMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}
