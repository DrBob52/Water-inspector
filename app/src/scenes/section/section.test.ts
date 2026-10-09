import { describe, expect, it } from 'vitest';
import type { SceneModel } from '@wi/shared';
import { buildIcon, disposeIcon } from './icons';
import {
  compose,
  doAtDepth,
  doBand,
  doColor,
  doTintTexels,
  exaggerationLabel,
  gaussianSmooth,
  itemBox,
  labelBox,
  layoutSpecies,
  lightModel,
  niceStep,
  profileDepthAt,
  runningMax,
  sectionProfile,
  spreadLabels,
  ticks,
  waterPalette,
  type LayoutItem,
  type Rect,
} from './section';

const base: SceneModel = {
  outline: [],
  maxDepthM: 40,
  meanDepthM: 15,
  depthEstimated: false,
  visibilityM: 5,
  waterTint: '#0e5692',
  actors: [],
  pollutants: [],
  pollutantDetails: [],
  listedImpairments: [],
  isRiver: false,
  surfaceElevationM: 0,
  stations: [],
  plantCount: 0,
  name: 'T',
  origin: [0, 0],
  demo: true,
};
const ellipse = (a: number, b: number, rot = 0, wobble = 0): Array<[number, number]> =>
  Array.from({ length: 160 }, (_, i) => {
    const t = (2 * Math.PI * i) / 160;
    // A wobbly shoreline makes the width change quickly along the axis.
    const k = 1 + wobble * Math.sin(t * 9) + wobble * 0.6 * Math.sin(t * 23 + 1);
    const x = a * Math.cos(t);
    const y = b * k * Math.sin(t);
    return [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)] as [
      number,
      number,
    ];
  });

describe('sectionProfile', () => {
  it('follows the longest axis of a long narrow lake, whatever its orientation', () => {
    for (const rot of [0, Math.PI / 4, Math.PI / 2]) {
      const p = sectionProfile({ ...base, outline: ellipse(6000, 1000, rot) });
      expect(p.lengthM).toBeGreaterThan(11500);
      expect(p.lengthM).toBeLessThan(12300);
      expect(
        Math.abs(Math.abs(p.axis[0] * Math.cos(rot) + p.axis[1] * Math.sin(rot)) - 1),
      ).toBeLessThan(0.05);
    }
  });
  it('is deepest in the middle, meets the surface at both shores and keeps the true max depth', () => {
    const p = sectionProfile({ ...base, outline: ellipse(5000, 2000) });
    const mid = p.depth[Math.floor(p.samples / 2)];
    expect(mid).toBeGreaterThan(p.depth[8]);
    expect(mid).toBeGreaterThan(p.depth[p.samples - 9]);
    expect(p.depth[0]).toBe(0);
    expect(p.depth[p.samples - 1]).toBe(0);
    expect(Math.max(...p.depth)).toBeCloseTo(40, 3);
    expect(p.maxDepthM).toBe(40);
  });
  it('is smooth even where the shoreline wobbles (no sawtooth)', () => {
    const p = sectionProfile({ ...base, outline: ellipse(8000, 1500, 0.3, 0.25), meanDepthM: 8 });
    // Count local extrema: a sawtooth has dozens, a smooth bed only a few.
    let turns = 0;
    for (let i = 2; i < p.samples - 1; i++) {
      const a = p.depth[i - 1] - p.depth[i - 2];
      const b = p.depth[i] - p.depth[i - 1];
      if (Math.abs(a) > 1e-4 && Math.abs(b) > 1e-4 && Math.sign(a) !== Math.sign(b)) turns++;
    }
    expect(turns).toBeLessThan(10);
    // No sample-to-sample jumps larger than 6% of the max depth.
    for (let i = 1; i < p.samples; i++)
      expect(Math.abs(p.depth[i] - p.depth[i - 1])).toBeLessThan(40 * 0.06);
  });
  it('gives rivers a channel that does not pinch at every narrowing', () => {
    const outline = ellipse(9000, 400, 0, 0.35);
    const lake = sectionProfile({ ...base, outline, maxDepthM: 6, meanDepthM: 3 });
    const river = sectionProfile({ ...base, outline, maxDepthM: 6, meanDepthM: 3, isRiver: true });
    const meanOf = (d: Float32Array) => d.reduce((s, v) => s + v, 0) / d.length;
    expect(meanOf(river.depth)).toBeGreaterThan(meanOf(lake.depth));
  });
  it('handles a degenerate outline without throwing', () => {
    const p = sectionProfile({ ...base, outline: [] });
    expect(p.depth).toHaveLength(p.samples);
    expect(p.maxDepthM).toBe(40);
  });
  it('interpolates depth along the profile', () => {
    const p = sectionProfile({ ...base, outline: ellipse(5000, 2000) });
    expect(profileDepthAt(p, 0)).toBe(0);
    expect(profileDepthAt(p, 1)).toBe(0);
    expect(profileDepthAt(p, 0.5)).toBeGreaterThan(30);
  });
});

describe('signal helpers', () => {
  it('smooths without changing a constant interior and takes running maxima', () => {
    const flat = gaussianSmooth(new Float32Array(50).fill(3), 2, 3);
    expect(Math.max(...flat)).toBeCloseTo(3, 5);
    expect(Math.min(...flat)).toBeCloseTo(3, 5);
    expect(Array.from(runningMax([1, 5, 2, 0, 0, 4], 1))).toEqual([5, 5, 5, 2, 4, 4]);
  });
});

describe('light', () => {
  it('ties the photic zone to visibility: shallow in murky water, deep in clear water', () => {
    const murky = lightModel(0.7);
    const clear = lightModel(29.4);
    expect(murky.photicM).toBeGreaterThan(0.8);
    expect(murky.photicM).toBeLessThan(2);
    expect(clear.photicM).toBeGreaterThan(45);
    expect(clear.photicM).toBeLessThan(60);
    // 1% of surface light remains at the photic depth.
    expect(Math.exp(-clear.kd * clear.photicM)).toBeCloseTo(0.01, 5);
  });
  it('keeps the hue of the tint and lightens the shallows', () => {
    const green = waterPalette('#487251');
    expect(green.mid[1]).toBeGreaterThan(green.mid[0]);
    const sum = (c: number[]) => c[0] + c[1] + c[2];
    expect(sum(green.shallow)).toBeGreaterThan(sum(green.mid));
    expect(sum(green.mid)).toBeGreaterThan(sum(green.deep));
  });
});

describe('dissolved oxygen colours and bands', () => {
  it('is red below 2, amber 2 to 5, blue-green above 5', () => {
    const c = (v: number) => doColor(v).getHexString();
    expect(c(1)).toBe(c(0.2));
    expect(c(3)).toBe(c(4));
    expect(c(7)).toBe(c(11));
    expect(new Set([c(1), c(3), c(7)]).size).toBe(3);
    const red = doColor(1);
    const amber = doColor(3.5);
    const blue = doColor(8);
    expect(red.r).toBeGreaterThan(red.b);
    expect(amber.r).toBeGreaterThan(amber.b);
    expect(blue.b).toBeGreaterThan(blue.r);
    expect([doBand(1.9), doBand(2), doBand(4.99), doBand(5)]).toEqual([
      'low',
      'moderate',
      'moderate',
      'good',
    ]);
  });
  it('interpolates a DO profile by depth', () => {
    const prof = [
      { depthM: 1, mgL: 9 },
      { depthM: 11, mgL: 1 },
    ];
    expect(doAtDepth(prof, 0)).toBe(9);
    expect(doAtDepth(prof, 6)).toBe(5);
    expect(doAtDepth(prof, 50)).toBe(1);
  });
  it('tints low oxygen strongly, healthy water faintly, and nothing below the deepest reading', () => {
    const prof = [
      { depthM: 0, mgL: 9 },
      { depthM: 10, mgL: 1 },
    ];
    const t = doTintTexels(prof, 20, 101);
    const alpha = (depth: number) => t[Math.round((depth / 20) * 100) * 4 + 3];
    expect(alpha(9.8)).toBeGreaterThan(alpha(0) * 3);
    expect(alpha(15)).toBe(0);
    expect(alpha(20)).toBe(0);
  });
});

describe('rulers', () => {
  it('chooses nice tick steps and round ticks', () => {
    expect(niceStep(100)).toBe(20);
    expect(niceStep(122, 6)).toBe(20);
    expect(niceStep(12, 6)).toBe(2);
    expect(niceStep(0.5, 5)).toBe(0.1);
    expect(ticks(122, 20)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(ticks(0.5, 0.1)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });
  it('labels the vertical exaggeration compactly', () => {
    expect(exaggerationLabel(372.4)).toBe('×370');
    expect(exaggerationLabel(43.2)).toBe('×43');
    expect(exaggerationLabel(4.24)).toBe('×4.2');
  });
});

describe('compose', () => {
  it('fits the figure inside the visible stage, clear of the chrome and the inspector', () => {
    const stage = { width: 1440, height: 900, inset: 464, top: 250, bottom: 830 };
    const c = compose(stage);
    const left = c.originX + c.rulerX - 50;
    const right = c.originX + c.gaugeX + c.gaugeW + 20;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(stage.width - stage.inset);
    expect(c.originY - 34).toBeGreaterThanOrEqual(stage.top);
    expect(c.originY + c.distY + 30).toBeLessThanOrEqual(stage.bottom);
    expect(c.waterW).toBeGreaterThan(500);
    expect(c.waterH).toBeGreaterThan(250);
    expect(c.showZones).toBe(true);
  });
  it('drops the zone column on a phone', () => {
    const c = compose({ width: 390, height: 844, inset: 0, top: 200, bottom: 800 });
    expect(c.showZones).toBe(false);
    expect(c.originX + c.gaugeX + c.gaugeW).toBeLessThanOrEqual(390);
  });
});

describe('layoutSpecies', () => {
  const bowl = (w: number, h: number) => (x: number) =>
    Math.max(0, h * Math.sin((Math.PI * Math.min(Math.max(x, 0), w)) / w) ** 0.6);
  const items: LayoutItem[] = (['littoral', 'midwater', 'benthic', 'surface'] as const).flatMap(
    (band) =>
      [0, 1, 2].map((k) => ({ band, w: 30 + k * 6, h: 12 + k * 2, labelW: 70, labelH: 13 })),
  );
  it('places every species in the water, without overlaps', () => {
    const W = 700;
    const depth = bowl(W, 340);
    const out = layoutSpecies(items, W, depth);
    expect(out).toHaveLength(items.length);
    const boxes: Rect[] = [];
    out.forEach((p, i) => {
      const icon = itemBox(items[i], p.x, p.y, null);
      expect(icon.y0).toBeGreaterThan(0);
      expect(icon.y1).toBeLessThan(depth(p.x));
      boxes.push(icon);
      if (p.label) boxes.push(labelBox(items[i], p.x, p.y, p.label));
    });
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const overlap = A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1;
        expect(overlap).toBe(false);
      }
    expect(out.filter((p) => p.label).length).toBe(items.length);
  });
  it('keeps each band in its zone', () => {
    const W = 700;
    const depth = bowl(W, 340);
    const out = layoutSpecies(items, W, depth, { littoralMaxPx: 60 });
    out.forEach((p, i) => {
      const band = items[i].band;
      if (band === 'surface') expect(p.y).toBeLessThan(30);
      if (band === 'littoral') expect(p.y).toBeLessThan(80);
      if (band === 'benthic') {
        // Resting on the bed: the shallowest bed under the icon is just below it.
        let bed = Infinity;
        for (let dx = -items[i].w / 2; dx <= items[i].w / 2; dx += 1)
          bed = Math.min(bed, depth(p.x + dx));
        expect(bed - p.y).toBeLessThan(items[i].h / 2 + 8);
      }
      expect(p.displaced).toBe(false);
    });
    const shore = (band: string) => {
      const xs = out.filter((_, i) => items[i].band === band).map((p) => Math.min(p.x, W - p.x));
      return xs.reduce((s, v) => s + v, 0) / xs.length;
    };
    expect(shore('littoral')).toBeLessThan(shore('midwater'));
  });
  it('avoids reserved annotation boxes', () => {
    const W = 600;
    const depth = bowl(W, 300);
    const reserved: Rect = { x0: 100, x1: 500, y0: 60, y1: 200 };
    const out = layoutSpecies(items, W, depth, { reserved: [reserved] });
    out.forEach((p, i) => {
      const b = itemBox(items[i], p.x, p.y, null);
      const hit =
        b.x0 < reserved.x1 && reserved.x0 < b.x1 && b.y0 < reserved.y1 && reserved.y0 < b.y1;
      expect(hit).toBe(false);
    });
  });
  it('still shows every species in a cramped, shallow channel, dropping labels first', () => {
    const W = 300;
    const depth = bowl(W, 40);
    const out = layoutSpecies(items, W, depth);
    expect(out).toHaveLength(items.length);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(out.some((p) => p.label === null)).toBe(true);
  });
});

describe('spreadLabels', () => {
  it('keeps order and a minimum gap within bounds', () => {
    const ys = spreadLabels([10, 12, 13, 100], 16, 0, 120);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(16);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(16);
    expect(ys[3]).toBe(100);
    const squeezed = spreadLabels([100, 110, 115], 16, 0, 120);
    expect(squeezed[2]).toBeLessThanOrEqual(120);
    expect(squeezed[1] - squeezed[0]).toBeGreaterThanOrEqual(16);
  });
});

describe('icons', () => {
  it('builds a silhouette for every archetype', () => {
    const colors = { back: '#334455', side: '#778899', belly: '#ddeeff', fin: '#556677' };
    for (const a of [
      'fusiform',
      'compressed',
      'elongate',
      'anguilliform',
      'benthic',
      'small',
      'turtle',
      'crayfish',
      'crab',
      'mussel',
      'frog',
      'plant',
      'mammal',
      'unknown',
    ]) {
      const p = buildIcon(a, colors);
      expect(p.body.getAttribute('position').count).toBeGreaterThan(8);
      expect(p.body.getAttribute('color').count).toBe(p.body.getAttribute('position').count);
      expect(p.halfH).toBeGreaterThan(0);
      p.body.computeBoundingBox();
      const bb = p.body.boundingBox!;
      expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(1.05);
      disposeIcon(p);
    }
  });
});
