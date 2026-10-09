import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { PCFSoftShadowMap, Vector3, type DirectionalLight } from 'three';
import { useRenderQuality } from '../common/SceneCanvas';
import type { Frame } from './framing';
import { backdropTexture } from './materials';

export type StageMood = 'gallery' | 'night';

/** Camera azimuth from the auto framing, used to place the lights around the block. */
export function useFrameAzimuth() {
  const [azimuth, setAzimuth] = useState(0.5);
  const onFrame = useCallback((f: Frame) => setAzimuth(f.azimuth), []);
  return { azimuth, onFrame };
}

/** Direction (unit vector toward the light) at an azimuth and elevation in radians. */
export function lightDirection(az: number, el: number): Vector3 {
  return new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/**
 * Light rig relative to the camera azimuth: a warm key low over the front-left corner (lights the
 * cut face and rakes across the relief), a cool sky fill from the right, a pale rim from behind
 * and a direction for the water's glint (behind the block, so it reflects toward the viewer).
 */
export function lightRig(cameraAzimuth: number) {
  return {
    key: lightDirection(cameraAzimuth - 0.6, 0.5),
    fill: lightDirection(cameraAzimuth + 1.0, 0.3),
    rim: lightDirection(cameraAzimuth + Math.PI - 0.3, 0.5),
    glint: lightDirection(cameraAzimuth + Math.PI + 0.35, 0.3),
  };
}

const MOODS = {
  gallery: { key: 3.0, fill: 0.85, rim: 0.9, hemi: 0.5, bloom: 0.45, threshold: 0.9 },
  night: { key: 1.25, fill: 0.4, rim: 0.55, hemi: 0.22, bloom: 0.75, threshold: 0.32 },
};

interface Props {
  azimuth: number;
  /** Half the largest dimension of the scene, for the shadow camera. */
  radius: number;
  mood?: StageMood;
}

/** Background, lights, soft shadows and restrained post-processing for the diorama views. */
export function DioramaStage({ azimuth, radius, mood = 'gallery' }: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const quality = useRenderQuality();
  const m = MOODS[mood];
  const rig = useMemo(() => lightRig(azimuth), [azimuth]);
  const dist = radius * 3;

  useLayoutEffect(() => {
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = PCFSoftShadowMap;
    gl.shadowMap.needsUpdate = true;
  }, [gl]);
  useEffect(() => {
    const prev = scene.background;
    const tex = backdropTexture();
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene]);

  const shadowRef = (l: DirectionalLight | null) => {
    if (!l) return;
    const c = l.shadow.camera;
    c.left = -radius * 1.15;
    c.right = radius * 1.15;
    c.top = radius * 1.15;
    c.bottom = -radius * 1.15;
    c.near = dist * 0.2;
    c.far = dist * 2.2;
    c.updateProjectionMatrix();
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.12;
    l.shadow.radius = 4;
  };

  const post = quality >= 0.5;
  return (
    <>
      <hemisphereLight args={['#a9c8e6', '#3a2f25', m.hemi]} />
      <directionalLight
        ref={shadowRef}
        position={rig.key.clone().multiplyScalar(dist).toArray()}
        color="#ffd9ad"
        intensity={m.key}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight
        position={rig.fill.clone().multiplyScalar(dist).toArray()}
        color="#8db6e2"
        intensity={m.fill}
      />
      <directionalLight
        position={rig.rim.clone().multiplyScalar(dist).toArray()}
        color="#d4e8ff"
        intensity={m.rim}
      />
      {post && (
        <EffectComposer multisampling={quality >= 0.9 ? 4 : 0}>
          <Bloom
            intensity={m.bloom}
            luminanceThreshold={m.threshold}
            luminanceSmoothing={0.3}
            mipmapBlur
          />
          <Vignette offset={0.32} darkness={0.55} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}
