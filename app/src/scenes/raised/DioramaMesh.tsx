import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  RGBAFormat,
  Shape,
  ShapeGeometry,
  UnsignedByteType,
  type Mesh,
  type Vector3,
} from 'three';
import type { SceneModel, StationInfo } from '@wi/shared';
import { createWaterMaterial, waterClarity } from '../common/waterMaterial';
import {
  PLINTH_HEIGHT_UNITS,
  PLINTH_PAD_UNITS,
  applyExaggeration,
  blockBase,
  stationOnScene,
  type Diorama,
} from './diorama';
import {
  createFloorMaterial,
  createTerrainMaterial,
  createWallMaterial,
  haloTexture,
} from './materials';

interface Props {
  model: SceneModel;
  dio: Diorama;
  exaggeration: number;
  showWater: boolean;
  /** Clear glass water (Raised Terrain) or a dark translucent volume (Pollutants). */
  waterStyle?: 'clear' | 'dark';
  showContours?: boolean;
  reducedMotion: boolean;
  /** Direction toward the light that glints on the water. */
  glint?: Vector3;
  selectedStation?: string | null;
  onStation?: (s: StationInfo | null) => void;
}

const BEACON = '#ffc978';
const BEACON_SELECTED = '#fff1c9';

function Beacon({
  station,
  position,
  selected,
  reducedMotion,
  onSelect,
}: {
  station: StationInfo;
  position: [number, number, number];
  selected: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
}) {
  const ring = useRef<Mesh>(null);
  const phase = useMemo(() => (station.id.length * 0.77) % (Math.PI * 2), [station.id]);
  useFrame((s) => {
    if (!ring.current) return;
    const t = reducedMotion ? 0.35 : (s.clock.elapsedTime * 0.45 + phase / 6.28) % 1;
    ring.current.scale.setScalar(0.6 + t * 1.8);
    const mat = ring.current.material as { opacity: number };
    mat.opacity = (1 - t) * (selected ? 0.75 : 0.45);
  });
  const stem = 3.2;
  const color = selected ? BEACON_SELECTED : BEACON;
  return (
    <group
      position={position}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <mesh position={[0, stem / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, stem, 8]} />
        <meshStandardMaterial color="#d9e4e8" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, stem + 0.2, 0]}>
        <sphereGeometry args={[selected ? 0.42 : 0.33, 20, 14]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <sprite position={[0, stem + 0.2, 0]} scale={selected ? 4 : 3}>
        <spriteMaterial
          map={haloTexture()}
          color={color}
          transparent
          opacity={selected ? 0.95 : 0.7}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={5}>
        <ringGeometry args={[0.42, 0.52, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.4}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Generous invisible hit target. */}
      <mesh position={[0, stem * 0.6, 0]}>
        <cylinderGeometry args={[0.9, 0.9, stem * 1.4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The terrain block on its plinth: carved relief, strata walls, glassy water and station beacons. */
export function DioramaMesh({
  model,
  dio,
  exaggeration,
  showWater,
  waterStyle = 'clear',
  showContours = true,
  reducedMotion,
  glint,
  selectedStation,
  onStation,
}: Props) {
  const terrain = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(dio.positions, 3));
    g.setAttribute('color', new BufferAttribute(dio.colors, 3));
    g.setAttribute('aElev', new BufferAttribute(dio.elevM, 1));
    g.setAttribute('aShore', new BufferAttribute(dio.shoreM, 1));
    g.setIndex(new BufferAttribute(dio.indices, 1));
    return g;
  }, [dio]);
  const walls = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(dio.wall.positions, 3));
    g.setAttribute('normal', new BufferAttribute(dio.wall.normals, 3));
    g.setAttribute('aTop', new BufferAttribute(dio.wall.top, 1));
    g.setAttribute('aAlong', new BufferAttribute(dio.wall.along, 1));
    g.setIndex(new BufferAttribute(dio.wall.indices, 1));
    return g;
  }, [dio]);
  const glass = useMemo(() => {
    if (!dio.glass.indices.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(dio.glass.positions, 3));
    g.setIndex(new BufferAttribute(dio.glass.indices, 1));
    return g;
  }, [dio]);
  const water = useMemo(() => {
    const shape = new Shape(dio.outlineU.map(([x, y]) => ({ x, y }) as never));
    shape.closePath();
    return new ShapeGeometry(shape);
  }, [dio]);
  const depthTex = useMemo(() => {
    const t = new DataTexture(
      dio.waterTex.data,
      dio.waterTex.width,
      dio.waterTex.height,
      RGBAFormat,
      UnsignedByteType,
    );
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [dio]);
  const terrainMat = useMemo(() => createTerrainMaterial(), []);
  const wallMat = useMemo(() => createWallMaterial(), []);
  const floorMat = useMemo(
    () =>
      createFloorMaterial(
        dio.widthU / 2 + PLINTH_PAD_UNITS + 0.6,
        dio.heightU / 2 + PLINTH_PAD_UNITS + 0.6,
      ),
    [dio],
  );
  const waterMat = useMemo(() => {
    const { grid, S } = dio;
    // world x -> u, world z -> v (texel centres at (i + 0.5) / nx)
    const sx = 1 / (S * grid.cellX * grid.nx);
    const ox = (dio.blockW / 2 / grid.cellX + 0.5) / grid.nx;
    const sz = -1 / (S * grid.cellY * grid.ny);
    const oz = (dio.blockH / 2 / grid.cellY + 0.5) / grid.ny;
    return createWaterMaterial({
      tint: model.waterTint,
      clarity: waterClarity(model.visibilityM),
      depthTexture: depthTex,
      uv: [sx, ox, sz, oz],
      shoreScale: dio.waterTex.shoreScaleM * S,
      foamWidth: Math.max(0.12, 0.6 * Math.max(grid.cellX, grid.cellY) * S),
      dark: waterStyle === 'dark',
    });
  }, [dio, depthTex, model.waterTint, model.visibilityM, waterStyle]);

  useEffect(() => {
    terrainMat.uniforms.uInterval.value = dio.contourInterval;
    terrainMat.uniforms.uShoreBand.value = 1.3 * Math.max(dio.grid.cellX, dio.grid.cellY);
    terrainMat.uniforms.uContour.value = showContours ? (showWater ? 0.2 : 0.42) : 0;
    terrainMat.uniforms.uBedDim.value = waterStyle === 'dark' ? 0.3 : 1;
  }, [terrainMat, dio, showContours, showWater, waterStyle]);
  useEffect(() => {
    if (glint) waterMat.uniforms.uLightDir.value.copy(glint);
  }, [waterMat, glint]);

  // Vertical exaggeration: update buffers in place, then recompute terrain normals.
  useEffect(() => {
    applyExaggeration(dio, exaggeration);
    terrain.attributes.position.needsUpdate = true;
    terrain.computeVertexNormals();
    terrain.computeBoundingSphere();
    walls.attributes.position.needsUpdate = true;
    walls.attributes.aTop.needsUpdate = true;
    walls.computeBoundingSphere();
    if (glass) {
      glass.attributes.position.needsUpdate = true;
      glass.computeBoundingSphere();
    }
    const base = blockBase(dio, exaggeration);
    wallMat.uniforms.uBase.value = base;
    // Roughly ten strata over the height of the cut face, whatever the exaggeration.
    wallMat.uniforms.uBand.value = Math.max(
      1,
      Math.min(5, (dio.landMaxU * exaggeration - base) / 10),
    );
  }, [dio, exaggeration, terrain, walls, glass, wallMat]);

  useEffect(
    () => () => {
      terrain.dispose();
      walls.dispose();
      glass?.dispose();
      water.dispose();
      depthTex.dispose();
      waterMat.dispose();
      floorMat.dispose();
    },
    [terrain, walls, glass, water, depthTex, waterMat, floorMat],
  );
  useEffect(
    () => () => {
      terrainMat.material.dispose();
      wallMat.material.dispose();
    },
    [terrainMat, wallMat],
  );
  useFrame((s) => {
    waterMat.uniforms.uTime.value = reducedMotion ? 0 : s.clock.elapsedTime;
  });

  const pins = useMemo(
    () => model.stations.map((st) => ({ st, ...stationOnScene(dio, st.lon, st.lat) })),
    [model.stations, dio],
  );
  const base = blockBase(dio, exaggeration);
  const plinthW = dio.widthU + 2 * PLINTH_PAD_UNITS;
  const plinthD = dio.heightU + 2 * PLINTH_PAD_UNITS;

  return (
    <group>
      <mesh geometry={terrain} material={terrainMat.material} castShadow receiveShadow />
      <mesh geometry={walls} material={wallMat.material} castShadow receiveShadow />
      {glass && showWater && (
        <mesh geometry={glass} renderOrder={2}>
          <meshPhysicalMaterial
            color={waterStyle === 'dark' ? '#06202c' : '#2a8fa6'}
            transparent
            opacity={waterStyle === 'dark' ? 0.55 : 0.42}
            roughness={0.08}
            metalness={0}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* Plinth */}
      <mesh position={[0, base - PLINTH_HEIGHT_UNITS / 2, 0]} receiveShadow>
        <boxGeometry args={[plinthW, PLINTH_HEIGHT_UNITS, plinthD]} />
        <meshStandardMaterial color="#0f1b21" roughness={0.55} metalness={0.25} />
      </mesh>
      <mesh position={[0, base - 0.04, 0]}>
        <boxGeometry args={[plinthW + 0.08, 0.08, plinthD + 0.08]} />
        <meshStandardMaterial color="#2c4752" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, base - PLINTH_HEIGHT_UNITS - 0.02, 0]}
        material={floorMat}
        renderOrder={-1}
      >
        <planeGeometry args={[Math.max(plinthW, plinthD) * 6, Math.max(plinthW, plinthD) * 6]} />
      </mesh>
      {showWater && (
        <mesh
          geometry={water}
          material={waterMat}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.03, 0]}
          renderOrder={3}
        />
      )}
      {pins.map(({ st, x, z, rawY }) => (
        <Beacon
          key={st.id}
          station={st}
          position={[x, Math.max(rawY, 0) * exaggeration, z]}
          selected={selectedStation === st.id}
          reducedMotion={reducedMotion}
          onSelect={() => onStation?.(selectedStation === st.id ? null : st)}
        />
      ))}
    </group>
  );
}
