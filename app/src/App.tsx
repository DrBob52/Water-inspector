import { Suspense, lazy, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEMO, DEMO_LABEL } from './env';
import { queryClient, useHealth } from './lib/queries';
import { hasWebGL } from './lib/webgl';
import { startUrlSync, useUi } from './store';
import { MapView } from './map/MapView';
import { SearchBox } from './map/SearchBox';
import { Inspector } from './inspector/Inspector';
import { useViewHotkeys } from './inspector/ViewSwitcher';

const SceneHost = lazy(() => import('./scenes/SceneHost'));

function Shell() {
  const selectedId = useUi((s) => s.selectedId);
  const view = useUi((s) => s.view);
  const toast = useUi((s) => s.toast);
  const health = useHealth();
  const demo = DEMO || health.data?.demo === true;
  const webgl = hasWebGL();
  useViewHotkeys(!!selectedId);

  useEffect(() => startUrlSync(), []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-panel">
        Skip to the inspector
      </a>
      {webgl ? (
        <MapView />
      ) : (
        <div
          role="alert"
          className="panel"
          style={{ left: 12, top: 12, padding: 16, maxWidth: 420 }}
        >
          <strong>WebGL is not available in this browser.</strong>
          <p className="m-0 mt-1">
            The 3D map and scenes cannot be shown. Select a waterbody by name in the search box to
            read its data in the panel.
          </p>
        </div>
      )}
      {selectedId && view !== 'map' && webgl && (
        <div className="scene-layer" data-testid="scene-layer" data-view={view}>
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
      <SearchBox />
      {demo && (
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
        {selectedId && <Inspector />}
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
