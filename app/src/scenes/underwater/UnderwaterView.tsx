import { useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import type { ToneMappingMode } from 'postprocessing';
import { Color } from 'three';
import { SceneBadges } from '../common/Badges';
import { SceneCanvas, useRenderQuality } from '../common/SceneCanvas';
import type { SceneViewProps } from '../types';
import { useUi } from '../../store';
import { Bed } from './Bed';
import { CameraRig } from './CameraRig';
import { Particles } from './Particles';
import { Plants } from './Plants';
import { Rocks } from './Rocks';
import { Critters, Fish, type HoverInfo } from './Schools';
import { Backdrop, LightShafts, Surface } from './Surface';
import { createWaterUniforms, type WaterUniforms } from './water';
import { FISH_VISUAL_SCALE, buildWorld, particleBudget } from './world';

/** Drives the shared water clock (caustics, surface ripples, shafts). */
function WaterClock({ water, reducedMotion }: { water: WaterUniforms; reducedMotion: boolean }) {
  useFrame((state) => {
    // Under reduced motion the light patterns hold still.
    water.uWaterTime.value = reducedMotion ? 7 : state.clock.elapsedTime;
  });
  return null;
}

/** postprocessing's ToneMappingMode.ACES_FILMIC (the package is a transitive dependency only). */
const ACES_FILMIC = 6 as ToneMappingMode;

/** Soft bloom on the shafts, surface and caustics, a vignette, and filmic tone mapping. */
function Effects({ clarity }: { clarity: number }) {
  const quality = useRenderQuality();
  const gl = useThree((s) => s.gl);
  // Software rasterisers (SwiftShader, llvmpipe) get no MSAA and a shorter bloom chain.
  const software = useMemo(() => {
    try {
      const ctx = gl.getContext();
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software/i.test(name);
    } catch {
      return false;
    }
  }, [gl]);
  const full = quality >= 0.7 && !software;
  return (
    <EffectComposer multisampling={quality >= 0.9 && !software ? 4 : 0}>
      <Bloom
        intensity={0.45 + 0.35 * clarity}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.35}
        mipmapBlur
        radius={0.78}
        levels={full ? 7 : 4}
      />
      <ToneMapping mode={ACES_FILMIC} />
      <Vignette offset={0.34} darkness={0.5} eskil={false} />
    </EffectComposer>
  );
}

export function UnderwaterView({ model, reducedMotion }: SceneViewProps) {
  const world = useMemo(() => buildWorld(model), [model]);
  const water = useMemo(() => createWaterUniforms(world), [world]);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [free, setFree] = useState(false);
  const highlight = useUi((s) => s.highlightSpecies);
  const highlightSpecies = useUi((s) => s.highlight);
  const actor = hover ? model.actors[hover.actor] : null;
  const o = world.optics;
  const background = useMemo(
    () => `#${new Color(o.horizon[0], o.horizon[1], o.horizon[2]).getHexString()}`,
    [o],
  );
  const budget = particleBudget(model);
  const ntu = model.turbidityNtu ?? 1;
  const chl = model.chlorophyllUgL ?? 1;
  const silt = Math.min(1, ntu / 12);
  const algae = Math.min(1, chl / 30);
  const highlighted = highlight
    ? model.actors.find((a) => a.scientificName === highlight)
    : undefined;
  const fishTotal = model.actors.reduce((s, a) => s + a.count, 0);
  // Boulder density per square metre of arena; soft mud buries most of them.
  const b = world.bounds;
  const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
  const rockCount = Math.round(Math.max(5, Math.min(70, area * 0.012)) * (silt > 0.8 ? 0.5 : 1));

  return (
    <>
      <SceneCanvas
        view="underwater"
        cameraPosition={[world.curve.points[0].x, world.curve.points[0].y, world.curve.points[0].z]}
        fov={62}
        near={0.05}
        far={400}
        background={background}
        reducedMotion={reducedMotion}
        dataAttrs={{
          species: model.actors.length,
          animals: fishTotal,
          visibility: model.visibilityM,
        }}
      >
        <WaterClock water={water} reducedMotion={reducedMotion} />
        <Backdrop water={water} />
        <Surface water={water} clarity={o.clarity} />
        <Bed world={world} water={water} silt={silt} algae={algae} />
        <Rocks world={world} water={water} algae={algae} rockCount={rockCount} />
        <Plants
          world={world}
          water={water}
          plantSpecies={model.plantCount}
          reducedMotion={reducedMotion}
        />
        <Fish
          model={model}
          world={world}
          water={water}
          reducedMotion={reducedMotion}
          highlight={highlight}
          onHover={setHover}
        />
        <Critters
          model={model}
          world={world}
          water={water}
          reducedMotion={reducedMotion}
          highlight={highlight}
          onHover={setHover}
        />
        <LightShafts
          water={water}
          length={o.shaftLength}
          intensity={o.shaftIntensity}
          visibility={world.renderVisibility}
        />
        <Particles
          water={water}
          count={budget.sediment}
          box={budget.box}
          color="#e2dccb"
          size={0.018}
          opacity={0.75}
          sink={0.012}
          glint={1.6}
          seed={1}
          reducedMotion={reducedMotion}
        />
        <Particles
          water={water}
          count={budget.algae}
          box={budget.box}
          color="#7fc25a"
          size={0.022}
          opacity={0.8}
          sink={0.003}
          glint={0.4}
          seed={2}
          reducedMotion={reducedMotion}
        />
        <CameraRig world={world} freeSwim={free} reducedMotion={reducedMotion} />
        <Effects clarity={o.clarity} />
      </SceneCanvas>
      <SceneBadges demo={model.demo} depthEstimated={model.depthEstimated} />
      <div
        className="scene-controls"
        data-testid="underwater-controls"
        // Stay in the visible stage so the highlight chip wraps rather than sliding under the panel.
        style={{ maxWidth: 'calc(100% - var(--stage-right) - 28px)' }}
      >
        <button
          type="button"
          className="btn"
          aria-pressed={free}
          onClick={() => setFree((f) => !f)}
        >
          Free swim
        </button>
        <span className="text-xs">
          {free
            ? 'W A S D to move, Q and E for down and up, drag to look.'
            : 'Drag to look around.'}{' '}
          Fish are drawn {FISH_VISUAL_SCALE}x their typical length so small species stay visible.
        </span>
        {highlight && (
          <span className="chip chip-accent" data-testid="highlight-chip">
            Highlighting {highlighted ? highlighted.label : highlight}
            {!highlighted && ' (not shown in this scene)'}
            <button
              type="button"
              className="btn"
              style={{ padding: '0 6px' }}
              onClick={() => highlightSpecies(null)}
              aria-label="Clear highlight"
            >
              ×
            </button>
          </span>
        )}
      </div>
      {actor && hover && (
        <div
          className="scene-card"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 280),
            top: hover.y + 14,
            position: 'fixed',
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
    </>
  );
}
