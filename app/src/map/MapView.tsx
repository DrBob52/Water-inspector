import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { api, type ApiError } from '../lib/api';
import { queryClient, useDemoList, useHealth, useIdentity } from '../lib/queries';
import { useUi } from '../store';
import { DEMO, OFFLINE_TILES } from '../env';
import { registerFlatDemProtocol } from './flatDem';
import { BASEMAP_WATER_LAYERS, DEMO_WATER_LAYER, demTiles, mapStyle } from './style';
import { mapApi } from './mapApi';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const US_CENTER: [number, number] = [-98.5, 39.5];

async function loadMapLib() {
  const m = await import('maplibre-gl');
  const lib = (m as unknown as { default?: typeof m }).default ?? m;
  if (OFFLINE_TILES)
    registerFlatDemProtocol(lib as unknown as Parameters<typeof registerFlatDemProtocol>[0]);
  return lib;
}

export function MapView() {
  const mapRef = useRef<MapRef>(null);
  const selectedId = useUi((s) => s.selectedId);
  const select = useUi((s) => s.select);
  const showToast = useUi((s) => s.showToast);
  const view = useUi((s) => s.view);
  const identity = useIdentity(selectedId);
  const health = useHealth();
  const demoList = useDemoList();
  const [hover, setHover] = useState<Feature<Geometry> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mapLib = useMemo(() => loadMapLib(), []);
  const demoMode = DEMO || health.data?.demo === true;

  // Fit the camera to the selected waterbody once its geometry is known.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const ident = identity.data?.identity;
    if (ident && loaded && fitted.current !== ident.id) {
      fitted.current = ident.id;
      mapApi.fitBounds(ident.bbox);
    }
  }, [identity.data, loaded]);

  const selectedFc: FeatureCollection = useMemo(() => {
    const g = identity.data?.identity.geometry;
    return g
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: g }] }
      : EMPTY;
  }, [identity.data]);
  const hoverFc: FeatureCollection = useMemo(
    () => (hover ? { type: 'FeatureCollection', features: [hover] } : EMPTY),
    [hover],
  );

  const resolveAt = useCallback(
    async (lon: number, lat: number) => {
      try {
        const res = await api.identityAt(lon, lat);
        queryClient.setQueryData(['identity', res.identity.id], res);
        select(res.identity.id);
      } catch (e) {
        const err = e as ApiError;
        if (err.code === 'demo_mode') showToast('Live data is off in demo mode');
        else if (err.status === 404)
          showToast('No mapped waterbody here. Try clicking directly on a lake or river.');
        else showToast(`Could not look up this location: ${err.message}`);
        window.setTimeout(() => useUi.getState().showToast(null), 4000);
      }
    },
    [select, showToast],
  );

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (useUi.getState().view !== 'map') return;
      void resolveAt(e.lngLat.lng, e.lngLat.lat);
    },
    [resolveAt],
  );

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const layers = [DEMO_WATER_LAYER, ...BASEMAP_WATER_LAYERS].filter((l) => map.getLayer(l));
    if (!layers.length) return;
    const f = map.queryRenderedFeatures(e.point, { layers })[0];
    map.getCanvas().style.cursor = f ? 'pointer' : '';
    setHover((prev) => {
      if (!f) return prev ? null : prev;
      if (prev && prev.id === f.id && prev.properties?.name === f.properties?.name) return prev;
      return { type: 'Feature', id: f.id, properties: {}, geometry: f.geometry };
    });
  }, []);

  useEffect(() => () => mapApi.register(null), []);

  return (
    <div
      className="map-layer"
      style={{ visibility: view === 'map' ? 'visible' : 'hidden' }}
      data-testid="map-layer"
      data-loaded={loaded ? 'true' : 'false'}
    >
      <MapGL
        ref={mapRef}
        mapLib={mapLib}
        initialViewState={{
          longitude: US_CENTER[0],
          latitude: US_CENTER[1],
          zoom: 3.6,
          pitch: 50,
          bearing: 0,
        }}
        maxPitch={80}
        mapStyle={mapStyle}
        terrain={{ source: 'terrain-dem', exaggeration: 1.4 }}
        onLoad={(e) => {
          mapApi.register(e.target);
          setLoaded(true);
        }}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseOut={() => setHover(null)}
        attributionControl={{ compact: true }}
        reuseMaps={false}
        style={{ width: '100%', height: '100%' }}
        canvasContextAttributes={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <Source
          id="terrain-dem"
          type="raster-dem"
          tiles={demTiles}
          tileSize={256}
          encoding="terrarium"
          maxzoom={OFFLINE_TILES ? 4 : 12}
        />
        {demoMode && (
          <Source id="demo-waterbodies" type="geojson" data="/api/demo/waterbodies.geojson">
            <Layer
              id={DEMO_WATER_LAYER}
              type="fill"
              paint={{ 'fill-color': '#2f8fb3', 'fill-opacity': 0.55 }}
            />
            <Layer
              id="demo-water-line"
              type="line"
              paint={{ 'line-color': '#0b5d78', 'line-width': 1.4 }}
            />
          </Source>
        )}
        <Source id="hover" type="geojson" data={hoverFc}>
          <Layer
            id="hover-fill"
            type="fill"
            paint={{ 'fill-color': '#ffb703', 'fill-opacity': 0.4 }}
          />
          <Layer id="hover-line" type="line" paint={{ 'line-color': '#ffb703', 'line-width': 2 }} />
        </Source>
        <Source id="selected" type="geojson" data={selectedFc}>
          <Layer
            id="selected-fill"
            type="fill"
            paint={{ 'fill-color': '#e8590c', 'fill-opacity': 0.12 }}
          />
          <Layer
            id="selected-line"
            type="line"
            paint={{ 'line-color': '#e8590c', 'line-width': 3 }}
          />
        </Source>
        {demoMode &&
          demoList.data?.map((w) => (
            <Marker key={w.id} longitude={w.centroid[0]} latitude={w.centroid[1]} anchor="center">
              <button
                type="button"
                className="marker-btn"
                data-testid={`marker-${w.slug}`}
                data-selected={selectedId === w.id}
                aria-label={`Open ${w.name}`}
                title={w.name}
                onClick={(ev) => {
                  ev.stopPropagation();
                  select(w.id);
                  fitted.current = null;
                }}
              >
                ≈
              </button>
            </Marker>
          ))}
        <NavigationControl position="bottom-right" visualizePitch />
      </MapGL>
    </div>
  );
}
