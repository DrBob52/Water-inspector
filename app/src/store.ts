import { create } from 'zustand';
import type { UnitSystem } from '@wi/shared';
import { parseUrl, serializeUrl, type TabKey, type View } from './lib/urlState';

const UNITS_KEY = 'wi.units';

function readUnits(): UnitSystem {
  try {
    const v = localStorage.getItem(UNITS_KEY);
    if (v === 'imperial' || v === 'metric') return v;
  } catch {
    /* storage unavailable */
  }
  return 'metric';
}

interface UiState {
  selectedId: string | null;
  view: View;
  tab: TabKey;
  panelOpen: boolean;
  units: UnitSystem;
  highlightSpecies: string | null;
  toast: string | null;
  select: (id: string | null) => void;
  setView: (v: View) => void;
  setTab: (t: TabKey) => void;
  setPanelOpen: (b: boolean) => void;
  setUnits: (u: UnitSystem) => void;
  highlight: (scientificName: string | null) => void;
  showToast: (m: string | null) => void;
}

const initial = parseUrl(typeof window === 'undefined' ? '' : window.location.search);

export const useUi = create<UiState>((set) => ({
  selectedId: initial.wb,
  view: initial.view,
  tab: initial.tab,
  panelOpen: true,
  units: readUnits(),
  highlightSpecies: initial.species,
  toast: null,
  select: (id) =>
    set({ selectedId: id, view: 'map', tab: 'overview', highlightSpecies: null, panelOpen: true }),
  setView: (view) => set({ view }),
  setTab: (tab) => set({ tab }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setUnits: (units) => {
    try {
      localStorage.setItem(UNITS_KEY, units);
    } catch {
      /* storage unavailable */
    }
    set({ units });
  },
  highlight: (highlightSpecies) => set({ highlightSpecies }),
  showToast: (toast) => set({ toast }),
}));

/** Mirror selection, view, tab and highlighted species into the address bar. */
export function startUrlSync(): () => void {
  const write = () => {
    const s = useUi.getState();
    const next = serializeUrl({
      wb: s.selectedId,
      view: s.view,
      tab: s.tab,
      species: s.highlightSpecies,
    });
    if (next !== window.location.search) {
      try {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${next}${window.location.hash}`,
        );
      } catch {
        /* history unavailable */
      }
    }
  };
  write();
  const unsub = useUi.subscribe(write);
  const onPop = () => {
    const u = parseUrl(window.location.search);
    useUi.setState({ selectedId: u.wb, view: u.view, tab: u.tab, highlightSpecies: u.species });
  };
  window.addEventListener('popstate', onPop);
  return () => {
    unsub();
    window.removeEventListener('popstate', onPop);
  };
}
