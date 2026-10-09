import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Html, OrbitControls } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type Group,
  type PerspectiveCamera,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { SceneModel } from '@wi/shared';
import { useStageInset } from '../../lib/hooks';
import { useUi } from '../../store';
import { buildIcon, disposeIcon, type IconParts } from './icons';
import {
  DO_COLORS,
  asBand,
  compose,
  doAtDepth,
  doColor,
  doTintTexels,
  exaggerationLabel,
  labelBox,
  layoutSpecies,
  lightModel,
  niceStep,
  profileDepthAt,
  spreadLabels,
  srgb,
  ticks,
  waterPalette,
  type Composition,
  type LayoutItem,
  type Placement,
  type Rect,
  type SectionProfile,
} from './section';
import { bedTexture, createSectionMaterial, doTexture } from './sectionMaterial';

export const SECTION_FOV = 20;
/** Half the thickness of the slab, in pixels. */
const SLAB = 26;
const FT_PER_M = 3.28084;
const KM_PER_MI = 1.609344;

export interface Hover {
  actor: number;
  x: number;
  y: number;
}

export interface Chrome {
  top: number;
  bottom: number;
}

interface Props {
  model: SceneModel;
  prof: SectionProfile;
  feet: boolean;
  chrome: Chrome;
  reducedMotion: boolean;
  portal: RefObject<HTMLElement>;
  onHover: (h: Hover | null) => void;
}

// Text styles -----------------------------------------------------------------------------------------

const base: CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  textShadow: '0 1px 2px rgba(2, 8, 12, 0.85)',
  lineHeight: 1.15,
};
const tickText: CSSProperties = { ...base, fontSize: 11, color: 'var(--muted)' };
const capsText: CSSProperties = {
  ...base,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};
const noteText: CSSProperties = { ...base, fontSize: 11, color: 'var(--text-2)' };

/** Html label anchored at a world point; `anchor` picks which side of the text sits on the point. */
function Label({
  at,
  anchor,
  style,
  portal,
  children,
  testId,
}: {
  at: [number, number, number];
  anchor:
    | 'left'
    | 'right'
    | 'center'
    | 'top'
    | 'top-right'
    | 'top-left'
    | 'bottom'
    | 'bottom-left'
    | 'bottom-right';
  style: CSSProperties;
  portal: RefObject<HTMLElement>;
  children: React.ReactNode;
  testId?: string;
}) {
  const t = {
    left: 'translate(0, -50%)',
    right: 'translate(-100%, -50%)',
    center: 'translate(-50%, -50%)',
    top: 'translate(-50%, 0)',
    'top-right': 'translate(-100%, 0)',
    'top-left': 'none',
    bottom: 'translate(-50%, -100%)',
    'bottom-left': 'translate(0, -100%)',
    'bottom-right': 'translate(-100%, -100%)',
  }[anchor];
  return (
    <Html portal={portal} position={at} style={{ ...style, transform: t }} zIndexRange={[6, 0]}>
      <span data-testid={testId}>{children}</span>
    </Html>
  );
}

// Geometry helpers ------------------------------------------------------------------------------------

function lineGeometry(segments: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(segments), 3));
  return g;
}

/** Elliptical ring of constant thickness (pixels), for the introduced-species marker. */
function ringGeometry(rx: number, ry: number, t: number): ShapeGeometry {
  const s = new Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  const hole = new Shape();
  hole.absellipse(0, 0, rx - t, ry - t, 0, Math.PI * 2, true, 0);
  s.holes.push(hole);
  return new ShapeGeometry(s, 48);
}

const fmtDepth = (m: number, feet: boolean) => {
  const v = feet ? m * FT_PER_M : m;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${feet ? 'ft' : 'm'}`;
};

// Scene -------------------------------------------------------------------------------------------

interface Built {
  comp: Composition;
  pxPerM: number;
  depthPx: (x: number) => number;
  material: ShaderMaterial;
  front: BufferGeometry;
  ribbon: BufferGeometry;
  frontPos: [number, number, number];
  disposables: Array<{ dispose: () => void }>;
}

function buildSlice(
  model: SceneModel,
  prof: SectionProfile,
  comp: Composition,
  tickStepM: number,
): Built {
  const { waterW, waterH, landW, groundH, bankH } = comp;
  const pxPerM = waterH / prof.maxDepthM;
  const depthPx = (x: number) => profileDepthAt(prof, x / waterW) * pxPerM;
  const N = 720;
  const x0 = -landW;
  const x1 = waterW + landW;
  const heights = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = x0 + ((x1 - x0) * i) / (N - 1);
    if (x <= 0 || x >= waterW) {
      // A low bank that rises away from the water, with a gentle roll.
      const u = x <= 0 ? -x : x - waterW;
      const rise = Math.min(1, u / (landW * 0.55));
      const s = rise * rise * (3 - 2 * rise);
      heights[i] = bankH * s * (1 + 0.18 * Math.sin(u * 0.09 + (x < 0 ? 0 : 2)));
    } else heights[i] = -depthPx(x);
  }
  const bed = bedTexture(heights);
  const light = lightModel(model.visibilityM);
  const pal = waterPalette(model.waterTint);
  const doTex = doTexture(
    model.doProfile?.length ? doTintTexels(model.doProfile, prof.maxDepthM) : null,
  );
  const material = createSectionMaterial();
  const u = material.uniforms;
  const bottom = -(waterH + groundH);
  u.uBed.value = bed;
  u.uN.value = N;
  u.uRange.value = [x0, x1];
  u.uDo.value = doTex;
  u.uHasDo.value = model.doProfile?.length ? 1 : 0;
  u.uWaterW.value = waterW;
  u.uWaterH.value = waterH;
  u.uBottom.value = bottom;
  u.uFade.value = groundH * 0.75;
  u.uLandW.value = landW;
  u.uPxPerM.value = pxPerM;
  u.uKd.value = light.kd;
  u.uPhoticM.value = light.photicM < prof.maxDepthM * 0.97 ? light.photicM : -1;
  u.uThermoM.value = model.thermoclineM ?? -1;
  u.uThermoW.value = Math.max(7 / pxPerM, 0.4);
  u.uTick.value = tickStepM;
  (u.uShallow.value as Vector3).set(...pal.shallow);
  (u.uMid.value as Vector3).set(...pal.mid);
  (u.uDeep.value as Vector3).set(...pal.deep);

  const top = bankH * 1.3 + 2;
  const front = new BufferGeometry();
  front.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([x0, bottom, 0, x1, bottom, 0, x1, top, 0, x0, top, 0]),
      3,
    ),
  );
  front.setIndex([0, 1, 2, 0, 2, 3]);

  // The bed and banks as a ribbon across the slab, seen when the view tilts.
  const M = 240;
  const pos = new Float32Array(M * 2 * 3);
  const col = new Float32Array(M * 2 * 4);
  const silt = srgb('#5b533f');
  const soil = srgb('#6a5d42');
  for (let i = 0; i < M; i++) {
    const x = x0 + ((x1 - x0) * i) / (M - 1);
    const f = (x - x0) / (x1 - x0);
    const h = heights[Math.round(f * (N - 1))];
    const c = x <= 0 || x >= waterW ? soil : silt;
    const fade = Math.min(1, Math.min(x - x0, x1 - x) / (landW * 0.7));
    for (let j = 0; j < 2; j++) {
      const n = i * 2 + j;
      pos.set([x, h, j === 0 ? SLAB : -SLAB], n * 3);
      const shade = j === 0 ? 1 : 0.6;
      col.set([c[0] * shade, c[1] * shade, c[2] * shade, fade], n * 4);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < M - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const ribbon = new BufferGeometry();
  ribbon.setAttribute('position', new BufferAttribute(pos, 3));
  ribbon.setAttribute('color', new BufferAttribute(col, 4));
  ribbon.setIndex(idx);
  return {
    comp,
    pxPerM,
    depthPx,
    material,
    front,
    ribbon,
    frontPos: [0, 0, SLAB],
    disposables: [bed, doTex, material, front, ribbon],
  };
}

/** Fits the camera so one world unit is one screen pixel on the front face, then eases back after a tilt. */
function CameraRig({ comp, reducedMotion }: { comp: Composition; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const panelOpen = useUi((s) => s.panelOpen);
  const inset = useStageInset(panelOpen);
  const controls = useRef<OrbitControlsImpl>(null);
  const home = useRef(new Vector3());
  const target = useRef(new Vector3());
  const returning = useRef(false);
  const dragging = useRef(false);
  useLayoutEffect(() => {
    const d = size.height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const cx0 = (size.width - inset) / 2;
    const camX = cx0 - comp.originX;
    const camY = comp.originY - size.height / 2;
    target.current.set(camX, camY, 0);
    home.current.set(camX, camY, SLAB + d);
    camera.near = Math.max(1, d * 0.05);
    camera.far = d * 4;
    camera.position.copy(home.current);
    camera.lookAt(target.current);
    camera.updateProjectionMatrix();
    const c = controls.current;
    if (c) {
      c.target.copy(target.current);
      c.update();
    }
  }, [camera, size.width, size.height, inset, comp.originX, comp.originY]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const start = () => {
      dragging.current = true;
      returning.current = false;
    };
    const end = () => {
      dragging.current = false;
      returning.current = true;
    };
    c.addEventListener('start', start);
    c.addEventListener('end', end);
    return () => {
      c.removeEventListener('start', start);
      c.removeEventListener('end', end);
    };
  }, []);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || dragging.current || !returning.current) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 2.2);
    camera.position.lerp(home.current, k);
    if (camera.position.distanceTo(home.current) < 0.5) {
      camera.position.copy(home.current);
      returning.current = false;
    }
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableZoom={false}
      enableDamping={false}
      rotateSpeed={0.35}
      minAzimuthAngle={-0.45}
      maxAzimuthAngle={0.45}
      minPolarAngle={Math.PI / 2 - 0.42}
      maxPolarAngle={Math.PI / 2 + 0.04}
    />
  );
}

/** Deep ink backdrop with a soft lift behind the figure. */
function Backdrop({ comp, size }: { comp: Composition; size: { width: number; height: number } }) {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        depthWrite: false,
        toneMapped: false,
        uniforms: { uC: { value: [0, 0] }, uR: { value: 1 } },
        vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec2 uC; uniform float uR; varying vec2 vP;
          void main(){
            float d = length((vP - uC) / vec2(1.0, 0.8)) / uR;
            vec3 edge = vec3(0.016, 0.043, 0.063);
            vec3 lift = vec3(0.047, 0.106, 0.137);
            gl_FragColor = vec4(mix(lift, edge, smoothstep(0.0, 1.0, d)), 1.0);
          }`,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const cx = comp.waterW / 2;
  const cy = -comp.waterH * 0.45;
  mat.uniforms.uC.value = [cx, cy];
  mat.uniforms.uR.value = Math.max(size.width, size.height) * 1.1;
  const s = Math.max(size.width, size.height) * 8;
  return (
    <mesh position={[cx, cy, -SLAB * 30]} material={mat} renderOrder={-10}>
      <planeGeometry args={[s, s]} />
    </mesh>
  );
}

/** World point where a species label attaches, from its layout box. */
function labelAnchor(it: LayoutItem, p: Placement): [number, number, number] {
  const b = labelBox(it, p.x, p.y, p.label ?? 'below');
  const z = SLAB + 1;
  switch (p.label) {
    case 'above':
      return [p.x, -b.y1, z];
    case 'right':
      return [b.x0, -p.y, z];
    case 'left':
      return [b.x1, -p.y, z];
    default:
      return [p.x, -b.y0, z];
  }
}

interface Placed {
  actor: number;
  parts: IconParts;
  len: number;
  dir: 1 | -1;
  place: Placement;
  item: LayoutItem;
  ring: ShapeGeometry | null;
  phase: number;
}

function Species({
  placed,
  reducedMotion,
  portal,
  onHover,
  model,
}: {
  placed: Placed[];
  reducedMotion: boolean;
  portal: RefObject<HTMLElement>;
  onHover: (h: Hover | null) => void;
  model: SceneModel;
}) {
  const groups = useRef<Array<Group | null>>([]);
  const tails = useRef<Array<Group | null>>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    placed.forEach((p, i) => {
      const g = groups.current[i];
      if (!g) return;
      if (reducedMotion || !p.parts.swims) {
        g.position.set(p.place.x, -p.place.y, 0);
        g.rotation.z = 0;
        const tl = tails.current[i];
        if (tl) tl.rotation.z = 0;
        return;
      }
      const ph = p.phase;
      g.position.set(
        p.place.x + Math.sin(t * 0.33 + ph) * 2.2,
        -p.place.y + Math.sin(t * 0.9 + ph * 1.7) * 1.4,
        0,
      );
      g.rotation.z = Math.sin(t * 0.9 + ph * 1.7 + 1.2) * 0.04 * p.dir;
      const tl = tails.current[i];
      if (tl) tl.rotation.z = Math.sin(t * 5.2 + ph * 3) * 0.32;
    });
  });
  return (
    <group position={[0, 0, SLAB + 1]}>
      {placed.map((p, i) => {
        const a = model.actors[p.actor];
        const { parts, len, dir } = p;
        return (
          <group
            key={a.key}
            ref={(el) => {
              groups.current[i] = el;
            }}
            position={[p.place.x, -p.place.y, 0]}
          >
            <group scale={[len * dir, len, 1]}>
              <mesh
                onPointerMove={(e: ThreeEvent<PointerEvent>) => {
                  e.stopPropagation();
                  onHover({ actor: p.actor, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
                }}
                onPointerOut={() => onHover(null)}
              >
                <planeGeometry args={[1.15, Math.max(0.5, parts.halfH * 2.6)]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              {parts.fins && (
                <mesh geometry={parts.fins} position={[0, 0, -0.01]}>
                  <meshBasicMaterial color={a.colors.fin} side={DoubleSide} toneMapped={false} />
                </mesh>
              )}
              {parts.tail && (
                <group
                  position={[parts.tailPivot[0], parts.tailPivot[1], -0.005]}
                  ref={(el) => {
                    tails.current[i] = el;
                  }}
                >
                  <mesh geometry={parts.tail}>
                    <meshBasicMaterial color={a.colors.fin} side={DoubleSide} toneMapped={false} />
                  </mesh>
                </group>
              )}
              <mesh geometry={parts.body}>
                <meshBasicMaterial vertexColors side={DoubleSide} toneMapped={false} />
              </mesh>
              {parts.detail && (
                <mesh geometry={parts.detail} position={[0, 0, 0.01]}>
                  <meshBasicMaterial
                    color={a.colors.back}
                    side={DoubleSide}
                    toneMapped={false}
                    transparent
                    opacity={0.85}
                  />
                </mesh>
              )}
              {parts.eye && (
                <mesh position={[parts.eye[0], parts.eye[1], 0.02]} scale={[1, 1, 1]}>
                  <circleGeometry args={[Math.max(0.022, 1.3 / len), 12]} />
                  <meshBasicMaterial color="#0b1116" toneMapped={false} />
                </mesh>
              )}
            </group>
            {p.ring && (
              <mesh geometry={p.ring} position={[0, 0, 0.5]}>
                <meshBasicMaterial color="#ff9a3c" transparent opacity={0.85} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {placed.map((p) =>
        p.place.label ? (
          <Label
            key={`l-${model.actors[p.actor].key}`}
            portal={portal}
            at={labelAnchor(p.item, p.place)}
            anchor={
              ({ below: 'top', above: 'bottom', right: 'left', left: 'right' } as const)[
                p.place.label
              ]
            }
            style={{ ...base, fontSize: 10.5, color: 'var(--text-2)', letterSpacing: '0.01em' }}
          >
            {model.actors[p.actor].label}
          </Label>
        ) : null,
      )}
    </group>
  );
}

export function SectionScene({ model, prof, feet, chrome, reducedMotion, portal, onHover }: Props) {
  const size = useThree((s) => s.size);
  const panelOpen = useUi((s) => s.panelOpen);
  const inset = useStageInset(panelOpen);
  const comp = useMemo(
    () =>
      compose({
        width: size.width,
        height: size.height,
        inset,
        top: chrome.top,
        bottom: chrome.bottom,
      }),
    [size.width, size.height, inset, chrome.top, chrome.bottom],
  );

  // Rulers in display units ----------------------------------------------------------------------
  const maxD = prof.maxDepthM;
  const depthDisp = feet ? maxD * FT_PER_M : maxD;
  const depthStep = niceStep(depthDisp, comp.waterH < 220 ? 4 : 6);
  const depthStepM = feet ? depthStep / FT_PER_M : depthStep;
  const depthTicks = useMemo(() => ticks(depthDisp, depthStep), [depthDisp, depthStep]);
  const lenDisp = feet ? prof.lengthM / 1000 / KM_PER_MI : prof.lengthM / 1000;
  const distStep = niceStep(lenDisp, Math.max(3, Math.min(8, Math.floor(comp.waterW / 90))));
  const distTicks = useMemo(() => ticks(lenDisp, distStep), [lenDisp, distStep]);

  const built = useMemo(
    () => buildSlice(model, prof, comp, depthStepM),
    [model, prof, comp, depthStepM],
  );
  useEffect(() => () => built.disposables.forEach((d) => d.dispose()), [built]);
  useFrame(({ clock }) => {
    if (!reducedMotion) built.material.uniforms.uTime.value = clock.elapsedTime;
  });
  const { pxPerM, depthPx } = built;
  const { waterW, waterH, landW } = comp;
  const exag = pxPerM / (waterW / prof.lengthM);

  // Annotations: photic zone (left) and thermocline (right) --------------------------------------
  const light = lightModel(model.visibilityM);
  const photicPx = light.photicM * pxPerM;
  const showPhotic = light.photicM < maxD * 0.97;
  const thermoPx = model.thermoclineM !== undefined ? model.thermoclineM * pxPerM : null;
  const annotations = useMemo(() => {
    const out: Array<{
      key: string;
      text: string;
      x: number;
      y: number;
      anchor: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
      rect: Rect;
      testId?: string;
    }> = [];
    const place = (
      key: string,
      text: string,
      linePx: number,
      side: 'left' | 'right',
      testId?: string,
    ) => {
      const w = text.length * 6.4 + 6;
      // First point from the chosen shore where the water is comfortably deeper than the line.
      let x = side === 'left' ? 0 : waterW;
      const stepX = side === 'left' ? 2 : -2;
      while (x >= 0 && x <= waterW && depthPx(x) < linePx + 22) x += stepX;
      x += side === 'left' ? 10 : -10;
      const above = linePx > 17;
      const y = above ? linePx - 3 : linePx + 4;
      const rect: Rect =
        side === 'left'
          ? { x0: x, x1: x + w, y0: above ? y - 13 : linePx - 4, y1: above ? linePx + 4 : y + 13 }
          : { x0: x - w, x1: x, y0: above ? y - 13 : linePx - 4, y1: above ? linePx + 4 : y + 13 };
      out.push({
        key,
        text,
        x,
        y,
        anchor: above
          ? side === 'left'
            ? 'bottom-left'
            : 'bottom-right'
          : side === 'left'
            ? 'top-left'
            : 'top-right',
        rect,
        testId,
      });
    };
    if (showPhotic)
      place('photic', `Photic zone ~${fmtDepth(light.photicM, feet)}`, photicPx, 'left');
    if (thermoPx !== null && model.thermoclineM !== undefined)
      place(
        'thermo',
        `Thermocline ~${fmtDepth(model.thermoclineM, feet)}${model.thermoclineEstimated ? ' (est.)' : ''}`,
        thermoPx,
        'right',
        'thermocline-label',
      );
    return out;
  }, [showPhotic, light.photicM, photicPx, thermoPx, model, feet, waterW, depthPx]);

  // Species ----------------------------------------------------------------------------------------
  const placed = useMemo<Placed[]>(() => {
    const maxRec = Math.max(1, ...model.actors.map((a) => a.recordCount));
    const scale = Math.max(0.75, Math.min(1.15, waterW / 760));
    const items: LayoutItem[] = [];
    const parts: IconParts[] = [];
    const lens: number[] = [];
    model.actors.forEach((a) => {
      const p = buildIcon(a.archetype, a.colors);
      const t = Math.log10(a.recordCount + 1) / Math.log10(maxRec + 1);
      const kind =
        a.archetype === 'mussel'
          ? 0.7
          : a.archetype === 'crab'
            ? 0.85
            : a.archetype === 'plant'
              ? 0.6
              : 1;
      const len = (26 + 26 * t * t) * scale * kind * (a.archetype === 'frog' ? 1.4 : 1);
      const h = Math.max(8, p.halfH * 2 * len);
      const ringPad = a.introduced ? 12 : 2;
      parts.push(p);
      lens.push(len);
      items.push({
        band: asBand(a.depthBand),
        w: len + ringPad,
        h: h + ringPad,
        labelW: a.label.length * 5.9 + 6,
        labelH: 13,
      });
    });
    const places = layoutSpecies(items, waterW, depthPx, {
      reserved: annotations.map((a) => a.rect),
      littoralMaxPx: photicPx,
    });
    return model.actors.map((a, i) => {
      const it = items[i];
      return {
        actor: i,
        parts: parts[i],
        len: lens[i],
        dir: (i % 3 === 1 ? -1 : 1) as 1 | -1,
        place: places[i],
        item: it,
        ring: a.introduced ? ringGeometry(it.w / 2 - 1, it.h / 2 - 1, 1.25) : null,
        phase: i * 1.37,
      };
    });
  }, [model, waterW, depthPx, annotations, photicPx]);
  useEffect(
    () => () =>
      placed.forEach((p) => {
        disposeIcon(p.parts);
        p.ring?.dispose();
      }),
    [placed],
  );

  // Zone labels on the right -------------------------------------------------------------------------
  const zones = useMemo(() => {
    const median = (band: string, fallback: number) => {
      const ys = placed
        .filter((p) => !p.place.displaced && asBand(model.actors[p.actor].depthBand) === band)
        .map((p) => p.place.y)
        .sort((a, b) => a - b);
      return ys.length ? ys[Math.floor(ys.length / 2)] : fallback;
    };
    const list = [
      { name: 'Surface', y: 8 },
      { name: 'Littoral', y: median('littoral', waterH * 0.2) },
      { name: 'Open water', y: median('midwater', waterH * 0.42) },
      { name: 'Benthic', y: Math.max(median('benthic', waterH * 0.88), waterH * 0.7) },
    ];
    // Keep the natural top-to-bottom order, then spread.
    for (let i = 1; i < list.length; i++) list[i].y = Math.max(list[i].y, list[i - 1].y + 1);
    const ys = spreadLabels(
      list.map((z) => z.y),
      20,
      6,
      waterH - 4,
    );
    return list.map((z, i) => ({ ...z, y: ys[i] }));
  }, [placed, model, waterH]);

  // Hairlines: rulers and the DO gauge frame ----------------------------------------------------------
  const Z = SLAB + 0.5;
  const gx = comp.gaugeX;
  const gw = comp.gaugeW;
  const doProfile = useMemo(
    () =>
      model.doProfile?.length ? [...model.doProfile].sort((a, b) => a.depthM - b.depthM) : null,
    [model.doProfile],
  );
  const doMax = Math.max(
    10,
    Math.ceil(Math.max(...(doProfile?.map((p) => p.mgL) ?? [model.surfaceDoMgL ?? 0])) / 5) * 5,
  );
  const hasProfile = !!doProfile;
  const gX = useCallback((mg: number) => gx + (Math.min(mg, doMax) / doMax) * gw, [gx, gw, doMax]);
  const lines = useMemo(() => {
    const seg: number[] = [];
    const L = (ax: number, ay: number, bx: number, by: number) => seg.push(ax, ay, Z, bx, by, Z);
    // Depth ruler
    const rx = comp.rulerX;
    L(rx, 0, rx, -waterH);
    for (const v of depthTicks) {
      const y = -(feet ? v / FT_PER_M : v) * pxPerM;
      L(rx - 5, y, rx, y);
    }
    // Distance ruler
    const dy = -comp.distY;
    L(0, dy, waterW, dy);
    for (const v of distTicks) {
      const x = (v / lenDisp) * waterW;
      L(x, dy, x, dy - 5);
    }
    // Shore markers on the distance ruler
    L(0, dy + 3, 0, dy);
    L(waterW, dy + 3, waterW, dy - 5);
    if (hasProfile) {
      // Gauge frame: axis at 0 mg/L along the depth extent, scale along the bottom
      L(gx, 0, gx, -waterH);
      L(gx, -waterH, gx + gw, -waterH);
      for (const mg of [0, 5, 10, 15].filter((m) => m <= doMax))
        L(gX(mg), -waterH, gX(mg), -waterH - 4);
    } else {
      // Only a surface reading: a short scale just under the header
      L(gx, -22, gx + gw, -22);
      for (const mg of [0, 5, 10, 15].filter((m) => m <= doMax)) L(gX(mg), -22, gX(mg), -22 - 4);
    }
    return lineGeometry(seg);
  }, [
    comp,
    waterH,
    waterW,
    depthTicks,
    distTicks,
    feet,
    pxPerM,
    lenDisp,
    gx,
    gw,
    doMax,
    Z,
    gX,
    hasProfile,
  ]);
  const thresholdLines = useMemo(() => {
    const seg: number[] = [];
    for (const mg of [2, 5]) seg.push(gX(mg), 0, Z, gX(mg), -waterH, Z);
    const g = lineGeometry(seg);
    g.computeBoundingSphere();
    return g;
  }, [gX, waterH, Z]);
  // Dashed lines need per-vertex distances.
  const dashed = useMemo(() => {
    const g = thresholdLines.clone();
    const pos = g.getAttribute('position');
    const dist = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i += 2) {
      dist[i] = 0;
      dist[i + 1] = Math.abs(pos.getY(i + 1) - pos.getY(i));
    }
    g.setAttribute('lineDistance', new BufferAttribute(dist, 1));
    return g;
  }, [thresholdLines]);

  // DO curve and its fill
  const doGeo = useMemo(() => {
    if (!doProfile) return null;
    const n = 96;
    const deepest = doProfile[doProfile.length - 1].depthM;
    const top = Math.min(doProfile[0].depthM, 0);
    const fillPos: number[] = [];
    const fillCol: number[] = [];
    const curve: number[] = [];
    const curveCol: number[] = [];
    let prev: [number, number, number[]] | null = null;
    for (let i = 0; i <= n; i++) {
      const d = top + ((deepest - top) * i) / n;
      const mg = doAtDepth(doProfile, d);
      const c = srgb(doColor(mg));
      const y = -Math.min(d, maxD) * pxPerM;
      const x = gX(mg);
      fillPos.push(gx, y, Z - 0.2, x, y, Z - 0.2);
      // Fades from the axis to the curve, so the curve reads first.
      fillCol.push(...c, 0.03, ...c, 0.34);
      if (prev) {
        curve.push(prev[0], prev[1], Z + 0.2, x, y, Z + 0.2);
        curveCol.push(...prev[2], ...c);
      }
      prev = [x, y, c];
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const fill = new BufferGeometry();
    fill.setAttribute('position', new BufferAttribute(new Float32Array(fillPos), 3));
    fill.setAttribute('color', new BufferAttribute(new Float32Array(fillCol), 4));
    fill.setIndex(idx);
    const line = new BufferGeometry();
    line.setAttribute('position', new BufferAttribute(new Float32Array(curve), 3));
    line.setAttribute('color', new BufferAttribute(new Float32Array(curveCol), 3));
    return { fill, line };
  }, [doProfile, maxD, pxPerM, gX, gx, Z]);
  useEffect(
    () => () => {
      lines.dispose();
      thresholdLines.dispose();
      dashed.dispose();
      doGeo?.fill.dispose();
      doGeo?.line.dispose();
    },
    [lines, thresholdLines, dashed, doGeo],
  );
  const pal = useMemo(() => waterPalette(model.waterTint), [model.waterTint]);

  // Deepest point marker
  let deepX = 0;
  for (let x = 0; x <= waterW; x += 1) if (depthPx(x) > depthPx(deepX)) deepX = x;

  return (
    <>
      <Backdrop comp={comp} size={size} />
      <CameraRig comp={comp} reducedMotion={reducedMotion} />
      <mesh
        geometry={built.front}
        material={built.material}
        position={built.frontPos}
        renderOrder={1}
      />
      <mesh geometry={built.ribbon}>
        <meshBasicMaterial vertexColors transparent side={DoubleSide} toneMapped={false} />
      </mesh>
      {/* Water surface across the slab, seen when tilted. */}
      <mesh position={[waterW / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[waterW, SLAB * 2]} />
        <meshBasicMaterial
          color={`rgb(${pal.shallow.map((v) => Math.round(v * 255)).join(',')})`}
          transparent
          opacity={0.32}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={lines} renderOrder={3}>
        <lineBasicMaterial color="#96cdde" transparent opacity={0.38} toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={dashed} renderOrder={3} visible={!!doProfile}>
        <lineDashedMaterial
          color="#b7c9ce"
          dashSize={2}
          gapSize={3}
          transparent
          opacity={0.32}
          toneMapped={false}
        />
      </lineSegments>
      {doGeo && (
        <>
          <mesh geometry={doGeo.fill} renderOrder={2}>
            <meshBasicMaterial
              vertexColors
              transparent
              side={DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <lineSegments geometry={doGeo.line} renderOrder={4}>
            <lineBasicMaterial vertexColors toneMapped={false} />
          </lineSegments>
          {doProfile!.map((p) => (
            <mesh
              key={p.depthM}
              position={[gX(p.mgL), -Math.min(p.depthM, maxD) * pxPerM, Z + 0.4]}
              renderOrder={5}
            >
              <circleGeometry args={[1.8, 12]} />
              <meshBasicMaterial color="#e8f1f3" toneMapped={false} />
            </mesh>
          ))}
        </>
      )}
      {!doProfile && model.surfaceDoMgL !== undefined && (
        <mesh position={[gX(model.surfaceDoMgL), -22, Z + 0.4]}>
          <circleGeometry args={[2.4, 16]} />
          <meshBasicMaterial color={DO_COLORS.good} toneMapped={false} />
        </mesh>
      )}

      <Species
        placed={placed}
        reducedMotion={reducedMotion}
        portal={portal}
        onHover={onHover}
        model={model}
      />

      {/* Depth ruler */}
      {depthTicks.map((v, i) => (
        <Label
          key={`d${v}`}
          portal={portal}
          at={[comp.rulerX - 8, -(feet ? v / FT_PER_M : v) * pxPerM, Z]}
          anchor="right"
          style={tickText}
          testId="depth-tick"
        >
          {i === 0 ? `${v} ${feet ? 'ft' : 'm'}` : v.toLocaleString('en-US')}
        </Label>
      ))}
      {/* Distance ruler */}
      {distTicks.map((v, i) => (
        <Label
          key={`x${v}`}
          portal={portal}
          at={[(v / lenDisp) * waterW, -comp.distY - 7, Z]}
          anchor="top"
          style={tickText}
          testId="distance-tick"
        >
          {i === distTicks.length - 1
            ? `${v.toLocaleString('en-US')} ${feet ? 'mi' : 'km'}`
            : v.toLocaleString('en-US')}
        </Label>
      ))}
      <Label
        portal={portal}
        at={[waterW + landW, -comp.distY - 24, Z]}
        anchor="top-right"
        style={{ ...capsText, fontSize: 9.5 }}
      >
        Vertical scale {exaggerationLabel(exag)}
      </Label>
      {/* Deepest point */}
      <Label
        portal={portal}
        at={[deepX, -waterH - 7, Z]}
        anchor="top"
        style={{ ...tickText, fontSize: 10.5, color: 'var(--text-2)' }}
      >
        Max depth {fmtDepth(maxD, feet)}
      </Label>
      {/* Layer annotations */}
      {annotations.map((a) => (
        <Label
          key={a.key}
          portal={portal}
          at={[a.x, -a.y, Z]}
          anchor={a.anchor}
          style={{ ...noteText, color: a.key === 'thermo' ? '#e9f6f8' : '#efe9c8' }}
          testId={a.testId}
        >
          {a.text}
        </Label>
      ))}
      {/* Zones */}
      {comp.showZones &&
        zones.map((z) => (
          <Label
            key={z.name}
            portal={portal}
            at={[comp.zoneX, -z.y, Z]}
            anchor="left"
            style={capsText}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 1,
                background: 'var(--line-strong)',
                verticalAlign: 'middle',
                marginRight: 6,
              }}
            />
            {z.name}
          </Label>
        ))}
      {/* DO gauge labels */}
      <Label portal={portal} at={[gx, 6, Z]} anchor="bottom-left" style={capsText}>
        <span style={{ display: 'block' }}>Oxygen</span>
        <span
          style={{ display: 'block', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}
        >
          mg/L
        </span>
      </Label>
      {[0, 5, 10, 15]
        .filter((m) => m <= doMax)
        .map((m) => (
          <Label
            key={`g${m}`}
            portal={portal}
            at={[gX(m), doProfile ? -waterH - 6 : -22 - 6, Z]}
            anchor="top"
            style={{ ...tickText, fontSize: 10 }}
          >
            {m}
          </Label>
        ))}
      {!doProfile && model.surfaceDoMgL !== undefined && (
        <Label
          portal={portal}
          at={[gX(model.surfaceDoMgL), -22 + 5, Z]}
          anchor="bottom"
          style={{ ...tickText, color: 'var(--text)', fontSize: 10.5 }}
        >
          {model.surfaceDoMgL.toFixed(1)}
        </Label>
      )}
      {!doProfile && (
        <Label
          portal={portal}
          at={[gx, -22 - 26, Z]}
          anchor="top-left"
          style={{
            ...noteText,
            whiteSpace: 'normal',
            width: gw + 18,
            color: 'var(--muted)',
            fontStyle: 'italic',
            lineHeight: 1.3,
          }}
        >
          {model.surfaceDoMgL !== undefined ? 'Surface reading only. ' : ''}No depth profile
          measured.
        </Label>
      )}
    </>
  );
}
