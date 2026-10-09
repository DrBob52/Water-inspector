import { useEffect, useMemo, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { formatValue, type PollutantDetail, type StationInfo } from '@wi/shared';
import { SceneBadges } from '../common/Badges';
import { FitCamera } from '../common/FitCamera';
import { SceneCanvas } from '../common/SceneCanvas';
import { useDem } from '../../lib/queries';
import { formatDate } from '../../lib/format';
import { useUi } from '../../store';
import type { SceneViewProps } from '../types';
import { DioramaMesh } from '../raised/DioramaMesh';
import { StationCard } from '../raised/StationCard';
import { DioramaStage, lightRig, useFrameAzimuth } from '../raised/Stage';
import { blockExtent, buildDiorama } from '../raised/diorama';
import { pollutantLayers, ratioBar, type PollutantLayer } from './density';
import { PollutantParticles } from './PollutantParticles';

const LEGEND_MARGINS = { left: 350, right: 28, top: 72, bottom: 40 };

const formatRatio = (r: number) => r.toFixed(r >= 10 ? 0 : r < 0.1 ? 3 : 2);

function LegendRow({
  detail,
  layer,
  reducedMotion,
}: {
  detail: PollutantDetail;
  layer: PollutantLayer | undefined;
  reducedMotion: boolean;
}) {
  const over = detail.ratio > 1;
  const color = layer?.color ?? 'var(--muted)';
  const sites = layer?.sources.length ?? 0;
  return (
    <li
      className="py-2.5"
      style={{ borderTop: '1px solid var(--line)' }}
      data-testid={`pollutant-${detail.key}`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            flex: '0 0 auto',
            background: color,
            boxShadow: `0 0 ${over ? 10 : 6}px ${color}`,
            opacity: over ? 1 : 0.75,
            animation: over && !reducedMotion ? 'pulse 4s ease-in-out infinite' : undefined,
          }}
        />
        <strong className="text-[13px]">{detail.label}</strong>
        <span
          className="tnum ml-auto text-[12.5px] font-semibold"
          style={{ color: over ? 'var(--bad)' : 'var(--text-2)' }}
          title="Latest value divided by the screening threshold"
        >
          {formatRatio(detail.ratio)}×
        </span>
      </div>
      <div
        className="relative mt-2 h-[5px] rounded-full"
        style={{ background: 'rgba(150, 205, 222, 0.1)' }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(2, ratioBar(detail.ratio) * 100)}%`,
            background: `linear-gradient(90deg, transparent, ${color})`,
            opacity: over ? 1 : 0.7,
          }}
        />
        <div
          className="absolute -inset-y-[3px] left-1/2 w-px"
          style={{ background: 'var(--text-2)', opacity: 0.6 }}
        />
      </div>
      <div className="tnum mt-1.5 text-xs" style={{ color: 'var(--text-2)' }}>
        Latest <strong>{formatValue(detail.key, detail.value)}</strong> {detail.unit}
        <span style={{ color: 'var(--muted)' }}> · </span>
        Threshold {detail.threshold} {detail.unit}
      </div>
      <div
        className="tnum mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
        style={{ color: 'var(--muted)' }}
      >
        {over && <span className="chip chip-bad">▲ Above screening reference</span>}
        <span>
          {formatDate(detail.date)} ·{' '}
          {sites > 0 ? `${sites} ${sites === 1 ? 'site' : 'sites'}` : 'no site positions'}
        </span>
      </div>
    </li>
  );
}

export default function PollutantsView({ model, reducedMotion, quality }: SceneViewProps) {
  const id = useUi((s) => s.selectedId);
  const demQ = useDem(id);
  const dio = useMemo(
    () => (demQ.isLoading ? null : buildDiorama(model, demQ.data ?? null)),
    [model, demQ.data, demQ.isLoading],
  );
  const layers = useMemo(() => pollutantLayers(model, quality), [model, quality]);
  const [exag, setExag] = useState(1);
  const [station, setStation] = useState<StationInfo | null>(null);
  const { azimuth, onFrame } = useFrameAzimuth();
  const glint = useMemo(() => lightRig(azimuth).glint, [azimuth]);
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
  const ext = blockExtent(dio, exag);
  const measuredKeys = new Set(model.pollutants.map((p) => p.key));
  const unmeasured = model.listedImpairments.filter(
    (c) => !c.measuredKey || !measuredKeys.has(c.measuredKey),
  );
  const total = model.pollutants.length;
  const overCount = model.pollutants.filter((p) => p.ratio > 1).length;

  return (
    <>
      <SceneCanvas
        view="pollutants"
        cameraPosition={[0, long * 0.72, long * 0.95]}
        fov={38}
        far={4000}
        reducedMotion={reducedMotion}
        dataAttrs={{ pollutants: total }}
      >
        <DioramaStage azimuth={azimuth} radius={long * 0.75} mood="night" />
        <DioramaMesh
          model={model}
          dio={dio}
          exaggeration={exag}
          showWater
          waterStyle="dark"
          showContours={false}
          reducedMotion={reducedMotion}
          glint={glint}
          selectedStation={station?.id ?? null}
          onStation={setStation}
        />
        <PollutantParticles
          layers={layers}
          dio={dio}
          exaggeration={exag}
          reducedMotion={reducedMotion}
        />
        <FitCamera
          width={ext.width}
          depth={ext.depth}
          top={ext.top}
          bottom={ext.bottom}
          margins={LEGEND_MARGINS}
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
      <div className="legend" data-testid="pollutant-legend" aria-label="Pollutant legend">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.11em]"
            style={{ color: 'var(--accent)' }}
          >
            Pollutants
          </span>
          {total > 0 && (
            <span className="tnum text-[11px]" style={{ color: 'var(--muted)' }}>
              {total} measured{overCount > 0 ? ` · ${overCount} above` : ''}
            </span>
          )}
        </div>
        <p className="m-0 mt-1.5 text-xs leading-relaxed">
          Each plume sits at a site that measured the pollutant. Density follows value over
          screening threshold (log scale); plumes above it pulse. They show where samples were
          taken, not how far a pollutant spreads.
        </p>
        {total === 0 ? (
          <p className="m-0 mt-3 text-[13px]" data-testid="no-pollutants">
            No pollutant measurements with a screening reference were found for this waterbody, so
            the volume is shown empty. Nothing is drawn where there is no data.
          </p>
        ) : (
          <>
            <ul className="m-0 mt-2 list-none p-0">
              {model.pollutantDetails.map((p) => (
                <LegendRow
                  key={p.key}
                  detail={p}
                  layer={layers.find((l) => l.key === p.key)}
                  reducedMotion={reducedMotion}
                />
              ))}
            </ul>
            <div
              className="tnum flex justify-between text-[10.5px]"
              style={{ color: 'var(--muted)' }}
              aria-hidden="true"
            >
              <span>0.01×</span>
              <span>threshold</span>
              <span>100×</span>
            </div>
          </>
        )}
        {unmeasured.length > 0 && (
          <div
            className="mt-3 pt-2.5"
            style={{ borderTop: '1px solid var(--line)' }}
            data-testid="listed-impairments"
          >
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: 'var(--muted)' }}
            >
              Listed impairments
            </div>
            <ul className="m-0 mt-1 list-none p-0 text-xs">
              {unmeasured.map((c) => (
                <li key={c.name} className="flex gap-2 py-0.5">
                  <span
                    aria-hidden="true"
                    className="mt-[5px]"
                    style={{
                      width: 8,
                      height: 8,
                      flex: '0 0 auto',
                      borderRadius: 4,
                      border: '1px solid var(--muted)',
                    }}
                  />
                  <span>
                    <strong className="font-medium">{c.name}</strong>:{' '}
                    {c.measuredKey
                      ? 'listed impairment; measured, but there is no screening threshold to compare (no particles)'
                      : 'listed impairment, no recent measurement (no particles)'}
                  </span>
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
