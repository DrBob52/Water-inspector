import type { ReactNode } from 'react';
import type { ParameterStatus, SourceResult } from '@wi/shared';
import { DEMO_LABEL } from '../env';

export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`chip chip-demo ${className}`} title={DEMO_LABEL}>
      Demo data
    </span>
  );
}

export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function SkeletonBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="flex flex-col gap-2 py-2">
      <Skeleton h={16} w="60%" />
      <Skeleton h={64} />
      <Skeleton h={64} />
      <span className="sr-only">Loading {label}</span>
    </div>
  );
}

export function ErrorBox({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="card" style={{ borderColor: 'var(--bad)' }}>
      <strong>{title}</strong>
      {message && (
        <p className="m-0 mt-1" style={{ color: 'var(--muted)' }}>
          {message}
        </p>
      )}
      {onRetry && (
        <button type="button" className="btn mt-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function NoteBox({ children }: { children: ReactNode }) {
  return (
    <div className="card" style={{ color: 'var(--muted)' }}>
      {children}
    </div>
  );
}

interface BoundaryProps<T> {
  label: string;
  isLoading: boolean;
  error: Error | null;
  data: SourceResult<T> | undefined;
  refetch?: () => void;
  emptyText?: string;
  children: (data: T, result: SourceResult<T>) => ReactNode;
}

/**
 * Each section loads independently: its own skeleton, its own error state. One failing source
 * never blanks the panel.
 */
export function SectionBoundary<T>({
  label,
  isLoading,
  error,
  data,
  refetch,
  emptyText,
  children,
}: BoundaryProps<T>) {
  if (isLoading) return <SkeletonBlock label={label} />;
  if (error)
    return (
      <ErrorBox title={`${label} could not be loaded`} message={error.message} onRetry={refetch} />
    );
  if (!data) return null;
  if (data.status === 'error') {
    return (
      <ErrorBox
        title={`${label} is unavailable`}
        message={data.error ?? 'The data source failed.'}
        onRetry={refetch}
      />
    );
  }
  if (data.status === 'unsupported') {
    return <NoteBox>{label} is not available for waterbodies outside the United States.</NoteBox>;
  }
  if (data.status === 'empty' || data.data === null) {
    return (
      <NoteBox>
        {emptyText ?? `No ${label.toLowerCase()} found for this waterbody.`}
        {data.provenance.note ? ` ${data.provenance.note}` : ''}
      </NoteBox>
    );
  }
  return <>{children(data.data, data)}</>;
}

export const STATUS_TEXT: Record<ParameterStatus, string> = {
  good: 'Within screening reference',
  watch: 'Near screening limit',
  exceeds: 'Above screening reference',
  no_reference: 'No reference value',
};

export function StatusChip({ status }: { status: ParameterStatus }) {
  const cls =
    status === 'good'
      ? 'chip-good'
      : status === 'watch'
        ? 'chip-watch'
        : status === 'exceeds'
          ? 'chip-bad'
          : '';
  const icon =
    status === 'good' ? '✓' : status === 'watch' ? '!' : status === 'exceeds' ? '▲' : '–';
  return (
    <span className={`chip ${cls}`}>
      <span aria-hidden="true">{icon}</span>
      {STATUS_TEXT[status]}
    </span>
  );
}
