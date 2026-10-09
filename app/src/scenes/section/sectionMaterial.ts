import {
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';

/**
 * One shader draws the whole front face of the slice: the water column (light falloff, temperature
 * layers, oxygen tint, depth gridlines, photic and thermocline marks) and the ground under it (a
 * sediment skin over layered strata, fading out at the sides and the bottom). The bed is a 1D float
 * texture of heights, so the waterline and the bed edge are both anti-aliased per pixel.
 */
const vert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */ `
uniform sampler2D uBed;
uniform float uN;
uniform vec2 uRange;
uniform sampler2D uDo;
uniform float uHasDo;
uniform float uWaterW;
uniform float uWaterH;
uniform float uBottom;
uniform float uLandW;
uniform float uFade;
uniform float uPxPerM;
uniform float uKd;
uniform float uPhoticM;
uniform float uThermoM;
uniform float uThermoW;
uniform float uTick;
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uWarm;
uniform vec3 uCold;
varying vec2 vP;

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
float bedAt(float x) {
  float f = clamp((x - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0) * (uN - 1.0);
  float i = floor(f);
  float a = texture2D(uBed, vec2((i + 0.5) / uN, 0.5)).r;
  float b = texture2D(uBed, vec2((min(i + 1.0, uN - 1.0) + 0.5) / uN, 0.5)).r;
  return mix(a, b, f - i);
}
/** 1 on a horizontal hairline at y = 0 of the coordinate v (in pixels), 0 elsewhere. */
float hairline(float v, float width) {
  float w = max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(width * 0.5, width * 0.5 + w, abs(v));
}

void main() {
  float x = vP.x;
  float y = vP.y;
  float bed = bedAt(x);
  float above = y - bed;
  float aaB = max(fwidth(above), 1e-3);
  float ground = 1.0 - smoothstep(-0.5 * aaB, 0.5 * aaB, above);
  float aaS = max(fwidth(y), 1e-3);
  float wet = (1.0 - ground) * (1.0 - smoothstep(-0.5 * aaS, 0.5 * aaS, y));

  // Water ---------------------------------------------------------------------------------------
  float depthM = max(-y, 0.0) / uPxPerM;
  float rel = clamp(-y / uWaterH, 0.0, 1.0);
  float light = exp(-uKd * depthM);
  float glow = pow(light, 0.35);
  vec3 base = mix(uMid, uDeep, smoothstep(0.0, 1.0, pow(rel, 0.7)));
  vec3 water = mix(base, uShallow, glow * 0.82);
  // Soft slanted light shafts, only where light reaches.
  float shaft = vnoise(vec2((x + y * 0.55) * 0.018 + uTime * 0.02, 0.5));
  shaft = smoothstep(0.45, 0.95, shaft);
  water += uShallow * shaft * glow * 0.10;
  if (uThermoM > 0.0) {
    float epi = 1.0 - smoothstep(uThermoM - uThermoW, uThermoM + uThermoW, depthM);
    water *= mix(uCold, uWarm, epi);
    float t = (depthM - uThermoM) / max(uThermoW, 1e-3);
    water += vec3(0.62, 0.88, 0.94) * exp(-t * t) * 0.2;
    float dash = step(0.35, fract(x / 9.0));
    water = mix(water, vec3(0.86, 0.95, 0.97), hairline((depthM - uThermoM) * uPxPerM, 1.0) * dash * 0.55);
  }
  if (uHasDo > 0.5) {
    vec4 d = texture2D(uDo, vec2(rel, 0.5));
    water = mix(water, d.rgb * (0.62 + 0.3 * glow), d.a);
  }
  // Faint depth gridlines at the ruler's ticks.
  if (uTick > 0.0 && depthM > 0.5 * uTick) {
    float k = depthM / uTick;
    float g = hairline((k - floor(k + 0.5)) * uTick * uPxPerM, 1.0);
    water = mix(water, vec3(0.75, 0.9, 0.95), g * 0.07);
  }
  // Photic zone boundary: a soft dotted line where 1% of surface light remains.
  if (uPhoticM > 0.0) {
    float dots = step(0.5, fract(x / 5.0));
    water = mix(water, vec3(0.95, 0.93, 0.78), hairline((depthM - uPhoticM) * uPxPerM, 1.0) * dots * 0.42);
  }
  // Shade into the bed, and a bright meniscus at the surface.
  water *= mix(0.7, 1.0, smoothstep(0.0, 9.0, above));
  water += vec3(0.55, 0.88, 0.96) * exp(y / 1.4) * 0.55;

  // Ground --------------------------------------------------------------------------------------
  float g = max(bed - y, 0.0);
  float n = vnoise(vec2(x * 0.035, y * 0.08));
  float n2 = vnoise(vec2(x * 0.25, y * 0.5));
  // Strata lie almost flat, with a slight sag under the lake and a gentle wander.
  float q = y - bed * 0.12 + (vnoise(vec2(x * 0.008, 1.3)) - 0.5) * 14.0 + (n - 0.5) * 3.0;
  float band = floor(q / 11.0);
  float h = hash21(vec2(band, 3.7));
  vec3 rock = mix(vec3(0.150, 0.135, 0.118), vec3(0.235, 0.205, 0.165), h);
  float seam = hairline(fract(q / 11.0) * 11.0, 0.8);
  rock *= 1.0 - seam * 0.22;
  vec3 silt = mix(vec3(0.30, 0.28, 0.21), vec3(0.37, 0.34, 0.25), n);
  float onLand = step(0.0, bed);
  vec3 soil = mix(vec3(0.27, 0.25, 0.18), vec3(0.33, 0.31, 0.21), n);
  vec3 skin = mix(silt, soil, onLand);
  float skinT = mix(4.0, 5.0, onLand) + n * 2.5;
  vec3 earth = mix(skin, rock, smoothstep(skinT - 1.0, skinT + 1.5, g));
  earth *= 0.94 + n2 * 0.12;
  // Lit top edge; land catches more light than the lake bed.
  earth += vec3(0.30, 0.29, 0.22) * exp(-g / 1.1) * mix(0.45, 0.75, onLand);
  // Deeper ground falls off into the background.
  earth *= mix(0.62, 1.0, exp(-g / 90.0));
  float groundA = smoothstep(uBottom, uBottom + uFade, y);

  vec3 col = mix(water, earth, ground);
  float alpha = max(ground * groundA, wet);
  // A faint luminous haze just above the open water.
  float haze = (1.0 - ground) * (1.0 - wet) * step(bed, 0.0) * exp(-max(y, 0.0) / 7.0) * 0.16;
  col = mix(col, uShallow, haze / max(alpha + haze, 1e-3));
  alpha = max(alpha, haze);
  // Land fades out beyond each shore.
  float side = smoothstep(-uLandW, -uLandW * 0.25, x) * (1.0 - smoothstep(uWaterW + uLandW * 0.25, uWaterW + uLandW, x));
  alpha *= side;
  if (alpha < 0.003) discard;
  // Colours are authored in display (sRGB) space, so no tone mapping or colour-space conversion.
  gl_FragColor = vec4(col, alpha);
}
`;

export function bedTexture(heights: Float32Array): DataTexture {
  const t = new DataTexture(heights, heights.length, 1, RedFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function doTexture(texels: Uint8Array | null): DataTexture {
  const data = texels ?? new Uint8Array([0, 0, 0, 0]);
  const t = new DataTexture(data, data.length / 4, 1, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function createSectionMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uBed: { value: null },
      uN: { value: 1 },
      uRange: { value: [0, 1] },
      uDo: { value: null },
      uHasDo: { value: 0 },
      uWaterW: { value: 1 },
      uWaterH: { value: 1 },
      uBottom: { value: -1 },
      uLandW: { value: 1 },
      uFade: { value: 1 },
      uPxPerM: { value: 1 },
      uKd: { value: 0.1 },
      uPhoticM: { value: -1 },
      uThermoM: { value: -1 },
      uThermoW: { value: 1 },
      uTick: { value: 0 },
      uTime: { value: 0 },
      uShallow: { value: new Vector3() },
      uMid: { value: new Vector3() },
      uDeep: { value: new Vector3() },
      uWarm: { value: new Vector3(1.06, 1.03, 0.94) },
      uCold: { value: new Vector3(0.93, 0.98, 1.06) },
    },
  });
}
