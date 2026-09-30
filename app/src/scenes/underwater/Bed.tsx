import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { CAUSTIC_GLSL, HASH_GLSL, WATER_FOG_GLSL } from '../common/glsl';
import { PATCH, type World } from './world';

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
uniform float uTime;
uniform float uCaustics;
varying vec3 vWorld;
varying vec3 vNormalW;
${HASH_GLSL}
${WATER_FOG_GLSL}
${CAUSTIC_GLSL}
void main() {
  float depth = max(uSurfaceY - vWorld.y, 0.0);
  vec3 sand = vec3(0.42, 0.35, 0.24);
  vec3 silt = vec3(0.11, 0.1, 0.085);
  vec3 col = mix(sand, silt, smoothstep(1.5, 14.0, depth));
  float n = vnoise(vWorld.xz * 0.9) * 0.6 + vnoise(vWorld.xz * 4.0) * 0.4;
  col *= 0.78 + 0.35 * n;
  // pebbles
  vec2 cell = vWorld.xz * 5.0;
  vec2 cid = floor(cell);
  float pr = hash21(cid);
  float pd = length(fract(cell) - vec2(0.3 + 0.4 * hash21(cid + 7.0), 0.3 + 0.4 * hash21(cid + 13.0)));
  col = mix(col, col * (0.55 + pr * 0.8), step(0.72, pr) * (1.0 - smoothstep(0.08, 0.2 + pr * 0.1, pd)));
  vec3 N = normalize(vNormalW);
  float diff = 0.35 + 0.65 * max(dot(N, normalize(vec3(0.2, 1.0, 0.1))), 0.0);
  float shallow = (1.0 - smoothstep(1.0, 8.0, depth)) * uCaustics;
  float c = caustic(vWorld.xz * 0.06, uTime * 0.6);
  col *= diff * (0.4 + 0.6 * lightAtDepth(vWorld.y));
  col += vec3(0.55, 0.75, 0.8) * c * shallow * 1.4;
  float dist = length(vWorld - cameraPosition);
  gl_FragColor = vec4(applyWaterFog(col, dist, vWorld.y), 1.0);
  #include <colorspace_fragment>
}
`;

interface Props {
  world: World;
  fogColor: string;
  reducedMotion: boolean;
}

/** Synthesised bed patch with procedural sediment and caustics in water shallower than 8 m. */
export function Bed({ world, fogColor, reducedMotion }: Props) {
  const geometry = useMemo(() => {
    const seg = 128;
    const g = new PlaneGeometry(PATCH, PATCH, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, -world.bedDepth(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, [world]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uCaustics: { value: 1 },
          uFogColor: { value: new Color(fogColor) },
          uFogDensity: { value: world.fogDensity },
          uSurfaceY: { value: 0 },
        },
      }),
    [world, fogColor],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    material.uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
  });
  return <mesh geometry={geometry} material={material} position={[0, 0, 0]} />;
}
