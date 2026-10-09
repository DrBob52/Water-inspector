import { BufferAttribute, Color, Shape, ShapeGeometry, type BufferGeometry } from 'three';
import type { CatalogColors } from '@wi/shared';

/**
 * Flat side-view silhouettes for the cross-section, one per archetype. Each icon is 1 unit long from
 * the tail tip (x = -0.5) to the snout (x = +0.5), facing +x, centred on y = 0.
 */
export interface IconParts {
  body: BufferGeometry;
  /** Tail, drawn around its own pivot at `tailPivot` so it can beat. */
  tail: BufferGeometry | null;
  tailPivot: [number, number];
  fins: BufferGeometry | null;
  /** Thin darker detail strokes (barbels, shell growth lines, leg segments). */
  detail: BufferGeometry | null;
  eye: [number, number] | null;
  /** Half height of the whole icon, in icon units, for layout. */
  halfH: number;
  /** Whether it swims (tail beat and drift) or sits still. */
  swims: boolean;
}

type Path = (s: Shape) => void;

const shape = (draw: Path) => {
  const s = new Shape();
  draw(s);
  return s;
};

/** Fusiform-style body outline with a given half height and snout bluntness. */
function fishBody(hh: number, opts: { blunt?: number; peak?: number; flatBelly?: boolean } = {}) {
  const blunt = opts.blunt ?? 0.5;
  const peak = opts.peak ?? 0.05;
  const belly = opts.flatBelly ? 0.7 : 1;
  const ped = Math.max(0.018, hh * 0.28);
  return shape((s) => {
    s.moveTo(0.5, -hh * 0.05);
    s.bezierCurveTo(0.5, hh * (0.35 + blunt * 0.4), 0.38, hh * 0.98, peak + 0.12, hh);
    s.bezierCurveTo(-0.1, hh * 1.0, -0.26, hh * 0.45, -0.34, ped);
    s.lineTo(-0.34, -ped);
    s.bezierCurveTo(
      -0.26,
      -hh * 0.42 * belly,
      -0.08,
      -hh * 0.95 * belly,
      peak + 0.12,
      -hh * 0.92 * belly,
    );
    s.bezierCurveTo(0.36, -hh * 0.9 * belly, 0.5, -hh * (0.3 + blunt * 0.3), 0.5, -hh * 0.05);
  });
}

function forkedTail(hh: number, depth = 0.6) {
  const h = Math.max(0.07, hh * 1.05);
  return shape((s) => {
    s.moveTo(0.02, 0.025);
    s.quadraticCurveTo(-0.07, h * 0.55, -0.15, h);
    s.quadraticCurveTo(-0.12 + depth * 0.12, 0, -0.15, -h);
    s.quadraticCurveTo(-0.07, -h * 0.55, 0.02, -0.025);
    s.closePath();
  });
}

function roundTail(hh: number) {
  const h = Math.max(0.06, hh * 0.9);
  return shape((s) => {
    s.moveTo(0.02, 0.03);
    s.bezierCurveTo(-0.06, h, -0.16, h, -0.16, 0);
    s.bezierCurveTo(-0.16, -h, -0.06, -h, 0.02, -0.03);
    s.closePath();
  });
}

function dorsal(x0: number, x1: number, base: number, height: number) {
  return (s: Shape) => {
    s.moveTo(x1, base - 0.01);
    s.quadraticCurveTo(
      x1 - (x1 - x0) * 0.2,
      base + height,
      x0 + (x1 - x0) * 0.1,
      base + height * 0.6,
    );
    s.lineTo(x0, base - 0.01);
    s.closePath();
  };
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0) {
  return shape((s) => s.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, rot));
}

/** Vertical colour ramp belly -> side -> back over the geometry's height. */
function paint(geo: BufferGeometry, colors: CatalogColors): BufferGeometry {
  const pos = geo.getAttribute('position');
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  const belly = new Color(colors.belly);
  const side = new Color(colors.side);
  const back = new Color(colors.back);
  const c = new Color();
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / Math.max(maxY - minY, 1e-6);
    if (t < 0.45) c.copy(belly).lerp(side, t / 0.45);
    else c.copy(side).lerp(back, Math.min(1, (t - 0.45) / 0.45));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
}

const geom = (shapes: Shape | Shape[]) => new ShapeGeometry(shapes, 10);

export function buildIcon(archetype: string, colors: CatalogColors): IconParts {
  const fish = (
    hh: number,
    o: {
      tail?: 'forked' | 'round';
      blunt?: number;
      peak?: number;
      flatBelly?: boolean;
      dorsal?: [number, number, number];
      barbels?: boolean;
    } = {},
  ): IconParts => {
    const d = o.dorsal ?? [-0.08, 0.14, 0.12];
    const finShapes = [
      shape(dorsal(d[0], d[1], hh * 0.86, hh * 0.25 + d[2] * 0.4)),
      // pelvic and anal fins
      shape((s) => {
        s.moveTo(0.06, -hh * 0.85);
        s.lineTo(-0.02, -hh * 1.15);
        s.lineTo(-0.04, -hh * 0.8);
        s.closePath();
      }),
      shape((s) => {
        s.moveTo(-0.14, -hh * 0.62);
        s.lineTo(-0.24, -hh * 0.82);
        s.lineTo(-0.27, -hh * 0.42);
        s.closePath();
      }),
    ];
    let detail: BufferGeometry | null = null;
    if (o.barbels) {
      detail = geom([
        shape((s) => {
          s.moveTo(0.48, -hh * 0.2);
          s.quadraticCurveTo(0.56, -hh * 0.6, 0.5, -hh * 1.05);
          s.lineTo(0.49, -hh * 1.0);
          s.quadraticCurveTo(0.54, -hh * 0.6, 0.46, -hh * 0.25);
          s.closePath();
        }),
        shape((s) => {
          s.moveTo(0.47, hh * 0.1);
          s.quadraticCurveTo(0.6, hh * 0.25, 0.62, -hh * 0.2);
          s.lineTo(0.6, -hh * 0.18);
          s.quadraticCurveTo(0.58, hh * 0.15, 0.46, hh * 0.15);
          s.closePath();
        }),
      ]);
    }
    return {
      body: paint(geom(fishBody(hh, o)), colors),
      tail: geom(o.tail === 'round' ? roundTail(hh) : forkedTail(hh)),
      tailPivot: [-0.34, 0],
      fins: geom(finShapes),
      detail,
      eye: [0.37, hh * 0.28],
      halfH: Math.max(hh * 1.15, 0.08),
      swims: true,
    };
  };
  switch (archetype) {
    case 'fusiform':
      return fish(0.13, { blunt: 0.4 });
    case 'small':
      return fish(0.14, { blunt: 0.6, dorsal: [-0.02, 0.14, 0.08] });
    case 'compressed':
      return fish(0.27, { blunt: 0.75, peak: -0.02, dorsal: [-0.24, 0.16, 0.06] });
    case 'elongate':
      return fish(0.075, { blunt: 0.15, tail: 'round', dorsal: [-0.3, -0.18, 0.12] });
    case 'benthic':
      return fish(0.14, { blunt: 0.9, flatBelly: true, barbels: true, dorsal: [0.0, 0.16, 0.12] });
    case 'anguilliform': {
      const body = shape((s) => {
        s.moveTo(0.5, 0);
        s.bezierCurveTo(0.48, 0.06, 0.35, 0.055, 0.1, 0.05);
        s.bezierCurveTo(-0.2, 0.045, -0.4, 0.03, -0.5, 0);
        s.bezierCurveTo(-0.4, -0.03, -0.2, -0.045, 0.1, -0.05);
        s.bezierCurveTo(0.35, -0.055, 0.48, -0.05, 0.5, 0);
      });
      return {
        body: paint(geom(body), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: geom(
          shape((s) => {
            s.moveTo(0.15, 0.045);
            s.quadraticCurveTo(-0.15, 0.085, -0.5, 0.0);
            s.quadraticCurveTo(-0.15, 0.05, 0.15, 0.045);
          }),
        ),
        detail: null,
        eye: [0.42, 0.015],
        halfH: 0.08,
        swims: true,
      };
    }
    case 'turtle': {
      const shell = shape((s) => {
        s.moveTo(-0.38, -0.02);
        s.bezierCurveTo(-0.36, 0.3, 0.3, 0.3, 0.32, -0.02);
        s.closePath();
      });
      const parts = [
        ellipse(0.42, 0.0, 0.1, 0.07, 0.2),
        shape((s) => {
          s.moveTo(0.18, -0.02);
          s.lineTo(0.34, -0.2);
          s.lineTo(0.12, -0.08);
          s.closePath();
        }),
        shape((s) => {
          s.moveTo(-0.22, -0.02);
          s.lineTo(-0.38, -0.16);
          s.lineTo(-0.3, -0.03);
          s.closePath();
        }),
      ];
      return {
        body: paint(geom(shell), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: geom(parts),
        detail: null,
        eye: [0.45, 0.02],
        halfH: 0.22,
        swims: true,
      };
    }
    case 'crayfish': {
      const body = shape((s) => {
        s.moveTo(0.3, 0.0);
        s.bezierCurveTo(0.28, 0.09, 0.05, 0.1, -0.05, 0.08);
        s.bezierCurveTo(-0.25, 0.07, -0.4, 0.04, -0.46, -0.04);
        s.lineTo(-0.36, -0.05);
        s.bezierCurveTo(-0.2, -0.04, 0.0, -0.06, 0.1, -0.05);
        s.bezierCurveTo(0.22, -0.05, 0.3, -0.04, 0.3, 0.0);
      });
      const claw = (y: number) =>
        shape((s) => {
          s.moveTo(0.26, y);
          s.quadraticCurveTo(0.42, y + 0.06, 0.52, y + 0.07);
          s.quadraticCurveTo(0.44, y + 0.02, 0.5, y - 0.02);
          s.quadraticCurveTo(0.4, y - 0.02, 0.26, y - 0.025);
          s.closePath();
        });
      const legs = [-0.12, -0.02, 0.08].map((x) =>
        shape((s) => {
          s.moveTo(x, -0.04);
          s.lineTo(x - 0.04, -0.12);
          s.lineTo(x - 0.02, -0.12);
          s.lineTo(x + 0.015, -0.04);
          s.closePath();
        }),
      );
      return {
        body: paint(geom(body), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: geom([claw(0.03), ...legs]),
        detail: geom(
          shape((s) => {
            s.moveTo(0.3, 0.02);
            s.quadraticCurveTo(0.45, 0.12, 0.55, 0.2);
            s.lineTo(0.545, 0.21);
            s.quadraticCurveTo(0.44, 0.14, 0.29, 0.03);
            s.closePath();
          }),
        ),
        eye: [0.25, 0.04],
        halfH: 0.13,
        swims: false,
      };
    }
    case 'crab': {
      const body = ellipse(0, 0.02, 0.3, 0.13);
      const legs = [-0.2, -0.1, 0.0, 0.1].flatMap((x) => [
        shape((s) => {
          s.moveTo(x, -0.06);
          s.lineTo(x - 0.12, -0.18);
          s.lineTo(x - 0.1, -0.19);
          s.lineTo(x + 0.02, -0.08);
          s.closePath();
        }),
      ]);
      const claws = [
        shape((s) => {
          s.moveTo(0.22, 0.05);
          s.quadraticCurveTo(0.4, 0.2, 0.47, 0.12);
          s.quadraticCurveTo(0.38, 0.1, 0.45, 0.04);
          s.quadraticCurveTo(0.36, 0.0, 0.24, 0.0);
          s.closePath();
        }),
      ];
      return {
        body: paint(geom(body), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: geom([...legs, ...claws]),
        detail: null,
        eye: [0.2, 0.12],
        halfH: 0.2,
        swims: false,
      };
    }
    case 'mussel': {
      const shell = shape((s) => {
        s.moveTo(-0.42, 0.0);
        s.bezierCurveTo(-0.38, 0.2, 0.2, 0.26, 0.42, 0.05);
        s.bezierCurveTo(0.46, -0.02, 0.4, -0.12, 0.2, -0.14);
        s.bezierCurveTo(-0.05, -0.16, -0.4, -0.12, -0.42, 0.0);
      });
      const lines = [0.65, 0.4].map((k) =>
        shape((s) => {
          s.moveTo(-0.4 * k - 0.02, -0.01);
          s.bezierCurveTo(-0.36 * k, 0.2 * k, 0.2 * k, 0.24 * k, 0.4 * k, 0.03);
          s.lineTo(0.4 * k - 0.015, 0.03);
          s.bezierCurveTo(0.2 * k, 0.21 * k, -0.34 * k, 0.17 * k, -0.4 * k + 0.01, -0.01);
          s.closePath();
        }),
      );
      return {
        body: paint(geom(shell), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: null,
        detail: geom(lines),
        eye: null,
        halfH: 0.17,
        swims: false,
      };
    }
    case 'frog': {
      // A swimming newt or frog: plump body, tapering tail, splayed legs.
      const body = shape((s) => {
        s.moveTo(0.5, 0.0);
        s.bezierCurveTo(0.5, 0.075, 0.42, 0.095, 0.3, 0.09);
        s.bezierCurveTo(0.12, 0.1, 0.02, 0.07, -0.1, 0.045);
        s.bezierCurveTo(-0.28, 0.04, -0.42, 0.03, -0.5, 0.005);
        s.bezierCurveTo(-0.42, -0.015, -0.28, -0.02, -0.1, -0.035);
        s.bezierCurveTo(0.02, -0.06, 0.15, -0.075, 0.3, -0.07);
        s.bezierCurveTo(0.42, -0.07, 0.5, -0.05, 0.5, 0.0);
      });
      const leg = (x: number, dir: number) =>
        shape((s) => {
          s.moveTo(x - 0.02, -0.05);
          s.lineTo(x + 0.04 * dir, -0.15);
          s.lineTo(x + 0.1 * dir, -0.16);
          s.lineTo(x + 0.07 * dir, -0.125);
          s.lineTo(x + 0.03, -0.05);
          s.closePath();
        });
      return {
        body: paint(geom(body), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: geom([leg(0.3, 1), leg(0.0, -1)]),
        detail: null,
        eye: [0.42, 0.035],
        halfH: 0.13,
        swims: true,
      };
    }
    case 'plant': {
      const blade = (x: number, h: number, bend: number) =>
        shape((s) => {
          s.moveTo(x - 0.03, -0.5);
          s.quadraticCurveTo(x + bend, -0.5 + h * 0.6, x + bend * 0.6, -0.5 + h);
          s.quadraticCurveTo(x + bend + 0.05, -0.5 + h * 0.5, x + 0.03, -0.5);
          s.closePath();
        });
      return {
        body: paint(
          geom([blade(0, 0.95, 0.12), blade(-0.12, 0.7, -0.1), blade(0.12, 0.6, 0.15)]),
          colors,
        ),
        tail: null,
        tailPivot: [0, 0],
        fins: null,
        detail: null,
        eye: null,
        halfH: 0.5,
        swims: false,
      };
    }
    case 'mammal': {
      const body = shape((s) => {
        s.moveTo(0.5, 0.0);
        s.bezierCurveTo(0.48, 0.09, 0.3, 0.12, 0.05, 0.11);
        s.bezierCurveTo(-0.2, 0.1, -0.35, 0.05, -0.5, 0.01);
        s.lineTo(-0.5, -0.01);
        s.bezierCurveTo(-0.35, -0.06, -0.2, -0.1, 0.05, -0.1);
        s.bezierCurveTo(0.3, -0.1, 0.48, -0.06, 0.5, 0.0);
      });
      return {
        body: paint(geom(body), colors),
        tail: null,
        tailPivot: [0, 0],
        fins: geom([ellipse(0.2, -0.12, 0.05, 0.03), ellipse(-0.2, -0.11, 0.05, 0.03)]),
        detail: null,
        eye: [0.42, 0.035],
        halfH: 0.14,
        swims: true,
      };
    }
    default:
      return fish(0.13);
  }
}

export function disposeIcon(p: IconParts) {
  p.body.dispose();
  p.tail?.dispose();
  p.fins?.dispose();
  p.detail?.dispose();
}
