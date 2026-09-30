import { useMemo } from 'react';
import { SPECIES_CATALOG, buildSceneModel, type SceneModel } from '@wi/shared';
import { useUi } from '../store';
import {
  useIdentity,
  useImpairments,
  useLife,
  usePhysical,
  useQuality,
  useStations,
} from './queries';

export interface SceneModelState {
  model: SceneModel | null;
  loading: boolean;
  error: string | null;
}

/**
 * Scene model for the selected waterbody. Built only once every section has settled (data, empty or
 * error), so the scenes mount with a complete model and do no fetching of their own.
 */
export function useSceneModel(enabled = true): SceneModelState {
  const id = useUi((s) => s.selectedId);
  const pinned = useUi((s) => s.highlightSpecies);
  const on = enabled && !!id;
  const identity = useIdentity(on ? id : null);
  const physical = usePhysical(on ? id : null);
  const quality = useQuality(on ? id : null);
  const impairments = useImpairments(on ? id : null);
  const life = useLife(on ? id : null);
  const stations = useStations(on ? id : null);
  const queries = [identity, physical, quality, impairments, life, stations];
  const loading = on && queries.some((q) => q.isLoading);
  const ident = identity.data?.identity;
  const demo = identity.data?.demo ?? false;

  const model = useMemo(() => {
    if (!on || loading || !ident) return null;
    return buildSceneModel(
      {
        identity: ident,
        physical: physical.data,
        quality: quality.data,
        impairments: impairments.data,
        life: life.data,
        stations: stations.data,
        demo,
      },
      SPECIES_CATALOG,
      { pinnedSpecies: pinned },
    );
  }, [
    on,
    loading,
    ident,
    physical.data,
    quality.data,
    impairments.data,
    life.data,
    stations.data,
    demo,
    pinned,
  ]);

  return { model, loading, error: identity.error ? identity.error.message : null };
}
