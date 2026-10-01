import { useMemo, useState } from 'react';
import { Color } from 'three';
import { SceneBadges } from '../common/Badges';
import { SceneCanvas } from '../common/SceneCanvas';
import type { SceneViewProps } from '../types';
import { useUi } from '../../store';
import { Bed } from './Bed';
import { CameraRig } from './CameraRig';
import { Particles } from './Particles';
import { Plants } from './Plants';
import { Critters, Fish, type HoverInfo } from './Schools';
import { LightShafts, Surface } from './Surface';
import { FISH_VISUAL_SCALE, buildWorld } from './world';

const SEDIMENT_DEPTH: [number, number] = [0.6, 12];

export function UnderwaterView({ model, reducedMotion }: SceneViewProps) {
  const world = useMemo(() => buildWorld(model), [model]);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [free, setFree] = useState(false);
  const highlight = useUi((s) => s.highlightSpecies);
  const highlightSpecies = useUi((s) => s.highlight);
  const actor = hover ? model.actors[hover.actor] : null;
  const fogColor = useMemo(
    () => `#${new Color(model.waterTint).lerp(new Color('#8cc8e6'), 0.3).getHexString()}`,
    [model.waterTint],
  );
  const background = useMemo(
    () => `#${new Color(fogColor).multiplyScalar(0.95).getHexString()}`,
    [fogColor],
  );
  const sediment = Math.round(Math.min(1200, 120 + (model.turbidityNtu ?? 2) * 30));
  const algae = Math.round(Math.min(700, (model.chlorophyllUgL ?? 1) * 14));
  const highlighted = highlight
    ? model.actors.find((a) => a.scientificName === highlight)
    : undefined;
  const fishTotal = model.actors.reduce((s, a) => s + a.count, 0);

  return (
    <>
      <SceneCanvas
        view="underwater"
        cameraPosition={[5, -2, 0]}
        fov={70}
        far={400}
        background={background}
        reducedMotion={reducedMotion}
        dataAttrs={{
          species: model.actors.length,
          animals: fishTotal,
          visibility: model.visibilityM,
        }}
      >
        <fogExp2 attach="fog" args={[fogColor, world.fogDensity]} />
        <hemisphereLight args={['#cfeaff', '#2a3a38', 0.9]} />
        <directionalLight position={[10, 40, 6]} intensity={1.4} />
        <Bed world={world} fogColor={fogColor} reducedMotion={reducedMotion} />
        <Surface
          fogColor={fogColor}
          fogDensity={world.fogDensity}
          reducedMotion={reducedMotion}
          visibilityM={model.visibilityM}
        />
        <LightShafts
          visibilityM={model.visibilityM}
          reducedMotion={reducedMotion}
          tint={fogColor}
        />
        <Particles
          count={sediment}
          color="#d9cfae"
          size={0.06}
          opacity={0.5}
          seed={1}
          reducedMotion={reducedMotion}
          depthRange={SEDIMENT_DEPTH}
        />
        <Particles
          count={algae}
          color="#8fd17a"
          size={0.05}
          opacity={0.6}
          seed={2}
          reducedMotion={reducedMotion}
          depthRange={[0.3, 6]}
        />
        <Plants
          world={world}
          plantSpecies={model.plantCount}
          fogColor={fogColor}
          reducedMotion={reducedMotion}
        />
        <Fish
          model={model}
          world={world}
          fogColor={fogColor}
          reducedMotion={reducedMotion}
          highlight={highlight}
          onHover={setHover}
        />
        <Critters
          model={model}
          world={world}
          reducedMotion={reducedMotion}
          highlight={highlight}
          onHover={setHover}
        />
        <CameraRig world={world} freeSwim={free} reducedMotion={reducedMotion} />
      </SceneCanvas>
      <SceneBadges demo={model.demo} depthEstimated={model.depthEstimated} />
      <div className="scene-controls" data-testid="underwater-controls">
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
