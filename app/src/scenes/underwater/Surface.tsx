import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  type Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { CAUSTIC_GLSL, HASH_GLSL, UNDERWATER_GLSL } from '../common/glsl';
import { mulberry32 } from '../fish/boids';
import type { WaterUniforms } from './water';

const FRAG_END = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// Backdrop: the water itself, seen at "infinity" in every direction --------------------------------

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vDir = w.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * w;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;
const DOME_FRAG = /* glsl */ `
varying vec3 vDir;
${HASH_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
void main() {
  vec3 dir = normalize(vDir);
  vec3 c = waterColor(dir, max(-cameraPosition.y, 0.0));
  // a little dither so the long gradient never bands
  c += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
  ${FRAG_END}
}
`;

/** The water colour at "infinity": brighter and cyan above, falling to ink below, by depth. */
export function Backdrop({ water }: { water: WaterUniforms }) {
  const ref = useRef<Mesh>(null);
  const { geometry, material } = useMemo(
    () => ({
      geometry: new SphereGeometry(300, 48, 24),
      material: new ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: BackSide,
        depthWrite: false,
        uniforms: { ...water },
      }),
    }),
    [water],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      renderOrder={-10}
      frustumCulled={false}
    />
  );
}

// Surface underside --------------------------------------------------------------------------------

const SURF_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SURF_FRAG = /* glsl */ `
uniform float uBright;
varying vec3 vWorld;
${HASH_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
float waves(vec2 p, float t) {
  return vnoise(p * 0.33 + vec2(t * 0.11, t * 0.04)) * 0.55
       + vnoise(p * 0.9 - vec2(t * 0.06, t * 0.14)) * 0.3
       + vnoise(p * 2.4 + vec2(t * 0.21, -t * 0.17)) * 0.15;
}
void main() {
  vec3 v = vWorld - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);
  float t = uWaterTime;
  vec2 p = vWorld.xz;
  float e = 0.12;
  float h0 = waves(p, t);
  float hx = waves(p + vec2(e, 0.0), t);
  float hz = waves(p + vec2(0.0, e), t);
  vec3 n = normalize(vec3(-(hx - h0) / e * 0.55, 1.0, -(hz - h0) / e * 0.55));
  // Snell's window: light from above only gets through within ~48.6 deg of the normal; outside it
  // the surface mirrors the dark water below (total internal reflection).
  float cosI = dot(dir, n);
  float window = smoothstep(0.62, 0.7, cosI);
  // Sky through the window: pale cyan, brightest overhead, rippled by the waves.
  vec3 sky = mix(uWaterUp * 1.6, vec3(0.85, 1.0, 1.08), 0.55) * uBright;
  sky *= 0.55 + 0.45 * smoothstep(0.66, 0.98, cosI);
  // the sun's disc smeared by the waves
  float sun = pow(max(dot(refract(dir, -n, 1.333), -uSunDir), 0.0), 40.0);
  vec3 through = sky * (0.55 + 0.9 * h0 * h0) + uSunColor * sun * 1.4;
  vec3 mirror = waterColor(reflect(dir, -n), 0.0) * 0.9;
  vec3 c = mix(mirror, through, window);
  // the rim of the window glitters
  float ring = smoothstep(0.58, 0.66, cosI) * (1.0 - smoothstep(0.66, 0.74, cosI));
  c += uWaterUp * ring * (0.8 + 1.6 * vnoise(p * 3.0 + t * 0.6));
  gl_FragColor = vec4(underwaterFog(c, vWorld), 1.0);
  ${FRAG_END}
}
`;

/** Underside of the water surface: a bright, rippling Snell's window overhead, mirror-dark beyond. */
export function Surface({ water, clarity }: { water: WaterUniforms; clarity: number }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SURF_VERT,
        fragmentShader: SURF_FRAG,
        side: DoubleSide,
        uniforms: { ...water, uBright: { value: 0.7 + 0.5 * clarity } },
      }),
    [water, clarity],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={material}>
      <planeGeometry args={[700, 700]} />
    </mesh>
  );
}

// Light shafts -------------------------------------------------------------------------------------

const SHAFT_VERT = /* glsl */ `
attribute vec4 aShaft; // x, z offset in the tile, width, seed
uniform vec3 uSunDir;
uniform float uTile;
uniform float uLength;
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
varying float vEdge;
void main() {
  vec3 A = uSunDir;
  float camDepth = max(-cameraPosition.y, 0.0);
  // Shafts live on a tile that wraps around the camera, so there are always rays nearby.
  vec2 drift = A.xz / -A.y * camDepth;
  vec2 anchor = cameraPosition.xz - drift;
  vec2 rel = mod(aShaft.xy - anchor + 0.5 * uTile, uTile) - 0.5 * uTile;
  vec3 top = vec3(anchor.x + rel.x, 0.0, anchor.y + rel.y);
  float len = uLength * (0.55 + 0.9 * fract(aShaft.w * 7.31));
  float s = 1.0 - uv.y; // 0 at the surface
  vec3 axis = top + A * (s * len / -A.y);
  vec3 toCam = normalize(cameraPosition - axis);
  vec3 side = normalize(cross(A, toCam));
  float w = aShaft.z * (1.0 + s * 0.9);
  vec3 p = axis + side * (uv.x - 0.5) * w;
  vUv = vec2(uv.x, s);
  vWorld = p;
  vSeed = aShaft.w;
  vEdge = 1.0 - smoothstep(0.3 * uTile, 0.5 * uTile, length(rel));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const SHAFT_FRAG = /* glsl */ `
uniform float uIntensity;
uniform float uNear;
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
varying float vEdge;
${HASH_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
void main() {
  float x = abs(vUv.x * 2.0 - 1.0);
  // Soft gaussian-ish profile: the edge of a shaft is never crisp.
  float across = exp(-x * x * 4.5) * (1.0 - smoothstep(0.7, 1.0, x));
  float s = vUv.y;
  float along = pow(1.0 - s, 1.25) * smoothstep(0.0, 0.08, s);
  // streaks along the shaft and a slow breathing as the surface moves overhead
  float streak = 0.35 + 0.65 * vnoise(vec2(vUv.x * 5.0 + vSeed * 31.0, s * 2.5 - uWaterTime * 0.04));
  streak *= 0.6 + 0.4 * vnoise(vec2(vUv.x * 13.0 - vSeed * 7.0, s * 6.0));
  float breathe = 0.45 + 0.55 * vnoise(vec2(uWaterTime * 0.22 + vSeed * 13.0, vSeed * 7.0));
  float d = length(vWorld - cameraPosition);
  float near = smoothstep(uNear * 0.2, uNear, d);
  float k = uFogDensity * d;
  float fog = exp(-k * k * 0.8);
  float a = across * along * streak * breathe * near * fog * vEdge * uIntensity;
  vec3 col = mix(uWaterUp, uSunColor * 0.5, 0.45) * downwell(max(-vWorld.y, 0.0) * 0.6);
  gl_FragColor = vec4(col * a, 1.0);
  ${FRAG_END}
}
`;

interface ShaftProps {
  water: WaterUniforms;
  /** Metres below the surface the shafts reach, and their brightness. */
  length: number;
  intensity: number;
  visibility: number;
  count?: number;
}

/** God rays from the surface: long and crisp in clear water, short and diffuse in murky water. */
export function LightShafts({ water, length, intensity, visibility, count = 34 }: ShaftProps) {
  const { mesh, material } = useMemo(() => {
    const geo = new PlaneGeometry(1, 1, 1, 10);
    geo.translate(0.5, 0.5, 0); // uv and position both in [0, 1]
    const tile = Math.max(12, Math.min(60, visibility * 1.5));
    const rng = mulberry32(5);
    const attr = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      attr[i * 4] = rng() * tile;
      attr[i * 4 + 1] = rng() * tile;
      attr[i * 4 + 2] = (0.8 + rng() * rng() * 3.2) * Math.max(0.7, Math.min(1.6, tile / 30));
      attr[i * 4 + 3] = rng();
    }
    geo.setAttribute('aShaft', new InstancedBufferAttribute(attr, 4));
    const mat = new ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        ...water,
        uTile: { value: tile },
        uLength: { value: length },
        uIntensity: { value: intensity },
        // In murky water the shafts can only be seen close up, so let them come nearer.
        uNear: { value: Math.max(0.9, Math.min(3.5, visibility * 0.4)) },
      },
    });
    const m = new InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    return { mesh: m, material: mat };
  }, [water, length, intensity, visibility, count]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  return <primitive object={mesh} renderOrder={5} />;
}
