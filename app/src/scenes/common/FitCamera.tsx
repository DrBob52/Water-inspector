import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { MathUtils } from 'three';
import { useStageInset } from '../../lib/hooks';
import { useUi } from '../../store';
import { chooseFrame, fitOrientation, type Frame } from '../raised/framing';

interface Props {
  /** Footprint (x by z) and height of the thing to frame, in scene units. */
  width: number;
  depth: number;
  /** Depth below y = 0 to include (used when `bottom` is not given). */
  height?: number;
  /** Vertical extent of the box; defaults to [-height, 0]. */
  top?: number;
  bottom?: number;
  /** Ignored for the auto view, which centres the box in the stage; kept for older callers. */
  target?: [number, number, number];
  /** Preferred camera elevation above the horizon in radians. */
  elevation?: number;
  /** Choose the azimuth (and lift the camera) to suit the block's shape. */
  autoAzimuth?: boolean;
  /** Clear space in CSS pixels around the subject (the view dock, legends and controls). */
  margins?: { left: number; right: number; top: number; bottom: number };
  /** Called with the chosen view, e.g. to place lights relative to the camera. */
  onFrame?: (f: Frame) => void;
}

const DEFAULT_MARGINS = { left: 28, right: 28, top: 72, bottom: 92 };

interface OrbitLike {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/**
 * Frames a block in the visible stage (left of the inspector, clear of the dock and controls) from
 * a three-quarter view. The orientation is chosen once per footprint and stage size, so dragging
 * the exaggeration slider refits the distance without swinging the camera around.
 */
export function FitCamera({
  width,
  depth,
  height = 0,
  top = 0,
  bottom,
  elevation = 0.62,
  autoAzimuth = true,
  margins = DEFAULT_MARGINS,
  onFrame,
}: Props) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const panelOpen = useUi((s) => s.panelOpen);
  const inset = useStageInset(panelOpen);
  const orientation = useRef<{ key: string; az: number; el: number } | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  // Phones: the inspector sheet covers the lower part of the screen and the controls sit at the
  // top, so frame the block in the band between them.
  const phone = size.width <= 720;
  const {
    left,
    right,
    top: mt,
    bottom: mb,
  } = phone
    ? {
        left: 10,
        right: 10,
        top: 170,
        bottom: Math.round(size.height * (panelOpen ? 0.5 : 0.12)),
      }
    : margins;

  useLayoutEffect(() => {
    const box = { width, depth, top, bottom: bottom ?? -height };
    const viewport = {
      width: size.width,
      height: size.height,
      inset,
      margins: { left, right, top: mt, bottom: mb },
      fov: camera.fov,
    };
    const key = [width, depth, size.width, size.height, inset, left, right, mt, mb].join(':');
    let frame: Frame;
    if (orientation.current?.key === key) {
      frame = fitOrientation(box, viewport, orientation.current.az, orientation.current.el);
    } else {
      frame = autoAzimuth
        ? chooseFrame(box, viewport, elevation)
        : fitOrientation(box, viewport, 0, elevation);
      orientation.current = { key, az: frame.azimuth, el: frame.elevation };
    }
    camera.position.set(...frame.position);
    camera.near = Math.max(0.1, frame.distance / 200);
    camera.far = Math.max(camera.far, frame.distance * 6);
    camera.lookAt(...frame.target);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(...frame.target);
      controls.update();
    }
    onFrameRef.current?.(frame);
  }, [
    camera,
    controls,
    size.width,
    size.height,
    inset,
    width,
    depth,
    height,
    top,
    bottom,
    elevation,
    autoAzimuth,
    left,
    right,
    mt,
    mb,
  ]);
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
