import {
  useIdentity,
  useImpairments,
  useLife,
  usePhysical,
  useQuality,
  useStations,
} from '../../lib/queries';
import { formatDateTime } from '../../lib/format';
import { collectSources } from '../../lib/sources';
import { Skeleton } from '../../components/ui';

const STATUS_TEXT = {
  ok: 'OK',
  empty: 'No data',
  error: 'Error',
  unsupported: 'Not supported',
} as const;
const STATUS_CLS = { ok: 'chip-good', empty: '', error: 'chip-bad', unsupported: '' } as const;

export function SourcesTab({ id }: { id: string }) {
  const identity = useIdentity(id);
  const physical = usePhysical(id);
  const stations = useStations(id);
  const quality = useQuality(id);
  const impairments = useImpairments(id);
  const life = useLife(id);
  const loading = [identity, physical, stations, quality, impairments, life].some(
    (q) => q.isLoading,
  );
  const rows = collectSources(identity.data, {
    physical: physical.data,
    stations: stations.data,
    quality: quality.data,
    impairments: impairments.data,
    life: life.data,
  });
  return (
    <div>
      {loading && <Skeleton h={80} />}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs" data-testid="sources-table">
          <caption className="sr-only">Data sources for this waterbody</caption>
          <thead>
            <tr style={{ color: 'var(--muted)' }}>
              <th scope="col" className="py-1 pr-2">
                Source
              </th>
              <th scope="col" className="py-1 pr-2">
                Retrieved
              </th>
              <th scope="col" className="py-1 pr-2">
                Status
              </th>
              <th scope="col" className="py-1">
                Link
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td className="py-1.5 pr-2 align-top">
                  <strong>{r.label}</strong>
                  <div>{r.provenance.source}</div>
                  {r.provenance.license && (
                    <div style={{ color: 'var(--muted)' }}>License: {r.provenance.license}</div>
                  )}
                  {r.provenance.note && (
                    <div style={{ color: 'var(--muted)' }}>{r.provenance.note}</div>
                  )}
                  {r.error && <div style={{ color: 'var(--bad)' }}>{r.error}</div>}
                </td>
                <td className="py-1.5 pr-2 align-top whitespace-nowrap">
                  {formatDateTime(r.provenance.retrievedAt)}
                </td>
                <td className="py-1.5 pr-2 align-top">
                  <span className={`chip ${STATUS_CLS[r.status]}`}>{STATUS_TEXT[r.status]}</span>
                </td>
                <td className="py-1.5 align-top">
                  {/^https?:/.test(r.provenance.url) ? (
                    <a
                      href={r.provenance.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent)' }}
                    >
                      Request
                    </a>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>
                      {r.provenance.url ? 'Bundled sample' : 'n/a'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        Data comes from third-party monitoring programmes and databases. It may be sparse, old or
        missing for this waterbody. Screening thresholds are shown for context only and are not
        health or safety advice. Depth and bathymetry marked as modelled or estimated are not survey
        measurements.
      </p>
    </div>
  );
}
