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

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth;
}

/**
 * Width in CSS pixels hidden behind the docked inspector on the right of the window. The map and
 * the 3D scenes are full-bleed under the glass panel; they use this to centre their content in the
 * visible stage. Matches --stage-right in index.css.
 */
export function useStageInset(panelVisible: boolean): number {
  const [w, setW] = useState(viewportWidth);
  useEffect(() => {
    const on = () => setW(viewportWidth());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  if (!panelVisible || w <= 720) return 0;
  return Math.min(440, w - 24) + 24;
}
