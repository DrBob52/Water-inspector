import { BackSide, Color, DoubleSide, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { CatalogColors } from '@wi/shared';
import { CAUSTIC_GLSL, HASH_GLSL, UNDERWATER_GLSL } from '../common/glsl';

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
attribute vec2 aFin;
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
varying vec2 vFin;
varying vec3 vWorld;
varying float vTint;
varying vec3 vObj;
void main() {
  vec3 pos = position;
  if (uOutline > 0.5) pos += normal * 0.022;
  // Travelling sine wave along the body axis; amplitude grows toward the tail. Eels undulate fully.
  float env = mix(0.06, 1.0, pow(clamp(aT, 0.0, 1.25), 1.8));
  env = mix(env, 0.3 + 0.7 * aT, uFullBody);
  float ph = uTime * uWaveFreq + aPhase - aT * uWaveLen;
  float wave = sin(ph) * uWaveAmp * env;
  // The head yaws a touch against the tail (recoil), and fins flutter.
  wave -= sin(ph + 0.6) * uWaveAmp * 0.12 * (1.0 - aT) * (1.0 - uFullBody);
  pos.z += wave;
  float flutter = aPart * aFin.x * step(0.001, abs(position.z)) * 0.012;
  pos.y += sin(uTime * 7.0 + aPhase * 3.0 + aT * 9.0) * flutter;
  // Bend the normal with the wave so the flank catches the light as it flexes.
  float slope = cos(ph) * uWaveAmp * env * uWaveLen;
  vec3 n = normalize(normal + vec3(-slope * normal.z * (1.0 - aPart), 0.0, 0.0));
  vObj = position;
  vNormalObj = normal;
  mat4 m = modelMatrix * instanceMatrix;
  vNormalWorld = normalize(mat3(m) * n);
  vec4 wpos = m * vec4(pos, 1.0);
  vWorld = wpos.xyz;
  vT = aT;
  vPart = aPart;
  vFin = aFin;
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
uniform vec3 uEye;
uniform float uHasEye;
uniform float uSheen;
varying vec3 vNormalObj;
varying vec3 vNormalWorld;
varying float vT;
varying float vPart;
varying vec2 vFin;
varying vec3 vWorld;
varying float vTint;
varying vec3 vObj;
${HASH_GLSL}
${CAUSTIC_GLSL}
${UNDERWATER_GLSL}
void main() {
  if (uOutline > 0.5) {
    gl_FragColor = vec4(uOutlineColor * 1.6, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  vec3 No = normalize(vNormalObj);
  float ny = No.y;
  float body = 1.0 - vPart;
  // Countershading: dark back, the flank colour, a pale belly.
  vec3 base = mix(uSide, uBack, smoothstep(0.05, 0.7, ny));
  base = mix(base, uBelly, 1.0 - smoothstep(-0.6, -0.08, ny));
  vec2 q = vec2(vObj.x * 22.0, vObj.y * 40.0 + vObj.z * 18.0);
  float flank = smoothstep(-0.35, 0.25, ny) * (1.0 - smoothstep(0.85, 1.0, ny));
  if (uPattern > 0.5 && uPattern < 1.5) {
    // vertical bars, slightly irregular, fading toward the belly
    float x = vT * 7.5 + 0.35 * vnoise(vec2(vObj.y * 30.0, vT * 4.0));
    float bars = smoothstep(0.32, 0.5, abs(fract(x) - 0.5) * 2.0);
    float m = (1.0 - bars) * smoothstep(-0.25, 0.45, ny) * step(0.16, vT) * step(vT, 0.84);
    base = mix(base, uBack * 0.55, m * 0.85);
  } else if (uPattern > 1.5 && uPattern < 2.5) {
    // round spots scattered over the back and flanks
    vec2 g = vec2(vObj.x * 34.0, vObj.y * 55.0 + vObj.z * 30.0);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 o = vec2(hash21(id), hash21(id + 17.0)) - 0.5;
    float r = 0.18 + 0.14 * hash21(id + 5.0);
    float spot = (1.0 - smoothstep(r * 0.7, r, length(f - o * 0.5))) * step(0.35, hash21(id + 9.0));
    base = mix(base, uBack * 0.35, spot * smoothstep(-0.35, 0.2, ny) * step(0.1, vT));
  } else if (uPattern > 2.5 && uPattern < 3.5) {
    // a dark lateral band with a ragged edge
    float edge = (vnoise(vec2(vT * 26.0, 3.0)) - 0.5) * 0.18;
    float band = 1.0 - smoothstep(0.08, 0.2, abs(ny - 0.02 + edge));
    base = mix(base, uBack * 0.42, band * step(0.12, vT) * step(vT, 0.9) * 0.9);
  } else if (uPattern > 3.5) {
    float n = vnoise(vec2(vT * 13.0, vObj.y * 34.0 + vObj.z * 16.0));
    n += 0.5 * vnoise(vec2(vT * 31.0, vObj.y * 70.0));
    base = mix(base, uBack * 0.5, smoothstep(0.78, 1.05, n) * smoothstep(-0.3, 0.4, ny));
  }
  // Lateral line and gill cover.
  float lat = (1.0 - smoothstep(0.0, 0.04, abs(ny - 0.08))) * step(0.22, vT) * step(vT, 0.86);
  base = mix(base, base * 1.25 + 0.02, lat * 0.35 * flank);
  float gill = 1.0 - smoothstep(0.0, 0.012, abs(vObj.x - (uEye.x - uEye.z * 3.2 - 0.02 * ny * ny)));
  base *= 1.0 - 0.28 * gill * step(-0.75, ny) * step(ny, 0.6) * body * uHasEye;

  // Fins: translucent-looking rays, darker near the base, a pale trailing edge.
  float rays = 0.5 + 0.5 * sin(vFin.y * 70.0);
  vec3 finCol = uFin * (0.75 + 0.35 * rays) * mix(0.8, 1.15, vFin.x);
  finCol = mix(finCol, waterColor(normalize(vWorld - cameraPosition), max(-vWorld.y, 0.0)) * 2.0, 0.28 * vFin.x);
  base = mix(base, finCol, vPart);
  base *= vTint;
  // Scales: a fine diamond lattice that breaks up the sheen.
  vec2 sc = vec2(vObj.x * 150.0 + vObj.y * 60.0, vObj.x * 150.0 - vObj.y * 60.0 + vObj.z * 40.0);
  float scale = abs(fract(sc.x) - 0.5) + abs(fract(sc.y) - 0.5);
  float scaleMask = smoothstep(0.35, 0.6, scale) * body * step(0.12, vT);
  base *= 1.0 - 0.07 * scaleMask;

  vec3 N = normalize(vNormalWorld);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float depth = max(-vWorld.y, 0.0);
  vec3 T = downwell(depth);
  vec3 col = underwaterLight(base, N, vWorld, 0.35 + 0.4 * vPart, 1.0);
  // Scales: a soft silvery sheen toward the sun, strongest on the flanks.
  vec3 H = normalize(-uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 36.0) * (0.25 + 0.75 * flank) * body;
  col += uSunColor * T * spec * uSheen * (1.0 - 0.6 * scaleMask);
  // Flank glint as the body flexes: broad, view-dependent.
  float glint = pow(max(dot(reflect(-V, N), -uSunDir), 0.0), 6.0) * flank * body;
  col += mix(uSide, vec3(1.0), 0.5) * T * glint * 0.18 * uSheen;
  // Caustics ripple over the back in shallow water.
  col += base * uSunColor * T * causticAt(vWorld) * max(N.y, 0.0) * 0.8;
  // Rim light so silhouettes separate from the haze.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += waterColor(-V, depth) * rim * 0.9 + uWaterUp * rim * max(N.y, 0.0) * 0.25;

  // Eye: dark pupil, a metallic iris ring and a catch-light.
  if (uHasEye > 0.5 && body > 0.5) {
    float d = length(vec2(vObj.x - uEye.x, (vObj.y - uEye.y) * 1.05)) / uEye.z;
    if (d < 1.15) {
      float iris = 1.0 - smoothstep(0.88, 1.02, d);
      float pupil = 1.0 - smoothstep(0.58, 0.68, d);
      vec3 irisCol = vec3(0.32, 0.24, 0.09) * (0.45 + 0.55 * T) * (0.8 + 0.4 * smoothstep(0.6, 0.9, d));
      vec3 e = mix(col, irisCol, iris);
      e = mix(e, vec3(0.004, 0.006, 0.008), pupil);
      float glare = 1.0 - smoothstep(0.0, 0.22, length(vec2(vObj.x - uEye.x - uEye.z * 0.28, vObj.y - uEye.y - uEye.z * 0.3)) / uEye.z);
      e += vec3(0.9) * glare * (0.3 + 0.7 * T.g);
      col = e;
    }
  }

  // Highlighted species (from the Life tab): a pulsing cyan glow that blooms and, applied after
  // the haze, still cuts through murky water.
  vec3 glow = uGlow * (0.3 + rim * 3.0) * vec3(0.25, 0.85, 1.0) * (0.7 + 0.3 * sin(uTime * 3.0));
  gl_FragColor = vec4(underwaterFog(col + glow, vWorld) + glow * 0.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface FishMaterialOptions {
  colors: CatalogColors;
  /** Shared underwater uniforms (see underwater/water.ts). */
  water: Record<string, IUniform>;
  waveAmp: number;
  waveFreq: number;
  fullBody: boolean;
  /** Eye centre (x, y) and radius in object space; omit for shapes without one. */
  eye?: { x: number; y: number; r: number };
  sheen?: number;
  outline?: boolean;
  outlineColor?: string;
}

export type FishUniforms = Record<string, IUniform>;

/** One material per species. Colours and pattern come from the catalog; motion is in the vertex shader. */
export function createFishMaterial(o: FishMaterialOptions): ShaderMaterial {
  const uniforms: FishUniforms = {
    ...o.water,
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
    uEye: { value: new Vector3(o.eye?.x ?? 0, o.eye?.y ?? 0, o.eye?.r ?? 0.02) },
    uHasEye: { value: o.eye ? 1 : 0 },
    uSheen: { value: o.sheen ?? 1 },
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: o.outline ? BackSide : DoubleSide,
  });
}

export const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
