import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Points } from 'three';
import { BufferAttribute, BufferGeometry, PointsMaterial } from 'three';
import { mulberry32 } from '../fish/boids';
import { useRenderQuality } from '../common/SceneCanvas';

interface Props {
  count: number;
  color: string;
  size: number;
  opacity: number;
  seed: number;
  reducedMotion: boolean;
  /** Vertical range below the surface (metres). */
  depthRange: [number, number];
}

/** Suspended particles (sediment specks or algae), scaled with turbidity or chlorophyll-a. */
export function Particles({ count, color, size, opacity, seed, reducedMotion, depthRange }: Props) {
  const quality = useRenderQuality();
  const ref = useRef<Points>(null);
  const { geometry, material } = useMemo(() => {
    const rng = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rng() - 0.5) * 120;
      pos[i * 3 + 1] = -(depthRange[0] + rng() * (depthRange[1] - depthRange[0]));
      pos[i * 3 + 2] = (rng() - 0.5) * 120;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const m = new PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: true,
    });
    return { geometry: g, material: m };
  }, [count, color, size, opacity, seed, depthRange]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((_s, dt) => {
    const p = ref.current;
    if (!p) return;
    p.geometry.setDrawRange(0, Math.ceil(count * quality));
    if (!reducedMotion) p.rotation.y += dt * 0.004;
  });
  if (count <= 0) return null;
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
