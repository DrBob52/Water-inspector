import type { BufferGeometry } from 'three';
import { CylinderGeometry, SphereGeometry, type NormalBufferAttributes } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type G = BufferGeometry<NormalBufferAttributes>;

/** Ellipsoid at a position, optionally rotated about Z. */
function ell(rx: number, ry: number, rz: number, x = 0, y = 0, z = 0, rotZ = 0): G {
  const g = new SphereGeometry(1, 12, 8);
  g.scale(rx, ry, rz);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g.toNonIndexed() as G;
}

function rod(len: number, r: number, x: number, y: number, z: number, rotZ: number, rotY = 0): G {
  const g = new CylinderGeometry(r, r * 0.7, len, 5);
  g.rotateZ(Math.PI / 2 + rotZ);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g.toNonIndexed() as G;
}

const merge = (parts: G[]): G => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)) as G[], false) as G;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
};

/** Each shape is about 1 unit long along +X (head toward +X), sitting on y = 0 (bed or waterline). */
export function buildCritterGeometry(archetype: string): G {
  switch (archetype) {
    case 'turtle':
      return merge([
        ell(0.42, 0.2, 0.33, 0, 0.12, 0),
        ell(0.12, 0.09, 0.1, 0.5, 0.1, 0),
        ell(0.16, 0.04, 0.07, 0.22, 0.03, 0.34, 0.4),
        ell(0.16, 0.04, 0.07, 0.22, 0.03, -0.34, -0.4),
        ell(0.12, 0.04, 0.06, -0.26, 0.03, 0.24, -0.3),
        ell(0.12, 0.04, 0.06, -0.26, 0.03, -0.24, 0.3),
        ell(0.07, 0.03, 0.03, -0.46, 0.06, 0),
      ]);
    case 'crayfish':
      return merge([
        ell(0.28, 0.07, 0.08, 0.05, 0.08, 0),
        ell(0.22, 0.06, 0.09, -0.3, 0.07, 0),
        ell(0.1, 0.03, 0.12, -0.52, 0.05, 0),
        ell(0.12, 0.05, 0.06, 0.4, 0.09, 0.16, 0.3),
        ell(0.12, 0.05, 0.06, 0.4, 0.09, -0.16, -0.3),
        rod(0.3, 0.008, 0.45, 0.1, 0.05, 0.2),
        rod(0.3, 0.008, 0.45, 0.1, -0.05, -0.2),
        rod(0.18, 0.01, 0.08, 0.03, 0.12, 0, 0.9),
        rod(0.18, 0.01, -0.05, 0.03, -0.12, 0, -0.9),
      ]);
    case 'crab':
      return merge([
        ell(0.3, 0.07, 0.42, 0, 0.08, 0),
        ell(0.1, 0.05, 0.06, 0.32, 0.1, 0.3, 0.3),
        ell(0.1, 0.05, 0.06, 0.32, 0.1, -0.3, -0.3),
        rod(0.3, 0.014, 0, 0.04, 0.45, 0, 1.5),
        rod(0.3, 0.014, 0, 0.04, -0.45, 0, 1.5),
      ]);
    case 'mussel':
      return merge([ell(0.45, 0.28, 0.3, 0, 0.02, 0), ell(0.3, 0.18, 0.2, 0, 0.12, 0)]);
    case 'frog':
      return merge([
        ell(0.36, 0.17, 0.22, 0, 0.12, 0),
        ell(0.14, 0.11, 0.14, 0.34, 0.17, 0),
        ell(0.2, 0.05, 0.07, -0.25, 0.05, 0.26, 0.5),
        ell(0.2, 0.05, 0.07, -0.25, 0.05, -0.26, -0.5),
      ]);
    case 'mammal':
    default:
      return merge([
        ell(0.5, 0.18, 0.2, 0, 0.1, 0),
        ell(0.14, 0.12, 0.12, 0.48, 0.14, 0),
        ell(0.22, 0.05, 0.14, -0.55, 0.08, 0),
        ell(0.14, 0.04, 0.06, 0.18, 0.04, 0.22, 0.3),
        ell(0.14, 0.04, 0.06, 0.18, 0.04, -0.22, -0.3),
      ]);
  }
}
