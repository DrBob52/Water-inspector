import { Color, DoubleSide, ShaderMaterial } from 'three';

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
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vWorld;
void main() {
  // Animated normals from summed sines, then a Fresnel blend toward the sky colour.
  vec2 p = vWorld.xz * 0.55;
  float t = uTime * 0.7;
  vec3 n = normalize(vec3(
    sin(p.x * 1.7 + t) * 0.07 + sin(p.y * 2.3 - t * 1.3) * 0.05 + sin((p.x + p.y) * 3.1 + t * 0.7) * 0.03,
    1.0,
    cos(p.y * 1.9 + t * 0.9) * 0.07 + sin(p.x * 2.7 - t) * 0.05 + cos((p.x - p.y) * 3.3 - t * 0.6) * 0.03));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 L = normalize(vec3(0.5, 0.8, 0.3));
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 70.0);
  vec3 col = mix(uColor, vec3(0.72, 0.86, 0.95), fres * 0.65) + spec * 0.55;
  gl_FragColor = vec4(col, clamp(uOpacity + fres * 0.3 + spec * 0.3, 0.0, 0.95));
  #include <colorspace_fragment>
}
`;

/** Translucent water surface with animated normals and a Fresnel term. */
export function createWaterMaterial(color: string, opacity = 0.62): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
    },
  });
}
