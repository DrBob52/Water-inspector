import { useState } from 'react';
import {
  PARAMETERS,
  PARAMETER_KEYS,
  formatTemp,
  formatValue,
  type ParameterSummary,
} from '@wi/shared';
import { Sparkline } from '../../components/Sparkline';
import { SectionBoundary, StatusChip } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useQuality } from '../../lib/queries';
import { useUi } from '../../store';

function ParamCard({ p }: { p: ParameterSummary }) {
  const units = useUi((s) => s.units);
  const imperialTemp = units === 'imperial' && p.key === 'water_temp';
  const fmt = (v: number) =>
    imperialTemp ? formatTemp(v, 'imperial') : `${formatValue(p.key, v)} ${p.unit}`;
  return (
    <li className="card" data-testid={`param-${p.key}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="m-0 text-sm font-bold">{p.label}</h4>
        <StatusChip status={p.status} />
      </div>
      {p.latest && (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-bold">{fmt(p.latest.value)}</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            on {formatDate(p.latest.date)}
          </span>
        </div>
      )}
      <Sparkline
        series={p.series}
        reference={p.threshold?.direction === 'max' ? p.threshold.value : undefined}
        label={`${p.label} over time, ${p.series.length} samples`}
      />
      <div className="flex flex-wrap gap-x-4 text-xs" style={{ color: 'var(--muted)' }}>
        <span>5-year median {p.median5y === null ? 'n/a' : fmt(p.median5y)}</span>
        <span>
          range {p.min === null ? 'n/a' : fmt(p.min)} to {p.max === null ? 'n/a' : fmt(p.max)}
        </span>
        <span>{p.sampleCount.toLocaleString('en-US')} samples</span>
      </div>
      {p.threshold && (
        <p className="m-0 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          Reference: {p.threshold.label},{' '}
          {p.threshold.direction === 'range'
            ? `${p.threshold.value} to ${p.threshold.rangeMax} ${p.unit}`
            : `${p.threshold.direction === 'min' ? 'minimum' : 'limit'} ${p.threshold.value} ${p.threshold.unit}`}{' '}
          (
          <a
            href={p.threshold.citation}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            source
          </a>
          ). For context only.
        </p>
      )}
      {p.note && (
        <p className="m-0 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          {p.note}
        </p>
      )}
    </li>
  );
}

export function QualityTab({ id }: { id: string }) {
  const q = useQuality(id);
  const [showMissing, setShowMissing] = useState(false);
  return (
    <SectionBoundary
      label="Water quality"
      isLoading={q.isLoading}
      error={q.error}
      data={q.data}
      refetch={() => void q.refetch()}
      emptyText="No recent water quality measurements were found for this waterbody."
    >
      {(params) => {
        const present = new Set(params.map((p) => p.key));
        const missing = PARAMETER_KEYS.filter((k) => !present.has(k));
        return (
          <div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="quality-list">
              {params.map((p) => (
                <ParamCard key={p.key} p={p} />
              ))}
            </ul>
            <details
              className="mt-3"
              open={showMissing}
              onToggle={(e) => setShowMissing((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-sm font-semibold">
                Not measured here ({missing.length})
              </summary>
              <ul className="m-0 mt-2 list-none p-0 text-sm" style={{ color: 'var(--muted)' }}>
                {missing.map((k) => (
                  <li key={k}>{PARAMETERS[k].label}</li>
                ))}
              </ul>
            </details>
            <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
              Status chips compare the most recent value with a published screening reference. They
              are not a health or safety assessment.
            </p>
          </div>
        );
      }}
    </SectionBoundary>
  );
}
