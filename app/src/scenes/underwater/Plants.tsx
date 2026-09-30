import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { WATER_FOG_GLSL } from '../common/glsl';
import { useRenderQuality } from '../common/SceneCanvas';
import { plantPositions, type World } from './world';

const VERT = /* glsl */ `
attribute float aPhase;
attribute float aTint;
uniform float uTime;
varying float vY;
varying float vTint;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  float h = p.y; // 0 at the base, 1 at the tip
  p.x *= 1.0 - h * 0.75;
  p.x += sin(uTime * 1.3 + aPhase + h * 2.2) * 0.22 * h * h;
  p.z += cos(uTime * 1.1 + aPhase * 1.3 + h * 1.7) * 0.12 * h * h;
  vY = h;
  vTint = aTint;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const FRAG = /* glsl */ `
varying float vY;
varying float vTint;
varying vec3 vWorld;
${WATER_FOG_GLSL}
void main() {
  vec3 base = vec3(0.03, 0.12, 0.03);
  vec3 tip = vec3(0.14, 0.3, 0.07);
  vec3 col = mix(base, tip, vY) * vTint * (0.4 + 0.6 * lightAtDepth(vWorld.y));
  float dist = length(vWorld - cameraPosition);
  gl_FragColor = vec4(applyWaterFog(col, dist, vWorld.y), 1.0);
  #include <colorspace_fragment>
}
`;

interface Props {
  world: World;
  plantSpecies: number;
  fogColor: string;
  reducedMotion: boolean;
}

/** Instanced reed-like stalks in the littoral zone, present only when plant species are recorded. */
export function Plants({ world, plantSpecies, fogColor, reducedMotion }: Props) {
  const quality = useRenderQuality();
  const total = Math.min(600, plantSpecies * 90);
  const { mesh, material, n } = useMemo(() => {
    const geo = new PlaneGeometry(0.16, 1, 1, 6);
    geo.translate(0, 0.5, 0);
    const pos = plantPositions(world, total);
    const phase = new Float32Array(pos.length);
    const tint = new Float32Array(pos.length);
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new Color(fogColor) },
        uFogDensity: { value: world.fogDensity },
        uSurfaceY: { value: 0 },
      },
    });
    const m = new InstancedMesh(geo, mat, Math.max(1, pos.length));
    const o = new Object3D();
    pos.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, p.phase, 0);
      o.scale.set(1, p.h, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      phase[i] = p.phase;
      tint[i] = 0.8 + 0.4 * Math.abs(Math.sin(p.phase * 3.1));
    });
    m.count = pos.length;
    geo.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aTint', new InstancedBufferAttribute(tint, 1));
    m.frustumCulled = false;
    return { mesh: m, material: mat, n: pos.length };
  }, [world, total, fogColor]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      material.dispose();
    },
    [mesh, material],
  );
  useFrame((s) => {
    material.uniforms.uTime.value = reducedMotion ? 0 : s.clock.elapsedTime;
    mesh.count = Math.max(0, Math.ceil(n * quality));
  });
  if (plantSpecies <= 0) return null;
  return <primitive object={mesh} />;
}
