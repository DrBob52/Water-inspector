import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import type { SceneModel } from '@wi/shared';
import { mulberry32 } from '../fish/boids';
import { useRenderQuality } from '../common/SceneCanvas';
import type { Diorama } from '../raised/diorama';
import { POLLUTANT_COLORS, particleCount } from './density';

const VERT = /* glsl */ `
attribute float aPhase;
uniform float uEx;
uniform float uTime;
uniform float uSize;
uniform float uPulse;
varying float vA;
void main() {
  vec3 p = position;
  p.y *= uEx;
  float pulse = 1.0 + uPulse * 0.35 * sin(uTime * 1.2 + aPhase);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * pulse * (320.0 / -mv.z);
  vA = 0.75 + uPulse * 0.25 * sin(uTime * 1.2 + aPhase);
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBoost;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(uColor * uBoost, a * vA * 0.85);
  #include <colorspace_fragment>
}
`;

export interface PollutantLayer {
  key: string;
  color: string;
  count: number;
  over: boolean;
}

export function layersFor(model: SceneModel): PollutantLayer[] {
  return model.pollutants.map((p, i) => ({
    key: p.key,
    color: POLLUTANT_COLORS[i % POLLUTANT_COLORS.length],
    count: particleCount(p.ratio),
    over: p.ratio > 1,
  }));
}

interface Props {
  model: SceneModel;
  dio: Diorama;
  exaggeration: number;
  reducedMotion: boolean;
}

/**
 * One particle system per pollutant inside the water volume: colour-coded, density proportional to
 * value / threshold on a log scale, capped. Over-threshold pollutants pulse slowly (not under
 * prefers-reduced-motion). Missing data produces no particles.
 */
export function PollutantParticles({ model, dio, exaggeration, reducedMotion }: Props) {
  const quality = useRenderQuality();
  const layers = useMemo(() => layersFor(model), [model]);
  const systems = useMemo(() => {
    const { grid, nx } = dio;
    const cells: number[] = [];
    for (let n = 0; n < grid.inside.length; n++) if (grid.inside[n]) cells.push(n);
    return layers.map((layer, li) => {
      const rng = mulberry32(700 + li * 97);
      const pos = new Float32Array(layer.count * 3);
      const phase = new Float32Array(layer.count);
      for (let k = 0; k < layer.count; k++) {
        const n = cells[Math.floor(rng() * cells.length)] ?? 0;
        const i = n % nx;
        const j = Math.floor(n / nx);
        const xm = grid.bounds.minX + (i + rng() - 0.5) * grid.cellX;
        const ym = grid.bounds.minY + (j + rng() - 0.5) * grid.cellY;
        const [X, Z] = dio.toScene(xm, ym);
        const depthU = grid.depth[n] * dio.S;
        pos[k * 3] = X;
        pos[k * 3 + 1] = -(0.04 + 0.92 * rng()) * depthU;
        pos[k * 3 + 2] = Z;
        phase[k] = rng() * Math.PI * 2;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aPhase', new BufferAttribute(phase, 1));
      const m = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uEx: { value: 1 },
          uTime: { value: 0 },
          uSize: { value: 2.6 },
          uPulse: { value: layer.over ? 1 : 0 },
          uColor: { value: new Color(layer.color) },
          uBoost: { value: layer.over ? 1.5 : 1 },
        },
      });
      return { layer, g, m };
    });
  }, [layers, dio]);
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
    for (const s of systems) {
      s.m.uniforms.uEx.value = exaggeration;
      s.m.uniforms.uTime.value = reducedMotion ? 0 : st.clock.elapsedTime;
      s.m.uniforms.uPulse.value = s.layer.over && !reducedMotion ? 1 : 0;
      s.g.setDrawRange(0, Math.ceil(s.layer.count * quality));
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
