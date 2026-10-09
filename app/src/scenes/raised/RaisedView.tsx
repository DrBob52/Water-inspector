import { useEffect, useMemo, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import type { StationInfo } from '@wi/shared';
import { SceneBadges } from '../common/Badges';
import { FitCamera } from '../common/FitCamera';
import { SceneCanvas } from '../common/SceneCanvas';
import { useDem } from '../../lib/queries';
import { useUi } from '../../store';
import type { SceneViewProps } from '../types';
import { DioramaMesh } from './DioramaMesh';
import { MAX_EXAGGERATION, MIN_EXAGGERATION, blockExtent, buildDiorama } from './diorama';
import { DioramaStage, lightRig, useFrameAzimuth } from './Stage';
import { StationCard } from './StationCard';

export { StationCard, stationReadings } from './StationCard';

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
  const { azimuth, onFrame } = useFrameAzimuth();
  const glint = useMemo(() => lightRig(azimuth).glint, [azimuth]);
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
  const ext = blockExtent(dio, exag);
  return (
    <>
      <SceneCanvas
        view="raised"
        cameraPosition={[0, long * 0.72, long * 0.95]}
        fov={38}
        far={4000}
        reducedMotion={reducedMotion}
        dataAttrs={{ exaggeration: exag.toFixed(1), water: showWater }}
      >
        <DioramaStage azimuth={azimuth} radius={long * 0.75} />
        <DioramaMesh
          model={model}
          dio={dio}
          exaggeration={exag}
          showWater={showWater}
          reducedMotion={reducedMotion}
          glint={glint}
          selectedStation={station?.id ?? null}
          onStation={setStation}
        />
        <FitCamera
          width={ext.width}
          depth={ext.depth}
          top={ext.top}
          bottom={ext.bottom}
          onFrame={onFrame}
        />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI / 2 - 0.08}
          minDistance={long * 0.25}
          maxDistance={long * 4}
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
          <output data-testid="exaggeration-value" className="tnum">
            {exag.toFixed(1)}x
          </output>
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
          Contours every {dio.contourInterval} m. Drag to orbit, scroll to zoom. Click a beacon for
          readings.
        </span>
      </div>
      {station && (
        <StationCard station={station} quality={quality} onClose={() => setStation(null)} />
      )}
    </>
  );
}
