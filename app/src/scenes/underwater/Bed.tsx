import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, ShaderMaterial } from 'three';
import { CAUSTIC_GLSL, FBM_GLSL, HASH_GLSL, UNDERWATER_GLSL } from '../common/glsl';
import { HALF, type World } from './world';
import type { WaterUniforms } from './water';

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform float uSilt;
uniform float uAlgae;
varying vec3 vWorld;
varying vec3 vNormalW;
${HASH_GLSL}
${FBM_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}

const mat2 R1 = mat2(0.8, -0.6, 0.6, 0.8);
const mat2 R2 = mat2(0.28, -0.96, 0.96, 0.28);
// Sand ripples: crests run along the shore (z), ~0.3 m apart, meandering and breaking up.
float ripples(vec2 p) {
  float warp = vnoise(p * 0.18) * 9.0 + vnoise(R1 * p * 0.7) * 3.0 + vnoise(R2 * p * 2.1) * 0.8;
  float r = 1.0 - abs(sin(p.x * 10.5 + p.y * 1.7 + warp));
  return r * r * smoothstep(0.25, 0.75, vnoise(R2 * p * 0.35 + 11.0));
}

// Cobbles: a cell pattern; returns (distance to the cell centre, cell hash) and the offset.
vec3 cobble(vec2 p, out vec2 off) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float best = 9.0;
  float id = 0.0;
  off = vec2(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash21(i + g), hash21(i + g + 19.7));
      vec2 r = g + o * 0.8 + 0.1 - f;
      float d = dot(r, r);
      if (d < best) {
        best = d;
        id = hash21(i + g + 3.3);
        off = -r;
      }
    }
  return vec3(sqrt(best), id, 0.0);
}

void main() {
  vec2 p = vWorld.xz;
  // Rotated copies of the domain so value-noise lattice lines never line up into a grid.
  vec2 pa = R1 * p + 17.3;
  vec2 pb = R2 * p - 5.1;
  float depth = max(-vWorld.y, 0.0);
  float dist = length(vWorld - cameraPosition);
  float detail = 1.0 - smoothstep(10.0, 45.0, dist);

  // Large-scale patches decide what covers the bed here.
  float big = fbm5(pa * 0.035);
  float mid = fbm3(pb * 0.3);
  float mud = clamp(smoothstep(4.0, 22.0, depth) * 0.75 + uSilt * 0.8 + (big - 0.5) * 0.6, 0.0, 1.0);
  float gravel = smoothstep(0.56, 0.66, big + (mid - 0.5) * 0.35) * (1.0 - mud * 0.7);

  vec3 sand = mix(vec3(0.27, 0.22, 0.15), vec3(0.4, 0.34, 0.24), mid);
  vec3 silt = mix(vec3(0.07, 0.068, 0.05), vec3(0.11, 0.1, 0.075), mid);
  vec3 albedo = mix(sand, silt, mud);
  // organic stains and fine grain
  float grain = vnoise(pa * 9.0) * 0.5 + vnoise(pb * 13.0) * 0.5;
  albedo *= 0.82 + 0.3 * mix(0.5, grain, detail) + 0.15 * (fbm3(pb * 1.3) - 0.5);
  albedo = mix(albedo, albedo * vec3(0.55, 0.62, 0.4), smoothstep(0.55, 0.8, fbm3(pa * 0.18 + 4.0)) * 0.5);
  // green film where chlorophyll is high
  albedo = mix(albedo, vec3(0.05, 0.1, 0.025), uAlgae * smoothstep(0.35, 0.8, mid) * 0.65);

  // Surface relief for lighting: ripples on clean shallow sand, lumps elsewhere.
  vec3 N = normalize(vNormalW);
  float e = 0.04;
  float rip = (1.0 - mud) * (1.0 - smoothstep(4.0, 11.0, depth)) * detail;
  float h0 = ripples(p) * rip * 0.5 + fbm3(pa * 1.8) * 0.5;
  float hx = ripples(p + vec2(e, 0.0)) * rip * 0.5 + fbm3(R1 * (p + vec2(e, 0.0)) * 1.8 + 31.14) * 0.5;
  float hz = ripples(p + vec2(0.0, e)) * rip * 0.5 + fbm3(R1 * (p + vec2(0.0, e)) * 1.8 + 31.14) * 0.5;
  vec2 grad = vec2(hx - h0, hz - h0) / e;
  N = normalize(N - vec3(grad.x, 0.0, grad.y) * 0.04 * (0.4 + 0.6 * detail));
  float ao = 0.7 + 0.3 * h0;

  // Cobbles and pebbles in the gravel patches.
  if (gravel > 0.01 && detail > 0.0) {
    vec2 off;
    vec3 c = cobble(p * 2.6, off);
    float r = 0.32 + 0.16 * c.y;
    float inside = (1.0 - smoothstep(r * 0.8, r, c.x)) * gravel;
    vec3 stone = mix(vec3(0.16, 0.15, 0.13), vec3(0.32, 0.29, 0.24), c.y) * (0.85 + 0.3 * vnoise(p * 14.0));
    stone = mix(stone, stone * vec3(0.6, 0.85, 0.45), uAlgae * 0.6);
    albedo = mix(albedo, stone, inside);
    vec3 cn = normalize(vec3(off.x, 0.55, off.y));
    N = normalize(mix(N, cn, inside * 0.8 * detail));
    ao *= 1.0 - 0.45 * gravel * smoothstep(r * 0.85, r * 1.1, c.x) * (1.0 - inside);
  }

  vec3 col = underwaterLight(albedo, N, vWorld, 0.15, ao);
  vec3 T = downwell(depth);
  float caus = causticAt(vWorld);
  col += albedo * uSunColor * T * caus * max(N.y, 0.0) * 3.6;
  gl_FragColor = vec4(underwaterFog(col, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Props {
  world: World;
  water: WaterUniforms;
  /** 0 clean sand and gravel, 1 soft mud: from turbidity. */
  silt: number;
  /** Green film on the bed, from chlorophyll-a. */
  algae: number;
}

/**
 * A grid that is fine near the action and coarse toward the patch edge: s in [-1, 1] maps to
 * [lo, hi] with spacing growing away from `c`.
 */
function warpedAxis(n: number, lo: number, c: number, hi: number, pow = 1.7): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * 2 - 1;
    const m = Math.pow(Math.abs(s), pow);
    out.push(s < 0 ? c - (c - lo) * m : c + (hi - c) * m);
  }
  return out;
}

/** Synthesised bed patch with procedural sand, silt, gravel and caustics in water shallower than 8 m. */
export function Bed({ world, water, silt, algae }: Props) {
  const geometry = useMemo(() => {
    const xs = warpedAxis(150, -HALF, world.focus.x, HALF + 70);
    const zs = warpedAxis(150, -HALF - 40, world.focus.z, HALF + 40);
    const nx = xs.length;
    const nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = xs[i];
        pos[k + 1] = -world.bedDepth(xs[i], zs[j]);
        pos[k + 2] = zs[j];
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let o = 0;
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx[o++] = a;
        idx[o++] = c;
        idx[o++] = b;
        idx[o++] = b;
        idx[o++] = c;
        idx[o++] = d;
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(new BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [world]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { ...water, uSilt: { value: silt }, uAlgae: { value: algae } },
      }),
    [water, silt, algae],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} />;
}
