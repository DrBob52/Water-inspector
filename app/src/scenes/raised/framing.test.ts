import { describe, expect, it } from 'vitest';
import {
  chooseFrame,
  fitOrientation,
  stageRect,
  type FrameBox,
  type FrameViewport,
} from './framing';

const viewport: FrameViewport = {
  width: 1440,
  height: 900,
  inset: 464,
  margins: { left: 28, right: 28, top: 72, bottom: 92 },
  fov: 38,
};

function projectedCorners(box: FrameBox, v: FrameViewport, az: number, el: number) {
  const f = fitOrientation(box, v, az, el);
  const [px, py, pz] = f.position;
  const [tx, ty, tz] = f.target;
  const fwd = [tx - px, ty - py, tz - pz];
  const fl = Math.hypot(fwd[0], fwd[1], fwd[2]);
  const F = fwd.map((x) => x / fl);
  const rl = Math.hypot(F[2], F[0]);
  const R = [-F[2] / rl, 0, F[0] / rl];
  const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  const tanV = Math.tan((v.fov * Math.PI) / 360);
  const tanH = tanV * (v.width / v.height);
  const out: Array<[number, number]> = [];
  for (const x of [-box.width / 2, box.width / 2])
    for (const y of [box.bottom, box.top])
      for (const z of [-box.depth / 2, box.depth / 2]) {
        const q = [x - px, y - py, z - pz];
        const d = q[0] * F[0] + q[1] * F[1] + q[2] * F[2];
        out.push([
          (q[0] * R[0] + q[1] * R[1] + q[2] * R[2]) / (d * tanH),
          (q[0] * U[0] + q[1] * U[1] + q[2] * U[2]) / (d * tanV),
        ]);
      }
  return { frame: f, pts: out };
}

describe('diorama framing', () => {
  const square: FrameBox = { width: 103, depth: 103, top: 8, bottom: -14 };
  const champlain: FrameBox = { width: 24, depth: 103, top: 5, bottom: -10 };

  it('keeps the stage clear of the inspector, the dock and the controls', () => {
    const r = stageRect(viewport);
    // The stage is the left 976 px; the projection centre is shifted into its middle.
    expect(r.x0).toBeCloseTo(((28 + 232) / 1440) * 2 - 1, 6);
    expect(r.x1).toBeCloseTo(((1440 - 232 - 28) / 1440) * 2 - 1, 6);
    expect(r.y1).toBeCloseTo(1 - (72 / 900) * 2, 6);
  });

  it('fits every corner of the block inside the stage, touching at least one edge', () => {
    for (const [az, el] of [
      [0.5, 0.62],
      [0.9, 1.0],
      [0, 0.45],
    ]) {
      const { pts } = projectedCorners(square, viewport, az, el);
      const r = stageRect(viewport);
      let slack = Infinity;
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(r.x0 - 1e-6);
        expect(x).toBeLessThanOrEqual(r.x1 + 1e-6);
        expect(y).toBeGreaterThanOrEqual(r.y0 - 1e-6);
        expect(y).toBeLessThanOrEqual(r.y1 + 1e-6);
        slack = Math.min(slack, x - r.x0, r.x1 - x, y - r.y0, r.y1 - y);
      }
      expect(slack).toBeLessThan(0.02);
    }
  });

  it('uses a three-quarter view for square blocks', () => {
    const f = chooseFrame(square, viewport);
    expect(f.azimuth).toBeGreaterThan(0.2);
    expect(f.azimuth).toBeLessThan(0.8);
    expect(f.elevation).toBeGreaterThan(0.5);
    expect(f.elevation).toBeLessThan(0.85);
  });

  it('turns and lifts the camera for a long north-south lake so it reads across the stage', () => {
    const f = chooseFrame(champlain, viewport);
    const head = fitOrientation(champlain, viewport, 0, 0.62);
    expect(f.azimuth).toBeGreaterThan(0.6);
    expect(f.elevation).toBeGreaterThan(0.8);
    expect(f.coverage).toBeGreaterThan(head.coverage);
  });
});
