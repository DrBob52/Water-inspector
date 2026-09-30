import {
  formatArea,
  formatDepth,
  formatDistanceKm,
  formatElevation,
  formatVolume,
  resolveTraits,
  type Measured,
  type WaterbodyIdentity,
} from '@wi/shared';
import { SectionBoundary } from '../../components/ui';
import { SpeciesThumb } from '../../components/SpeciesThumb';
import { useImpairments, useLife, usePhysical, useQuality } from '../../lib/queries';
import { buildSummary, impairmentHeadline } from '../../lib/summary';
import { useUi } from '../../store';

function Fact({ label, m, children }: { label: string; m?: Measured; children?: string }) {
  if (!children) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {m?.estimated && (
          <span className="chip chip-watch ml-1" title={m.method}>
            Estimated
          </span>
        )}
      </dd>
      {m?.estimated && m.method && (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          {m.method}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({ identity }: { identity: WaterbodyIdentity }) {
  const id = identity.id;
  const units = useUi((s) => s.units);
  const physical = usePhysical(id);
  const quality = useQuality(id);
  const impairments = useImpairments(id);
  const life = useLife(id);
  const highlight = useUi((s) => s.highlight);
  const setView = useUi((s) => s.setView);

  const summary = buildSummary({
    identity,
    physical: physical.data,
    quality: quality.data,
    impairments: impairments.data,
    life: life.data,
    units,
  });

  return (
    <div className="flex flex-col gap-3">
      <SectionBoundary
        label="Key facts"
        isLoading={physical.isLoading}
        error={physical.error}
        data={physical.data}
        refetch={() => void physical.refetch()}
      >
        {(p) => (
          <dl className="kv m-0" data-testid="key-facts">
            <Fact label="Area" m={p.areaKm2}>
              {formatArea(p.areaKm2.value, units)}
            </Fact>
            <Fact label="Max depth" m={p.maxDepthM}>
              {p.maxDepthM ? formatDepth(p.maxDepthM.value, units) : undefined}
            </Fact>
            <Fact label="Mean depth" m={p.meanDepthM}>
              {p.meanDepthM ? formatDepth(p.meanDepthM.value, units) : undefined}
            </Fact>
            <Fact label="Volume" m={p.volumeMcm}>
              {p.volumeMcm ? formatVolume(p.volumeMcm.value, units) : undefined}
            </Fact>
            <Fact label="Surface elevation" m={p.surfaceElevationM}>
              {p.surfaceElevationM ? formatElevation(p.surfaceElevationM.value, units) : undefined}
            </Fact>
            <Fact label="Perimeter" m={p.perimeterKm}>
              {formatDistanceKm(p.perimeterKm.value, units)}
            </Fact>
            {p.lengthKm && (
              <Fact label="Reach length" m={p.lengthKm}>
                {formatDistanceKm(p.lengthKm.value, units)}
              </Fact>
            )}
            {p.shorelineDevelopment && (
              <Fact label="Shoreline development" m={p.shorelineDevelopment}>
                {p.shorelineDevelopment.value.toFixed(2)}
              </Fact>
            )}
          </dl>
        )}
      </SectionBoundary>

      <p className="m-0" data-testid="summary">
        {summary}
      </p>

      <div>
        <h3 className="h-section">Impairment status</h3>
        <p className="m-0 font-semibold" data-testid="impairment-headline">
          {impairments.isLoading ? 'Loading…' : impairmentHeadline(impairments.data)}
        </p>
      </div>

      <div>
        <h3 className="h-section">Most recorded species</h3>
        <SectionBoundary
          label="Species"
          isLoading={life.isLoading}
          error={life.error}
          data={life.data}
          refetch={() => void life.refetch()}
          emptyText="No species records found in this waterbody."
        >
          {(species) => (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {species.slice(0, 5).map((s) => {
                const t = resolveTraits(s);
                const name = s.commonName ?? s.scientificName;
                return (
                  <li key={s.gbifKey}>
                    <button
                      type="button"
                      className="card flex w-[76px] cursor-pointer flex-col items-center gap-1 p-2 text-center"
                      title={`${name} (${s.scientificName}). Show in the Underwater view`}
                      onClick={() => {
                        highlight(s.scientificName);
                        setView('underwater');
                      }}
                    >
                      <SpeciesThumb
                        archetype={t.archetype}
                        colors={t.colors}
                        size={40}
                        title={name}
                      />
                      <span className="text-[11px] leading-tight">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionBoundary>
      </div>
    </div>
  );
}
