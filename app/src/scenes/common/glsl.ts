/** GLSL snippets shared by the underwater custom materials. */

/** Exponential-squared fog toward the water colour, with light that fades with depth. */
export const WATER_FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSurfaceY;

float lightAtDepth(float worldY) {
  return 0.22 + 0.78 * exp(-max(uSurfaceY - worldY, 0.0) * 0.03);
}

vec3 applyWaterFog(vec3 col, float dist, float worldY) {
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  // The haze takes its brightness from the viewer's depth, so far geometry fades into the water colour.
  vec3 fogCol = uFogColor * (0.5 + 0.5 * lightAtDepth(cameraPosition.y));
  return mix(col, fogCol, clamp(f, 0.0, 1.0));
}
`;

export const HASH_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

export const CAUSTIC_GLSL = /* glsl */ `
float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

/** Fractal value noise; needs HASH_GLSL first. */
export const FBM_GLSL = /* glsl */ `
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.13;
    a *= 0.5;
  }
  return s / 0.875;
}
float fbm5(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.71;
    a *= 0.5;
  }
  return s / 0.96875;
}
`;

/**
 * Underwater optics shared by every Underwater-view material: depth-attenuated sunlight
 * (per-channel Beer-Lambert), a direction-dependent water colour for the in-scattered haze, fog
 * whose reds fall away first, and caustics in shallow water. Needs HASH_GLSL and CAUSTIC_GLSL first.
 * The uniforms come from one shared record so time and colours update every material at once.
 */
export const UNDERWATER_GLSL = /* glsl */ `
uniform vec3 uWaterUp;
uniform vec3 uWaterHorizon;
uniform vec3 uWaterDeep;
uniform vec3 uExtinction;
uniform vec3 uFogTint;
uniform float uFogDensity;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCausticStrength;
uniform float uCausticMaxDepth;
uniform float uWaterTime;
uniform float uUpExp;

/** Fraction of surface light that reaches this depth, per channel. */
vec3 downwell(float depth) {
  return exp(-uExtinction * max(depth, 0.0));
}

/** In-scattered water colour seen along a direction, for a viewer at this depth. */
vec3 waterColor(vec3 dir, float depth) {
  float up = dir.y;
  vec3 c = up > 0.0
    ? mix(uWaterHorizon, uWaterUp, pow(up, uUpExp))
    : mix(uWaterHorizon, uWaterDeep, pow(-up, 0.62));
  // Ambient light dims and shifts colour with depth, a little slower than direct sun.
  vec3 t = exp(-uExtinction * max(depth, 0.0) * 0.72);
  c *= mix(t, vec3(1.0), 0.12);
  // Bright smear toward the refracted sun.
  float s = max(dot(dir, -uSunDir), 0.0);
  c += uSunColor * 0.06 * pow(s, 12.0) * t;
  return c;
}

/** Exponential-squared haze toward the water colour; red goes first, then green. */
vec3 underwaterFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float d = length(v);
  vec3 dir = v / max(d, 1e-4);
  float camDepth = max(-cameraPosition.y, 0.0);
  float k = uFogDensity * d;
  vec3 f = 1.0 - exp(-k * k * uFogTint);
  return mix(col, waterColor(dir, camDepth), clamp(f, 0.0, 1.0));
}

/** Caustic light on an up-facing surface, 0 below uCausticMaxDepth. */
float causticAt(vec3 worldPos) {
  float depth = max(-worldPos.y, 0.0);
  float fade = 1.0 - smoothstep(uCausticMaxDepth * 0.6, uCausticMaxDepth, depth);
  if (fade <= 0.0 || uCausticStrength <= 0.0) return 0.0;
  // Bigger, softer cells deeper down; two drifting layers so the tile never reads.
  float scale = 0.42 / (1.0 + depth * 0.12);
  vec2 p = worldPos.xz * scale;
  float a = caustic(p + vec2(uWaterTime * 0.013, 0.0), uWaterTime * 0.42);
  float b = caustic(mat2(0.8, 0.6, -0.6, 0.8) * p * 1.37 + 3.1, uWaterTime * 0.37 + 2.0);
  return (a + b) * 0.5 * (0.6 + 0.4 * min(a, b) * 4.0) * fade * uCausticStrength;
}

/**
 * Lit colour of an underwater surface: hemispheric water ambient plus sun attenuated by depth.
 * wrap softens the terminator (0 = Lambert).
 */
vec3 underwaterLight(vec3 albedo, vec3 N, vec3 worldPos, float wrap, float ao) {
  float depth = max(-worldPos.y, 0.0);
  vec3 T = downwell(depth);
  vec3 L = -uSunDir;
  float diff = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
  vec3 sky = uWaterUp * 1.1;
  vec3 ground = uWaterDeep * 2.0 + uWaterHorizon * 0.25;
  vec3 amb = mix(ground, sky, N.y * 0.5 + 0.5) * mix(T, vec3(1.0), 0.18);
  return albedo * (amb * ao + uSunColor * T * diff);
}
`;
