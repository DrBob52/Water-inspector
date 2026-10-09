/**
 * Camera framing for the diorama: choose a pleasing three-quarter view and fit the whole block
 * (plinth included) into the visible stage, which is the canvas minus the inspector on the right,
 * the view dock at the top and the controls at the bottom.
 */

export interface FrameBox {
  /** Footprint along x and z (scene units), centred on the origin. */
  width: number;
  depth: number;
  /** Vertical extent (scene units). */
  top: number;
  bottom: number;
}

export interface FrameViewport {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Pixels hidden behind the inspector on the right (the projection centre is shifted by half). */
  inset: number;
  /** Clear space to keep around the subject, in CSS pixels. */
  margins: { left: number; right: number; top: number; bottom: number };
  /** Vertical field of view in degrees. */
  fov: number;
}

export interface Frame {
  azimuth: number;
  elevation: number;
  target: [number, number, number];
  position: [number, number, number];
  distance: number;
  /** Fraction of the stage covered by the block's top face (bigger reads better). */
  coverage: number;
  /** On-screen length of the face's shorter centre line, over the stage height. */
  shortAxis: number;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function basis(az: number, el: number) {
  const dir: V3 = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const f: V3 = [-dir[0], -dir[1], -dir[2]];
  // right = normalize(f x up), up = right x f
  const rl = Math.hypot(f[2], f[0]) || 1;
  const r: V3 = [-f[2] / rl, 0, f[0] / rl];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { dir, f, r, u };
}

function corners(b: FrameBox): V3[] {
  const out: V3[] = [];
  for (const x of [-b.width / 2, b.width / 2])
    for (const y of [b.bottom, b.top])
      for (const z of [-b.depth / 2, b.depth / 2]) out.push([x, y, z]);
  return out;
}

/** The allowed rectangle in normalised device coordinates of the un-offset projection. */
export function stageRect(v: FrameViewport) {
  const W = Math.max(1, v.width);
  const H = Math.max(1, v.height);
  const half = v.inset / 2;
  const x0 = ((v.margins.left + half) / W) * 2 - 1;
  const x1 = ((W - half - v.margins.right) / W) * 2 - 1;
  const y1 = 1 - (v.margins.top / H) * 2;
  const y0 = -1 + (v.margins.bottom / H) * 2;
  // Never let margins invert the rectangle on tiny canvases.
  return {
    x0: Math.min(x0, -0.2),
    x1: Math.max(x1, 0.2),
    y0: Math.min(y0, -0.2),
    y1: Math.max(y1, 0.2),
  };
}

/** Fit the box for one camera orientation: centre it in the stage, then pull back until it fits. */
export function fitOrientation(box: FrameBox, v: FrameViewport, az: number, el: number): Frame {
  const { dir, f, r, u } = basis(az, el);
  const tanV = Math.tan((v.fov * Math.PI) / 180 / 2);
  const tanH = tanV * (Math.max(1, v.width) / Math.max(1, v.height));
  const rect = stageRect(v);
  const rcx = (rect.x0 + rect.x1) / 2;
  const rcy = (rect.y0 + rect.y1) / 2;
  const pts = corners(box);
  const t: V3 = [0, (box.top + box.bottom) / 2, 0];
  let d = (2 * Math.max(box.width, box.depth, box.top - box.bottom)) / tanV;

  const project = () => {
    const cam: V3 = [t[0] + dir[0] * d, t[1] + dir[1] * d, t[2] + dir[2] * d];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const q: V3 = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      const z = Math.max(1e-3, dot(q, f));
      const x = dot(q, r) / (z * tanH);
      const y = dot(q, u) / (z * tanV);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY };
  };

  for (let it = 0; it < 10; it++) {
    const b = project();
    const s = Math.max(
      (b.maxX - b.minX) / (rect.x1 - rect.x0),
      (b.maxY - b.minY) / (rect.y1 - rect.y0),
    );
    const sx = ((b.minX + b.maxX) / 2 - rcx) * tanH * d;
    const sy = ((b.minY + b.maxY) / 2 - rcy) * tanV * d;
    for (let k = 0; k < 3; k++) t[k] += r[k] * sx + u[k] * sy;
    d *= Math.max(0.5, Math.min(2, s));
  }
  // Exact pass: the smallest distance at which every corner is inside the rectangle.
  let need = 0;
  for (const p of pts) {
    const q: V3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
    const px = dot(q, r);
    const py = dot(q, u);
    const pz = dot(q, f);
    const lim = (a: number, lo: number, hi: number, tan: number) =>
      a > 0 ? a / (hi * tan) - pz : a < 0 ? a / (lo * tan) - pz : -pz;
    need = Math.max(need, lim(px, rect.x0, rect.x1, tanH), lim(py, rect.y0, rect.y1, tanV));
  }
  d = Math.max(need, 1);

  // Coverage: area of the top face (at the water level) over the stage area, both in NDC.
  const cam: V3 = [t[0] + dir[0] * d, t[1] + dir[1] * d, t[2] + dir[2] * d];
  const face: Array<[number, number]> = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([sx, sz]) => {
    const q: V3 = [(sx * box.width) / 2 - cam[0], -cam[1], (sz * box.depth) / 2 - cam[2]];
    const z = Math.max(1e-3, dot(q, f));
    return [dot(q, r) / (z * tanH), dot(q, u) / (z * tanV)];
  });
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = face[i];
    const [bx, by] = face[(i + 1) % 4];
    area += ax * by - bx * ay;
  }
  const coverage = Math.abs(area) / 2 / ((rect.x1 - rect.x0) * (rect.y1 - rect.y0));
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const len = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lx = len(mid(face[0], face[3]), mid(face[1], face[2]));
  const lz = len(mid(face[0], face[1]), mid(face[2], face[3]));
  const shortAxis = Math.min(lx, lz) / (rect.y1 - rect.y0);
  return { azimuth: az, elevation: el, target: t, position: cam, distance: d, coverage, shortAxis };
}

/**
 * Pick the camera orientation: a three-quarter view from the south-east by default, turning and
 * rising for long narrow blocks (Lake Champlain) so the water stays readable instead of a sliver.
 */
export function chooseFrame(box: FrameBox, v: FrameViewport, preferredElevation = 0.62): Frame {
  const aspect = Math.max(box.width, box.depth) / Math.max(1e-6, Math.min(box.width, box.depth));
  const long = Math.min(1, Math.max(0, (aspect - 1.3) / 2.5));
  // Square blocks: a classic three-quarter view from the south-east. Long east-west blocks: from
  // nearly south, so the long axis runs across the stage. Long north-south blocks: turn the
  // camera so the long axis runs diagonally, and look down more steeply.
  const az0 = aspect < 1.35 ? 0.52 : box.width >= box.depth ? 0.35 : 0.96;
  const el0 = preferredElevation + 0.4 * long;
  let best: Frame | null = null;
  let bestScore = -Infinity;
  for (let a = 0; a <= 90; a += 5) {
    for (let e = 0.45; e <= 1.251; e += 0.05) {
      const az = (a * Math.PI) / 180;
      const fr = fitOrientation(box, v, az, e);
      const elPref = Math.exp(-(((e - el0) / 0.25) ** 2));
      const azPref = Math.exp(-(((az - az0) / 0.45) ** 2));
      const score = fr.coverage * elPref * azPref;
      if (score > bestScore) {
        bestScore = score;
        best = fr;
      }
    }
  }
  return best!;
}
