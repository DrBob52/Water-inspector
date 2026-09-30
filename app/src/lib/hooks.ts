import { useEffect, useState } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [v, setV] = useState(() => matches('(prefers-reduced-motion: reduce)'));
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setV(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return v;
}

function matches(q: string): boolean {
  try {
    return window.matchMedia?.(q).matches ?? false;
  } catch {
    return false;
  }
}

export function useDocumentVisible(): boolean {
  const [v, setV] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setV(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}
