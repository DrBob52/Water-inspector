import { Suspense, lazy } from 'react';
import { ErrorBox } from '../components/ui';
import { useQuality } from '../lib/queries';
import { usePrefersReducedMotion } from '../lib/hooks';
import { useSceneModel } from '../lib/useSceneModel';
import { useUi } from '../store';
import { UnderwaterView } from './underwater/UnderwaterView';

const RaisedView = lazy(() => import('./raised/RaisedView'));
const SectionView = lazy(() => import('./section/SectionView'));
const PollutantsView = lazy(() => import('./pollutants/PollutantsView'));

function Loading({ text }: { text: string }) {
  return (
    <div role="status" className="grid h-full place-items-center" style={{ color: '#cfe6ee' }}>
      <span>{text}</span>
    </div>
  );
}

/** Mounts the active 3D view once the SceneModel is ready. Lazy-loaded so three.js is code-split. */
export default function SceneHost() {
  const view = useUi((s) => s.view);
  const id = useUi((s) => s.selectedId);
  const units = useUi((s) => s.units);
  const reduced = usePrefersReducedMotion();
  const { model, loading, error } = useSceneModel();
  const q = useQuality(id);

  if (error)
    return (
      <div className="p-6">
        <ErrorBox title="This waterbody could not be loaded" message={error} />
      </div>
    );
  if (loading || !model) return <Loading text="Preparing the 3D scene…" />;
  const props = { model, reducedMotion: reduced, units, quality: q.data?.data ?? [] };
  return (
    <div className="absolute inset-0" data-testid="scene-host" data-view={view}>
      <Suspense fallback={<Loading text="Loading 3D view…" />}>
        {view === 'underwater' && <UnderwaterView {...props} />}
        {view === 'raised' && <RaisedView {...props} />}
        {view === 'section' && <SectionView {...props} />}
        {view === 'pollutants' && <PollutantsView {...props} />}
      </Suspense>
    </div>
  );
}
