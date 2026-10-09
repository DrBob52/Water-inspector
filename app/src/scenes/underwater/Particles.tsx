import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Points } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  ShaderMaterial,
  type PerspectiveCamera,
} from 'three';
import { mulberry32 } from '../fish/boids';
import { useRenderQuality } from '../common/SceneCanvas';
import { CAUSTIC_GLSL, HASH_GLSL, UNDERWATER_GLSL } from '../common/glsl';
import type { WaterUniforms } from './water';

const VERT = /* glsl */ `
attribute vec4 aSeed; // size jitter, drift phase, brightness, unused
uniform float uBox;
uniform float uSize;
uniform float uProj;
uniform float uTime;
uniform float uSink;
varying float vAlpha;
varying vec3 vWorld;
varying float vBright;
void main() {
  // Wrap a fixed box of water around the camera, drifting and sinking slowly.
  vec3 drift = vec3(
    sin(uTime * 0.11 + aSeed.y * 6.28) * 0.35 + uTime * 0.04,
    -uTime * uSink + sin(uTime * 0.23 + aSeed.y * 9.0) * 0.12,
    cos(uTime * 0.09 + aSeed.y * 4.0) * 0.35 + uTime * 0.015
  );
  vec3 p = position + drift;
  p = cameraPosition + mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox;
  vWorld = p;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.05);
  float px = uSize * (0.6 + 0.8 * aSeed.x) * uProj / dist;
  // Close specks are big and soft (out of focus); hidden above the surface.
  gl_PointSize = clamp(px, 1.0, 14.0);
  float edge = 1.0 - smoothstep(0.38 * uBox, 0.5 * uBox, length(p - cameraPosition));
  vAlpha = edge * step(p.y, -0.03) * smoothstep(0.2, 0.8, dist) / (1.0 + max(px - 4.0, 0.0) * 0.25);
  vBright = aSeed.z;
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGlint;
varying float vAlpha;
varying vec3 vWorld;
varying float vBright;
${HASH_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha * uOpacity;
  if (a < 0.003) discard;
  float depth = max(-vWorld.y, 0.0);
  vec3 T = downwell(depth);
  // Lit from above: bright specks catching the sun read as "marine snow".
  vec3 col = uColor * (uWaterUp * 1.4 + uSunColor * T * (0.35 + uGlint * vBright));
  col = underwaterFog(col, vWorld);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Props {
  water: WaterUniforms;
  count: number;
  /** Side of the box of water kept around the camera (m). */
  box: number;
  color: string;
  /** Speck diameter in metres. */
  size: number;
  opacity: number;
  /** Sinking speed (m/s). */
  sink: number;
  /** How much individual specks sparkle in the light. */
  glint: number;
  seed: number;
  reducedMotion: boolean;
}

/** Suspended particles (sediment specks or algae), scaled with turbidity or chlorophyll-a. */
export function Particles({
  water,
  count,
  box,
  color,
  size,
  opacity,
  sink,
  glint,
  seed,
  reducedMotion,
}: Props) {
  const quality = useRenderQuality();
  const ref = useRef<Points>(null);
  const { geometry, material } = useMemo(() => {
    const rng = mulberry32(seed);
    const pos = new Float32Array(Math.max(1, count) * 3);
    const aSeed = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rng() * box;
      pos[i * 3 + 1] = rng() * box;
      pos[i * 3 + 2] = rng() * box;
      aSeed[i * 4] = rng() * rng();
      aSeed[i * 4 + 1] = rng();
      aSeed[i * 4 + 2] = Math.pow(rng(), 3);
      aSeed[i * 4 + 3] = rng();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(aSeed, 4));
    const m = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        ...water,
        uBox: { value: box },
        uSize: { value: size },
        uProj: { value: 800 },
        uTime: { value: 0 },
        uSink: { value: sink },
        uColor: { value: new Color(color) },
        uOpacity: { value: opacity },
        uGlint: { value: glint },
      },
    });
    return { geometry: g, material: m };
  }, [water, count, box, color, size, opacity, sink, glint, seed]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    const p = ref.current;
    if (!p) return;
    p.geometry.setDrawRange(0, Math.ceil(count * Math.max(0.5, quality)));
    const cam = state.camera as PerspectiveCamera;
    const h = state.size.height * state.gl.getPixelRatio();
    material.uniforms.uProj.value = h / (2 * Math.tan(((cam.fov ?? 60) * Math.PI) / 360));
    material.uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
  });
  if (count <= 0) return null;
  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={6}
    />
  );
}
