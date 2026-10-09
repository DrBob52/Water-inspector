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
      <ul className="source-list m-0 list-none p-0" data-testid="sources-table">
        {rows.map((r) => (
          <li key={r.key} className="source-item" data-testid="source-row">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="source-label">{r.label}</div>
                <div className="source-name">{r.provenance.source}</div>
              </div>
              <span className={`chip ${STATUS_CLS[r.status]}`}>{STATUS_TEXT[r.status]}</span>
            </div>
            {r.provenance.note && <p className="source-note">{r.provenance.note}</p>}
            {r.error && (
              <p className="source-note" style={{ color: 'var(--bad)' }}>
                {r.error}
              </p>
            )}
            <div className="source-meta">
              <span className="tnum">Retrieved {formatDateTime(r.provenance.retrievedAt)}</span>
              {r.provenance.license && <span>{r.provenance.license}</span>}
              {/^https?:/.test(r.provenance.url) ? (
                <a href={r.provenance.url} target="_blank" rel="noopener noreferrer">
                  Open request
                </a>
              ) : (
                <span>{r.provenance.url ? 'Bundled sample' : 'No request'}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="footnote mt-4">
        Data comes from third-party monitoring programmes and databases. It may be sparse, old or
        missing for this waterbody. Screening thresholds are shown for context only and are not
        health or safety advice. Depth and bathymetry marked as modelled or estimated are not survey
        measurements.
      </p>
    </div>
  );
}
