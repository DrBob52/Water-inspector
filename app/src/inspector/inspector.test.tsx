import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ParameterSummary, SpeciesRecord } from '@wi/shared';
import { QualityTab } from './tabs/QualityTab';
import { LifeTab } from './tabs/LifeTab';
import { ImpairmentsTab } from './tabs/ImpairmentsTab';
import { ViewSwitcher } from './ViewSwitcher';
import { useUi } from '../store';

const prov = { source: 't', url: '', retrievedAt: '2026-09-01T00:00:00Z' };
const param = (over: Partial<ParameterSummary>): ParameterSummary => ({
  key: 'e_coli',
  label: 'E. coli',
  unit: 'CFU/100 mL',
  latest: { value: 300, date: '2026-09-01', stationId: 's' },
  median5y: 120,
  min: 5,
  max: 900,
  sampleCount: 40,
  series: [
    { t: '2025-06-01', v: 50 },
    { t: '2026-09-01', v: 300 },
  ],
  status: 'exceeds',
  threshold: {
    label: 'EPA 2012 recreational criterion',
    value: 126,
    unit: 'CFU/100 mL',
    direction: 'max',
    citation: 'https://example.org',
  },
  ...over,
});
const species = (n: number, over: Partial<SpeciesRecord> = {}): SpeciesRecord => ({
  gbifKey: n,
  scientificName: `Genus species${n}`,
  commonName: `Fish ${n}`,
  group: 'fish',
  recordCount: n * 10,
  introduced: false,
  ...over,
});

let routes: Record<string, () => Response | Promise<Response>> = {};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  routes = {};
  useUi.setState({ selectedId: 'nhd:x', view: 'map', tab: 'overview', highlightSpecies: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return json({ error: 'nf', message: 'no route' }, 404);
      return routes[key]();
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('QualityTab', () => {
  it('shows a card per parameter with latest value, status text and a not-measured list', async () => {
    routes['/quality'] = () =>
      json({
        status: 'ok',
        data: [
          param({}),
          param({
            key: 'ph',
            label: 'pH',
            unit: 'pH',
            status: 'good',
            threshold: undefined,
            latest: { value: 7.9, date: '2026-09-02', stationId: 's' },
          }),
        ],
        provenance: prov,
      });
    wrap(<QualityTab id="nhd:x" />);
    const card = await screen.findByTestId('param-e_coli');
    expect(card.textContent).toContain('300 CFU/100 mL');
    expect(card.textContent).toContain('Above screening reference');
    expect(card.querySelector('svg[role=img]')).toBeTruthy();
    expect(screen.getByTestId('param-ph').textContent).toContain('Within screening reference');
    expect(screen.getByText(/Not measured here \(21\)/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bsafe to (swim|eat|drink)\b/i);
  });
  it('shows its own error state without touching other sections', async () => {
    routes['/quality'] = () => json({ error: 'internal', message: 'boom' }, 500);
    routes['/life'] = () => json({ status: 'ok', data: [species(1)], provenance: prov });
    wrap(
      <>
        <QualityTab id="nhd:x" />
        <LifeTab id="nhd:x" />
      </>,
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(await screen.findByText('Fish 1')).toBeTruthy();
  });
  it('reports a source-level failure with a retry button', async () => {
    routes['/quality'] = () =>
      json({ status: 'error', data: null, provenance: prov, error: 'WQP responded 503' });
    wrap(<QualityTab id="nhd:x" />);
    expect(await screen.findByText(/WQP responded 503/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('LifeTab', () => {
  it('groups, sorts, filters introduced and jumps to Underwater on row click', async () => {
    routes['/life'] = () =>
      json({
        status: 'ok',
        data: [
          species(1),
          species(2, { introduced: true, iucn: 'EN' }),
          species(3, { group: 'turtle', commonName: 'Turtle 3' }),
        ],
        provenance: prov,
      });
    wrap(<LifeTab id="nhd:x" />);
    await screen.findByText('Fish 2');
    expect(screen.getByTestId('life-group-fish')).toBeTruthy();
    expect(screen.getByTestId('life-group-turtle')).toBeTruthy();
    const rows = screen.getAllByTestId('species-row');
    expect(rows[0].getAttribute('data-species')).toBe('Genus species2'); // record count desc
    expect(rows[0].textContent).toContain('Introduced');
    expect(rows[0].textContent).toContain('IUCN EN');
    fireEvent.click(screen.getByLabelText('Introduced only'));
    expect(screen.getAllByTestId('species-row')).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId('species-row')[0]);
    expect(useUi.getState().view).toBe('underwater');
    expect(useUi.getState().highlightSpecies).toBe('Genus species2');
  });
});

describe('ImpairmentsTab', () => {
  it('lists uses with text status, grouped causes and TMDL flags', async () => {
    routes['/impairments'] = () =>
      json({
        status: 'ok',
        data: {
          assessmentUnits: [
            { id: 'AU1', name: 'Unit 1', cycle: '2024', url: 'https://mywaterway.epa.gov/x' },
          ],
          uses: [
            { use: 'Fish consumption', status: 'not_supporting' },
            { use: 'Swimming / recreation', status: 'fully_supporting' },
          ],
          causes: [
            { name: 'Mercury in Fish Tissue', group: 'metals', hasTmdl: true },
            { name: 'Phosphorus, Total', group: 'nutrients', hasTmdl: false },
          ],
        },
        provenance: prov,
      });
    wrap(<ImpairmentsTab id="nhd:x" />);
    await screen.findByText('Not supporting');
    expect(screen.getByText('Fully supporting')).toBeTruthy();
    expect(screen.getByText('Metals')).toBeTruthy();
    expect(screen.getByText('Nutrients')).toBeTruthy();
    expect(screen.getByText('TMDL')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Unit 1' }).getAttribute('href')).toBe(
      'https://mywaterway.epa.gov/x',
    );
  });
  it('says "Not assessed" when ATTAINS has nothing', async () => {
    routes['/impairments'] = () => json({ status: 'empty', data: null, provenance: prov });
    wrap(<ImpairmentsTab id="nhd:x" />);
    expect(await screen.findByText(/Not assessed/)).toBeTruthy();
  });
});

describe('ViewSwitcher', () => {
  it('is a radiogroup with five views that updates the store', async () => {
    render(<ViewSwitcher />);
    const group = screen.getByRole('radiogroup', { name: 'View' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      'map',
      'raised',
      'underwater',
      'section',
      'pollutants',
    ]);
    fireEvent.click(screen.getByLabelText('Cross-Section'));
    await waitFor(() => expect(useUi.getState().view).toBe('section'));
  });
});
