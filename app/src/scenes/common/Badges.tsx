import { DemoBadge } from '../../components/ui';

/** Corner badges: "Modelled" when depth or bathymetry is estimated (always, in v1) and "Demo data". */
export function SceneBadges({ demo, depthEstimated }: { demo: boolean; depthEstimated: boolean }) {
  return (
    <div className="scene-badges" data-testid="scene-badges">
      <span
        className="chip chip-watch"
        title={
          depthEstimated
            ? 'Depth is estimated and the bed shape is synthesised from it. Not a survey.'
            : 'Depth values come from an index; the bed shape between them is synthesised. Not a survey.'
        }
        data-testid="modelled-badge"
      >
        Modelled
      </span>
      {demo && <DemoBadge />}
    </div>
  );
}
