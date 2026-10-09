import { Color, Vector3, type IUniform } from 'three';
import type { World } from './world';

/** Shared uniform record for UNDERWATER_GLSL. Spread it into every underwater material. */
export type WaterUniforms = Record<string, IUniform>;

/** The sun's light direction under water (pointing down), refracted toward the vertical. */
export const SUN_DIR = new Vector3(0.32, -1, 0.18).normalize();

const col = (c: [number, number, number]) => new Color(c[0], c[1], c[2]);
const vec = (c: [number, number, number]) => new Vector3(c[0], c[1], c[2]);

export function createWaterUniforms(world: World): WaterUniforms {
  const o = world.optics;
  return {
    uWaterUp: { value: col(o.up) },
    uWaterHorizon: { value: col(o.horizon) },
    uWaterDeep: { value: col(o.deep) },
    uExtinction: { value: vec(o.extinction) },
    uFogTint: { value: vec(o.fogTint) },
    uFogDensity: { value: world.fogDensity },
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: col(o.sunColor) },
    uCausticStrength: { value: o.causticStrength },
    uCausticMaxDepth: { value: o.causticMaxDepth },
    uWaterTime: { value: 0 },
    // Murky water glows from above more steeply: light scatters down from a bright ceiling.
    uUpExp: { value: 0.75 + 0.6 * o.clarity },
  };
}
