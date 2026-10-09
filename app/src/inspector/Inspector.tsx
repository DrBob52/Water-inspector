import { useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Database,
  Droplet,
  Leaf,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { formatArea } from '@wi/shared';
import { DEMO } from '../env';
import { DemoBadge, ErrorBox, Skeleton } from '../components/ui';
import { useIdentity, useImpairments, useLife, usePhysical, useQuality } from '../lib/queries';
import { displayName } from '../lib/summary';
import { TABS, type TabKey } from '../lib/urlState';
import { useUi } from '../store';
import { hasWebGL } from '../lib/webgl';
import { OverviewTab } from './tabs/OverviewTab';
import { QualityTab } from './tabs/QualityTab';
import { ImpairmentsTab } from './tabs/ImpairmentsTab';
import { LifeTab } from './tabs/LifeTab';
import { SourcesTab } from './tabs/SourcesTab';
import { SceneSummary } from './SceneSummary';

const TAB_ICONS: Record<TabKey, LucideIcon> = {
  overview: Compass,
  quality: Droplet,
  impairments: TriangleAlert,
  life: Leaf,
  sources: Database,
};

const TYPE_LABEL: Record<string, string> = {
  lake: 'Lake',
  reservoir: 'Reservoir',
  pond: 'Pond',
  river: 'River',
  stream: 'Stream',
  estuary: 'Estuary',
  bay: 'Bay',
  wetland: 'Wetland',
  unknown: 'Waterbody',
};

export function Inspector() {
  const id = useUi((s) => s.selectedId);
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const units = useUi((s) => s.units);
  const setUnits = useUi((s) => s.setUnits);
  const select = useUi((s) => s.select);
  const open = useUi((s) => s.panelOpen);
  const setOpen = useUi((s) => s.setPanelOpen);
  const identity = useIdentity(id);
  const physical = usePhysical(id);
  // Prefetch the other sections so the tabs and scenes are ready when opened.
  useQuality(id);
  useImpairments(id);
  useLife(id);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (identity.data) headingRef.current?.focus({ preventScroll: true });
  }, [identity.data?.identity.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!id) return null;
  const ident = identity.data?.identity;
  const isDemo = identity.data?.demo ?? DEMO;
  const area = physical.data?.data?.areaKm2.value;

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[n].key);
    document.getElementById(`tab-${TABS[n].key}`)?.focus();
  };

  return (
    <aside
      className={`panel panel-dock ${open ? '' : 'panel-collapsed'}`}
      aria-label="Waterbody inspector"
      data-testid="inspector"
    >
      <div className="panel-header">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {ident ? (
              <div className="panel-eyebrow">
                {TYPE_LABEL[ident.type] ?? 'Waterbody'}
                {ident.state ? ` · ${ident.state}` : ''}
              </div>
            ) : (
              <Skeleton h={10} w="30%" />
            )}
            {identity.isLoading ? (
              <div className="mt-2">
                <Skeleton h={30} w="75%" />
              </div>
            ) : identity.error ? (
              <h2 className="panel-title">Waterbody</h2>
            ) : (
              <h2 ref={headingRef} tabIndex={-1} className="panel-title" data-testid="wb-name">
                {ident ? displayName(ident) : ''}
              </h2>
            )}
            {ident && (
              <div className="panel-meta">
                {area !== undefined && <span className="tnum">{formatArea(area, units)}</span>}
                {area !== undefined && <span className="dot" aria-hidden="true" />}
                <span>{ident.country === 'US' ? 'United States' : ident.country}</span>
                {isDemo && <DemoBadge />}
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? 'Collapse panel' : 'Expand panel'}
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => select(null)}
            aria-label="Close inspector"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        {open && !hasWebGL() && (
          <p
            className="m-0 mt-3 text-xs"
            style={{ color: 'var(--muted)' }}
            data-testid="no-webgl-note"
          >
            3D views are unavailable because WebGL is not supported in this browser. The data tabs
            below still work.
          </p>
        )}
      </div>
      {open && (
        <>
          <SceneSummary />
          <div className="tablist" role="tablist" aria-label="Waterbody details">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                role="tab"
                type="button"
                className="tab"
                aria-selected={tab === t.key}
                aria-controls={`panel-${t.key}`}
                tabIndex={tab === t.key ? 0 : -1}
                onClick={() => setTab(t.key as TabKey)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {(() => {
                  const Icon = TAB_ICONS[t.key];
                  return <Icon aria-hidden="true" strokeWidth={1.9} />;
                })()}
                {t.label}
              </button>
            ))}
          </div>
          <div
            className="panel-body"
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            tabIndex={0}
          >
            {isDemo && (
              <p
                className="m-0 mb-4 flex items-center gap-2 text-xs"
                style={{ color: 'var(--demo)' }}
                data-testid="demo-note"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--demo)' }}
                />
                Illustrative sample data, not live measurements.
              </p>
            )}
            {identity.error ? (
              <ErrorBox
                title="Waterbody could not be loaded"
                message={identity.error.message}
                onRetry={() => void identity.refetch()}
              />
            ) : !ident ? (
              <Skeleton h={120} />
            ) : tab === 'overview' ? (
              <OverviewTab identity={ident} />
            ) : tab === 'quality' ? (
              <QualityTab id={ident.id} />
            ) : tab === 'impairments' ? (
              <ImpairmentsTab id={ident.id} />
            ) : tab === 'life' ? (
              <LifeTab id={ident.id} />
            ) : (
              <SourcesTab id={ident.id} />
            )}
            <div
              className="mt-4 flex items-center justify-between text-xs"
              style={{ color: 'var(--muted)' }}
            >
              <label className="flex items-center gap-2">
                Units
                <select
                  value={units}
                  onChange={(e) => setUnits(e.target.value as 'metric' | 'imperial')}
                  className="btn"
                  aria-label="Unit system"
                >
                  <option value="metric">Metric</option>
                  <option value="imperial">Imperial</option>
                </select>
              </label>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
