import { useEffect, useMemo, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { PARAMETERS, formatValue, type ParameterSummary, type StationInfo } from '@wi/shared';
import { SceneBadges } from '../common/Badges';
import { FitCamera } from '../common/FitCamera';
import { SceneCanvas } from '../common/SceneCanvas';
import { useDem } from '../../lib/queries';
import { formatDate } from '../../lib/format';
import { useUi } from '../../store';
import type { SceneViewProps } from '../types';
import { DioramaMesh } from './DioramaMesh';
import { MAX_EXAGGERATION, MIN_EXAGGERATION, buildDiorama } from './diorama';

/** Readings for a station pin: latest value per parameter measured there. */
export function stationReadings(station: StationInfo, quality: ParameterSummary[]) {
  return quality
    .map((p) => ({ p, r: p.latestByStation?.[station.id] }))
    .filter((x): x is { p: ParameterSummary; r: { value: number; date: string } } => !!x.r)
    .slice(0, 10);
}

export function StationCard({
  station,
  quality,
  onClose,
}: {
  station: StationInfo;
  quality: ParameterSummary[];
  onClose: () => void;
}) {
  const rows = stationReadings(station, quality);
  return (
    <div
      className="legend"
      style={{ left: 'auto', right: 12, top: 12, maxWidth: 300 }}
      data-testid="station-card"
      role="dialog"
      aria-label={`Station ${station.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <strong>{station.name}</strong>
        <button type="button" className="btn" onClick={onClose} aria-label="Close station card">
          ×
        </button>
      </div>
      <div style={{ color: 'var(--muted)' }}>{station.id}</div>
      {rows.length === 0 ? (
        <p className="m-0 mt-1">No recent readings at this station.</p>
      ) : (
        <ul className="m-0 mt-1 list-none p-0">
          {rows.map(({ p, r }) => (
            <li key={p.key} className="flex justify-between gap-2">
              <span>{PARAMETERS[p.key].label}</span>
              <span>
                <strong>{formatValue(p.key, r.value)}</strong> {p.unit}{' '}
                <span style={{ color: 'var(--muted)' }}>{formatDate(r.date)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RaisedView({ model, reducedMotion, quality }: SceneViewProps) {
  const id = useUi((s) => s.selectedId);
  const demQ = useDem(id);
  const dio = useMemo(
    () => (demQ.isLoading ? null : buildDiorama(model, demQ.data ?? null)),
    [model, demQ.data, demQ.isLoading],
  );
  const [auto, setAuto] = useState(true);
  const [exag, setExag] = useState(1);
  const [showWater, setShowWater] = useState(true);
  const [station, setStation] = useState<StationInfo | null>(null);
  useEffect(() => {
    if (dio && auto) setExag(dio.autoExaggeration);
  }, [dio, auto]);

  if (!dio)
    return (
      <div role="status" className="grid h-full place-items-center" style={{ color: '#cfe6ee' }}>
        Loading terrain…
      </div>
    );
  const long = Math.max(dio.widthU, dio.heightU);
  return (
    <>
      <SceneCanvas
        view="raised"
        cameraPosition={[0, long * 0.72, long * 0.95]}
        fov={40}
        far={2000}
        reducedMotion={reducedMotion}
        dataAttrs={{ exaggeration: exag.toFixed(1), water: showWater }}
      >
        <hemisphereLight args={['#c4dcff', '#3a2e22', 0.85]} />
        <directionalLight position={[60, 110, 50]} intensity={2.1} />
        <DioramaMesh
          model={model}
          dio={dio}
          exaggeration={exag}
          showWater={showWater}
          reducedMotion={reducedMotion}
          selectedStation={station?.id ?? null}
          onStation={setStation}
        />
        <FitCamera width={dio.widthU} depth={dio.heightU} height={dio.maxDepthU * exag} />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI / 2 - 0.06}
          minDistance={long * 0.25}
          maxDistance={long * 3}
          target={[0, 0, 0]}
        />
      </SceneCanvas>
      <SceneBadges demo={model.demo} depthEstimated={model.depthEstimated} />
      <div className="scene-controls" data-testid="raised-controls">
        <label className="flex items-center gap-2 text-sm">
          Vertical exaggeration
          <input
            type="range"
            min={MIN_EXAGGERATION}
            max={MAX_EXAGGERATION}
            step={0.5}
            value={exag}
            aria-label="Vertical exaggeration"
            onChange={(e) => {
              setAuto(false);
              setExag(Number(e.target.value));
            }}
          />
          <output data-testid="exaggeration-value">{exag.toFixed(1)}x</output>
        </label>
        <button type="button" className="btn" aria-pressed={auto} onClick={() => setAuto(true)}>
          Auto
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={showWater}
          onClick={() => setShowWater((w) => !w)}
        >
          {showWater ? 'Hide water' : 'Show water'}
        </button>
        <span className="text-xs">
          Contours every {dio.contourInterval} m. Drag to orbit, scroll to zoom. Click a pin for
          readings.
        </span>
      </div>
      {station && (
        <StationCard station={station} quality={quality} onClose={() => setStation(null)} />
      )}
    </>
  );
}
