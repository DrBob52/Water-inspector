import { useEffect, useMemo } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, DoubleSide, Shape, ShapeGeometry } from 'three';
import type { SceneModel, StationInfo } from '@wi/shared';
import { createWaterMaterial } from '../common/waterMaterial';
import { applyExaggeration, stationOnScene, type Diorama } from './diorama';

interface Props {
  model: SceneModel;
  dio: Diorama;
  exaggeration: number;
  showWater: boolean;
  waterOpacity?: number;
  showContours?: boolean;
  reducedMotion: boolean;
  selectedStation?: string | null;
  onStation?: (s: StationInfo | null) => void;
}

/** The terrain block with bed, walls, translucent water, depth contours and station pins. */
export function DioramaMesh({
  model,
  dio,
  exaggeration,
  showWater,
  waterOpacity = 0.62,
  showContours = true,
  reducedMotion,
  selectedStation,
  onStation,
}: Props) {
  const terrain = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(dio.positions, 3));
    g.setAttribute('color', new BufferAttribute(dio.colors, 3));
    g.setIndex(new BufferAttribute(dio.indices, 1));
    return g;
  }, [dio]);
  const walls = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(dio.wall.positions, 3));
    g.setAttribute('normal', new BufferAttribute(dio.wall.normals, 3));
    g.setAttribute('color', new BufferAttribute(dio.wall.colors, 3));
    g.setIndex(new BufferAttribute(dio.wall.indices, 1));
    return g;
  }, [dio]);
  const water = useMemo(() => {
    const pts = dio.outlineU;
    const shape = new Shape(pts.map(([x, y]) => ({ x, y }) as never));
    shape.closePath();
    return new ShapeGeometry(shape);
  }, [dio]);
  const waterMat = useMemo(
    () => createWaterMaterial(model.waterTint, waterOpacity),
    [model.waterTint, waterOpacity],
  );
  const contourGeoms = useMemo(
    () =>
      dio.contours.map((c) => {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(c.positions, 3));
        return g;
      }),
    [dio],
  );

  // Vertical exaggeration: update buffers in place, then recompute terrain normals.
  useEffect(() => {
    applyExaggeration(dio, exaggeration);
    terrain.attributes.position.needsUpdate = true;
    terrain.computeVertexNormals();
    terrain.computeBoundingSphere();
    walls.attributes.position.needsUpdate = true;
    walls.computeBoundingSphere();
    contourGeoms.forEach((g) => {
      g.attributes.position.needsUpdate = true;
    });
  }, [dio, exaggeration, terrain, walls, contourGeoms]);

  useEffect(
    () => () => {
      terrain.dispose();
      walls.dispose();
      water.dispose();
      waterMat.dispose();
      contourGeoms.forEach((g) => g.dispose());
    },
    [terrain, walls, water, waterMat, contourGeoms],
  );
  useFrame((s) => {
    waterMat.uniforms.uTime.value = reducedMotion ? 0 : s.clock.elapsedTime;
  });

  const pins = useMemo(
    () => model.stations.map((st) => ({ st, ...stationOnScene(dio, st.lon, st.lat) })),
    [model.stations, dio],
  );

  return (
    <group>
      <mesh geometry={terrain}>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={walls}>
        <meshStandardMaterial vertexColors roughness={1} metalness={0} side={DoubleSide} />
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
      {showContours &&
        contourGeoms.map((g, i) => (
          <lineSegments key={dio.contours[i].level} geometry={g}>
            <lineBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} />
          </lineSegments>
        ))}
      {pins.map(({ st, x, z, rawY }) => {
        const y = Math.max(rawY, 0) * exaggeration;
        const selected = selectedStation === st.id;
        return (
          <group
            key={st.id}
            position={[x, y, z]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onStation?.(selected ? null : st);
            }}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}
          >
            <mesh position={[0, 1.4, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 2.8, 8]} />
              <meshStandardMaterial color="#f5f5f5" />
            </mesh>
            <mesh position={[0, 3.0, 0]}>
              <sphereGeometry args={[selected ? 0.75 : 0.55, 16, 12]} />
              <meshStandardMaterial
                color={selected ? '#ffb703' : '#e8590c'}
                emissive={selected ? '#ffb703' : '#7a2c00'}
                emissiveIntensity={0.6}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
