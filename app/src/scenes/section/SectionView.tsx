import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { formatDistanceKm, type SceneModel } from '@wi/shared';
import { SceneBadges } from '../common/Badges';
import { SceneCanvas } from '../common/SceneCanvas';
import type { SceneViewProps } from '../types';
import { DO_COLORS, lightModel, sectionProfile } from './section';
import { SECTION_FOV, SectionScene, type Chrome, type Hover } from './SectionScene';

const fmtM = (m: number, feet: boolean) => {
  const v = feet ? m * 3.28084 : m;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${feet ? 'ft' : 'm'}`;
};

const eyebrow = 'text-[10.5px] font-semibold uppercase tracking-[0.11em]';

function KeyRow({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 py-[3px]">
      <span className="mt-[3px] flex h-[10px] w-[22px] shrink-0 items-center justify-center">
        {swatch}
      </span>
      <span className="min-w-0 leading-[1.35]">{children}</span>
    </li>
  );
}

function Legend({
  model,
  lengthM,
  feet,
  legendRef,
}: {
  model: SceneModel;
  lengthM: number;
  feet: boolean;
  legendRef: RefObject<HTMLDivElement>;
}) {
  const sys = feet ? 'imperial' : 'metric';
  const light = lightModel(model.visibilityM);
  const hasDo = !!model.doProfile?.length;
  const lightToBed = light.photicM >= model.maxDepthM * 0.97;
  return (
    <div className="legend" data-testid="section-legend" ref={legendRef}>
      <div className={eyebrow} style={{ color: 'var(--muted)' }}>
        Cross-section · longest axis
      </div>
      <div className="tnum mt-1 text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
        {formatDistanceKm(lengthM / 1000, sys)} long
        <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · </span>
        {fmtM(model.maxDepthM, feet)} deep
      </div>
      <p className="m-0 mt-0.5 leading-[1.4]" style={{ color: 'var(--muted)' }}>
        Follows the deepest water. Bed shape modelled.
      </p>
      <ul
        className="m-0 mt-2.5 list-none border-t p-0 pt-2"
        style={{ borderColor: 'var(--line)', color: 'var(--text-2)' }}
      >
        <KeyRow
          swatch={
            <span
              className="block h-[10px] w-full rounded-[2px]"
              style={{ background: 'linear-gradient(180deg, #bfe9ef, #2a7b97 55%, #0b2a3a)' }}
            />
          }
        >
          {lightToBed ? (
            <>Light reaches the bed (visibility ~{fmtM(model.visibilityM, feet)})</>
          ) : (
            <>
              Photic zone, light to <span className="tnum">~{fmtM(light.photicM, feet)}</span>
            </>
          )}
        </KeyRow>
        {model.thermoclineM !== undefined && (
          <KeyRow
            swatch={
              <span
                className="block h-[2px] w-full"
                style={{ background: '#dff3f6', boxShadow: '0 0 6px 2px rgba(150,230,240,.45)' }}
              />
            }
          >
            Thermocline <span className="tnum">~{fmtM(model.thermoclineM, feet)}</span>
            <span style={{ color: 'var(--muted)' }}>
              {model.thermoclineEstimated ? ' · estimated' : ' · measured profile'}
            </span>
          </KeyRow>
        )}
        {hasDo ? (
          <li className="py-[3px]" data-testid="do-legend">
            <div>
              Dissolved oxygen
              {model.surfaceDoMgL !== undefined && (
                <span style={{ color: 'var(--muted)' }}>
                  {' '}
                  · surface <span className="tnum">{model.surfaceDoMgL.toFixed(1)}</span> mg/L
                </span>
              )}
            </div>
            <div className="tnum mt-1 flex items-center gap-3 text-[11px]">
              {(
                [
                  [DO_COLORS.low, 'below 2'],
                  [DO_COLORS.moderate, '2 to 5'],
                  [DO_COLORS.good, 'above 5 mg/L'],
                ] as const
              ).map(([c, t]) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-[8px] w-[8px] rounded-full"
                    style={{ background: c }}
                  />
                  {t}
                </span>
              ))}
            </div>
          </li>
        ) : (
          <li className="py-[3px]" data-testid="no-do-note">
            <span style={{ color: 'var(--text)' }}>No depth profile measured.</span>{' '}
            <span style={{ color: 'var(--muted)' }}>
              {model.surfaceDoMgL !== undefined
                ? `Surface dissolved oxygen: ${model.surfaceDoMgL.toFixed(1)} mg/L.`
                : 'No dissolved oxygen data.'}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

export default function SectionView({ model, reducedMotion, units }: SceneViewProps) {
  const prof = useMemo(() => sectionProfile(model), [model]);
  const [feet, setFeet] = useState(units === 'imperial');
  // Labels are DOM elements portalled into a container we own, so they unmount cleanly.
  const portalEl = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const [hover, setHover] = useState<Hover | null>(null);

  // The figure fills whatever the floating chrome leaves free: measure it.
  const [chrome, setChrome] = useState<Chrome>({ top: 64, bottom: 10000 });
  useLayoutEffect(() => {
    const root = portalEl.current?.parentElement;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      let top = 64;
      let bottom = box.height;
      const els = [
        legendRef.current,
        controlsRef.current,
        root.querySelector<HTMLElement>('[data-testid="scene-badges"]'),
        // On phones the inspector is a sheet over the lower part of the stage.
        box.width <= 720 ? document.querySelector<HTMLElement>('.panel-dock') : null,
      ];
      for (const el of els) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (!r.height) continue;
        const t = r.top - box.top;
        const b = r.bottom - box.top;
        if (t + r.height / 2 < box.height / 2) top = Math.max(top, b);
        else bottom = Math.min(bottom, t);
      }
      setChrome((c) =>
        Math.abs(c.top - top) < 1 && Math.abs(c.bottom - bottom) < 1 ? c : { top, bottom },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    if (legendRef.current) ro.observe(legendRef.current);
    if (controlsRef.current) ro.observe(controlsRef.current);
    const panel = document.querySelector<HTMLElement>('.panel-dock');
    if (panel) ro.observe(panel);
    return () => ro.disconnect();
  }, []);

  const actor = hover ? model.actors[hover.actor] : null;
  const hasDo = !!model.doProfile?.length;

  return (
    <>
      <div
        ref={portalEl}
        className="absolute inset-0"
        style={{ pointerEvents: 'none', zIndex: 7 }}
        aria-hidden="true"
      />
      <SceneCanvas
        view="section"
        cameraPosition={[0, 0, 2500]}
        fov={SECTION_FOV}
        near={10}
        far={20000}
        background="#040b10"
        reducedMotion={reducedMotion}
        dataAttrs={{
          do: hasDo,
          'length-km': (prof.lengthM / 1000).toFixed(1),
          thermocline: model.thermoclineM ?? 'none',
        }}
      >
        {portalReady && (
          <SectionScene
            model={model}
            prof={prof}
            feet={feet}
            chrome={chrome}
            reducedMotion={reducedMotion}
            portal={portalEl as RefObject<HTMLElement>}
            onHover={setHover}
          />
        )}
      </SceneCanvas>
      <SceneBadges demo={model.demo} depthEstimated={model.depthEstimated} />
      <Legend
        model={model}
        lengthM={prof.lengthM}
        feet={feet}
        legendRef={legendRef as RefObject<HTMLDivElement>}
      />
      <div className="scene-controls" data-testid="section-controls" ref={controlsRef}>
        <button
          type="button"
          className="btn"
          aria-pressed={feet}
          onClick={() => setFeet((f) => !f)}
        >
          {feet ? 'Feet and miles' : 'Metres and kilometres'}
        </button>
        <span className="flex items-center gap-1.5 text-[12px]">
          <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
            <ellipse cx="9" cy="5" rx="8" ry="4.2" fill="none" stroke="#ff9a3c" strokeWidth="1.4" />
          </svg>
          Introduced
        </span>
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Icons sized by records · drag to tilt
        </span>
      </div>
      {actor && hover && (
        <div
          className="scene-card"
          style={{
            position: 'fixed',
            left: Math.min(hover.x + 14, window.innerWidth - 280),
            top: hover.y + 14,
          }}
          data-testid="fish-card"
          role="status"
        >
          <strong>{actor.label}</strong>
          <div className="italic">{actor.scientificName}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className={`chip ${actor.introduced ? 'chip-watch' : 'chip-good'}`}>
              {actor.introduced ? 'Introduced' : 'Native'}
            </span>
            <span className="chip">{actor.recordCount.toLocaleString('en-US')} records</span>
          </div>
        </div>
      )}
      <span className="sr-only">{reducedMotion ? 'Reduced motion is on.' : ''}</span>
    </>
  );
}
