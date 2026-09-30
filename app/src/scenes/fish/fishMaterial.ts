import { Color, DoubleSide, BackSide, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { CatalogColors } from '@wi/shared';
import { HASH_GLSL, WATER_FOG_GLSL } from '../common/glsl';

const PATTERN: Record<NonNullable<CatalogColors['pattern']>, number> = {
  none: 0,
  bars: 1,
  spots: 2,
  stripe: 3,
  mottled: 4,
};

const VERT = /* glsl */ `
attribute float aT;
attribute float aPart;
attribute float aPhase;
attribute float aTint;
uniform float uTime;
uniform float uWaveAmp;
uniform float uWaveFreq;
uniform float uWaveLen;
uniform float uFullBody;
uniform float uOutline;
varying vec3 vNormalObj;
varying vec3 vNormalWorld;
varying float vT;
varying float vPart;
varying vec3 vWorld;
varying float vTint;
varying vec3 vObj;
void main() {
  vec3 pos = position;
  if (uOutline > 0.5) pos += normal * 0.03;
  // Travelling sine wave along the body axis; amplitude grows toward the tail. Eels undulate fully.
  float env = mix(0.1, 1.0, pow(clamp(aT, 0.0, 1.2), 1.7));
  env = mix(env, 0.35 + 0.65 * aT, uFullBody);
  float wave = sin(uTime * uWaveFreq + aPhase - aT * uWaveLen) * uWaveAmp * env;
  pos.z += wave;
  vObj = pos;
  vNormalObj = normal;
  mat4 m = modelMatrix * instanceMatrix;
  vNormalWorld = mat3(m) * normal;
  vec4 wpos = m * vec4(pos, 1.0);
  vWorld = wpos.xyz;
  vT = aT;
  vPart = aPart;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * wpos;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uBack;
uniform vec3 uSide;
uniform vec3 uBelly;
uniform vec3 uFin;
uniform float uPattern;
uniform float uOutline;
uniform vec3 uOutlineColor;
uniform float uGlow;
uniform float uTime;
varying vec3 vNormalObj;
varying vec3 vNormalWorld;
varying float vT;
varying float vPart;
varying vec3 vWorld;
varying float vTint;
varying vec3 vObj;
${HASH_GLSL}
${WATER_FOG_GLSL}
void main() {
  float dist = length(vWorld - cameraPosition);
  if (uOutline > 0.5) {
    gl_FragColor = vec4(applyWaterFog(uOutlineColor, dist, vWorld.y), 1.0);
    #include <colorspace_fragment>
    return;
  }
  vec3 No = normalize(vNormalObj);
  float ny = No.y;
  vec3 base = mix(uSide, uBack, smoothstep(0.1, 0.65, ny));
  base = mix(base, uBelly, 1.0 - smoothstep(-0.55, -0.05, ny));
  float body = 1.0 - vPart;
  if (uPattern > 0.5 && uPattern < 1.5) {
    // vertical bars on the flanks
    float bars = smoothstep(0.45, 0.55, abs(fract(vT * 6.0) - 0.5) * 2.0);
    base = mix(base, uBack * 0.65, (1.0 - bars) * smoothstep(-0.2, 0.5, ny) * step(0.12, vT) * step(vT, 0.85));
  } else if (uPattern > 1.5 && uPattern < 2.5) {
    float n = hash21(floor(vec2(vT * 28.0, vObj.y * 60.0 + vObj.z * 25.0)));
    base = mix(base, uBack * 0.45, step(0.86, n) * smoothstep(-0.3, 0.3, ny));
  } else if (uPattern > 2.5 && uPattern < 3.5) {
    float band = 1.0 - smoothstep(0.0, 0.16, abs(ny + 0.05));
    base = mix(base, uBack * 0.5, band * step(0.15, vT) * step(vT, 0.9));
  } else if (uPattern > 3.5) {
    float n = vnoise(vec2(vT * 14.0, vObj.y * 40.0 + vObj.z * 18.0));
    base = mix(base, uBack * 0.55, smoothstep(0.55, 0.75, n) * smoothstep(-0.2, 0.4, ny));
  }
  base = mix(base, uFin * (0.8 + 0.3 * vT), 1.0 - body);
  vec3 N = normalize(vNormalWorld);
  if (!gl_FrontFacing) N = -N;
  float diff = 0.42 + 0.58 * max(dot(N, normalize(vec3(0.25, 1.0, 0.15))), 0.0);
  float lit = lightAtDepth(vWorld.y);
  vec3 col = base * diff * (0.35 + 0.65 * lit) * vTint;
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  col += uGlow * rim * vec3(0.25, 0.85, 1.0) * (0.7 + 0.3 * sin(uTime * 3.0));
  gl_FragColor = vec4(applyWaterFog(col, dist, vWorld.y), 1.0);
  #include <colorspace_fragment>
}
`;

export interface FishMaterialOptions {
  colors: CatalogColors;
  fogColor: string;
  fogDensity: number;
  surfaceY: number;
  waveAmp: number;
  waveFreq: number;
  fullBody: boolean;
  outline?: boolean;
  outlineColor?: string;
}

export type FishUniforms = Record<string, IUniform>;

/** One material per species. Colours and pattern come from the catalog; motion is in the vertex shader. */
export function createFishMaterial(o: FishMaterialOptions): ShaderMaterial {
  const uniforms: FishUniforms = {
    uTime: { value: 0 },
    uWaveAmp: { value: o.waveAmp },
    uWaveFreq: { value: o.waveFreq },
    uWaveLen: { value: o.fullBody ? 9.0 : 5.5 },
    uFullBody: { value: o.fullBody ? 1 : 0 },
    uOutline: { value: o.outline ? 1 : 0 },
    uOutlineColor: { value: new Color(o.outlineColor ?? '#ff8a00') },
    uBack: { value: new Color(o.colors.back) },
    uSide: { value: new Color(o.colors.side) },
    uBelly: { value: new Color(o.colors.belly) },
    uFin: { value: new Color(o.colors.fin) },
    uPattern: { value: PATTERN[o.colors.pattern ?? 'none'] },
    uGlow: { value: 0 },
    uFogColor: { value: new Color(o.fogColor) },
    uFogDensity: { value: o.fogDensity },
    uSurfaceY: { value: o.surfaceY },
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: o.outline ? BackSide : DoubleSide,
  });
}

export const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
