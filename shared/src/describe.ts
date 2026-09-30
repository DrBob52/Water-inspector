import type { SceneModel } from './types';
import { formatDepth, formatLength, type UnitSystem } from './units';

export type SceneView = 'raised' | 'underwater' | 'section' | 'pollutants';

const visibilityText = (m: number) => `about ${m >= 10 ? Math.round(m) : m.toFixed(1)} m`;

/**
 * Text alternative for a 3D view, shown in the panel:
 * "12 species shown; visibility about 4 m; max depth 122 m, modelled".
 */
export function describeScene(
  model: SceneModel,
  view: SceneView,
  units: UnitSystem = 'metric',
): string {
  const depth = `max depth ${formatDepth(model.maxDepthM, units)}, ${model.depthEstimated ? 'estimated and modelled' : 'bed shape modelled'}`;
  const species = model.actors.length;
  const fish = model.actors.filter(
    (a) => !['turtle', 'crayfish', 'crab', 'mussel', 'frog', 'mammal'].includes(a.archetype),
  ).length;
  switch (view) {
    case 'underwater':
      return `${species} species shown${fish !== species ? ` (${fish} fish)` : ''}; visibility ${visibilityText(model.visibilityM)}; ${depth}.`;
    case 'raised': {
      const xs = model.outline.map((p) => p[0]);
      const ys = model.outline.map((p) => p[1]);
      const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      return `Raised terrain block around ${model.name}, waterbody about ${formatLength(ext, units)} across; ${depth}.`;
    }
    case 'section': {
      const doText = model.doProfile?.length
        ? `dissolved oxygen profile from ${model.doProfile.length} depths`
        : model.surfaceDoMgL !== undefined
          ? `no depth profile measured; surface dissolved oxygen ${model.surfaceDoMgL.toFixed(1)} mg/L`
          : 'no dissolved oxygen data';
      const th =
        model.thermoclineM !== undefined
          ? `; thermocline near ${formatDepth(model.thermoclineM, units)}${model.thermoclineEstimated ? ' (estimated)' : ''}`
          : '';
      return `Vertical slice along the longest axis; ${depth}; ${doText}${th}.`;
    }
    case 'pollutants': {
      const over = model.pollutants.filter((p) => p.ratio > 1);
      if (!model.pollutants.length)
        return `No pollutant measurements with a screening reference; the volume is shown empty. ${depth}.`;
      return `${model.pollutants.length} measured pollutants shown as particles; ${over.length} above their screening reference${over.length ? ` (${over.map((p) => p.label).join(', ')})` : ''}; ${depth}.`;
    }
  }
}
