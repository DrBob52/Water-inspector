import { useMemo, useState } from 'react';
import { resolveTraits, type SpeciesGroup, type SpeciesRecord } from '@wi/shared';
import { SectionBoundary } from '../../components/ui';
import { SpeciesThumb } from '../../components/SpeciesThumb';
import { formatCount } from '../../lib/format';
import { useLife } from '../../lib/queries';
import { useUi } from '../../store';

const GROUP_LABEL: Record<SpeciesGroup, string> = {
  fish: 'Fish',
  lamprey: 'Lampreys',
  turtle: 'Turtles',
  amphibian: 'Amphibians',
  crustacean: 'Crustaceans',
  mollusc: 'Molluscs',
  mammal: 'Mammals',
  plant: 'Aquatic plants',
  cyanobacteria: 'Cyanobacteria',
  other: 'Other',
};
const GROUP_ORDER = Object.keys(GROUP_LABEL) as SpeciesGroup[];

type Sort = 'records' | 'name';

export function LifeTab({ id }: { id: string }) {
  const q = useLife(id);
  const [sort, setSort] = useState<Sort>('records');
  const [introOnly, setIntroOnly] = useState(false);
  const highlight = useUi((s) => s.highlight);
  const setView = useUi((s) => s.setView);
  const current = useUi((s) => s.highlightSpecies);

  const grouped = useMemo(() => {
    const species = q.data?.data ?? [];
    const list = species.filter((s) => !introOnly || s.introduced);
    const cmp = (a: SpeciesRecord, b: SpeciesRecord) =>
      sort === 'records'
        ? b.recordCount - a.recordCount
        : (a.commonName ?? a.scientificName).localeCompare(b.commonName ?? b.scientificName);
    return GROUP_ORDER.map((g) => ({
      g,
      items: list.filter((s) => s.group === g).sort(cmp),
    })).filter((x) => x.items.length);
  }, [q.data, sort, introOnly]);

  return (
    <SectionBoundary
      label="Species"
      isLoading={q.isLoading}
      error={q.error}
      data={q.data}
      refetch={() => void q.refetch()}
      emptyText="No GBIF species records were found in this waterbody."
    >
      {(species) => (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="flex items-center gap-2">
              Sort by
              <select
                className="btn"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                <option value="records">Record count</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={introOnly}
                onChange={(e) => setIntroOnly(e.target.checked)}
              />
              Introduced only
            </label>
          </div>
          <p className="m-0 mb-2 text-xs" style={{ color: 'var(--muted)' }}>
            {species.length} species with records. Counts are occurrence records, not population
            sizes. Select a row to see it in the Underwater view.
          </p>
          {grouped.length === 0 && <p>No species match this filter.</p>}
          {grouped.map(({ g, items }) => (
            <section
              key={g}
              aria-label={GROUP_LABEL[g]}
              className="mb-3"
              data-testid={`life-group-${g}`}
            >
              <h3 className="h-section">
                {GROUP_LABEL[g]} ({items.length})
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {items.map((s) => {
                  const t = resolveTraits(s);
                  const name = s.commonName ?? s.scientificName;
                  return (
                    <li key={s.gbifKey}>
                      <button
                        type="button"
                        data-testid="species-row"
                        data-species={s.scientificName}
                        aria-pressed={current === s.scientificName}
                        className="card flex w-full cursor-pointer items-center gap-2 py-1.5 text-left"
                        style={
                          current === s.scientificName
                            ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' }
                            : undefined
                        }
                        onClick={() => {
                          highlight(s.scientificName);
                          setView('underwater');
                        }}
                      >
                        <SpeciesThumb
                          archetype={t.archetype}
                          colors={t.colors}
                          size={30}
                          title={name}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{name}</span>
                          <span
                            className="block truncate text-xs italic"
                            style={{ color: 'var(--muted)' }}
                          >
                            {s.scientificName}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5 text-xs">
                          <span>
                            <strong>{formatCount(s.recordCount)}</strong> records
                          </span>
                          <span style={{ color: 'var(--muted)' }}>
                            last {s.lastObserved ?? 'n/a'}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          {s.introduced && <span className="chip chip-watch">Introduced</span>}
                          {s.iucn && (
                            <span
                              className="chip"
                              title="IUCN Red List category (catalog values are unverified)"
                            >
                              IUCN {s.iucn}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </SectionBoundary>
  );
}
