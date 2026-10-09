import type { Map as MlMap } from 'maplibre-gl';

/** Small bridge so UI outside the map component (search, selection) can move the camera. */
let map: MlMap | null = null;

export const mapApi = {
  register(m: MlMap | null) {
    map = m;
  },
  get map() {
    return map;
  },
  fitBounds(bbox: [number, number, number, number], opts: { rightPadding?: number } = {}) {
    if (!map) return;
    const narrow = window.innerWidth <= 720;
    map.fitBounds(bbox, {
      padding: {
        top: 100,
        left: 40,
        bottom: narrow ? 340 : 60,
        right: narrow ? 40 : (opts.rightPadding ?? 480),
      },
      maxZoom: 13,
      duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1400,
    });
  },
  flyTo(lon: number, lat: number, zoom = 9) {
    if (!map) return;
    map.flyTo({
      center: [lon, lat],
      zoom,
      duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1400,
    });
  },
};
