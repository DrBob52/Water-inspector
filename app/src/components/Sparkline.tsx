import { useId, useMemo, useRef, useState } from 'react';

interface Props {
  series: Array<{ t: string; v: number }>;
  /** Optional reference line value, drawn when it falls inside the plotted range. */
  reference?: number;
  width?: number;
  height?: number;
  label: string;
  /** Formats a value for the hover tooltip, e.g. "7.9 mg/L". */
  format?: (v: number) => string;
}

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Dependency-free sparkline: a 2px line over a faint area fill, a dashed screening reference when
 * one applies, the latest value marked, and a crosshair with a tooltip on hover.
 */
export function Sparkline({ series, reference, width = 360, height = 52, label, format }: Props) {
  const gid = useId().replace(/:/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (series.length < 2) return null;
    const pts = series.map((p) => ({ t: Date.parse(p.t), v: p.v })).sort((a, b) => a.t - b.t);
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    let lo = Math.min(...pts.map((p) => p.v));
    let hi = Math.max(...pts.map((p) => p.v));
    const showRef = reference !== undefined && reference >= lo * 0.5 && reference <= hi * 2;
    if (showRef) {
      lo = Math.min(lo, reference!);
      hi = Math.max(hi, reference!);
    }
    const span = hi - lo || Math.abs(hi) || 1;
    lo -= span * 0.08;
    hi += span * 0.08;
    const padX = 4;
    const x = (t: number) => padX + ((t - t0) / Math.max(1, t1 - t0)) * (width - 2 * padX);
    const y = (v: number) => height - 2 - ((v - lo) / (hi - lo)) * (height - 6);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
    const area = `${line.join('')}L${x(t1).toFixed(1)},${height}L${x(t0).toFixed(1)},${height}Z`;
    return { pts, x, y, line: line.join(''), area, showRef };
  }, [series, reference, width, height]);

  if (!geo) return <div style={{ height }} aria-hidden="true" />;
  const { pts, x, y } = geo;
  const last = pts[pts.length - 1];
  const hp = hover === null ? null : pts[hover];

  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const tx = ((e.clientX - r.left) / r.width) * width;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(x(p.t) - tx);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div
      ref={wrap}
      className="spark"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      style={{ height }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geo.area} fill={`url(#g${gid})`} />
        {geo.showRef && (
          <line
            x1={0}
            x2={width}
            y1={y(reference!)}
            y2={y(reference!)}
            stroke="var(--watch)"
            strokeOpacity="0.7"
            strokeDasharray="4 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={geo.line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hp && (
          <line
            x1={x(hp.t)}
            x2={x(hp.t)}
            y1={0}
            y2={height}
            stroke="var(--text-2)"
            strokeOpacity="0.5"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Round markers as HTML so they stay circular under the stretched viewBox. */}
      <span
        className="spark-dot"
        style={{ left: `${(x(last.t) / width) * 100}%`, top: y(last.v) }}
        aria-hidden="true"
      />
      {hp && (
        <>
          <span
            className="spark-dot spark-dot-hover"
            style={{ left: `${(x(hp.t) / width) * 100}%`, top: y(hp.v) }}
            aria-hidden="true"
          />
          <div
            className="spark-tip"
            role="status"
            style={{
              left: `${Math.min(80, Math.max(20, (x(hp.t) / width) * 100))}%`,
            }}
          >
            <strong className="tnum">{format ? format(hp.v) : hp.v}</strong>
            <span>{fmtDate(hp.t)}</span>
          </div>
        </>
      )}
      {geo.showRef && (
        <span className="spark-ref" style={{ top: y(reference!) }} aria-hidden="true">
          limit
        </span>
      )}
    </div>
  );
}
