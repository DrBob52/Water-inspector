import { Eye } from 'lucide-react';
import { describeScene } from '@wi/shared';
import { useSceneModel } from '../lib/useSceneModel';
import { useUi } from '../store';

/** Text alternative for the active 3D view, e.g. "12 species shown; visibility about 4 m; max depth 122 m, modelled". */
export function SceneSummary() {
  const view = useUi((s) => s.view);
  const units = useUi((s) => s.units);
  const { model } = useSceneModel(view !== 'map');
  if (view === 'map') return null;
  return (
    <p className="scene-summary" aria-live="polite" data-testid="scene-summary">
      <Eye aria-hidden="true" size={14} strokeWidth={1.9} />
      <span>{model ? describeScene(model, view, units) : 'Preparing the 3D scene…'}</span>
    </p>
  );
}
