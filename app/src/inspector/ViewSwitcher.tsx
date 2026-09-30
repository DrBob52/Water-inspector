import { useEffect } from 'react';
import { VIEWS, type View } from '../lib/urlState';
import { useUi } from '../store';

/** Segmented control (radiogroup) for Map / Raised / Underwater / Cross-Section / Pollutants. */
export function ViewSwitcher() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  return (
    <div role="radiogroup" aria-label="View" className="segmented">
      {VIEWS.map((v) => (
        <label key={v.key} title={`${v.label} (key ${v.hotkey})`}>
          <input
            type="radio"
            name="view"
            value={v.key}
            checked={view === v.key}
            onChange={() => setView(v.key)}
            aria-keyshortcuts={v.hotkey}
          />
          <span>{v.label}</span>
        </label>
      ))}
    </div>
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
