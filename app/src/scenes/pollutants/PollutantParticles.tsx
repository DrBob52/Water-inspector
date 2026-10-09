import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  type PerspectiveCamera,
} from 'three';
import { useRenderQuality } from '../common/SceneCanvas';
import type { Diorama } from '../raised/diorama';
import type { PollutantLayer } from './density';
import { layoutPlumes } from './plumes';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aIntensity;
attribute float aOver;
uniform float uEx;
uniform float uTime;
uniform float uPx;
uniform float uDrift;
uniform float uMotion;
varying float vI;
void main() {
  vec3 p = position;
  float depth = -p.y * uEx;
  p.y *= uEx;
  float t = uTime;
  p.x += (sin(t * 0.13 + aPhase) + 0.6 * sin(t * 0.071 + aPhase * 2.1)) * uDrift;
  p.z += (cos(t * 0.11 + aPhase * 1.7) + 0.5 * sin(t * 0.083 + aPhase * 0.6)) * uDrift;
  p.y += sin(t * 0.17 + aPhase * 0.9) * min(uDrift * 0.3, depth * 0.08);
  p.y = min(p.y, -0.04);
  // Over-threshold plumes breathe together, slowly (about a 4 s cycle).
  float pulse = 1.0 + aOver * uMotion * 0.42 * sin(t * 1.55 + aPhase * 0.15);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(aSize * (0.9 + 0.1 * pulse) * uPx / -mv.z, 1.0, 256.0);
  vI = aIntensity * pulse * (0.85 + 0.35 * aOver);
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vI;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.2) * (1.0 - r2);
  gl_FragColor = vec4(uColor * (1.0 + 0.25 * exp(-r2 * 18.0)), a * vI * 0.62);
  #include <colorspace_fragment>
}
`;

interface Props {
  layers: PollutantLayer[];
  dio: Diorama;
  exaggeration: number;
  reducedMotion: boolean;
}

/**
 * One soft glowing cloud per pollutant, gathered around the monitoring sites that measured it,
 * drifting slowly inside the water. Density follows value / threshold on a log scale (capped);
 * plumes above the threshold glow brighter and pulse (no motion under prefers-reduced-motion).
 */
export function PollutantParticles({ layers, dio, exaggeration, reducedMotion }: Props) {
  const quality = useRenderQuality();
  const systems = useMemo(
    () =>
      layers.map((layer) => {
        const b = layoutPlumes(dio, layer);
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(b.positions, 3));
        g.setAttribute('aSize', new BufferAttribute(b.sizes, 1));
        g.setAttribute('aPhase', new BufferAttribute(b.phases, 1));
        g.setAttribute('aIntensity', new BufferAttribute(b.intensity, 1));
        g.setAttribute('aOver', new BufferAttribute(b.over, 1));
        const m = new ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: {
            uEx: { value: 1 },
            uTime: { value: 0 },
            uPx: { value: 800 },
            uDrift: { value: 0.3 },
            uMotion: { value: 1 },
            uColor: { value: new Color(layer.color) },
          },
        });
        return { layer, g, m, count: b.count };
      }),
    [layers, dio],
  );
  useEffect(
    () => () => {
      systems.forEach((s) => {
        s.g.dispose();
        s.m.dispose();
      });
    },
    [systems],
  );
  useFrame((st) => {
    const cam = st.camera as PerspectiveCamera;
    const px = (st.size.height * st.viewport.dpr) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const s of systems) {
      s.m.uniforms.uEx.value = exaggeration;
      s.m.uniforms.uTime.value = reducedMotion ? 0 : st.clock.elapsedTime;
      s.m.uniforms.uMotion.value = reducedMotion ? 0 : 1;
      s.m.uniforms.uPx.value = px;
      s.g.setDrawRange(0, Math.ceil(s.count * quality));
    }
  });
  return (
    <group>
      {systems.map((s) => (
        <points
          key={s.layer.key}
          geometry={s.g}
          material={s.m}
          frustumCulled={false}
          renderOrder={4}
        />
      ))}
    </group>
  );
}
