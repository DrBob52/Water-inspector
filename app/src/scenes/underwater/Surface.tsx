import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Matrix4 } from 'three';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedMesh,
  PlaneGeometry,
  ShaderMaterial,
  Object3D,
} from 'three';
import { HASH_GLSL, WATER_FOG_GLSL } from '../common/glsl';
import { mulberry32 } from '../fish/boids';

const SURF_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SURF_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBright;
varying vec3 vWorld;
${HASH_GLSL}
${WATER_FOG_GLSL}
void main() {
  vec2 p = vWorld.xz * 0.18;
  float r = vnoise(p + vec2(uTime * 0.12, 0.0)) * 0.6 + vnoise(p * 2.3 - vec2(0.0, uTime * 0.17)) * 0.4;
  vec3 view = normalize(cameraPosition - vWorld);
  // Snell's window: bright directly above, darker toward the horizon.
  float window = smoothstep(0.35, 0.85, view.y);
  vec3 col = mix(uFogColor * 0.9, vec3(0.78, 0.92, 1.0), window * uBright) + (r - 0.5) * 0.12;
  float dist = length(vWorld - cameraPosition);
  gl_FragColor = vec4(applyWaterFog(col, dist, vWorld.y), 0.8);
  #include <colorspace_fragment>
}
`;

interface Props {
  fogColor: string;
  fogDensity: number;
  reducedMotion: boolean;
  visibilityM: number;
}

/** Underside of the water surface. */
export function Surface({ fogColor, fogDensity, reducedMotion, visibilityM }: Props) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SURF_VERT,
        fragmentShader: SURF_FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uBright: { value: Math.min(1, 0.45 + visibilityM / 20) },
          uFogColor: { value: new Color(fogColor) },
          uFogDensity: { value: fogDensity },
          uSurfaceY: { value: 0 },
        },
      }),
    [fogColor, fogDensity, visibilityM],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((s) => {
    material.uniforms.uTime.value = reducedMotion ? 0 : s.clock.elapsedTime;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={material}>
      <planeGeometry args={[700, 700]} />
    </mesh>
  );
}

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = pow(vUv.y, 1.4);   // vUv.y = 1 at the surface
  float flick = 0.85 + 0.15 * sin(uTime * 0.8 + vWorld.x * 0.3 + vWorld.z * 0.2);
  float a = pow(across, 2.0) * along * uIntensity * flick;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

interface ShaftProps {
  visibilityM: number;
  reducedMotion: boolean;
  tint: string;
  count?: number;
}

/** Light shafts (god rays) from the surface: weaker in murky water and fading with depth. */
export function LightShafts({ visibilityM, reducedMotion, tint, count = 14 }: ShaftProps) {
  const { mesh, material } = useMemo(() => {
    const geo = new PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0); // top edge at y = 0
    const mat = new ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.1 + 0.3 * Math.min(1, visibilityM / 18) },
        uColor: { value: new Color(tint).lerp(new Color('#d8f1ff'), 0.6) },
      },
    });
    const m = new InstancedMesh(geo, mat, count * 2);
    const rng = mulberry32(5);
    const o = new Object3D();
    for (let i = 0; i < count; i++) {
      const x = (rng() - 0.5) * 120;
      const z = (rng() - 0.5) * 120;
      const w = 2.2 + rng() * 4;
      const len = 26 + rng() * 26;
      for (let k = 0; k < 2; k++) {
        o.position.set(x, 0, z);
        o.rotation.set(0.12, k * (Math.PI / 2) + rng() * 0.3, 0.1);
        o.scale.set(w, len, 1);
        o.updateMatrix();
        m.setMatrixAt(i * 2 + k, o.matrix as Matrix4);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    return { mesh: m, material: mat };
  }, [visibilityM, tint, count]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  useFrame((s) => {
    material.uniforms.uTime.value = reducedMotion ? 0 : s.clock.elapsedTime;
  });
  return <primitive object={mesh} />;
}
