export type View = 'map' | 'raised' | 'underwater' | 'section' | 'pollutants';
export type TabKey = 'overview' | 'quality' | 'impairments' | 'life' | 'sources';

export const VIEWS: Array<{ key: View; label: string; hotkey: string }> = [
  { key: 'map', label: 'Map', hotkey: '1' },
  { key: 'raised', label: 'Raised Terrain', hotkey: '2' },
  { key: 'underwater', label: 'Underwater', hotkey: '3' },
  { key: 'section', label: 'Cross-Section', hotkey: '4' },
  { key: 'pollutants', label: 'Pollutants', hotkey: '5' },
];

export const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'quality', label: 'Water Quality' },
  { key: 'impairments', label: 'Pollutants and Impairments' },
  { key: 'life', label: 'Life' },
  { key: 'sources', label: 'Sources' },
];

export interface UrlState {
  wb: string | null;
  view: View;
  tab: TabKey;
  species: string | null;
}

const isView = (v: string | null): v is View => VIEWS.some((x) => x.key === v);
const isTab = (v: string | null): v is TabKey => TABS.some((x) => x.key === v);

export function parseUrl(search: string): UrlState {
  const p = new URLSearchParams(search);
  const wb = p.get('wb');
  const view = p.get('view');
  const tab = p.get('tab');
  return {
    wb: wb && /^(nhd|osm):.+/.test(wb) ? wb : null,
    // A view only makes sense with a selected waterbody.
    view: wb && isView(view) ? view : 'map',
    tab: isTab(tab) ? tab : 'overview',
    species: p.get('sp'),
  };
}

export function serializeUrl(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.wb) {
    p.set('wb', s.wb);
    if (s.view !== 'map') p.set('view', s.view);
    if (s.tab !== 'overview') p.set('tab', s.tab);
    if (s.species) p.set('sp', s.species);
  }
  // Keep ":" readable in the address bar, as in the spec's "?wb=nhd:123&view=underwater".
  const q = p.toString().replace(/%3A/g, ':');
  return q ? `?${q}` : '';
}
