import { describe, expect, it } from 'vitest';
import { collectSources } from './sources';

const prov = (s: string) => ({ source: s, url: 'https://x', retrievedAt: '2026-01-01T00:00:00Z' });

describe('collectSources', () => {
  it('flattens identity, sections and merged extras', () => {
    const rows = collectSources(
      { identity: {} as never, provenance: prov('NHD'), demo: true },
      {
        quality: {
          status: 'ok',
          data: [],
          provenance: prov('WQP'),
          extras: [{ key: 'usgs', label: 'USGS', status: 'empty', provenance: prov('USGS') }],
        },
        life: { status: 'error', data: null, provenance: prov('GBIF'), error: 'down' },
        impairments: undefined,
      },
    );
    expect(rows.map((r) => r.key)).toEqual(['geometry', 'quality', 'usgs', 'life']);
    expect(rows[3]).toMatchObject({ status: 'error', error: 'down' });
  });
});
