import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { BASEMAP_WATER_LAYERS, OFFLINE_STYLE, SATELLITE_STYLE } from './style';

describe('map styles', () => {
  it('the satellite style is valid against the MapLibre style spec', () => {
    expect(validateStyleMin(SATELLITE_STYLE).map((e) => e.message)).toEqual([]);
  });
  it('the offline style is valid and makes no third-party requests', () => {
    expect(validateStyleMin(OFFLINE_STYLE).map((e) => e.message)).toEqual([]);
    expect(JSON.stringify(OFFLINE_STYLE)).not.toMatch(/https?:/);
  });
  it('keeps the water layer ids used for hover hit-testing', () => {
    const ids = SATELLITE_STYLE.layers.map((l) => l.id);
    for (const id of BASEMAP_WATER_LAYERS) expect(ids).toContain(id);
  });
});
