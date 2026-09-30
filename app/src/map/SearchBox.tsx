import { useEffect, useId, useRef, useState } from 'react';
import { api, type SearchHit } from '../lib/api';
import { mapApi } from './mapApi';

/** Place search (Nominatim via the server). Debounced; keyboard navigable combobox. */
export function SearchBox() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [msg, setMsg] = useState<string | null>(null);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setMsg(null);
      return;
    }
    const t = window.setTimeout(async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const r = await api.search(term, ctl.signal);
        setHits(r.data ?? []);
        setMsg(
          r.status === 'error'
            ? 'Search is unavailable right now.'
            : r.data?.length
              ? null
              : 'No places found.',
        );
        setOpen(true);
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setHits([]);
          setMsg('Search is unavailable right now.');
          setOpen(true);
        }
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ(h.name);
    if (h.bbox) mapApi.fitBounds(h.bbox, { rightPadding: 40 });
    else mapApi.flyTo(h.lon, h.lat);
  };

  return (
    <div className="search-box" role="search">
      <label className="sr-only" htmlFor="place-search">
        Search for a place
      </label>
      <input
        id="place-search"
        className="search-input"
        type="search"
        placeholder="Search a place, lake or river"
        autoComplete="off"
        value={q}
        role="combobox"
        aria-expanded={open && (hits.length > 0 || !!msg)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && hits.length) {
            go(hits[Math.max(0, active)]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            e.stopPropagation();
          }
        }}
      />
      {open && (hits.length > 0 || msg) && (
        <ul className="search-results" id={listId} role="listbox" aria-label="Search results">
          {hits.map((h, i) => (
            <li key={`${h.lon},${h.lat},${i}`} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-${i}`}
                aria-selected={active === i}
                onClick={() => go(h)}
              >
                <strong>{h.name}</strong>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {h.displayName}
                </div>
              </button>
            </li>
          ))}
          {msg && <li className="p-2 text-sm">{msg}</li>}
        </ul>
      )}
    </div>
  );
}
