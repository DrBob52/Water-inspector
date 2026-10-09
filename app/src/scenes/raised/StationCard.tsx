import { PARAMETERS, formatValue, type ParameterSummary, type StationInfo } from '@wi/shared';
import { formatDate } from '../../lib/format';

/** Readings for a station pin: latest value per parameter measured there. */
export function stationReadings(station: StationInfo, quality: ParameterSummary[]) {
  return quality
    .map((p) => ({ p, r: p.latestByStation?.[station.id] }))
    .filter((x): x is { p: ParameterSummary; r: { value: number; date: string } } => !!x.r)
    .slice(0, 10);
}

/** Readings card for a clicked station beacon, at the top right of the visible stage. */
export function StationCard({
  station,
  quality,
  onClose,
}: {
  station: StationInfo;
  quality: ParameterSummary[];
  onClose: () => void;
}) {
  const rows = stationReadings(station, quality);
  return (
    <div
      className="legend"
      style={{ left: 'auto', right: 'calc(var(--stage-right) + 14px)', top: 72, width: 300 }}
      data-testid="station-card"
      role="dialog"
      aria-label={`Station ${station.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: 'var(--muted)' }}
          >
            Monitoring site
          </div>
          <strong className="block leading-snug">{station.name}</strong>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close station card">
          ×
        </button>
      </div>
      <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
        {station.id}
      </div>
      {rows.length === 0 ? (
        <p className="m-0 mt-2">No recent readings at this station.</p>
      ) : (
        <ul className="m-0 mt-2 list-none p-0 text-[12.5px]">
          {rows.map(({ p, r }) => (
            <li
              key={p.key}
              className="flex items-baseline justify-between gap-3 py-1"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <span>{PARAMETERS[p.key].label}</span>
              <span className="tnum whitespace-nowrap text-right">
                <strong>{formatValue(p.key, r.value)}</strong> {p.unit}{' '}
                <span style={{ color: 'var(--muted)' }}>{formatDate(r.date)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
