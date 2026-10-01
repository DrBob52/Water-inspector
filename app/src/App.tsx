import { Suspense, lazy, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEMO, DEMO_LABEL } from './env';
import { queryClient, useDemoList, useHealth } from './lib/queries';
import { hasWebGL } from './lib/webgl';
import { startUrlSync, useUi } from './store';
import { MapView } from './map/MapView';
import { SearchBox } from './map/SearchBox';
import { useViewHotkeys } from './inspector/ViewSwitcher';

const SceneHost = lazy(() => import('./scenes/SceneHost'));
const Inspector = lazy(() =>
  import('./inspector/Inspector').then((m) => ({ default: m.Inspector })),
);

/** Shown instead of the map when WebGL is unavailable: the Inspector still works. */
function NoWebGl({ demo }: { demo: boolean }) {
  const list = useDemoList();
  const select = useUi((s) => s.select);
  return (
    <div
      role="alert"
      className="panel"
      style={{ left: 12, top: 12, padding: 16, maxWidth: 420 }}
      data-testid="no-webgl"
    >
      <strong>WebGL is not available in this browser.</strong>
      <p className="m-0 mt-1">
        The 3D map and scenes cannot be shown, but the data panel still works.
      </p>
      {demo && list.data && (
        <ul className="m-0 mt-2 list-none p-0">
          {list.data.map((w) => (
            <li key={w.id} className="mb-1">
              <button type="button" className="btn" onClick={() => select(w.id)}>
                Open {w.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shell() {
  const selectedId = useUi((s) => s.selectedId);
  const view = useUi((s) => s.view);
  const panelOpen = useUi((s) => s.panelOpen);
  const toast = useUi((s) => s.toast);
  const health = useHealth();
  const demo = DEMO || health.data?.demo === true;
  const webgl = hasWebGL();
  useViewHotkeys(!!selectedId && webgl);

  useEffect(() => startUrlSync(), []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-panel">
        Skip to the inspector
      </a>
      {webgl ? <MapView /> : <NoWebGl demo={demo} />}
      {selectedId && view !== 'map' && webgl && (
        <div
          className={`scene-layer ${panelOpen ? 'panel-open' : ''}`}
          data-testid="scene-layer"
          data-view={view}
        >
          <Suspense
            fallback={
              <div role="status" className="grid h-full place-items-center text-white">
                Loading 3D view…
              </div>
            }
          >
            <SceneHost />
          </Suspense>
        </div>
      )}
      {view === 'map' && <SearchBox />}
      {demo && !selectedId && (
        <div className="banner" data-testid="demo-banner" role="note">
          Demo mode: {DEMO_LABEL}. Click one of the six marked waterbodies.
        </div>
      )}
      {toast && (
        <div className="toast" role="status" data-testid="toast">
          {toast}
        </div>
      )}
      <div id="main-panel" tabIndex={-1}>
        {selectedId && (
          <Suspense fallback={null}>
            <Inspector />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
