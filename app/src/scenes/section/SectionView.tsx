import { useEffect, useMemo, useState } from 'react';
import { Html, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Shape, ShapeGeometry } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { formatDepth, formatDistanceKm, mToFt, type SceneActor, type SceneModel } from '@wi/shared';
import { SceneBadges } from '../common/Badges';
import { FitPanel } from '../common/FitCamera';
import { SceneCanvas } from '../common/SceneCanvas';
import { FISH_PARAMS, isFishArchetype } from '../fish/fishGeometry';
import { mulberry32 } from '../fish/boids';
import type { SceneViewProps } from '../types';
import {
  doAtDepth,
  doColor,
  gridMesh,
  niceStep,
  sectionProfile,
  type MeshData,
  type SectionProfile,
} from './section';

const PANEL_W = 100;
const PANEL_H = 26;
const SOIL = 7;
const Z = 1.5;

function toGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('color', new BufferAttribute(m.colors, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  return g;
}

const rgb = (c: Color): [number, number, number] => [c.r, c.g, c.b];

interface Geometries {
  waterFront: BufferGeometry;
  waterBack: BufferGeometry;
  doOverlay: BufferGeometry | null;
  thermo: BufferGeometry | null;
  soilFront: BufferGeometry;
  soilBack: BufferGeometry;
  surfaceTop: BufferGeometry;
  bedRibbon: BufferGeometry;
  sy: number;
  sx: number;
}

const BANDS = 24;

function build(model: SceneModel, prof: SectionProfile): Geometries {
  const N = prof.bins;
  const sy = PANEL_H / prof.maxDepthM;
  const sx = PANEL_W / prof.lengthM;
  const X = (i: number) => -PANEL_W / 2 + (i / (N - 1)) * PANEL_W;
  const tint = new Color(model.waterTint);
  const light = tint.clone().lerp(new Color('#9fd6f0'), 0.55);
  const dark = tint.clone().multiplyScalar(0.28);
  const tmp = new Color();
  const d = (i: number) => prof.depth[i];
  const waterColor = (depthM: number) =>
    rgb(tmp.copy(light).lerp(dark, 1 - Math.exp(-depthM / (prof.maxDepthM * 0.45))));
  const water = (z: number, flip: boolean) =>
    gridMesh(
      N,
      BANDS + 1,
      (i, j) => [X(i), -(j / BANDS) * d(i) * sy, z],
      (i, j) => waterColor((j / BANDS) * d(i)),
      flip,
    );
  const soilTop = new Color('#7a5e3c');
  const soilBottom = new Color('#2b2016');
  const soilBase = -PANEL_H - SOIL;
  const soil = (z: number, flip: boolean) =>
    gridMesh(
      N,
      4,
      (i, j) => {
        const top = -d(i) * sy;
        return [X(i), top + ((soilBase - top) * j) / 3, z];
      },
      (i, j) =>
        rgb(
          tmp
            .copy(soilTop)
            .lerp(soilBottom, j / 3)
            .multiplyScalar(0.9 + 0.1 * Math.sin(i * 0.4 + j)),
        ),
      flip,
    );

  let doOverlay: BufferGeometry | null = null;
  if (model.doProfile?.length) {
    doOverlay = toGeometry(
      gridMesh(
        N,
        BANDS + 1,
        (i, j) => [X(i), -(j / BANDS) * d(i) * sy, Z + 0.02],
        (i, j) => rgb(doColor(doAtDepth(model.doProfile!, (j / BANDS) * d(i)), tmp)),
        false,
      ),
    );
  }
  let thermo: BufferGeometry | null = null;
  if (model.thermoclineM !== undefined) {
    const w = Math.max(1.2, prof.maxDepthM * 0.04);
    const z0 = model.thermoclineM - w;
    const z1 = model.thermoclineM + w;
    thermo = toGeometry(
      gridMesh(
        N,
        2,
        (i, j) => [X(i), -Math.min(j === 0 ? z0 : z1, d(i)) * sy, Z + 0.04],
        () => [1, 0.85, 0.5],
        false,
      ),
    );
  }
  const surfaceTop = toGeometry(
    gridMesh(
      N,
      2,
      (i, j) => [X(i), 0, Z - j * 2 * Z],
      () => [0.75, 0.9, 1],
      false,
    ),
  );
  const bedRibbon = toGeometry(
    gridMesh(
      N,
      2,
      (i, j) => [X(i), -d(i) * sy, Z - j * 2 * Z],
      (i) => rgb(tmp.set('#8a7450').multiplyScalar(0.8 + 0.2 * Math.sin(i * 0.3))),
      true,
    ),
  );
  return {
    waterFront: toGeometry(water(Z, false)),
    waterBack: toGeometry(water(-Z, true)),
    doOverlay,
    thermo,
    soilFront: toGeometry(soil(Z, false)),
    soilBack: toGeometry(soil(-Z, true)),
    surfaceTop,
    bedRibbon,
    sy,
    sx,
  };
}

interface Icon {
  actor: number;
  x: number;
  y: number;
  size: number;
}

function placeIcons(model: SceneModel, prof: SectionProfile, sy: number): Icon[] {
  const out: Icon[] = [];
  const N = prof.bins;
  const maxRec = Math.max(1, ...model.actors.map((a) => a.recordCount));
  model.actors.forEach((a, ai) => {
    const rng = mulberry32(1000 + ai * 31);
    const n = Math.max(1, Math.min(5, Math.round(1 + Math.log10(a.recordCount + 1))));
    const size = 1.3 + 2.6 * (Math.log10(a.recordCount + 1) / Math.log10(maxRec + 1));
    const candidates: number[] = [];
    for (let i = 2; i < N - 2; i++) {
      const dd = prof.depth[i];
      if (dd <= 0.3) continue;
      if (a.depthBand === 'littoral' && dd > prof.maxDepthM * 0.3) continue;
      candidates.push(i);
    }
    if (!candidates.length) {
      for (let i = 2; i < N - 2; i++) if (prof.depth[i] > 0.3) candidates.push(i);
    }
    for (let k = 0; k < n && candidates.length; k++) {
      const i = candidates[Math.floor(rng() * candidates.length)];
      const dd = prof.depth[i];
      const frac =
        a.depthBand === 'surface'
          ? 0.04 + 0.05 * rng()
          : a.depthBand === 'littoral'
            ? 0.2 + 0.4 * rng()
            : a.depthBand === 'midwater'
              ? 0.3 + 0.3 * rng()
              : 0.93;
      out.push({ actor: ai, x: -PANEL_W / 2 + (i / (N - 1)) * PANEL_W, y: -dd * frac * sy, size });
    }
  });
  return out;
}

function iconShape(actor: SceneActor): { body: Shape; fin: Shape } {
  const arch = actor.archetype;
  const body = new Shape();
  const fin = new Shape();
  if (isFishArchetype(arch)) {
    const h = FISH_PARAMS[arch].halfHeight * 1.6;
    body.moveTo(0.5, 0);
    body.bezierCurveTo(0.3, h * 1.6, -0.25, h * 1.3, -0.4, 0);
    body.bezierCurveTo(-0.25, -h * 1.3, 0.3, -h * 1.6, 0.5, 0);
    fin.moveTo(-0.38, 0);
    fin.lineTo(-0.62, h * 1.5);
    fin.lineTo(-0.56, 0);
    fin.lineTo(-0.62, -h * 1.5);
    fin.closePath();
  } else if (arch === 'turtle') {
    body.absellipse(0, 0, 0.42, 0.26, 0, Math.PI * 2, false, 0);
    fin.absellipse(0.5, 0.05, 0.12, 0.1, 0, Math.PI * 2, false, 0);
  } else if (arch === 'plant') {
    body.moveTo(-0.05, -0.5);
    body.lineTo(0.05, -0.5);
    body.lineTo(0.12, 0.5);
    body.lineTo(-0.12, 0.5);
    fin.moveTo(0, 0);
    fin.lineTo(0.05, 0);
  } else {
    body.absellipse(0, 0, 0.4, 0.3, 0, Math.PI * 2, false, 0);
    fin.moveTo(0.3, 0.2);
    fin.lineTo(0.6, 0.35);
    fin.lineTo(0.45, 0.05);
    fin.closePath();
  }
  return { body, fin };
}

function Icons({
  model,
  icons,
  onHover,
}: {
  model: SceneModel;
  icons: Icon[];
  onHover: (i: { actor: number; x: number; y: number } | null) => void;
}) {
  const shapes = useMemo(
    () =>
      model.actors.map((a) => {
        const s = iconShape(a);
        return {
          body: new ShapeGeometry(s.body),
          fin: new ShapeGeometry(s.fin),
          colors: a.colors,
          introduced: a.introduced,
        };
      }),
    [model],
  );
  useEffect(() => () => shapes.forEach((s) => (s.body.dispose(), s.fin.dispose())), [shapes]);
  return (
    <group position={[0, 0, Z + 0.1]}>
      {icons.map((ic, i) => {
        const s = shapes[ic.actor];
        return (
          <group
            key={i}
            position={[ic.x, ic.y, 0.05 + (i % 7) * 0.002]}
            scale={[ic.size, ic.size, 1]}
            onPointerMove={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onHover({ actor: ic.actor, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
            }}
            onPointerOut={() => onHover(null)}
          >
            <mesh geometry={s.body}>
              <meshBasicMaterial color={s.colors.side} side={DoubleSide} />
            </mesh>
            <mesh geometry={s.fin} position={[0, 0, 0.001]}>
              <meshBasicMaterial color={s.colors.fin} side={DoubleSide} />
            </mesh>
            {s.introduced && (
              <mesh position={[0, 0, -0.001]} scale={[1.18, 1.25, 1]} geometry={s.body}>
                <meshBasicMaterial color="#ff8a00" side={DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

const tickStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#e7f3f8',
  whiteSpace: 'nowrap',
  textShadow: '0 1px 2px #000',
  pointerEvents: 'none',
};

function Rulers({ prof, sy, feet }: { prof: SectionProfile; sy: number; feet: boolean }) {
  const maxD = prof.maxDepthM;
  const depthStepM = feet ? niceStep(mToFt(maxD), 6) / 3.28084 : niceStep(maxD, 6);
  const depthTicks: number[] = [];
  for (let v = 0; v <= maxD * 1.001; v += depthStepM) depthTicks.push(v);
  const lenKm = prof.lengthM / 1000;
  const distStep = niceStep(lenKm, 6);
  const distTicks: number[] = [];
  for (let v = 0; v <= lenKm * 1.001; v += distStep) distTicks.push(v);
  const bottom = -PANEL_H - SOIL - 1.5;
  return (
    <group>
      {depthTicks.map((v) => (
        <Html
          key={`d${v}`}
          position={[-PANEL_W / 2 - 1.5, -v * sy, Z]}
          center
          style={tickStyle}
          zIndexRange={[5, 0]}
        >
          <span data-testid="depth-tick">
            {feet ? `${Math.round(mToFt(v))} ft` : `${Math.round(v * 10) / 10} m`}
          </span>
        </Html>
      ))}
      {distTicks.map((v) => (
        <Html
          key={`x${v}`}
          position={[-PANEL_W / 2 + (v / Math.max(lenKm, 1e-9)) * PANEL_W, bottom, Z]}
          center
          style={tickStyle}
          zIndexRange={[5, 0]}
        >
          <span data-testid="distance-tick">
            {feet
              ? `${(v / 1.609344).toFixed(v < 10 ? 1 : 0)} mi`
              : `${v.toFixed(v < 10 ? 1 : 0)} km`}
          </span>
        </Html>
      ))}
    </group>
  );
}

export default function SectionView({ model, reducedMotion }: SceneViewProps) {
  const prof = useMemo(() => sectionProfile(model), [model]);
  const geo = useMemo(() => build(model, prof), [model, prof]);
  const icons = useMemo(() => placeIcons(model, prof, geo.sy), [model, prof, geo.sy]);
  const [feet, setFeet] = useState(false);
  const [hover, setHover] = useState<{ actor: number; x: number; y: number } | null>(null);
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g instanceof BufferGeometry && g.dispose());
    },
    [geo],
  );
  const actor = hover ? model.actors[hover.actor] : null;
  const hasDo = !!model.doProfile?.length;
  const exag = geo.sy / geo.sx;

  return (
    <>
      <SceneCanvas
        view="section"
        cameraPosition={[0, -PANEL_H / 2 - 2, 105]}
        fov={34}
        far={600}
        dataAttrs={{
          do: hasDo,
          lengthKm: (prof.lengthM / 1000).toFixed(1),
          thermocline: model.thermoclineM ?? 'none',
        }}
      >
        <ambientLight intensity={1.2} />
        <directionalLight position={[20, 30, 40]} intensity={1.2} />
        <mesh geometry={geo.waterFront}>
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
        <mesh geometry={geo.waterBack}>
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
        <mesh geometry={geo.surfaceTop}>
          <meshBasicMaterial vertexColors transparent opacity={0.8} side={DoubleSide} />
        </mesh>
        {geo.doOverlay && (
          <mesh geometry={geo.doOverlay}>
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={0.68}
              side={DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
        {geo.thermo && (
          <mesh geometry={geo.thermo}>
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={0.4}
              side={DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
        <mesh geometry={geo.soilFront}>
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
        <mesh geometry={geo.soilBack}>
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
        <mesh geometry={geo.bedRibbon}>
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
        <Icons model={model} icons={icons} onHover={setHover} />
        <Rulers prof={prof} sy={geo.sy} feet={feet} />
        {model.thermoclineM !== undefined && (
          <Html
            position={[PANEL_W / 2 - 1, -model.thermoclineM * geo.sy, Z]}
            style={{ ...tickStyle, transform: 'translate(-100%, -120%)' }}
          >
            <span data-testid="thermocline-label">
              Thermocline{model.thermoclineEstimated ? ' (estimated)' : ''} ~
              {formatDepth(model.thermoclineM, feet ? 'imperial' : 'metric')}
            </span>
          </Html>
        )}
        <FitPanel width={PANEL_W + 44} height={PANEL_H + SOIL + 12} centreY={-PANEL_H / 2 - 2} />
        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          target={[0, -PANEL_H / 2 - 2, 0]}
          minAzimuthAngle={-0.7}
          maxAzimuthAngle={0.7}
          minPolarAngle={Math.PI / 2 - 0.45}
          maxPolarAngle={Math.PI / 2 + 0.35}
          minDistance={50}
          maxDistance={170}
          autoRotate={false}
        />
      </SceneCanvas>
      <SceneBadges demo={model.demo} depthEstimated={model.depthEstimated} />
      <div className="legend" data-testid="section-legend" style={{ top: 48 }}>
        <strong>Vertical slice along the longest axis</strong>
        <div style={{ color: 'var(--muted)' }}>
          {formatDistanceKm(prof.lengthM / 1000, feet ? 'imperial' : 'metric')} long, deepest water
          at each position, vertical scale exaggerated{' '}
          {exag >= 10 ? Math.round(exag) : exag.toFixed(1)}x.
        </div>
        {hasDo ? (
          <div className="mt-2" data-testid="do-legend">
            <div>
              Dissolved oxygen
              {model.surfaceDoMgL !== undefined
                ? ` (surface ${model.surfaceDoMgL.toFixed(1)} mg/L)`
                : ''}
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span
                style={{ background: '#d32f2f', width: 14, height: 10, display: 'inline-block' }}
              />{' '}
              below 2
              <span
                style={{
                  background: '#f2a81d',
                  width: 14,
                  height: 10,
                  display: 'inline-block',
                  marginLeft: 6,
                }}
              />{' '}
              2 to 5
              <span
                style={{
                  background: '#2b7bd1',
                  width: 14,
                  height: 10,
                  display: 'inline-block',
                  marginLeft: 6,
                }}
              />{' '}
              above 5 mg/L
            </div>
          </div>
        ) : (
          <div className="mt-2" data-testid="no-do-note">
            <strong>No depth profile measured.</strong>{' '}
            {model.surfaceDoMgL !== undefined
              ? `Surface dissolved oxygen: ${model.surfaceDoMgL.toFixed(1)} mg/L.`
              : 'No dissolved oxygen data.'}
          </div>
        )}
        {model.thermoclineM !== undefined && (
          <div className="mt-1 text-xs">
            Thermocline band{' '}
            {model.thermoclineEstimated
              ? 'estimated from surface temperature and lake size'
              : 'from the measured temperature profile'}
            .
          </div>
        )}
      </div>
      <div className="scene-controls" data-testid="section-controls">
        <button
          type="button"
          className="btn"
          aria-pressed={feet}
          onClick={() => setFeet((f) => !f)}
        >
          {feet ? 'Feet and miles' : 'Metres and kilometres'}
        </button>
        <span className="text-xs">
          Icons are sized by record count; orange rim marks introduced species. Drag to tilt
          slightly.
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
