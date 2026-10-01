import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { MathUtils } from 'three';

interface Props {
  /** Footprint (x by z) and height of the thing to frame, in scene units. */
  width: number;
  depth: number;
  height?: number;
  target?: [number, number, number];
  /** Camera elevation above the horizon in radians. */
  elevation?: number;
  /** Look from the east instead of the south when the block is much taller than wide. */
  autoAzimuth?: boolean;
}

/** Frames a block to the canvas aspect ratio: fits its width and its foreshortened depth. */
export function FitCamera({
  width,
  depth,
  height = 0,
  target = [0, 0, 0],
  elevation = 0.62,
  autoAzimuth = true,
}: Props) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vFov = MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const fromEast = autoAzimuth && depth > width * 1.4;
    // A long thin block seen from the side needs a steeper look-down to show the water.
    const el = fromEast ? Math.max(elevation, 1.0) : elevation;
    const across = fromEast ? depth : width; // extent seen left to right
    const along = fromEast ? width : depth; // extent seen into the screen
    const vExtent = along * Math.sin(el) + height * Math.cos(el);
    const dH = ((across / 2) * 1.12) / Math.tan(hFov / 2);
    const dV = ((vExtent / 2) * 1.25) / Math.tan(vFov / 2);
    const d = Math.max(dH, dV, 10) + along * 0.5 * Math.cos(el);
    const az = fromEast ? Math.PI / 2 : 0;
    camera.position.set(
      target[0] + d * Math.cos(el) * Math.sin(az),
      target[1] + d * Math.sin(el),
      target[2] + d * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, width, depth, height, elevation, autoAzimuth, target]);
  return null;
}

interface PanelProps {
  width: number;
  height: number;
  centreY: number;
}

/** Fits a flat panel facing +Z (used by the cross-section). */
export function FitPanel({ width, height, centreY }: PanelProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vFov = MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const d = Math.max(width / 2 / Math.tan(hFov / 2), height / 2 / Math.tan(vFov / 2));
    camera.position.set(0, centreY, d);
    camera.lookAt(0, centreY, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, width, height, centreY]);
  return null;
}
