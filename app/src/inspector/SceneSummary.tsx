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
    <p
      className="m-0 px-3.5 py-2 text-xs"
      style={{ background: 'var(--accent-soft)', borderBottom: '1px solid var(--border)' }}
      aria-live="polite"
      data-testid="scene-summary"
    >
      {model ? describeScene(model, view, units) : 'Preparing the 3D scene…'}
    </p>
  );
}
