import { useEffect } from 'react';
import {
  FlaskConical,
  Fish,
  Layers,
  Map as MapIcon,
  Mountain,
  type LucideIcon,
} from 'lucide-react';
import { VIEWS, type View } from '../lib/urlState';
import { useUi } from '../store';

const ICONS: Record<View, LucideIcon> = {
  map: MapIcon,
  raised: Mountain,
  underwater: Fish,
  section: Layers,
  pollutants: FlaskConical,
};

/** Segmented control (radiogroup) for Map / Terrain / Underwater / Section / Pollutants. */
export function ViewSwitcher() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  return (
    <div role="radiogroup" aria-label="View" className="segmented">
      {VIEWS.map((v) => {
        const Icon = ICONS[v.key];
        return (
          <label key={v.key} title={`${v.label} (key ${v.hotkey})`}>
            <input
              type="radio"
              name="view"
              value={v.key}
              checked={view === v.key}
              onChange={() => setView(v.key)}
              aria-keyshortcuts={v.hotkey}
              aria-label={v.label}
            />
            <span className="seg">
              <Icon aria-hidden="true" strokeWidth={1.8} />
              <span className="seg-label">{v.label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Floating dock that holds the view switcher, centred over the map or scene. */
export function ViewDock() {
  return (
    <nav className="view-dock glass" aria-label="3D views" data-testid="view-dock">
      <ViewSwitcher />
    </nav>
  );
}

/** Keys 1 to 5 switch views; Esc returns to the map. Ignored while typing in a field. */
export function useViewHotkeys(enabled: boolean) {
  const setView = useUi((s) => s.setView);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        ((t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'radio') ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VIEWS.find((x) => x.hotkey === e.key);
      if (v) {
        e.preventDefault();
        setView(v.key as View);
      } else if (e.key === 'Escape' && useUi.getState().view !== 'map') {
        setView('map');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, setView]);
}
