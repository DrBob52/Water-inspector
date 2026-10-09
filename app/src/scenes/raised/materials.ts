import {
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  type IUniform,
} from 'three';
import { HASH_GLSL } from '../common/glsl';

/**
 * Terrain: the baked vertex colours (hypsometric tint, rock, snow, ambient occlusion) get a fine
 * procedural grain so the surface reads as carved and painted rather than plastic, a crisp pale
 * strand along the true shoreline, and anti-aliased depth contours on the lake bed.
 */
export function createTerrainMaterial() {
  const uniforms: Record<string, IUniform> = {
    uInterval: { value: 10 },
    uContour: { value: 0.55 },
    uShoreBand: { value: 120 },
    uGrain: { value: 1 },
    uBedDim: { value: 1 },
  };
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aElev;
attribute float aShore;
varying float vElev;
varying float vShore;
varying vec3 vTPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vElev = aElev;
vShore = aShore;
vTPos = position;`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uInterval;
uniform float uContour;
uniform float uShoreBand;
uniform float uGrain;
uniform float uBedDim;
varying float vElev;
varying float vShore;
varying vec3 vTPos;
${HASH_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 q = vTPos.xz;
  float grain = (vnoise(q * 0.85) - 0.5) * 0.12 + (vnoise(q * 3.3 + 7.1) - 0.5) * 0.09
              + (vnoise(q * 12.0 - 3.7) - 0.5) * 0.07;
  diffuseColor.rgb *= 1.0 + grain * uGrain;
  float landSide = step(vShore, 0.0);
  float strand = landSide * (1.0 - smoothstep(uShoreBand * 0.35, uShoreBand, -vShore));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.52, 0.32), strand * 0.55);
  float wet = (1.0 - landSide) * (1.0 - smoothstep(0.0, uShoreBand * 0.6, vShore));
  diffuseColor.rgb *= 1.0 - wet * 0.18;
  if (vElev < 0.0) diffuseColor.rgb *= uBedDim;
  if (vElev < 0.0 && uContour > 0.0) {
    float dd = -vElev / uInterval;
    float w = max(fwidth(dd), 1e-4);
    float dist = abs(fract(dd + 0.5) - 0.5);
    float line = (1.0 - smoothstep(0.1 * w, 0.95 * w, dist)) * step(0.5, dd);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.84), line * uContour);
  }
}`,
      );
  };
  m.customProgramCacheKey = () => 'wi-terrain-v1';
  return { material: m, uniforms };
}

// Strata colours for the cut face: buff and ochre sandstones, rust clay, pale limestone, shales.
const STRATA = ['#cdb48c', '#b88d5c', '#9a6847', '#d9c8a6', '#8e877b', '#ad9473', '#6f665c'].map(
  (c) => new Color(c),
);

/**
 * Side walls cut like a geological core: warped bands of rock and soil with fine laminations and
 * grain on a light, freshly cut face, a dark humus layer under the surface and a thin grass lip.
 */
export function createWallMaterial() {
  const uniforms: Record<string, IUniform> = {
    uBase: { value: -20 },
    uBand: { value: 1.05 },
    uStrata: { value: STRATA },
  };
  const m = new MeshStandardMaterial({ roughness: 0.97, metalness: 0, color: '#ffffff' });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTop;
attribute float aAlong;
varying float vTop;
varying float vAlong;
varying float vY;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTop = aTop;
vAlong = aAlong;
vY = position.y;`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBase;
uniform float uBand;
uniform vec3 uStrata[7];
varying float vTop;
varying float vAlong;
varying float vY;
${HASH_GLSL}
vec3 strataColor(float id) {
  int k = int(floor(hash21(vec2(id, 4.7)) * 6.999));
  return uStrata[k];
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float d = vTop - vY;
  float warp = (vnoise(vec2(vAlong * 0.05, 3.1)) - 0.5) * 1.8
             + (vnoise(vec2(vAlong * 0.23, 7.7)) - 0.5) * 0.35;
  float yy = (vY + warp) / uBand;
  yy += 0.45 * vnoise(vec2(yy * 0.6, 1.3));
  float id = floor(yy);
  float f = fract(yy);
  vec3 c = mix(strataColor(id - 1.0), strataColor(id), smoothstep(0.0, 0.07, f));
  c *= 0.92 + 0.08 * sin(yy * 37.0 + vnoise(vec2(vAlong * 0.6, yy * 2.0)) * 5.0);
  float gr = vnoise(vec2(vAlong, vY) * 6.0);
  float pebble = smoothstep(0.78, 0.9, vnoise(vec2(vAlong, vY) * 2.2 + 9.0));
  c *= 0.88 + 0.2 * gr - 0.12 * pebble;
  float soil = 1.0 - smoothstep(0.16, 0.6, d);
  c = mix(c, vec3(0.085, 0.055, 0.032), soil * 0.92);
  float lip = (1.0 - smoothstep(0.0, 0.07, d)) * step(0.02, vTop);
  c = mix(c, vec3(0.11, 0.17, 0.06), lip * 0.85);
  c *= mix(0.42, 1.0, smoothstep(uBase, uBase + 2.8, vY));
  diffuseColor.rgb = c;
}`,
      );
  };
  m.customProgramCacheKey = () => 'wi-wall-v1';
  return { material: m, uniforms };
}

const FLOOR_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const FLOOR_FRAG = /* glsl */ `
uniform vec2 uHalf;
uniform float uBlur;
uniform float uRadius;
uniform vec3 uColor;
varying vec2 vXZ;
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  float r = length(vXZ) / uRadius;
  float lift = 1.0 - smoothstep(0.0, 1.0, r);
  float sd = sdBox(vXZ, uHalf);
  float contact = 1.0 - smoothstep(-uBlur * 0.15, uBlur * 0.35, sd);
  float soft = 1.0 - smoothstep(-uBlur * 0.2, uBlur * 1.6, sd);
  float shadow = max(contact * 0.85, soft * 0.55);
  vec3 col = uColor * (1.0 - shadow);
  float a = max(lift * lift * 0.9, shadow * 0.9);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** A dark floor that fades into the backdrop, with a soft contact shadow under the plinth. */
export function createFloorMaterial(halfW: number, halfD: number) {
  return new ShaderMaterial({
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uHalf: { value: new Vector2(halfW, halfD) },
      uBlur: { value: 7 },
      uRadius: { value: Math.max(halfW, halfD) * 2.4 },
      uColor: { value: new Color('#0b1a22') },
    },
  });
}

let halo: CanvasTexture | null = null;
/** Soft round glow sprite for beacons. */
export function haloTexture(): CanvasTexture {
  if (halo) return halo;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  halo = new CanvasTexture(c);
  halo.colorSpace = SRGBColorSpace;
  return halo;
}

/** Deep ink backdrop with a subtle radial lift (never flat black). */
export function backdropTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(220, 150, 10, 240, 170, 360);
    grad.addColorStop(0, '#11293a');
    grad.addColorStop(0.45, '#0a1822');
    grad.addColorStop(1, '#03080c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 320);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
