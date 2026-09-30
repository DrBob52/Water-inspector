interface Props {
  series: Array<{ t: string; v: number }>;
  /** Optional reference line value, drawn when it falls inside the plotted range. */
  reference?: number;
  width?: number;
  height?: number;
  label: string;
}

/** Minimal dependency-free sparkline. */
export function Sparkline({ series, reference, width = 220, height = 44, label }: Props) {
  if (series.length < 2) {
    return <div style={{ height }} className="text-xs" aria-hidden="true" />;
  }
  const times = series.map((p) => Date.parse(p.t));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const vs = series.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (reference !== undefined && reference >= lo * 0.5 && reference <= hi * 2) {
    lo = Math.min(lo, reference);
    hi = Math.max(hi, reference);
  }
  const pad = 3;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (width - 2 * pad);
  const y = (v: number) =>
    height - pad - ((v - lo) / Math.max(1e-12, hi - lo)) * (height - 2 * pad);
  const d = series
    .map((p, i) => `${i ? 'L' : 'M'}${x(Date.parse(p.t)).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join('');
  const last = series[series.length - 1];
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
      style={{ height }}
    >
      {reference !== undefined && reference >= lo && reference <= hi && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(reference)}
          y2={y(reference)}
          stroke="var(--watch)"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
      )}
      <path
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${x(Date.parse(last.t)).toFixed(1)},${y(last.v).toFixed(1)}h0`}
        stroke="var(--accent)"
        strokeWidth="6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
