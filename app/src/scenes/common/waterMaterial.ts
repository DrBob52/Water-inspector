import { Color, DoubleSide, ShaderMaterial, Vector3, Vector4, type Texture } from 'three';
import { HASH_GLSL } from './glsl';

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform vec4 uUv;
uniform float uShoreScale;
uniform float uFoamWidth;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uTint;
uniform vec3 uSky;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uClarity;
uniform float uDark;
uniform float uOpacity;
uniform float uRippleScale;
varying vec3 vWorld;
${HASH_GLSL}

float waves(vec2 p, float t) {
  return 0.55 * vnoise(p * 1.3 + vec2(0.31, 0.22) * t)
       + 0.3 * vnoise(p * 2.9 + vec2(-0.27, 0.36) * t)
       + 0.15 * vnoise(p * 6.1 + vec2(0.45, -0.18) * t);
}

void main() {
  vec2 uv = vec2(vWorld.x * uUv.x + uUv.y, vWorld.z * uUv.z + uUv.w);
  vec4 g = uHasDepth > 0.5 ? texture2D(uDepth, uv) : vec4(0.6, 1.0, 0.0, 1.0);
  float depthN = g.r;
  float shoreDist = g.g * uShoreScale - uShoreScale * 0.25; // scene units from the shore (inside > 0)

  // Gentle animated ripples: normal from a small height field.
  vec2 p = vWorld.xz * uRippleScale;
  float t = uTime * 0.6;
  float e = 0.08;
  float h0 = waves(p, t);
  float hx = waves(p + vec2(e, 0.0), t);
  float hz = waves(p + vec2(0.0, e), t);
  vec3 N = normalize(vec3(-(hx - h0) / e * 0.035, 1.0, -(hz - h0) / e * 0.035));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float nv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - nv, 5.0);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 120.0) * 0.75 + pow(nh, 12.0) * 0.06;

  // Body colour by depth: turquoise over the shelf to navy over the deep, murkier water drifting
  // toward the measured tint (green with algae, brown with sediment).
  float dz = smoothstep(0.0, 0.75, pow(clamp(depthN, 0.0, 1.0), 0.7));
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.0, dz));
  vec3 murk = mix(uTint * 0.85, uTint * 0.38, dz);
  body = mix(body, murk, (1.0 - uClarity) * 0.78);
  body *= 0.78 + 0.22 * max(dot(N, L), 0.0);

  float alpha = mix(0.26, 0.88, dz);
  alpha = mix(alpha, 0.93, (1.0 - uClarity) * 0.75);

  // Shoreline: a soft broken foam band and a light edge right at the waterline.
  float shore = 1.0 - smoothstep(0.0, uFoamWidth, shoreDist);
  float lip = 1.0 - smoothstep(0.0, uFoamWidth * 0.28, shoreDist);
  float fn = vnoise(vWorld.xz * 2.4 + vec2(t * 0.25, -t * 0.18));
  float foam = shore * smoothstep(0.38, 0.8, fn + shore * 0.45);

  vec3 col;
  if (uDark > 0.5) {
    // Pollutants: a dark, slightly translucent volume so the plumes glow through it.
    vec3 dark = mix(vec3(0.010, 0.032, 0.055), vec3(0.004, 0.012, 0.026), dz);
    col = mix(dark, uSky * 0.35, fres * 0.6) + uLightColor * spec * 0.35;
    col += vec3(0.25, 0.65, 0.75) * lip * 0.35;
    alpha = mix(0.66, 0.84, dz) + fres * 0.2 + lip * 0.2;
  } else {
    // Reflection of a dim gallery with one large soft light behind the block (reads as glass).
    vec3 R = reflect(-V, N);
    vec3 sky = mix(uSky * 0.55, uSky * 1.35, clamp(R.y, 0.0, 1.0));
    sky += uLightColor * pow(max(dot(R, L), 0.0), 7.0) * 0.6;
    col = mix(body, sky, fres) + uLightColor * spec;
    col = mix(col, vec3(0.9, 0.96, 1.0), foam * 0.55 + lip * 0.35);
    alpha = max(alpha, fres * 0.9);
    alpha = max(alpha, foam * 0.75 + lip * 0.5);
    alpha += spec * 0.5;
  }
  gl_FragColor = vec4(col, clamp(alpha * uOpacity, 0.0, 0.97));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface WaterOptions {
  /** Water tint from the SceneModel (bluer when clear, green or brown when murky). */
  tint: string;
  /** 0 murky to 1 clear. */
  clarity?: number;
  /** Grid texture: R depth fraction, G distance from shore (see `buildDiorama`). */
  depthTexture?: Texture | null;
  /** Maps world x and z to texture u and v: u = x * sx + ox, v = z * sz + oz. */
  uv?: [number, number, number, number];
  /** Scene units represented by the full range of the G channel. */
  shoreScale?: number;
  /** Width of the foam band in scene units. */
  foamWidth?: number;
  /** A dark translucent volume (pollutants) instead of clear water. */
  dark?: boolean;
  opacity?: number;
}

/**
 * Glassy, translucent water: depth-coloured body, Fresnel reflection of a pale sky, a tight
 * specular highlight from the key light, slow animated ripples and a foam line at the shore.
 */
export function createWaterMaterial(o: WaterOptions): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uDepth: { value: o.depthTexture ?? null },
      uHasDepth: { value: o.depthTexture ? 1 : 0 },
      uUv: { value: new Vector4(...(o.uv ?? [0, 0, 0, 0])) },
      uShoreScale: { value: o.shoreScale ?? 1 },
      uFoamWidth: { value: o.foamWidth ?? 0.5 },
      uShallow: { value: new Color('#35c4b8') },
      uDeep: { value: new Color('#0b3478') },
      uTint: { value: new Color(o.tint) },
      uSky: { value: new Color('#2b4a5c') },
      uLightDir: { value: new Vector3(-0.5, 0.45, -0.4) },
      uLightColor: { value: new Color('#fff1dc') },
      uClarity: { value: o.clarity ?? 1 },
      uDark: { value: o.dark ? 1 : 0 },
      uOpacity: { value: o.opacity ?? 1 },
      uRippleScale: { value: 0.75 },
    },
  });
}

/** Clarity from the modelled visibility in metres (0 murky, 1 clear). */
export function waterClarity(visibilityM: number): number {
  const t = Math.max(0, Math.min(1, (visibilityM - 1) / 14));
  return t * t * (3 - 2 * t);
}
