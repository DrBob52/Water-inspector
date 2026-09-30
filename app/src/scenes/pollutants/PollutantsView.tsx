import { useEffect, useMemo, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { PARAMETERS, formatValue, type StationInfo } from '@wi/shared';
import { SceneBadges } from '../common/Badges';
import { FitCamera } from '../common/FitCamera';
import { SceneCanvas, useRenderQuality } from '../common/SceneCanvas';
import { useDem } from '../../lib/queries';
import { formatDate } from '../../lib/format';
import { useUi } from '../../store';
import type { SceneViewProps } from '../types';
import { DioramaMesh } from '../raised/DioramaMesh';
import { StationCard } from '../raised/RaisedView';
import { buildDiorama } from '../raised/diorama';
import { POLLUTANT_COLORS } from './density';
import { PollutantParticles } from './PollutantParticles';

function Glow() {
  const q = useRenderQuality();
  if (q < 0.6) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
    </EffectComposer>
  );
}

export default function PollutantsView({ model, reducedMotion, quality }: SceneViewProps) {
  const id = useUi((s) => s.selectedId);
  const demQ = useDem(id);
  const dio = useMemo(
    () => (demQ.isLoading ? null : buildDiorama(model, demQ.data ?? null)),
    [model, demQ.data, demQ.isLoading],
  );
  const [exag, setExag] = useState(1);
  const [station, setStation] = useState<StationInfo | null>(null);
  useEffect(() => {
    if (dio) setExag(dio.autoExaggeration);
  }, [dio]);
  if (!dio)
    return (
      <div role="status" className="grid h-full place-items-center" style={{ color: '#cfe6ee' }}>
        Loading terrain…
      </div>
    );
  const long = Math.max(dio.widthU, dio.heightU);
  const measuredKeys = new Set(model.pollutants.map((p) => p.key));
  const unmeasured = model.listedImpairments.filter(
    (c) => !c.measuredKey || !measuredKeys.has(c.measuredKey),
  );
  const total = model.pollutants.length;

  return (
    <>
      <SceneCanvas
        view="pollutants"
        cameraPosition={[0, long * 0.72, long * 0.95]}
        fov={40}
        far={2000}
        dataAttrs={{ pollutants: total }}
      >
        <hemisphereLight args={['#9db8d8', '#2a2a24', 0.55]} />
        <directionalLight position={[60, 110, 50]} intensity={1.4} />
        <DioramaMesh
          model={model}
          dio={dio}
          exaggeration={exag}
          showWater
          waterOpacity={0.1}
          showContours={false}
          reducedMotion={reducedMotion}
          selectedStation={station?.id ?? null}
          onStation={setStation}
        />
        <PollutantParticles
          model={model}
          dio={dio}
          exaggeration={exag}
          reducedMotion={reducedMotion}
        />
        <FitCamera width={dio.widthU} depth={dio.heightU} height={dio.maxDepthU * exag} />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI / 2 - 0.06}
          minDistance={long * 0.25}
          maxDistance={long * 3}
        />
        <Glow />
      </SceneCanvas>
      <SceneBadges demo={model.demo} depthEstimated={model.depthEstimated} />
      <div className="legend" data-testid="pollutant-legend" aria-label="Pollutant legend">
        <strong>Pollutants</strong>
        <div style={{ color: 'var(--muted)' }}>
          Particle density follows value divided by the screening threshold (log scale). Particles
          are an illustration of relative level, not of where a pollutant is.
        </div>
        {total === 0 ? (
          <p className="m-0 mt-2" data-testid="no-pollutants">
            No pollutant measurements with a screening reference were found for this waterbody, so
            the volume is shown empty. Nothing is drawn where there is no data.
          </p>
        ) : (
          <ul className="m-0 mt-2 list-none p-0">
            {model.pollutantDetails.map((p, i) => {
              const over = p.ratio > 1;
              return (
                <li key={p.key} className="mb-2" data-testid={`pollutant-${p.key}`}>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        background: POLLUTANT_COLORS[i % POLLUTANT_COLORS.length],
                        display: 'inline-block',
                        animation: over && !reducedMotion ? 'pulse 2s infinite' : undefined,
                      }}
                    />
                    <strong>{p.label}</strong>
                    {over && <span className="chip chip-bad">▲ Above screening reference</span>}
                  </div>
                  <div className="text-xs">
                    Latest {formatValue(p.key, p.value)} {p.unit} ({formatDate(p.date)}). Threshold{' '}
                    {p.threshold} {PARAMETERS[p.key].unit}, ratio{' '}
                    {p.ratio >= 10 ? p.ratio.toFixed(0) : p.ratio.toFixed(p.ratio < 0.1 ? 3 : 2)}x.
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {unmeasured.length > 0 && (
          <div className="mt-2" data-testid="listed-impairments">
            <strong>Listed impairments</strong>
            <ul className="m-0 list-none p-0 text-xs">
              {unmeasured.map((c) => (
                <li key={c.name}>
                  {c.name}:{' '}
                  {c.measuredKey
                    ? 'listed impairment; measured, but there is no screening threshold to compare (no particles)'
                    : 'listed impairment, no recent measurement (no particles)'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {station && (
        <StationCard station={station} quality={quality} onClose={() => setStation(null)} />
      )}
    </>
  );
}
