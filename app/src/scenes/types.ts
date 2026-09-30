import type { ParameterSummary, SceneModel, UnitSystem } from '@wi/shared';

export interface SceneViewProps {
  model: SceneModel;
  reducedMotion: boolean;
  units: UnitSystem;
  /** Quality summaries, used for station readings and legends. */
  quality: ParameterSummary[];
}
