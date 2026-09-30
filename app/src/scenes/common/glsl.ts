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
