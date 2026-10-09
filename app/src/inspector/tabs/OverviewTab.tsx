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

/** Splits "1,002 km²" into the number and its unit so the unit can be set smaller. */
function splitUnit(text: string): [string, string] {
  const m = /^([^\s]+)\s+(.+)$/.exec(text);
  return m ? [m[1], m[2]] : [text, ''];
}

function Fact({ label, m, children }: { label: string; m?: Measured; children?: string }) {
  if (!children) return null;
  const [num, unit] = splitUnit(children);
  return (
    <div>
      <dt>{label}</dt>
      <dd title={m?.estimated ? `Estimated. ${m.method ?? ''}` : undefined}>
        {num}
        {unit && (
          <>
            {' '}
            <small>{unit}</small>
          </>
        )}
        {m?.estimated && (
          <span className="est" aria-label="estimated">
            est.
          </span>
        )}
      </dd>
    </div>
  );
}

function Row({ label, m, children }: { label: string; m?: Measured; children?: string }) {
  if (!children) return null;
  return (
    <div className="fact-row">
      <dt>{label}</dt>
      <dd className="tnum" title={m?.estimated ? `Estimated. ${m.method ?? ''}` : undefined}>
        {children}
        {m?.estimated && <span className="est">est.</span>}
      </dd>
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
    <div className="flex flex-col gap-1">
      <SectionBoundary
        label="Key facts"
        isLoading={physical.isLoading}
        error={physical.error}
        data={physical.data}
        refetch={() => void physical.refetch()}
      >
        {(p) => {
          const estimated = [p.maxDepthM, p.meanDepthM, p.volumeMcm, p.surfaceElevationM].filter(
            (x) => x?.estimated && x.method,
          );
          return (
            <div data-testid="key-facts">
              <dl className="kv m-0">
                <Fact label="Area" m={p.areaKm2}>
                  {formatArea(p.areaKm2.value, units)}
                </Fact>
                <Fact label="Max depth" m={p.maxDepthM}>
                  {p.maxDepthM ? formatDepth(p.maxDepthM.value, units) : undefined}
                </Fact>
                {p.volumeMcm ? (
                  <Fact label="Volume" m={p.volumeMcm}>
                    {formatVolume(p.volumeMcm.value, units)}
                  </Fact>
                ) : (
                  <Fact label="Perimeter" m={p.perimeterKm}>
                    {formatDistanceKm(p.perimeterKm.value, units)}
                  </Fact>
                )}
              </dl>
              <dl className="fact-list m-0 mt-3">
                <Row label="Mean depth" m={p.meanDepthM}>
                  {p.meanDepthM ? formatDepth(p.meanDepthM.value, units) : undefined}
                </Row>
                <Row label="Surface elevation" m={p.surfaceElevationM}>
                  {p.surfaceElevationM
                    ? formatElevation(p.surfaceElevationM.value, units)
                    : undefined}
                </Row>
                {p.volumeMcm && (
                  <Row label="Shoreline length" m={p.perimeterKm}>
                    {formatDistanceKm(p.perimeterKm.value, units)}
                  </Row>
                )}
                {p.lengthKm && (
                  <Row label="Reach length" m={p.lengthKm}>
                    {formatDistanceKm(p.lengthKm.value, units)}
                  </Row>
                )}
                {p.shorelineDevelopment && (
                  <Row label="Shoreline development" m={p.shorelineDevelopment}>
                    {p.shorelineDevelopment.value.toFixed(2)}
                  </Row>
                )}
              </dl>
              {estimated.length > 0 && (
                <p className="footnote">
                  <span className="est">est.</span>{' '}
                  {[...new Set(estimated.map((x) => x!.method))].join(' ')}
                </p>
              )}
            </div>
          );
        }}
      </SectionBoundary>

      <div>
        <h3 className="h-section">Impairment status</h3>
        <p
          className="impair-headline m-0"
          data-testid="impairment-headline"
          data-state={(impairments.data?.data?.causes.length ?? 0) > 0 ? 'listed' : 'clear'}
        >
          {impairments.isLoading ? 'Loading…' : impairmentHeadline(impairments.data)}
        </p>
      </div>

      <div>
        <h3 className="h-section">At a glance</h3>
        <p className="lede m-0" data-testid="summary">
          {summary}
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
            <ul className="species-grid m-0 list-none p-0">
              {species.slice(0, 6).map((s) => {
                const t = resolveTraits(s);
                const name = s.commonName ?? s.scientificName;
                return (
                  <li key={s.gbifKey}>
                    <button
                      type="button"
                      className="species-tile"
                      title={`${name} (${s.scientificName}). Show in the Underwater view`}
                      onClick={() => {
                        highlight(s.scientificName);
                        setView('underwater');
                      }}
                    >
                      <SpeciesThumb
                        archetype={t.archetype}
                        colors={t.colors}
                        size={44}
                        title={name}
                      />
                      <span className="species-tile-name">{name}</span>
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
